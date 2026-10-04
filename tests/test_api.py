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
