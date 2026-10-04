"""Graph building, adding and removing relatives, undo and merge (against the fake Gramps Web)."""
import familytree
from conftest import run


def test_graph_people_families_and_marriage_order(fake, g):
    dad, mum, mum2, kid = fake.person("Tom", "Lee", 1), fake.person("Ann", "Lee", 0), fake.person("Bea", "Ray", 0), fake.person("Sam", "Lee", 1)
    f1 = fake.family(dad, mum, [kid])
    f2 = fake.family(dad, mum2)
    fake.add("events", _class="Event", handle="ev1", type="Birth", date={"dateval": [3, 4, 1950, False], "modifier": 3}, place="pl1")
    fake.add("places", handle="pl1", name={"value": "Cork"})
    fake.db["people"][dad].update(event_ref_list=[{"ref": "ev1"}], birth_ref_index=0)
    out = run(familytree.graph(g))
    p = out["people"][dad]
    assert (p["first"], p["last"], p["gender"]) == ("Tom", "Lee", "m")
    assert p["birth"] == {"y": 1950, "m": 4, "d": 3, "about": True} and p["birthPlace"] == "Cork"
    assert p["fams"] == [f1, f2]  # 1st marriage first
    fam = next(f for f in out["families"] if f["id"] == f1)
    assert fam == {"id": f1, "f": dad, "m": mum, "kids": [kid]}


def test_add_new_father_creates_family_and_undo_removes_both(fake, g):
    kid = fake.person("Sam", "Lee", 1)
    res = run(familytree.add_relative(g, {"person": kid, "rel": "father", "new": {"first": "Tom", "last": "Lee"}}, []))
    dad = res["added"]
    assert fake.get("people", dad)["gender"] == 1
    assert fake.get("families", res["famId"])["father_handle"] == dad
    run(familytree.undo(g, res["undo"], []))
    assert fake.get("people", dad) is None and fake.get("families", res["famId"]) is None
    assert fake.get("people", kid)["parent_family_list"] == []


def test_second_father_refused_before_anyone_is_created(fake, g):
    dad, kid = fake.person("Tom", "", 1), fake.person("Sam", "", 1)
    fake.family(dad, None, [kid])
    before = len(fake.db["people"])
    try:
        run(familytree.add_relative(g, {"person": kid, "rel": "father", "new": {"first": "Other"}}, []))
        raise AssertionError("should refuse")
    except familytree.GrampsError as e:
        assert "already have a father" in str(e)
    assert len(fake.db["people"]) == before and not fake.sent("POST", "/objects/")


def test_unlink_child_keeps_couple_and_undo_puts_child_back(fake, g):
    dad, mum, kid = fake.person("Tom", "", 1), fake.person("Ann", "", 0), fake.person("Sam", "", 1)
    f = fake.family(dad, mum, [kid])
    res = run(familytree.unlink(g, {"person": dad, "rel": "child", "other": kid, "famId": f}))
    assert fake.get("families", f)["child_ref_list"] == []
    run(familytree.undo(g, res["undo"], []))
    assert [c["ref"] for c in fake.get("families", f)["child_ref_list"]] == [kid]


def test_unlink_last_link_deletes_family_never_people(fake, g):
    dad, kid = fake.person("Tom", "", 1), fake.person("Sam", "", 1)
    f = fake.family(dad, None, [kid])
    run(familytree.unlink(g, {"person": kid, "rel": "father", "other": dad, "famId": f}))
    assert fake.get("families", f) is None
    assert fake.get("people", dad) and fake.get("people", kid)


def test_merge_writes_fields_then_calls_native_merge(fake, g):
    a, b = fake.person("Ann", "Lee", 0), fake.person("Anne", "Lee", 0)
    res = run(familytree.merge(g, {"keep": a, "absorb": b, "fields": {"first": "Anne", "bogus": 1}}, []))
    assert fake.get("people", a)["primary_name"]["first_name"] == "Anne"
    assert fake.sent("POST", f"/people/{a}/merge/{b}")
    assert fake.sent("PUT", f"/people/{a}").__len__() == 1
    assert res["name"] == "Anne Lee"


def test_graph_sends_parent_families_in_gramps_order(fake, g):  # #22
    kid, bio, adopt = fake.person("Kid", "", 1), fake.person("Bio", "", 1), fake.person("Adopt", "", 1)
    fa = fake.family(adopt, None, [kid])
    fb = fake.family(bio, None, [kid])
    fake.db["people"][kid]["parent_family_list"] = [fb, fa]  # Gramps' order: birth family first
    out = run(familytree.graph(g))
    assert out["people"][kid]["pfams"] == [fb, fa]
    assert [f["id"] for f in out["families"]].index(fa) < [f["id"] for f in out["families"]].index(fb)  # list order differs


def refused(coro, words):
    try:
        run(coro)
    except familytree.GrampsError as e:
        assert words in str(e), str(e)
        return
    raise AssertionError("should refuse")


def test_server_checks_the_links_it_is_asked_for(fake, g):  # #38
    a, b, c, kid = fake.person("A", "", 1), fake.person("B", "", 0), fake.person("C", "", 0), fake.person("K", "", 1)
    f_ab = fake.family(a, b)
    f_c = fake.family(None, c)
    refused(familytree.add_relative(g, {"person": a, "rel": "child", "famId": f_c, "existing": kid}, []), "isn't theirs")
    refused(familytree.add_relative(g, {"person": a, "rel": "spouse", "existing": b}, []), "already husband and wife")
    run(familytree.add_relative(g, {"person": a, "rel": "child", "famId": f_ab, "existing": kid}, []))
    r = run(familytree.unlink(g, {"person": a, "rel": "child", "other": kid, "famId": f_ab}))
    run(familytree.undo(g, r["undo"], [])); run(familytree.undo(g, r["undo"], []))
    assert [x["ref"] for x in fake.get("families", f_ab)["child_ref_list"]] == [kid]
