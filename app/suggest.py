"""Suggestions: people who can't change the tree (members, contributors, and guests if the owner allows) suggest
changes; editors see them as a proposed tree and approve or reject each one. Approved ones are saved to Gramps
with the editor's login, by the same code as a direct edit. Off unless the owner turns it on (Site settings).

A suggestion is a list of items, each saved on its own row so an editor can take any of them:
  {"op": "set", "id", "field", "value", "label"?, "before"?}    a field, as in PATCH /tree/person/{id}
  {"op": "add", "person", "rel", "famId"?, "new" | "existing", "as"?, "fam"?, "label"?}    as in POST /tree/relative
  {"op": "delete", "id", "label"}    delete them (main.py `delete_mode`: editors suggest it too); the note says why
New people and families get a stand-in id ("new-" + 8 letters: `as` for the person, `fam` for a family it makes) that
later items of the same suggestion may use; approving swaps it for the real one (kept in `made`)."""
import json
import re
import time

from fastapi import APIRouter, HTTPException, Request

import changes as log
import familytree
import gramps
import main as m

SCHEMA = """CREATE TABLE IF NOT EXISTS suggestions (id INTEGER PRIMARY KEY, batch INTEGER NOT NULL, login TEXT NOT NULL,
  at REAL NOT NULL, note TEXT, item TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'waiting', by TEXT, decided REAL,
  error TEXT, made TEXT, undo TEXT)"""
SENDS = ("auto", "manual")  # site `suggest_send`: each change goes as it's made, or they press "Send to the editors"
WHO = {"off": None, "members": (m.ROLE_MEMBER, m.ROLE_CONTRIBUTOR), "everyone": (0, m.ROLE_CONTRIBUTOR)}  # roles that suggest
STAND_IN = re.compile(r"new-[a-z0-9]{8}")
MAX_ITEMS, MAX_WAITING, MAX_BYTES = 200, 500, 100_000
NEW_FIELDS = {"first", "last", "nick", "gender", "birth"}  # what adding someone new takes: later changes to these go into the add
router = APIRouter()


def q(sql, *args):
    c = m.CHAT
    if not getattr(c, "_suggestions", False):
        c.q(SCHEMA)
        c.q("CREATE INDEX IF NOT EXISTS suggestions_decided ON suggestions (status, decided, id)")
        c.q("UPDATE suggestions SET status = 'waiting' WHERE status = 'working'")  # an approval cut short by a restart
        c._suggestions = True
        _tidy()
    return c.q(sql, *args)


def _tidy():
    """Once at start: waiting rows that say the same thing twice (sent before 1.9.4) become one."""
    rows = [(r["id"], r["login"], json.loads(r["item"])) for r in m.CHAT.q("SELECT id, login, item FROM suggestions WHERE status = 'waiting' ORDER BY id")]
    seen, steps = set(), []
    for k, login, it in rows:
        key = (login, json.dumps(it, sort_keys=True))
        if key in seen:
            steps.append(("DELETE FROM suggestions WHERE id = ?", k))
            continue
        seen.add(key)
        add = it["op"] == "set" and it["field"] in NEW_FIELDS and next(
            (a for a in rows if a[1] == login and a[2]["op"] == "add" and a[2].get("as") == it["id"] and a[2].get("new")), None)
        if add:
            _fold(add[2], it)
            steps += [("UPDATE suggestions SET item = ? WHERE id = ?", json.dumps(add[2]), add[0]), ("DELETE FROM suggestions WHERE id = ?", k)]
    if steps:
        m.CHAT.tx(*steps)


def _fold(add: dict, it: dict):
    """A change to someone who is still waiting to be added goes into adding them ("Add Phili, born 1970")."""
    new = add["new"]
    if it["value"] in (None, ""):
        new.pop(it["field"], None)
    else:
        new[it["field"]] = it["value"]
    add["label"] = " ".join(str(new.get(k) or "") for k in ("first", "last")).strip() or add.get("label", "")


def can_suggest(user: dict) -> bool:
    roles = WHO.get(m.site()["suggest"])
    return bool(roles) and roles[0] <= user.get("role", 0) <= roles[1]


def add_to_me(user: dict):
    """/auth/me: may this login suggest, and (editors, while it's on) how many wait."""
    user["can_suggest"] = can_suggest(user)
    if user.get("can_edit"):  # (with suggestions off, editors' suggestions to delete someone still wait here)
        n = q("SELECT count(*) n FROM suggestions WHERE status = 'waiting'")[0]["n"]
        if n or WHO.get(m.site()["suggest"]):
            user["suggestions"] = n


def _check(items, known=(), role=0) -> set:
    """The items' shape, and every stand-in used only after an earlier item (or one of `known`, made by their earlier
    suggestions) made it. Returns the real people named."""
    bad = HTTPException(400, "Something was missing. Please try again.")
    if not isinstance(items, list) or not 0 < len(items) <= MAX_ITEMS or len(json.dumps(items)) > MAX_BYTES:
        raise bad
    made, real = set(known), set()

    def ref(x, person=True):
        if not isinstance(x, str) or not x:
            raise bad
        if STAND_IN.fullmatch(x):
            if x not in made:
                raise bad
        elif not x.replace("-", "").replace("_", "").isalnum():
            raise bad
        elif person:
            real.add(x)

    for it in items:
        if not isinstance(it, dict) or not isinstance(it.get("label", ""), str):
            raise bad
        if it.get("op") == "set":
            # (the fixed fields as before 1.9.5: a member may suggest a phone number they can't see)
            if not (it.get("field") in familytree.FIELDS or m.may_change(role, it.get("field"))) or "value" not in it:
                raise bad
            ref(it.get("id"))
        elif it.get("op") == "add":
            if it.get("rel") not in familytree.RELS or bool(it.get("new")) == bool(it.get("existing")):
                raise bad
            ref(it.get("person"))
            if it.get("famId"):
                ref(it["famId"], person=False)
            if it.get("existing"):
                ref(it["existing"])
            for k in ("as", "fam"):
                if it.get(k):
                    if not STAND_IN.fullmatch(str(it[k])) or it[k] in made:
                        raise bad
                    made.add(it[k])
            if it.get("new") and (not isinstance(it["new"], dict) or not it.get("as")):
                raise bad
        elif it.get("op") == "delete":
            if STAND_IN.fullmatch(str(it.get("id"))):  # (someone still waiting to be added: delete that suggestion instead)
                raise bad
            ref(it.get("id"))
        else:
            raise bad
    return real


@router.post("/suggestions")
async def send(request: Request):
    user = await m.who(request)
    body = await m.json_body(request)
    items, note = body.get("items"), " ".join(str(body.get("note") or "").split())[:500]
    deletes = isinstance(items, list) and items and all(isinstance(it, dict) and it.get("op") == "delete" for it in items)
    if not (can_suggest(user) or (deletes and user.get("can_edit"))):  # (editors suggest deleting someone they didn't add)
        raise HTTPException(403, "Editors change the tree directly." if user.get("can_edit") else "Suggestions are turned off.")
    login = user["name"]
    theirs = [(r["id"], json.loads(r["item"]), r["status"]) for r in q("SELECT id, item, status FROM suggestions WHERE login = ? "
                                                                          "AND status IN ('waiting', 'approved', 'working')", login)]
    # Sent again (the answer was lost on the way back, so the page kept it): the server has it already.
    had = {it.get("fam") for _, it, _ in theirs if it["op"] == "add"} | {r["f"] for r in q(
        "SELECT json_extract(item, '$.fam') f FROM suggestions WHERE login = ? AND status = 'rejected'", login)}
    if isinstance(items, list) and items:
        items = [it for it in items if not (isinstance(it, dict) and it.get("op") == "add" and it.get("fam") in had)]
        if not items:
            return {"batch": None, "count": 0}
    g = gramps.Gramps(m.GRAMPS_URL, m.bearer(request))
    for h in _check(items, {x for _, it, _ in theirs for x in (it.get("as"), it.get("fam")) if x}, user.get("role", 0)):
        await g.get(f"/people/{h}", keys="handle")  # only people they can see (a guest can't suggest about a private person)
    for it in items:
        if it["op"] == "add":
            await _can_link(g, it, [o for _, o, st in theirs if st != "approved"])
    # Sent as they go (Site settings: automatic): a newer value for a field replaces the waiting one, and putting back
    # the value it had takes it off the list.
    steps, fresh = [], []
    for it in items:
        if it["op"] == "delete":
            if not any(st == "waiting" and o["op"] == "delete" and o["id"] == it["id"] for _, o, st in theirs):  # (sent twice)
                fresh.append(it)
            continue
        old = next(((k, o) for k, o, st in theirs if st == "waiting" and it["op"] == o["op"] == "set"
                    and (o["id"], o["field"]) == (it["id"], it["field"])), None)
        add = it["op"] == "set" and it["field"] in NEW_FIELDS and next(
            ((k, o) for k, o, st in theirs if st == "waiting" and o["op"] == "add" and o.get("new") and o.get("as") == it["id"]), None)
        if add:
            _fold(add[1], it)
            steps.append(("UPDATE suggestions SET item = ? WHERE id = ?", json.dumps(add[1]), add[0]))
            if old:
                steps.append(("DELETE FROM suggestions WHERE id = ?", old[0]))
        elif not old:
            fresh.append(it)
        elif _same(it.get("label") if familytree.is_place(it["field"]) else it["value"], old[1].get("before")):
            steps.append(("DELETE FROM suggestions WHERE id = ?", old[0]))
        else:
            steps.append(("UPDATE suggestions SET item = ?, at = ? WHERE id = ?", json.dumps({**it, "before": old[1].get("before", "")}),
                          time.time(), old[0]))
    if q("SELECT count(*) n FROM suggestions WHERE login = ? AND status = 'waiting'", login)[0]["n"] + len(fresh) > MAX_WAITING:
        raise HTTPException(429, "You have many suggestions waiting. Please wait until an editor has looked at them.")
    batch = (q("SELECT max(batch) b FROM suggestions")[0]["b"] or 0) + 1
    now = time.time()
    m.CHAT.tx(*steps, *[("INSERT INTO suggestions (batch, login, at, note, item) VALUES (?, ?, ?, ?, ?)", batch, login, now, note,
                         json.dumps(it)) for it in fresh])
    return {"batch": batch, "count": len(items)}


async def _can_link(g, it, waiting):
    """Refuse a link Gramps would refuse at approval (so they hear it now, not the editor later)."""
    ph, rel, oh = it["person"], it["rel"], it.get("existing")
    mine = [o for o in waiting if o["op"] == "add" and o["person"] == ph and o["rel"] == rel and rel in ("father", "mother")]
    if mine:
        raise HTTPException(400, f"You already suggested a {rel} for them ({_label(mine[0])}). It's waiting for an editor.")
    if STAND_IN.fullmatch(ph):
        return
    if rel in ("father", "mother"):
        p = await g.get(f"/people/{ph}", keys="parent_family_list")
        for fh in (p.get("parent_family_list") or [])[:1]:
            had = (await g.get(f"/families/{fh}", keys=f"{rel}_handle")).get(f"{rel}_handle")
            if had:
                raise HTTPException(400, f"{await log.name_of(g, ph)} already has a {rel}: {await log.name_of(g, had)}. Ask an editor if that's wrong.")
    if oh and not STAND_IN.fullmatch(oh):
        if rel == "child":
            o = await g.get(f"/people/{oh}", keys="parent_family_list")
            if o.get("parent_family_list"):
                raise HTTPException(400, f"{await log.name_of(g, oh)} already has parents in the tree. Ask an editor to change them.")
        if rel == "spouse":
            a, b = await g.get(f"/people/{ph}", keys="family_list"), await g.get(f"/people/{oh}", keys="family_list")
            if set(a.get("family_list") or []) & set(b.get("family_list") or []):
                raise HTTPException(400, "They're already husband and wife.")


def _made() -> dict:
    out = {}
    for r in q("SELECT made FROM suggestions WHERE made IS NOT NULL"):
        out.update(json.loads(r["made"]))
    return out


PAGE = 100


KINDS = {"": "", "approved": "s", "rejected": "s", "editors": "c"}


@router.get("/suggestions/history")
async def history(request: Request, before: str = "", login: str = "", kind: str = ""):
    """Editors: decided suggestions and changes made straight in the tree (changes.py), newest first, PAGE at a time.
    `before`: the last one's "time:s|c:id"; `login`: only theirs (who suggested, or who changed it); `kind`: approved,
    rejected or editors. Undo puts a suggestion back on the waiting list; admins can undo a change."""
    user = await m.who(request)
    if not user.get("can_edit"):
        raise HTTPException(403, "Only editors can see this.")
    if kind not in KINDS:
        raise HTTPException(400, "Something was missing. Please try again.")
    q("SELECT 1"), log.q("SELECT 1")  # (both tables exist)
    names = m.CHAT.full_names()
    s_where, c_where, args_s, args_c = ["status IN ('approved', 'rejected')"], ["1"], [], []
    if kind in ("approved", "rejected"):
        s_where.append("status = ?")
        args_s.append(kind)
    if login:
        s_where.append("login = ?")
        c_where.append("login = ?")
        args_s.append(login)
        args_c.append(login)
    parts = ([f"SELECT 's' k, id, decided t FROM suggestions WHERE {' AND '.join(s_where)}"] if KINDS[kind] != "c" else []) + \
            ([f"SELECT 'c' k, id, at t FROM changes WHERE {' AND '.join(c_where)}"] if KINDS[kind] != "s" else [])
    args = (args_s if KINDS[kind] != "c" else []) + (args_c if KINDS[kind] != "s" else [])
    cut = ""
    if before:
        try:
            t, k, i = before.split(":")
            args += [float(t), float(t), k, k, int(i)]
        except ValueError:
            raise HTTPException(400, "Something was missing. Please try again.") from None
        cut = "WHERE t < ? OR (t = ? AND (k > ? OR (k = ? AND id < ?)))"
    keys = m.CHAT.q(f"SELECT * FROM ({' UNION ALL '.join(parts)}) {cut} ORDER BY t DESC, k, id DESC LIMIT {PAGE + 1}", *args)
    sug = {r["id"]: r for r in q(f"SELECT * FROM suggestions WHERE id IN ({','.join(str(x['id']) for x in keys if x['k'] == 's') or 0})")}
    chg = {r["id"]: r for r in log.q(f"SELECT * FROM changes WHERE id IN ({','.join(str(x['id']) for x in keys if x['k'] == 'c') or 0})")}
    admin = user.get("role", 0) >= m.ROLE_ADMIN
    items = []
    for x in keys[:PAGE]:
        if x["k"] == "s":
            r = sug[x["id"]]
            items.append({"type": "s", "id": r["id"], "status": r["status"], "login": r["login"], "name": names.get(r["login"], r["login"]),
                          "by": names.get(r["by"], r["by"]), "decided": r["decided"], "item": json.loads(r["item"]),
                          "undo": r["status"] == "rejected" or bool(r["undo"])})
        else:
            r = chg[x["id"]]
            items.append({"type": "c", "id": r["id"], "status": "undone" if r["undone"] else "changed", "login": r["login"],
                          "by": names.get(r["login"], r["login"]), "decided": r["at"], "item": json.loads(r["item"]),
                          "undone_by": names.get(r["undone_by"], r["undone_by"]), "undo": admin and bool(r["undo"]) and not r["undone"]})
    who = {r["login"] for r in q("SELECT DISTINCT login FROM suggestions WHERE status != 'waiting'")} | \
          {r["login"] for r in log.q("SELECT DISTINCT login FROM changes")}
    return {"items": items, "more": len(keys) > PAGE, "who": [{"login": x, "name": names.get(x, x)} for x in sorted(who)], "made": _made()}


@router.post("/suggestions/delete")
async def delete(request: Request):
    """{ids: [...]} or {rejected: "all"}: editors take rejected ones off the history for good (approved ones stay: they
    are the record of what changed the tree), with what builds on the new people in them (a new person's nickname
    can't go in without them)."""
    await m.need_edit(request, "Only editors can delete suggestions.")
    body = await m.json_body(request)
    if body.get("rejected") == "all":
        ids = [r["id"] for r in q("SELECT id FROM suggestions WHERE status = 'rejected'")]
    else:
        ids = [x for x in body.get("ids") or [] if type(x) is int][:1000]
    gone = set()
    for k in ids:
        for r in q("DELETE FROM suggestions WHERE id = ? AND status = 'rejected' RETURNING id, item", k):
            gone.add(r["id"])
            it = json.loads(r["item"])
            made = {x for x in (it.get("as"), it.get("fam")) if x}
            ids += [o["id"] for o in q("SELECT id, item FROM suggestions WHERE status != 'approved'") if made & set(_uses(json.loads(o["item"])))]
    return {"deleted": len(gone)}


@router.get("/suggestions")
async def waiting(request: Request):
    """Editors: every waiting suggestion; anyone else: their own. `made`: stand-ins already approved → real ids."""
    user = await m.who(request)
    rows = q("SELECT * FROM suggestions WHERE status = 'waiting'" + ("" if user.get("can_edit") else " AND login = ?") + " ORDER BY id",
             *(() if user.get("can_edit") else (user.get("name"),)))
    names = m.CHAT.full_names()
    items = [{"id": r["id"], "batch": r["batch"], "login": r["login"], "name": names.get(r["login"], r["login"]),
              "at": r["at"], "note": r["note"], "error": r["error"], "item": json.loads(r["item"])} for r in rows]
    if user.get("can_edit"):
        for x in items:
            if x["item"]["op"] == "delete" and (why := _not_yours(user, x["login"], x["item"]["id"])):
                x["blocked"] = why  # shown, not checkable: someone else approves it
    return {"items": items, "made": _made()}


def _not_yours(user: dict, login: str, handle: str) -> str:
    """Why this editor can't approve deleting `handle` (suggested by `login`), or ""."""
    if login == user.get("name"):
        return "You suggested this, so another editor approves it."
    return m.login_block(user, handle)


@router.delete("/suggestions/{sid}")
async def withdraw(sid: int, request: Request):
    """Their own waiting suggestion, deleted (the page says "Delete"), with their later ones that build on a new person
    in it (a new person's nickname can't go in without them)."""
    login = (await m.who(request)).get("name")
    ids, gone = [sid], 0
    for k in ids:
        for r in q("DELETE FROM suggestions WHERE id = ? AND login = ? AND status = 'waiting' RETURNING item", k, login):
            gone += 1
            new = {x for x in (json.loads(r["item"]).get(a) for a in ("as", "fam")) if x}
            ids += [o["id"] for o in q("SELECT id, item FROM suggestions WHERE login = ? AND status = 'waiting'", login)
                    if new & set(_uses(json.loads(o["item"])))]
    if not gone:
        raise HTTPException(404, "An editor has looked at that one already.")
    return {"deleted": gone}


@router.post("/suggestions/decide")
async def decide(request: Request):
    """{approve: [ids], reject: [ids], quiet?}: editors. Approved ones are saved oldest first; one that fails (or needs a
    person that isn't approved) stays waiting with the reason, and the rest still go through. Each row is claimed
    first ('working'), so a second Approve (another tab, a click while it's slow) can't add it twice. The page sends
    big lists one at a time with `quiet` (to show progress), then POST /suggestions/tell once."""
    await m.need_edit(request, "Only editors can approve suggestions.")
    editor, _ = await m.chat_user(request)
    user = await m.who(request)
    body = await m.json_body(request)
    ids = {k: [int(x) for x in body.get(k) or [] if isinstance(x, int)] for k in ("approve", "reject")}
    g = await m.gramps_as(request)
    tags = await m.tree_tags(g)
    made, done, failed, now = _made(), {}, [], time.time()
    for k in ids["reject"]:
        for r in q("UPDATE suggestions SET status = 'rejected', by = ?, decided = ? WHERE id = ? AND status = 'waiting' "
                   "RETURNING login", editor, now, k):
            done.setdefault(r["login"], [[], []])[1].append(k)
    for k in sorted(ids["approve"]):
        row = q("UPDATE suggestions SET status = 'working' WHERE id = ? AND status = 'waiting' RETURNING *", k)
        if not row:
            continue
        it = json.loads(row[0]["item"])

        def real(x):
            if x and STAND_IN.fullmatch(x):
                if x not in made:
                    raise gramps.GrampsError("Approve the new person it is about first.")
                return made[x]
            return x
        try:
            new = None
            if it["op"] == "delete":  # no undo: History says who suggested and who approved it
                if why := _not_yours(user, row[0]["login"], it["id"]):
                    raise gramps.GrampsError(why)
                try:
                    await familytree.delete_person(g, it["id"])
                except gramps.GrampsError as e:
                    if e.status != 404:  # (already gone: someone else suggested it too, or it was deleted in Full Gramps)
                        raise
                m.CHAT.unlink_person(it["id"])
                back = None
            elif it["op"] == "set":
                h = real(it["id"])
                back = {"op": "set", "id": h, "field": it["field"], "value": (await familytree.fields_now(g, h)).get(it["field"])}
                await familytree.update_person(g, h, {it["field"]: it["value"]}, tags)
            else:
                res = await familytree.add_relative(g, {"person": real(it["person"]), "rel": it["rel"], "famId": real(it.get("famId")),
                                                        "new": it.get("new"), "existing": real(it.get("existing"))}, tags)
                new = {a: b for a, b in ((it.get("as"), res["added"] if it.get("new") else None), (it.get("fam"), res["famId"])) if a and b}
                made.update(new)
                back = res.get("undo")
        except (gramps.GrampsError, HTTPException) as e:
            msg = getattr(e, "detail", None) or str(e)
            q("UPDATE suggestions SET status = 'waiting', error = ? WHERE id = ?", msg, k)
            failed.append({"id": k, "error": msg})
            continue
        q("UPDATE suggestions SET status = 'approved', by = ?, decided = ?, error = NULL, made = ?, undo = ? WHERE id = ?",
          editor, now, json.dumps(new) if new else None, json.dumps(back) if back else None, k)
        done.setdefault(row[0]["login"], [[], []])[0].append(k)
    if not body.get("quiet"):
        await _thank(g, editor, done)
    return {"approved": sum(len(v[0]) for v in done.values()), "rejected": sum(len(v[1]) for v in done.values()), "failed": failed,
            "ids": [k for v in done.values() for k in v[0]]}


async def _thank(g, editor, done):
    for login, (yes, no) in done.items():  # tell them what, in a private message from the editor
        lines = await _say(g, yes, done=True) + await _say(g, no, done=False)
        _tell(editor, login, "I looked at your suggestions. Thank you!\n" + "\n".join(lines))


@router.post("/suggestions/tell")
async def tell(request: Request):
    """{approved: [ids]}: after approving one at a time (decide with `quiet`), one message to each person."""
    await m.need_edit(request, "Only editors can approve suggestions.")
    editor, _ = await m.chat_user(request)
    ids = [x for x in (await m.json_body(request)).get("approved") or [] if type(x) is int][:MAX_WAITING]
    done = {}
    for k in ids:
        for r in q("SELECT login FROM suggestions WHERE id = ? AND status = 'approved' AND by = ?", k, editor):
            done.setdefault(r["login"], [[], []])[0].append(k)
    await _thank(await m.gramps_as(request), editor, done)
    return {"ok": True}


WORDS = {"first": "first name", "last": "last name", "nick": "nickname", "gender": "gender", "birth": "date of birth", "birthPlace": "place of birth",
         "deceased": "passed away", "death": "date of death", "burial": "place of burial", "residence": "lives in", "phone": "phone",
         "email": "email", "notes": "notes", "work": "work", "education": "education"}
MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()


async def _say(g, ids, most=15, done=None) -> list:
    """Each suggestion in words, for the message to the person who made it: "Ravi Kumar's nickname: Ravi anna"; with
    `done`, as approved or not: "✓ Added: …", "✗ Not deleted: …"."""
    rows = [r for k in ids for r in q("SELECT item FROM suggestions WHERE id = ?", k)]
    if not rows:
        return []
    new = {}  # stand-in → the name it was suggested with
    for r in q("SELECT item FROM suggestions WHERE item LIKE '%\"as\"%'"):
        it = json.loads(r["item"])
        if it.get("as"):
            new[it["as"]] = _label(it)
    names, genders = {}, {}

    async def who(h):
        if h in new:
            return new[h]
        if h not in names:
            try:
                p = await g.get(f"/people/{h}", keys="primary_name,gender")
                n = p["primary_name"]
                names[h] = " ".join(x for x in (n.get("first_name"), (n.get("surname_list") or [{}])[0].get("surname")) if x) or "someone"
                genders[h] = p.get("gender")
            except (gramps.GrampsError, HTTPException, KeyError, IndexError, TypeError):
                names[h] = "someone"
        return names[h]

    def value(f, v):
        if isinstance(v, bool):
            return "yes" if v else "no"
        if f == "gender":
            return {"m": "male", "f": "female"}.get(v, "unknown")
        if isinstance(v, dict):
            return " ".join(str(x) for x in (v.get("d"), MONTHS[v["m"] - 1] if 1 <= (v.get("m") or 0) <= 12 else None, v.get("y")) if x) or v.get("new", "")
        return str(v) if v not in (None, "") else "(none)"
    out = []
    for r in rows[:most]:
        it = json.loads(r["item"])
        if it["op"] == "delete":
            text = f"deleting {it.get('label') or await who(it['id'])}" if done is None else it.get("label") or "someone"
        elif it["op"] == "set":
            v = it.get("label") if familytree.is_place(it["field"]) else value(it["field"], it.get("value"))
            text = f"{await who(it['id'])}'s {WORDS.get(it['field']) or familytree.word(it['field'])}: {v or '(none)'}"
        else:
            whose = await who(it["person"])
            rel = {1: "wife", 0: "husband"}.get(genders.get(it["person"]), "husband or wife") if it["rel"] == "spouse" else it["rel"]
            text = f"{_label(it)} as {whose}'s {rel}"
        if done is not None:
            word = ("Deleted" if done else "Not deleted") if it["op"] == "delete" else "Added" if done else "Not added"
            text = f"{'✓' if done else '✗'} {word}: {text}"
        out.append(text)
    return out + ([f"…and {len(rows) - most} more"] if len(rows) > most else [])


def _label(it: dict) -> str:
    n = it.get("new") or {}
    return it.get("label") or " ".join(str(n.get(k) or "") for k in ("first", "last")).strip() or "someone new"


def _tell(editor: str, login: str, text: str):
    if login != editor:
        cid = m.CHAT.private(editor, login)
        msg = m.CHAT.post(cid, editor, text)
        m.notify(cid, editor, msg["text"])


@router.post("/suggestions/{sid}/undo")
async def undo(sid: int, request: Request):
    """Back on the waiting list. An approved one is first taken out of the tree again: the field gets the value it had
    before, a new person is deleted (a link is removed). Not while approved ones still build on the person it made."""
    await m.need_edit(request, "Only editors can undo this.")
    row = q("SELECT * FROM suggestions WHERE id = ? AND status != 'waiting'", sid)
    if not row:
        raise HTTPException(404, "That one is already back on the list.")
    r = row[0]
    if r["status"] == "approved":
        if not r["undo"]:
            raise HTTPException(400, "This one can't be undone here. Please change it in the editor.")
        mine = list(json.loads(r["made"] or "{}"))
        if mine and any(set(mine) & set(_uses(json.loads(o["item"]))) for o in q("SELECT item FROM suggestions WHERE status = 'approved'")):
            raise HTTPException(409, "Undo the changes to the people it added first (above it in the list).")
        g = await m.gramps_as(request)
        u = json.loads(r["undo"])
        if u.get("op") == "set":
            await familytree.update_person(g, u["id"], {u["field"]: u["value"]}, await m.tree_tags(g))
        else:
            await familytree.undo(g, u, await m.tree_tags(g))
        said = await _say(g, [sid])  # (before the row loses `made`: a new person is still named)
        editor, _ = await m.chat_user(request)
        _tell(editor, r["login"], f"I took this back out of the family tree to look at it again: {said[0]}")
    q("UPDATE suggestions SET status = 'waiting', by = NULL, decided = NULL, error = NULL, made = NULL, undo = NULL WHERE id = ?", sid)
    return {"ok": True}


def _same(a, b) -> bool:
    return json.dumps("" if a is None else a) == json.dumps("" if b is None else b)


def _uses(it: dict) -> list:
    return [x for x in (it.get("id"), it.get("person"), it.get("famId"), it.get("existing")) if x and STAND_IN.fullmatch(x)]
