"""The admin's layout (1.9.5, ☰ Menu → Manage → Layout): only admins change it, each field reaches only the roles it's
set for, the fields are edited from Easy Gramps (an event where the person is the main person; shared ones read-only),
and History's Undo puts back that same event."""
from test_chat import E, as_user
from test_history import history

LAYOUT = [{"k": "e:Baptism", "where": "top", "see": 0}, {"k": "a:Caste", "where": "more", "see": 4},
          {"k": "notes", "where": "more", "see": 0}, {"k": "r:cousins", "where": "more", "see": 1}]


def test_layout_fields(fake, client):
    ravi, priya = fake.person("Ravi", "Kumar", 1), fake.person("Priya", "Kumar", 0)
    church = fake.add("places", _class="Place", name={"value": "Chennai"})
    theirs = fake.add("events", _class="Event", type="Baptism", place=church, description="Priya's")
    fake.get("people", ravi)["event_ref_list"] = [{"_class": "EventRef", "ref": theirs, "role": "Godparent"}]
    fake.get("people", priya)["event_ref_list"] = [{"_class": "EventRef", "ref": theirs, "role": "Primary"}]
    fake.get("people", ravi)["attribute_list"] = [{"_class": "Attribute", "type": "Caste", "value": "X"}]

    as_user(fake, "own", 4)
    assert client.put(f"{E}/site", json={"layout": LAYOUT}).status_code == 403  # admins only
    as_user(fake, "root", 5)
    for bad in ([{"k": "x:1", "where": "top", "see": 0}], [{"k": "e:Baptism", "where": "side", "see": 0}],
                [{"k": "notes", "where": "top", "see": 9}], LAYOUT + LAYOUT[:1]):
        assert client.put(f"{E}/site", json={"layout": bad}).status_code == 400, bad
    assert client.put(f"{E}/site", json={"layout": LAYOUT, "box": ["nick", ""]}).status_code == 200

    as_user(fake, "guest", 0)  # sees the baptism and notes, not the caste, the cousins or the work
    assert [r["k"] for r in client.get(f"{E}/auth/me").json()["site"]["layout"]] == ["e:Baptism", "notes"]
    d = client.get(f"{E}/tree/details/{ravi}").json()
    assert "a:Caste" not in d and d["work"] == "" and "e:Baptism.date" not in d  # his only baptism is Priya's: not his to edit
    assert d["also"]["e:Baptism"] == [{"date": None, "place": "Chennai", "desc": "Priya's", "role": "Godparent"}]

    as_user(fake, "ed", 3)
    patch = lambda **f: client.patch(f"{E}/tree/person/{ravi}", json=f).status_code  # noqa: E731
    assert patch(**{"a:Caste": "Y"}) == 403 and patch(work="Farmer") == 403  # not in the layout for editors
    assert patch(**{"e:Baptism.date": {"y": 1950}}) == 200
    mine = fake.get("people", ravi)["event_ref_list"][-1]["ref"]
    assert mine != theirs and fake.get("events", theirs).get("date") is None  # his own, Priya's left alone
    assert client.get(f"{E}/tree/details/{ravi}").json()["e:Baptism.date"] == {"y": 1950, "m": None, "d": None, "about": False}
    [row] = history(client)
    assert row["item"]["field"] == "e:Baptism.date"

    # Undo puts back that event: refused once his first baptism is another one
    as_user(fake, "root", 5)
    refs = fake.get("people", ravi)["event_ref_list"]
    other = fake.add("events", _class="Event", type="Baptism", date=fake.get("events", mine)["date"])
    refs.insert(0, {"_class": "EventRef", "ref": other, "role": "Primary"})
    assert client.post(f"{E}/changes/{row['id']}/undo").status_code == 409
    refs.pop(0)
    assert client.post(f"{E}/changes/{row['id']}/undo").status_code == 200
    assert mine not in [r["ref"] for r in fake.get("people", ravi)["event_ref_list"]]  # emptied: gone again

    as_user(fake, "own", 4)  # the owner sees and edits the caste; emptied, it's gone
    assert client.get(f"{E}/tree/details/{ravi}").json()["a:Caste"] == "X"
    assert patch(**{"a:Caste": ""}) == 200 and fake.get("people", ravi)["attribute_list"] == []
