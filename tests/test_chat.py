"""Family chat (chat.py + the /chat routes), against the fake Gramps Web."""
import pytest

E = "/easy-gramps"


@pytest.fixture
def chat(fake, client, monkeypatch, tmp_path):
    import chat as chatmod
    import main
    monkeypatch.setattr(main, "CHAT", chatmod.Chat(tmp_path / "chat.sqlite3"))
    monkeypatch.setattr(main, "SETTINGS_FILE", tmp_path / "settings.json")
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
