"""Suggestions: people who can't change the tree (members, contributors, and guests if the owner allows) suggest
changes; editors see them as a proposed tree and approve or reject each one. Approved ones are saved to Gramps
with the editor's login, by the same code as a direct edit. Off unless the owner turns it on (Site settings).

A suggestion is a list of items, each saved on its own row so an editor can take any of them:
  {"op": "set", "id", "field", "value", "label"?, "before"?}    a field, as in PATCH /tree/person/{id}
  {"op": "add", "person", "rel", "famId"?, "new" | "existing", "as"?, "fam"?, "label"?}    as in POST /tree/relative
New people and families get a stand-in id ("new-" + 8 letters: `as` for the person, `fam` for a family it makes) that
later items of the same suggestion may use; approving swaps it for the real one (kept in `made`)."""
import json
import re
import time

from fastapi import APIRouter, HTTPException, Request

import familytree
import gramps
import main as m

SCHEMA = """CREATE TABLE IF NOT EXISTS suggestions (id INTEGER PRIMARY KEY, batch INTEGER NOT NULL, login TEXT NOT NULL,
  at REAL NOT NULL, note TEXT, item TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'waiting', by TEXT, decided REAL,
  error TEXT, made TEXT, undo TEXT)"""
WHO = {"off": None, "members": (m.ROLE_MEMBER, m.ROLE_CONTRIBUTOR), "everyone": (0, m.ROLE_CONTRIBUTOR)}  # roles that suggest
STAND_IN = re.compile(r"new-[a-z0-9]{8}")
MAX_ITEMS, MAX_WAITING, MAX_BYTES = 200, 500, 100_000
router = APIRouter()


def q(sql, *args):
    c = m.CHAT
    if not getattr(c, "_suggestions", False):
        c.q(SCHEMA)
        c._suggestions = True
    return c.q(sql, *args)


def can_suggest(user: dict) -> bool:
    roles = WHO.get(m.site()["suggest"])
    return bool(roles) and roles[0] <= user.get("role", 0) <= roles[1]


def add_to_me(user: dict):
    """/auth/me: may this login suggest, and (editors, while it's on) how many wait."""
    user["can_suggest"] = can_suggest(user)
    if user.get("can_edit") and WHO.get(m.site()["suggest"]):
        user["suggestions"] = q("SELECT count(*) n FROM suggestions WHERE status = 'waiting'")[0]["n"]


def _check(items) -> set:
    """The items' shape, and every stand-in used only after an earlier item made it. Returns the real people named."""
    bad = HTTPException(400, "Something was missing. Please try again.")
    if not isinstance(items, list) or not 0 < len(items) <= MAX_ITEMS or len(json.dumps(items)) > MAX_BYTES:
        raise bad
    made, real = set(), set()

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
            if it.get("field") not in familytree.FIELDS or "value" not in it:
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
        else:
            raise bad
    return real


@router.post("/suggestions")
async def send(request: Request):
    user = await m.who(request)
    if not can_suggest(user):
        raise HTTPException(403, "Editors change the tree directly." if user.get("can_edit") else "Suggestions are turned off.")
    body = await m.json_body(request)
    items, note = body.get("items"), " ".join(str(body.get("note") or "").split())[:500]
    g = gramps.Gramps(m.GRAMPS_URL, m.bearer(request))
    for h in _check(items):  # only people they can see (a guest can't suggest about a private person)
        await g.get(f"/people/{h}", keys="handle")
    login = user["name"]
    if q("SELECT count(*) n FROM suggestions WHERE login = ? AND status = 'waiting'", login)[0]["n"] + len(items) > MAX_WAITING:
        raise HTTPException(429, "You have many suggestions waiting. Please wait until an editor has looked at them.")
    batch = (q("SELECT max(batch) b FROM suggestions")[0]["b"] or 0) + 1
    now = time.time()
    m.CHAT.tx(*[("INSERT INTO suggestions (batch, login, at, note, item) VALUES (?, ?, ?, ?, ?)", batch, login, now, note,
                 json.dumps(it)) for it in items])
    return {"batch": batch, "count": len(items)}


def _made() -> dict:
    out = {}
    for r in q("SELECT made FROM suggestions WHERE made IS NOT NULL"):
        out.update(json.loads(r["made"]))
    return out


@router.get("/suggestions/history")
async def history(request: Request):
    """Editors: the last 200 decided, newest first (Undo puts one back on the waiting list)."""
    await m.need_edit(request, "Only editors can see this.")
    names = m.CHAT.full_names()
    rows = q("SELECT * FROM suggestions WHERE status != 'waiting' ORDER BY decided DESC, id DESC LIMIT 200")
    return {"items": [{"id": r["id"], "status": r["status"], "name": names.get(r["login"], r["login"]), "by": names.get(r["by"], r["by"]),
                       "decided": r["decided"], "item": json.loads(r["item"]), "undo": r["status"] == "rejected" or bool(r["undo"])}
                      for r in rows], "made": _made()}


@router.get("/suggestions")
async def waiting(request: Request):
    """Editors: every waiting suggestion; anyone else: their own. `made`: stand-ins already approved → real ids."""
    user = await m.who(request)
    rows = q("SELECT * FROM suggestions WHERE status = 'waiting'" + ("" if user.get("can_edit") else " AND login = ?") + " ORDER BY id",
             *(() if user.get("can_edit") else (user.get("name"),)))
    names = m.CHAT.full_names()
    return {"items": [{"id": r["id"], "batch": r["batch"], "login": r["login"], "name": names.get(r["login"], r["login"]),
                       "at": r["at"], "note": r["note"], "error": r["error"], "item": json.loads(r["item"])} for r in rows],
            "made": _made()}


@router.post("/suggestions/decide")
async def decide(request: Request):
    """{approve: [ids], reject: [ids]}: editors. Approved ones are saved oldest first; one that fails (or needs a
    person that isn't approved) stays waiting with the reason, and the rest still go through."""
    await m.need_edit(request, "Only editors can approve suggestions.")
    editor, _ = await m.chat_user(request)
    body = await m.json_body(request)
    ids = {k: [int(x) for x in body.get(k) or [] if isinstance(x, int)] for k in ("approve", "reject")}
    g = await m.gramps_as(request)
    tags = await m.tree_tags(g)
    made, done, failed, now = _made(), {}, [], time.time()
    for k in ids["reject"]:
        for r in q("UPDATE suggestions SET status = 'rejected', by = ?, decided = ? WHERE id = ? AND status = 'waiting' "
                   "RETURNING login", editor, now, k):
            done.setdefault(r["login"], [0, 0])[1] += 1
    for k in sorted(ids["approve"]):
        row = q("SELECT * FROM suggestions WHERE id = ? AND status = 'waiting'", k)
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
            if it["op"] == "set":
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
            q("UPDATE suggestions SET error = ? WHERE id = ?", msg, k)
            failed.append({"id": k, "error": msg})
            continue
        q("UPDATE suggestions SET status = 'approved', by = ?, decided = ?, error = NULL, made = ?, undo = ? WHERE id = ?",
          editor, now, json.dumps(new) if new else None, json.dumps(back) if back else None, k)
        done.setdefault(row[0]["login"], [0, 0])[0] += 1
    for login, (yes, no) in done.items():  # tell them, in a private message from the editor
        if login == editor:
            continue
        said = [f"{yes} added to the family tree ✓" if yes else "", f"{no} not added" if no else ""]
        cid = m.CHAT.private(editor, login)
        msg = m.CHAT.post(cid, editor, f"I looked at your suggestions: {', '.join(x for x in said if x)}. Thank you!")
        m.notify(cid, editor, msg["text"])
    return {"approved": sum(v[0] for v in done.values()), "rejected": sum(v[1] for v in done.values()), "failed": failed}


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
        if mine and any(set(mine) & set(_uses(json.loads(o["item"]))) for o in q("SELECT item FROM suggestions WHERE status = 'approved' AND batch = ?", r["batch"])):
            raise HTTPException(409, "Undo the changes to the people it added first (above it in the list).")
        g = await m.gramps_as(request)
        u = json.loads(r["undo"])
        if u.get("op") == "set":
            await familytree.update_person(g, u["id"], {u["field"]: u["value"]}, await m.tree_tags(g))
        else:
            await familytree.undo(g, u, await m.tree_tags(g))
    q("UPDATE suggestions SET status = 'waiting', by = NULL, decided = NULL, error = NULL, made = NULL, undo = NULL WHERE id = ?", sid)
    return {"ok": True}


def _uses(it: dict) -> list:
    return [x for x in (it.get("id"), it.get("person"), it.get("famId"), it.get("existing")) if x and STAND_IN.fullmatch(x)]
