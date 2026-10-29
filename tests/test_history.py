"""History (1.9.4): changes made straight in the tree are logged (changes.py) and admins can undo them; sending a
suggestion again is harmless, changes to someone still waiting to be added go into adding them, links Gramps would
refuse are refused when suggested, and approving claims each row first. Also book pages (citations)."""
from test_chat import E, as_user
from test_suggest import turn_on


def history(client, **params):
    return client.get(f"{E}/suggestions/history", params=params).json()["items"]


def test_editor_changes_are_logged_and_admins_undo_them(fake, client):
    ravi = fake.person("Ravi", "Kumar", 1)
    as_user(fake, "ed", 3)
    patch = lambda **f: client.patch(f"{E}/tree/person/{ravi}", json=f).status_code  # noqa: E731
    assert patch(nick="Ravi ana") == 200 and patch(nick="Ravi anna") == 200  # within 10 minutes: one row
    [row] = history(client)
    assert (row["type"], row["by"], row["item"]["before"], row["item"]["value"]) == ("c", "ed", "", "Ravi anna")
    assert row["undo"] is False  # editors see it; only admins may undo it
    assert patch(nick="") == 200 and history(client) == []  # changed back: nothing changed after all
    assert patch(nick="Ravi anna") == 200
    cid = history(client)[0]["id"]
    assert client.post(f"{E}/changes/{cid}/undo").status_code == 403
    as_user(fake, "root", 5)
    assert history(client)[0]["undo"] is True
    assert client.post(f"{E}/changes/{cid}/undo").status_code == 200
    assert fake.get("people", ravi)["primary_name"].get("nick", "") == ""
    assert history(client)[0]["status"] == "undone" and client.post(f"{E}/changes/{cid}/undo").status_code == 404
    # changed again since (here: in Full Gramps): not undone
    as_user(fake, "ed", 3)
    assert patch(nick="Ravi anna") == 200
    fake.get("people", ravi)["primary_name"]["nick"] = "Something else"
    as_user(fake, "root", 5)
    assert client.post(f"{E}/changes/{history(client)[0]['id']}/undo").status_code == 409
    assert history(client, kind="editors") and history(client, kind="approved") == []


def test_links_are_logged_and_the_toast_undo_marks_them(fake, client):
    ravi = fake.person("Ravi", "Kumar", 1)
    as_user(fake, "ed", 3)
    res = client.post(f"{E}/tree/relative", json={"person": ravi, "rel": "father", "new": {"first": "Kumar"}}).json()
    [row] = history(client)
    assert row["item"]["op"] == "add" and row["item"]["label"] == "Kumar" and row["item"]["new"]
    assert client.post(f"{E}/tree/undo", json=res["undo"]).status_code == 200
    assert history(client)[0]["status"] == "undone"
    res = client.post(f"{E}/tree/relative", json={"person": ravi, "rel": "father", "new": {"first": "Appa"}}).json()
    as_user(fake, "root", 5)
    assert client.post(f"{E}/changes/{history(client)[0]['id']}/undo").status_code == 200
    assert "Appa" not in {p["primary_name"]["first_name"] for p in fake.db["people"].values()}


def test_sending_again_and_changes_to_someone_new(fake, client):
    ravi = fake.person("Ravi", "Kumar", 1)
    turn_on(fake, client)
    as_user(fake, "ann", 1)
    send = lambda *items: client.post(f"{E}/suggestions", json={"items": list(items)})  # noqa: E731
    dad = {"op": "add", "person": ravi, "rel": "father", "new": {"first": "Phili", "birth": {"y": 1960}}, "as": "new-dad00001", "fam": "new-fam00001"}
    nick = {"op": "set", "id": ravi, "field": "nick", "value": "Ravi anna"}
    assert send(dad).status_code == 200
    assert send(dad, nick).status_code == 200  # the first answer was lost: the father again, with the next change
    assert send({"op": "set", "id": "new-dad00001", "field": "birth", "value": {"y": 1970}}).status_code == 200
    assert send({"op": "set", "id": "new-dad00001", "field": "birthPlace", "value": {"new": "Kochi"}, "label": "Kochi"}).status_code == 200
    items = [x["item"] for x in client.get(f"{E}/suggestions").json()["items"]]
    assert [(x["op"], x.get("field")) for x in items] == [("add", None), ("set", "nick"), ("set", "birthPlace")]
    assert items[0]["new"]["birth"] == {"y": 1970}  # one row: "Add Phili, born 1970"
    # a second father for Ravi: refused now, not when an editor approves
    two = {**dad, "new": {"first": "Other"}, "as": "new-dad00002", "fam": "new-fam00002"}
    r = send(two)
    assert r.status_code == 400 and "already suggested a father" in r.json()["detail"]
    as_user(fake, "ed", 3)
    client.post(f"{E}/suggestions/decide", json={"approve": [x["id"] for x in client.get(f"{E}/suggestions").json()["items"]]})
    as_user(fake, "bob", 1)
    r = send({**dad, "new": {"first": "Again"}, "as": "new-dad00003", "fam": "new-fam00003"})
    assert r.status_code == 400 and "already has a father: Phili" in r.json()["detail"]


def test_old_duplicates_are_tidied_at_start(fake, client):
    import json
    import main
    import suggest
    ravi = fake.person("Ravi", "Kumar", 1)
    dad = {"op": "add", "person": ravi, "rel": "father", "new": {"first": "Phili"}, "as": "new-dad00001", "fam": "new-fam00001"}
    rows = [dad, dad, {"op": "set", "id": "new-dad00001", "field": "birth", "value": {"y": 1970}}]
    main.CHAT.q(suggest.SCHEMA)
    for it in rows:
        main.CHAT.q("INSERT INTO suggestions (batch, login, at, item) VALUES (1, 'ann', 0, ?)", json.dumps(it))
    main.CHAT._suggestions = False
    [left] = [json.loads(r["item"]) for r in suggest.q("SELECT item FROM suggestions")]
    assert left["new"] == {"first": "Phili", "birth": {"y": 1970}}


def test_approving_claims_each_row_and_tells_once(fake, client):
    import suggest
    ravi = fake.person("Ravi", "Kumar", 1)
    turn_on(fake, client)
    as_user(fake, "ann", 1)
    client.post(f"{E}/suggestions", json={"items": [{"op": "set", "id": ravi, "field": f, "value": "x"} for f in ("nick", "phone")]})
    as_user(fake, "ed", 3)
    a, b = [x["id"] for x in client.get(f"{E}/suggestions").json()["items"]]
    suggest.q("UPDATE suggestions SET status = 'working' WHERE id = ?", a)  # another Approve is busy with it
    assert client.post(f"{E}/suggestions/decide", json={"approve": [a], "quiet": True}).json()["approved"] == 0
    suggest.q("UPDATE suggestions SET status = 'waiting' WHERE id = ?", a)
    for k in (a, b):
        assert client.post(f"{E}/suggestions/decide", json={"approve": [k], "quiet": True}).json()["ids"] == [k]
    client.post(f"{E}/suggestions/tell", json={"approved": [a, b]})
    as_user(fake, "ann", 1)
    texts = [m["text"] for c in client.get(f"{E}/chat").json()["convs"] if c["kind"] == "private" for m in client.get(f"{E}/chat/c/{c['id']}").json()]
    assert len(texts) == 1 and texts[0].count("✓ Added") == 2


def test_book_pages(fake, client):
    ravi = fake.person("Ravi", "Kumar", 1)
    book = fake.add("media", _class="Media", mime="application/pdf", desc="Family book", path="book.pdf")
    photo = fake.add("media", _class="Media", mime="image/jpeg", desc="Photo")
    as_user(fake, "ed", 3)
    add = lambda **b: client.post(f"{E}/tree/person/{ravi}/books", json=b)  # noqa: E731
    assert add(media=photo, page="3").status_code == 400 and add(media=book, page="").status_code == 400
    c1, c2 = add(media=book, page="42").json()["id"], add(media=book, page="7").json()["id"]
    assert len(fake.db["sources"]) == 1  # one Source for the book, a Citation per page
    books = client.get(f"{E}/tree/details/{ravi}").json()["books"]
    assert [(b["title"], b["page"], b["media"]) for b in books] == [("Family book", "42", book), ("Family book", "7", book)] and books[0]["ticket"]
    assert client.post(f"{E}/tree/person/{ravi}/books/remove", json={"id": c1}).status_code == 200
    assert c1 not in fake.db["citations"] and fake.get("people", ravi)["citation_list"] == [c2]
    mark = lambda **b: client.post(f"{E}/tree/person/{ravi}/books/mark", json=b)  # noqa: E731
    assert mark(id=c2, page="8", area=[10, 20, 10.5, 30]).status_code == 400  # too small to be a paragraph
    assert mark(id=c2, page="8", area=[10, 20, 90, 35.25]).status_code == 200
    c3 = add(media=book, page="9", area=[-5, 0, 50, 10]).json()["id"]
    got = {b["id"]: (b["page"], b["area"]) for b in client.get(f"{E}/tree/details/{ravi}").json()["books"]}
    assert got == {c2: ("8", [10, 20, 90, 35.2]), c3: ("9", [0, 0, 50, 10])}
    assert mark(id=c2, page="8", area=None).status_code == 200 and not fake.get("citations", c2)["attribute_list"]
    as_user(fake, "ann", 1)
    assert add(media=book, page="1").status_code == 403 and mark(id=c3, page="9", area=None).status_code == 403
