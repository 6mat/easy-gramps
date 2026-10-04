"""Small Gramps Web API client and object helpers, used with the caller's own token."""
import datetime
import uuid

import httpx

MOD_NONE, MOD_ABOUT = 0, 3
GENDER = {"female": 0, "male": 1, "unknown": 2}


class GrampsError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def new_handle():
    return uuid.uuid4().hex


class Gramps:
    def __init__(self, base_url: str, token: str):
        self.http = httpx.AsyncClient(base_url=f"{base_url}/api", timeout=60,
                                      headers={"Authorization": f"Bearer {token}"})

    async def close(self):
        await self.http.aclose()

    async def _call(self, method, path, **kw):
        r = await self.http.request(method, path, **kw)
        if r.status_code >= 400:
            try:
                msg = r.json().get("error", {}).get("message") or r.text
            except ValueError:
                msg = r.text
            raise GrampsError(f"Gramps said: {msg}", r.status_code if r.status_code in (401, 403) else 502)
        return r.json() if r.content else None

    async def get(self, path, **params):
        return await self._call("GET", path, params=params)

    async def put(self, path, obj):
        return await self._call("PUT", path, json=obj)

    async def add_objects(self, objs):
        return await self._call("POST", "/objects/", json=objs)

    async def post(self, path, obj=None):
        return await self._call("POST", path, json=obj if obj is not None else {})

    async def upload_media(self, data: bytes, content_type: str) -> str:
        res = await self._call("POST", "/media/", content=data,
                               headers={"Content-Type": content_type or "application/octet-stream"})
        for tx in res or []:
            if tx.get("_class") == "Media" and tx.get("type") == "add":
                return tx["handle"]
        raise GrampsError("Photo upload did not return a media record", 502)

    async def places_by_name(self) -> dict:
        return {p["name"]["value"].strip().lower(): p["handle"]
                for p in await self.get("/places/", keys="handle,name") if p["name"]["value"].strip()}

    async def tag_handle(self, name: str) -> str:
        for tag in await self.get("/tags/", keys="handle,name"):
            if tag["name"] == name:
                return tag["handle"]
        handle = new_handle()
        await self.add_objects([{"_class": "Tag", "handle": handle, "name": name,
                                 "color": "#EF2929", "priority": 0}])
        return handle


def gramps_date(v):
    """{'day','month','year','about'} -> Gramps Date dict, or None when empty."""
    if not v:
        return None
    y = int(v.get("year") or 0)
    if not y:
        return None
    m = int(v.get("month") or 0)
    d = int(v.get("day") or 0) if m else 0
    try:
        sortval = datetime.date(y, m or 1, d or 1).toordinal() + 1721425
    except ValueError as e:
        raise GrampsError(f"That date doesn't exist: {e}")
    return {"_class": "Date", "calendar": 0, "modifier": MOD_ABOUT if v.get("about") else MOD_NONE,
            "quality": 0, "dateval": [d, m, y, False], "sortval": sortval, "newyear": 0,
            "text": "", "year": y}


def note_obj(text, tag_list, private):
    return {"_class": "Note", "handle": new_handle(), "type": "General", "private": private,
            "tag_list": list(tag_list), "text": {"_class": "StyledText", "string": text, "tags": []}}


def new_person_objs(details, tags, private, gender=None):
    """A new Person (plus a Birth event if a birthday was given) -> (handle, [objects])."""
    surname = (details.get("surname") or "").strip()
    person = {"_class": "Person", "handle": new_handle(), "private": private, "tag_list": list(tags),
              "gender": GENDER.get(details.get("gender") or gender or "unknown", 2),
              "primary_name": {"_class": "Name", "type": "Birth Name",
                               "first_name": (details.get("first_name") or "").strip(),
                               "surname_list": [{"_class": "Surname", "surname": surname, "primary": True}] if surname else []}}
    objs = [person]
    birth = gramps_date(details.get("birth_date"))
    if birth:
        ev = {"_class": "Event", "handle": new_handle(), "type": "Birth", "date": birth, "place": "",
              "private": private, "tag_list": list(tags)}
        objs.append(ev)
        person["event_ref_list"] = [{"_class": "EventRef", "ref": ev["handle"], "role": "Primary"}]
        person["birth_ref_index"] = 0
    return person["handle"], objs


async def upload_photo(g, photo, tags, private, desc=""):
    data, content_type, filename = photo
    h = await g.upload_media(data, content_type)
    media = await g.get(f"/media/{h}")
    media["desc"] = desc or filename or "Photo"
    media["private"] = private
    media["tag_list"] = sorted(set(media.get("tag_list", []) + tags))
    await g.put(f"/media/{h}", media)
    return h
