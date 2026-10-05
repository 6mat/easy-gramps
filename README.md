# Easy Gramps

A simple, big-text family tree for [Gramps Web](https://www.grampsweb.org/), made for the
relatives who find the full Gramps interface too much.

- **See one family at a time:** a person in the middle, parents above, husband/wife beside,
  children below, with siblings and in-laws' parents. One colour per family.
- **Edit in place:** every field saves as you type; add a father, mother, husband/wife or child
  (someone already in the tree, or someone new); remove a link; Undo for 10 seconds.
- **Merge duplicates:** combine two records of the same person, keeping both sets of relationships.
- **Made for laptops and tablets:** pinch and drag the tree, double-tap to centre, light/dark theme,
  bigger-text option.

It talks only to the Gramps Web API, using each person's own Gramps Web login, so **Gramps Web's
roles and permissions still apply** (a Member can only look, a Contributor can add, an Editor can change).

Easy Gramps is an independent project. It is not affiliated with or endorsed by the Gramps project.

> Status: **0.9 preview.** Tested with Gramps Web API 3.22.x. Built for landscape screens
> (laptop, tablet sideways); phones are not supported yet.

## Install (same machine as Gramps Web, behind Traefik)

Easy Gramps runs next to Gramps Web on the **same domain**, under a path:

```
https://gramps.example.com/          -> Gramps Web
https://gramps.example.com/family/   -> Easy Gramps
```

1. The image is published as `ghcr.io/6mat/easy-gramps` (amd64 and arm64); a new version is released with
   **Actions → Release image → Run workflow** (it uses the version in `VERSION`). To build it yourself instead:
   `docker build -t easy-gramps:latest app/` and change `image:` in the compose file.
2. Copy `deploy/compose.traefik.yaml` next to your Gramps Web stack and create a `.env` from
   `.env.example` (`GRAMPS_HOST`, `CERT_RESOLVER`).
3. `docker compose -f compose.traefik.yaml up -d`, then open `https://<your gramps host>/family/`.

See the comments in `deploy/compose.traefik.yaml` for the network and router assumptions.

**Clean up places (once, after upgrading from 0.9.1 or older).** Older versions made a new place
each time you paused while typing one ("Lo", "Lond", "London"). This lists the places Easy Gramps
made that nobody uses, and deletes them only if you type `yes` (log in as an Editor or Owner):
`docker exec -it easy-gramps python unused_places.py`

## Install with Podman (Quadlet)

For a rootless Podman host where Traefik reads container labels through the Podman socket, use
`deploy/easy-gramps.container` instead of the compose file: copy it into
`~/.config/containers/systemd/`, set your host name in it, then
`systemctl --user daemon-reload && systemctl --user start easy-gramps`. It pulls the published
image (`ghcr.io/6mat/easy-gramps`, amd64 and arm64) and lets Podman auto-update it. The comments in the file
list what it assumes (network, Gramps Web container name, router priority).

## Develop locally

```
cp .env.example .env      # set GRAMPS_URL to a Gramps Web you can test against
docker compose up -d --build
# open http://localhost:8095/family/
```

The public Gramps Web demo (`https://demo.grampsweb.org`, logins `member`/`member`,
`editor`/`editor`, `owner`/`owner`) works well as a test backend.

## Tests

```
pip install -r app/requirements.txt -r tests/requirements.txt
pytest                      # backend, against a fake Gramps Web (no network)
ruff check app tests

cd tests/e2e && npm ci && npx playwright install chromium && cd ../..
# with the app running against https://demo.grampsweb.org on port 8095:
APP=http://localhost:8095/family/ node tests/e2e/screens.mjs           # every screen, read-only
APP=http://localhost:8095/family/ node tests/e2e/screens.mjs --write   # also edits (ZZTEST records, cleaned up)
# with the app started with GRAMPS_PUBLIC_URL=http://localhost:8096 instead:
node tests/e2e/shared-login.mjs   # shared login with Gramps Web, "Continue with Google" played by a stand-in
```
Never run `--write` against a real family tree. CI runs the first three on every push and the
read-only screen check weekly.

## Settings

| Setting | Meaning |
|---|---|
| `GRAMPS_URL` | How the app reaches Gramps Web (internal Docker URL on a server). |
| `GRAMPS_PUBLIC_URL` | The Gramps Web address browsers open from the menu. Defaults to `GRAMPS_URL`. When it's the same site as this page (Easy Gramps at `https://gramps.example.com/family/`, this set to `https://gramps.example.com`), the two apps share one login, Google / single sign-on included (see below). |
| `BASE_PATH` | Path the app is served under. Default `/family`. |
| `TREE_TAG` | Tag put on records the editor creates. Default `Easy Gramps`. |
| `GRAMPS_LINK_LABEL` | Label of the menu link to Gramps Web. |
| `SOURCE_URL` | Where the menu's "Source code" link points. Defaults to this repository; if you run a changed version, point it at your own copy (the AGPL asks you to offer users the source). |
| `FORWARDED_ALLOW_IPS` | Proxy addresses whose `X-Forwarded-For` is trusted, so the login limit (3 failed tries a minute, 5 an hour, 7 a day) counts each visitor separately. The Traefik example sets it. |
| `ICON_FILE` | Your own app icon: a square picture (PNG or JPG) inside the container. Every icon size is made from it, and installed phones pick up a new one. Defaults to the bundled tree. |
| `DEBUG_LOG` | `1` accepts screen-measurement reports from `?debug` into `data/debug.log`. Off by default. |

## On a phone or tablet: install it as an app

In Chrome on Android, open `/family/` and choose **Install app** (or **Add to Home screen → Install**);
on an iPhone, Safari's **Share → Add to Home Screen**. It then opens from its own **Family Tree** icon,
without the browser's address bar. It's an app of its own, separate from Gramps Web's. Nothing is kept on
the phone: with no internet it says so ("No internet", with Try again) instead of showing old data.

To use your own icon, point `ICON_FILE` at a square picture (see the commented lines in the deploy
files). After changing it, an installed app shows the new icon once the phone next checks (it can take
a day); removing and re-installing the app shows it at once.

## Signing in

Everyone signs in with their own Gramps Web account, so Gramps Web decides what each person may see
and change. Installed on the **same site** as Gramps Web (as in the Traefik example), the two share one
login:

- Logged in to Gramps Web already? Opening `/family/` goes straight to the tree, and the other way round.
- The login screen shows Gramps Web's own sign-in buttons, e.g. **Continue with Google** when Gramps
  Web has Google (OIDC) sign-in set up. Nothing extra to configure: it's Gramps Web's sign-in, with the
  same Google settings. It opens in a pop-up (a new tab on phones); the tree loads once it's done.
- The name-and-password form hides itself when Gramps Web has password login turned off.
- **Log out** logs out of both (safe on a shared tablet); logging out in Gramps Web logs out here too.
- A new Google user needs a role in Gramps Web (Settings → user administration) before they can open
  the tree; until then they see "Ask the family tree's owner to let you in".

On a different site (e.g. a laptop against the Gramps Web demo) Easy Gramps keeps its own login with
the name-and-password form, as before.

## How it fits together

- `app/main.py` — FastAPI app: login/refresh pass-through, `/tree/*` endpoints, photo thumbnails.
- `app/familytree.py` — reads the whole tree in one go, and every edit (fields, relatives, unlink,
  undo, merge) as Gramps Web API calls.
- `app/gramps.py` — small Gramps Web API client and object helpers.
- `app/static/` — the page: `tree.html` + `tree.css` and small ES modules (`main.js` entry, `common.js`,
  `tree.js`, `panel.js`, `editor.js`, `merge.js`, `start.js`); `auth.js` handles login and tokens.

## License

[GNU AGPL-3.0-or-later](LICENSE), the same license as Gramps Web and the Gramps Web API.
If you run a modified version for others over a network, you must offer them its source: the
menu's "Source code" link does that once `SOURCE_URL` points at your copy.
The bundled Atkinson Hyperlegible font (`app/static/fonts/`) is under the SIL Open Font License (`OFL.txt` there).
