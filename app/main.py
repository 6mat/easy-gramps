"""A simple family-tree view and editor in front of Gramps Web.

Users log in with their Gramps Web account; every read and write goes to Gramps Web
with that user's own token, so Gramps permissions still apply.
"""
import asyncio
import hashlib
import html
import io
import json
import os
import pathlib
import re
import smtplib
import sqlite3
import time
import urllib.parse
from email.message import EmailMessage
from email.utils import formatdate, make_msgid, parseaddr

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageOps
from starlette.background import BackgroundTask
from starlette.middleware.gzip import GZipMiddleware

import chat
import familytree
import gramps
import push

GRAMPS_URL = os.environ["GRAMPS_URL"].rstrip("/")  # how this app reaches Gramps Web (can be an internal Docker URL)
GRAMPS_PUBLIC_URL = os.environ.get("GRAMPS_PUBLIC_URL", "").rstrip("/") or GRAMPS_URL  # what users' browsers open
GRAMPS_LINK_LABEL = os.environ.get("GRAMPS_LINK_LABEL", "Full Gramps")  # menu link to Gramps Web
# Menu link to this app's source code (AGPL: people using a modified copy over the network must be
# offered its source). Point it at your own repository if you run a changed version.
SOURCE_URL = os.environ.get("SOURCE_URL", "").strip() or "https://github.com/6mat/easy-gramps"
DEBUG_LOG_ON = os.environ.get("DEBUG_LOG", "") == "1"  # screen-measurement log for layout bugs; off by default
_base = os.environ.get("BASE_PATH", "/easy-gramps").strip("/")
BASE_PATH = f"/{_base}" if _base else ""  # e.g. /easy-gramps
ROLE_MEMBER, ROLE_CONTRIBUTOR, ROLE_EDITOR, ROLE_OWNER = 1, 2, 3, 4  # Gramps Web roles: see private / add / change / users
DATA = pathlib.Path(os.environ.get("DATA_DIR", "/data"))
# The chat's daily email (unread messages that waited a day). The same names as Gramps Web's own email settings,
# with or without its GRAMPSWEB_ prefix, so one env file can serve both; no host: no emails.
# Port 465: SSL; otherwise STARTTLS when the server offers it.
EMAIL = {k: (os.environ.get(k) or os.environ.get(f"GRAMPSWEB_{k}") or "").strip()
         for k in ("EMAIL_HOST", "EMAIL_PORT", "EMAIL_HOST_USER", "EMAIL_HOST_PASSWORD", "DEFAULT_FROM_EMAIL")}
APP_URL = os.environ.get("APP_URL", "").strip()  # this page's address for links in emails (default: GRAMPS_PUBLIC_URL + BASE_PATH)
STATIC = pathlib.Path(__file__).parent / "static"
# Easy Gramps' own data (chat.py): each login's settings and the family chat, in DATA_DIR/chat.sqlite3.
CHAT = chat.Chat(DATA / "chat.sqlite3")
PUSH = push.Push(DATA / "push-key.pem")  # phone notifications' key (push.py)
NOT_WRITABLE = "The server can't save that: its data folder isn't writable. Ask the family tree's owner."

# The app lives under BASE_PATH (e.g. /easy-gramps) so it can share a domain with Gramps Web.
easy = FastAPI(title="Easy Gramps", docs_url=None, redoc_url=None, openapi_url=None)
upstream = gramps.shared_client(GRAMPS_URL)  # the same connections as every Gramps call
_who_cache: dict[str, tuple[float, dict]] = {}


@easy.middleware("http")
async def revalidate_pages(request: Request, call_next):
    # Pages and scripts are tiny; always revalidate so updates reach phones straight away.
    response = await call_next(request)
    path = request.url.path.removeprefix(BASE_PATH)
    if path == "/" or path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-cache"
    return response


# Sent with every response, so installs without our Traefik setup are covered too. HSTS stays with the TLS proxy.
CSP = "; ".join([
    "default-src 'self'",
    "img-src 'self' data: blob:",  # data: for the favicon and icons, blob: for a photo preview
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
])
SECURITY_HEADERS = {
    "Content-Security-Policy": CSP,
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), fullscreen=(self)",
}


async def security_headers(request: Request, call_next):
    response = await call_next(request)
    for k, v in SECURITY_HEADERS.items():
        response.headers.setdefault(k, v)
    return response


@easy.exception_handler(gramps.GrampsError)
async def gramps_error(_, e: gramps.GrampsError):
    return JSONResponse({"detail": str(e)}, status_code=e.status)


UNREACHABLE = "Can't reach the family tree right now. Please try again in a minute."


@easy.exception_handler(httpx.HTTPError)
async def gramps_unreachable(_, e: httpx.HTTPError):
    # Gramps Web is down or too slow: say so, and never as "please log in" (the page would drop the login).
    return JSONResponse({"detail": UNREACHABLE}, status_code=502)


@easy.exception_handler(chat.ChatError)
async def chat_error(_, e: chat.ChatError):
    return JSONResponse({"detail": str(e)}, status_code=e.status)


@easy.exception_handler(sqlite3.Error)
async def storage_error(_, e: sqlite3.Error):  # e.g. no writable volume at DATA_DIR (the container runs as user 1000)
    gramps.log.error("Storage in %s failed: %s. Give the container a writable volume there.", DATA, e)
    return JSONResponse({"detail": NOT_WRITABLE}, status_code=503)


async def json_body(request: Request) -> dict:
    """The request's JSON object, or a plain 400 (not a 500) when it's missing or not an object."""
    try:
        body = await request.json()
    except ValueError:
        body = None
    if not isinstance(body, dict):
        raise HTTPException(400, "Something was missing. Please try again.")
    return body


def check_login(r: httpx.Response):
    """Only Gramps saying the login is bad means "log in again"; anything else is Gramps having trouble."""
    if r.status_code in (401, 403, 422):
        raise HTTPException(401, "Please log in again")
    if r.status_code != 200:
        raise HTTPException(502, UNREACHABLE)


# ---------- auth ----------

def bearer(request: Request) -> str:
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        raise HTTPException(401, "Please log in")
    return auth[7:]


NO_ACCESS = "Your account can't open the family tree yet. Ask the family tree's owner to let you in."


async def who(request: Request) -> dict:
    token = bearer(request)
    key = hashlib.sha256(token.encode()).hexdigest()  # don't keep raw tokens in memory
    hit = _who_cache.get(key)
    if hit and hit[0] > time.time():
        return hit[1]
    r = await upstream.get("/users/-/", headers={"Authorization": f"Bearer {token}"})
    if r.status_code == 403:  # a good login Gramps won't let in (yet): not "log in again", which would log
        raise HTTPException(403, NO_ACCESS)  # them out of Gramps Web too when the login is shared
    check_login(r)
    user = r.json()
    if user.get("role", 0) < 0:  # Gramps: -1 disabled, -2 not confirmed yet
        raise HTTPException(403, NO_ACCESS)
    user["can_view_private"] = user.get("role", 0) >= ROLE_MEMBER
    user["can_add"] = user.get("role", 0) >= ROLE_CONTRIBUTOR
    user["can_edit"] = user.get("role", 0) >= ROLE_EDITOR
    user["gramps_link"] = {"url": GRAMPS_PUBLIC_URL, "label": GRAMPS_LINK_LABEL}
    now = time.time()
    if len(_who_cache) > 500:  # drop expired entries so the cache can't grow forever
        for k in [k for k, (until, _) in _who_cache.items() if until < now]:
            del _who_cache[k]
    _who_cache[key] = (now + 60, user)
    return user


# Failed logins per visitor. Gramps limits /api/token/ per IP, and every login through this app comes
# from this app's IP, so without our own per-visitor limit one person could lock everyone out.
# The visitor's IP is X-Forwarded-For when uvicorn trusts the proxy (FORWARDED_ALLOW_IPS).
LOGIN_LIMITS = ((60, 3, "Too many tries. Please wait a minute and try again."),
                (3600, 5, "Too many tries. Please wait an hour and try again."),
                (86400, 7, "Too many tries. Please try again tomorrow."))
_failed_logins: dict[str, list[tuple[float, str]]] = {}  # visitor -> (time, user name) of each wrong try


def login_blocked(ip: str) -> str | None:
    now = time.time()
    if len(_failed_logins) > 5000:  # keep memory bounded: forget visitors with nothing in the last day
        for k in [k for k, v in _failed_logins.items() if not v or now - v[-1][0] > 86400]:
            del _failed_logins[k]
    tries = [x for x in _failed_logins.get(ip, []) if now - x[0] < 86400]
    _failed_logins[ip] = tries
    return next((msg for window, limit, msg in LOGIN_LIMITS if sum(now - t < window for t, _ in tries) >= limit), None)


# What the login screen offers, from Gramps Web's own settings: its sign-in buttons (e.g. Google) and
# whether password login is on. Asked before anyone is logged in, so it's kept for a few minutes.
_login_options = {"until": 0.0, "value": {"password": True, "providers": []}}


@easy.get("/auth/options")
async def login_options():
    if _login_options["until"] < time.time():
        try:
            r = await upstream.get("/oidc/config/")
            c = r.json() if r.status_code == 200 else None
        except (httpx.HTTPError, ValueError):
            c = None
        if c is not None:
            on = bool(c.get("enabled"))
            _login_options["value"] = {
                "password": not (on and c.get("disable_local_auth")),
                "providers": [{"id": str(x.get("id", "")), "name": str(x.get("name", ""))} for x in c.get("providers") or []] if on else []}
        _login_options["until"] = time.time() + (600 if c is not None else 30)  # try again soon after a failure
    return _login_options["value"]


@easy.post("/auth/login")
async def login(request: Request):
    ip = request.client.host if request.client else "?"
    if msg := login_blocked(ip):
        raise HTTPException(429, msg)
    body = await json_body(request)
    creds = {"username": str(body.get("username") or "").strip(), "password": str(body.get("password") or "")}
    r = await upstream.post("/token/", json=creds)
    if r.status_code == 429:  # Gramps allows one login a second for the whole app: wait and try once more
        await asyncio.sleep(1.2)
        r = await upstream.post("/token/", json=creds)
    if r.status_code == 429:
        raise HTTPException(429, LOGIN_LIMITS[0][2])
    if r.status_code >= 500:
        raise HTTPException(502, UNREACHABLE)
    if r.status_code != 200:
        _failed_logins.setdefault(ip, []).append((time.time(), creds["username"].lower()))
        raise HTTPException(401, "That name or password didn't work")
    # Forget only this name's wrong tries: logging in as yourself must not reset guesses at someone else.
    _failed_logins[ip] = [x for x in _failed_logins.get(ip, []) if x[1] != creds["username"].lower()]
    return r.json()


@easy.post("/auth/refresh")
async def refresh(request: Request):
    r = await upstream.post("/token/refresh/", headers={"Authorization": f"Bearer {bearer(request)}"})
    check_login(r)
    return r.json()


# Photos are <img> tags, which can't send the login header. Instead of putting the token in the
# URL (where it ends up in logs and history), the page asks for an HttpOnly cookie that only the
# thumbnail route ever receives. The page renews it after every login and token refresh.
PHOTO_COOKIE = "eg_photo"


@easy.post("/auth/session")
async def photo_session(request: Request):
    await who(request)
    response = JSONResponse({"ok": True})
    secure = request.url.scheme == "https" or request.url.hostname in ("localhost", "127.0.0.1")
    response.set_cookie(PHOTO_COOKIE, bearer(request), max_age=86400, path=f"{BASE_PATH}/gapi/",
                        httponly=True, secure=secure, samesite="strict")
    return response


@easy.delete("/auth/session")
async def photo_session_end():
    response = JSONResponse({"ok": True})
    response.delete_cookie(PHOTO_COOKIE, path=f"{BASE_PATH}/gapi/")
    return response


@easy.get("/auth/me")
async def me(request: Request):
    user = dict(await who(request))
    try:
        user["settings"] = CHAT.settings(user.get("name"))
    except sqlite3.Error as e:  # (the page still opens, with the usual settings)
        gramps.log.error("Can't read settings in %s: %s", DATA, e)
        user["settings"] = {}
    user["chat_email"] = bool(EMAIL["EMAIL_HOST"])  # the Menu offers the daily email switch
    try:
        user["push_key"] = PUSH.public_key() if push_contact() else None  # and "Notify me on this device"
    except (OSError, ValueError) as e:
        gramps.log.error("No key for notifications in %s: %s", DATA, e)
        user["push_key"] = None
    user["site"] = site()
    if user.get("role", 0) < GRAMPS_FOR[user["site"]["gramps"]]:
        user.pop("gramps_link", None)  # (also the editors' "Open in Full Gramps ↗" links)
    if user.get("role", 0) >= ROLE_OWNER:
        user["joined"] = await let_in(bearer(request))
    return user


# ---------- the owner's site settings: the menu, the Full Gramps link, the app's name and icon ----------
MENU_ITEMS = ("theme", "display", "dates", "you", "install", "docs", "tips", "keys", "source")  # what the owner may hide
GRAMPS_FOR = {"everyone": 0, "editors": ROLE_EDITOR, "owner": ROLE_OWNER, "nobody": 99}  # who sees the Full Gramps link


def site() -> dict:
    try:
        return CHAT.site()
    except sqlite3.Error as e:  # the page still opens, as it comes
        gramps.log.error("Can't read site settings in %s: %s", DATA, e)
        return dict(chat.SITE)


async def need_owner(request: Request):
    if (await who(request)).get("role", 0) < ROLE_OWNER:
        raise HTTPException(403, "Only the owner can change this.")


@easy.put("/site")
async def save_site(request: Request):
    await need_owner(request)
    body, changes = await json_body(request), {}
    if "name" in body:
        name = " ".join(str(body["name"] or "").split())
        if not 0 < len(name) <= 40:
            raise HTTPException(400, "The name needs 1 to 40 letters.")
        changes["name"] = name
    if "hide" in body:
        if not isinstance(body["hide"], list) or not set(body["hide"]) <= set(MENU_ITEMS):
            raise HTTPException(400, "Something was missing. Please try again.")
        changes["hide"] = [x for x in MENU_ITEMS if x in body["hide"]]
    if "gramps" in body:
        if body["gramps"] not in GRAMPS_FOR:
            raise HTTPException(400, "Something was missing. Please try again.")
        changes["gramps"] = body["gramps"]
    return CHAT.save_site(changes)


@easy.put("/site/icon")
async def save_icon(request: Request):
    await need_owner(request)
    body = await request.body()
    if len(body) > 10_000_000:
        raise HTTPException(413, "That picture is too big (10 MB at most).")
    await asyncio.to_thread(store_icon, body)
    return {"version": icon_master()["version"]}


def store_icon(body: bytes):
    try:
        with Image.open(io.BytesIO(body)) as im:
            im = ImageOps.exif_transpose(im).convert("RGBA")
            im = ImageOps.fit(im, (min(min(im.size), 1024),) * 2)  # a square from the middle, at most 1024 px
            buf = io.BytesIO()
            im.save(buf, "PNG", optimize=True)  # stored as a fresh PNG: nothing of the upload but its pixels
    except (OSError, ValueError, Image.DecompressionBombError):
        raise HTTPException(400, "That isn't a picture this app can read. Try a PNG or JPG.") from None
    DATA.mkdir(parents=True, exist_ok=True)
    tmp = ICON_UPLOAD.with_suffix(".tmp")
    tmp.write_bytes(buf.getvalue())
    tmp.replace(ICON_UPLOAD)


@easy.delete("/site/icon")
async def default_icon(request: Request):
    await need_owner(request)
    await asyncio.to_thread(ICON_UPLOAD.unlink, missing_ok=True)
    return {"version": icon_master()["version"]}


# ---------- invites: editors send the link; the owner can also give an email a role and person ----------
# A first Google sign-in makes a disabled Gramps Web account (no login token until the owner lets them in), so the
# invite is applied from the owner's side: the next time the owner opens the app, by the email the account has.

async def let_in(token: str) -> list[dict]:
    """Invited people who have signed in since: give them the invite's role and person."""
    try:
        waiting = {i["email"]: i for i in CHAT.invites()}
        if not waiting:
            return []
        auth = {"Authorization": f"Bearer {token}"}
        r = await upstream.get("/users/", headers=auth)
        r.raise_for_status()
        out = []
        for u in r.json():
            inv = waiting.get((u.get("email") or "").strip().lower())
            if not inv or u.get("role", 0) >= 0:  # only accounts still waiting for approval
                continue
            p = await upstream.put(f"/users/{urllib.parse.quote(u['name'], safe='')}/", json={"role": inv["role"]}, headers=auth)
            p.raise_for_status()
            CHAT.joined(inv["email"], u["name"])
            try:
                CHAT.link(u["name"], inv["person"])
            except chat.ChatError:  # someone else is linked to that person already: Find me is still there
                pass
            out.append({"name": u.get("full_name") or u["name"], "person": inv["person"], "role": inv["role"]})
        return out
    except (httpx.HTTPError, ValueError, KeyError, sqlite3.Error) as e:  # the page opens anyway; tried again next time
        gramps.log.error("Couldn't apply invites: %s", e)
        return []


@easy.post("/invites")
async def invite(request: Request):
    user = await who(request)
    if user.get("role", 0) < ROLE_OWNER:
        raise HTTPException(403, "Only the owner can invite people.")
    body = await json_body(request)
    email, role, person = str(body.get("email") or "").strip().lower(), body.get("role"), body.get("person")
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email) or len(email) > 200:
        raise HTTPException(400, "That doesn't look like an email address.")
    if type(role) is not int or not 0 <= role <= ROLE_EDITOR or not isinstance(person, str) or not 0 < len(person) <= 64:
        raise HTTPException(400, "Something was missing. Please try again.")
    return CHAT.invite(email, person, role, user["name"])


def invite_text(owner: bool) -> str:
    """The invite message; me.js inviteText says the same."""
    return (f"You're invited to join our family tree!\n\nClick here: {app_url()}\n\n"
            "Tap \u201cContinue with Google\u201d to join. No Google account? Message me and I'll make you a login.\n\n"
            f"Note: {'I approve every account' if owner else 'Every account is approved'} by hand, so there might be a short delay. "
            "Once you're in, you can see the family tree, chat with the family and more.\n\n"
            "Please message or call me if you have any questions.\n")


@easy.post("/invites/send")
async def send_invite(request: Request):
    """An editor's "Email": the invite message to one address, from the server's email address (fixed text)."""
    user = await who(request)
    if user.get("role", 0) < ROLE_EDITOR:
        raise HTTPException(403, "Only editors can invite people.")
    if not EMAIL["EMAIL_HOST"]:
        raise HTTPException(400, "This family tree can't send email (no EMAIL_HOST).")
    body = await json_body(request)
    email = str(body.get("email") or "").strip().lower()
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email) or len(email) > 200:
        raise HTTPException(400, "That doesn't look like an email address.")
    site_name, me = site()["name"], user.get("full_name") or user["name"]
    text = f"{invite_text(user.get('role', 0) >= ROLE_OWNER)}\n{me}\n"
    try:
        await asyncio.to_thread(send_mail, email, f"You're invited to {site_name}", text, user.get("email") or "")
    except (smtplib.SMTPException, OSError) as e:
        gramps.log.error("Invite email to %s failed: %s", email, e)
        raise HTTPException(502, "The email couldn't be sent. Try again later, or share the message instead.") from None
    return {"sent": email}


@easy.get("/invites")
async def invites(request: Request):
    if (await who(request)).get("role", 0) < ROLE_OWNER:
        raise HTTPException(403, "Only the owner can invite people.")
    return CHAT.invites()


# ---------- each person's own settings, kept with their login (so they follow the person to every device) ----------

def login_name(user: dict) -> str:
    if not user.get("name"):
        raise HTTPException(400, "Something was missing. Please try again.")
    return user["name"]


@easy.put("/auth/settings")
async def save_settings(request: Request):
    name = login_name(await who(request))
    body = await json_body(request)
    if not ("dates" in body or "emails" in body) or body.get("dates", chat.DATE_FORMATS[0]) not in chat.DATE_FORMATS \
            or not isinstance(body.get("emails", True), bool):
        raise HTTPException(400, "Something was missing. Please try again.")
    return CHAT.save_settings(name, {k: body[k] for k in ("dates", "emails") if k in body})


# ---------- "Find me": each login linked to its own person in the tree ----------
# Kept with the login's settings ("person": handle). Easy Gramps' own link: Gramps Web knows nothing of it.
# Anyone with a login may link themselves (no approval); one login per person; editors can unlink anyone.

@easy.put("/auth/me/person")
async def claim_person(request: Request):
    name = login_name(await who(request))
    handle = (await json_body(request)).get("person")
    if not isinstance(handle, str) or not handle.replace("-", "").isalnum():
        raise HTTPException(400, "Something was missing. Please try again.")
    await gramps.Gramps(GRAMPS_URL, bearer(request)).get(f"/people/{handle}", keys="handle")  # 404 if not in the tree
    return CHAT.link(name, handle)  # (a new link replaces their old one)


@easy.delete("/auth/me/person")
async def unclaim_person(request: Request):
    return CHAT.link(login_name(await who(request)), None)


@easy.get("/tree/logins")
async def tree_logins(request: Request):
    """Who is linked to a login: the login names for editors, only who has one for everyone else."""
    editor = (await who(request)).get("can_edit")
    return {p: (n if editor else "") for n, p in CHAT.linked().items()}


@easy.delete("/tree/logins/{handle}")
async def tree_unlink_login(handle: str, request: Request):
    await need_edit(request, "Only editors can unlink a login.")
    return {"unlinked": CHAT.unlink_person(handle)}


# ---------- family tree ----------

async def gramps_as(request: Request) -> gramps.Gramps:
    """The Gramps Web API as the logged-in user (after checking the login)."""
    await who(request)
    return gramps.Gramps(GRAMPS_URL, bearer(request))


@easy.get("/tree/graph")
async def tree_graph(request: Request):
    return await familytree.graph(await gramps_as(request))


@easy.get("/tree/recent")
async def tree_recent(request: Request):
    return await familytree.recent_changes(await gramps_as(request))


@easy.get("/tree/documents")
async def tree_documents(request: Request):
    return await familytree.documents(await gramps_as(request))


@easy.get("/tree/places")
async def tree_places(request: Request):
    return await familytree.places(await gramps_as(request))


@easy.get("/tree/details/{handle}")
async def tree_details(handle: str, request: Request):
    d = await familytree.details(await gramps_as(request), handle)
    if not (await who(request)).get("can_edit"):  # contacts are for editors (chat lets the rest reach each other)
        d["contactHidden"] = bool(d["phone"] or d["email"])
        d["phone"] = d["email"] = ""
    return d


TREE_TAG = os.environ.get("TREE_TAG", "")  # a tag on records the tree makes, if you want one (none by default)


_tag = {"handle": None, "until": 0.0}
_tag_lock = asyncio.Lock()


async def tree_tags(g):
    # Looked up (or created) once, under a lock so two first edits can't create the tag twice;
    # re-checked every 10 minutes in case it was renamed or deleted in Gramps Web.
    if not TREE_TAG:
        return []
    async with _tag_lock:
        if not _tag["handle"] or _tag["until"] < time.time():
            _tag.update(handle=await g.tag_handle(TREE_TAG), until=time.time() + 600)
        return [_tag["handle"]]


@easy.patch("/tree/person/{handle}")
async def tree_update_person(handle: str, request: Request):
    await need_edit(request, "Only editors can change details.")
    g = await gramps_as(request)
    changes = await json_body(request)
    return await familytree.update_person(g, handle, changes, await tree_tags(g))


PHOTO_MAX_MB = 20


@easy.post("/tree/person/{handle}/photo")
async def tree_set_photo(handle: str, request: Request):
    # Check rights and size before reading the upload, so nobody can make the server hold big files.
    await need_edit(request, "Only editors can change photos.")
    too_big = HTTPException(413, f"That photo is too big ({PHOTO_MAX_MB} MB at most).")
    if int(request.headers.get("content-length") or 0) > PHOTO_MAX_MB * 1024 * 1024 + 10_000:
        raise too_big
    form = await request.form(max_files=1, max_fields=5)
    main = form.get("main") != "0"  # main=0: one more photo, after the others
    f = form.get("photo")
    if not hasattr(f, "read"):
        raise HTTPException(400, "Please choose a photo")
    if not (f.content_type or "").startswith("image/"):
        raise HTTPException(400, "That file isn't a photo.")
    if (f.size or 0) > PHOTO_MAX_MB * 1024 * 1024:
        raise too_big
    g = await gramps_as(request)
    return await familytree.set_photo(g, handle, (await f.read(), f.content_type, f.filename), await tree_tags(g), main)


@easy.post("/tree/person/{handle}/photos")
async def tree_photo_change(handle: str, request: Request):
    await need_edit(request, "Only editors can change photos.")
    return await familytree.photo_change(await gramps_as(request), handle, await json_body(request))


async def _tree_call(request, fn, with_tags=True):
    g = await gramps_as(request)
    body = await json_body(request)
    return await (fn(g, body, await tree_tags(g)) if with_tags else fn(g, body))


@easy.post("/tree/person")
async def tree_create_person(request: Request):
    return await _tree_call(request, familytree.create_person)


LINK_REFUSED = "Only editors can link family members. Ask an editor to add them."


async def need_edit(request: Request, message: str):
    # Linking or unlinking always changes an existing person or family, which Gramps allows only for
    # Editors and up. Refuse here, before anything is created, so nothing is left half-done.
    if not (await who(request)).get("can_edit"):
        raise HTTPException(403, message)


@easy.post("/tree/relative")
async def tree_add_relative(request: Request):
    await need_edit(request, LINK_REFUSED)
    return await _tree_call(request, familytree.add_relative)


@easy.post("/tree/unlink")
async def tree_unlink(request: Request):
    await need_edit(request, LINK_REFUSED)
    return await _tree_call(request, familytree.unlink, with_tags=False)


@easy.post("/tree/undo")
async def tree_undo(request: Request):
    await need_edit(request, "Only editors can undo changes to family links.")
    return await _tree_call(request, familytree.undo)


@easy.post("/tree/families/merge")
async def tree_merge_families(request: Request):
    await need_edit(request, "Only editors can combine families.")
    return await _tree_call(request, familytree.merge_families, with_tags=False)


@easy.post("/tree/merge")
async def tree_merge(request: Request):
    await need_edit(request, "Only people with edit rights can merge")
    body = await json_body(request)
    res = await _tree_call(request, familytree.merge)
    if isinstance(body.get("keep"), str) and isinstance(body.get("absorb"), str):
        CHAT.move_person(body["absorb"], body["keep"])  # their login link and the talk about them
    return res


# ---------- family chat (chat.py): text only, in DATA_DIR/chat.sqlite3, for every login ----------

async def chat_user(request: Request) -> tuple[str, bool]:
    user = await who(request)
    name = user.get("name")
    if not name:
        raise HTTPException(403, NO_ACCESS)
    CHAT.seen(name, user.get("email"), user.get("full_name"), user.get("can_view_private"))
    if EMAIL["EMAIL_HOST"] and not _mailer:
        _mailer.append(asyncio.create_task(mail_loop()))
    return name, bool(user.get("can_edit"))  # editors and the owner make groups and delete any message


# ----- the daily email -----
_mailer: list = []  # the background task, started with the first chat request


async def mail_loop():
    while True:
        await asyncio.sleep(3600)  # every hour: anyone whose messages have waited a day (at most one email a day each)
        try:
            await asyncio.to_thread(send_waiting)
        except Exception:  # noqa: BLE001 - keep the loop alive; the next hour tries again
            gramps.log.exception("Chat emails failed")


def send_waiting(now: float | None = None) -> int:
    now = now or time.time()
    names = CHAT.full_names()
    sent = 0
    for u in CHAT.waiting(now):
        subject, body = waiting_email(u, names)
        try:
            send_mail(u["email"], subject, body)
        except (smtplib.SMTPException, OSError) as e:  # one bad address mustn't stop the others (the next hour tries again)
            gramps.log.warning("Chat email to %s failed: %s", u["login"], e)
            continue
        CHAT.emailed(u["login"], now, max(m["id"] for m in u["messages"]))
        sent += 1
    return sent


def waiting_email(u: dict, names: dict) -> tuple[str, str]:
    groups: dict = {}
    for m in u["messages"]:
        if m["kind"] == "private":
            title = f"Private, from {names.get(m['login'], m['login'])}"
        elif m["kind"] == "person":
            title = f"About {m['name']}" if m["name"] else "About someone in the tree"
        else:
            title = m["name"] or "Whole family"
        groups.setdefault(title, []).append(m)
    n = len(u["messages"])
    lines = [f"Hello {u['name']},", "", "These messages in the family chat have been waiting for you since yesterday or longer:", ""]
    for title, ms in groups.items():
        lines.append(title)
        for m in ms[:5]:
            text = " ".join(m["text"].split())
            lines.append(f"  {names.get(m['login'], m['login'])}: {text[:300]}{'…' if len(text) > 300 else ''}")
        if len(ms) > 5:
            lines.append(f"  … and {len(ms) - 5} more")
        lines.append("")
    lines += [f"Open the family chat: {app_url()}", "",
              "You get at most one email a day, only for messages you haven't seen.",
              "To stop these emails: ☰ Menu → You, in the family tree."]
    return f"{n} {'message is' if n == 1 else 'messages are'} waiting for you in the family chat", "\n".join(lines)


def send_mail(to: str, subject: str, body: str, reply_to: str = ""):
    msg = EmailMessage()
    msg.set_content(body)
    msg["Subject"], msg["To"] = subject, to
    if reply_to:
        msg["Reply-To"] = reply_to
    msg["From"] = EMAIL["DEFAULT_FROM_EMAIL"] or EMAIL["EMAIL_HOST_USER"]
    msg["Message-ID"], msg["Date"] = make_msgid(), formatdate(localtime=True)
    port = int(EMAIL["EMAIL_PORT"] or 465)
    smtp = smtplib.SMTP_SSL(EMAIL["EMAIL_HOST"], port, timeout=20) if port == 465 else smtplib.SMTP(EMAIL["EMAIL_HOST"], port, timeout=20)
    with smtp:
        smtp.ehlo()
        # The password never goes unencrypted: with a login, a server that doesn't offer STARTTLS is an error.
        if port != 465 and (EMAIL["EMAIL_HOST_USER"] or smtp.has_extn("starttls")):
            smtp.starttls()
        if EMAIL["EMAIL_HOST_USER"]:
            smtp.login(EMAIL["EMAIL_HOST_USER"], EMAIL["EMAIL_HOST_PASSWORD"])
        smtp.send_message(msg)


def app_url() -> str:
    return APP_URL or f"{GRAMPS_PUBLIC_URL}{BASE_PATH}/"


# ----- phone notifications (push.py): each new message, to the devices of everyone who may read it -----
_pushing: set = set()  # the running sends (a task nobody holds can be dropped before it finishes)


def notify(cid: int, login: str, text: str):
    task = asyncio.create_task(push_new(cid, login, text))
    _pushing.add(task)
    task.add_done_callback(_pushing.discard)


async def push_new(cid: int, login: str, text: str):
    try:
        devices = CHAT.devices(cid, login)
        if not devices:
            return
        c, writer = CHAT.conv(cid), CHAT.full_names().get(login, login)
        title = {"family": "Whole family", "group": c["name"], "private": writer,
                 "person": f"About {c['name'] or 'someone in the tree'}"}[c["kind"]]
        body = text[:200] if c["kind"] == "private" else f"{writer}: {text[:200]}"
        data = json.dumps({"title": title, "body": body, "conv": cid}).encode()
        for url in await PUSH.send(devices, data, push_contact()):
            CHAT.remove_device(url)  # switched off in the browser, or the app was removed
    except Exception:  # noqa: BLE001 - the message is saved; only its notification is lost
        gramps.log.exception("Chat notifications failed")


def push_contact() -> str:
    """Who push services can contact about our notifications: the email address, else this page if it's https
    ("": neither, as on a test install over http, so no notifications)."""
    addr = parseaddr(EMAIL["DEFAULT_FROM_EMAIL"] or EMAIL["EMAIL_HOST_USER"])[1]
    page = urllib.parse.urlsplit(app_url())
    return f"mailto:{addr}" if "@" in addr else f"https://{page.netloc}" if page.scheme == "https" else ""


BAD_DEVICE = "This browser can't get notifications from the family tree."


@easy.put("/chat/push")
async def chat_push_on(request: Request):
    """This device wants notifications: its pushManager subscription {endpoint, keys: {p256dh, auth}}."""
    login, _ = await chat_user(request)
    body = await json_body(request)
    endpoint, keys = body.get("endpoint"), body.get("keys") if isinstance(body.get("keys"), dict) else {}
    device = {"endpoint": endpoint, "keys": {k: keys.get(k) for k in ("p256dh", "auth")}}
    if not (push_contact() and push.push_address(endpoint) and len(endpoint) < 1000
            and all(isinstance(v, str) and 0 < len(v) < 200 for v in device["keys"].values())):
        raise HTTPException(400, BAD_DEVICE)
    try:
        PUSH.request(device, b"check", push_contact())  # keys that can't be used: refused now, not at every message
    except Exception:  # noqa: BLE001 - whatever the encryption says, the keys are bad
        raise HTTPException(400, BAD_DEVICE) from None
    CHAT.add_device(login, endpoint, device["keys"])
    return {"ok": True}


@easy.delete("/chat/push")
async def chat_push_off(request: Request):
    login, _ = await chat_user(request)
    endpoint = (await json_body(request)).get("endpoint")
    if isinstance(endpoint, str):
        CHAT.remove_device(endpoint, login)
    return {"ok": True}


@easy.get("/chat")
async def chat_list(request: Request):
    login, editor = await chat_user(request)
    out = CHAT.summary(login)
    out.update(me=login, editor=editor, people=CHAT.linked(), logins=CHAT.logins(), emoji=chat.EMOJI)
    return out


@easy.get("/chat/c/{cid}")
async def chat_messages(cid: int, request: Request, after: int = 0):
    login, _ = await chat_user(request)
    return CHAT.messages(cid, login, after)


@easy.post("/chat/c/{cid}")
async def chat_post(cid: int, request: Request):
    login, _ = await chat_user(request)
    m = CHAT.post(cid, login, (await json_body(request)).get("text"))
    notify(cid, login, m["text"])
    return m


@easy.delete("/chat/m/{mid}")
async def chat_delete_message(mid: int, request: Request):
    login, editor = await chat_user(request)
    return CHAT.delete(mid, login, editor)


@easy.post("/chat/groups")
async def chat_new_group(request: Request):
    login, editor = await chat_user(request)
    if not editor:
        raise HTTPException(403, "Only editors can make groups.")
    body = await json_body(request)
    return {"id": CHAT.make_group(login, body.get("name"), body.get("emoji"), body.get("members"))}


@easy.post("/chat/c/{cid}/join")
async def chat_join(cid: int, request: Request):
    login, _ = await chat_user(request)
    CHAT.join(cid, login, bool((await json_body(request)).get("join")))
    return {"ok": True}


@easy.delete("/chat/c/{cid}")
async def chat_delete_group(cid: int, request: Request):
    _, editor = await chat_user(request)
    if not editor:
        raise HTTPException(403, "Only editors can delete a group.")
    CHAT.delete_group(cid)
    return {"ok": True}


@easy.post("/chat/private")
async def chat_private(request: Request):
    """A conversation with one other login: by login name, or by the person they found themselves as."""
    login, _ = await chat_user(request)
    body = await json_body(request)
    other = body.get("login")
    if body.get("person"):
        other = next((n for n, h in CHAT.linked().items() if h == body["person"]), None)
        if not other:
            raise HTTPException(404, "They haven't linked a login to the tree yet.")
    if not isinstance(other, str):
        raise HTTPException(400, "Pick someone to write to.")
    return {"id": CHAT.private(login, other)}


@easy.get("/chat/person/{handle}")
async def chat_about(handle: str, request: Request, limit: int = 2):
    """The last few messages about a person (for their details panel); doesn't count as read."""
    login, _ = await chat_user(request)
    cid = CHAT.person_conv(handle, False)
    if not cid:
        return {"id": None, "count": 0, "messages": []}
    msgs = CHAT.messages(cid, login, 0, 200, False)
    return {"id": cid, "count": sum(not m["deleted"] for m in msgs), "messages": msgs[-max(0, min(limit, 20)):]}


@easy.post("/chat/person/{handle}")
async def chat_about_post(handle: str, request: Request):
    """Write about a person: their conversation starts with the first message."""
    login, _ = await chat_user(request)
    text = chat.clean_text((await json_body(request)).get("text"))
    if not handle.replace("-", "").isalnum():
        raise HTTPException(400, "Something was missing. Please try again.")
    p = await gramps.Gramps(GRAMPS_URL, bearer(request)).get(f"/people/{handle}", keys="primary_name,private")  # 404 if not in the tree
    pn = (p or {}).get("primary_name") or {}
    person_name = " ".join(x for x in (pn.get("first_name"), *(s.get("surname") for s in pn.get("surname_list") or [])) if x)
    cid = CHAT.person_conv(handle, True, person_name, bool((p or {}).get("private")))
    m = CHAT.post(cid, login, text)
    notify(cid, login, m["text"])
    return {"id": cid, "message": m}


# ---------- screen diagnostics (tree page with ?debug) ----------

DEBUG_LOG = DATA / "debug.log"


@easy.post("/debug/log")
async def debug_log(request: Request):
    if not DEBUG_LOG_ON:
        raise HTTPException(404, "Not found")
    user = await who(request)
    body = await request.body()
    if len(body) > 20_000:
        raise HTTPException(413, "Too much")
    try:
        info = json.loads(body)
    except ValueError:
        raise HTTPException(400, "Expected JSON") from None
    entry = {"time": time.strftime("%Y-%m-%d %H:%M:%S"), "user": user["name"], "info": info}
    await asyncio.to_thread(append_debug_log, json.dumps(entry) + "\n")
    return {"ok": True}


def append_debug_log(line: str):
    DATA.mkdir(parents=True, exist_ok=True)
    if DEBUG_LOG.exists() and DEBUG_LOG.stat().st_size > 1_000_000:
        DEBUG_LOG.replace(DATA / "debug.log.old")
    with DEBUG_LOG.open("a") as f:
        f.write(line)


# ---------- photo thumbnails (the only Gramps read the page makes directly) ----------

PHOTO_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp", "application/json"}  # json: Gramps' errors


@easy.get("/gapi/media/{handle}/thumbnail/{size}")
async def thumbnail(handle: str, size: int, request: Request):
    return await gramps_thumb(handle, "", size, request)


@easy.get("/gapi/media/{handle}/cropped/{x1}/{y1}/{x2}/{y2}/thumbnail/{size}")
async def cropped_thumbnail(handle: str, x1: int, y1: int, x2: int, y2: int, size: int, request: Request):
    """The part of a picture that is one person (their region in Gramps)."""
    if not all(0 <= v <= 100 for v in (x1, y1, x2, y2)):
        raise HTTPException(400, "Bad thumbnail request")
    return await gramps_thumb(handle, f"/cropped/{x1}/{y1}/{x2}/{y2}", size, request)


async def gramps_thumb(handle: str, crop: str, size: int, request: Request) -> Response:
    if not handle.isalnum() or not 16 <= size <= 1024:
        raise HTTPException(400, "Bad thumbnail request")
    params = {k: v for k, v in request.query_params.items() if k == "square"}
    token = request.cookies.get(PHOTO_COOKIE)
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    r = await upstream.get(f"/media/{handle}{crop}/thumbnail/{size}", params=params, headers=headers)
    keep = {k: v for k, v in r.headers.items() if k.lower() == "cache-control"}
    # Only a plain picture is served as one: never something that could run as a page here (HTML, SVG).
    kind = r.headers.get("content-type", "").split(";")[0].strip().lower()
    keep["content-type"] = kind if kind in PHOTO_TYPES else "application/octet-stream"
    return Response(r.content, status_code=r.status_code, headers=keep)


@easy.get("/gapi/media/{handle}/file")
async def media_file(handle: str, request: Request, name: str = "", download: int = 0):
    """A family document (☰ Menu → Family documents), passed through as it comes. Only a PDF opens in the browser
    (its own viewer); anything else is a download, never a page that could run here (HTML, SVG)."""
    if not handle.isalnum():
        raise HTTPException(400, "Bad file request")
    token = request.cookies.get(PHOTO_COOKIE)
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    r = await upstream.send(upstream.build_request("GET", f"/media/{handle}/file", headers=headers), stream=True)
    if r.status_code != 200:
        await r.aread()
        await r.aclose()
        return Response(r.content, status_code=r.status_code, media_type="application/json")
    kind = r.headers.get("content-type", "").split(";")[0].strip().lower()
    inline = kind == "application/pdf" and not download
    ext = pathlib.PurePath(r.headers.get("content-disposition", "").rsplit("=", 1)[-1].strip('"')).suffix[:10]
    title = " ".join(re.sub(r'[\\/:*?"<>|\x00-\x1f]', "", name).split())[:100] or handle
    keep = {"content-type": kind if inline else "application/octet-stream",
            "content-disposition": f"{'inline' if inline else 'attachment'}; filename*=UTF-8''{urllib.parse.quote(title + ext)}",
            "cache-control": "private, max-age=3600",
            # The page's CSP (object-src 'none') would stop the browser's own PDF viewer; a PDF runs no page code here.
            "content-security-policy": "frame-ancestors 'none'"}
    if "content-length" in r.headers and "content-encoding" not in r.headers:
        keep["content-length"] = r.headers["content-length"]
    return StreamingResponse(r.aiter_bytes(), headers=keep, background=BackgroundTask(r.aclose))


# ---------- install as an app (phone / tablet home screen) ----------
# One square picture makes every icon (ICON_FILE; default the bundled tree). Replace it and the icons
# follow: their addresses carry a version of the picture, so installed phones pick up the new one.
ICON_FILE = pathlib.Path(os.environ.get("ICON_FILE") or STATIC / "icon.png")
ICON_UPLOAD = DATA / "icon.png"  # the owner's own, from Site settings: wins over ICON_FILE
ICON_SIZES = (32, 180, 192, 512)  # browser tab, iPhone, and the two Android asks for
_icons: dict = {}


def icon_master() -> dict:
    path = ICON_UPLOAD if ICON_UPLOAD.exists() else ICON_FILE
    st = path.stat()
    if _icons.get("key") != (path, st.st_mtime_ns, st.st_size):
        data = path.read_bytes()
        _icons.clear()
        _icons.update(key=(path, st.st_mtime_ns, st.st_size), data=data, version=hashlib.sha256(data).hexdigest()[:12])
    return _icons


def icon_png(size: int, maskable: bool) -> bytes:
    m = icon_master()
    if (size, maskable) not in m:
        with Image.open(io.BytesIO(m["data"])) as im:
            im = ImageOps.exif_transpose(im).convert("RGBA")
            im = ImageOps.fit(im, (min(im.size),) * 2)  # a square from the middle
            if maskable:  # Android crops to a circle or rounded square: keep the picture in the middle 80%
                corner = im.getpixel((0, 0))
                out = Image.new("RGBA", (size, size), corner if corner[3] == 255 else (255, 255, 255, 255))
                inner = round(size * 0.8)
                out.alpha_composite(im.resize((inner, inner), Image.LANCZOS), ((size - inner) // 2,) * 2)
            else:
                out = im.resize((size, size), Image.LANCZOS)
        buf = io.BytesIO()
        out.save(buf, "PNG", optimize=True)
        m[(size, maskable)] = buf.getvalue()
    return m[(size, maskable)]


@easy.get("/icon-{size}.png")
async def icon(size: int, maskable: int = 0):
    if size not in ICON_SIZES:
        raise HTTPException(404, "No such icon")
    return Response(icon_png(size, bool(maskable)), media_type="image/png",
                    headers={"Cache-Control": "public, max-age=86400"})


@easy.get("/manifest.webmanifest")
async def manifest():
    v = icon_master()["version"]
    icons = [{"src": f"{BASE_PATH}/icon-{s}.png?{q}v={v}", "sizes": f"{s}x{s}", "type": "image/png", "purpose": purpose}
             for purpose, q in (("any", ""), ("maskable", "maskable=1&")) for s in (192, 512)]
    # Its own id and scope (BASE_PATH), so it's an app of its own next to Gramps Web's (which claims "/").
    name = site()["name"]
    return JSONResponse({"id": f"{BASE_PATH}/", "name": name, "short_name": name,
                         "start_url": f"{BASE_PATH}/", "scope": f"{BASE_PATH}/", "display": "standalone",
                         "background_color": "#f6f3ee", "theme_color": "#f6f3ee", "icons": icons},
                        media_type="application/manifest+json", headers={"Cache-Control": "no-cache"})


@easy.get("/sw.js")
async def service_worker():  # served from BASE_PATH (not /static) so it may look after the whole app
    return Response((STATIC / "sw.js").read_text(), media_type="text/javascript", headers={"Cache-Control": "no-cache"})


# ---------- pages ----------
APP_VERSION = os.environ.get("APP_VERSION") or "dev"  # set by the release build (Dockerfile ARG VERSION), shown in the Menu

def page(name: str) -> HTMLResponse:
    text = (STATIC / name).read_text().replace("__BASE__", BASE_PATH).replace("__ICONV__", icon_master()["version"])
    text = text.replace("__GRAMPS__", html.escape(GRAMPS_PUBLIC_URL, quote=True)).replace("__NAME__", html.escape(site()["name"], quote=True))
    text = text.replace("__VERSION__", html.escape(APP_VERSION))
    return HTMLResponse(text.replace("__SOURCE__", html.escape(SOURCE_URL, quote=True)))


@easy.get("/")
async def index():
    return page("tree.html")


easy.mount("/static", StaticFiles(directory=STATIC), name="static")

if BASE_PATH:
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    @app.get("/")
    async def to_base():
        return RedirectResponse(f"{BASE_PATH}/")

    @app.get(BASE_PATH)
    async def add_slash():
        return RedirectResponse(f"{BASE_PATH}/")

    app.mount(BASE_PATH, easy)
else:
    app = easy

app.middleware("http")(security_headers)
app.add_middleware(GZipMiddleware, minimum_size=1000)  # the whole-tree JSON shrinks several times over
