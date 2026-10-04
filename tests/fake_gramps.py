"""A small in-memory stand-in for the Gramps Web API, for the backend tests (httpx.MockTransport).

It knows only what Easy Gramps uses, and copies the Gramps Web behaviour the app relies on:
family links on people are kept up to date by the server, Contributors may add objects but not
change existing ones (or link existing people into a new family), deleting an event drops it from
people, and `?backlinks=1` lists who uses an object.
"""
import copy
import json
import uuid

import httpx

KINDS = ("people", "families", "events", "notes", "places", "tags", "media")
CLASS = {"Person": "people", "Family": "families", "Event": "events", "Note": "notes", "Place": "places",
         "Tag": "tags", "Media": "media"}
ROLE = {"guest": 0, "member": 1, "contributor": 2, "editor": 3, "owner": 4}


class FakeGramps:
    def __init__(self, role="editor"):
        self.db = {k: {} for k in KINDS}
        self.role = ROLE[role]
        self.calls = []        # (method, path) of every request, for asserting what was (not) sent
        self.fail = {}         # (method, path prefix) -> status, to simulate errors
        self.token_status = 200

    # ----- helpers for tests -----
    def add(self, kind, **obj):
        obj.setdefault("handle", uuid.uuid4().hex)
        self.db[kind][obj["handle"]] = obj
        self._sync()
        return obj["handle"]

    def person(self, first="", last="", gender=2, **extra):
        name = {"_class": "Name", "first_name": first,
                "surname_list": [{"_class": "Surname", "surname": last, "primary": True}] if last else []}
        return self.add("people", _class="Person", gender=gender, primary_name=name, **extra)

    def family(self, father=None, mother=None, kids=()):
        return self.add("families", _class="Family", father_handle=father, mother_handle=mother,
                        child_ref_list=[{"_class": "ChildRef", "ref": k} for k in kids])

    def get(self, kind, h):
        return self.db[kind].get(h)

    def sent(self, method, prefix=""):
        return [p for m, p in self.calls if m == method and p.startswith(prefix)]

    @property
    def transport(self):
        return httpx.MockTransport(self.handle)

    # ----- what Gramps does by itself -----
    def _sync(self):
        """Gramps keeps family_list / parent_family_list on people in step with the families."""
        fams = self.db["families"]
        for h, p in self.db["people"].items():
            own = [f for f, x in fams.items() if h in (x.get("father_handle"), x.get("mother_handle"))]
            kid = [f for f, x in fams.items() if any(c["ref"] == h for c in x.get("child_ref_list") or [])]
            p["family_list"] = [f for f in p.get("family_list") or [] if f in own] + [f for f in own if f not in (p.get("family_list") or [])]
            p["parent_family_list"] = [f for f in p.get("parent_family_list") or [] if f in kid] + [f for f in kid if f not in (p.get("parent_family_list") or [])]

    def _backlinks(self, h):
        out = {}
        for kind, objs in self.db.items():
            for oh, o in objs.items():
                if oh != h and h in json.dumps(o):
                    out.setdefault(kind, []).append(oh)
        return out

    def _drop_refs(self, h):
        for p in self.db["people"].values():
            refs = p.get("event_ref_list") or []
            if any(r["ref"] == h for r in refs):
                p["event_ref_list"] = [r for r in refs if r["ref"] != h]
            if h in (p.get("note_list") or []):
                p["note_list"] = [n for n in p["note_list"] if n != h]

    # ----- the HTTP side -----
    def handle(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path.removeprefix("/api")
        method = request.method
        self.calls.append((method, path))
        for (m, prefix), status in self.fail.items():
            if m == method and path.startswith(prefix):
                return httpx.Response(status, json={"error": {"message": "simulated"}})
        body = json.loads(request.content) if request.content and "json" in request.headers.get("content-type", "") else None
        parts = [x for x in path.split("/") if x]

        if path == "/token/":
            if self.token_status != 200:
                return httpx.Response(self.token_status, json={"error": {"message": "no"}})
            ok = body and body.get("password") == "right"
            return httpx.Response(200, json={"access_token": "tok", "refresh_token": "ref"}) if ok else httpx.Response(403, json={})
        if path == "/token/refresh/":
            return httpx.Response(200, json={"access_token": "tok2"})
        if path == "/users/-/":
            return httpx.Response(200, json={"name": "tester", "role": self.role})
        if path == "/transactions/history/":
            return httpx.Response(200, json=[])
        if path == "/objects/" and method == "POST":
            return self._add_objects(body)
        if path == "/media/" and method == "POST":
            if self.role < 2:
                return httpx.Response(403, json={})
            h = uuid.uuid4().hex
            self.db["media"][h] = {"_class": "Media", "handle": h, "desc": "", "tag_list": []}
            return httpx.Response(201, json=[{"_class": "Media", "type": "add", "handle": h}])
        if len(parts) == 4 and parts[0] == "people" and parts[2] == "merge" and method == "POST":
            if self.role < 3:
                return httpx.Response(403, json={})
            self.db["people"].pop(parts[3], None)
            self._sync()
            return httpx.Response(200, json=[])
        if len(parts) == 4 and parts[0] == "media" and parts[2] == "thumbnail":
            if request.headers.get("authorization") != "Bearer tok":
                return httpx.Response(401, json={})
            return httpx.Response(200, content=b"\x89PNG", headers={"content-type": "image/png", "cache-control": "max-age=60"})

        kind = parts[0] if parts else ""
        if kind not in KINDS:
            return httpx.Response(404, json={})
        if len(parts) == 1 and method == "GET":
            objs = list(self.db[kind].values())
            if request.url.params.get("sort") == "-change":
                objs = sorted(objs, key=lambda o: -o.get("change", 0))
            return httpx.Response(200, json=copy.deepcopy(objs))
        h = parts[1]
        obj = self.db[kind].get(h)
        if method == "GET":
            if obj is None:
                return httpx.Response(404, json={})
            out = copy.deepcopy(obj)
            if request.url.params.get("backlinks"):
                out["backlinks"] = self._backlinks(h)
            if request.url.params.get("extend") == "note_list":
                out["extended"] = {"notes": [copy.deepcopy(self.db["notes"][n]) for n in obj.get("note_list") or [] if n in self.db["notes"]]}
            return httpx.Response(200, json=out)
        if method == "PUT":
            if self.role < 3:
                return httpx.Response(403, json={})
            if obj is None:
                return httpx.Response(404, json={})
            self.db[kind][h] = body
            self._sync()
            return httpx.Response(200, json=[])
        if method == "DELETE":
            if self.role < 3:
                return httpx.Response(403, json={})
            if obj is None:
                return httpx.Response(404, json={})
            del self.db[kind][h]
            if kind in ("events", "notes"):
                self._drop_refs(h)
            self._sync()
            return httpx.Response(200, json=[])
        return httpx.Response(405, json={})

    def _add_objects(self, objs):
        if self.role < 2:
            return httpx.Response(403, json={})
        for o in objs:
            kind = CLASS[o["_class"]]
            if o["handle"] in self.db[kind] and self.role < 3:
                return httpx.Response(403, json={})
            # Gramps refuses a Contributor a family that links an existing person (it changes that person).
            if kind == "families" and self.role < 3:
                new = {x["handle"] for x in objs}
                linked = [o.get("father_handle"), o.get("mother_handle")] + [c["ref"] for c in o.get("child_ref_list") or []]
                if any(x and x not in new and x in self.db["people"] for x in linked):
                    return httpx.Response(403, json={})
        for o in objs:
            self.db[CLASS[o["_class"]]][o["handle"]] = copy.deepcopy(o)
        self._sync()
        return httpx.Response(201, json=[{"_class": o["_class"], "type": "add", "handle": o["handle"]} for o in objs])
