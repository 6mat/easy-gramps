// Easy Gramps — the "How to…" help: every task, in words, for the screen it's on and who may do it. No imports (help.js
// fills `c` from the login and Site settings; tests/checks.test.mjs checks the lists). Steps mark button names **like this**.
// c: {role: editor|suggest|contributor|guest, owner, admin, history, reviews, check, auto, talk, email, hide (Set),
//     label(key, default) (the owner's names for menu items), date (e.g. "DD/MM/YYYY"), eg (that format's example), digits}
// show: what "Show me" lights up: sel (first one on screen), and menu / chat / manage to open first.
const menu = (c, ...path) => [`**☰ ${c.label("menu", "Menu")}**`, ...path.map(p => `**${p}**`)].join(" → ");
const changes = c => (c.role === "suggest" ? "suggest" : "edit");
const changer = c => c.role === "editor" || c.role === "suggest";
const sent = c => (c.role !== "suggest" ? [] : c.auto
  ? ["It goes to the editors as a suggestion. When they've looked at it, you get a message in 💬 Chat → **🌳 Family tree updates**."]
  : ["It's kept on this device until you press **Send to the editors**. You get their answer in 💬 Chat → **🌳 Family tree updates**."]);
const edit = c => (c.role === "suggest" ? "✎ Suggest a change" : "✎ Edit person");

export const SCREENS = { tree: "The family tree", editor: "Changing a person", chat: "Family chat", manage: "Manage" };

const TASKS = [
  // ---------- the tree ----------
  { at: "tree", t: "Find someone", steps: () => ["Type part of their name in the **Search a name** box at the top.",
    "Tap their name. The ⓘ beside a name shows who they are first."], show: { sel: "#q:not([hidden]), #start-q" } },
  { at: "tree", t: "Move around the tree", steps: () => ["Drag to move. Pinch, or use **−** and **+** at the bottom, to zoom.",
    "**Fit** shows the whole tree. Double-tap someone to centre on them."], show: { sel: ".zoomgrp" } },
  { at: "tree", t: "See someone's details", steps: () => ["Tap their box. Their details open on the right (on a phone, at the bottom).",
    "Tap **More details** for the rest. Tap a parent, wife, husband or child there to go to them."] },
  { at: "tree", t: "See someone else's family tree", steps: () => ["Tap their box, then **See their tree →** at the top.",
    "**⌂** at the top left goes back to the start, to choose anyone."], show: { sel: "#tree-see:not([hidden]), #brand" } },
  { at: "tree", t: "Find yourself in the tree", who: c => !c.hide.has("you"), steps: c => [`Open ${menu(c, c.label("you", "You"))}.`,
    "Tap **Claim your place in the tree**, search your name and tap **Yes, this is me**. Then the family can message you in the chat."],
    show: { menu: true, sel: "#menu-me" } },
  { at: "tree", t: "How are two people related?", who: c => !c.hide.has("trace"), steps: c => [
    `Tap one of them, then **${c.label("trace", "🔗 Trace relationship")}** under their name.`,
    `Or open ${menu(c, c.label("family", "Family"), c.label("trace", "🔗 Trace relationship"))} and pick both.`],
    show: { menu: true, sel: "#menu-trace" } },
  { at: "tree", t: "Change someone's details", who: changer, steps: c => [`Tap them, then **${edit(c)}**.`,
    "Type in the box. It's saved by itself when you leave the box: no Save button.", ...sent(c)], show: { sel: ".panel .edit" } },
  { at: "tree", t: "Add a father, mother, husband, wife or child", who: changer, steps: c => [`Tap the person, then **${edit(c)}**.`,
    "Tap a dotted box such as **Add father** or **Add child**.",
    "Type the new person's name, or tap **Pick someone already in the tree** if they're already in it.", ...sent(c)],
    show: { sel: ".panel .edit" } },
  { at: "tree", t: "Add a person who has no relatives in the tree yet", who: c => c.role === "editor" || c.role === "contributor",
    steps: () => ["Tap **⌂** at the top left to go to the start.", "Tap **+ Add a new person**, fill in the name, and add."],
    show: { sel: "#brand" } },
  { at: "tree", t: "Add or change a photo", who: changer, steps: c => [`Tap the person, then **${edit(c)}**.`,
    c.role === "editor" ? "Tap the photo to choose a new one, or **+ Add photos** for more. ★ marks the profile photo."
      : "Tap **Suggest a photo** and choose one.", ...sent(c)], show: { sel: ".panel .edit" } },
  { at: "tree", t: "Change or add things in the tree", who: c => c.role === "contributor" || c.role === "guest",
    steps: c => [c.role === "contributor" ? "You can add new people (see above). To change details or link people, ask an editor."
      : "You can look at everything, but not change it. If you'd like to help, ask the family tree's owner."] },
  { at: "tree", t: "Invite a relative", who: c => c.role === "editor", steps: () => [
    "Tap them, open **More details** and tap **✉ Invite to the family tree** (people who don't have a login yet).",
    "Send the message by WhatsApp, email or any app."] },
  { at: "tree", t: "Old family papers", who: c => !c.hide.has("docs"), steps: c => [`Open ${menu(c, c.label("family", "Family"), c.label("docs", "📚 Family documents"))}.`],
    show: { menu: true, sel: "#menu-docs" } },
  { at: "tree", t: "Bigger text, dark screen or another date style", who: c => !c.hide.has("display") || !c.hide.has("theme") || !c.hide.has("dates"),
    steps: c => [`Open ${menu(c, c.label("display", "Display"))}.`, "Changes show at once and stay with your login."],
    show: { menu: true, sel: "#h-display" } },
  { at: "tree", t: "Put the family tree on your home screen", who: c => !c.hide.has("install"),
    steps: c => [`Open ${menu(c, c.label("help", "Help"), c.label("install", "📲 Install as an app"))} and follow the steps.`],
    show: { menu: true, sel: "#menu-install" } },

  // ---------- Edit person ----------
  { at: "editor", t: "Change a detail", who: changer, steps: c => ["Tap the box and type. It's saved by itself when you leave the box.",
    "**Saved ✓** at the top right says it worked. **Not saved** shows **Try again**.", ...sent(c)] },
  { at: "editor", t: "Type a date", who: changer, steps: c => [`Type it as ${c.date}, for example ${c.eg}.`,
    `On a phone you can type just the numbers, such as ${c.digits}.`,
    "Or tap 📅 to pick it from a calendar. Only know the year? Tick **I only know the year**."] },
  { at: "editor", t: "Add a relative", who: changer, steps: c => ["Tap a dotted box such as **Add father**, **Add mother** or **Add child**.",
    "Type the new person's name, or **Pick someone already in the tree**. One person at a time.", ...sent(c)], show: { sel: ".ed-slot" } },
  { at: "editor", t: "Take someone out of a family", who: c => c.role === "editor", steps: () => [
    "Tap **⋯** on their card, then **Remove from this family**. Nobody is deleted: only the link goes.",
    "Made a mistake? Tap **Undo** at the bottom."] },
  { at: "editor", t: "Someone has passed away", who: changer, steps: c => ["Tick **Passed away?**. Boxes for the date and burial place appear.", ...sent(c)] },
  { at: "editor", t: "Photos", who: changer, steps: c => [c.role === "editor"
    ? "Tap **+ Add photos** to add more. Tap a photo to see it big, then **Use as profile photo** or remove it."
    : "Tap **Suggest a photo** to send one for the editors to look at."] },
  { at: "editor", t: "The same person is in the tree twice", who: c => c.role === "editor", steps: () => [
    "Under **Other actions**, tap **Merge with a duplicate** and find the other one.", "Choose which details to keep, then merge."],
    show: { sel: ".ed-other" } },
  { at: "editor", t: "Delete a person added by mistake", who: changer, steps: c => [
    `Under **Other actions**, tap **Delete this person**.${c.role === "editor" && !c.owner ? " Editors can delete people they added; for others, it's sent as a suggestion." : ""}`,
    ...(c.role === "suggest" ? ["It's a suggestion: an editor decides."] : [])], show: { sel: ".ed-other" } },
  { at: "editor", t: "Go back to the tree", steps: () => ["Tap **← Back to tree** at the top left. Your changes are already saved."],
    show: { sel: "#ed-back" } },

  // ---------- chat ----------
  { at: "chat", t: "Write to the whole family", steps: () => ["Tap **Whole family** in the list, type in the box at the bottom and tap **Send**."] },
  { at: "chat", t: "Send a private message", who: c => c.dms, steps: () => ["Tap **+ Message someone** and pick them.",
    "Only the two of you can read it. People who turned off private chats aren't listed."], show: { chat: true, sel: ".clist" } },
  { at: "chat", t: "Groups", steps: c => [c.role === "editor" ? "Tap **+ New group** to make one, or **Join** under Groups you can join."
    : "Tap **Join** under Groups you can join. Editors make new groups."] },
  { at: "chat", t: "Talk about a person in the tree", who: c => c.talk, steps: () => [
    "Tap them in the tree, then **💬 Family talk about …** at the bottom of their details."] },
  { at: "chat", t: "Answers to your suggestions", who: c => c.role === "suggest", steps: () => [
    "They come in **🌳 Family tree updates**, under Groups. Nobody writes there: it's only for you."] },
  { at: "chat", t: "Delete a message you wrote", steps: () => ["Tap **⋯** beside it, then delete. \"Message deleted\" stays in its place."] },
  { at: "chat", t: "Get told about new messages", who: c => !c.hide.has("you"), steps: c => [
    `Open ${menu(c, c.label("you", "You"))} and turn on **Notify me of new chat messages on this device**.`,
    ...(c.email ? ["Or turn on the email for a message that waits for you a day."] : [])], show: { menu: true, sel: "#menu-me" } },
  { at: "chat", t: "Turn off private chats", who: c => !c.hide.has("you"), steps: c => [`Open ${menu(c, c.label("you", "You"))}, turn off **Private chats**.`,
    "Nobody can message you privately then, and you can't message others. The family chat and groups stay."],
    show: { menu: true, sel: "#menu-me" } },

  // ---------- Manage ----------
  { at: "manage", t: "Look at suggestions", who: c => c.reviews, steps: c => [
    `Open ${menu(c, c.label("manage", "⚙️ Manage"))} → **Suggestions**. The tree shows them on top, new and changed boxes marked.`,
    "Tick the ones to take, then **Approve** or **Reject**. The person who sent them gets a message.",
    "Changed your mind? **History** has **Undo**."] },
  { at: "manage", t: "See who changed what", who: c => c.history, steps: c => [
    `Open ${menu(c, c.label("manage", "⚙️ Manage"))} → **History**.${c.admin ? " Undo puts a change back." : ""}`] },
  { at: "manage", t: "Someone is waiting to join", who: c => c.owner, steps: c => [
    `Open ${menu(c, c.label("manage", "⚙️ Manage"))} → **Waiting to join**.`,
    "Pick what they may do and tap **Let them in**: they get a \"You're in\" email. **Say no** deletes the sign-up."] },
  { at: "manage", t: "Invite someone with their place in the tree", who: c => c.owner, steps: () => [
    "Tap them in the tree, open **More details**, tap **✉ Invite to the family tree** → **✉ Email**, and pick what they may do.",
    "When they sign in with that email, they're let in and linked to their place by themselves."] },
  { at: "manage", t: "Find mistakes in the tree", who: c => c.check, steps: c => [
    `Open ${menu(c, c.label("manage", "⚙️ Manage"))} → **🔍 Check the tree**: duplicates, odd dates, split families, people with no relatives.`,
    "**See them** shows them on the tree."] },
  { at: "manage", t: "Who can do what, names and menu", who: c => c.owner, steps: c => [
    `Open ${menu(c, c.label("manage", "⚙️ Manage"))} → **⚙️ Settings**.`,
    "There you set who may suggest changes, the app's name and picture, and rename or hide menu items."] },
];

// The tasks this person may do: this screen's first, then the rest, each with its steps in words.
export function tasksFor(c, here) {
  const mine = TASKS.filter(x => (!x.who || x.who(c)) && (x.at !== "editor" || c.role !== "guest")
    && (x.at !== "manage" || c.owner || c.reviews || c.history || c.check))
    .map(x => ({ at: x.at, title: x.t, steps: x.steps(c), show: x.show }));
  return [...mine.filter(x => x.at === here), ...mine.filter(x => x.at !== here)];
}
export const TASK_COUNT = TASKS.length;
