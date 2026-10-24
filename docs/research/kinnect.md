# Kinnect compared with Easy Gramps (October 2026)

[Kinnect](https://github.com/gordon-matt/Kinnect) is a self-hosted family tree plus a private family social
space (feed, chat, media). It was read from its source code and screenshots on 2026-10-24; it wasn't run.

## What it is
- ASP.NET Core (.NET 10), with its **own PostgreSQL database**, Identity accounts (optionally Keycloak OIDC),
  Hangfire background jobs and FFmpeg for video. It's a standalone app; Easy Gramps is a simpler face on
  Gramps Web's data.
- **Data model:** each person has one `FatherId` and one `MotherId`, and spouses are a separate table. There
  are no families as such, so there's no adoption or step-parents, and no sources or citations. A `PersonVersion`
  table keeps a JSON snapshot on every save, with Restore.
- **Tree:** an external Blazor component (`MyWebTree.Components`, based on family-chart.js). Its screen looks
  very like ours (dotted canvas, "Add spouse/child" boxes, side panel with Unlink and Add).

## What it has that we don't
| Feature | Does Gramps Web already store it? | Worth it for us? |
|---|---|---|
| "Find me" / My profile: each login is linked to a person in the tree | No equivalent in our app | **Yes**: cheap, and needed by chat and invites |
| Timeline tab: life events in date order (residence, emigration, custom) | Yes, Gramps events | Yes, read-only (we show only birth, death and burial) |
| People tagged in photos: draw boxes or polygons, "People in this photo" | Yes, a photo link's face region (`rect`) | Maybe: read-only is cheap; Full Gramps can edit |
| Maps of a person's events and of photo locations (Leaflet + OpenStreetMap) | Yes, place coordinates | Maybe; needs map tiles from an outside service (security policy) |
| Change history per person, with Restore | Yes, Gramps Web's change history | "Last changed by X" yes; Restore is harder |
| Tree controls: generation depth, Father's line only, vertical, undo/redo, People list drawer | Not applicable (it's about the view) | "More generations" maybe; changes the agreed layout, so mock-up first |
| Profile: bio, occupation, education, religion, web links | Partly (notes, attributes, web addresses) | Occupation and "About": small |
| Feed, **chat** (rooms + private messages, SignalR live updates, unread-message emails), notifications | No (Gramps Web's "Chat" is an AI assistant) | Chat: see `chat-and-invites.md` |
| Videos (FFmpeg), documents, media folders and tags | Gramps stores any file | Low priority |
| GEDCOM import at first start, scheduled backups, user admin | Gramps Web does all of these | No: stays in Full Gramps |

## Where we're stronger
- **Real genealogy:** Gramps families, events, citations and multiple parent families (adoption, step-parents)
  stay intact. One source of truth with Gramps Web, its roles, and a shared login (Google included).
- **For older relatives:** big text, plain wording, autosave with status, Undo, a duplicate-name check, places
  picked never created per keystroke, the "listed twice → Combine" repair, and the **Duplicate profile? Merge.**
  compare dialog (Kinnect has no person merge).
- **A richer one-family view:** in-laws' parents, brothers and sisters, several spouses in order, one colour
  per family, THIS TREE, the line to the details panel.
- **Daily use:** keyboard keys, Back closing pop-ups, a reload keeping the view, touch gestures, installs as an
  app (with a "No internet" page), date format per login, an "Open in Full Gramps ↗" link on every record (1.5.0).
- **Light and hardened:** one small container, no database, runs on arm64 (Raspberry Pi). A strict security
  policy (CSP), login rate limits, a photo login that page scripts can't read, and browser checks against a real
  Gramps Web. Kinnect's code shows no CSP and no login rate limiting.

## Owner's direction (2026-10-24)
Don't chase what Full Gramps already does. Add those only when they're cheap and add little to the UI or to the
code to maintain. The owner **liked the chat** → see `chat-and-invites.md`.
