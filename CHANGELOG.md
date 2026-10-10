# Changelog

All notable changes, newest first. Versions follow `VERSION`; releases are tagged `vX.Y.Z`.

## 1.2.0 — 2026-10-10

### Added
- **Search preview:** an ⓘ on the right of each search result (start screen and top bar) shows who it
  is: photo, born, parents, wife or husband, children, and "See their tree →".
- **Search keys:** ↓ from the search box into the results, ↓ ↑ between them, → shows the preview,
  ← closes it, Enter opens their tree, Esc back to the box.
- **Date format** in ☰ Menu → Dates: 12 Mar 1950, 12/03/1950, 03/12/1950, 1950-03-12 or March 12, 1950.
  It's kept with your login, so it's the same on every phone and computer.
- `remove_tag.py`: takes the old "Easy Gramps" tag off every record, then deletes the tag (asks first;
  nothing else changes, nothing is deleted). The server tools can now also log in with your browser's
  login, for owners who log in with Google.

### Changed
- **No tag on new records.** Records the tree makes no longer get the "Easy Gramps" tag (set `TREE_TAG`
  if you want one). Records from older versions keep it until you run `remove_tag.py`.
- **"No one found" is easy to see:** an amber box, with "+ Add … as a new person" (for people who can
  add), which opens the new-person form with that name filled in.
- The top-bar search shows photos, like the start screen's.

## 1.1.1 — 2026-10-05

(1.1.0 was tagged but never built: `VERSION` still said 1.0.5. 1.1.1 is the first build with 1.0.5's changes.)

### Added
- Releasing is one click: **Actions → Release image → Run workflow** builds the image and publishes
  the release for the version in `VERSION`. A mismatched hand-made tag now says what to fix.

### Changed
- The help tip above the tree ("Tip: tap a person to see their details…") is off by default; turn it
  on with ☰ Menu → Show tips (it stays on until closed).

## 1.0.5 — 2026-10-05

### Added
- **Keyboard:** arrow keys also reach the dotted "Add" boxes; Enter edits the person (or opens the Add
  box); Space shows the details; / search, + − zoom, 0 fit, H home; ? (or Menu → Keyboard keys) lists them.
- **Reload keeps your place:** the selected person, the editor and the Add pop-up come back after a
  reload. **Back** (or a phone's back gesture, also in the installed app) closes the Add pop-up, then
  the editor, instead of leaving the page.

### Changed
- The Add pop-up opens on **Someone new**; "🔍 Pick someone already in the tree" switches it to the
  search, so a new person's name can't go into the search box by mistake.

## 1.0.4 — 2026-10-05

### Changed
- **⌂ Family Tree** at the top left is now the Home button (styled as one); the separate ⌂ Home button
  in the tree's title strip shows only in full screen, where the top bar is hidden.
- The start screen has one search box and one title: the top-bar search and the "Family tree" strip
  are hidden there.

### Fixed
- Going back home no longer leaves the dotted line to the details panel on the start screen.

## 1.0.3 — 2026-10-04

### Added
- **Install it as an app** on phones and tablets ("Install app" in Chrome, "Add to Home Screen" on an
  iPhone): its own **Family Tree** icon and window, separate from Gramps Web's app. Nothing is kept on
  the phone; with no internet it shows "No internet" with a Try again button.
- `ICON_FILE`: use your own picture as the app icon; every size is made from it.

## 1.0.2 — 2026-10-04

(1.0.1 was tagged but never built: its tag was set before the version bump.)

### Changed
- "Is this person in the tree twice?" is now a tab across the bottom of the details panel, with its own
  background and edge, so it's clearly a button and the panel visibly scrolls underneath it.

## 1.0.0 — 2026-10-04

First stable release: installs next to Gramps Web on the same site, with one shared login
(Google / single sign-on included), the security hardening and the review fixes of 0.9.x.

### Fixed
- "Is this person in the tree twice?" stays visible at the bottom of the details panel for editors;
  in a big family it used to sit below the panel's edge, looking as if it was missing.

## 0.9.3 — 2026-10-04

### Added
- **One login for Easy Gramps and Gramps Web** when they're on the same site
  (`https://gramps.example.com/family/` next to `https://gramps.example.com/`): logged in to one means
  logged in to both, and "Log out" logs out of both. Gramps Web's own sign-in buttons (e.g. "Continue
  with Google") appear on the login screen; signing in opens in a pop-up (a new tab on phones) and the
  tree loads by itself once it's done. The name-and-password form hides itself when Gramps Web has
  password login turned off. A login from before carries over once. Elsewhere nothing changes.
- An account Gramps Web won't let in yet (e.g. a new Google user without a role) sees "Ask the family
  tree's owner to let you in" instead of being logged out.

## 0.9.2 — 2026-10-04

### Security
- Photo thumbnails are only ever served as JPEG, PNG, GIF or WebP; anything else (a file claiming to
  be HTML or SVG) goes out as a plain download, so it can't run as a page on this site.
- Reviewed every place the page builds HTML: names, places and notes that look like code are shown
  exactly as typed. Groundwork for sharing the Gramps Web login.

### Added
- Menu link "Source code ↗" (setting `SOURCE_URL`, defaults to this repository), so anyone running
  a changed copy can offer its source as the AGPL asks.
- README: Easy Gramps is not affiliated with or endorsed by the Gramps project.
- `deploy/easy-gramps.container`: install on a rootless Podman host as a Quadlet, behind Traefik.

### Fixed
- Typing a place no longer makes a new place at every pause ("Lo", "Lond", "London"). The box now
  lists the places already in the tree; a new place is made only after "Add it as a new place".
  Text boxes save when you leave them or pause for 2 seconds, a year once it has 4 digits.
  `unused_places.py` lists places the tree made that nobody uses and deletes them if you say yes.
- Two wives who are sisters: their parents are drawn once (WIFE'S FATHER / WIFE'S MOTHER, a line
  down to each wife), instead of twice with lines going to the wrong copy.

### Changed
- The page's script is split into small modules (tree, details panel, editor, merge, start screen),
  so each part is easier to read and fix. Nothing changes for users.

## 0.9.1 — 2026-10-04

### Security
- Dependencies upgraded past known vulnerabilities (Starlette 1.7, python-multipart 0.0.32).
- Security headers on every response: Content-Security-Policy, X-Frame-Options, nosniff,
  Referrer-Policy, Permissions-Policy.
- The font is bundled: no requests to Google Fonts.
- Photos load through an HttpOnly cookie; no login token in image URLs.
- Failed logins are limited per visitor (3 a minute, 5 an hour, 7 a day).
- Photo upload: editors only, images only, 20 MB at most, checked before reading the upload.

### Fixed
- Editing Notes no longer copies every note into the first one; shared notes and events are kept.
- "Lives in" edits the city only and keeps the rest of the address.
- Typing just before adding or removing a relative is no longer lost.
- The editor doesn't show empty boxes when More details failed to load.
- Contributors no longer get half-made records: family links are for editors (Gramps' rule).
- A Gramps Web outage no longer logs people out or says "wrong password".
- Same parents' family on the page and the server for people with two sets of parents.
- Members see private phone and email (Gramps allows it).
- Duplicate-name warning works with a last name only.
- The last edit is saved when the tab is closed straight away; Log out leaves nothing behind.
- Plain error messages instead of raw Gramps API text.
- Search-result names, the overview map after a cancelled touch, and a few server-side checks.

### Changed
- Accessibility: labelled date fields, dialogs keep focus and close with Escape, announced
  messages, darker amber text, no text under 13 px, 44 px buttons on touch screens.
- Spouse's parents are tagged "Wife's father" / "Husband's mother".
- Responses are compressed (the whole-tree data is about 5× smaller); one shared connection to Gramps.
- Code clean-up, no visible change: copied code merged into shared helpers (name search, the
  "Someone new" form, new people, endpoints), dead code and unused CSS removed.

### Added
- Backend tests (fake Gramps Web), an every-screen browser check, CI, and a multi-arch image on
  GitHub Container Registry for version tags.

## 0.9.0

First preview.
