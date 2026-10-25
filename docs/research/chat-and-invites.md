# Family chat, and inviting relatives to claim themselves (research, October 2026)

Status: **"Find me" built in 1.7.0, the family chat in 1.8.0** (owner's picks below). Invites are still open.
Researched 2026-10-24.

## Owner's picks for chat (2026-10-25)
Built into Easy Gramps (option A below): no Matrix, XMPP or WhatsApp bridge.
| # | Question | Pick |
|---|---|---|
| 1 | Who gets chat | **Anyone with a login.** Claiming yourself in the tree only adds your photo and name |
| 2 | Who approves a claim | **No one: automatic,** and an editor can undo it |
| 3 | Who creates group chats | **Editors and the owner** |
| 4 | Who can join a group | **Groups are open:** everyone sees them and can join or leave |
| 5 | Private one-to-one messages | **Yes** |
| 6 | Email for unread messages | **Yes, after a message has waited about 24 hours.** At most one email a day, off in ☰ Menu |
| 7 | Photos, voice, video | **Text and emoji only, for good** |
| 8 | Who deletes messages | **Your own; editors and the owner can delete anyone's** |

Details settled after the mock-up (2026-10-25): a deleted message leaves "Message deleted" in its place; no
editing (delete and write again); one login per person ("Already linked to another login. Ask an editor.");
"Whole family" can't be left, other groups can; a login with no person linked shows its login name (e.g. "tom");
a group's picture is one of a few emoji the editor picks.

Kept from the earlier suggestions: new messages appear by the page checking every ~15 s while open (no
connection held open); the "Whole family" group has everyone in it automatically; conversations about a
person are public to every login.

### Mock-up (shown to the owner 2026-10-25, drawn into the real app with the demo's people)
1. **Start screen:** "👋 Are you in this family tree? … [Find me]" above the search; **Recent conversations**
   (with "2 new") above Recently changed. **💬 Chat** with a red unread count in the top bar, beside ☰ Menu.
2. **"Is this you?"** after Find me: photo, name, born, parents; "Your login will be linked to this person…";
   "If it's the wrong person, an editor can undo it, or you can change it in ☰ Menu." [No, go back] [Yes, this is me].
3. **Details panel:** "Family talk about Claude" under More details: the last 2 messages, "See all 4 messages in
   Chat →", a box "Ask or tell the family something about Claude…" and Send.
4. **Someone with a linked login:** "💬 Uses the family chat · [Message Mary]" under their name; editors see
   "Linked to the login mary · Unlink" in More details.
5. **Family chat** (full screen like the editor; ← Back to tree, ⌂ Home): left, **Groups** (+ New group for
   editors; Whole family, Reunion 2027), **Groups you can join** (Join), **Private messages** (+ Message
   someone), **About people**; right, the conversation: day labels, photo + name + time, your own messages
   tinted blue, ⋯ on each message, a big text box and Send.
6. **About a person:** "About Claude George Bowes-Lyon · Everyone with a login can read this and write here",
   See his tree →.
7. **Delete (⋯):** "Delete Tom's message? Everyone will see “Message deleted”. [Yes, delete it] [Cancel]".
8. **New group** (editors): name, a picture (one of 8 emoji), "Everyone in the family can see this group and
   join it…", Add people now (optional).
9. **☰ Menu → Chat:** "You are Elizabeth … · Change"; switch "Email me when a message waits for me a day".
10–11. **Phone:** the list, then one conversation (← Chats).
12. **Email:** "3 messages are waiting for you in the family chat", grouped by conversation, [Open the family
   chat], "at most one email a day … To stop these emails: ☰ Menu → Chat".
A login without a claimed person shows as "tom (not found in the tree yet)" with a grey initial.

## Facts checked
- **Gramps Web's "Chat" is the AI assistant** (`/api/chat/`, `PERM_USE_CHAT`), not people talking to each other.
- **Gramps Web is adding phone notifications** (`gramps_webapi/webpush.py`, `/api/users/-/push-subscriptions/`,
  October 2026), but nothing sends them yet.
- **Gramps Web can create and invite users** (owner rights):
  - `POST /api/users/<name>/` with `{email, full_name, password, role}` (all required) creates an account.
  - `POST /api/users/<name>/password/reset/trigger/` emails a one-hour "set your password" link, using Gramps Web's
    own email settings (refused when local login is turned off).
  - `/api/users/<name>/register/` is self-registration (role unconfirmed, email confirm).
  - With OIDC (Google), Gramps Web creates the user at first login; the owner approves their role.
- **Kinnect's chat** comes from a .NET package (EasyChatz): rooms, private messages, SignalR live updates, a
  Hangfire job that emails unread messages. Not reusable here (Python), but a good list of what's enough.

## Chat: where it could run
| Option | What it is | Bridges | Fit |
|---|---|---|---|
| **A. Built into Easy Gramps** | Python's built-in SQLite in `DATA_DIR` (the volume from 1.3.1); Gramps Web logins | None | Simplest: one app, one login. ~2 days |
| **B. Matrix server + bridges** | Synapse (safest), or Tuwunel / Continuwuity (lighter, Rust; check their bridge support first) + mautrix bridges | WhatsApp, Signal (mautrix v26.10, Oct 2026), Telegram… | The only full route to WhatsApp and Signal. 3–4 more containers, its own accounts. The Signal bridge works as a linked device; WhatsApp warns that suspicious accounts can be banned |
| **C. XMPP + Slidge** | Prosody or ejabberd + Slidge gateways (slidge-whatsapp 0.4; Signal gateways partly beta) | WhatsApp, Signal | Lighter than Matrix; fewer users, weaker app support |
| **D. A + Matterbridge** | Our chat mirrored to one outside group through Matterbridge's REST API | WhatsApp (built from source with the `whatsappmulti` tag; GPL library), Telegram, Discord. **No reliable Signal** | One extra container. Its WhatsApp side has an open crash report (Oct 2026) |

**How a WhatsApp bridge works in practice:** one family member's WhatsApp sits in the family group as the bridge.
Messages are copied both ways with the writer's name. That person's account and number carry the ban risk.

**Recommendation:** A first, built so D (WhatsApp mirroring) can be added later as an option. B only if Signal
matters, or a chat platform beyond the tree is wanted.

### Built-in chat (option A): proposed shape
- **💬 Family chat** in the top bar with an unread count. It opens full screen like the editor. Each message shows
  the sender's photo and name from the tree (needs "Find me"), then the text and the time. Big Send button.
  You can delete your own messages; the owner can delete any. No likes.
- **"Talk about this person"** thread from the details panel (e.g. "Where was Grandpa born?"). Kinnect has no
  equivalent; it ties chat to the tree.
- Stored in `DATA_DIR/chat.sqlite3`, so backups must include the data volume. Not end-to-end encrypted: whoever
  runs the server can read it.

### Picks offered on 2026-10-24 (answered above)
1. **Rooms:** a) one family room (~1.5–2 days) · b) + a thread per person (+½–1 day) · c) + private messages (+1 day)
2. **New messages appear:** a) within a few seconds while open (the page checks regularly) · b) instantly
   (a connection kept open from the server; +½ day, more to look after behind Traefik)
3. **When the app is closed:** a) nothing (unread count) · b) a phone notification (installed app; on iPhone
   only when added to the Home Screen; +1–1.5 days; maybe reuse Gramps Web's new push plumbing) ·
   c) a daily email of unread messages (+1 day; needs email settings)
4. **Who can chat:** a) everyone with a login · b) Members and up
5. **Content:** a) text and emoji · b) + photos with a size limit (+1 day)
6. **Where:** A built-in · B Matrix · C XMPP · D built-in + Matterbridge WhatsApp mirror later

Suggested: **1b 2a 3a 4b 5a, option A** (~2.5 days with "Find me").

## Inviting people and "Claim this person"
- **By email:** an editor taps **Invite** on someone with an email address.
  - Easy Gramps creates their Gramps Web account (`POST /api/users/<name>/`, random password, starting role
    chosen by the owner, e.g. Member).
  - Then it triggers Gramps Web's reset email, which works as a "set your password" invitation.
  - Google users get a sign-in link instead; the owner approves them in Gramps Web.
- **By phone:** **Text them** or **WhatsApp them** opens the inviter's own Messages or WhatsApp
  (`sms:` / `https://wa.me/<number>?text=…`) with the invite filled in. Sending from the server would need a paid
  SMS service.
- **Claim:** the invite link carries a one-time code. After login, the account is linked to that person, the same
  link "Find me" uses. It's stored with the login settings in `DATA_DIR`.
- **Never automatic:** adding an email or phone sends nothing. An editor taps Invite, sees the message, and the
  panel shows "Invited on …".
- **Effort:** ~1.5–2 days including "Find me".

## Proposed order
1. **"Find me" and claims (~1 day):** link a login to a person (automatic, editors can undo).
2. **Family chat, text (~3–4 days):** Whole family, groups, private messages, person conversations, unread
   counts, the daily email (needs email server settings for Easy Gramps).
3. **Invites (~1 day):** still waiting for the owner's picks.
4. **Later, optional:** Matterbridge WhatsApp mirror, phone notifications. (Photos in chat: not planned.)

Other candidates from the Kinnect comparison: occupation and "About" (2–3 h), people in photos (read-only ~½ day),
more generations (1–2 days, mock-up first), map of a person's places (~1 day, outside map tiles).

## Sources
- mautrix: [October 2026 releases](https://mau.fi/blog/2026-10-mautrix-release/),
  [Signal v26.10](https://github.com/mautrix/signal/releases/tag/v0.2610.0),
  [WhatsApp authentication and ban warning](https://docs.mau.fi/bridges/go/whatsapp/authentication.html)
- Matrix servers: [Tuwunel](https://matrix-construct.github.io/tuwunel/),
  [Synapse vs Dendrite vs Continuwuity (2026)](https://www.pistack.xyz/posts/2026-05-02-synapse-vs-dendrite-vs-continuwuity-self-hosted-matrix-server-guide/),
  [Continuwuity vs Tuwunel](https://forgejo.ellis.link/continuwuation/continuwuity/issues/849)
- XMPP: [Slidge gateways](https://joinjabber.org/tutorials/gateways/slidge/),
  [slidge-whatsapp](https://pypi.org/project/slidge-whatsapp/),
  [XMPP Newsletter July 2026](https://xmpp.org/2026/08/the-xmpp-newsletter-july-2026/)
- Matterbridge: [README](https://github.com/42wim/matterbridge),
  [WhatsApp crash issue](https://github.com/matterbridge-org/matterbridge/issues/264),
  [Signal discussion](https://github.com/42wim/matterbridge/discussions/1797),
  [Talk + WhatsApp + Signal write-up](https://blog.junovy.com/bridging-nextcloud-talk-whatsapp-and-signal-how-to-build-a-three-way-chat-bridge/)
- Gramps Web: [OIDC docs](https://www.grampsweb.org/install_setup/oidc/); `gramps-web-api` source
  (`api/__init__.py`, `api/resources/user.py`, `webpush.py`, `api/resources/chat.py`), read 2026-10-24.
- Kinnect: [source](https://github.com/gordon-matt/Kinnect) (`Kinnect.csproj` EasyChatz packages,
  `Services/ChatService.cs`, `Services/Jobs/UnreadMessageEmailJob.cs`).
