"""Changing one person's fields (the editor's autosave)."""
import familytree
from conftest import run


def note(fake, text):
    return fake.add("notes", _class="Note", type="General", text={"_class": "StyledText", "string": text, "tags": []})


def test_notes_edit_only_the_first_note(fake, g):  # #14
    n1, n2 = note(fake, "one"), note(fake, "two")
    p = fake.person("Ann", "", 0, note_list=[n1, n2])
    d = run(familytree.details(g, p))
    assert d["notes"] == "one" and d["otherNotes"] == ["two"]
    run(familytree.update_person(g, p, {"notes": "one!"}, []))
    assert fake.get("notes", n1)["text"]["string"] == "one!"
    assert fake.get("notes", n2)["text"]["string"] == "two"


def test_clearing_notes_keeps_a_note_someone_else_uses(fake, g):  # #14
    n1 = note(fake, "shared")
    p = fake.person("Ann", "", 0, note_list=[n1])
    fake.person("Bob", "", 1, note_list=[n1])
    run(familytree.update_person(g, p, {"notes": ""}, []))
    assert fake.get("people", p)["note_list"] == []
    assert fake.get("notes", n1) is not None


def test_clearing_notes_deletes_an_unused_note(fake, g):
    n1 = note(fake, "mine")
    p = fake.person("Ann", "", 0, note_list=[n1])
    run(familytree.update_person(g, p, {"notes": ""}, []))
    assert fake.get("notes", n1) is None


def address(**parts):
    a = {"_class": "Address", "private": False, "street": "", "locality": "", "city": "", "county": "",
         "state": "", "country": "", "postal": "", "phone": ""}
    a.update(parts)
    return a


def test_residence_edits_city_only(fake, g):  # #17
    p = fake.person("Ann", "", 0, address_list=[address(city="Springfield", state="Illinois", country="USA", postal="62701")])
    d = run(familytree.details(g, p))
    assert (d["residence"], d["residenceRest"]) == ("Springfield", "Illinois, USA")
    run(familytree.update_person(g, p, {"residence": "Chicago"}, []))
    a = fake.get("people", p)["address_list"][0]
    assert (a["city"], a["state"], a["country"], a["postal"], a["private"]) == ("Chicago", "Illinois", "USA", "62701", False)


def test_address_kept_while_any_part_is_left(fake, g):  # #17
    p = fake.person("Ann", "", 0, address_list=[address(postal="62701", phone="555")])
    run(familytree.update_person(g, p, {"phone": ""}, []))
    assert fake.get("people", p)["address_list"][0]["postal"] == "62701"
    run(familytree.update_person(g, p, {"residence": "x"}, []))
    run(familytree.update_person(g, p, {"residence": ""}, []))
    assert fake.get("people", p)["address_list"]  # postal still there


def test_new_address_is_private_and_empty_one_removed(fake, g):
    p = fake.person("Ann", "", 0)
    run(familytree.update_person(g, p, {"phone": "555"}, []))
    assert fake.get("people", p)["address_list"][0]["private"] is True
    run(familytree.update_person(g, p, {"phone": ""}, []))
    assert fake.get("people", p)["address_list"] == []
