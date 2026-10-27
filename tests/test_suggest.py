"""Suggestions (suggest.py): members suggest, editors approve or reject, against the fake Gramps Web."""
from test_chat import E, as_user


def turn_on(fake, client, who="members"):
    as_user(fake, "boss", 4)
    assert client.put(f"{E}/site", json={"suggest": who}).status_code == 200


def test_who_may_suggest(fake, client):
    p = fake.person("Ravi")
    item = [{"op": "set", "id": p, "field": "nick", "value": "Ravi anna"}]
    as_user(fake, "ann", 1)
    assert client.get(f"{E}/auth/me").json()["can_suggest"] is False
    assert client.post(f"{E}/suggestions", json={"items": item}).status_code == 403  # off by default
    turn_on(fake, client)
    assert "suggestions" in client.get(f"{E}/auth/me").json()  # editors see how many wait
    for role, ok in ((0, False), (1, True), (2, True), (3, False)):
        as_user(fake, "ann", role)
        assert client.get(f"{E}/auth/me").json()["can_suggest"] is ok
    turn_on(fake, client, "everyone")
    as_user(fake, "guest", 0)
    assert client.post(f"{E}/suggestions", json={"items": item}).status_code == 200
    assert client.put(f"{E}/site", json={"suggest": "all"}).status_code == 403  # (a guest isn't the owner)


def test_bad_suggestions_are_refused(fake, client):
    p = fake.person("Ravi")
    turn_on(fake, client)
    as_user(fake, "ann", 1)

    def send(*items):
        return client.post(f"{E}/suggestions", json={"items": list(items)}).status_code
    assert send({"op": "set", "id": p, "field": "role", "value": 4}) == 400  # not a field
    assert send({"op": "set", "id": "new-aaaaaaaa", "field": "nick", "value": "x"}) == 400  # a stand-in nobody made
    assert send({"op": "add", "person": p, "rel": "uncle", "new": {"first": "X"}, "as": "new-aaaaaaaa"}) == 400
    assert send({"op": "add", "person": p, "rel": "father", "new": {"first": "X"}}) == 400  # a new person needs a stand-in
    assert send({"op": "set", "id": "nosuchperson", "field": "nick", "value": "x"}) == 404
    assert send() == 400


def test_approve_some_and_reject_the_rest(fake, client):
    ravi = fake.person("Ravi", "Kumar", 1)
    turn_on(fake, client)
    as_user(fake, "ann", 1)
    items = [{"op": "add", "person": ravi, "rel": "father", "new": {"first": "Kumar"}, "as": "new-dad00001", "fam": "new-fam00001"},
             {"op": "set", "id": "new-dad00001", "field": "birth", "value": {"y": 1920}},
             {"op": "add", "person": ravi, "rel": "spouse", "new": {"first": "Meena"}, "as": "new-wife0001", "fam": "new-fam00002"},
             {"op": "add", "person": ravi, "rel": "child", "famId": "new-fam00002", "new": {"first": "Priya"}, "as": "new-kid00001"},
             {"op": "set", "id": ravi, "field": "nick", "value": "Ravi anna", "before": ""}]
    assert client.post(f"{E}/suggestions", json={"items": items, "note": "from the wedding card"}).json()["count"] == 5
    mine = client.get(f"{E}/suggestions").json()["items"]
    assert [x["item"]["op"] for x in mine] == ["add", "set", "add", "add", "set"] and mine[0]["note"] == "from the wedding card"
    assert client.post(f"{E}/suggestions/decide", json={"approve": [mine[0]["id"]]}).status_code == 403  # not an editor
    assert not fake.db["people"][ravi]["primary_name"].get("nick")

    as_user(fake, "ed", 3)
    ids = [x["id"] for x in client.get(f"{E}/suggestions").json()["items"]]
    # The new father, his birth and the nickname: yes. The wife: no, so her child can't go in either.
    r = client.post(f"{E}/suggestions/decide", json={"approve": [ids[0], ids[1], ids[3], ids[4]], "reject": [ids[2]]}).json()
    assert (r["approved"], r["rejected"]) == (3, 1) and [f["id"] for f in r["failed"]] == [ids[3]]
    names = {p["primary_name"]["first_name"] for p in fake.db["people"].values()}
    assert "Kumar" in names and "Meena" not in names and "Priya" not in names
    assert fake.db["people"][ravi]["primary_name"]["nick"] == "Ravi anna"
    dad = next(h for h, p in fake.db["people"].items() if p["primary_name"]["first_name"] == "Kumar")
    birth = fake.db["events"][fake.db["people"][dad]["event_ref_list"][0]["ref"]]
    assert birth["type"] == "Birth" and birth["date"]["dateval"][2] == 1920
    left = client.get(f"{E}/suggestions").json()
    assert [x["id"] for x in left["items"]] == [ids[3]] and left["items"][0]["error"] and left["made"]["new-dad00001"] == dad
    as_user(fake, "ann", 1)
    said = client.get(f"{E}/chat").json()["convs"]
    assert any(c["kind"] == "private" for c in said)  # "I looked at your suggestions: 3 added …, 1 not added"


def test_undo_puts_it_back_on_the_list(fake, client):
    ravi = fake.person("Ravi", "Kumar", 1)
    turn_on(fake, client)
    as_user(fake, "ann", 1)
    items = [{"op": "add", "person": ravi, "rel": "father", "new": {"first": "Kumar"}, "as": "new-dad00001", "fam": "new-fam00001"},
             {"op": "set", "id": "new-dad00001", "field": "nick", "value": "Appa"},
             {"op": "set", "id": ravi, "field": "nick", "value": "Ravi anna"},
             {"op": "set", "id": ravi, "field": "last", "value": "Kumaran"}]
    client.post(f"{E}/suggestions", json={"items": items})
    as_user(fake, "ed", 3)
    ids = [x["id"] for x in client.get(f"{E}/suggestions").json()["items"]]
    client.post(f"{E}/suggestions/decide", json={"approve": ids[:3], "reject": [ids[3]]})
    done = client.get(f"{E}/suggestions/history").json()["items"]
    assert {(x["id"], x["status"], x["undo"]) for x in done} == {(ids[0], "approved", True), (ids[1], "approved", True),
                                                                   (ids[2], "approved", True), (ids[3], "rejected", True)}

    def undo(k):
        return client.post(f"{E}/suggestions/{k}/undo")
    assert undo(ids[2]).status_code == 200 and not fake.db["people"][ravi]["primary_name"].get("nick")  # the old value again
    assert undo(ids[0]).status_code == 409  # his nickname (approved) needs him: that one first
    assert undo(ids[1]).status_code == 200 and undo(ids[0]).status_code == 200
    assert "Kumar" not in {p["primary_name"]["first_name"] for p in fake.db["people"].values()}  # the person it made is gone
    assert undo(ids[3]).status_code == 200 and undo(ids[3]).status_code == 404
    assert [x["id"] for x in client.get(f"{E}/suggestions").json()["items"]] == ids  # all waiting again
    assert client.get(f"{E}/suggestions/history").json()["items"] == []
