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
SENDS = ("auto", "manual")  # site `suggest_send`: each change goes as it's made, or they press "Send to the editors"
WHO = {"off": None, "members": (m.ROLE_MEMBER, m.ROLE_CONTRIBUTOR), "everyone": (0, m.ROLE_CONTRIBUTOR)}  # roles that suggest
STAND_IN = re.compile(r"new-[a-z0-9]{8}")
MAX_ITEMS, MAX_WAITING, MAX_BYTES = 200, 500, 100_000
router = APIRouter()


def q(sql, *args):
    c = m.CHAT
    if not getattr(c, "_suggestions", False):
        c.q(SCHEMA)
        c.q("CREATE INDEX IF NOT EXISTS suggestions_decided ON suggestions (status, decided, id)")
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


def _check(items, known=()) -> set:
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
    login = user["name"]
    theirs = [(r["id"], json.loads(r["item"]), r["status"]) for r in q("SELECT id, item, status FROM suggestions WHERE login = ? "
                                                                          "AND status IN ('waiting', 'approved')", login)]
    g = gramps.Gramps(m.GRAMPS_URL, m.bearer(request))
    for h in _check(items, {x for _, it, _ in theirs for x in (it.get("as"), it.get("fam")) if x}):
        await g.get(f"/people/{h}", keys="handle")  # only people they can see (a guest can't suggest about a private person)
    # Sent as they go (Site settings: automatic): a newer value for a field replaces the waiting one, and putting back
    # the value it had takes it off the list.
    steps, fresh = [], []
    for it in items:
        old = next(((k, o) for k, o, st in theirs if st == "waiting" and it["op"] == o["op"] == "set"
                    and (o["id"], o["field"]) == (it["id"], it["field"])), None)
        if not old:
            fresh.append(it)
        elif _same(it.get("label") if it["field"] in ("birthPlace", "burial") else it["value"], old[1].get("before")):
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


def _made() -> dict:
    out = {}
    for r in q("SELECT made FROM suggestions WHERE made IS NOT NULL"):
        out.update(json.loads(r["made"]))
    return out


PAGE = 100


@router.get("/suggestions/history")
async def history(request: Request, before: str = "", login: str = ""):
    """Editors: decided ones, newest first, PAGE at a time (`before`: the last one's "decided:id"; `login`: only theirs).
    Undo puts one back on the waiting list."""
    await m.need_edit(request, "Only editors can see this.")
    names = m.CHAT.full_names()
    where, args = ["status != 'waiting'"], []
    if before:
        try:
            t, k = before.split(":")
            args += [float(t), float(t), int(k)]
        except ValueError:
            raise HTTPException(400, "Something was missing. Please try again.") from None
        where.append("(decided < ? OR (decided = ? AND id < ?))")
    if login:
        where.append("login = ?")
        args.append(login)
    rows = q(f"SELECT * FROM suggestions WHERE {' AND '.join(where)} ORDER BY decided DESC, id DESC LIMIT {PAGE + 1}", *args)
    who = [r["login"] for r in q("SELECT DISTINCT login FROM suggestions WHERE status != 'waiting' ORDER BY login")]
    return {"items": [{"id": r["id"], "status": r["status"], "login": r["login"], "name": names.get(r["login"], r["login"]),
                       "by": names.get(r["by"], r["by"]), "decided": r["decided"], "item": json.loads(r["item"]),
                       "undo": r["status"] == "rejected" or bool(r["undo"])} for r in rows[:PAGE]],
            "more": len(rows) > PAGE, "who": [{"login": x, "name": names.get(x, x)} for x in who], "made": _made()}


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
            done.setdefault(r["login"], [[], []])[1].append(k)
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
        done.setdefault(row[0]["login"], [[], []])[0].append(k)
    for login, (yes, no) in done.items():  # tell them what, in a private message from the editor
        lines = [f"✓ Added: {x}" for x in await _say(g, yes)] + [f"✗ Not added: {x}" for x in await _say(g, no)]
        _tell(editor, login, "I looked at your suggestions. Thank you!\n" + "\n".join(lines))
    return {"approved": sum(len(v[0]) for v in done.values()), "rejected": sum(len(v[1]) for v in done.values()), "failed": failed}


WORDS = {"first": "first name", "last": "last name", "nick": "nickname", "gender": "gender", "birth": "date of birth", "birthPlace": "place of birth",
         "deceased": "passed away", "death": "date of death", "burial": "place of burial", "residence": "lives in", "phone": "phone",
         "email": "email", "notes": "notes", "work": "work", "education": "education"}
MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()


async def _say(g, ids, most=15) -> list:
    """Each suggestion in words, for the message to the person who made it: "Ravi Kumar's nickname: Ravi anna"."""
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
        if it["op"] == "set":
            v = it.get("label") if it["field"] in ("birthPlace", "burial") else value(it["field"], it.get("value"))
            out.append(f"{await who(it['id'])}'s {WORDS.get(it['field'], it['field'])}: {v or '(none)'}")
        else:
            whose = await who(it["person"])
            rel = {1: "wife", 0: "husband"}.get(genders.get(it["person"]), "husband or wife") if it["rel"] == "spouse" else it["rel"]
            out.append(f"{_label(it)} as {whose}'s {rel}")
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
