"""One-off clean-up: places the family tree made that nobody uses (#49).

Before 0.9.2 the place box saved while you typed, so "Lo", "Lond", "London" could each become a
place. This lists the places that carry the tree's tag (made by Easy Gramps) and that no person,
event or anything else points to, and deletes them only after you type "yes".

    docker exec -it easy-gramps python unused_places.py
    (or, without Docker, from app/:  GRAMPS_URL=https://… python unused_places.py)

Log in as an Editor or Owner. --only "ZZTEST" limits it to names starting with that text.
"""
# ruff: noqa: ASYNC210, ASYNC250  (a command-line tool: waiting for the user is the point)
import argparse
import asyncio
import getpass
import os

import httpx

from gramps import Gramps


async def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--url", default=os.environ.get("GRAMPS_URL", "").rstrip("/"), help="Gramps Web address")
    ap.add_argument("--user", help="your Gramps Web user name")
    ap.add_argument("--tag", default=os.environ.get("TREE_TAG") or "Easy Gramps", help="the tree's tag (before 1.2: Easy Gramps)")
    ap.add_argument("--only", default="", help="only names starting with this")
    a = ap.parse_args()
    if not a.url:
        ap.error("set GRAMPS_URL or pass --url")
    user = a.user or input("Gramps Web user name: ")
    r = httpx.post(f"{a.url}/api/token/", json={"username": user, "password": getpass.getpass("Password: ")}, timeout=60)
    if r.status_code != 200:
        raise SystemExit("Login failed.")
    g = Gramps(a.url, r.json()["access_token"])

    tag = next((t["handle"] for t in await g.get("/tags/", keys="handle,name") if t["name"] == a.tag), None)
    if not tag:
        raise SystemExit(f'No tag "{a.tag}": the tree has made no places.')
    mine = [p for p in await g.get("/places/", keys="handle,name,tag_list")
            if tag in (p.get("tag_list") or []) and p["name"]["value"].startswith(a.only)]
    print(f"Checking {len(mine)} places the tree made…")
    unused = [p for p in mine if not await g.in_use("places", p["handle"])]
    if not unused:
        return print("Nothing to clean up.")
    for p in sorted(unused, key=lambda p: p["name"]["value"].lower()):
        print(f'  {p["name"]["value"]}')
    if input(f"Delete these {len(unused)} unused places? Type yes: ").strip().lower() != "yes":
        return print("Nothing deleted.")
    done = 0
    for p in unused:
        if not await g.in_use("places", p["handle"]):  # check again: someone may have used it meanwhile
            await g.delete(f"/places/{p['handle']}")
            done += 1
    print(f"Deleted {done}.")


if __name__ == "__main__":
    asyncio.run(main())
