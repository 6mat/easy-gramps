# Roadmap

Work plan towards a public **0.9.x** release, then 1.0. Order matters: lock things down before
sharing the login with Gramps Web.

## Now: 0.9.x — install next to Gramps Web, with Google / single sign-on

### 1. Security hardening (do before the shared login)
- [ ] **Security headers from the app itself** (installs without our Traefik setup need them too):
      CSP (`default-src 'self'`; images also `data:` `blob:`), `frame-ancestors 'none'` /
      `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
      `Referrer-Policy: strict-origin-when-cross-origin`, a basic `Permissions-Policy`.
      HSTS stays with the TLS proxy. Check every screen with the CSP on (inline styles set from JS,
      the inline SVG favicon, the photo upload).
- [ ] **Bundle the font.** Atkinson Hyperlegible (OFL) into `app/static/fonts/`, drop Google Fonts
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
share the browser's `localStorage`. Gramps Web stores its login (password *or* OIDC) under the keys
**`access_token`** and **`refresh_token`** (see `gramps-web` `src/api.js`, `storeAuthToken()` /
`storeRefreshToken()`; OIDC completes in `src/oidc.js`).
- [ ] `auth.js`: read/write Gramps Web's `access_token` / `refresh_token` instead of our own
      `eg_access` / `eg_refresh` (migrate once: if ours exist and theirs don't, copy them over).
      Refresh still goes through `{BASE}/auth/refresh` and writes the new access token back to the
      shared key. Log out clears the shared keys (= logs out of both; confirm that's wanted).
- [ ] **Not logged in →** a "Sign in" button that opens Gramps Web's login page
      (`GRAMPS_PUBLIC_URL`) in a new tab/popup. Listen for the `storage` event on `access_token`;
      when it appears, close the popup (same origin, so allowed) and load the tree. On phones the popup
      is a tab — the page picks the login up when the user comes back. Fallback text:
      "Signed in already? Tap here to continue."
- [ ] Keep the password form as an option (`PASSWORD_LOGIN=1` default on); allow turning it off for
      Google-only installs.
- [ ] Verify the refresh-token behaviour of Gramps Web (does refresh rotate it?) so the two apps don't
      log each other out.
- [ ] Note: same origin also means a script-injection bug here could take over the Gramps login —
      which is why step 1 (CSP) comes first.

### 3. Release
- [ ] Tests: backend with `httpx.MockTransport` (graph building, add/unlink/undo, merge request shape);
      a Playwright smoke test against the Gramps Web demo (read-only parts).
- [ ] GitHub Actions: lint + tests on push; on a `v*` tag, build a multi-arch (amd64 + arm64) image to GHCR.
- [x] `LICENSE`: AGPL-3.0-or-later, same as Gramps Web / Gramps Web API.
- [ ] `CHANGELOG.md`, `SECURITY.md` (how to report), README screenshots (from the Gramps Web demo tree,
      never a real family).
- [ ] Name check: ask the Gramps project whether "Easy Gramps" is OK, or rename
      ("… for Gramps Web").

## Later (towards 1.0)
- **Phones:** a portrait layout (tree on top, details below, bigger tap targets). Today phones see
  "turn your phone sideways".
- **Suggest likely duplicates** on the start screen (same/similar name, overlapping dates).
- **"Could use some details" list** — people missing parents, a birth year or a photo.
- **House / family name field** to tell apart people with the same name (undecided).
- **Translations** — all text is English today.
- **Accent colour / theme choices** beyond light/dark.

## Known limitations (accepted)
- Two people editing the same person at once: the last save wins.
- No offline editing; a failed save shows "Not saved" with Try again.
- Merge is not covered by the 10-second Undo (Gramps Web's history has it).
