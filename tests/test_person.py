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


def test_untick_deceased_keeps_a_shared_death_event(fake, g):  # #26
    ev = fake.add("events", _class="Event", type="Death")
    a = fake.person("Ann", "", 0, event_ref_list=[{"ref": ev, "role": "Primary"}], death_ref_index=0)
    b = fake.person("Bob", "", 1, event_ref_list=[{"ref": ev, "role": "Witness"}])
    run(familytree.update_person(g, a, {"deceased": False}, []))
    assert fake.get("people", a)["event_ref_list"] == [] and fake.get("people", a)["death_ref_index"] == -1
    assert fake.get("events", ev) is not None
    assert fake.get("people", b)["event_ref_list"][0]["ref"] == ev


def test_untick_deceased_deletes_own_death_and_burial(fake, g):
    d = fake.add("events", _class="Event", type="Death")
    bu = fake.add("events", _class="Event", type="Burial")
    a = fake.person("Ann", "", 0, event_ref_list=[{"ref": d}, {"ref": bu}], death_ref_index=0)
    run(familytree.update_person(g, a, {"deceased": False}, []))
    assert fake.get("events", d) is None and fake.get("events", bu) is None


def place(fake, name, inside=None):
    return fake.add("places", _class="Place", name={"value": name},
                    placeref_list=[{"_class": "PlaceRef", "ref": inside}] if inside else [])


def birth_place(fake, p):
    ev = fake.get("events", fake.get("people", p)["event_ref_list"][0]["ref"])
    return fake.get("places", ev["place"])


def test_places_list_names_the_area(fake, g):  # #49
    eng = place(fake, "England")
    kent = place(fake, "Kent", eng)
    place(fake, "Ashford", kent)
    place(fake, "Ashford")
    out = run(familytree.places(g))
    assert [(x["name"], x["area"]) for x in out if x["name"] == "Ashford"] == [("Ashford", ""), ("Ashford", "Kent, England")]


def test_picked_place_is_linked_not_made(fake, g):  # #49
    a = place(fake, "Ashford")
    p = fake.person("Ann", "", 0)
    run(familytree.update_person(g, p, {"birthPlace": {"id": a}}, []))
    assert birth_place(fake, p)["handle"] == a and len(fake.db["places"]) == 1


def test_new_place_is_made_even_with_the_same_name(fake, g):  # #49: another Ashford, asked for
    place(fake, "Ashford")
    p = fake.person("Ann", "", 0)
    run(familytree.update_person(g, p, {"burial": {"new": " Ashford "}, "deceased": True}, ["t1"]))
    assert len(fake.db["places"]) == 2
    made = [x for x in fake.db["places"].values() if x.get("tag_list") == ["t1"]]
    assert made[0]["name"]["value"] == "Ashford"


def test_place_by_name_still_reuses_an_exact_match(fake, g):  # merge sends names
    a = place(fake, "Ashford")
    p = fake.person("Ann", "", 0)
    run(familytree.update_person(g, p, {"birthPlace": "ashford"}, []))
    assert birth_place(fake, p)["handle"] == a and len(fake.db["places"]) == 1
