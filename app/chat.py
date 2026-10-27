"""Easy Gramps' own data, in SQLite in DATA_DIR by Gramps Web login name: each login's settings and the family chat.

Conversations: the whole family (everyone; can't be left), groups (editors and the owner make them: open:
anyone can join or leave; only members read and write), private (two logins) and one per person in the
tree (every login can read and write; about a private person: only logins that may see private records).
Nothing here is written to Gramps Web.
"""
import json
import pathlib
import sqlite3
import threading
import time

MAX_TEXT = 2000
EMOJI = ("🏠", "🎉", "🍲", "📷", "⛪", "🎂", "✈️", "⚽")
FAMILY = 1  # the "Whole family" conversation's id
DATE_FORMATS = ("d mon y", "d/m/y", "m/d/y", "y-m-d", "mon d, y")
ACTIVE = 30 * 86400  # a login not seen for this long (e.g. disabled in Gramps Web) gets no emails or notifications

SCHEMA = """
CREATE TABLE IF NOT EXISTS convs (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, name TEXT, emoji TEXT,
  person TEXT UNIQUE, pair TEXT UNIQUE, created_by TEXT, created REAL, private INTEGER);
CREATE TABLE IF NOT EXISTS members (conv INTEGER NOT NULL, login TEXT NOT NULL, PRIMARY KEY (conv, login));
CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY, conv INTEGER NOT NULL, login TEXT NOT NULL,
  text TEXT, at REAL NOT NULL, deleted_by TEXT);
CREATE INDEX IF NOT EXISTS messages_conv ON messages (conv, id);
CREATE TABLE IF NOT EXISTS reads (login TEXT NOT NULL, conv INTEGER NOT NULL, last INTEGER NOT NULL, PRIMARY KEY (login, conv));
CREATE TABLE IF NOT EXISTS users (login TEXT PRIMARY KEY, seen REAL, email TEXT, full_name TEXT, emailed REAL, upto INTEGER,
  private INTEGER);
CREATE TABLE IF NOT EXISTS settings (login TEXT PRIMARY KEY, dates TEXT, emails INTEGER, person TEXT UNIQUE);
CREATE TABLE IF NOT EXISTS push (endpoint TEXT PRIMARY KEY, login TEXT NOT NULL, keys TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS site (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS invites (email TEXT PRIMARY KEY, person TEXT, role INTEGER NOT NULL, by TEXT, at REAL, joined TEXT);
"""
SITE = {"name": "Family Tree", "hide": [], "gramps": "everyone", "labels": {}, "talk": True, "suggest": "off"}  # the owner's site settings, and their defaults
ADDED = (("convs", "private"), ("users", "private"))  # columns newer than 1.8.0's tables


class ChatError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


GONE = "That conversation isn't there any more."
TAKEN = "Already linked to another login. Ask an editor."


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
        self._seen = {}  # login -> (when last written to users, what was written), so polling doesn't write every time

    def db(self) -> sqlite3.Connection:
        if self.con is None:
            try:
                self.path.parent.mkdir(parents=True, exist_ok=True)
            except OSError as e:  # (reported like any other storage trouble)
                raise sqlite3.OperationalError(str(e)) from None
            con = sqlite3.connect(self.path, check_same_thread=False, isolation_level=None)
            con.row_factory = sqlite3.Row
            con.executescript(SCHEMA)
            for table, col in ADDED:
                if col not in {r["name"] for r in con.execute(f"PRAGMA table_info({table})")}:
                    con.execute(f"ALTER TABLE {table} ADD COLUMN {col} INTEGER")
            con.execute("INSERT OR IGNORE INTO convs (id, kind, name, emoji, created) VALUES (?, 'family', 'Whole family', '🏠', ?)",
                        (FAMILY, time.time()))
            self._import_settings(con)
            self.con = con
        return self.con

    def _import_settings(self, con):
        """Before 1.8.5 the settings were in settings.json next to this file: brought in once, the file kept as .imported."""
        old = self.path.with_name("settings.json")
        try:
            data = json.loads(old.read_text())
        except (OSError, ValueError):
            return
        for login, v in (data.items() if isinstance(data, dict) else ()):
            if isinstance(v, dict):
                emails = v.get("emails")
                con.execute("INSERT OR IGNORE INTO settings (login, dates, emails, person) VALUES (?, ?, ?, ?)",
                            (login, v.get("dates") if v.get("dates") in DATE_FORMATS else None,
                             int(emails) if isinstance(emails, bool) else None,
                             v.get("person") if isinstance(v.get("person"), str) else None))
        old.replace(old.with_name("settings.json.imported"))

    def q(self, sql, *args):
        with self.lock:
            return self.db().execute(sql, args).fetchall()

    def one(self, sql, *args):
        rows = self.q(sql, *args)
        return rows[0] if rows else None

    def tx(self, *steps):
        """Several writes as one: all of them, or (after an error or a crash) none."""
        with self.lock:
            con = self.db()
            con.execute("BEGIN")
            try:
                for sql, *args in steps:
                    con.execute(sql, args)
            except BaseException:
                con.execute("ROLLBACK")
                raise
            con.execute("COMMIT")

    # ----- each login's settings: date format, the daily email on or off, who they are in the tree ("Find me") -----
    def settings(self, login: str) -> dict:
        row = self.one("SELECT dates, emails, person FROM settings WHERE login = ?", login)
        if not row:
            return {}
        out = {"dates": row["dates"], "emails": None if row["emails"] is None else bool(row["emails"]), "person": row["person"]}
        return {k: v for k, v in out.items() if v is not None}

    def save_settings(self, login: str, changes: dict) -> dict:
        for k, v in changes.items():
            assert k in ("dates", "emails"), k  # (column names: never from the request)
            self.q(f"INSERT INTO settings (login, {k}) VALUES (?, ?) ON CONFLICT (login) DO UPDATE SET {k} = excluded.{k}", login, v)
        return self.settings(login)

    def link(self, login: str, handle: str | None) -> dict:
        """Link the login to a person (None: unlink); one login per person."""
        try:
            self.q("INSERT INTO settings (login, person) VALUES (?, ?) ON CONFLICT (login) DO UPDATE SET person = excluded.person",
                   login, handle)
        except sqlite3.IntegrityError:
            raise ChatError(TAKEN, 409) from None
        return self.settings(login)

    def unlink_person(self, handle: str) -> str | None:
        row = self.one("SELECT login FROM settings WHERE person = ?", handle)
        if row:
            self.q("UPDATE settings SET person = NULL WHERE login = ?", row["login"])
        return row and row["login"]

    def linked(self) -> dict:
        """login -> the person they found themselves as."""
        return {r["login"]: r["person"] for r in self.q("SELECT login, person FROM settings WHERE person IS NOT NULL")}

    # ----- who uses the chat (for "Message someone", the daily email and notifications) -----
    def seen(self, login: str, email: str | None, full_name: str | None = None, private: bool = False):
        now, what = time.time(), (email or None, full_name or None, int(private))
        last = self._seen.get(login)
        if last and now - last[0] < 300 and last[1] == what:
            return
        self._seen[login] = (now, what)
        self.q("INSERT INTO users (login, seen, email, full_name, private) VALUES (?, ?, ?, ?, ?) ON CONFLICT (login) DO UPDATE "
               "SET seen = excluded.seen, email = excluded.email, full_name = excluded.full_name, private = excluded.private",
               login, now, *what)

    def logins(self) -> list[str]:
        return [r["login"] for r in self.q("SELECT login FROM users WHERE seen > ? ORDER BY login", time.time() - ACTIVE)]

    def sees_private(self, login: str) -> bool:
        row = self.one("SELECT private FROM users WHERE login = ?", login)
        return bool(row and row["private"])

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
        if row["kind"] == "person" and row["private"]:
            return self.sees_private(login)
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
        private = self.sees_private(login)
        out = []
        for c in self.q("SELECT * FROM convs ORDER BY id"):
            kind, cid = c["kind"], c["id"]
            if kind == "private" and login not in c["pair"].split("\n"):
                continue
            if kind == "person" and (cid not in last or (c["private"] and not private)):
                continue  # nobody has written about them yet, or a private person this login can't see
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
        self.tx(*((f"DELETE FROM {table} WHERE {col} = ?", cid)
                  for table, col in (("messages", "conv"), ("members", "conv"), ("reads", "conv"), ("convs", "id"))))

    def private(self, login: str, other: str) -> int:
        if not other or other == login:
            raise ChatError("Pick someone else to write to.")
        pair = "\n".join(sorted((login, other)))
        self.q("INSERT OR IGNORE INTO convs (kind, pair, created) VALUES ('private', ?, ?)", pair, time.time())
        return self.one("SELECT id FROM convs WHERE pair = ?", pair)["id"]

    def person_conv(self, handle: str, create: bool, name: str = "", private: bool = False) -> int | None:
        if create:  # (with every message: their name for the daily email, and whether Gramps says they're private now)
            self.q("INSERT OR IGNORE INTO convs (kind, person, created) VALUES ('person', ?, ?)", handle, time.time())
            self.q("UPDATE convs SET name = ?, private = ? WHERE person = ?", name or None, int(private), handle)
        row = self.one("SELECT id FROM convs WHERE person = ?", handle)
        return row and row["id"]

    def move_person(self, absorb: str, keep: str):
        """After a person merge: the conversation about the removed copy joins the one about the person kept,
        and a login linked to the removed copy follows (dropped if the kept one has a login already)."""
        steps = []
        old, new = self.person_conv(absorb, False), self.person_conv(keep, False)
        if old and not new:
            steps.append(("UPDATE convs SET person = ? WHERE id = ?", keep, old))
        elif old:
            steps += [("UPDATE messages SET conv = ? WHERE conv = ?", new, old), ("DELETE FROM reads WHERE conv = ?", old),
                      ("UPDATE convs SET private = MAX(COALESCE(private, 0), ?) WHERE id = ?", self.conv(old)["private"] or 0, new),
                      ("DELETE FROM convs WHERE id = ?", old)]
        if self.one("SELECT 1 FROM settings WHERE person = ?", keep):
            steps.append(("UPDATE settings SET person = NULL WHERE person = ?", absorb))
        else:
            steps.append(("UPDATE settings SET person = ? WHERE person = ?", keep, absorb))
        self.tx(*steps)

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
        if m["deleted_by"] is not None:  # a second delete takes away the "Message deleted" line (editors)
            if not editor:
                raise ChatError("Only editors can remove this.", 403)
            self.q("DELETE FROM messages WHERE id = ?", mid)
            return {"id": mid, "removed": True}
        if m["login"] != login and not editor:
            raise ChatError("You can delete only your own messages.", 403)
        self.q("UPDATE messages SET deleted_by = ?, text = NULL WHERE id = ?", login, mid)  # "Message deleted" stays
        return self._msg(self.one("SELECT * FROM messages WHERE id = ?", mid), login)

    # ----- the daily email: messages that have waited a day, at most one email a day -----
    def waiting(self, now: float, day: float = 86400) -> list[dict]:
        """Each login with an email address (not switched off, seen in the last ACTIVE days) and unread
        messages older than a day that no email has listed yet."""
        out = []
        for u in self.q("SELECT u.* FROM users u LEFT JOIN settings s ON s.login = u.login WHERE u.email IS NOT NULL "
                        "AND COALESCE(s.emails, 1) = 1 AND u.seen > ? AND (u.emailed IS NULL OR u.emailed < ?)",
                        now - ACTIVE, now - day):
            login = u["login"]
            rows = self.q(
                "SELECT m.*, c.kind, c.name, c.pair FROM messages m JOIN convs c ON c.id = m.conv "
                "LEFT JOIN reads r ON r.conv = m.conv AND r.login = ? "
                "WHERE m.id > COALESCE(r.last, 0) AND m.id > ? AND m.login != ? AND m.deleted_by IS NULL AND m.at < ? "
                "AND (c.kind = 'family' OR (c.kind = 'person' AND (NOT COALESCE(c.private, 0) OR ?)) "
                "  OR (c.kind = 'group' AND EXISTS (SELECT 1 FROM members WHERE conv = c.id AND login = ?)) "
                "  OR (c.kind = 'private' AND instr(char(10) || c.pair || char(10), char(10) || ? || char(10)) > 0)) "
                "ORDER BY m.id", login, u["upto"] or 0, login, now - day, u["private"] or 0, login, login)
            if rows:
                out.append({"login": login, "email": u["email"], "name": u["full_name"] or login, "messages": [dict(r) for r in rows]})
        return out

    def emailed(self, login: str, now: float, upto: int):
        self.q("UPDATE users SET emailed = ?, upto = ? WHERE login = ?", now, upto, login)

    def full_names(self) -> dict:
        return {r["login"]: r["full_name"] or r["login"] for r in self.q("SELECT login, full_name FROM users")}

    # ----- the owner's site settings (the same for everyone) -----
    def site(self) -> dict:
        return {**SITE, **{r["key"]: json.loads(r["value"]) for r in self.q("SELECT * FROM site") if r["key"] in SITE}}

    def save_site(self, changes: dict) -> dict:
        assert set(changes) <= set(SITE), changes
        self.tx(*[("INSERT INTO site (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
                   k, json.dumps(v)) for k, v in changes.items()])
        return self.site()

    # ----- invites: the owner's choice of role and person for someone's email, applied once they sign in -----
    def invite(self, email: str, person: str, role: int, by: str) -> dict:
        self.q("INSERT INTO invites (email, person, role, by, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (email) DO UPDATE "
               "SET person = excluded.person, role = excluded.role, by = excluded.by, at = excluded.at, joined = NULL",
               email, person, role, by, time.time())
        return dict(self.one("SELECT * FROM invites WHERE email = ?", email))

    def invites(self) -> list[dict]:
        """The ones still waiting for the person to sign in."""
        return [dict(r) for r in self.q("SELECT * FROM invites WHERE joined IS NULL ORDER BY at")]

    def joined(self, email: str, login: str):
        self.q("UPDATE invites SET joined = ? WHERE email = ?", login, email)

    # ----- phone notifications (push.py): each device that switched them on -----
    def add_device(self, login: str, endpoint: str, keys: dict):
        self.q("INSERT INTO push (endpoint, login, keys) VALUES (?, ?, ?) ON CONFLICT (endpoint) DO UPDATE "
               "SET login = excluded.login, keys = excluded.keys", endpoint, login, json.dumps(keys))

    def remove_device(self, endpoint: str, login: str | None = None):
        if login is None:  # (the push service says the device is gone)
            self.q("DELETE FROM push WHERE endpoint = ?", endpoint)
        else:
            self.q("DELETE FROM push WHERE endpoint = ? AND login = ?", endpoint, login)

    def devices(self, cid: int, writer: str) -> list[dict]:
        """The devices to tell about a new message: everyone's who may read it (seen in the last ACTIVE days) but the writer's."""
        row = self.conv(cid)
        rows = self.q("SELECT p.*, u.private FROM push p JOIN users u ON u.login = p.login WHERE u.seen > ? AND p.login != ?",
                      time.time() - ACTIVE, writer)
        rows = [r for r in rows if self.readable(row, r["login"])]
        return [{"endpoint": r["endpoint"], "keys": json.loads(r["keys"])} for r in rows]
