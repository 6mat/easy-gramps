# Easy Gramps — notes for Claude

A simple family-tree front end for Gramps Web, for older, non-technical relatives. FastAPI backend +
one vanilla-JS page. Read `README.md` for what it is and `ROADMAP.md` for **what to work on next**.

## Rules
- **Never put real credentials, tokens, hostnames of private servers, or family data in the repo,
  commits, issues or logs.** Test against the public Gramps Web demo
  (`https://demo.grampsweb.org`, logins `member`/`member`, `contributor`/`contributor`,
  `editor`/`editor`, `owner`/`owner`). It's shared and public: write only throwaway test records.
- Name test records **`ZZTEST …`** and clean up by that name. Never bulk-delete by a tag: real users'
  records carry "Easy Gramps" (the `TREE_TAG` default before 1.2; now no tag unless one is set).
- UI wording is plain and non-technical ("Add a father", "Saved ✓", "Not saved — try again").
- Brainstorm or mock up bigger features before building; the owner answers with numbered picks.
- Small commits, one step each. `VERSION` holds the version (raise it in the PR). Release with GitHub
  **Actions → Release image → Run workflow** on main: it builds the image, then tags `vX.Y.Z` from `VERSION`
  and publishes the release with that version's CHANGELOG notes. A hand-made tag must match `VERSION`.
  Changes merged without a release go under `## Unreleased` in CHANGELOG; rename it to the version when releasing.
  The release passes `VERSION=vX.Y.Z` into the image (Dockerfile ARG → `APP_VERSION`), shown at the bottom of ☰ Menu.

## Run and check
```
cp .env.example .env    # GRAMPS_URL=https://demo.grampsweb.org for testing
docker compose up -d --build        # http://localhost:8095/easy-gramps/
node --check app/static/tree.js     # quick syntax check after JS edits
pytest && ruff check app tests      # backend tests (fake Gramps Web in tests/fake_gramps.py)
```
Every screen in a browser: `tests/e2e/screens.mjs` (see README → Tests); `--write` only against the demo.
Without Docker: `pip install -r app/requirements.txt`, then from `app/`:
`GRAMPS_URL=... BASE_PATH=/easy-gramps DATA_DIR=../data uvicorn main:app --port 8095`.

## Layout
```
app/main.py         FastAPI, mounted under BASE_PATH (/easy-gramps). Routes: /auth/{login,refresh,me,session,options,settings,me/person}, /manifest.webmanifest, /icon-{32,180,192,512}.png (from ICON_FILE), /sw.js,
                    /tree/* (incl. /tree/logins), /chat/*, /gapi/media/{h}[/cropped/x1/y1/x2/y2]/thumbnail/{size} (the person's region of a picture: graph `crops` {media: rect}; login from the HttpOnly eg_photo cookie), /debug/log (only with DEBUG_LOG=1), / = the page
app/chat.py         Easy Gramps' own data (SQLite in DATA_DIR/chat.sqlite3): each login's settings and Find me link, the chat's
                    conversations, messages, reads, daily-email query, notification devices
app/suggest.py      Suggestions (APIRouter, included by main.py): table `suggestions` in chat.sqlite3; /suggestions, /suggestions/decide,
                    /suggestions/tell, /suggestions/history (with the change log), /suggestions/delete, /suggestions/{id}/undo
app/changes.py      The change log (`import changes as log` in main.py): table `changes`; each direct tree change in words;
                    POST /changes/{id}/undo (admins, role 5)
app/push.py         Web Push for the chat: the server's VAPID key (DATA_DIR/push-key.pem, made on first use), http-ece encryption, send
app/familytree.py   graph, details, per-field update, photo, create, add relative, unlink, undo, recent, merge
app/gramps.py       Gramps Web API client (`Gramps`) + helpers (dates, notes, new person objects, photo upload)
app/static/         tree.html + tree.css, and the page's ES modules (no build step):
                    main.js (entry) · common.js (data + helpers; imports only auth.js) · tree.js (tree, zoom,
                    map, menu, keys, search) · panel.js · editor.js (toast/Undo, autosave, editor, Add dialog)
                    · merge.js · start.js (start screen, login) · search.js (both searches' results) · photos.js
                    (the big photo view) · book.js (a book page in our own PDF viewer, PDF.js in static/pdfjs; editors mark the paragraph) · site.js (☰ Menu → Manage: Suggestions, Waiting to join, Invites, Check dates, the site settings) · suggest.js (suggestions: draft, proposed tree, review, history) · me.js ("Find me") · chat.js (family chat) · auth.js
                    (tokens + api()) · debug.js (?debug)
                    · sw.js (service worker: installable app, "No internet" page, caches nothing) · icon.png (app icon)
app/remove_tag.py, unused_places.py   one-off clean-ups the owner runs on the server (cli_login.py: password
                    or the browser's login for Google users); ask "yes" before changing anything
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
- `GET /tree/details/{h}` — residence, phone, email, notes, work, education (loaded on demand; work/education = the
  description of the first Occupation / Education event, `otherWork`/`otherEducation` the rest).
- `GET /tree/places` — every place `{id, name, area}` for the editor's place boxes.
- `PATCH /tree/person/{h}` — fields `first last nick gender birth birthPlace deceased death burial
  residence phone email notes work education`. `birthPlace`/`burial` take `{id}` (picked), `{new}` (confirmed) or a
  name (merge: reuses an exact match, else makes it). Unticking deceased removes Death and Burial. Residence/phone go in a
  **private** Address, email in a **private** Url. `work`/`education` set the first
  Occupation/Education event's description (made if none; emptied: deleted unless it has a date, place, note or citation).
- `POST /tree/person/{h}/photo` — upload and make it the main photo (`main=0`: add it after the others).
  `POST /tree/person/{h}/photos {media, do: main|remove}` — make one the main photo, or take it off the
  person (the Media stays in Gramps; never deleted). The graph's `photos` lists their pictures, main first.
- `POST /tree/person` — new person with no relatives (`{first, last, nick, gender, birth}`, as `new` in add relative). `POST /tree/relative` — add father / mother /
  spouse / child (existing or new); refuses a second father/mother **before** creating anyone;
  returns an undo token. Adding a father/mother to a one-parent family whose parent is already a couple
with them in another family (any family naming both, even one they don't list) joins that family instead (Gramps' `POST /api/families/{keep}/merge/{absorb}`;
`joined: true`; undo `op: split` moves the children back out). `POST /tree/families/merge {keep, absorb}`
combines the same couple recorded twice (editors; same father and mother). `POST /tree/unlink` — removes a link, never deletes people; a family is
  deleted only when it no longer links two people. `POST /tree/undo` reverses either.
- `POST /tree/merge {keep, absorb, fields}` — writes the chosen field values onto `keep`, then Gramps'
  native `POST /api/people/{keep}/merge/{absorb}` with `family_merger: true` (both sets of
  relationships kept; `absorb` deleted). Not covered by Undo.
- `GET /auth/me` also returns the person's `settings` and `push_key`; `PUT /auth/settings {dates|emails}` saves them
  in chat.sqlite3's `settings` table by Gramps Web user name (follows them to every device; a 1.8.0 `settings.json` is
  imported once and kept as `settings.json.imported`). Storage errors (sqlite3.Error) are one 503 "data folder isn't
  writable" (an exception handler, like GrampsError and ChatError); `/auth/me` still works without them.
- **Find me:** `PUT /auth/me/person {person}` links the login to a person (anyone with a login, no approval;
  409 "Already linked to another login" — one login per person); `DELETE /auth/me/person` unlinks it. Kept as
  `person` in the login's settings (`/auth/me` → `settings.person`; `UNIQUE`, so one login per person). `GET /tree/logins` → `{person: login}`:
  login names for editors, `""` for everyone else; `DELETE /tree/logins/{h}` (editors) unlinks. A person
  merge moves the link to `keep` (dropped if `keep` already has one). Nothing is written to Gramps; on the same site
  me.js also sets Gramps Web's browser-side home person (`grampsjs_settings_tree[tree].homePerson`, Gramps ID; always
  on "Yes, this is me", otherwise only if none is set).
- **Family chat** (`chat.py`, routes `/chat*` in main.py): by Gramps Web login name, for every login (Guests too).
  `GET /chat` → `{convs, unread, me, editor, people (login → person from Find me), logins, emoji}`. Conversations:
  `family` (id 1, everyone, can't be left), `group` (editors make them: `POST /chat/groups`; open: `POST /chat/c/{id}/join
  {join}`; only members read/write; editors `DELETE /chat/c/{id}`), `private` (`POST /chat/private {login|person}`; only
  the two, not even editors), `person` (`GET/POST /chat/person/{h}`, starts with the first message; every login; a
  person merge moves it to `keep`). `GET /chat/c/{id}?after=` marks read; `POST /chat/c/{id} {text}` (≤ 2000);
  `DELETE /chat/m/{id}` own or editor → text gone, "Message deleted" stays; an editor's second DELETE removes the row
  (`{id, removed: true}`). Daily email: hourly task (started by the
  first chat request when `EMAIL_HOST` is set) → `send_waiting()`: unread for a day, not listed before, at most one a
  day per login, off with `PUT /auth/settings {emails: false}`; one failed send doesn't stop the others. SMTP from
  `EMAIL_*` or Gramps Web's `GRAMPSWEB_EMAIL_*`; with a login, STARTTLS is required (never a plain-text password).
  **Privacy:** a person's conversation keeps Gramps' `private` flag (refreshed with every message); logins without
  "view private" (`users.private`, from `can_view_private`) don't get it in the list, messages, email or
  notifications. Logins not seen for 30 days (`chat.ACTIVE`, e.g. disabled in Gramps Web) get no email or
  notifications and aren't listed. Several writes (delete a group, a person merge) run in one transaction (`Chat.tx`).
  **Notifications:** `PUT /chat/push {endpoint, keys}` (only push services' https addresses: `push.PUSH_HOSTS`, so the
  server can't be made to call anywhere else; the keys are tried once) / `DELETE /chat/push {endpoint}` (also on Log
  out). Each new message → `notify()` → a background task sends `{title, body, conv}` to the devices of everyone who
  may read it but the writer; 404/410 forgets the device. `push_key` is offered only when there's a contact for the
  push services (an email address, or an https page). sw.js shows them (one per conversation; none while a window of the app is visible); a tap focuses the page
  (postMessage) or opens `?chat=<id>`.
- **Site settings** (owner): `PUT /site {name ≤ 40, hide ⊆ MENU_ITEMS, gramps: nobody|owner|editors|everyone}`, chat.sqlite3
  `site` (key → JSON, defaults `chat.SITE`); `/auth/me` → `site`, and drops `gramps_link` below `GRAMPS_FOR[gramps]`.
  `PUT /site/icon` (raw picture → square PNG ≤ 1024 px in `DATA_DIR/icon.png`, wins over `ICON_FILE`), `DELETE` = default.
  The name goes into tree.html (`__NAME__`: title, apple title, brand, `data-name` → `APP_NAME`) and the manifest.
  `talk` (bool, default true): off hides "Family talk about …" (panel.js) and `POST /chat/person/{h}` is a 403.
  `labels` {key → text ≤ 40}: renames (main.py `LABELS` = site.js `LABELS`: key, selector, default; `.lbl` gets a
  leading space; empty = default; start.js runs `applySite()` after setting the Full Gramps link text).
  site.js: the dialog, and `applySite()` hides `#menupop [data-item]` (`.sitehidden`; a group with nothing left hides too).
- **Suggestions** (#166, #168; site `suggest`: off | members (roles 1–2) | everyone (0–2), `suggest_send`: auto | manual; `/auth/me` → `can_suggest`, and editors get
  `suggestions` = waiting count while on). The page's role is then `"suggest"`: `canChange()`/`canLink()` are true (fields, Add
  slots, pick existing), photos/unlink/merge stay editors-only, and `canAddNew()` (lone new person) is editors and contributors.
  editor.js `flushSaves` → `draftSet`, `doAdd` → `draftAdd` (suggest.js; the draft is in localStorage `eg_suggestion:<login>`;
  auto: `sendNow()` posts it at once, one send at a time, kept on network errors, dropped on a 4xx refusal). Suggesters' own
  waiting items (`mine`, GET /suggestions) go on their tree with the draft. Server: a set item for a field they already have
  waiting replaces it (keeps its `before`; back to `before` deletes it); stand-ins from their earlier waiting/approved rows count. Items:
  `{op: "set", id, field, value, before, label}` / `{op: "add", person, rel, famId?, new|existing, as?, fam?, label}`; new people
  and families get stand-in ids `new-xxxxxxxx` that later items may use. `POST /suggestions {items, note}` checks the shape,
  that stand-ins are made before use, and that the real people are visible to the suggester; one row per item.
  The tree with suggestions on top: `loadGraph()` calls `S.overlay` (suggest.js), which keeps a copy of Gramps' data (`base`)
  and applies the draft (suggesting) or the checked items plus what they need (`up()`, reviewing, `S.review`); checking redraws from `base`, no fetch. Boxes
  get `sug-new` / `sug-changed`. While reviewing, `renderPanel` shows the list (`S.review.render`), and `canAdd`/`canChange` are off.
  `POST /suggestions/decide {approve, reject}` (editors): oldest first, with the editor's login, through `update_person` /
  `add_relative`; `made` maps stand-ins to real ids; a failing one stays waiting with `error`. Each approved row keeps `undo`:
  the field's earlier value (`familytree.fields_now`, places as `{id}`) or add_relative's undo token. `POST
  /suggestions/{id}/undo` puts it back to waiting (refused while approved items of the batch use the person it made) and
  messages the suggester; decide's message lists each item in words (`_say`). Review (#171): Approve sends `up(checked)`,
  Reject `down(checked)` (what builds on them); checking/unchecking cascades down only. Rows are grouped by family
  (`families()`: the anchor person's own family, else the one they grew up in) and nested under the row whose stand-in they
  use (`giver`). History: `GET /suggestions/history?before=<time>:<s|c>:<id>&login=&kind=` (PAGE = 100, `more`, `who`), same grouping;
  `POST /suggestions/delete {ids}` or `{rejected: "all"}` removes rejected rows only, with the rejected rows that use the
  stand-ins they made. 1.9.4: a resent add (its `fam` stand-in is known) is skipped, not refused; a set on a waiting new
  person's stand-in for `NEW_FIELDS` folds into the add row's `new` (`_fold`; `_tidy` once at start for old rows); `_can_link`
  refuses at send what Gramps would refuse at approval (second father/mother, own waiting one, child with parents, couple
  twice). decide claims each row (`status = 'working'`, reset at start) so a second Approve can't add it twice; the page
  approves one at a time with `quiet` (progress bar) and then `POST /suggestions/tell {approved}` sends one message.
- **Change log / History** (changes.py): main.py routes call `log.add(login, item, undo)` (`_tree_call(say=…)`); PATCH logs
  per field in the background (`log.later(log.fields…)`: `fields_now` before and after; the same login+person+field within
  `JOIN` = 10 min updates the row, back to the start deletes it). Items are shaped like suggestions (`op` set/add/unlink/
  create/merge/combine/other) so suggest.js `says()` shows both. `/tree/undo` marks the row undone. History merges both
  tables (UNION, cursor `time:s|c:id`, `kind` approved|rejected|editors). Admin undo: a set only if the field still has
  `after`; a link only if no later row touches those people. Review panel: "Recent changes in this tree" (newest page,
  filtered to `treeIds(focus)`), "History ↗" pop-up (`.dlgx` ✕).
- **Checks in the page** (common.js): `linkProblem(pid, rel, oid, famId)` → `{stop}` / `{warn}` (editor.js `addProblem`, "Add
  anyway"; suggesters: a warn is a stop) and `dateProblems(id)` (years only; editor `#ed-datewarn`, review rows, owner's
  ☰ Menu → Check dates in site.js).
- **Book pages** (familytree.py `books`/`add_book_page`/`remove_book_page`, docs.js `bookLinks`/`bookEditor`): a Source per
  document (made the first time, the media attached) and a Citation per page on the person's `citation_list`.
  `/tree/details` → `books` with a ticket; the link re-fetches details for a fresh ticket and opens `…/file?…#page=N`.
- **Invites** (editors, role ≥ 3; the role part is the owner's): `POST /invites {email, person, role 0–3}` (owner) /
  `GET /invites` (owner, waiting ones), kept in chat.sqlite3 `invites`. A first Google sign-in makes a *disabled* Gramps
  Web account and gives it no token, so the invite is applied from the owner's side: `/auth/me` for an owner runs
  `let_in()` — `GET /api/users/`, an account with a negative role whose email matches gets `PUT /api/users/<name>/ {role}`
  and the Find me link (`admit()`, which also emails "You're in", in the background here); `/auth/me` → `joined` (toast)
  and `joining` (how many accounts wait, role -1). **Waiting to join** (owner, site.js, ☰ Menu → Owner): `GET /joining`
  lists role -1 accounts (role preset: the invite's, else 0 Guest; `before`: the login was used before, i.e. turned off),
  `POST /joining/<login> {role 0–3}` → `admit()`: role, invite's person linked, "You're in" email (Gramps Web sends none
  on approval). me.js: "✉ Invite to the family tree" in More details (person
  without a login, editors) → the message first (`inviteText`, same words as main.py `invite_text`: "I approve…" for the
  owner, "Every account is approved…" for editors) with WhatsApp (wa.me), ✉ Email, Share…, Copy. ✉ Email asks the
  address (owner: + role → `POST /invites`), then `POST /invites/send {email}` (fixed text, from DEFAULT_FROM_EMAIL,
  Reply-To the sender) when the server can send email, else a `mailto:` in their own mail app.
- **Family documents** (docs.js, ☰ Menu `#menu-docs`, Site settings item `docs`): `GET /tree/documents` = every
  non-`image/*` media `{id, title (desc, else file name), mime}` by title. `GET /gapi/media/{h}/file?name=&download=1`
  streams Gramps' `/media/{h}/file` for a `ticket` from `/tree/documents` (main.py `file_ticket`: random, that one
  file, 10 minutes, holds the lister's Gramps token, in memory; the cookie doesn't reach a new tab from an installed
  app — #158): only `application/pdf` (no download) is inline, everything
  else `attachment` + `application/octet-stream`; filename = name + Gramps' extension; its own CSP
  (`frame-ancestors 'none'` only: the page CSP's object-src 'none' would stop the browser's PDF viewer). The dialog
  calls `refreshLogin()` first, so the token behind the tickets has its full time ahead.
- No tag on records unless `TREE_TAG` is set (before 1.2: "Easy Gramps" on everything; `remove_tag.py`).
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
check). At the top: "👋 Claim your place in the family tree" (why: the family can message you in the chat) [Find me] [Not now]
(Not now: this device); with Gramps Web's home person in this browser (same site), "Are you X? [Yes, that's me] [No,
find me] [Not now]" (one tap links; only offered, as it may be an ancestor), or, once
linked, a "Your family tree" card. Find me (`me.js`): search with ⓘ preview → "Is this you?" (photo, born,
parents) → Yes. ☰ Menu → You: Change / That's not me. Panel: "👤 This is you" under the name; editors see
"Linked to the login …" with a two-step Unlink under More details.
One search only: the top-bar search and the title strip are hidden on the start screen.
**Search results** (start screen and top bar, `search.js`): photo, name (and nickname in brackets, `nameNick`), years · parent · birthplace, and an ⓘ
that opens a preview under the row (photo, born, passed away, parents, wife/husband, children by name,
See their tree →); one preview at a time. Keys: ↓ into the results, ↓ ↑, → / ← preview, Enter, Esc.
No one found = amber box, "+ Add “…” as a new person" (if they can add) opens the start screen's form with
the name filled in (first word = first name). It must **not** open on an automatic person.

**Family chat** (`chat.js`; owner's picks 2026-10-25, `docs/research/chat-and-invites.md`): **💬 Chat** in the top
bar (red unread count; checked every 15 s, an open conversation every 5 s). Full screen like the editor, a history
step (Back / Esc close it): left Groups (+ New group for editors), Groups you can join (Join), Private messages
(+ Message someone), About people; right the conversation (day labels, photo + name + time, your own in blue, ⋯ →
two-step delete, Leave group / Delete group, See their tree →, a big box + Send; Enter sends on a computer). The unread
count is also in the tab title and on the installed app's icon (`navigator.setAppBadge`, where it exists). Names
and photos come from Find me, else the login name. Phones (≤ 700px): the list, then one conversation (← Chats).
Panel: "Family talk about …" at the bottom (last 2 messages, See all, a box + Send; typing survives panel redraws)
and "💬 Message …" under the name of someone with a linked login. Text only, no editing, no voice or photos.

**Panel** floats over the right of the tree card (portrait/<900px: slides up from the bottom). Hide
panel » / ✎ Edit person; photo (tap: big view; a strip when there are more), name, relation, born/died, clickable Parents/Wives/Children, More
details ▾ (burial, lives in, work, education, phone, email, notes; phone and email only for editors: `/tree/details` blanks them and
sets `contactHidden`); **"⧉ Duplicate profile? Merge."** for editors: a button in a
strip pinned to the panel's bottom edge (top line, shadow) so it shows without scrolling (#55).
Fit and centring use only the area not under the panel.

**Controls.** Bottom strip: overview map, − % +, Fit, ⌖ Centre, ⛶ Full screen, Hide controls. Opens at
a readable fit (≥60%). When space is short, button words win over the map. Full screen hides only
the top bar. ☰ Menu: Theme (☀️ Light / 🌙 Dark / ⚙️ Auto segmented control), Bigger text and line
switches, Dates (5 formats, kept with the login; a year alone stays a year), You (Find me, the daily email, "Notify me of
new chat messages on this device" where the browser can; asked once per device after login, `askPush`), Show tips (the tip bar
is off until asked for; in portrait it also says to turn the phone sideways), 📲 Install as an app (main.js; always, but not in the installed app: Chrome's `beforeinstallprompt` when it offers, else
the steps for Android/iPhone),
Full Gramps ↗, Log out.

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
the person's card, spouses beside, children grouped by spouse. Fields: photo, Photos (tiles, ★ = profile,
+ Add photos), first/last/nickname,
**Male / Female only**, birthday (typed in Menu → Dates' order (`dateHint`/`parseTyped` in common.js) with the number keypad, 📅 = the browser's
date box laid invisibly over it; or "I only know the year"), place of birth, Passed away?
(reveals death date and burial place), More details (residing at, work, education, phone, email, notes). Autosave:
typing is saved when you leave the box or pause 2 s; ticks, buttons and the calendar at once; a year
once it has 4 digits. Place boxes list the existing places (with their area) and save only a place
you pick, or a new one after "Add it as a new place" (never one per keystroke, #49). Add pop-up: opens on **Someone new**; "🔍 Pick someone already in the
tree" switches it to the search (← Back returns; typing is kept; rows have the search's ⓘ preview, with
Choose), one kind of box at a time; **one person per add**; spouse gender set automatically. Adding a father or
mother says first that brothers and sisters in the same family get them too. The same couple recorded twice:
an amber "B is listed as A's wife twice" with Combine them (editors, two-step), in the editor and the details panel. ⋯ on a relative: open their family, remove from this
family (editors, with confirmation). Undo shown for 10 s after every add/remove.

**Open in Full Gramps ↗** (editors only, `grampsLink()` in common.js; new tab at `GRAMPS_PUBLIC_URL/<kind>/<Gramps ID>`):
the panel's More details (this person, birth, place of birth, death, burial, burial place), the editor's header
(person) and each "Children with …" group (family), the big photo view (photo). The graph carries the IDs
(`gid`, `gids`, families' `gid`, `media`). Gramps Web's family pages are `/family/F…`, hence the default
`BASE_PATH=/easy-gramps` (1.5); the README says how to move an install from `/family`.

**Big photo view** (`photos.js`): over everything, dark; ‹ › / ← → / swipe; closes with ✕, Esc, a tap
beside the photo, or Back (a history step with the same address). Editors: "Use as profile photo",
"Remove from this person" (two-step; only unlinks).

**Merge dialog** ("Duplicate profile? Merge."): find the other profile (rows with the ⓘ preview) → 4-column compare (field | KEEP | REMOVE | "Will be saved as");
tap a value to use it; names/places can also be typed, pasted or dragged into the result box;
⇄ swaps which is kept; two-step confirm.

## Known quirks
- Firefox on Android keeps a page pinch-zoom across reloads — the reason page zoom is disabled.
- Emulated taps in Playwright don't produce clicks; tap-to-select on touch is only proven on a real tablet.
- `docker run --env-file` keeps quote marks literally: keep `.env` values unquoted.
