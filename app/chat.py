"""Family chat: Easy Gramps' own, text only, kept in SQLite in DATA_DIR by Gramps Web login name.

Conversations: the whole family (everyone; can't be left), groups (editors and the owner make them; open:
anyone can join or leave; only members read and write), private (two logins) and one per person in the
tree (every login can read and write). Nothing here is written to Gramps Web.
"""
import pathlib
import sqlite3
import threading
import time

MAX_TEXT = 2000
EMOJI = ("🏠", "🎉", "🍲", "📷", "⛪", "🎂", "✈️", "⚽")
FAMILY = 1  # the "Whole family" conversation's id

SCHEMA = """
CREATE TABLE IF NOT EXISTS convs (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, name TEXT, emoji TEXT,
  person TEXT UNIQUE, pair TEXT UNIQUE, created_by TEXT, created REAL);
CREATE TABLE IF NOT EXISTS members (conv INTEGER NOT NULL, login TEXT NOT NULL, PRIMARY KEY (conv, login));
CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY, conv INTEGER NOT NULL, login TEXT NOT NULL,
  text TEXT, at REAL NOT NULL, deleted_by TEXT);
CREATE INDEX IF NOT EXISTS messages_conv ON messages (conv, id);
CREATE TABLE IF NOT EXISTS reads (login TEXT NOT NULL, conv INTEGER NOT NULL, last INTEGER NOT NULL, PRIMARY KEY (login, conv));
CREATE TABLE IF NOT EXISTS users (login TEXT PRIMARY KEY, seen REAL, email TEXT, emailed REAL);
"""


class ChatError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


GONE = "That conversation isn't there any more."


def clean_text(text) -> str:
    if not isinstance(text, str) or not text.strip():
        raise ChatError("Write something first.")
    text = text.strip()
    if len(text) > MAX_TEXT:
        raise ChatError(f"That's too long: keep it under {MAX_TEXT} letters.")
    return text


class Chat:
    def __init__(self, path: pathlib.Path):
        self.path = path
        self.con = None
        self.lock = threading.Lock()
        self._seen = {}  # login -> when last written to users (so polling doesn't write every time)

    def db(self) -> sqlite3.Connection:
        if self.con is None:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            con = sqlite3.connect(self.path, check_same_thread=False, isolation_level=None)
            con.row_factory = sqlite3.Row
            con.executescript(SCHEMA)
            con.execute("INSERT OR IGNORE INTO convs (id, kind, name, emoji, created) VALUES (?, 'family', 'Whole family', '🏠', ?)",
                        (FAMILY, time.time()))
            self.con = con
        return self.con

    def q(self, sql, *args):
        with self.lock:
            return self.db().execute(sql, args).fetchall()

    def one(self, sql, *args):
        rows = self.q(sql, *args)
        return rows[0] if rows else None

    # ----- who uses the chat (for "Message someone" and the daily email) -----
    def seen(self, login: str, email: str | None):
        now = time.time()
        if now - self._seen.get(login, 0) < 300:
            return
        self._seen[login] = now
        self.q("INSERT INTO users (login, seen, email) VALUES (?, ?, ?) "
               "ON CONFLICT (login) DO UPDATE SET seen = excluded.seen, email = excluded.email", login, now, email or None)

    def logins(self) -> list[str]:
        return [r["login"] for r in self.q("SELECT login FROM users ORDER BY login")]

    # ----- conversations -----
    def conv(self, cid: int):
        row = self.one("SELECT * FROM convs WHERE id = ?", cid)
        if not row:
            raise ChatError(GONE, 404)
        return row

    def member(self, cid: int, login: str) -> bool:
        return bool(self.one("SELECT 1 FROM members WHERE conv = ? AND login = ?", cid, login))

    def readable(self, row, login: str) -> bool:
        if row["kind"] == "group":
            return self.member(row["id"], login)
        if row["kind"] == "private":
            return login in row["pair"].split("\n")
        return True  # the whole family, and conversations about a person

    def check(self, cid: int, login: str):
        row = self.conv(cid)
        if not self.readable(row, login):
            raise ChatError("Join this group first." if row["kind"] == "group" else GONE, 403 if row["kind"] == "group" else 404)
        return row

    def summary(self, login: str) -> dict:
        """Every conversation this login sees, newest first ("Whole family" on top), with unread counts."""
        last = {r["conv"]: r for r in self.q(
            "SELECT m.* FROM messages m JOIN (SELECT conv, MAX(id) id FROM messages GROUP BY conv) x ON x.id = m.id")}
        count = {r["conv"]: r["n"] for r in self.q("SELECT conv, COUNT(*) n FROM messages WHERE deleted_by IS NULL GROUP BY conv")}
        unread = {r["conv"]: r["n"] for r in self.q(
            "SELECT m.conv, COUNT(*) n FROM messages m LEFT JOIN reads r ON r.conv = m.conv AND r.login = ? "
            "WHERE m.id > COALESCE(r.last, 0) AND m.login != ? AND m.deleted_by IS NULL GROUP BY m.conv", login, login)}
        members = {r["conv"]: r["n"] for r in self.q("SELECT conv, COUNT(*) n FROM members GROUP BY conv")}
        mine = {r["conv"] for r in self.q("SELECT conv FROM members WHERE login = ?", login)}
        out = []
        for c in self.q("SELECT * FROM convs ORDER BY id"):
            kind, cid = c["kind"], c["id"]
            if kind == "private" and login not in c["pair"].split("\n"):
                continue
            if kind == "person" and cid not in last:
                continue  # nobody has written about them yet
            item = {"id": cid, "kind": kind, "name": c["name"], "emoji": c["emoji"], "person": c["person"],
                    "count": count.get(cid, 0), "unread": 0, "last": None}
            if kind == "private":
                item["other"] = next((x for x in c["pair"].split("\n") if x != login), login)
            if kind == "group":
                item["joined"], item["members"] = cid in mine, members.get(cid, 0)
            if kind != "group" or cid in mine:
                item["unread"] = unread.get(cid, 0)
                m = last.get(cid)
                item["last"] = m and self._msg(m, login)
            out.append(item)
        out.sort(key=lambda i: (i["id"] != FAMILY, -(i["last"]["at"] if i["last"] else 0)))
        return {"convs": out, "unread": sum(i["unread"] for i in out)}

    def make_group(self, login: str, name, emoji, members) -> int:
        if not isinstance(name, str) or not name.strip():
            raise ChatError("Give the group a name.")
        if emoji not in EMOJI:
            emoji = EMOJI[1]
        with self.lock:
            cur = self.db().execute("INSERT INTO convs (kind, name, emoji, created_by, created) VALUES ('group', ?, ?, ?, ?)",
                                    (name.strip()[:60], emoji, login, time.time()))
            cid = cur.lastrowid
        for m in {login, *(x for x in (members or []) if isinstance(x, str) and x)}:
            self.q("INSERT OR IGNORE INTO members (conv, login) VALUES (?, ?)", cid, m)
        return cid

    def join(self, cid: int, login: str, on: bool):
        if self.conv(cid)["kind"] != "group":
            raise ChatError("Everyone is in this conversation.")
        if on:
            self.q("INSERT OR IGNORE INTO members (conv, login) VALUES (?, ?)", cid, login)
        else:
            self.q("DELETE FROM members WHERE conv = ? AND login = ?", cid, login)

    def delete_group(self, cid: int):
        if self.conv(cid)["kind"] != "group":
            raise ChatError("Only groups can be deleted.")
        for table, col in (("messages", "conv"), ("members", "conv"), ("reads", "conv"), ("convs", "id")):
            self.q(f"DELETE FROM {table} WHERE {col} = ?", cid)

    def private(self, login: str, other: str) -> int:
        if not other or other == login:
            raise ChatError("Pick someone else to write to.")
        pair = "\n".join(sorted((login, other)))
        self.q("INSERT OR IGNORE INTO convs (kind, pair, created) VALUES ('private', ?, ?)", pair, time.time())
        return self.one("SELECT id FROM convs WHERE pair = ?", pair)["id"]

    def person_conv(self, handle: str, create: bool) -> int | None:
        if create:
            self.q("INSERT OR IGNORE INTO convs (kind, person, created) VALUES ('person', ?, ?)", handle, time.time())
        row = self.one("SELECT id FROM convs WHERE person = ?", handle)
        return row and row["id"]

    def move_person(self, absorb: str, keep: str):
        """After a person merge: the conversation about the removed copy joins the one about the person kept."""
        old, new = self.person_conv(absorb, False), self.person_conv(keep, False)
        if not old:
            return
        if not new:
            self.q("UPDATE convs SET person = ? WHERE id = ?", keep, old)
            return
        self.q("UPDATE messages SET conv = ? WHERE conv = ?", new, old)
        self.q("DELETE FROM reads WHERE conv = ?", old)
        self.q("DELETE FROM convs WHERE id = ?", old)

    # ----- messages -----
    @staticmethod
    def _msg(m, login) -> dict:
        deleted = m["deleted_by"] is not None
        return {"id": m["id"], "conv": m["conv"], "login": m["login"], "text": None if deleted else m["text"],
                "at": m["at"], "deleted": deleted, "mine": m["login"] == login}

    def messages(self, cid: int, login: str, after: int = 0, limit: int = 200, mark: bool = True) -> list[dict]:
        self.check(cid, login)
        rows = self.q("SELECT * FROM (SELECT * FROM messages WHERE conv = ? AND id > ? ORDER BY id DESC LIMIT ?) ORDER BY id",
                      cid, after, limit)
        if mark and rows:
            self.mark(cid, login, rows[-1]["id"])
        return [self._msg(m, login) for m in rows]

    def mark(self, cid: int, login: str, last: int):
        self.q("INSERT INTO reads (login, conv, last) VALUES (?, ?, ?) "
               "ON CONFLICT (login, conv) DO UPDATE SET last = MAX(last, excluded.last)", login, cid, last)

    def post(self, cid: int, login: str, text) -> dict:
        text = clean_text(text)
        self.check(cid, login)
        with self.lock:
            mid = self.db().execute("INSERT INTO messages (conv, login, text, at) VALUES (?, ?, ?, ?)",
                                    (cid, login, text, time.time())).lastrowid
        self.mark(cid, login, mid)
        return self._msg(self.one("SELECT * FROM messages WHERE id = ?", mid), login)

    def delete(self, mid: int, login: str, editor: bool) -> dict:
        m = self.one("SELECT * FROM messages WHERE id = ?", mid)
        if not m:
            raise ChatError("That message isn't there any more.", 404)
        self.check(m["conv"], login)
        if m["login"] != login and not editor:
            raise ChatError("You can delete only your own messages.", 403)
        self.q("UPDATE messages SET deleted_by = ?, text = NULL WHERE id = ?", login, mid)  # "Message deleted" stays
        return self._msg(self.one("SELECT * FROM messages WHERE id = ?", mid), login)
