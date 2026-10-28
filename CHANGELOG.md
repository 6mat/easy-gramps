# Changelog

All notable changes, newest first. Versions follow `VERSION`; releases are tagged `vX.Y.Z`.

## Unreleased

### Changed
- The editor's "Book pages about them" is above "More details", not inside it.

## 1.9.4 — 2026-10-27

### Added
- **History of editors' changes:** everything changed straight in the tree in Easy Gramps (by editors, the owner, admins, and
  contributors' new people) is kept in words, field by field ("Ravi Kumar · Born: 1960 → 1970 · Changed by Editor"). A field
  changed again within 10 minutes is one entry. Admins can Undo one, unless it was changed again since. Changes made in
  Full Gramps don't show; the list starts with this version.
- The Suggestions panel shows **Recent changes in this tree** (decided suggestions and editors' changes to the people on
  screen), and **History ↗** opens the whole list in a pop-up with a ✕, "Show" (everything, approved, rejected, changed by
  editors) and "By" filters.
- **Date checks:** the editor, the Add box and the review list warn about dates that can't be right (died before born, born
  when a parent was under 12, born after a parent died). It warns; it doesn't stop the save. Owners get ☰ Menu → **Check
  dates**, everyone in the tree with such dates.
- **Book pages** (editors, More details): "+ Add a book page" links a person to a page of a document from Family documents
  (a Gramps citation, so Full Gramps shows it too). The person's details show "📖 Family book, page 42", which opens the PDF
  at that page.
- ☰ Menu says who is logged in and their role.

### Changed
- Members are told at once when an Add can't work: they already have a father or mother (or suggested one), they're already
  husband and wife, already a child of the family, already have parents elsewhere, or it would make someone their own
  ancestor. The server checks the same when the suggestion arrives. Editors get a warning and "Add anyway" for a child who
  already has parents.
- Changes to someone who is still waiting to be added go into adding them ("New: Phili, born 1970"), not a second row.
  Waiting duplicates from before are merged once at start.
- Approving shows "Approving 3 of 10…" with a progress bar (one at a time; one message to each person at the end), and is
  quicker: a new person and their family go to Gramps in one write.
- The Undo message has Undo on the left and a ✕ to close it straight away.
- The approval error names who is already there ("They already have a father: Phili").

### Fixed
- A second Approve while the first was still running (another tab, a reload, a tap while it was slow) could add a person
  again and then fail with "They already have a father". Each suggestion is now claimed before it's saved.
- A suggestion sent again after its answer was lost (a phone switching apps) was refused, and the changes sent with it were
  lost. It's now taken as already there.
- "Delete all rejected" was as tall as the filter beside it.

## 1.9.3 — 2026-10-27

### Added
- **Waiting to join** (☰ Menu → Owner, with how many wait): people who signed up and wait for the owner. Pick what they can
  do (Guest unless they were invited with a role) and let them in, without going to Full Gramps. They get an email saying
  they're in, which Gramps Web doesn't send. Invited people let in automatically get that email too (#173).

### Changed
- Suggestions History: Undo and Delete ask "Confirm undo" / "Confirm delete" and the History stays open. Deleting a
  rejected new person also deletes the rejected changes to them.
- After approving or rejecting, the tree stays where it was, and no History pops up when nothing is left (the toast says
  "Nothing else is waiting"); ☰ Menu → Suggestions still opens the History then.

### Fixed
- Approving or rejecting after looking at a suggested person's tree showed "can't access property "first"…" and left the
  decided suggestions on the list until a reload.

## 1.9.2 — 2026-10-27

### Changed
- **Reviewing suggestions** (#171): "Check all" / "Uncheck all", and "Approve" and "Reject" act on the checked ones. Approving
  also takes the new people they need, and rejecting also takes what builds on them; both say so before they act. Changes
  that build on a new person are indented under them. The list is grouped by family; tap a family's name to see it in the tree.
- **History** is grouped by family too, shows 100 at a time ("Show older"), and can show one person's suggestions
  ("Suggested by"). Rejected ones can be deleted, one at a time or all at once.
- The message to the person who suggested lists each change ("✓ Added: Ravi Kumar's nickname: Ravi anna"), and undoing an
  approved one tells them it was taken back out of the tree.

### Fixed
- A person added as a suggestion showed on the tree only after reloading the page.

## 1.9.1 — 2026-10-27

### Added
- **Suggestions are sent automatically** with each change (Site settings → "Suggestions are sent"; the default). "When they
  press Send to the editors" keeps 1.9.0's way. Fixing a typo replaces the waiting suggestion for that field, and changing it
  back takes it off the list; a later change can build on a new person sent earlier. Without internet, a change waits on the
  device and goes with the next one, or when the family tree is opened again (#168).
- People who suggest see their waiting suggestions on their own tree and in the editor (green and amber), also after a reload.

### Changed
- The editors' list groups suggestions by who made them. The unsent draft is kept per login on a shared device.

## 1.9.0 — 2026-10-27

### Added
- **Suggestions** (#166). The owner turns them on in Site settings → "Who may suggest changes": members and contributors, or
  everyone (guests too). They then get "✎ Suggest a change" instead of editing: the same editor, but what they change
  (fields, a new father, mother, husband or wife, child, and that new person's own details) collects as a suggestion on
  their device until they press "Send to the editors", with a note on where it's from. Nothing goes into Gramps yet.
- Editors: **☰ Menu → 📝 Suggestions** shows the tree as it would be with the ticked suggestions (new people in green,
  changed ones in amber) and the list beside it. Untick what shouldn't go in: unticking a new person unticks everything that
  builds on them, ticking something ticks the new person it needs. "Approve ticked" saves them with the editor's login;
  "Reject the other …" rejects the rest. A field changed since it was suggested is marked. The suggester gets a chat message.
- **History** of decisions with **Undo**: it goes back on the list to decide again; an approved one is first taken out of the
  tree (the field gets its earlier value; a new person is deleted).
- Contributors who may suggest no longer add people straight into the tree here (Full Gramps still lets them).

## 1.8.15 — 2026-10-26

### Added
- **Work and education** under More details, and in the editor's More details. Gramps keeps them as Occupation and
  Education events (the words in the description), so what's typed in Full Gramps shows here too. The editor changes
  the first of each; any others are listed (#164).
- **Site settings → "Family talk about …"** can be turned off: it goes from everyone's details panel and the server
  refuses new messages about a person. Earlier ones stay in Chat (#163).

## 1.8.14 — 2026-10-26

### Fixed
- **A photo showed twice** after uploading it here and then tagging the person on it in Full Gramps (Gramps adds a
  second link to the same picture, with the region). Each picture now shows once, as the tagged part. "Make profile
  photo" on such a picture also dropped the link with the region; now both links move together (#161).

## 1.8.13 — 2026-10-26

### Fixed
- **Family documents on phones:** Read and Download showed "Missing JWT…" when the new tab didn't get the login
  cookie (from an installed app: an iPhone home-screen app has its own cookies, Android treats it as a link from another
  app). Each link now carries a ticket for that one file, good for 10 minutes; an old link says it has run out (#158).

### Added
- **Site settings → Rename menu items and buttons:** the owner can rename the menu items and headings and the Chat and
  Menu buttons, e.g. "📚 Family documents" → "📖 Family history". Empty keeps the default (#159).

## 1.8.12 — 2026-10-26

### Added
- **📚 Family documents** in ☰ Menu: every file in Gramps that isn't a picture (a family book PDF, letters…), with its
  cover, by title. **Read** opens a PDF in the browser's own viewer in a new tab; **Download** saves it under its title.
  Add them in Full Gramps (Media); everyone with access sees them (Gramps keeps private ones from guests). The owner
  can hide the item in Site settings (#156).
- **The version** at the bottom of ☰ Menu ("Easy Gramps v1.8.12"), set by the release build ("dev" in your own builds).

## 1.8.11 — 2026-10-25

### Changed
- **Invites:** editors can invite too (it's sharing a link). "✉ Invite to the family tree" opens on the message, with
  WhatsApp, ✉ Email, Share… and Copy. ✉ Email asks for their address (the owner also picks the role) and sends it from
  the family tree's email address, or opens your mail app when the server can't send email. New wording: Google
  sign-in first, "No Google account? Message me and I'll make you a login", accounts approved by hand (#152).

### Added
- **Group photos:** when a person is tagged on part of a picture in Gramps (a region), their photo shows that part,
  not the whole picture: in the tree, the panel and the photo strips. Tapping it still shows the whole picture (#153).

## 1.8.10 — 2026-10-25

### Added
- **Nickname when adding someone new** (Add a relative's "Someone new", and Add a new person on the start screen),
  saved like the editor's Nickname (#149).
- **Nicknames in search results**, in brackets: "Ravi Kumar (Chinnu)", in both searches, Find me, "Pick someone
  already in the tree" and the "There is already someone called …" warning. Typing the nickname already found them (#149).

### Fixed
- **Small phones and the Galaxy Z Flip:** the login card ran off the right edge on screens under ~420px wide, and under
  ~405px the top bar pushed ☰ Menu off the screen. Now the login card fits, the top bar shows icons only (⌂ 🔍 💬 ☰)
  on screens 400px wide or less, and the zoom strip fits down to 320px (#150).

## 1.8.9 — 2026-10-25

### Added
- **Invites by email:** with their Google email, **✉ Send by email** sends the invite from the family tree's email
  address (`DEFAULT_FROM_EMAIL`; replies go to you). Shown when the server can send email (`EMAIL_HOST`) (#147).
- **Invites without an email:** leave the email empty and you get just the message with the link, to send with
  **WhatsApp**, Share… or Copy. Nothing is kept; when they've signed in, give them a role in Full Gramps (#147).

## 1.8.8 — 2026-10-25

### Added
- **Site settings** for the owner (☰ Menu → Owner → ⚙️ Site settings), the same for everyone (#145):
  - **the app's name:** browser tab, installed app, top bar and login screen;
  - **its icon:** upload a picture (made square from the middle), or back to the default; installed apps pick it up;
  - **what the menu shows:** Theme, Display, Dates, You, Install, Show tips, Keyboard keys, Source code;
  - **who gets the Full Gramps link** (the menu and the editors' "Open in Full Gramps ↗"): nobody, the owner, editors
    and the owner, or everyone. Hiding it doesn't change what anyone may do; their role in Gramps Web decides that.

## 1.8.7 — 2026-10-25

### Added
- **Invite someone, with their role** (the owner): in a person's More details, **✉ Invite to the family tree** →
  their Google email and what they can do (Guest, Member, Contributor, Editor) → a ready message to send from your
  phone (Share… or Copy). When they sign in with Google, Gramps Web makes their account and waits for approval; the
  next time you open Easy Gramps they're let in with that role and linked to their place in the tree ("Asha (Member)
  joined the family tree ✓"). Matched by email; Easy Gramps sends nothing by itself (#143).
- **Asked once after login:** "Get a notification when the family messages you?" Allow brings the browser's own
  question; Not now hides it on that device. The switch stays in ☰ Menu → You (#142).

### Changed
- **No notification while the family tree is on screen** (the chat's count shows it there) (#142).

## 1.8.6 — 2026-10-25

### Changed
- **Phone and email** in a person's More details are shown only to editors and the owner (before: every Member). The
  server leaves them out for everyone else; the panel says they're only for editors (#135).
- **Typing a date** follows ☰ Menu → Dates: day first (DD/MM/YYYY), month first or year first, with the number
  keypad. The 📅 button next to it opens the calendar. "I only know the year" stays. A date that doesn't exist
  (31/02) isn't saved and says how to type it (#138).
- **Find me** is now "Claim your place in the family tree", and says why: the family can message you in the chat.
  If Gramps Web already has a home person in this browser, it asks "Are you …?" with one-tap Yes (#139).
- **"The family tree works best on a wider screen"** is part of the tip now (☰ Menu → Show tips), not always shown
  on phones (#137).

### Added
- **📲 Install as an app** is always in ☰ Menu (but not inside the installed app). When the browser can't install
  it by itself (Samsung Internet, Firefox, iPhone, or Chrome not ready yet), it shows the steps (#136).
- **Editors can remove a "Message deleted" line** from the chat altogether (⋯ on it, then Yes, remove it) (#140).

### Fixed
- **Phones:** the Menu button no longer sticks out past the right edge of the screen, and the editor fits the screen
  (its header made it about 200px wider than a phone) (#137).

## 1.8.5 — 2026-10-25

### Added
- **Chat notifications** on phones and computers: ☰ Menu → You → "Notify me of new chat messages on this device".
  Each new message shows a notification (one per conversation); tapping it opens the conversation. On iPhones and
  iPads only in the app added to the Home Screen. Logging out switches them off on that device. Nothing to set up:
  the server makes its own key in the data folder (`push-key.pem`; back it up with the chat). Messages are
  encrypted for each device, so the browsers' push services can't read them (#133).
- **The unread count** is in the browser tab's title, and on the installed app's icon where the device shows one (#132).

### Fixed
- **Private people stay private in the chat:** talk about someone marked private in Gramps reaches only logins that
  may see private records (not Guests): not in their list, messages, daily email or notifications (#123, #129).
- **Logins not seen for 30 days** (for example disabled in Gramps Web) no longer get the daily email or
  notifications, and aren't offered in "Message someone" (#122).
- **The email password is never sent unencrypted:** STARTTLS never started on port 587 before (it was asked for
  before greeting the server). Now it does, and with a login a server without it is an error (#124).
- **One failed email doesn't stop the others** (before, a bad address stopped everyone after it, every hour) (#121).
- A person's name in the daily email follows changes in the tree (#131).
- Deleting a group and merging people save all their changes or none (#128).

### Changed
- Each login's settings and "Find me" person moved from `settings.json` into `chat.sqlite3` (one file to back up);
  the old file is imported once and kept as `settings.json.imported` (#126). Storage errors are reported in one
  place (#127).
- The Quadlet example keeps the email password in a Podman secret (#125).
- New dependencies: `py-vapid` (MPL-2.0) and `http-ece` (MIT), for the notifications.

## 1.8.0 — 2026-10-25

### Added
- **Family chat** (text and emoji), for everyone with a login. **💬 Chat** in the top bar shows how many
  messages are new. The chat opens full screen (Back closes it):
  - **Whole family:** everyone is in it.
  - **Groups:** editors and the owner make them (a name and a picture); everyone can see them, join and leave.
  - **Private messages** between two people: "+ Message someone", or **💬 Message …** in the details panel of
    someone who has found themselves in the tree.
  - **About a person:** "Family talk about …" at the bottom of everyone's details panel: the last messages and
    a box to ask or tell the family something about them. Everyone with a login can read and write there.
  - Messages show the photo and name of the person the writer found themselves as ("Find me"), else their
    login name. Delete your own messages (editors and the owner: anyone's); "Message deleted" stays in its
    place. No editing. New messages appear within a few seconds.
  - On a phone: the list of conversations, then one conversation (← Chats).
- **A daily email** for chat messages that have waited a day unread: at most one a day, listing them by
  conversation, with a link back; ☰ Menu → You switches it off. It uses the same email settings as Gramps
  Web: `EMAIL_HOST` and the rest, or Gramps Web's own `GRAMPSWEB_EMAIL_HOST`… names (one env file for both);
  without them, no emails.
- **Find me also sets Gramps Web's home person** (where both share the site and login): when you say
  "Yes, this is me", and on another device the first time, unless you picked a home person there already.
  Gramps Web keeps it in each browser.
- The chat is kept in `DATA_DIR/chat.sqlite3` (Python's own SQLite; nothing new to install), so include the
  data folder in backups. Whoever runs the server can read it: it isn't end-to-end encrypted.

## 1.7.0 — 2026-10-25

### Added
- **Find me:** link your login to yourself in the tree. The start screen asks "Are you in this family tree?"
  (Find me, or Not now for this device); you search, check "Is this you?" (photo, birth, parents) and say
  yes. Then the start screen has **Your family tree** at the top, and your panel says "This is you".
  Anyone with a login can do it, no approval; one login per person ("Already linked to another login").
  ☰ Menu → You: Change, or That's not me. Editors see "Linked to the login …" under More details, with
  Unlink. When two records of a person are merged, the link follows the one kept. This is the first step
  towards the family chat (docs/research/chat-and-invites.md).
- Kept in `DATA_DIR/settings.json` with the date format, so include the data folder in backups.

### Fixed
- The browser check clicked Undo on the previous add's message while a removal was still saving.

## 1.6.0 — 2026-10-25

### Added
- **📲 Install as an app** in the Menu (under Help): one tap opens Chrome's own install prompt, so relatives
  don't have to find "Add to Home screen" in the browser's ⋮ menu. It shows only when the browser offers
  installing (Chrome and Edge on Android and computers) and the app isn't installed yet; on an iPhone it
  stays hidden (Safari: Share → Add to Home Screen).

## 1.5.1 — 2026-10-24

### Security
- Pillow (used only to make the app icons from one picture) is updated from 12.3.0 to 13.0.0, which fixes 37
  known vulnerabilities. The dependency check in the tests and the release refused 12.3.0.

## 1.5.0 — 2026-10-13

### Added
- **Open in Full Gramps ↗** (editors only, #70): straight to a record's own page in Gramps Web, in a new tab.
  In the details panel under More details (this person, birth, place of birth, death, burial, burial
  place), in the editor's header (the person) and on each "Children with …" group (the family), and in
  the big photo view (the photo, e.g. to add a caption or tag the people in it).

### Changed
- **The default address is now `/easy-gramps`** instead of `/family` (#103). Gramps Web's own family pages
  are `/family/F…`, so family links need Easy Gramps elsewhere. An install that sets `BASE_PATH=/family`
  keeps working there; the README (Install → "Move from `/family` to `/easy-gramps`") says how to move.
  Old bookmarks and phones that installed the page as an app need the new address.

## 1.4.1 — 2026-10-13

### Changed
- **Smoother zooming:** pinch, Ctrl+scroll, − + and Fit only rescale the tree instead of drawing every box
  again; selecting someone just moves the ring (#97).
- The tree's lists are fetched from Gramps Web at the same time instead of one after another (#98), and
  the page loads the tree while it sets up the photo login (#101).
- Closing the editor reloads the tree only when something was saved (#101).
- The heading over someone's husbands or wives is worded the same everywhere: "Husbands" for a woman with
  two, "Husband or wife" when the gender isn't set (was "Spouse" in the panel) (#99).

### Fixed
- The merge screen and the merge itself work out "Will be saved as" with the same code, so what's shown is
  what's saved (#100).
- "Show tips" in the menu now also tells screen readers the menu closed (#101).

### Internal
- Shared helpers for the photo address, closing the menu, the Male/Female picker and keeping Tab inside
  pop-ups; unused styles removed (#101).

## 1.4.0 — 2026-10-13

### Changed
- **A release runs the tests first:** the Release image workflow builds nothing unless the tests and
  checks pass, so a broken build can't reach servers that update themselves (#90).
- Development `compose.yaml`: no tag on records by default, like the app and the server example (#93).

### Fixed
- **Saving a person's details checks edit rights first.** A Contributor calling the save directly could
  leave unused places, events or notes behind before Gramps refused it (#91).
- **Login limit:** logging in with your own account no longer resets the wrong tries at someone else's
  name, so the limit can't be dodged (#92). Two logins at the same moment from one place could give an
  "Internal Server Error" and the wrong try wasn't counted (#94).
- One connection pool to Gramps Web instead of two (#95).

## 1.3.4 — 2026-10-10

### Fixed
- Adding a mother (or father) could still make the couple twice when their family had been taken
  off both of them in Gramps Web's editor (the family still names them). Now every family is checked.
- "B is listed as A's wife twice" and **Combine them** now also show in the details panel, not only
  in the editor.

## 1.3.3 — 2026-10-10

(Includes 1.3.2, which wasn't released on its own.)

### Added
- **ⓘ preview when picking someone:** in the Add pop-up's "Pick someone already in the tree" and in the
  merge dialog, the same preview as in the search (born, parents, wife or husband, children), so the
  right person gets linked or merged. Keys work there too (↓ ↑, → / ←).
- **A couple listed twice can be combined:** the editor says "B is listed as A's wife twice" and editors
  can **Combine them** (Gramps' own family merge: the children and dates of both are kept). This repairs
  families tidied up only partly in Gramps Web.

### Changed
- "Is this person in the tree twice?" is now **"⧉ Duplicate profile? Merge."**, a real button.
- The Add pop-up says when a new father or mother also goes to brothers and sisters in the same family.

### Fixed
- Adding a mother (or father) who was already the other parent's wife (or husband) made the couple
  twice: A got B as a second wife, B got A as a second husband. Now the children join the couple's
  family instead, and Undo puts it back as it was.
- The word "false" showed under a person's name in the details panel when they had one photo or none
  (since 1.3.0), and at the bottom of the big photo view for people who can't edit. The same slip is
  fixed on the login screen (when only a sign-in button is offered) and in the Add pop-up. The screen
  check now fails if "false", "undefined", "null" or "NaN" ever shows on screen.

## 1.3.1 — 2026-10-10

### Fixed
- Choosing a date format said "Not saved to your login, only on this device" on servers set up with
  the Podman file: the container had no data folder it could write. The image now has one, the
  Podman and compose files give it a volume (so the settings survive updates; add the line to an
  installed copy, see README), and the message says when the server's data folder is the problem.

## 1.3.0 — 2026-10-10

### Added
- **See a photo bigger:** tap the photo in the details panel or the editor. ‹ › (or ← →, or a swipe)
  go between their photos; ✕, Esc, a tap beside the photo or Back closes it.
- **More photos per person:** the editor has a Photos section with "+ Add photos" (several at once).
  In the big view, editors can choose "Use as profile photo" or "Remove from this person" (it asks
  first, and the photo stays in Gramps). The details panel shows a strip of their photos.

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
