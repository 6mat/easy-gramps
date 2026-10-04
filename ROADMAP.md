# Roadmap

Work plan. **1.0 is released**: everything under "Done" below. Next up is the list under "Next".

## Done: 0.9.x → 1.0 — install next to Gramps Web, with Google / single sign-on

### 1. Security hardening (do before the shared login)
- [x] **Security headers from the app itself** (installs without our Traefik setup need them too):
      CSP (`default-src 'self'`; images also `data:` `blob:`), `frame-ancestors 'none'` /
      `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
      `Referrer-Policy: strict-origin-when-cross-origin`, a basic `Permissions-Policy`.
      HSTS stays with the TLS proxy. Check every screen with the CSP on (inline styles set from JS,
      the inline SVG favicon, the photo upload).
- [x] **Bundle the font.** Atkinson Hyperlegible (OFL) into `app/static/fonts/`, drop Google Fonts
      (privacy/GDPR, and a simpler CSP).
- [x] **No login token in photo URLs.** Thumbnails use `?jwt=` today (Gramps Web's own frontend does the
      same, but we can do better). Plan: `POST {BASE}/auth/session` with the Bearer token sets an
      `HttpOnly; Secure; SameSite=Strict` cookie scoped to `{BASE}/gapi/`; call it after login and every
      refresh; the thumbnail route reads the cookie. Photos stay HTTP-cacheable.
- [x] **Login rate limit per visitor.** Gramps Web limits `/api/token/` to 1/second **per IP**, and every
      login through this app arrives from one IP, so one attacker can lock out everyone's logins here.
      Add our own per-client-IP limit on `/auth/login` (e.g. 5/min with back-off), using the
      `X-Forwarded-For` that uvicorn trusts via `FORWARDED_ALLOW_IPS` (set in the Traefik example).
      Map Gramps' 429 to "Too many tries, please wait a minute" (today it says the password is wrong).
- [x] Dependencies upgraded past known vulnerabilities (Starlette 1.7, python-multipart 0.0.32); Starlette pinned.
- [x] Debug log endpoint off by default (`DEBUG_LOG=1` to enable).
- [x] `/gapi` narrowed to photo thumbnails only.
- [x] Container runs as a non-root user; Traefik example publishes no port.

### 2. Shared login with Gramps Web (Google / OIDC users included)
Easy Gramps is served on the **same origin** as Gramps Web (`https://host/family/`), so both apps
share the browser's `localStorage`, where Gramps Web keeps its login (password *or* OIDC) under
`access_token`, `refresh_token`, `access_token_expires` and `id_token`. Owner's picks: 1a 2a 3a 4a 5a.
- [x] `auth.js` uses Gramps Web's keys on the same origin (automatic, no setting); an old `eg_*` login
      carries over once. Renewal still goes through `{BASE}/auth/refresh` and writes the shared key.
- [x] **Not logged in →** Gramps Web's own sign-in buttons ("Continue with Google", from
      `/api/oidc/config/` via `{BASE}/auth/options`) open the sign-in in a pop-up / new tab; the page
      notices the login (`storage` event, a poll, coming back to the tab) and loads the tree, closing the
      pop-up when the browser allows. Fallback: "Signed in already? Tap here to continue."
- [x] Password form stays, and hides itself when Gramps Web has password login off (`disable_local_auth`).
- [x] Refresh-token behaviour checked: Gramps Web's refresh writes only a new access token (no
      rotation), so the two apps can't log each other out by renewing.
- [x] Log out logs out of both; logging out in Gramps Web logs this page out. An account Gramps refuses
      sees "ask the owner" and is not logged out.
- [x] Script-injection review done (#9) on top of the CSP (#1).
- [x] Owner tested Google sign-in on a real server.

### 3. Release
- [x] Tests: backend with `httpx.MockTransport` (graph building, add/unlink/undo, merge request shape);
      a Playwright smoke test against the Gramps Web demo (read-only parts).
- [x] GitHub Actions: lint + tests on push; on a `v*` tag, build a multi-arch (amd64 + arm64) image to GHCR.
- [x] `LICENSE`: AGPL-3.0-or-later, same as Gramps Web / Gramps Web API.
- [x] `CHANGELOG.md`, `SECURITY.md` (how to report).
- [ ] README screenshots (from the Gramps Web demo tree, never a real family) — #12, after 1.0.
- [x] Name: kept "Easy Gramps"; the README says it isn't affiliated with or endorsed by the Gramps
      project (#13).

## Next (after 1.0)
- **README screenshots** (#12).
- **Phones:** a portrait layout (tree on top, details below, bigger tap targets). Today phones see
  "turn your phone sideways".
- **Faster reloads for big trees:** after an edit, re-fetch only what changed (today the whole tree
  reloads; ~0.4 MB / 7-10 s for the demo's 4,669 people).
- **Suggest likely duplicates** on the start screen (same/similar name, overlapping dates).
- **"Could use some details" list** — people missing parents, a birth year or a photo.
- **House / family name field** to tell apart people with the same name (undecided).
- **Translations** — all text is English today.
- **Accent colour / theme choices** beyond light/dark.

## Known limitations (accepted)
- Two people editing the same person at once: the last save wins.
- No offline editing; a failed save shows "Not saved" with Try again.
- Merge is not covered by the 10-second Undo (Gramps Web's history has it).
