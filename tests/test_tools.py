"""The command-line clean-up tools (run by the owner on the server), against the fake Gramps Web."""
import asyncio
import sys


def run(monkeypatch, module, args, answers):
    answers = iter(answers)
    monkeypatch.setattr("builtins.input", lambda *_: next(answers))
    monkeypatch.setattr("getpass.getpass", lambda *_: next(answers))
    monkeypatch.setattr(sys, "argv", [module.__name__, "--url", "http://gramps.test", *args])
    asyncio.run(module.main())


def tagged_tree(fake):
    t = fake.add("tags", _class="Tag", name="Easy Gramps")
    other = fake.add("tags", _class="Tag", name="Mine")
    p = fake.person("A", tag_list=[t, other])
    n = fake.add("notes", _class="Note", text={"string": "x"}, tag_list=[t])
    keep = fake.person("B", tag_list=[other])
    return t, other, p, n, keep


def test_remove_tag_takes_it_off_and_deletes_it(fake, monkeypatch, capsys):
    import remove_tag
    t, other, p, n, keep = tagged_tree(fake)
    run(monkeypatch, remove_tag, [], ["owner", "right", "yes"])
    assert fake.get("people", p)["tag_list"] == [other] and fake.get("notes", n)["tag_list"] == []
    assert fake.get("people", keep)["tag_list"] == [other]
    assert t not in fake.db["tags"] and other in fake.db["tags"]
    assert fake.get("people", p)["primary_name"]["first_name"] == "A"  # nothing else changed
    assert "2 records" in capsys.readouterr().out


def test_remove_tag_changes_nothing_without_yes(fake, monkeypatch):
    import remove_tag
    t, other, p, n, keep = tagged_tree(fake)
    run(monkeypatch, remove_tag, [], ["owner", "right", "no"])
    assert t in fake.get("people", p)["tag_list"] and t in fake.db["tags"] and not fake.sent("PUT")


def test_remove_tag_with_the_browser_login(fake, monkeypatch):  # Google users have no password
    import remove_tag
    t, *_ = tagged_tree(fake)
    run(monkeypatch, remove_tag, ["--keep-tag"], ["", "'ref'", "yes"])
    assert t in fake.db["tags"] and not any(t in (x.get("tag_list") or []) for x in fake.db["people"].values())
