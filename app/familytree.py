"""The family-tree view: everyone as one compact graph, plus the details shown under "More details".

Reads go through the viewer's own Gramps Web token, so Gramps decides what they may see
(private records and private addresses/emails are left out for roles without "view private").
"""
from gramps import GENDER, Gramps, GrampsError, gramps_date, new_handle, new_person_objs, note_obj, upload_photo

GENDER_CODE = {0: "f", 1: "m"}  # Gramps' numbers -> the page's letters
GENDER_WORD = {"m": "male", "f": "female"}  # the page's letters -> gramps.GENDER keys
MOD_ABOUT = 3


def ymd(d):
    """Gramps Date -> {y, m, d, about}, or None when there is no year."""
    if not d or not d.get("dateval") or not d["dateval"][2]:
        return None
    day, month, year = d["dateval"][:3]
    return {"y": year, "m": month or None, "d": day or None, "about": d.get("modifier") == MOD_ABOUT}


def surname_of(name):
    sl = name.get("surname_list") or []
    primary = next((s for s in sl if s.get("primary")), sl[0] if sl else None)
    return (primary or {}).get("surname", "")


async def graph(g: Gramps) -> dict:
    """Every person (the fields the tree and panel need) and every family, in one response."""
    people = await g.get("/people/", keys="handle,gramps_id,gender,primary_name,event_ref_list,"
                                          "birth_ref_index,death_ref_index,family_list,parent_family_list,media_list")
    families = await g.get("/families/", keys="handle,father_handle,mother_handle,child_ref_list")
    events = {e["handle"]: e for e in await g.get("/events/", keys="handle,type,date,place")}
    places = {p["handle"]: p["name"]["value"] for p in await g.get("/places/", keys="handle,name")}
    pictures = {m["handle"] for m in await g.get("/media/", keys="handle,mime") if (m.get("mime") or "").startswith("image/")}

    out = {}
    for p in people:
        refs = p.get("event_ref_list") or []

        def event_at(i):
            return events.get(refs[i]["ref"]) if 0 <= i < len(refs) else None

        birth, death = event_at(p.get("birth_ref_index", -1)), event_at(p.get("death_ref_index", -1))
        burial = next((events[r["ref"]] for r in refs
                       if r["ref"] in events and events[r["ref"]].get("type") == "Burial"), None)
        name = p["primary_name"]
        out[p["handle"]] = {
            "id": p["handle"],
            "gid": p.get("gramps_id", ""),
            "first": (name.get("first_name") or "").strip(),
            "last": surname_of(name),
            "nick": name.get("nick") or "",
            "gender": GENDER_CODE.get(p.get("gender"), ""),
            "birth": ymd((birth or {}).get("date")),
            "birthPlace": places.get((birth or {}).get("place"), ""),
            "deceased": death is not None,
            "death": ymd((death or {}).get("date")),
            "burial": places.get((burial or {}).get("place"), ""),
            "photo": p["media_list"][0]["ref"] if p.get("media_list") else None,
            "photos": [m["ref"] for m in p.get("media_list") or [] if m["ref"] in pictures],  # every picture, main first
            "fams": p.get("family_list") or [],  # marriage order: 1st spouse first
            "pfams": p.get("parent_family_list") or [],  # their parents' families; the first is the one shown
        }
    fams = [{"id": f["handle"], "f": f.get("father_handle") or None, "m": f.get("mother_handle") or None,
             "kids": [c["ref"] for c in f.get("child_ref_list") or []]}
            for f in families]
    return {"people": out, "families": fams}


async def details(g: Gramps, handle: str) -> dict:
    """Where they live, phone, email and notes: loaded only when someone opens "More details"."""
    p = await g.get(f"/people/{handle}", extend="note_list")
    addr = next(iter(p.get("address_list") or []), {})
    email = next((u["path"].removeprefix("mailto:") for u in p.get("urls") or [] if u.get("type") == "E-mail"), "")
    # The editor changes only the first note (the one it shows); any others are shown read-only.
    notes = [(n.get("text") or {}).get("string", "") for n in (p.get("extended") or {}).get("notes", [])]
    # "Lives in" edits the city; the rest of the address (from Gramps Web) is shown but left alone.
    rest = ", ".join(x for x in (addr.get("state"), addr.get("country")) if x)
    return {"residence": addr.get("city", ""), "residenceRest": rest, "phone": addr.get("phone", ""), "email": email,
            "notes": notes[0] if notes else "", "otherNotes": [t for t in notes[1:] if t]}


# ---------- editing one person, a field at a time (the editor autosaves each change) ----------

FIELDS = {"first", "last", "nick", "gender", "birth", "birthPlace", "deceased", "death", "burial",
          "residence", "phone", "email", "notes"}
ADDRESS_PARTS = ("street", "locality", "city", "county", "state", "country", "postal", "phone")
EMPTY_DATE = {"_class": "Date", "calendar": 0, "modifier": 0, "quality": 0, "dateval": [0, 0, 0, False],
              "sortval": 0, "newyear": 0, "text": "", "year": 0}


def to_gramps_date(v):
    if not v or not v.get("y"):
        return None
    return gramps_date({"year": v["y"], "month": v.get("m") or 0, "day": v.get("d") or 0, "about": v.get("about")})


def place_given(v) -> bool:
    if isinstance(v, dict):
        return bool(v.get("id") or (v.get("new") or "").strip())
    return bool((v or "").strip())


async def places(g: Gramps) -> list:
    """Every place for the editor's list, with the area it's in ("Kent, England") to tell same names apart."""
    rows = await g.get("/places/", keys="handle,name,placeref_list")
    by = {r["handle"]: r for r in rows}

    def area(r, depth=0):
        up = by.get(((r.get("placeref_list") or [{}])[0]).get("ref"))
        if not up or depth > 3:
            return []
        return [up["name"]["value"]] + area(up, depth + 1)

    out = [{"id": r["handle"], "name": r["name"]["value"].strip(), "area": ", ".join(area(r))} for r in rows]
    return sorted((x for x in out if x["name"]), key=lambda x: (x["name"].lower(), x["area"]))


async def update_person(g: Gramps, handle: str, changes: dict, tags: list) -> dict:
    unknown = set(changes) - FIELDS
    if unknown:
        raise GrampsError(f"Can't change: {', '.join(sorted(unknown))}")
    p = await g.get(f"/people/{handle}")
    refs = p.setdefault("event_ref_list", [])
    new_objs, dirty_events, dropped, dropped_notes = [], {}, [], []
    known_places = None

    async def place_handle(value):
        """A place picked from the list ({"id"}), a new one the user asked for ({"new"}), or a name
        (from merge: the place with that name, made if there's none)."""
        nonlocal known_places
        if isinstance(value, dict) and value.get("id"):
            await g.get(f"/places/{value['id']}", keys="handle")  # it must exist
            return value["id"]
        is_new = isinstance(value, dict)
        name = ((value.get("new") if is_new else value) or "").strip()
        if not name:
            return ""
        if known_places is None and not is_new:
            known_places = await g.places_by_name()
        if is_new or name.lower() not in known_places:
            h = new_handle()
            if not is_new:
                known_places[name.lower()] = h
            new_objs.append({"_class": "Place", "handle": h, "place_type": "Unknown", "title": "", "tag_list": list(tags),
                             "name": {"_class": "PlaceName", "value": name, "lang": ""}})
            return h
        return known_places[name.lower()]

    loaded = {}  # event handle -> event, fetched at most once

    async def load_event(h):
        if h not in loaded:
            loaded[h] = next((o for o in new_objs if o.get("handle") == h), None) or await g.get(f"/events/{h}")
        return loaded[h]

    async def event(etype, index_key=None, create=True):
        """The person's event of this type (via birth/death pointer, or by type), optionally creating it."""
        idx = p.get(index_key, -1) if index_key else -1
        if not index_key:
            for i, r in enumerate(refs):
                if (await load_event(r["ref"])).get("type") == etype:
                    idx = i
                    break
        if 0 <= idx < len(refs):
            ev = await load_event(refs[idx]["ref"])
            dirty_events[ev["handle"]] = ev
            return ev
        if not create:
            return None
        ev = {"_class": "Event", "handle": new_handle(), "type": etype, "place": "", "description": "",
              "tag_list": list(tags), "private": False}
        new_objs.append(ev)
        loaded[ev["handle"]] = dirty_events[ev["handle"]] = ev
        refs.append({"_class": "EventRef", "ref": ev["handle"], "role": "Primary"})
        if index_key:
            p[index_key] = len(refs) - 1
        return ev

    def drop_event(ev, index_key=None):
        """Take an event off the person (and delete it), keeping the birth/death pointers right."""
        i = next(i for i, r in enumerate(refs) if r["ref"] == ev["handle"])
        refs.pop(i)
        for k in ("birth_ref_index", "death_ref_index"):
            if p.get(k, -1) == i:
                p[k] = -1
            elif p.get(k, -1) > i:
                p[k] -= 1
        dirty_events.pop(ev["handle"], None)
        if ev in new_objs:
            new_objs.remove(ev)
        else:
            dropped.append(ev["handle"])

    name = p["primary_name"]
    if "first" in changes:
        name["first_name"] = (changes["first"] or "").strip()
    if "nick" in changes:
        name["nick"] = (changes["nick"] or "").strip()
    if "last" in changes:
        rest = [s for s in name.get("surname_list", []) if not s.get("primary")]
        last = (changes["last"] or "").strip()
        name["surname_list"] = ([{"_class": "Surname", "surname": last, "primary": True}] if last else []) + rest
    if "gender" in changes:
        p["gender"] = GENDER.get(GENDER_WORD.get(changes["gender"], "unknown"), 2)

    if "birth" in changes or "birthPlace" in changes:
        date = to_gramps_date(changes.get("birth")) if "birth" in changes else None
        wants = date or place_given(changes.get("birthPlace"))
        ev = await event("Birth", "birth_ref_index", create=bool(wants))
        if ev:
            if "birth" in changes:
                ev["date"] = date or dict(EMPTY_DATE)
            if "birthPlace" in changes:
                ev["place"] = await place_handle(changes["birthPlace"])

    if changes.get("death") and "deceased" not in changes:
        changes["deceased"] = True  # a death date means they've passed away
    if "deceased" in changes and not changes["deceased"]:
        for etype, key in (("Death", "death_ref_index"), ("Burial", None)):
            ev = await event(etype, key, create=False)
            if ev:
                drop_event(ev, key)
    else:
        if changes.get("deceased") or "death" in changes:
            ev = await event("Death", "death_ref_index", create=True)
            if "death" in changes:
                ev["date"] = to_gramps_date(changes["death"]) or dict(EMPTY_DATE)
        if "burial" in changes:
            place = await place_handle(changes["burial"])
            ev = await event("Burial", None, create=bool(place))
            if ev and place:
                ev["place"] = place
            elif ev:
                drop_event(ev)

    if "residence" in changes or "phone" in changes:
        addrs = p.setdefault("address_list", [])
        if not addrs:
            addrs.append({"_class": "Address", "private": True, "street": "", "locality": "", "city": "", "county": "",
                          "state": "", "country": "", "postal": "", "phone": ""})
        a = addrs[0]
        if "residence" in changes:
            a["city"] = (changes["residence"] or "").strip()
        if "phone" in changes:
            a["phone"] = (changes["phone"] or "").strip()
        if not any(a.get(k) for k in ADDRESS_PARTS):
            addrs.pop(0)

    if "email" in changes:
        urls = [u for u in p.get("urls", []) if u.get("type") != "E-mail"]
        email = (changes["email"] or "").strip()
        if email:
            urls.insert(0, {"_class": "Url", "private": True, "path": f"mailto:{email}", "desc": "Email", "type": "E-mail"})
        p["urls"] = urls

    if "notes" in changes:
        text = (changes["notes"] or "").strip()
        first = p["note_list"][0] if p.get("note_list") else None
        if first and text:
            note = await g.get(f"/notes/{first}")
            note["text"] = {"_class": "StyledText", "string": text, "tags": []}
            await g.put(f"/notes/{first}", note)
        elif first:
            p["note_list"].pop(0)
            dropped_notes.append(first)  # deleted after the person no longer points to it, if nothing else does
        elif text:
            n = note_obj(text, tags, False)
            new_objs.append(n)
            p.setdefault("note_list", []).append(n["handle"])

    fresh = {o["handle"] for o in new_objs}
    if new_objs:
        await g.add_objects(new_objs)
    for h, ev in dirty_events.items():
        if h not in fresh:
            await g.put(f"/events/{h}", ev)
    await g.put(f"/people/{handle}", p)
    for h in dropped:  # an event can be shared (e.g. a witness): delete it only if no one else uses it
        if not await g.in_use("events", h):
            await g.delete(f"/events/{h}")
    for h in dropped_notes:
        if not await g.in_use("notes", h):
            await g.delete(f"/notes/{h}")
    return {"ok": True}


async def set_photo(g: Gramps, handle: str, photo, tags: list, main=True) -> dict:
    """Upload a photo: the person's main (first) photo, or (main=False) one more after the others."""
    p = await g.get(f"/people/{handle}")
    name = (p["primary_name"].get("first_name") or "").strip()
    mh = await upload_photo(g, photo, tags, False, desc=f"Photo of {name}".strip())
    rest = [m for m in p.get("media_list") or [] if m["ref"] != mh]
    ref = {"_class": "MediaRef", "ref": mh}
    p["media_list"] = [ref] + rest if main else rest + [ref]
    await g.put(f"/people/{handle}", p)
    return {"photo": p["media_list"][0]["ref"], "added": mh}


async def photo_change(g: Gramps, handle: str, body: dict) -> dict:
    """{media, do: "main" | "remove"}: make one of their photos the main one, or take it off this
    person. The photo itself stays in Gramps (others may use it); nothing is deleted."""
    media, do = body.get("media"), body.get("do")
    if do not in ("main", "remove") or not media:
        raise GrampsError("Something was missing. Please try again.")
    p = await g.get(f"/people/{handle}")
    refs = p.get("media_list") or []
    ref = next((m for m in refs if m["ref"] == media), None)
    if ref is None:
        raise GrampsError("That photo isn't on this person any more.", 404)
    rest = [m for m in refs if m["ref"] != media]
    p["media_list"] = rest if do == "remove" else [ref] + rest
    await g.put(f"/people/{handle}", p)
    return {"photo": p["media_list"][0]["ref"] if p["media_list"] else None}


# ---------- adding and removing relatives (every change can be undone) ----------

RELS = {"father", "mother", "spouse", "child"}


async def _family_parent_of(g, person):
    """The family the person is a child in (their parents), or None."""
    pf = person.get("parent_family_list") or []
    return await g.get(f"/families/{pf[0]}") if pf else None


async def _delete_family(g, fam):
    """Empty the family first, so Gramps clears everyone's links to it, then delete it."""
    fam.update(father_handle=None, mother_handle=None, child_ref_list=[])
    await g.put(f"/families/{fam['handle']}", fam)
    await g.delete(f"/families/{fam['handle']}")


async def _delete_person(g, handle):
    p = await g.get(f"/people/{handle}")
    for fh in (p.get("family_list") or []) + (p.get("parent_family_list") or []):
        fam = await g.get(f"/families/{fh}")
        fam["child_ref_list"] = [c for c in fam.get("child_ref_list", []) if c["ref"] != handle]
        for side in ("father_handle", "mother_handle"):
            if fam.get(side) == handle:
                fam[side] = None
        if not fam["child_ref_list"] and not (fam.get("father_handle") and fam.get("mother_handle")):
            await _delete_family(g, fam)
        else:
            await g.put(f"/families/{fh}", fam)
    events = [r["ref"] for r in p.get("event_ref_list") or []]
    await g.delete(f"/people/{handle}")
    for h in events:
        if not await g.in_use("events", h):
            await g.delete(f"/events/{h}")


def _family(father, mother, kids, tags):
    return {"_class": "Family", "handle": new_handle(), "type": "Married" if father and mother else "Unknown",
            "father_handle": father, "mother_handle": mother, "tag_list": list(tags),
            "child_ref_list": [child_ref(k) for k in kids]}


def child_ref(handle):
    return {"_class": "ChildRef", "ref": handle, "frel": "Birth", "mrel": "Birth"}


def new_person(details, tags, gender=None):
    """A new person from the page's {first, last, gender, birth: {y, m, d}} -> (handle, objects)."""
    first, last = (details.get("first") or "").strip(), (details.get("last") or "").strip()
    if not (first or last):
        raise GrampsError("Please write a first or last name")
    b = details.get("birth") or {}
    return new_person_objs({"first_name": first, "surname": last,
                            "birth_date": {"year": b.get("y"), "month": b.get("m"), "day": b.get("d")}},
                           tags, False, gender or GENDER_WORD.get(details.get("gender"), "unknown"))


async def add_relative(g: Gramps, body: dict, tags: list) -> dict:
    """Link someone (already in the tree, or new) as father / mother / spouse / child of a person."""
    ph, rel, fam_id = body.get("person"), body.get("rel"), body.get("famId")
    if rel not in RELS or not ph:
        raise GrampsError("Unknown kind of relative")
    person = await g.get(f"/people/{ph}")
    # Check before creating anyone, so a refused add leaves nothing behind.
    parent_fam = await _family_parent_of(g, person) if rel in ("father", "mother") else None
    if parent_fam and parent_fam.get(f"{rel}_handle"):
        raise GrampsError(f"They already have a {rel}. Remove that link first.")
    if rel == "child" and fam_id and fam_id not in (person.get("family_list") or []):
        raise GrampsError("That family isn't theirs. Please reload and try again.")
    created = None
    if body.get("existing"):
        oh = body["existing"]
        if oh == ph:
            raise GrampsError("Someone can't be their own relative")
        other = await g.get(f"/people/{oh}")
        if rel == "spouse" and set(person.get("family_list") or []) & set(other.get("family_list") or []):
            raise GrampsError("They're already husband and wife.")
    else:
        implied = {"father": "male", "mother": "female"}.get(rel)
        if rel == "spouse":
            implied = {1: "female", 0: "male"}.get(person.get("gender"))
        oh, objs = new_person(body.get("new") or {}, tags, implied)
        await g.add_objects(objs)
        created = oh
        other = await g.get(f"/people/{oh}")

    if rel in ("father", "mother"):
        side = f"{rel}_handle"
        fam = parent_fam
        if fam:
            # They may already be a couple in another family (A and B married; the children were added
            # with A only): the children then join that family instead of making the couple twice.
            couple = await _couple_family(g, fam, side, oh)
            fam[side] = oh
            fam["type"] = "Married" if fam.get("father_handle") and fam.get("mother_handle") else fam.get("type", "Unknown")
            await g.put(f"/families/{fam['handle']}", fam)
            fam_id = fam["handle"]
            if couple:
                kids = [c["ref"] for c in fam.get("child_ref_list") or []]
                await g.post(f"/families/{couple}/merge/{fam_id}")  # Gramps' own merge: children, events, links
                other_side = "mother_handle" if side == "father_handle" else "father_handle"
                undo = {"op": "split", "famId": couple, "kids": kids, "side": other_side, "parent": fam.get(other_side)}
                return {"added": oh, "famId": couple, "undo": undo, "joined": True}
        else:
            fam = _family(oh if rel == "father" else None, oh if rel == "mother" else None, [ph], tags)
            await g.add_objects([fam])
            fam_id = fam["handle"]
    elif rel == "spouse":
        person_is_father = person.get("gender") == 1 or (person.get("gender") != 0 and other.get("gender") != 1)
        fam = _family(ph if person_is_father else oh, oh if person_is_father else ph, [], tags)
        await g.add_objects([fam])
        fam_id = fam["handle"]
    else:  # child
        fam = await g.get(f"/families/{fam_id}") if fam_id else None
        if fam:
            if any(c["ref"] == oh for c in fam.get("child_ref_list", [])):
                raise GrampsError("They're already a child of this family")
            fam["child_ref_list"].append(child_ref(oh))
            await g.put(f"/families/{fam_id}", fam)
        else:
            is_mother = person.get("gender") == 0
            fam = _family(None if is_mother else ph, ph if is_mother else None, [oh], tags)
            await g.add_objects([fam])
            fam_id = fam["handle"]

    undo = {"op": "unlink", "person": ph, "rel": rel, "other": oh, "famId": fam_id}
    if created:
        undo["delete"] = created
    return {"added": oh, "famId": fam_id, "undo": undo}


async def _couple_family(g, fam, side, oh):
    """Another family where `oh` and the family's other parent are already the couple, or None."""
    other = fam.get("mother_handle" if side == "father_handle" else "father_handle")
    if not other:
        return None
    for fh in (await g.get(f"/people/{other}")).get("family_list") or []:
        if fh == fam["handle"]:
            continue
        f = await g.get(f"/families/{fh}")
        if f.get(side) == oh:
            return fh
    return None


async def merge_families(g: Gramps, body: dict) -> dict:
    """The same couple recorded twice: fold `absorb` into `keep` with Gramps' own family merge
    (children, marriage events and everyone's links end up in one family). Not covered by Undo."""
    keep, absorb = body.get("keep"), body.get("absorb")
    if not keep or not absorb or keep == absorb:
        raise GrampsError("Pick the two families to combine")
    a, b = await g.get(f"/families/{keep}"), await g.get(f"/families/{absorb}")
    couple = lambda f: (f.get("father_handle"), f.get("mother_handle"))  # noqa: E731
    if couple(a) != couple(b) or not all(couple(a)):
        raise GrampsError("Those aren't the same couple. Please reload and try again.")
    await g.post(f"/families/{keep}/merge/{absorb}")
    return {"famId": keep}


async def unlink(g: Gramps, body: dict) -> dict:
    """Remove the link between two people. Nobody is deleted (unless undoing an add that created them)."""
    ph, rel, oh, fam_id = body.get("person"), body.get("rel"), body.get("other"), body.get("famId")
    if rel not in RELS or not (ph and oh and fam_id):
        raise GrampsError("Missing details for removing a link")
    try:
        fam = await g.get(f"/families/{fam_id}")
    except GrampsError:
        fam = None
    if fam is None:  # the family is already gone (e.g. undoing an add after its other links went)
        if body.get("delete"):
            await _delete_person(g, body["delete"])
        return {"ok": True}
    was_side = None
    if rel == "child":
        fam["child_ref_list"] = [c for c in fam.get("child_ref_list", []) if c["ref"] != oh]
    else:
        for side in ("father_handle", "mother_handle"):
            if fam.get(side) == oh:
                fam[side], was_side = None, side
    kids, fa, mo = fam.get("child_ref_list", []), fam.get("father_handle"), fam.get("mother_handle")
    # A family stays while it still links two people: a couple, or a parent with a child.
    if not (fa or mo) or (not kids and not (fa and mo)):
        await _delete_family(g, fam)
    else:
        await g.put(f"/families/{fam_id}", fam)
    if body.get("delete"):
        await _delete_person(g, body["delete"])
        return {"ok": True}
    return {"ok": True, "undo": {"op": "link", "person": ph, "rel": rel, "other": oh, "famId": fam_id, "side": was_side}}


async def undo(g: Gramps, token: dict, tags: list) -> dict:
    if token.get("op") == "split":  # undo children joining a couple's family: back to one parent only
        fam = await g.get(f"/families/{token['famId']}")
        kids = set(token.get("kids") or [])
        moved = [c for c in fam.get("child_ref_list") or [] if c["ref"] in kids]
        if moved:
            fam["child_ref_list"] = [c for c in fam["child_ref_list"] if c["ref"] not in kids]
            await g.put(f"/families/{fam['handle']}", fam)
            parent = token.get("parent")
            new = _family(parent if token.get("side") == "father_handle" else None,
                          parent if token.get("side") == "mother_handle" else None, [], tags)
            new["child_ref_list"] = moved
            await g.add_objects([new])
        return {"ok": True}
    if token.get("op") == "unlink":
        await unlink(g, token)
        return {"ok": True}
    if token.get("op") == "link":
        # Put them back into the same family when it still exists, so its other links stay as they were.
        try:
            fam = await g.get(f"/families/{token['famId']}")
        except GrampsError:
            fam = None
        if fam and token["rel"] == "child":
            if not any(c["ref"] == token["other"] for c in fam.get("child_ref_list", [])):  # Undo sent twice
                fam["child_ref_list"].append(child_ref(token["other"]))
                await g.put(f"/families/{fam['handle']}", fam)
        elif fam and token.get("side") and not fam.get(token["side"]):
            fam[token["side"]] = token["other"]
            await g.put(f"/families/{fam['handle']}", fam)
        else:  # that family was removed; link them afresh
            await add_relative(g, {"person": token["person"], "rel": token["rel"], "existing": token["other"],
                                   "famId": None}, tags)
        return {"ok": True}
    raise GrampsError("Nothing to undo")


async def create_person(g: Gramps, body: dict, tags: list) -> dict:
    """A new person with no relatives yet (the start screen's "Add a new person")."""
    handle, objs = new_person(body, tags)
    await g.add_objects(objs)
    return {"added": handle}


async def merge(g: Gramps, body: dict, tags: list) -> dict:
    """Fold the duplicate person (`absorb`) into the one we keep (`keep`), using Gramps' own merge.

    Gramps keeps `keep`'s primary name/gender/preferred events and appends everything from
    `absorb` (events, media, notes, addresses, attributes); with family_merger it also keeps both
    people's family links. We first copy any chosen scalar values onto `keep` (gap-fill / the
    user's picks on the compare screen), then call the native merge, which deletes `absorb`.
    """
    keep, absorb = body.get("keep"), body.get("absorb")
    if not keep or not absorb:
        raise GrampsError("Pick two people to merge", 400)
    if keep == absorb:
        raise GrampsError("Those are the same person", 400)
    for h in (keep, absorb):  # make sure both still exist before we change anything
        await g.get(f"/people/{h}", keys="handle")
    fields = {k: v for k, v in (body.get("fields") or {}).items() if k in FIELDS}
    if fields:
        await update_person(g, keep, fields, tags)
    await g.post(f"/people/{keep}/merge/{absorb}", {"family_merger": True})
    p = await g.get(f"/people/{keep}", keys="primary_name")
    nm = p["primary_name"]
    name = " ".join(x for x in [(nm.get("first_name") or "").strip(), surname_of(nm)] if x)
    return {"merged": keep, "name": name or "this person"}


async def recent_changes(g: Gramps, limit: int = 8) -> list:
    """The people most recently added or changed (by anyone), with who changed them when Gramps can tell."""
    people = await g.get("/people/", sort="-change", pagesize=limit, page=1, keys="handle,change")
    who = {}
    try:  # the change history names the person who made each change; some roles may not see it
        for t in await g.get("/transactions/history/", sort="-id", pagesize=80, page=1):
            user = (t.get("connection") or {}).get("user") or {}
            for ch in t.get("changes") or []:
                if ch.get("obj_class") == "Person" and ch.get("obj_handle") not in who:
                    who[ch["obj_handle"]] = user.get("full_name") or user.get("name")
    except GrampsError:
        pass
    return [{"id": p["handle"], "changed": p.get("change"), "by": who.get(p["handle"])} for p in people]
