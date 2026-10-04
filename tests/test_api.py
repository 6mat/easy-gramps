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


def test_photo_upload_rights_type_and_size(fake, client):  # #20
    p = fake.person("Ann", "", 0)
    png = {"photo": ("a.png", b"\x89PNG....", "image/png")}
    fake.role = 1
    assert client.post(f"/family/tree/person/{p}/photo", files=png).status_code == 403
    fake.role = 3
    __import__("main")._who_cache.clear()
    assert client.post(f"/family/tree/person/{p}/photo", files={"photo": ("a.txt", b"hi", "text/plain")}).status_code == 400
    big = client.post(f"/family/tree/person/{p}/photo", content=b"x", headers={"content-length": str(30 * 1024 * 1024), "content-type": "multipart/form-data; boundary=x"})
    assert big.status_code == 413
    r = client.post(f"/family/tree/person/{p}/photo", files=png)
    assert r.status_code == 200 and fake.get("people", p)["media_list"][0]["ref"] == r.json()["photo"]


def test_photos_use_an_httponly_cookie_not_a_url_token(fake, client):  # #3
    from starlette.testclient import TestClient
    import main
    anon = TestClient(main.app)
    assert anon.get("/family/gapi/media/abc123/thumbnail/96?jwt=tok").status_code == 401  # ?jwt= is ignored
    r = client.post("/family/auth/session")
    cookie = r.headers["set-cookie"]
    assert "eg_photo=tok" in cookie and "HttpOnly" in cookie and "Path=/family/gapi/" in cookie and "SameSite=strict" in cookie
    anon.cookies.set("eg_photo", "tok", path="/family/gapi/")
    t = anon.get("/family/gapi/media/abc123/thumbnail/96?square=1")
    assert t.status_code == 200 and t.headers["cache-control"] == "max-age=60"
    assert "max-age=0" in client.delete("/family/auth/session").headers["set-cookie"] or "expires" in client.delete("/family/auth/session").headers["set-cookie"].lower()


def test_session_needs_a_valid_login(fake, client):
    from starlette.testclient import TestClient
    import main
    assert TestClient(main.app, headers={"Authorization": "Bearer bad"}).post("/family/auth/session").status_code == 401


def test_login_check_cache_is_hashed_and_bounded(fake, client, monkeypatch):  # #28
    import main
    main._who_cache.clear()
    client.get("/family/auth/me")
    assert "tok" not in main._who_cache and len(next(iter(main._who_cache))) == 64
    main._who_cache.update({f"old{i}": (0, {}) for i in range(600)})
    client.get("/family/auth/me", headers={"Authorization": "Bearer tok"})
    main._who_cache.pop(next(k for k in main._who_cache if not k.startswith("old")))
    client.get("/family/auth/me")
    assert len(main._who_cache) < 10


def test_responses_are_compressed_and_carry_security_headers(fake, client):  # #41, #1
    r = client.get("/family/", headers={"Accept-Encoding": "gzip"})
    assert r.headers["content-encoding"] == "gzip"
    assert "default-src 'self'" in r.headers["content-security-policy"] and r.headers["x-frame-options"] == "DENY"
    assert "googleapis" not in r.headers["content-security-policy"]


def test_tag_created_once_for_concurrent_first_edits(fake, client):  # #39
    import asyncio
    import gramps
    import main

    async def five():
        g = gramps.Gramps("http://gramps.test", "tok")
        return await asyncio.gather(*[main.tree_tags(g) for _ in range(5)])
    out = asyncio.run(five())
    assert len(fake.db["tags"]) == 1 and len({tuple(x) for x in out}) == 1
    client.post("/family/tree/person", json={"first": "A"}); client.post("/family/tree/person", json={"first": "B"})
    assert len(fake.sent("GET", "/tags/")) == 1


def test_me_says_who_may_see_private_details(fake, client):  # #25
    import main
    for role, private in ((0, False), (1, True), (3, True)):
        fake.role = role; main._who_cache.clear()
        assert client.get("/family/auth/me").json()["can_view_private"] is private
