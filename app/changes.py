"""The change log: every change made straight to the tree in Easy Gramps (editors, the owner, admins; contributors'
new people), in words, for History. Approved suggestions aren't here: they are in `suggestions`, with who suggested
them. Admins can undo a change while nothing changed it again since. Changes made in Full Gramps aren't seen.

Each row's `item` is shaped like a suggestion's, so History shows both the same way:
  {"op": "set", "id", "field", "value", "before", "label"?}   value / before as the page shows them (places by name)
  {"op": "add", "person", "rel", "existing": the person added, "label", "new"?}
  {"op": "unlink", "person", "rel", "other", "label"} · {"op": "create" | "other" | "merge" | "combine", "id", "label"?, "what"?}
`undo`: what puts it back ({"op": "set", "id", "field", "value"} or a /tree/undo token); `after`: the field's value
right after the change (a set), to see whether it changed again."""
import asyncio
import json
import time

from fastapi import APIRouter, HTTPException, Request

import familytree
import gramps
import main as m

SCHEMA = """CREATE TABLE IF NOT EXISTS changes (id INTEGER PRIMARY KEY, login TEXT NOT NULL, at REAL NOT NULL,
  item TEXT NOT NULL, after TEXT, undo TEXT, undone REAL, undone_by TEXT)"""
JOIN = 600  # the same field changed again by the same login within 10 minutes: one row (autosave saves while they type)
router = APIRouter()
_tasks: set = set()


def q(sql, *args):
    c = m.CHAT
    if not getattr(c, "_changes", False):
        c.q(SCHEMA)
        c.q("CREATE INDEX IF NOT EXISTS changes_at ON changes (at, id)")
        c._changes = True
    return c.q(sql, *args)


def add(login: str, item: dict, undo=None, after=None):
    q("INSERT INTO changes (login, at, item, after, undo) VALUES (?, ?, ?, ?, ?)", login, time.time(), json.dumps(item),
      None if after is None else json.dumps(after), json.dumps(undo) if undo else None)


async def name_of(g, h) -> str:
    try:
        p = await g.get(f"/people/{h}", keys="primary_name")
        n = p["primary_name"]
        return " ".join(x for x in (n.get("first_name"), familytree.surname_of(n)) if x) or "someone"
    except (gramps.GrampsError, HTTPException, KeyError, TypeError):
        return "someone"


async def _shown(g, field, v):
    """A field's value as History shows it: places by name (Gramps keeps them as {id})."""
    if isinstance(v, dict) and v.get("id") and field in ("birthPlace", "burial"):
        try:
            return (await g.get(f"/places/{v['id']}", keys="name"))["name"]["value"]
        except (gramps.GrampsError, HTTPException, KeyError, TypeError):
            return ""
    return v


async def fields(g, login: str, handle: str, before: dict, names):
    """After a PATCH: one row per field (or the row it joins). Runs after the answer has gone back."""
    try:
        now = await familytree.fields_now(g, handle)
        for f in names:
            if same(before.get(f), now.get(f)):
                continue
            old = q("SELECT id, item, undo FROM changes WHERE login = ? AND undone IS NULL AND at > ? AND json_extract(item, '$.op') = 'set' "
                    "AND json_extract(item, '$.id') = ? AND json_extract(item, '$.field') = ? ORDER BY id DESC LIMIT 1",
                    login, time.time() - JOIN, handle, f)
            label = await _shown(g, f, now.get(f))
            if old:
                it, back = json.loads(old[0]["item"]), json.loads(old[0]["undo"])
                if same(back["value"], now.get(f)):  # back to what it was: nothing changed after all
                    q("DELETE FROM changes WHERE id = ?", old[0]["id"])
                else:
                    q("UPDATE changes SET item = ?, after = ?, at = ? WHERE id = ?", json.dumps({**it, "value": label, "label": label}),
                      json.dumps(now.get(f)), time.time(), old[0]["id"])
                continue
            add(login, {"op": "set", "id": handle, "field": f, "value": label, "label": label, "before": await _shown(g, f, before.get(f))},
                {"op": "set", "id": handle, "field": f, "value": before.get(f)}, now.get(f))
    except (gramps.GrampsError, HTTPException) as e:
        gramps.log.error("Couldn't log the change to %s: %s", handle, e)


def same(a, b) -> bool:
    return json.dumps("" if a is None else a, sort_keys=True) == json.dumps("" if b is None else b, sort_keys=True)


BACKGROUND = True  # (tests: False, to look at the row right after the save)


async def later(coro):
    """Log in the background: the page's save doesn't wait for it."""
    if not BACKGROUND:
        return await coro
    t = asyncio.create_task(coro)
    _tasks.add(t)
    t.add_done_callback(_tasks.discard)


def undone_by_toast(token):
    """The page's 10-second Undo (POST /tree/undo) took one back: mark its row."""
    q("UPDATE changes SET undone = ?, undone_by = 'toast' WHERE undone IS NULL AND undo = ?", time.time(), json.dumps(token))


def _people(it) -> set:
    return {x for x in (it.get("id"), it.get("person"), it.get("existing"), it.get("other")) if x}


@router.post("/changes/{cid}/undo")
async def undo(cid: int, request: Request):
    """Admins: put one change back, unless something changed it again since (then: in the editor, by hand)."""
    user = await m.who(request)
    if user.get("role", 0) < m.ROLE_ADMIN:
        raise HTTPException(403, "Only admins can undo editors' changes.")
    row = q("SELECT * FROM changes WHERE id = ?", cid)
    if not row or row[0]["undone"]:
        raise HTTPException(404, "That one is already undone.")
    r = row[0]
    if not r["undo"]:
        raise HTTPException(400, "This one can't be undone here. Change it back in the editor, or in Full Gramps.")
    u, it = json.loads(r["undo"]), json.loads(r["item"])
    g = await m.gramps_as(request)
    again = "It was changed again since, so it can't be undone here. Change it back in the editor."
    if u.get("op") == "set":
        if not same((await familytree.fields_now(g, u["id"])).get(u["field"]), json.loads(r["after"] or "null")):
            raise HTTPException(409, again)
        await familytree.update_person(g, u["id"], {u["field"]: u["value"]}, await m.tree_tags(g))
    else:
        mine = _people(it) - {it.get("person")}  # (the person they were added to may have changed: that's fine)
        if any(mine & _people(json.loads(o["item"])) for o in q("SELECT item FROM changes WHERE id > ? AND undone IS NULL", cid)):
            raise HTTPException(409, again)
        await familytree.undo(g, u, await m.tree_tags(g))
    q("UPDATE changes SET undone = ?, undone_by = ? WHERE id = ?", time.time(), user["name"], cid)
    return {"ok": True}
