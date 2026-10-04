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


def login(client, pw):
    return client.post("/family/auth/login", json={"username": "a", "password": pw})


def test_login_limit_per_visitor(fake, client, monkeypatch):  # #4
    import main
    main._failed_logins.clear()
    for _ in range(3):
        assert login(client, "wrong").status_code == 401
    r = login(client, "right")
    assert r.status_code == 429 and "wait a minute" in r.json()["detail"]
    assert len(fake.sent("POST", "/token/")) == 3  # the blocked try never reached Gramps
    main._failed_logins.clear()
    assert login(client, "right").status_code == 200


def test_success_clears_failed_tries(fake, client):
    import main
    main._failed_logins.clear()
    login(client, "wrong"); login(client, "wrong")
    assert login(client, "right").status_code == 200
    assert login(client, "wrong").status_code == 401  # count started again


def test_hour_and_day_limits(fake, client, monkeypatch):
    import main
    main._failed_logins.clear()
    now = main.time.time()
    main._failed_logins["testclient"] = [now - 3000, now - 2000, now - 1000, now - 500, now - 120]
    assert "an hour" in login(client, "right").json()["detail"]
    main._failed_logins["testclient"] = [now - 80000 + i for i in range(7)]
    assert "tomorrow" in login(client, "right").json()["detail"]


def test_gramps_429_is_retried_once_then_too_many_tries(fake, client, monkeypatch):
    import main
    main._failed_logins.clear()
    real_sleep = main.asyncio.sleep
    monkeypatch.setattr(main.asyncio, "sleep", lambda s: real_sleep(0))
    fake.token_status = 429
    r = login(client, "right")
    assert r.status_code == 429 and "Too many tries" in r.json()["detail"]
    assert len(fake.sent("POST", "/token/")) == 2


def test_login_when_gramps_is_down_or_input_is_bad(fake, client):  # #23
    import main
    main._failed_logins.clear()
    fake.token_status = 503
    r = login(client, "right")
    assert r.status_code == 502 and "Can't reach" in r.json()["detail"]
    assert not main._failed_logins.get("testclient")  # not counted as a wrong password
    assert client.post("/family/auth/login", content=b"not json", headers={"Content-Type": "application/json"}).status_code == 400
    assert client.post("/family/auth/login", json=[1]).status_code == 400
