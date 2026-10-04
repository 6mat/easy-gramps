# Changelog

All notable changes, newest first. Versions follow `VERSION`; releases are tagged `vX.Y.Z`.

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
