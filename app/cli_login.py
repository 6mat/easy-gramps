"""Logging in for the command-line tools (remove_tag.py, unused_places.py), as an Editor or Owner.

With a Gramps Web name and password, or, for people who sign in with Google (or another sign-in
button), with the login a browser already has: Gramps Web keeps it in the page's storage, and the
tool asks for it. The login is only kept in memory and never printed.
"""
# ruff: noqa: ASYNC250  (a command-line tool: waiting for the user is the point)
import getpass
import time

from gramps import Gramps, shared_client

BROWSER_STEPS = """
To use the login from your browser (for Google or another sign-in button):
  1. On a computer, open Gramps Web and log in as usual.
  2. Press F12 (or right-click the page -> Inspect) and choose "Console".
  3. Type   localStorage.refresh_token   and press Enter.
  4. Copy what it shows, without the quote marks, and paste it below (it stays hidden).
"""


class Login:
    """A logged-in Gramps Web API (`.g`); `await renew()` keeps the 15-minute login fresh."""
    def __init__(self, url: str, access: str, refresh: str):
        self.url, self.refresh, self.at = url, refresh, time.time()
        self.g = Gramps(url, access)

    async def renew(self):
        if time.time() - self.at < 600:
            return
        r = await shared_client(self.url).post("/token/refresh/", headers={"Authorization": f"Bearer {self.refresh}"})
        if r.status_code != 200:
            raise SystemExit("The login ran out and couldn't be renewed. Start again; the work done so far is kept.")
        self.g = Gramps(self.url, r.json()["access_token"])
        self.at = time.time()


async def login(url: str, user: str | None = None) -> Login:
    http = shared_client(url)
    if user is None:
        user = input("Gramps Web user name (leave empty if you log in with Google): ").strip()
    if user:
        r = await http.post("/token/", json={"username": user, "password": getpass.getpass("Password: ")})
        if r.status_code != 200:
            raise SystemExit("Login failed: check the name and password.")
        t = r.json()
        return Login(url, t["access_token"], t["refresh_token"])
    print(BROWSER_STEPS)
    refresh = getpass.getpass("Paste it here: ").strip().strip("'\"")
    r = await http.post("/token/refresh/", headers={"Authorization": f"Bearer {refresh}"})
    if r.status_code != 200:
        raise SystemExit("That login didn't work. Log in to Gramps Web again in the browser and copy it again.")
    return Login(url, r.json()["access_token"], refresh)
