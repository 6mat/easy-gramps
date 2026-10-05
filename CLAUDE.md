# Easy Gramps — notes for Claude

A simple family-tree front end for Gramps Web, for older, non-technical relatives. FastAPI backend +
one vanilla-JS page. Read `README.md` for what it is and `ROADMAP.md` for **what to work on next**.

## Rules
- **Never put real credentials, tokens, hostnames of private servers, or family data in the repo,
  commits, issues or logs.** Test against the public Gramps Web demo
  (`https://demo.grampsweb.org`, logins `member`/`member`, `contributor`/`contributor`,
  `editor`/`editor`, `owner`/`owner`). It's shared and public: write only throwaway test records.
- Name test records **`ZZTEST …`** and clean up by that name. Never bulk-delete by the `TREE_TAG`
  ("Easy Gramps") — real users' records carry it.
- UI wording is plain and non-technical ("Add a father", "Saved ✓", "Not saved — try again").
- Brainstorm or mock up bigger features before building; the owner answers with numbered picks.
- Small commits, one step each. `VERSION` holds the version; tag releases `vX.Y.Z`.

## Run and check
```
cp .env.example .env    # GRAMPS_URL=https://demo.grampsweb.org for testing
docker compose up -d --build        # http://localhost:8095/family/
node --check app/static/tree.js     # quick syntax check after JS edits
pytest && ruff check app tests      # backend tests (fake Gramps Web in tests/fake_gramps.py)
```
Every screen in a browser: `tests/e2e/screens.mjs` (see README → Tests); `--write` only against the demo.
Without Docker: `pip install -r app/requirements.txt`, then from `app/`:
`GRAMPS_URL=... BASE_PATH=/family DATA_DIR=../data uvicorn main:app --port 8095`.

## Layout
```
app/main.py         FastAPI, mounted under BASE_PATH (/family). Routes: /auth/{login,refresh,me,session,options}, /manifest.webmanifest, /icon-{32,180,192,512}.png (from ICON_FILE), /sw.js,
                    /tree/*, /gapi/media/{h}/thumbnail/{size} (login from the HttpOnly eg_photo cookie), /debug/log (only with DEBUG_LOG=1), / = the page
app/familytree.py   graph, details, per-field update, photo, create, add relative, unlink, undo, recent, merge
app/gramps.py       Gramps Web API client (`Gramps`) + helpers (dates, notes, new person objects, photo upload)
app/static/         tree.html + tree.css, and the page's ES modules (no build step):
                    main.js (entry) · common.js (data + helpers; imports only auth.js) · tree.js (tree, zoom,
                    map, menu, keys, search) · panel.js · editor.js (toast/Undo, autosave, editor, Add dialog)
                    · merge.js · start.js (start screen, login) · auth.js (tokens + api()) · debug.js (?debug)
                    · sw.js (service worker: installable app, "No internet" page, caches nothing) · icon.png (app icon)
deploy/             compose.traefik.yaml — install next to Gramps Web on the same domain
LICENSE             AGPL-3.0-or-later (matches Gramps Web); keep any added dependency compatible
```

## Backend behaviour
- Users log in with their **own Gramps Web account**; their token is passed straight to Gramps, so
  **Gramps enforces permissions** (Guest/Member view, Contributor add, Editor+ change).
  `/auth/me` adds `can_add`, `can_edit`; a login Gramps refuses (403, role < 0) is a 403 "ask the owner",
  never "log in again".
- **Shared login** when the page and `GRAMPS_PUBLIC_URL` (`data-gramps`) are the same origin: auth.js uses
  Gramps Web's own `localStorage` keys (`access_token`, `refresh_token`, plus `access_token_expires`,
  `id_token`); old `eg_*` keys carry over once. Gramps Web's refresh doesn't rotate the refresh token, so
  both apps renew independently. Log out clears both apps' keys; a `storage` event from Gramps Web
  logs this page in or out. `GET /auth/options` (no login) relays Gramps Web's `/api/oidc/config/`:
  sign-in buttons (opened in a pop-up at `/api/oidc/login/?provider=…`; Gramps Web then shows its own
  home page there, so the page watches for the login instead of being sent back) and `password: false`
  when Gramps Web disables local login. Other origins keep the `eg_*` keys and the password form. Contributors can add people but not link them (Gramps refuses
  a new family that links an existing person), so add relative / unlink / undo / merge are editors only,
  checked server-side before anything is created; the page hides those buttons for them.
- `GET /tree/graph` — everyone and every family in one response: names, gender, birth/death as
  `{y,m,d,about}`, birthplace, burial, first photo, `fams` in marriage order.
- `GET /tree/details/{h}` — residence, phone, email, notes (loaded on demand).
- `GET /tree/places` — every place `{id, name, area}` for the editor's place boxes.
- `PATCH /tree/person/{h}` — fields `first last nick gender birth birthPlace deceased death burial
  residence phone email notes`. `birthPlace`/`burial` take `{id}` (picked), `{new}` (confirmed) or a
  name (merge: reuses an exact match, else makes it). Unticking deceased removes Death and Burial. Residence/phone go in a
  **private** Address, email in a **private** Url.
- `POST /tree/person/{h}/photo` — upload and make it the main photo.
- `POST /tree/person` — new person with no relatives. `POST /tree/relative` — add father / mother /
  spouse / child (existing or new); refuses a second father/mother **before** creating anyone;
  returns an undo token. `POST /tree/unlink` — removes a link, never deletes people; a family is
  deleted only when it no longer links two people. `POST /tree/undo` reverses either.
- `POST /tree/merge {keep, absorb, fields}` — writes the chosen field values onto `keep`, then Gramps'
  native `POST /api/people/{keep}/merge/{absorb}` with `family_merger: true` (both sets of
  relationships kept; `absorb` deleted). Not covered by Undo.
- `GET /tree/recent` — people by last change, with who changed them (last 80 history entries).
- Deleting a family: first empty it with a PUT so Gramps clears everyone's back-links, then delete.
  Gramps maintains `family_list` / `parent_family_list` itself when families change — relied on.

## Tree design decisions (agreed with the owner — keep them)
**Layout.** Rows are generations: parents (the wife's parents beside the husband's), the person's row,
children. Couples joined by a solid line, **husband left, wife right**; a 2nd wife on the husband's
left (3rd+ arches from the top); mirrored for a woman. Children hang from the **middle of the couple
line** (down, a bar, down to each child), eldest on the left, each family's children under their own
couple; with one parent known the line still starts mid-way to the empty "Add" slot. Siblings sit on
the outer left of the person's row. Children's spouses shown as pairs (not their parents). A small
"hop" where lines cross. One colour per family. Placeholders (Add father/mother/wife/child) have
dotted grey lines. Every box: relation label (FATHER, WIFE (2ND), SON, DAUGHTER-IN-LAW, WIFE'S
FATHER…), photo or tinted initials, name, years, birthplace; the tree's own person is tagged THIS TREE.

**Selection.** Clicking selects (ring) and shows the person in the panel. Title "X's family tree",
"See Y's tree →" on the right, "← Back to X's tree" on the left. **⌂ Family Tree** (top bar, styled as a
button) is Home; the ⌂ Home pill in the title strip shows only in full screen, where the top bar is hidden. Empty-space click reselects
the tree's own person. **Colour tells whose details are shown:** the tree's own person = blue ring,
blue panel edge, blue dotted connector; anyone else = amber (`--sel`). The connector (`#selink`,
`drawSelink()`) always leaves the box from the **bottom**, runs through the row gap and along the panel
edge so it doesn't cross boxes; Menu switch "Line from person to details" hides it.

**Start screen** (no person chosen): "Whose family tree would you like to see?", search, Recently
viewed (this device), Recently changed (anyone, with who/when), + Add a new person (duplicate-name
check). One search only: the top-bar search and the title strip are hidden on the start screen. It must **not** open on an automatic person.

**Panel** floats over the right of the tree card (portrait/<900px: slides up from the bottom). Hide
panel » / ✎ Edit person; photo, name, relation, born/died, clickable Parents/Wives/Children, More
details ▾ (burial, lives in, phone, email, notes); "Is this person in the tree twice?" for editors, a tab pinned to
the panel's bottom edge (own background, top line) so it shows without scrolling (#55).
Fit and centring use only the area not under the panel.

**Controls.** Bottom strip: overview map, − % +, Fit, ⌖ Centre, ⛶ Full screen, Hide controls. Opens at
a readable fit (≥60%). When space is short, button words win over the map. Full screen hides only
the top bar. ☰ Menu: Theme (☀️ Light / 🌙 Dark / ⚙️ Auto segmented control), Bigger text and line
switches, Show tips again, Full Gramps ↗, Log out.

**Touch.** The **page never zooms** (`user-scalable=no`, `touch-action: pan-x pan-y` outside the tree,
Ctrl+wheel blocked outside it) — owner's call. Drag anywhere moves the tree, pinch zooms the tree,
double-tap returns to the opening zoom centred on that person.
**Keys** (not while typing in a box): arrows move between people **and the dotted Add boxes** (↑ parent,
↓ eldest child, ← → row neighbours); Enter edits the person (on an Add box: its pop-up), Space shows the
details; / search, + − zoom, 0 fit, H home; ? (or Menu → Keyboard keys) lists them; Esc steps back
(pop-up → editor → selection; leaves full screen).

**Page address and Back.** `#/p/<tree>[/s/<selected>][/edit/<person>[/add/<person>/<relation>[/<family>]]]`:
a reload comes back to the same tree, selection, editor and Add pop-up. Opening the editor or the
pop-up is a browser-history step, so Back / a phone's back gesture closes them in turn; closing them
with their own buttons steps back over those entries (Back never reopens them).

**Editor** (full screen): Back to tree, Home, Saving…/Saved ✓/Not saved + Try again. Parents on top,
the person's card, spouses beside, children grouped by spouse. Fields: photo, first/last/nickname,
**Male / Female only**, birthday (calendar or "I only know the year"), place of birth, Passed away?
(reveals death date and burial place), More details (residing at, phone, email, notes). Autosave:
typing is saved when you leave the box or pause 2 s; ticks, buttons and the calendar at once; a year
once it has 4 digits. Place boxes list the existing places (with their area) and save only a place
you pick, or a new one after "Add it as a new place" (never one per keystroke, #49). Add pop-up: opens on **Someone new**; "🔍 Pick someone already in the
tree" switches it to the search (← Back returns; typing is kept), one kind of box at a time; **one person
per add**; spouse gender set automatically. ⋯ on a relative: open their family, remove from this
family (editors, with confirmation). Undo shown for 10 s after every add/remove.

**Merge dialog:** find the other copy → 4-column compare (field | KEEP | REMOVE | "Will be saved as");
tap a value to use it; names/places can also be typed, pasted or dragged into the result box;
⇄ swaps which is kept; two-step confirm.

## Known quirks
- Firefox on Android keeps a page pinch-zoom across reloads — the reason page zoom is disabled.
- Emulated taps in Playwright don't produce clicks; tap-to-select on touch is only proven on a real tablet.
- `docker run --env-file` keeps quote marks literally: keep `.env` values unquoted.
