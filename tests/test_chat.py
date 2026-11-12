"""Family chat (chat.py + the /chat routes), against the fake Gramps Web."""
import pytest

E = "/easy-gramps"


@pytest.fixture
def chat(fake, client):
    return client


def as_user(fake, name, role=1):
    import main
    fake.user, fake.role = name, role
    main._who_cache.clear()


def conv(c, cid):
    return next(x for x in c.get(f"{E}/chat").json()["convs"] if x["id"] == cid)


def test_whole_family_unread_and_read(fake, chat):
    as_user(fake, "ann")
    assert chat.get(f"{E}/chat").json()["convs"][0]["name"] == "Whole family"
    m = chat.post(f"{E}/chat/c/1", json={"text": "  Lunch on Sunday?  "}).json()
    assert m["text"] == "Lunch on Sunday?" and m["mine"]
    assert chat.post(f"{E}/chat/c/1", json={"text": "  "}).status_code == 400
    assert chat.post(f"{E}/chat/c/1", json={"text": "x" * 2001}).status_code == 400
    as_user(fake, "bob", 0)  # a Guest can chat too
    assert chat.get(f"{E}/chat").json()["unread"] == 1
    assert [x["text"] for x in chat.get(f"{E}/chat/c/1").json()] == ["Lunch on Sunday?"]
    assert chat.get(f"{E}/chat").json()["unread"] == 0
    assert chat.get(f"{E}/chat").json()["logins"] == ["ann", "bob"]
    assert chat.post(f"{E}/chat/c/1/join", json={"join": False}).status_code == 400  # can't leave the family


def test_delete_own_or_as_editor_leaves_message_deleted(fake, chat):
    as_user(fake, "ann")
    a = chat.post(f"{E}/chat/c/1", json={"text": "one"}).json()["id"]
    b = chat.post(f"{E}/chat/c/1", json={"text": "two"}).json()["id"]
    as_user(fake, "bob")
    assert chat.delete(f"{E}/chat/m/{a}").status_code == 403
    as_user(fake, "ann")
    gone = chat.delete(f"{E}/chat/m/{a}").json()
    assert gone["deleted"] and gone["text"] is None
    as_user(fake, "ed", 3)
    assert chat.delete(f"{E}/chat/m/{b}").json()["deleted"]
    assert [(x["deleted"], x["text"]) for x in chat.get(f"{E}/chat/c/1").json()] == [(True, None), (True, None)]
    as_user(fake, "ann")  # only editors take away the "Message deleted" line (#140)
    assert chat.delete(f"{E}/chat/m/{a}").status_code == 403
    as_user(fake, "ed", 3)
    assert chat.delete(f"{E}/chat/m/{a}").json() == {"id": a, "removed": True}
    assert [x["id"] for x in chat.get(f"{E}/chat/c/1").json()] == [b]
    assert chat.delete(f"{E}/chat/m/{a}").status_code == 404


def test_groups_editors_make_them_anyone_joins(fake, chat):
    as_user(fake, "ann")
    assert chat.post(f"{E}/chat/groups", json={"name": "Reunion"}).status_code == 403
    as_user(fake, "ed", 3)
    gid = chat.post(f"{E}/chat/groups", json={"name": " Reunion 2027 ", "emoji": "🎉", "members": ["ann"]}).json()["id"]
    chat.post(f"{E}/chat/c/{gid}", json={"text": "Book the hall?"})
    as_user(fake, "bob")
    g = conv(chat, gid)
    assert (g["name"], g["joined"], g["members"], g["last"]) == ("Reunion 2027", False, 2, None)
    assert chat.get(f"{E}/chat/c/{gid}").status_code == 403
    assert chat.post(f"{E}/chat/c/{gid}", json={"text": "hi"}).status_code == 403
    chat.post(f"{E}/chat/c/{gid}/join", json={"join": True})
    assert conv(chat, gid)["unread"] == 1 and len(chat.get(f"{E}/chat/c/{gid}").json()) == 1
    chat.post(f"{E}/chat/c/{gid}/join", json={"join": False})
    assert not conv(chat, gid)["joined"]
    assert chat.delete(f"{E}/chat/c/{gid}").status_code == 403
    as_user(fake, "ed", 3)
    assert chat.delete(f"{E}/chat/c/1").status_code == 400
    chat.delete(f"{E}/chat/c/{gid}")
    assert chat.get(f"{E}/chat/c/{gid}").status_code == 404


def test_private_messages_only_for_the_two(fake, chat):
    import main
    as_user(fake, "bob")
    chat.get(f"{E}/chat")  # (a login is known once it has opened the chat)
    as_user(fake, "ann")
    pid = chat.post(f"{E}/chat/private", json={"login": "bob"}).json()["id"]
    assert chat.post(f"{E}/chat/private", json={"login": "bob"}).json()["id"] == pid
    chat.post(f"{E}/chat/c/{pid}", json={"text": "psst"})
    as_user(fake, "cat", 3)  # not even an editor reads it
    assert chat.get(f"{E}/chat/c/{pid}").status_code == 404
    assert all(c["id"] != pid for c in chat.get(f"{E}/chat").json()["convs"])
    as_user(fake, "bob")
    assert conv(chat, pid)["other"] == "ann" and conv(chat, pid)["unread"] == 1
    me = fake.person("Bob")
    chat.put(f"{E}/auth/me/person", json={"person": me})  # found himself: others can write by person
    as_user(fake, "ann")
    assert chat.post(f"{E}/chat/private", json={"person": me}).json()["id"] == pid
    assert chat.get(f"{E}/chat").json()["people"] == {"bob": me}
    assert chat.post(f"{E}/chat/private", json={"person": "nobody"}).status_code == 404
    assert main.CHAT.path.exists()


def test_talk_about_a_person_and_merge_keeps_it(fake, chat):
    as_user(fake, "ann")
    p, dup = fake.person("George"), fake.person("George")
    assert chat.get(f"{E}/chat/person/{p}").json() == {"id": None, "count": 0, "messages": []}
    assert chat.post(f"{E}/chat/person/gone", json={"text": "hi"}).status_code == 404
    cid = chat.post(f"{E}/chat/person/{p}", json={"text": "Where was he born?"}).json()["id"]
    chat.post(f"{E}/chat/person/{dup}", json={"text": "Army papers?"})
    as_user(fake, "ed", 3)
    assert chat.get(f"{E}/chat/person/{p}").json()["count"] == 1
    assert conv(chat, cid)["unread"] == 1  # peeking in the panel isn't reading
    chat.post(f"{E}/tree/merge", json={"keep": p, "absorb": dup, "fields": {}})
    assert [m["text"] for m in chat.get(f"{E}/chat/c/{cid}").json()] == ["Where was he born?", "Army papers?"]
    assert [c["kind"] for c in chat.get(f"{E}/chat").json()["convs"]] == ["family", "person"]


def test_chat_says_so_when_the_data_folder_cant_be_written(fake, client, monkeypatch, tmp_path):
    import chat as chatmod
    import main
    (tmp_path / "file").write_text("")
    monkeypatch.setattr(main, "CHAT", chatmod.Chat(tmp_path / "file" / "chat.sqlite3"))
    r = client.get(f"{E}/chat")
    assert r.status_code == 503 and "data folder" in r.json()["detail"]


def test_daily_email_for_messages_waiting_a_day(fake, chat, monkeypatch):
    import time
    import main
    sent = []
    monkeypatch.setattr(main, "send_mail", lambda to, subject, body: sent.append((to, subject, body)))
    monkeypatch.setitem(main.EMAIL, "EMAIL_HOST", "")  # (no background task in tests)
    fake.email = "ann@example.com"
    as_user(fake, "ann")
    chat.get(f"{E}/chat")
    fake.email = None
    as_user(fake, "bob")
    chat.post(f"{E}/chat/c/1", json={"text": "Lunch on Sunday?"})
    now = time.time()
    assert main.send_waiting(now) == 0  # not a day old yet
    assert main.send_waiting(now + 90000) == 1
    to, subject, body = sent[0]
    assert to == "ann@example.com" and subject == "1 message is waiting for you in the family chat"
    assert "Whole family\n  bob: Lunch on Sunday?" in body and "☰ Menu → You" in body
    assert main.send_waiting(now + 90001) == 0  # at most one a day, and never the same message twice
    chat.post(f"{E}/chat/c/1", json={"text": "Bring photos"})
    assert main.send_waiting(now + 200000) == 1 and "Bring photos" in sent[1][2] and "Lunch" not in sent[1][2]
    as_user(fake, "ann")
    assert chat.put(f"{E}/auth/settings", json={"emails": False}).json() == {"emails": False}
    assert chat.put(f"{E}/auth/settings", json={"emails": "no"}).status_code == 400
    as_user(fake, "bob")
    chat.post(f"{E}/chat/c/1", json={"text": "Anyone?"})
    assert main.send_waiting(now + 400000) == 0  # switched off in the Menu


def fake_smtp(monkeypatch, offers_tls=True):
    """Like smtplib: the server's extensions are known only after EHLO; STARTTLS fails when not offered."""
    import main
    calls = []

    class FakeSMTP:
        def __init__(self, host, port, timeout):
            calls.append(("open", host, port))
            self.features = set()

        def __enter__(self):
            return self

        def __exit__(self, *a):
            calls.append(("close",))

        def ehlo(self):
            self.features = {"starttls"} if offers_tls else set()

        def has_extn(self, name):
            return name in self.features

        def starttls(self):
            if "starttls" not in self.features:
                raise main.smtplib.SMTPNotSupportedError("STARTTLS extension not supported by server.")
            calls.append(("starttls",))

        def login(self, user, password):
            calls.append(("login", user, password))

        def send_message(self, msg):
            calls.append(("send", msg["To"], msg["From"], msg["Subject"]))

    monkeypatch.setattr(main.smtplib, "SMTP", FakeSMTP)
    monkeypatch.setattr(main.smtplib, "SMTP_SSL", FakeSMTP)
    return calls


def test_send_mail_uses_the_email_settings(monkeypatch):
    import main
    calls = fake_smtp(monkeypatch)
    monkeypatch.setattr(main, "EMAIL", {"EMAIL_HOST": "smtp.example.com", "EMAIL_PORT": "587", "EMAIL_HOST_USER": "tree@example.com",
                                        "EMAIL_HOST_PASSWORD": "pw", "DEFAULT_FROM_EMAIL": ""})
    main.send_mail("ann@example.com", "Hi", "Body")
    assert calls == [("open", "smtp.example.com", 587), ("starttls",), ("login", "tree@example.com", "pw"),
                     ("send", "ann@example.com", "tree@example.com", "Hi"), ("close",)]


def test_the_email_password_never_goes_unencrypted(monkeypatch):  # #124
    import main
    calls = fake_smtp(monkeypatch, offers_tls=False)
    monkeypatch.setattr(main, "EMAIL", {"EMAIL_HOST": "smtp.example.com", "EMAIL_PORT": "587", "EMAIL_HOST_USER": "tree@example.com",
                                        "EMAIL_HOST_PASSWORD": "pw", "DEFAULT_FROM_EMAIL": ""})
    with pytest.raises(main.smtplib.SMTPNotSupportedError):
        main.send_mail("ann@example.com", "Hi", "Body")
    assert not [c for c in calls if c[0] == "login"]
    calls.clear()
    monkeypatch.setitem(main.EMAIL, "EMAIL_HOST_USER", "")  # a relay without a login (e.g. port 25 on the same machine): fine
    main.send_mail("ann@example.com", "Hi", "Body")
    assert [c[0] for c in calls] == ["open", "send", "close"]


def test_one_failed_email_doesnt_stop_the_others(fake, chat, monkeypatch):  # #121
    import time
    import main
    sent = []

    def send(to, subject, body):
        if to == "bad@example.com":
            raise main.smtplib.SMTPRecipientsRefused({to: (550, b"no such user")})
        sent.append(to)
    monkeypatch.setattr(main, "send_mail", send)
    monkeypatch.setitem(main.EMAIL, "EMAIL_HOST", "")
    for name in ("aa", "bb"):
        fake.email = "bad@example.com" if name == "aa" else f"{name}@example.com"
        as_user(fake, name)
        chat.get(f"{E}/chat")
    as_user(fake, "cc")
    chat.post(f"{E}/chat/c/1", json={"text": "Hello"})
    assert main.send_waiting(time.time() + 90000) == 1 and sent == ["bb@example.com"]


def test_logins_not_seen_for_a_month_get_no_email_and_arent_listed(fake, chat, monkeypatch):  # #122
    import time
    import chat as chatmod
    import main
    monkeypatch.setattr(main, "send_mail", lambda *a: None)
    monkeypatch.setitem(main.EMAIL, "EMAIL_HOST", "")
    fake.email = "ann@example.com"
    as_user(fake, "ann")
    chat.get(f"{E}/chat")
    main.CHAT.q("UPDATE users SET seen = ? WHERE login = 'ann'", time.time() - chatmod.ACTIVE - 1)  # e.g. disabled in Gramps Web
    as_user(fake, "bob")
    chat.post(f"{E}/chat/c/1", json={"text": "Hello"})
    assert main.send_waiting(time.time() + 90000) == 0
    assert chat.get(f"{E}/chat").json()["logins"] == ["bob"]


def test_email_settings_can_be_gramps_webs_own(monkeypatch):
    import importlib
    import main
    monkeypatch.setenv("GRAMPSWEB_EMAIL_HOST", "smtp.example.com")
    monkeypatch.setenv("GRAMPSWEB_EMAIL_HOST_USER", "tree@example.com")
    monkeypatch.setenv("EMAIL_PORT", "587")
    m = importlib.reload(main)
    try:
        assert (m.EMAIL["EMAIL_HOST"], m.EMAIL["EMAIL_HOST_USER"], m.EMAIL["EMAIL_PORT"]) == ("smtp.example.com", "tree@example.com", "587")
    finally:
        monkeypatch.undo()
        importlib.reload(main)


def test_talk_about_a_private_person_only_for_logins_that_see_private_records(fake, chat, monkeypatch):  # #123, #129
    import time
    import main
    sent = []
    monkeypatch.setattr(main, "send_mail", lambda to, subject, body: sent.append((to, body)))
    monkeypatch.setitem(main.EMAIL, "EMAIL_HOST", "")
    secret = fake.person("Hidden", "Person", private=True)
    for name, role in (("guest", 0), ("mem", 1)):
        fake.email = f"{name}@example.com"
        as_user(fake, name, role)
        chat.get(f"{E}/chat")
    as_user(fake, "ed", 3)
    cid = chat.post(f"{E}/chat/person/{secret}", json={"text": "Her letters are in the attic"}).json()["id"]
    as_user(fake, "guest", 0)
    assert all(c["id"] != cid for c in chat.get(f"{E}/chat").json()["convs"])
    assert chat.get(f"{E}/chat/c/{cid}").status_code == 404
    assert chat.get(f"{E}/chat/person/{secret}").status_code == 404
    assert chat.post(f"{E}/chat/c/{cid}", json={"text": "hi"}).status_code == 404
    assert chat.post(f"{E}/chat/person/{secret}", json={"text": "hi"}).status_code == 404  # Gramps hides them too
    as_user(fake, "mem", 1)
    assert any(c["id"] == cid for c in chat.get(f"{E}/chat").json()["convs"])
    main.send_waiting(time.time() + 90000)
    assert [to for to, _ in sent] == ["mem@example.com"] and "About Hidden Person" in sent[0][1]


def test_a_person_s_talk_follows_their_name(fake, chat):  # #131
    import main
    as_user(fake, "ann")
    p = fake.person("Jon", "Smith")
    cid = chat.post(f"{E}/chat/person/{p}", json={"text": "Army papers?"}).json()["id"]
    fake.get("people", p)["primary_name"]["first_name"] = "John"
    chat.post(f"{E}/chat/person/{p}", json={"text": "Found them"})
    assert main.CHAT.conv(cid)["name"] == "John Smith"


def test_several_writes_are_all_or_nothing(fake, chat):  # #128
    import sqlite3
    import main
    as_user(fake, "ed", 3)
    gid = chat.post(f"{E}/chat/groups", json={"name": "Reunion"}).json()["id"]
    with pytest.raises(sqlite3.Error):
        main.CHAT.tx(("DELETE FROM convs WHERE id = ?", gid), ("DELETE FROM nosuchtable",))
    assert main.CHAT.conv(gid)["name"] == "Reunion"


def device():
    """A browser's push subscription, with the key to read what's sent to it."""
    import os
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from py_vapid.utils import b64urlencode
    key, auth = ec.generate_private_key(ec.SECP256R1()), os.urandom(16)
    pub = key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    return key, auth, {"endpoint": f"https://fcm.googleapis.com/fcm/send/{os.urandom(4).hex()}",
                       "keys": {"p256dh": b64urlencode(pub), "auth": b64urlencode(auth)}}


def test_phone_notifications(fake, chat, monkeypatch, tmp_path):  # #133
    import asyncio
    import json
    import http_ece
    import httpx
    import main
    import push
    monkeypatch.setattr(main, "PUSH", push.Push(tmp_path / "push-key.pem"))
    assert chat.get(f"{E}/auth/me").json()["push_key"] is None  # http and no email address: nobody to contact
    monkeypatch.setattr(main, "APP_URL", "https://gramps.example.com/easy-gramps/")
    started = []
    monkeypatch.setattr(main, "notify", lambda *a: started.append(a))
    got = []
    monkeypatch.setattr(push, "TRANSPORT", httpx.MockTransport(
        lambda r: got.append(r) or httpx.Response(410 if "gone" in str(r.url) else 201)))
    as_user(fake, "ann")
    key = chat.get(f"{E}/auth/me").json()["push_key"]
    assert key == main.PUSH.public_key() and len(key) == 87
    k, auth, sub = device()
    for bad in ({**sub, "endpoint": "https://gramps.internal/x"}, {**sub, "endpoint": "http://fcm.googleapis.com/x"},
                {**sub, "keys": {"p256dh": "AAAA", "auth": "x"}}, {"endpoint": sub["endpoint"]}):
        assert chat.put(f"{E}/chat/push", json=bad).status_code == 400, bad
    assert chat.put(f"{E}/chat/push", json=sub).status_code == 200
    assert [push.push_address(u) for u in ("https://jmt17.google.com/fcm/send/x", "https://web.push.apple.com/x",
                                           "https://evilgoogle.com/x", "https://fcm.googleapis.com.evil.net/x", None)] == \
        [True, True, False, False, False]
    as_user(fake, "bob")
    m = chat.post(f"{E}/chat/c/1", json={"text": "Lunch on Sunday?"}).json()
    assert started == [(1, "bob", "Lunch on Sunday?")]
    asyncio.run(main.push_new(1, "bob", m["text"]))
    assert [str(r.url) for r in got] == [sub["endpoint"]]
    r = got[0]
    assert r.headers["content-encoding"] == "aes128gcm" and r.headers["authorization"].startswith("vapid t=")
    assert json.loads(http_ece.decrypt(r.content, private_key=k, auth_secret=auth, version="aes128gcm")) == \
        {"title": "Whole family", "body": "bob: Lunch on Sunday?", "conv": 1}
    got.clear()
    as_user(fake, "cat")
    chat.get(f"{E}/chat")
    as_user(fake, "bob")
    pid = chat.post(f"{E}/chat/private", json={"login": "cat"}).json()["id"]
    asyncio.run(main.push_new(pid, "bob", "psst"))
    assert not got  # a private message: only the two
    asyncio.run(main.push_new(1, "ann", "my own"))
    assert not got  # never to the writer
    _, _, gone = device()
    gone["endpoint"] += "gone"
    as_user(fake, "cat")
    chat.put(f"{E}/chat/push", json=gone)
    asyncio.run(main.push_new(1, "bob", "hi"))
    assert len(got) == 2 and [d["endpoint"] for d in main.CHAT.devices(1, "bob")] == [sub["endpoint"]]  # 410: forgotten
    as_user(fake, "ann")
    chat.request("DELETE", f"{E}/chat/push", json={"endpoint": sub["endpoint"]})
    assert main.CHAT.devices(1, "bob") == []


def test_owner_can_turn_off_talk_about_people(fake, chat):
    import main
    p = fake.person("George")
    as_user(fake, "bob")
    cid = chat.post(f"{E}/chat/person/{p}", json={"text": "before"}).json()["id"]  # written while it was on
    fake.role = 4
    main._who_cache.clear()
    assert chat.put(f"{E}/site", json={"talk": "no"}).status_code == 400
    assert chat.put(f"{E}/site", json={"talk": False}).json()["talk"] is False
    as_user(fake, "ann")
    assert chat.post(f"{E}/chat/person/{p}", json={"text": "hi"}).status_code == 403
    assert chat.get(f"{E}/auth/me").json()["site"]["talk"] is False
    d = chat.get(f"{E}/chat").json()
    assert all(c["kind"] != "person" for c in d["convs"]) and d["unread"] == 0  # not listed, not counted
    assert chat.post(f"{E}/chat/c/{cid}", json={"text": "hi"}).status_code == 403


def test_private_chats_off_means_none_either_way(fake, chat):
    as_user(fake, "ann")
    chat.get(f"{E}/chat")
    as_user(fake, "boss", 4)
    cid = chat.post(f"{E}/chat/private", json={"login": "ann"}).json()["id"]
    assert chat.post(f"{E}/chat/c/{cid}", json={"text": "hi"}).status_code == 200
    as_user(fake, "ann")
    assert chat.put(f"{E}/auth/settings", json={"dms": "no"}).status_code == 400
    assert chat.put(f"{E}/auth/settings", json={"dms": False}).json()["dms"] is False
    assert chat.get(f"{E}/chat").json()["nodms"] == ["ann"]
    assert conv(chat, cid)["closed"] == "me"
    assert [m["text"] for m in chat.get(f"{E}/chat/c/{cid}").json()] == ["hi"]  # old ones stay readable
    assert chat.post(f"{E}/chat/c/{cid}", json={"text": "bye"}).status_code == 403  # she can't write
    assert chat.post(f"{E}/chat/private", json={"login": "boss"}).json()["detail"].startswith("You've turned off")
    as_user(fake, "boss", 4)  # nor can anyone write to her, the owner too
    assert conv(chat, cid)["closed"] == "them"
    assert chat.post(f"{E}/chat/c/{cid}", json={"text": "hello?"}).status_code == 403
    assert chat.post(f"{E}/chat/private", json={"login": "ann"}).json()["detail"].startswith("They've turned off")
    assert chat.post(f"{E}/chat/c/1", json={"text": "family chat still works"}).status_code == 200
    as_user(fake, "ann")
    chat.put(f"{E}/auth/settings", json={"dms": True})
    assert conv(chat, cid)["closed"] is None and chat.post(f"{E}/chat/c/{cid}", json={"text": "back"}).status_code == 200


def test_family_tree_updates_are_theirs_only_and_read_only(fake, chat):
    import main
    as_user(fake, "ann")
    chat.put(f"{E}/auth/settings", json={"dms": False})  # updates still come
    cid, _ = main.CHAT.update("ann", "Thomas looked at your suggestions.", {"login": "tom", "name": "Thomas"})
    c = conv(chat, cid)
    assert (c["kind"], c["name"], c["unread"]) == ("updates", "Family tree updates", 1)
    [m] = chat.get(f"{E}/chat/c/{cid}").json()
    assert m["login"] == "" and m["ask"] == {"login": "tom", "name": "Thomas"} and not m["mine"]
    assert chat.post(f"{E}/chat/c/{cid}", json={"text": "why?"}).status_code == 403  # nobody writes back
    as_user(fake, "bob")
    assert all(x["id"] != cid for x in chat.get(f"{E}/chat").json()["convs"])
    assert chat.get(f"{E}/chat/c/{cid}").status_code == 404


def test_private_chat_needs_a_known_login(fake, chat):
    as_user(fake, "ann", 1)
    r = chat.post(f"{E}/chat/private", json={"login": "x" * 5000})
    assert r.status_code == 404 and chat.get(f"{E}/chat").json()["convs"] == [c for c in chat.get(f"{E}/chat").json()["convs"] if c["kind"] != "private"]


def test_daily_email_leaves_out_person_talk_when_it_is_off(fake, chat, monkeypatch):
    import time
    import main
    sent = []
    monkeypatch.setattr(main, "send_mail", lambda to, subject, body: sent.append(to))
    p = fake.person("Ravi")
    as_user(fake, "ann", 1)
    chat.get(f"{E}/chat")
    main.CHAT.q("UPDATE users SET email = 'ann@example.com' WHERE login = 'ann'")
    as_user(fake, "bob", 1)
    assert chat.post(f"{E}/chat/person/{p}", json={"text": "Who is this?"}).status_code == 200
    as_user(fake, "boss", 4)
    assert chat.put(f"{E}/site", json={"talk": False}).status_code == 200
    assert main.send_waiting(time.time() + 2 * 86400) == 0 and sent == []


def test_push_devices_are_limited_per_login(fake, chat):
    import main
    for i in range(main.chat.MAX_DEVICES + 3):
        main.CHAT.add_device("ann", f"https://x/{i}", {})
    rows = [r["endpoint"] for r in main.CHAT.q("SELECT endpoint FROM push WHERE login = 'ann' ORDER BY rowid")]
    assert len(rows) == main.chat.MAX_DEVICES and rows[-1] == f"https://x/{main.chat.MAX_DEVICES + 2}"


def test_earlier_messages_reach_past_the_newest_200(fake, chat):
    as_user(fake, "ann")
    ids = [chat.post(f"{E}/chat/c/1", json={"text": f"m{i}"}).json()["id"] for i in range(205)]
    as_user(fake, "bob")
    got = chat.get(f"{E}/chat/c/1").json()
    assert len(got) == 200 and got[0]["id"] == ids[5] and conv(chat, 1)["unread"] == 0
    old = chat.get(f"{E}/chat/c/1?before={got[0]['id']}").json()
    assert [m["text"] for m in old] == [f"m{i}" for i in range(5)]
    as_user(fake, "cat")  # an older batch alone doesn't mark the newest as read
    chat.get(f"{E}/chat/c/1?before={ids[5]}")
    assert conv(chat, 1)["unread"] == 205
