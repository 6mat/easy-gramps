"""The app's HTTP endpoints (permissions, logins, errors), against the fake Gramps Web."""


def test_contributor_add_relative_refused_before_anything_is_created(fake, client):  # #15
    fake.role = 2
    kid = fake.person("Sam", "", 1)
    r = client.post("/easy-gramps/tree/relative", json={"person": kid, "rel": "father", "new": {"first": "Tom"}})
    assert r.status_code == 403 and "Only editors" in r.json()["detail"]
    assert not fake.sent("POST", "/objects/") and len(fake.db["people"]) == 1


def test_contributor_cant_change_details_and_nothing_is_left_behind(fake, client):  # #91
    kid = fake.person("Sam", "", 1)
    fake.role = 2
    r = client.patch(f"/easy-gramps/tree/person/{kid}", json={"birthPlace": {"new": "ZZTEST town"}, "notes": "hi"})
    assert r.status_code == 403 and "Only editors" in r.json()["detail"]
    assert not fake.sent("POST", "/objects/")


def test_contributor_can_still_add_a_person(fake, client):
    fake.role = 2
    r = client.post("/easy-gramps/tree/person", json={"first": "New"})
    assert r.status_code == 200 and r.json()["added"] in fake.db["people"]


def test_editor_add_relative_works(fake, client):
    kid = fake.person("Sam", "", 1)
    r = client.post("/easy-gramps/tree/relative", json={"person": kid, "rel": "father", "new": {"first": "Tom"}})
    assert r.status_code == 200 and r.json()["undo"]["op"] == "unlink"


def test_gramps_trouble_is_not_a_logout(fake, client):  # #16
    fake.fail[("GET", "/users/-/")] = 503
    r = client.get("/easy-gramps/auth/me")
    assert r.status_code == 502 and "Can't reach" in r.json()["detail"]
    fake.fail[("POST", "/token/refresh/")] = 500
    assert client.post("/easy-gramps/auth/refresh").status_code == 502


def test_bad_token_is_a_logout(fake, client):
    r = client.get("/easy-gramps/auth/me", headers={"Authorization": "Bearer expired"})
    assert r.status_code == 401


def test_gramps_unreachable_is_502(fake, client, monkeypatch):
    import httpx
    import main

    def down(request):
        raise httpx.ConnectError("refused")
    monkeypatch.setattr(main, "upstream", httpx.AsyncClient(base_url="http://gramps.test/api", transport=httpx.MockTransport(down)))
    r = client.get("/easy-gramps/auth/me")
    assert r.status_code == 502 and "Can't reach" in r.json()["detail"]


def login(client, pw, user="a"):
    return client.post("/easy-gramps/auth/login", json={"username": user, "password": pw})


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


def test_own_login_doesnt_reset_guesses_at_someone_else(fake, client):  # #92
    import main
    main._failed_logins.clear()
    login(client, "wrong", "victim"); login(client, "wrong", "victim")
    assert login(client, "right").status_code == 200  # the guesser's own account
    login(client, "wrong", "victim")
    assert login(client, "wrong", "victim").status_code == 429
    main._failed_logins.clear()


def test_a_wrong_try_after_the_visitor_was_forgotten_is_still_counted(fake, client, monkeypatch):  # #94
    import main
    main._failed_logins.clear()
    monkeypatch.setattr(main, "login_blocked", lambda ip: main._failed_logins.clear())  # e.g. a success in between
    assert login(client, "wrong").status_code == 401
    assert len(main._failed_logins["testclient"]) == 1
    main._failed_logins.clear()


def test_hour_and_day_limits(fake, client, monkeypatch):
    import main
    main._failed_logins.clear()
    now = main.time.time()
    main._failed_logins["testclient"] = [(t, "a") for t in (now - 3000, now - 2000, now - 1000, now - 500, now - 120)]
    assert "an hour" in login(client, "right").json()["detail"]
    main._failed_logins["testclient"] = [(now - 80000 + i, "a") for i in range(7)]
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
    assert client.post("/easy-gramps/auth/login", content=b"not json", headers={"Content-Type": "application/json"}).status_code == 400
    assert client.post("/easy-gramps/auth/login", json=[1]).status_code == 400


def test_photo_upload_rights_type_and_size(fake, client):  # #20
    p = fake.person("Ann", "", 0)
    png = {"photo": ("a.png", b"\x89PNG....", "image/png")}
    fake.role = 1
    assert client.post(f"/easy-gramps/tree/person/{p}/photo", files=png).status_code == 403
    fake.role = 3
    __import__("main")._who_cache.clear()
    assert client.post(f"/easy-gramps/tree/person/{p}/photo", files={"photo": ("a.txt", b"hi", "text/plain")}).status_code == 400
    big = client.post(f"/easy-gramps/tree/person/{p}/photo", content=b"x", headers={"content-length": str(30 * 1024 * 1024), "content-type": "multipart/form-data; boundary=x"})
    assert big.status_code == 413
    r = client.post(f"/easy-gramps/tree/person/{p}/photo", files=png)
    assert r.status_code == 200 and fake.get("people", p)["media_list"][0]["ref"] == r.json()["photo"]


def test_photos_use_an_httponly_cookie_not_a_url_token(fake, client):  # #3
    from starlette.testclient import TestClient
    import main
    anon = TestClient(main.app)
    assert anon.get("/easy-gramps/gapi/media/abc123/thumbnail/96?jwt=tok").status_code == 401  # ?jwt= is ignored
    r = client.post("/easy-gramps/auth/session")
    cookie = r.headers["set-cookie"]
    assert "eg_photo=tok" in cookie and "HttpOnly" in cookie and "Path=/easy-gramps/gapi/" in cookie and "SameSite=strict" in cookie
    anon.cookies.set("eg_photo", "tok", path="/easy-gramps/gapi/")
    t = anon.get("/easy-gramps/gapi/media/abc123/thumbnail/96?square=1")
    assert t.status_code == 200 and t.headers["cache-control"] == "max-age=60"
    assert "max-age=0" in client.delete("/easy-gramps/auth/session").headers["set-cookie"] or "expires" in client.delete("/easy-gramps/auth/session").headers["set-cookie"].lower()


def test_thumbnails_are_only_served_as_pictures(fake, client):  # #9
    from starlette.testclient import TestClient
    import main
    anon = TestClient(main.app)
    anon.cookies.set("eg_photo", "tok", path="/easy-gramps/gapi/")
    assert anon.get("/easy-gramps/gapi/media/abc123/thumbnail/96").headers["content-type"] == "image/png"
    for bad in ("text/html; charset=utf-8", "image/svg+xml", ""):
        fake.thumb_type = bad
        r = anon.get("/easy-gramps/gapi/media/abc123/thumbnail/96")
        assert r.headers["content-type"] == "application/octet-stream", bad
        assert "default-src 'self'" in r.headers["content-security-policy"]


def test_session_needs_a_valid_login(fake, client):
    from starlette.testclient import TestClient
    import main
    assert TestClient(main.app, headers={"Authorization": "Bearer bad"}).post("/easy-gramps/auth/session").status_code == 401


def test_login_check_cache_is_hashed_and_bounded(fake, client, monkeypatch):  # #28
    import main
    main._who_cache.clear()
    client.get("/easy-gramps/auth/me")
    assert "tok" not in main._who_cache and len(next(iter(main._who_cache))) == 64
    main._who_cache.update({f"old{i}": (0, {}) for i in range(600)})
    client.get("/easy-gramps/auth/me", headers={"Authorization": "Bearer tok"})
    main._who_cache.pop(next(k for k in main._who_cache if not k.startswith("old")))
    client.get("/easy-gramps/auth/me")
    assert len(main._who_cache) < 10


def test_responses_are_compressed_and_carry_security_headers(fake, client):  # #41, #1
    r = client.get("/easy-gramps/", headers={"Accept-Encoding": "gzip"})
    assert r.headers["content-encoding"] == "gzip"
    assert "default-src 'self'" in r.headers["content-security-policy"] and r.headers["x-frame-options"] == "DENY"
    assert "googleapis" not in r.headers["content-security-policy"]


def test_page_links_to_source_code(fake, client):
    import main
    assert f'id="menu-source" href="{main.SOURCE_URL}"' in client.get("/easy-gramps/").text
    assert "__SOURCE__" not in client.get("/easy-gramps/").text


def test_tag_created_once_for_concurrent_first_edits(fake, client):  # #39
    import asyncio
    import gramps
    import main

    async def five():
        g = gramps.Gramps("http://gramps.test", "tok")
        return await asyncio.gather(*[main.tree_tags(g) for _ in range(5)])
    out = asyncio.run(five())
    assert len(fake.db["tags"]) == 1 and len({tuple(x) for x in out}) == 1
    client.post("/easy-gramps/tree/person", json={"first": "A"}); client.post("/easy-gramps/tree/person", json={"first": "B"})
    assert len(fake.sent("GET", "/tags/")) == 1


def test_me_says_who_may_see_private_details(fake, client):  # #25
    import main
    for role, private in ((0, False), (1, True), (3, True)):
        fake.role = role; main._who_cache.clear()
        assert client.get("/easy-gramps/auth/me").json()["can_view_private"] is private


def test_errors_are_plain_and_bad_input_is_400(fake, client):  # #27
    r = client.get("/easy-gramps/tree/details/nosuchperson")
    assert r.status_code == 404 and r.json()["detail"] == "That person or family isn't in the tree any more."
    assert client.post("/easy-gramps/tree/relative", content=b"not json", headers={"Content-Type": "application/json"}).status_code == 400
    assert client.post("/easy-gramps/tree/undo", json=None).status_code == 400
    assert client.patch("/easy-gramps/tree/person/x", json=[1]).status_code == 400
    fake.fail[("PUT", "/people/")] = 422
    p = fake.person("Ann", "", 0)
    r = client.patch(f"/easy-gramps/tree/person/{p}", json={"first": "A"})
    assert r.status_code == 502 and "Gramps said" not in r.json()["detail"]


def test_delete_checks_the_answer(fake, g):  # #27
    from conftest import run
    import gramps
    p = fake.person("Ann", "", 0)
    run(g.delete(f"/people/{p}")); run(g.delete(f"/people/{p}"))  # gone already: fine
    fake.role = 2
    q = fake.person("Bob", "", 1)
    try:
        run(g.delete(f"/people/{q}"))
        raise AssertionError("should raise")
    except gramps.GrampsError as e:
        assert e.status == 403


def test_debug_log_only_when_switched_on(fake, client, monkeypatch, tmp_path):
    import main
    assert client.post("/easy-gramps/debug/log", json={"a": 1}).status_code == 404
    monkeypatch.setattr(main, "DEBUG_LOG_ON", True)
    monkeypatch.setattr(main, "DATA", tmp_path); monkeypatch.setattr(main, "DEBUG_LOG", tmp_path / "debug.log")
    assert client.post("/easy-gramps/debug/log", json={"a": 1}).status_code == 200
    assert '"a": 1' in (tmp_path / "debug.log").read_text()


def test_login_options_follow_gramps_web(fake, client):  # shared login, pick 2a
    from starlette.testclient import TestClient
    import main
    anon = TestClient(main.app)  # asked before anyone is logged in
    assert anon.get("/easy-gramps/auth/options").json() == {"password": True, "providers": []}
    fake.oidc = {"enabled": True, "disable_local_auth": True, "providers": [{"id": "google", "name": "Google", "extra": 1}]}
    main._login_options.update(until=0)
    assert anon.get("/easy-gramps/auth/options").json() == {"password": False, "providers": [{"id": "google", "name": "Google"}]}
    fake.oidc = {"enabled": True}
    assert anon.get("/easy-gramps/auth/options").json()["password"] is False  # kept for a few minutes
    fake.fail[("GET", "/oidc/")] = 500
    main._login_options.update(until=0)
    assert anon.get("/easy-gramps/auth/options").json()["password"] is False  # Gramps trouble: keep what we knew


def test_account_gramps_refuses_is_not_a_logout(fake, client):  # shared login: don't log them out of Gramps Web
    fake.me_status = 403
    r = client.get("/easy-gramps/auth/me")
    assert r.status_code == 403 and "owner" in r.json()["detail"]
    fake.me_status, fake.role = 200, -1
    assert client.get("/easy-gramps/auth/me").status_code == 403


def test_page_knows_where_gramps_web_is(fake, client):  # same site → shared login, pick 5a
    assert 'data-gramps="http://gramps.test"' in client.get("/easy-gramps/").text


def test_installable_as_an_app(fake, client):  # home-screen app: manifest, icons, service worker
    import io
    from PIL import Image
    m = client.get("/easy-gramps/manifest.webmanifest")
    assert m.headers["content-type"].startswith("application/manifest+json")
    j = m.json()
    assert (j["id"], j["start_url"], j["scope"], j["display"], j["name"]) == ("/easy-gramps/", "/easy-gramps/", "/easy-gramps/", "standalone", "Family Tree")
    assert {(i["sizes"], i["purpose"]) for i in j["icons"]} == {("192x192", "any"), ("512x512", "any"), ("192x192", "maskable"), ("512x512", "maskable")}
    for i in j["icons"]:
        r = client.get(i["src"])
        assert r.headers["content-type"] == "image/png"
        assert Image.open(io.BytesIO(r.content)).size == tuple(map(int, i["sizes"].split("x")))
    assert client.get("/easy-gramps/icon-77.png").status_code == 404
    sw = client.get("/easy-gramps/sw.js")
    assert sw.headers["content-type"].startswith("text/javascript") and "No internet" in sw.text
    page = client.get("/easy-gramps/").text
    assert 'rel="manifest" href="/easy-gramps/manifest.webmanifest"' in page and "__ICONV__" not in page


def test_own_icon_picture_replaces_every_icon(fake, client, monkeypatch, tmp_path):  # ICON_FILE
    import io
    from PIL import Image
    import main
    before = client.get("/easy-gramps/manifest.webmanifest").json()["icons"][0]["src"]
    pic = tmp_path / "mine.png"
    Image.new("RGB", (900, 600), (200, 30, 30)).save(pic)  # not square: the middle is used
    monkeypatch.setattr(main, "ICON_FILE", pic)
    after = client.get("/easy-gramps/manifest.webmanifest").json()["icons"][0]["src"]
    assert after != before  # a new address, so installed phones fetch the new picture
    im = Image.open(io.BytesIO(client.get(after).content)).convert("RGB")
    assert im.size == (192, 192) and im.getpixel((96, 96)) == (200, 30, 30)
    assert f"icon-180.png?v={after.split('v=')[1]}" in client.get("/easy-gramps/").text


def test_no_tag_unless_one_is_set(fake, client, monkeypatch):
    import main
    monkeypatch.setattr(main, "TREE_TAG", "")
    client.post("/easy-gramps/tree/person", json={"first": "A", "birth": {"y": 1950}})
    assert not fake.db["tags"] and fake.sent("POST", "/objects/")
    assert all(not x.get("tag_list") for kind in ("people", "events") for x in fake.db[kind].values())


def test_date_format_is_kept_with_the_login(fake, client):
    import main
    assert client.get("/easy-gramps/auth/me").json()["settings"] == {}
    assert client.put("/easy-gramps/auth/settings", json={"dates": "m/d/y"}).json() == {"dates": "m/d/y"}
    assert client.get("/easy-gramps/auth/me").json()["settings"] == {"dates": "m/d/y"}
    assert client.put("/easy-gramps/auth/settings", json={"dates": "<b>"}).status_code == 400
    assert client.put("/easy-gramps/auth/settings", json={"dates": "y-m-d"}, headers={"Authorization": "Bearer bad"}).status_code == 401
    assert main.CHAT.settings("tester") == {"dates": "m/d/y"}


def test_more_photos_main_and_remove(fake, client):  # owner's picks 2b 2d
    p = fake.person("A")
    png = {"photo": ("a.png", b"\x89PNG....", "image/png")}
    first = client.post(f"/easy-gramps/tree/person/{p}/photo", files=png).json()["photo"]
    more = client.post(f"/easy-gramps/tree/person/{p}/photo", files=png, data={"main": "0"}).json()
    assert more["photo"] == first and more["added"] != first
    doc = fake.add("media", _class="Media", mime="application/pdf")  # not a picture: not in photos
    fake.get("people", p)["media_list"].append({"_class": "MediaRef", "ref": doc})
    assert client.get("/easy-gramps/tree/graph").json()["people"][p]["photos"] == [first, more["added"]]
    assert client.post(f"/easy-gramps/tree/person/{p}/photos", json={"media": more["added"], "do": "main"}).json() == {"photo": more["added"]}
    assert client.post(f"/easy-gramps/tree/person/{p}/photos", json={"media": more["added"], "do": "remove"}).json() == {"photo": first}
    assert more["added"] in fake.db["media"]  # only taken off the person, never deleted
    assert client.post(f"/easy-gramps/tree/person/{p}/photos", json={"media": "gone", "do": "main"}).status_code == 404
    assert client.post(f"/easy-gramps/tree/person/{p}/photos", json={"media": first, "do": "delete"}).status_code == 400
    fake.role = 2
    import main
    main._who_cache.clear()
    assert client.post(f"/easy-gramps/tree/person/{p}/photos", json={"media": first, "do": "remove"}).status_code == 403


def test_settings_say_so_when_the_data_folder_cant_be_written(fake, client, monkeypatch, tmp_path):
    import chat
    import main
    (tmp_path / "file").write_text("")
    monkeypatch.setattr(main, "CHAT", chat.Chat(tmp_path / "file" / "chat.sqlite3"))  # a folder that can't exist
    r = client.put("/easy-gramps/auth/settings", json={"dates": "m/d/y"})
    assert r.status_code == 503 and "data folder" in r.json()["detail"]


def as_user(fake, name, role=None):
    import main
    fake.user = name
    if role is not None:
        fake.role = role
    main._who_cache.clear()


def test_find_me_links_one_login_to_one_person(fake, client):  # owner's picks: automatic, editors can undo
    me, other = fake.person("Ann"), fake.person("Bob")
    as_user(fake, "ann", 1)  # a Member can link themselves
    assert client.put("/easy-gramps/auth/me/person", json={"person": me}).json() == {"person": me}
    assert client.get("/easy-gramps/auth/me").json()["settings"] == {"person": me}
    assert client.put("/easy-gramps/auth/me/person", json={"person": "gone"}).status_code == 404
    assert client.put("/easy-gramps/auth/me/person", json={"person": "../x"}).status_code == 400
    as_user(fake, "bob")
    r = client.put("/easy-gramps/auth/me/person", json={"person": me})
    assert r.status_code == 409 and r.json()["detail"] == __import__("chat").TAKEN  # one login per person
    assert client.put("/easy-gramps/auth/me/person", json={"person": other}).status_code == 200
    assert client.put("/easy-gramps/auth/me/person", json={"person": me}).status_code == 409
    as_user(fake, "ann", 1)
    assert client.get("/easy-gramps/tree/logins").json() == {me: "", other: ""}  # not the login names
    assert client.delete(f"/easy-gramps/tree/logins/{other}").status_code == 403
    assert client.delete("/easy-gramps/auth/me/person").json() == {}
    as_user(fake, "ed", 3)
    assert client.get("/easy-gramps/tree/logins").json() == {other: "bob"}
    assert client.delete(f"/easy-gramps/tree/logins/{other}").json() == {"unlinked": "bob"}
    assert client.get("/easy-gramps/tree/logins").json() == {}


def test_a_merged_away_person_takes_its_login_along(fake, client):
    import main
    keep, dup = fake.person("Ann", "Lee", 0), fake.person("Anne", "Lee", 0)
    as_user(fake, "ann")
    client.put("/easy-gramps/auth/me/person", json={"person": dup})
    assert client.post("/easy-gramps/tree/merge", json={"keep": keep, "absorb": dup, "fields": {}}).status_code == 200
    assert main.CHAT.settings("ann")["person"] == keep


def test_phone_and_email_only_for_editors(fake, client):  # #135
    p = fake.person("Sam", "", 1, urls=[{"_class": "Url", "private": True, "path": "mailto:sam@example.com", "type": "E-mail"}],
                    address_list=[{"_class": "Address", "private": True, "city": "Town", "phone": "123"}])
    d = client.get(f"/easy-gramps/tree/details/{p}").json()
    assert (d["email"], d["phone"], d["residence"]) == ("sam@example.com", "123", "Town") and "contactHidden" not in d
    fake.role = 1
    import main
    main._who_cache.clear()
    d = client.get(f"/easy-gramps/tree/details/{p}").json()
    assert (d["email"], d["phone"], d["residence"], d["contactHidden"]) == ("", "", "Town", True)


def test_invite_gives_the_role_and_person_once_they_sign_in(fake, client):  # #143
    import main
    p = fake.person("Asha", "", 1)
    assert client.post("/easy-gramps/invites", json={"email": "Asha@Example.com", "person": p, "role": 1}).status_code == 403  # editors can't
    fake.role = 4
    main._who_cache.clear()
    assert client.post("/easy-gramps/invites", json={"email": "nope", "person": p, "role": 1}).status_code == 400
    assert client.post("/easy-gramps/invites", json={"email": "a@example.com", "person": p, "role": 4}).status_code == 400  # not owner
    assert client.post("/easy-gramps/invites", json={"email": " Asha@Example.com ", "person": p, "role": 1}).json()["email"] == "asha@example.com"
    assert client.get("/easy-gramps/auth/me").json()["joined"] == []  # not signed in yet
    fake.users = [{"name": "google_asha@example.com", "email": "asha@example.com", "full_name": "Asha", "role": -1},
                  {"name": "google_x", "email": "x@example.com", "full_name": "X", "role": -1}]  # x wasn't invited
    assert client.get("/easy-gramps/auth/me").json()["joined"] == [{"name": "Asha", "person": p, "role": 1}]
    assert [u["role"] for u in fake.users] == [1, -1]
    assert main.CHAT.linked() == {"google_asha@example.com": p}
    assert client.get("/easy-gramps/invites").json() == [] and client.get("/easy-gramps/auth/me").json()["joined"] == []
    fake.fail[("GET", "/users/")] = 500  # Gramps trouble doesn't stop the page
    client.post("/easy-gramps/invites", json={"email": "b@example.com", "person": p, "role": 0})
    assert client.get("/easy-gramps/auth/me").json()["joined"] == []


def test_site_settings_owner_only(fake, client):  # #145
    import io

    import main
    from PIL import Image
    assert client.put("/easy-gramps/site", json={"name": "Ours"}).status_code == 403  # an editor
    me = client.get("/easy-gramps/auth/me").json()
    assert me["site"] == {"name": "Family Tree", "hide": [], "gramps": "everyone"} and me["gramps_link"]
    fake.role = 4
    main._who_cache.clear()
    for bad in ({"name": "  "}, {"name": "x" * 41}, {"hide": ["logout"]}, {"hide": "theme"}, {"gramps": "admins"}):
        assert client.put("/easy-gramps/site", json=bad).status_code == 400, bad
    s = client.put("/easy-gramps/site", json={"name": " The  <Kumar> Family ", "hide": ["source", "theme"], "gramps": "owner"}).json()
    assert s == {"name": "The <Kumar> Family", "hide": ["theme", "source"], "gramps": "owner"}
    page = client.get("/easy-gramps/").text
    assert "<title>The &lt;Kumar&gt; Family</title>" in page and "__NAME__" not in page
    assert client.get("/easy-gramps/manifest.webmanifest").json()["name"] == "The <Kumar> Family"
    assert client.get("/easy-gramps/auth/me").json()["gramps_link"]  # the owner still gets it
    fake.role = 3
    main._who_cache.clear()
    assert "gramps_link" not in client.get("/easy-gramps/auth/me").json()  # editors don't, now
    fake.role = 4
    main._who_cache.clear()
    before = client.get("/easy-gramps/manifest.webmanifest").json()["icons"][0]["src"]
    assert client.put("/easy-gramps/site/icon", content=b"not a picture").status_code == 400
    buf = io.BytesIO()
    Image.new("RGB", (300, 200), "red").save(buf, "JPEG")
    assert client.put("/easy-gramps/site/icon", content=buf.getvalue()).status_code == 200
    with Image.open(io.BytesIO(client.get("/easy-gramps/icon-192.png").content)) as im:
        assert im.size == (192, 192) and im.getpixel((96, 96))[0] > 200  # the red picture, square
    assert client.get("/easy-gramps/manifest.webmanifest").json()["icons"][0]["src"] != before
    client.delete("/easy-gramps/site/icon")
    assert client.get("/easy-gramps/manifest.webmanifest").json()["icons"][0]["src"] == before


def test_invite_sent_by_email(fake, client, monkeypatch):  # #147
    import main
    sent = []
    monkeypatch.setattr(main, "send_mail", lambda *a: sent.append(a))
    fake.role, fake.email = 4, "owner@example.com"
    main._who_cache.clear()
    p = fake.person("Asha", "", 1)
    assert client.post("/easy-gramps/invites/send", json={"email": "asha@example.com"}).status_code == 400  # no EMAIL_HOST
    monkeypatch.setitem(main.EMAIL, "EMAIL_HOST", "smtp.example.com")
    assert client.post("/easy-gramps/invites/send", json={"email": "asha@example.com"}).status_code == 400  # not invited
    client.post("/easy-gramps/invites", json={"email": "asha@example.com", "person": p, "role": 1})
    assert client.post("/easy-gramps/invites/send", json={"email": "Asha@example.com ", "name": "Asha"}).json() == {"sent": "asha@example.com"}
    (to, subject, text, reply_to), = sent
    assert (to, subject, reply_to) == ("asha@example.com", "You're invited to Family Tree", "owner@example.com")
    assert text.startswith("Hi Asha,") and "/easy-gramps/" in text and "(asha@example.com)" in text
    fake.role = 3
    main._who_cache.clear()
    assert client.post("/easy-gramps/invites/send", json={"email": "asha@example.com"}).status_code == 403


def test_someone_new_keeps_their_nickname(fake, client):  # #149
    kid = fake.person("Sam", "", 1)
    r = client.post("/easy-gramps/tree/relative", json={"person": kid, "rel": "father", "new": {"first": "Ravi", "nick": " Chinnu "}})
    dad = next(p for h, p in fake.db["people"].items() if h != kid)
    assert r.status_code == 200 and dad["primary_name"]["nick"] == "Chinnu"
    h = client.post("/easy-gramps/tree/person", json={"first": "Asha", "nick": "Ammu"}).json()["added"]
    assert fake.db["people"][h]["primary_name"]["nick"] == "Ammu"
    assert {p["nick"] for p in client.get("/easy-gramps/tree/graph").json()["people"].values()} >= {"Chinnu", "Ammu"}
