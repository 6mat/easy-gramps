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

> Status: **0.9 preview.** Tested with Gramps Web API 3.22.x. Built for landscape screens
> (laptop, tablet sideways); phones are not supported yet.

## Install (same machine as Gramps Web, behind Traefik)

Easy Gramps runs next to Gramps Web on the **same domain**, under a path:

```
https://gramps.example.com/          -> Gramps Web
https://gramps.example.com/family/   -> Easy Gramps
```

1. The image is published as `ghcr.io/6mat/easy-gramps` (amd64 and arm64). To build it yourself instead:
   `docker build -t easy-gramps:latest app/` and change `image:` in the compose file.
2. Copy `deploy/compose.traefik.yaml` next to your Gramps Web stack and create a `.env` from
   `.env.example` (`GRAMPS_HOST`, `CERT_RESOLVER`).
3. `docker compose -f compose.traefik.yaml up -d`, then open `https://<your gramps host>/family/`.

See the comments in `deploy/compose.traefik.yaml` for the network and router assumptions.

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
```
Never run `--write` against a real family tree. CI runs the first three on every push and the
read-only screen check weekly.

## Settings

| Setting | Meaning |
|---|---|
| `GRAMPS_URL` | How the app reaches Gramps Web (internal Docker URL on a server). |
| `GRAMPS_PUBLIC_URL` | The Gramps Web address browsers open from the menu. Defaults to `GRAMPS_URL`. |
| `BASE_PATH` | Path the app is served under. Default `/family`. |
| `TREE_TAG` | Tag put on records the editor creates. Default `Easy Gramps`. |
| `GRAMPS_LINK_LABEL` | Label of the menu link to Gramps Web. |
| `FORWARDED_ALLOW_IPS` | Proxy addresses whose `X-Forwarded-For` is trusted, so the login limit (3 failed tries a minute, 5 an hour, 7 a day) counts each visitor separately. The Traefik example sets it. |
| `DEBUG_LOG` | `1` accepts screen-measurement reports from `?debug` into `data/debug.log`. Off by default. |

## How it fits together

- `app/main.py` — FastAPI app: login/refresh pass-through, `/tree/*` endpoints, photo thumbnails.
- `app/familytree.py` — reads the whole tree in one go, and every edit (fields, relatives, unlink,
  undo, merge) as Gramps Web API calls.
- `app/gramps.py` — small Gramps Web API client and object helpers.
- `app/static/tree.{html,css,js}` — the page; `auth.js` handles login and tokens.

## License

[GNU AGPL-3.0-or-later](LICENSE), the same license as Gramps Web and the Gramps Web API.
If you run a modified version for others over a network, you must offer them its source.
The bundled Atkinson Hyperlegible font (`app/static/fonts/`) is under the SIL Open Font License (`OFL.txt` there).
