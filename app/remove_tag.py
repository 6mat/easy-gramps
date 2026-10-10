"""One-off clean-up: take the "Easy Gramps" tag off every record, then delete the tag.

Before 1.2 the family tree put the tag "Easy Gramps" on every person, family, event, place, note
and photo it made. It doesn't any more (unless TREE_TAG is set). This takes the tag off the records
that have it and then deletes the tag itself. Nothing else in the records changes and no record is
deleted. It first says how many records have the tag and changes nothing until you type "yes".

    podman exec -it easy-gramps python remove_tag.py      (Docker: docker exec -it easy-gramps …)
    (or, without a container, from app/:  GRAMPS_URL=https://… python remove_tag.py)

Log in as an Editor or Owner: with your Gramps Web name and password, or, if you log in with
Google, with the login from your browser (it explains how). Safe to run again if it's stopped.
--tag "Other name" for a different tag; --keep-tag only takes it off the records.
"""
# ruff: noqa: ASYNC250  (a command-line tool: waiting for the user is the point)
import argparse
import asyncio
import os

from cli_login import login
from gramps import GrampsError

KINDS = {"people": "people", "families": "families", "events": "events", "places": "places",
         "notes": "notes", "media": "photos and files", "citations": "citations", "sources": "sources",
         "repositories": "repositories"}


async def tagged(g, tag):
    """{kind: [handle, …]} of every record that has the tag."""
    return {kind: [o["handle"] for o in await g.get(f"/{kind}/", keys="handle,tag_list") if tag in (o.get("tag_list") or [])]
            for kind in KINDS}


async def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--url", default=os.environ.get("GRAMPS_URL", "").rstrip("/"), help="Gramps Web address")
    ap.add_argument("--user", help="your Gramps Web user name (leave out to be asked)")
    ap.add_argument("--tag", default="Easy Gramps", help='the tag to take off (default "Easy Gramps")')
    ap.add_argument("--keep-tag", action="store_true", help="take it off the records, but keep the tag itself")
    a = ap.parse_args()
    if not a.url:
        ap.error("set GRAMPS_URL or pass --url")
    s = await login(a.url, a.user)

    tag = next((t["handle"] for t in await s.g.get("/tags/", keys="handle,name") if t["name"] == a.tag), None)
    if not tag:
        return print(f'There is no tag called "{a.tag}". Nothing to do.')
    print(f'Looking for records with the tag "{a.tag}"…')
    found = await tagged(s.g, tag)
    total = sum(map(len, found.values()))
    for kind, hs in found.items():
        if hs:
            print(f"  {len(hs):6}  {KINDS[kind]}")
    if total:
        ask = f'Take the tag off these {total} records? Nothing else in them changes and nothing is deleted. Type yes: '
        if input(ask).strip().lower() != "yes":
            return print("Nothing changed.")
        done = failed = 0
        for kind, hs in found.items():
            for h in hs:
                await s.renew()
                try:
                    obj = await s.g.get(f"/{kind}/{h}")
                    if tag in (obj.get("tag_list") or []):  # (fetched again: someone may have changed it meanwhile)
                        obj["tag_list"] = [t for t in obj["tag_list"] if t != tag]
                        await s.g.put(f"/{kind}/{h}", obj)
                    done += 1
                    if done % 100 == 0:
                        print(f"  {done} of {total}…")
                except GrampsError as e:
                    if e.status == 403:
                        raise SystemExit("Gramps Web refused: log in as an Editor or Owner.") from None
                    if e.status != 404:  # (404: deleted meanwhile, nothing to do)
                        failed += 1
                        print(f"  couldn't change one of the {KINDS[kind]} ({e})")
        print(f"Took the tag off {done} records." + (f" {failed} couldn't be changed: run it again later." if failed else ""))
        if failed:
            return
    else:
        print("No records have it.")
    if a.keep_tag:
        return
    await s.renew()
    if any((await tagged(s.g, tag)).values()):  # someone tagged a record meanwhile
        return print("Some records got the tag meanwhile; run it again to finish. The tag is kept for now.")
    await s.g.delete(f"/tags/{tag}")
    print(f'Deleted the tag "{a.tag}".')


if __name__ == "__main__":
    asyncio.run(main())
