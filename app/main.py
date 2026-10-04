"""A simple family-tree view and editor in front of Gramps Web.

Users log in with their Gramps Web account; every read and write goes to Gramps Web
with that user's own token, so Gramps permissions still apply.
"""
import asyncio
import hashlib
import html
import json
import os
import pathlib
import time

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.middleware.gzip import GZipMiddleware

import familytree
import gramps

GRAMPS_URL = os.environ["GRAMPS_URL"].rstrip("/")  # how this app reaches Gramps Web (can be an internal Docker URL)
GRAMPS_PUBLIC_URL = os.environ.get("GRAMPS_PUBLIC_URL", "").rstrip("/") or GRAMPS_URL  # what users' browsers open
GRAMPS_LINK_LABEL = os.environ.get("GRAMPS_LINK_LABEL", "Full Gramps")  # menu link to Gramps Web
# Menu link to this app's source code (AGPL: people using a modified copy over the network must be
# offered its source). Point it at your own repository if you run a changed version.
SOURCE_URL = os.environ.get("SOURCE_URL", "").strip() or "https://github.com/6mat/easy-gramps"
DEBUG_LOG_ON = os.environ.get("DEBUG_LOG", "") == "1"  # screen-measurement log for layout bugs; off by default
_base = os.environ.get("BASE_PATH", "").strip("/")
BASE_PATH = f"/{_base}" if _base else ""  # e.g. /family
ROLE_MEMBER, ROLE_CONTRIBUTOR, ROLE_EDITOR = 1, 2, 3  # Gramps Web roles: see private / can add / can change
DATA = pathlib.Path(os.environ.get("DATA_DIR", "/data"))
STATIC = pathlib.Path(__file__).parent / "static"

# The app lives under BASE_PATH (e.g. /family) so it can share a domain with Gramps Web.
easy = FastAPI(title="Easy Gramps", docs_url=None, redoc_url=None, openapi_url=None)
upstream = httpx.AsyncClient(base_url=f"{GRAMPS_URL}/api", timeout=60, transport=gramps.TRANSPORT)
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


async def who(request: Request) -> dict:
    token = bearer(request)
    key = hashlib.sha256(token.encode()).hexdigest()  # don't keep raw tokens in memory
    hit = _who_cache.get(key)
    if hit and hit[0] > time.time():
        return hit[1]
    r = await upstream.get("/users/-/", headers={"Authorization": f"Bearer {token}"})
    check_login(r)
    user = r.json()
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
_failed_logins: dict[str, list[float]] = {}


def login_blocked(ip: str) -> str | None:
    now = time.time()
    if len(_failed_logins) > 5000:  # keep memory bounded: forget visitors with nothing in the last day
        for k in [k for k, v in _failed_logins.items() if not v or now - v[-1] > 86400]:
            del _failed_logins[k]
    tries = [t for t in _failed_logins.get(ip, []) if now - t < 86400]
    _failed_logins[ip] = tries
    return next((msg for window, limit, msg in LOGIN_LIMITS if sum(now - t < window for t in tries) >= limit), None)


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
        _failed_logins[ip].append(time.time())
        raise HTTPException(401, "That name or password didn't work")
    _failed_logins.pop(ip, None)
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
    return await who(request)


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


@easy.get("/tree/details/{handle}")
async def tree_details(handle: str, request: Request):
    return await familytree.details(await gramps_as(request), handle)


TREE_TAG = os.environ.get("TREE_TAG", "Easy Gramps")  # tag on records the tree's editor creates


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
    f = form.get("photo")
    if not hasattr(f, "read"):
        raise HTTPException(400, "Please choose a photo")
    if not (f.content_type or "").startswith("image/"):
        raise HTTPException(400, "That file isn't a photo.")
    if (f.size or 0) > PHOTO_MAX_MB * 1024 * 1024:
        raise too_big
    g = await gramps_as(request)
    return await familytree.set_photo(g, handle, (await f.read(), f.content_type, f.filename), await tree_tags(g))


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


@easy.post("/tree/merge")
async def tree_merge(request: Request):
    await need_edit(request, "Only people with edit rights can merge")
    return await _tree_call(request, familytree.merge)


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

@easy.get("/gapi/media/{handle}/thumbnail/{size}")
async def thumbnail(handle: str, size: int, request: Request):
    if not handle.isalnum() or not 16 <= size <= 1024:
        raise HTTPException(400, "Bad thumbnail request")
    params = {k: v for k, v in request.query_params.items() if k == "square"}
    token = request.cookies.get(PHOTO_COOKIE)
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    r = await upstream.get(f"/media/{handle}/thumbnail/{size}", params=params, headers=headers)
    keep = {k: v for k, v in r.headers.items() if k.lower() in ("content-type", "cache-control")}
    return Response(r.content, status_code=r.status_code, headers=keep)


# ---------- pages ----------

def page(name: str) -> HTMLResponse:
    text = (STATIC / name).read_text().replace("__BASE__", BASE_PATH)
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
