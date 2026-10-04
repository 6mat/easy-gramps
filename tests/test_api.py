"""The app's HTTP endpoints (permissions, logins, errors), against the fake Gramps Web."""


def test_contributor_add_relative_refused_before_anything_is_created(fake, client):  # #15
    fake.role = 2
    kid = fake.person("Sam", "", 1)
    r = client.post("/family/tree/relative", json={"person": kid, "rel": "father", "new": {"first": "Tom"}})
    assert r.status_code == 403 and "Only editors" in r.json()["detail"]
    assert not fake.sent("POST", "/objects/") and len(fake.db["people"]) == 1


def test_contributor_can_still_add_a_person(fake, client):
    fake.role = 2
    r = client.post("/family/tree/person", json={"first": "New"})
    assert r.status_code == 200 and r.json()["added"] in fake.db["people"]


def test_editor_add_relative_works(fake, client):
    kid = fake.person("Sam", "", 1)
    r = client.post("/family/tree/relative", json={"person": kid, "rel": "father", "new": {"first": "Tom"}})
    assert r.status_code == 200 and r.json()["undo"]["op"] == "unlink"


def test_gramps_trouble_is_not_a_logout(fake, client):  # #16
    fake.fail[("GET", "/users/-/")] = 503
    r = client.get("/family/auth/me")
    assert r.status_code == 502 and "Can't reach" in r.json()["detail"]
    fake.fail[("POST", "/token/refresh/")] = 500
    assert client.post("/family/auth/refresh").status_code == 502


def test_bad_token_is_a_logout(fake, client):
    r = client.get("/family/auth/me", headers={"Authorization": "Bearer expired"})
    assert r.status_code == 401


def test_gramps_unreachable_is_502(fake, client, monkeypatch):
    import httpx
    import main

    def down(request):
        raise httpx.ConnectError("refused")
    monkeypatch.setattr(main, "upstream", httpx.AsyncClient(base_url="http://gramps.test/api", transport=httpx.MockTransport(down)))
    r = client.get("/family/auth/me")
    assert r.status_code == 502 and "Can't reach" in r.json()["detail"]
