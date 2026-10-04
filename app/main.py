"""A simple family-tree view and editor in front of Gramps Web.

Users log in with their Gramps Web account; every read and write goes to Gramps Web
with that user's own token, so Gramps permissions still apply.
"""
import json
import os
import pathlib
import time

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles

import familytree
import gramps

GRAMPS_URL = os.environ["GRAMPS_URL"].rstrip("/")  # how this app reaches Gramps Web (can be an internal Docker URL)
GRAMPS_PUBLIC_URL = os.environ.get("GRAMPS_PUBLIC_URL", "").rstrip("/") or GRAMPS_URL  # what users' browsers open
GRAMPS_LINK_LABEL = os.environ.get("GRAMPS_LINK_LABEL", "Full Gramps")  # menu link to Gramps Web
DEBUG_LOG_ON = os.environ.get("DEBUG_LOG", "") == "1"  # screen-measurement log for layout bugs; off by default
_base = os.environ.get("BASE_PATH", "").strip("/")
BASE_PATH = f"/{_base}" if _base else ""  # e.g. /family
ROLE_CONTRIBUTOR, ROLE_EDITOR = 2, 3  # Gramps Web roles: can add / can also change existing records
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
    "style-src 'self' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
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


# ---------- auth ----------

def bearer(request: Request) -> str:
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        raise HTTPException(401, "Please log in")
    return auth[7:]


async def who(request: Request) -> dict:
    token = bearer(request)
    hit = _who_cache.get(token)
    if hit and hit[0] > time.time():
        return hit[1]
    r = await upstream.get("/users/-/", headers={"Authorization": f"Bearer {token}"})
    if r.status_code != 200:
        raise HTTPException(401, "Please log in again")
    user = r.json()
    user["can_add"] = user.get("role", 0) >= ROLE_CONTRIBUTOR
    user["can_edit"] = user.get("role", 0) >= ROLE_EDITOR
    user["gramps_link"] = {"url": GRAMPS_PUBLIC_URL, "label": GRAMPS_LINK_LABEL}
    _who_cache[token] = (time.time() + 60, user)
    return user


@easy.post("/auth/login")
async def login(request: Request):
    body = await request.json()
    r = await upstream.post("/token/", json={"username": body.get("username", "").strip(),
                                             "password": body.get("password", "")})
    if r.status_code != 200:
        raise HTTPException(401, "That name or password didn't work")
    return r.json()


@easy.post("/auth/refresh")
async def refresh(request: Request):
    r = await upstream.post("/token/refresh/", headers={"Authorization": f"Bearer {bearer(request)}"})
    if r.status_code != 200:
        raise HTTPException(401, "Please log in again")
    return r.json()


@easy.get("/auth/me")
async def me(request: Request):
    return await who(request)


# ---------- family tree ----------

@easy.get("/tree/graph")
async def tree_graph(request: Request):
    await who(request)
    g = gramps.Gramps(GRAMPS_URL, bearer(request))
    try:
        return await familytree.graph(g)
    finally:
        await g.close()


@easy.get("/tree/recent")
async def tree_recent(request: Request):
    await who(request)
    g = gramps.Gramps(GRAMPS_URL, bearer(request))
    try:
        return await familytree.recent_changes(g)
    finally:
        await g.close()


@easy.get("/tree/details/{handle}")
async def tree_details(handle: str, request: Request):
    await who(request)
    g = gramps.Gramps(GRAMPS_URL, bearer(request))
    try:
        return await familytree.details(g, handle)
    finally:
        await g.close()


TREE_TAG = os.environ.get("TREE_TAG", "Easy Gramps")  # tag on records the tree's editor creates


async def tree_tags(g):
    return [await g.tag_handle(TREE_TAG)] if TREE_TAG else []


@easy.patch("/tree/person/{handle}")
async def tree_update_person(handle: str, request: Request):
    await who(request)
    changes = await request.json()
    g = gramps.Gramps(GRAMPS_URL, bearer(request))
    try:
        return await familytree.update_person(g, handle, changes, await tree_tags(g))
    finally:
        await g.close()


@easy.post("/tree/person/{handle}/photo")
async def tree_set_photo(handle: str, request: Request):
    await who(request)
    form = await request.form()
    f = form.get("photo")
    if not hasattr(f, "read"):
        raise HTTPException(400, "Please choose a photo")
    g = gramps.Gramps(GRAMPS_URL, bearer(request))
    try:
        return await familytree.set_photo(g, handle, (await f.read(), f.content_type, f.filename), await tree_tags(g))
    finally:
        await g.close()


async def _tree_call(request, fn, *args, with_tags=True):
    await who(request)
    body = await request.json()
    g = gramps.Gramps(GRAMPS_URL, bearer(request))
    try:
        return await (fn(g, body, await tree_tags(g)) if with_tags else fn(g, body))
    finally:
        await g.close()


@easy.post("/tree/person")
async def tree_create_person(request: Request):
    return await _tree_call(request, familytree.create_person)


@easy.post("/tree/relative")
async def tree_add_relative(request: Request):
    return await _tree_call(request, familytree.add_relative)


@easy.post("/tree/unlink")
async def tree_unlink(request: Request):
    return await _tree_call(request, familytree.unlink, with_tags=False)


@easy.post("/tree/undo")
async def tree_undo(request: Request):
    return await _tree_call(request, familytree.undo)


@easy.post("/tree/merge")
async def tree_merge(request: Request):
    user = await who(request)
    if not user.get("can_edit"):
        raise HTTPException(403, "Only people with edit rights can merge")
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
    DATA.mkdir(parents=True, exist_ok=True)
    if DEBUG_LOG.exists() and DEBUG_LOG.stat().st_size > 1_000_000:
        DEBUG_LOG.replace(DATA / "debug.log.old")
    try:
        info = json.loads(body)
    except ValueError:
        raise HTTPException(400, "Expected JSON")
    entry = {"time": time.strftime("%Y-%m-%d %H:%M:%S"), "user": user["name"], "info": info}
    with DEBUG_LOG.open("a") as f:
        f.write(json.dumps(entry) + "\n")
    return {"ok": True}


# ---------- photo thumbnails (the only Gramps read the page makes directly) ----------

@easy.get("/gapi/media/{handle}/thumbnail/{size}")
async def thumbnail(handle: str, size: int, request: Request):
    if not handle.isalnum() or not 16 <= size <= 1024:
        raise HTTPException(400, "Bad thumbnail request")
    params = {k: v for k, v in request.query_params.items() if k in ("square", "jwt")}
    headers = {"Authorization": request.headers["authorization"]} if "authorization" in request.headers else {}
    r = await upstream.get(f"/media/{handle}/thumbnail/{size}", params=params, headers=headers)
    keep = {k: v for k, v in r.headers.items() if k.lower() in ("content-type", "cache-control")}
    return Response(r.content, status_code=r.status_code, headers=keep)


# ---------- pages ----------

def page(name: str) -> HTMLResponse:
    return HTMLResponse((STATIC / name).read_text().replace("__BASE__", BASE_PATH))


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
