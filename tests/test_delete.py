"""Delete this person (1.9.7, editors): gone from the tree and Gramps, their links with them; the relatives stay."""
import main as m
from test_chat import E, as_user
from test_history import history


def test_delete_person(fake, client):
    dad, mum, sis = fake.person("Raj", "Kumar", 1), fake.person("Uma", "Kumar", 0), fake.person("Asha", "Kumar", 0)
    oops = fake.person("Oops", "Kumar", 1)
    home = fake.family(dad, mum, [sis, oops])
    alone = fake.family(oops)  # a family with only them in it goes too
    as_user(fake, "kid", 1)
    assert client.put(f"{E}/auth/me/person", json={"person": oops}).status_code == 200
    assert client.delete(f"{E}/tree/person/{oops}").status_code == 403  # members can't

    as_user(fake, "ed", 3)
    assert client.delete(f"{E}/tree/person/{oops}").status_code == 200
    assert fake.get("people", oops) is None and fake.get("families", alone) is None
    fam = fake.get("families", home)
    assert (fam["father_handle"], fam["mother_handle"], [c["ref"] for c in fam["child_ref_list"]]) == (dad, mum, [sis])
    assert m.CHAT.one("SELECT 1 FROM settings WHERE person = ?", oops) is None  # their login can find themselves again
    [row] = history(client)
    assert row["item"] == {"op": "delete", "id": oops, "label": "Oops Kumar"} and row["undo"] is False
