"""Deleting a person (1.9.7): editors delete people they added, the owner and admins anyone; everyone else (and an
editor, for someone they didn't add) suggests it, and an editor other than the one who suggested it approves. Someone
with a login: only an admin, or they themselves. Suggesters delete their own waiting suggestions."""
import main as m
from test_chat import E, as_user
from test_history import history
from test_suggest import turn_on


def mode(client, h):
    return client.get(f"{E}/tree/person/{h}/delete").json()


def test_who_deletes_directly(fake, client):
    dad, mum, sis = fake.person("Raj", "Kumar", 1), fake.person("Uma", "Kumar", 0), fake.person("Asha", "Kumar", 0)
    oops = fake.person("Oops", "Kumar", 1)
    home = fake.family(dad, mum, [sis, oops])
    alone = fake.family(oops)  # a family with only them in it goes too
    as_user(fake, "kid", 1)
    assert mode(client, oops)["mode"] == "no"  # (suggestions are off)
    assert client.delete(f"{E}/tree/person/{oops}").status_code == 403

    as_user(fake, "ed", 3)  # not theirs: a suggestion
    assert mode(client, oops) == {"mode": "suggest", "why": "You didn't add them, so another editor checks it first."}
    assert client.delete(f"{E}/tree/person/{oops}").status_code == 403
    mine = client.post(f"{E}/tree/person", json={"first": "Mine", "last": "Kumar"}).json()["added"]
    assert mode(client, mine)["mode"] == "delete" and client.delete(f"{E}/tree/person/{mine}").status_code == 200

    as_user(fake, "boss", 4)  # the owner: anyone
    assert client.delete(f"{E}/tree/person/{oops}").status_code == 200
    assert fake.get("people", oops) is None and fake.get("families", alone) is None
    fam = fake.get("families", home)
    assert (fam["father_handle"], fam["mother_handle"], [c["ref"] for c in fam["child_ref_list"]]) == (dad, mum, [sis])
    assert [r["item"] for r in history(client)][:2] == [{"op": "delete", "id": oops, "label": "Oops Kumar"},
                                                        {"op": "delete", "id": mine, "label": "Mine Kumar"}]


def test_someone_with_a_login(fake, client):
    asha, ravi = fake.person("Asha", "Kumar", 0), fake.person("Ravi", "Kumar", 1)
    as_user(fake, "asha", 3)
    assert client.put(f"{E}/auth/me/person", json={"person": asha}).status_code == 200
    as_user(fake, "ravi", 1)
    assert client.put(f"{E}/auth/me/person", json={"person": ravi}).status_code == 200
    as_user(fake, "boss", 4)
    assert mode(client, asha) == {"mode": "suggest", "why": "asha has a login, so only an admin or they can approve this."}
    as_user(fake, "asha", 3)  # themselves, an editor
    assert mode(client, asha)["mode"] == "delete"
    as_user(fake, "root", 5)
    assert client.delete(f"{E}/tree/person/{ravi}").status_code == 200
    assert m.CHAT.one("SELECT 1 FROM settings WHERE person = ?", ravi) is None  # free to find themselves again


def test_suggested_deletions(fake, client):
    oops, asha = fake.person("Oops", "Kumar", 1), fake.person("Asha", "Kumar", 0)
    as_user(fake, "asha", 1)
    assert client.put(f"{E}/auth/me/person", json={"person": asha}).status_code == 200
    as_user(fake, "ed", 3)  # suggestions are off: editors still suggest deleting, and see the list
    send = lambda h, note="": client.post(f"{E}/suggestions", json={"items": [{"op": "delete", "id": h, "label": "x"}], "note": note})  # noqa: E731
    assert send(oops, "Added twice").status_code == 200 and send(oops).json()["count"] == 1  # (twice: one row)
    assert client.get(f"{E}/auth/me").json()["suggestions"] == 1
    assert client.post(f"{E}/suggestions", json={"items": [{"op": "set", "id": oops, "field": "nick", "value": "x"}]}).status_code == 403
    [row] = client.get(f"{E}/suggestions").json()["items"]
    assert row["note"] == "Added twice" and row["blocked"] == "You suggested this, so another editor approves it."
    r = client.post(f"{E}/suggestions/decide", json={"approve": [row["id"]]}).json()
    assert r["failed"][0]["error"] == row["blocked"] and fake.get("people", oops)

    turn_on(fake, client)
    as_user(fake, "kid", 1)  # a member suggests deleting someone with a login: only an admin (or Asha) approves
    assert send(asha).status_code == 200
    as_user(fake, "ed2", 3)
    rows = {x["item"]["id"]: x for x in client.get(f"{E}/suggestions").json()["items"]}
    assert "blocked" not in rows[oops] and rows[asha]["blocked"].startswith("asha has a login")
    r = client.post(f"{E}/suggestions/decide", json={"approve": [rows[oops]["id"], rows[asha]["id"]]}).json()
    assert r["approved"] == 1 and fake.get("people", oops) is None and fake.get("people", asha)
    as_user(fake, "ed", 3)
    text = m.CHAT.q("SELECT text FROM messages ORDER BY id DESC LIMIT 1")[0]["text"]
    assert "✓ Deleted: x" in text
    [done] = [x for x in history(client) if x["type"] == "s"]
    assert done["status"] == "approved" and done["undo"] is False  # no undo for a deletion


def test_suggesters_delete_their_own(fake, client):
    ravi = fake.person("Ravi", "Kumar", 1)
    turn_on(fake, client)
    as_user(fake, "ann", 1)
    items = [{"op": "add", "person": ravi, "rel": "father", "new": {"first": "Kumar"}, "as": "new-dad00001", "fam": "new-fam00001"},
             {"op": "set", "id": "new-dad00001", "field": "work", "value": "Farmer"},
             {"op": "set", "id": ravi, "field": "nick", "value": "Ravi anna"}]
    assert client.post(f"{E}/suggestions", json={"items": items}).status_code == 200
    ids = [x["id"] for x in client.get(f"{E}/suggestions").json()["items"]]
    assert len(ids) == 3
    as_user(fake, "bob", 1)
    assert client.delete(f"{E}/suggestions/{ids[0]}").status_code == 404  # not theirs
    as_user(fake, "ann", 1)
    assert client.delete(f"{E}/suggestions/{ids[0]}").json() == {"deleted": 2}  # the new father, with his work
    assert [x["item"]["field"] for x in client.get(f"{E}/suggestions").json()["items"]] == ["nick"]
