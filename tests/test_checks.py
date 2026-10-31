"""Check the tree (☰ Menu): the owner opens it, editors too when an admin says so; "Not the same person" is kept for
everyone. The checks themselves run in the page (tests/checks.test.mjs)."""
from test_chat import E, as_user

DUPES = {"year": True, "kin": False, "place": True, "level": "loose", "same": "Lakshmi = Laxmi"}


def test_who_checks_and_not_the_same(fake, client):
    as_user(fake, "ed", 3)
    assert client.get(f"{E}/auth/me").json()["can_check"] is False
    assert client.get(f"{E}/checks/notsame").status_code == 403
    as_user(fake, "own", 4)
    assert client.get(f"{E}/auth/me").json()["can_check"] is True
    assert client.put(f"{E}/site", json={"checks": "editors"}).status_code == 403  # admins only
    assert client.post(f"{E}/checks/notsame", json={"a": "p2", "b": "p1"}).json() == {"ok": True}
    assert client.post(f"{E}/checks/notsame", json={"a": "p1", "b": "p2"}).json() == {"ok": True}  # (once)
    assert client.post(f"{E}/checks/notsame", json={"a": "p1", "b": "p1"}).status_code == 400

    as_user(fake, "root", 5)
    for bad in ({"checks": "everyone"}, {"dupes": {**DUPES, "level": "wild"}}, {"dupes": {**DUPES, "year": "yes"}}):
        assert client.put(f"{E}/site", json=bad).status_code == 400, bad
    site = client.put(f"{E}/site", json={"checks": "editors", "dupes": DUPES}).json()
    assert site["checks"] == "editors" and site["dupes"] == DUPES
    as_user(fake, "ed", 3)
    assert client.get(f"{E}/auth/me").json()["can_check"] is True
    assert client.get(f"{E}/checks/notsame").json() == [["p1", "p2"]]
    as_user(fake, "kid", 1)
    assert client.get(f"{E}/checks/notsame").status_code == 403
