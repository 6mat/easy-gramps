// Easy Gramps — the "How to…" help: every task, in words, for the screen it's on and who may do it. No imports (help.js
// fills `c` from the login and Site settings; tests/checks.test.mjs checks the lists). Words mark button names **like this**.
// c: {role: editor|suggest|contributor|guest, owner, admin, history, reviews, check, auto, talk, email, dms, hide (Set),
//     label(key, default) (the owner's names for menu items), date (e.g. "DD/MM/YYYY"), eg (that format's example), digits}
// go: "👉 Show me", step by step: [selector, what to do, mode]. help.js rings the first matching button that's showing and
// moves on when it's tapped; mode "read": nothing to tap there, a Next / Done button instead. Selector null: words only.
// Changed a button these point at, or its words? tests/checks.test.mjs fails until this file says the same.
const menu = (c, ...path) => [`**☰ ${c.label("menu", "Menu")}**`, ...path.map(p => `**${p}**`)].join(" → ");
const changer = c => c.role === "editor" || c.role === "suggest";
const sent = c => (c.role !== "suggest" ? [] : c.auto
  ? ["It goes to the editors as a suggestion. When they've looked at it, you get a message in 💬 Chat → **🌳 Family tree updates**."]
  : ["It's kept on this device until you press **Send to the editors**. You get their answer in 💬 Chat → **🌳 Family tree updates**."]);
const edit = c => (c.role === "suggest" ? "✎ Suggest a change" : "✎ Edit person");

// Steps several tours share.
const PERSON = ["#rows .node", "Tap the person's box in the tree. Not there? Search their name at the top first."];
const EDIT = c => [".panel .edit", `Tap **${edit(c)}**.`];
const MENU = c => ["#menubtn", `Tap **☰ ${c.label("menu", "Menu")}** at the top.`];
const CHAT = c => ["#chatbtn", `Tap **💬 ${c.label("chat", "Chat")}** at the top.`];
const MANAGE = c => [MENU(c), ["#menu-manage", `Tap **${c.label("manage", "⚙️ Manage")}**.`]];
const MORE = [".panel .moretoggle", "Tap **More details ▾**."];
const TYPE = "#ed-body input:not([type=checkbox]):not([type=radio]):not([type=file])";

export const SCREENS = { tree: "The family tree", editor: "Changing a person", chat: "Family chat", manage: "Manage" };

const TASKS = [
  // ---------- the tree ----------
  { at: "tree", t: "Find someone", steps: () => ["Type part of their name in the **Search a name** box at the top.",
    "Tap their name. The ⓘ beside a name shows who they are first."],
  go: () => [["#q, #start-q", "Type part of their name here, then tap them in the list.", "read"]] },
  { at: "tree", t: "Move around the tree", steps: () => ["Drag to move. Pinch, or use **−** and **+** at the bottom, to zoom.",
    "**Fit** shows the whole tree. Double-tap someone to centre on them."],
  go: () => [[".zoomgrp", "Zoom with − and +; Fit shows everyone. Drag the tree to move it.", "read"]] },
  { at: "tree", t: "See someone's details", steps: () => ["Tap their box. Their details open on the right (on a phone, at the bottom).",
    "Tap **More details** for the rest. Tap a parent, wife, husband or child there to go to them."],
  go: () => [PERSON, [".panel .moretoggle", "Tap **More details ▾** for the rest.", "read"]] },
  { at: "tree", t: "See someone else's family tree", steps: () => ["Tap their box, then **See …'s tree →** at the top.",
    "**⌂** at the top left goes back to the start, to choose anyone."],
  go: () => [PERSON, ["#tree-see", "Tap **See …'s tree →**."]] },
  { at: "tree", t: "Find yourself in the tree", who: c => !c.hide.has("you"), steps: c => [`Open ${menu(c, c.label("you", "You"))}.`,
    "Tap **Claim your place in the tree**, search your name and tap **Yes, this is me**. Then the family can message you in the chat."],
  go: c => [MENU(c), ["#menu-me button", "Tap **Claim your place in the tree**, or **Change** if it's the wrong person."]] },
  { at: "tree", t: "How are two people related?", who: c => !c.hide.has("trace"), steps: c => [
    `Tap one of them, then **${c.label("trace", "🔗 Trace relationship")}** under their name.`,
    `Or open ${menu(c, c.label("family", "Family"), c.label("trace", "🔗 Trace relationship"))} and pick both.`],
  go: c => [PERSON, [".panel .trace", `Tap **${c.label("trace", "🔗 Trace relationship")}**, then pick the other person.`]] },
  { at: "tree", t: "Change someone's details", who: changer, steps: c => [`Tap them, then **${edit(c)}**.`,
    "Type in the box. It's saved by itself when you leave the box: no Save button.", ...sent(c)],
  go: c => [PERSON, EDIT(c), [TYPE, "Tap a box and type. It's saved by itself when you leave the box.", "read"]] },
  { at: "tree", t: "Add a father, mother, husband, wife or child", who: changer, steps: c => [`Tap the person, then **${edit(c)}**.`,
    "Tap a dotted box such as **Add father** or **Add child**.",
    "Type the new person's name, or tap **Pick someone already in the tree** if they're already in it.", ...sent(c)],
  go: c => [PERSON, EDIT(c), [".ed-slot", "Tap a dotted box such as **Add father** or **Add child**."],
    ["#dlg input", "Type their name, or tap **Pick someone already in the tree**.", "read"]] },
  { at: "tree", t: "Add a person who has no relatives in the tree yet", who: c => c.role === "editor" || c.role === "contributor",
    steps: () => ["Tap **⌂** at the top left to go to the start.", "Tap **+ Add a new person**, fill in the name, and add."],
    go: () => [["#brand", "Tap **⌂** to go to the start."], ["#start-add", "Tap **+ Add a new person**."]] },
  { at: "tree", t: "Add or change a photo", who: changer, steps: c => [`Tap the person, then **${edit(c)}**.`,
    c.role === "editor" ? "Tap **Add photo** (or **Change photo**) beside the photo, or **+ Add photos** for more. ★ marks the profile photo."
      : "Tap **Suggest a photo** and choose one.", ...sent(c)],
  go: c => [PERSON, EDIT(c), [".photo-row > button:not(.phbtn)", c.role === "editor" ? "Tap **Add photo** or **Change photo**." : "Tap **Suggest a photo**."],
    [null, "Choose a photo on your phone or computer.", "read"]] },
  { at: "tree", t: "Change or add things in the tree", who: c => c.role === "contributor" || c.role === "guest",
    steps: c => [c.role === "contributor" ? "You can add new people (see above). To change details or link people, ask an editor."
      : "You can look at everything, but not change it. If you'd like to help, ask the family tree's owner."] },
  { at: "tree", t: "Invite a relative", who: c => c.role === "editor", steps: () => [
    "Tap them, open **More details** and tap **✉ Invite to the family tree** (people who don't have a login yet).",
    "Send the message by WhatsApp, email or any app."],
  go: () => [PERSON, MORE, [".panel .invite", "Tap **✉ Invite to the family tree**."]] },
  { at: "tree", t: "Old family papers", who: c => !c.hide.has("docs"), steps: c => [`Open ${menu(c, c.label("family", "Family"), c.label("docs", "📚 Family documents"))}.`],
    go: c => [MENU(c), ["#menu-docs", `Tap **${c.label("docs", "📚 Family documents")}**.`]] },
  { at: "tree", t: "Bigger text, dark screen or another date style", who: c => !c.hide.has("display") || !c.hide.has("theme") || !c.hide.has("dates"),
    steps: c => [`Open ${menu(c, c.label("display", "Display"))}.`, "Changes show at once and stay with your login."],
    go: c => [MENU(c), ["#h-display", "These change how the tree looks, at once.", "read"]] },
  { at: "tree", t: "Put the family tree on your home screen", who: c => !c.hide.has("install"),
    steps: c => [`Open ${menu(c, c.label("help", "Help"), c.label("install", "📲 Install as an app"))} and follow the steps.`],
    go: c => [MENU(c), ["#menu-install", `Tap **${c.label("install", "📲 Install as an app")}**.`]] },

  // ---------- Edit person ----------
  { at: "editor", t: "Change a detail", who: changer, steps: c => ["Tap the box and type. It's saved by itself when you leave the box.",
    c.role === "suggest" ? "**Not in the tree yet** at the top right means it's waiting for an editor."
      : "**Saved ✓** at the top right says it worked. **Not saved** shows **Try again**.", ...sent(c)],
  go: () => [[TYPE, "Tap a box and type. It's saved by itself when you leave the box.", "read"]] },
  { at: "editor", t: "Type a date", who: changer, steps: c => [`Type it as ${c.date}, for example ${c.eg}.`,
    `On a phone you can type just the numbers, such as ${c.digits}.`,
    "Or tap 📅 to pick it from a calendar. Only know the year? Tick **I only know the year**."],
  go: c => [[".daterow input", `Type the date as ${c.date}, or tap 📅 beside it.`, "read"]] },
  { at: "editor", t: "Add a relative", who: changer, steps: c => ["Tap a dotted box such as **Add father**, **Add mother** or **Add child**.",
    "Type the new person's name, or **Pick someone already in the tree**. One person at a time.", ...sent(c)],
  go: () => [[".ed-slot", "Tap a dotted box such as **Add father** or **Add child**."],
    ["#dlg input", "Type their name, or tap **Pick someone already in the tree**.", "read"]] },
  { at: "editor", t: "Take someone out of a family", who: c => c.role === "editor", steps: () => [
    "Tap **⋯** on their card, then **Remove from this family**. Nobody is deleted: only the link goes.",
    "Made a mistake? Tap **Undo** at the bottom."],
  go: () => [[".rcard .more", "Tap **⋯** on their card."], [".rcard .menu .danger", "Tap **Remove from this family**."]] },
  { at: "editor", t: "Someone has passed away", who: changer, steps: c => ["Tick **Passed away?**. Boxes for the date and burial place appear.", ...sent(c)],
    go: () => [["#ed-passed", "Tick **Passed away?**."]] },
  { at: "editor", t: "Photos", who: changer, steps: c => [c.role === "editor"
    ? "Tap **+ Add photos** to add more. Tap a photo to see it big, then **Use as profile photo** or remove it."
    : "Tap **Suggest a photo** to send one for the editors to look at."],
  go: c => [c.role === "editor" ? [".phadd", "Tap **+ Add photos**."] : [".photo-row > button:not(.phbtn)", "Tap **Suggest a photo**."],
    [null, "Choose a photo on your phone or computer.", "read"]] },
  { at: "editor", t: "The same person is in the tree twice", who: c => c.role === "editor", steps: () => [
    "Under **Other actions**, tap **Merge with a duplicate** and find the other one.", "Choose which details to keep, then merge."],
  go: () => [[".dupbtn", "Tap **Merge with a duplicate**."]] },
  { at: "editor", t: "Delete a person added by mistake", who: changer, steps: c => [
    `Under **Other actions**, tap **Delete this person**.${c.role === "editor" && !c.owner ? " Editors can delete people they added; for others, it's sent as a suggestion." : ""}`,
    ...(c.role === "suggest" ? ["It's a suggestion: an editor decides."] : [])],
  go: () => [[".delbtn", "Tap **Delete this person**."]] },
  { at: "editor", t: "Go back to the tree", steps: () => ["Tap **← Back to tree** at the top left. Your changes are already saved."],
    go: () => [["#ed-back", "Tap **← Back to tree**."]] },

  // ---------- chat ----------
  { at: "chat", t: "Write to the whole family", steps: () => ["Tap **Whole family** in the list, type in the box at the bottom and tap **Send**."],
    go: c => [CHAT(c), ["#chat .crow", "Tap **Whole family**."], ["#chat .cfoot textarea", "Type here, then tap **Send**.", "read"]] },
  { at: "chat", t: "Send a private message", who: c => c.dms, steps: () => ["Tap **+ Message someone** and pick them.",
    "Only the two of you can read it. People who turned off private chats aren't listed."],
  go: c => [CHAT(c), ["#chat .msgsome", "Tap **+ Message someone**, then pick them."]] },
  { at: "chat", t: "Groups", steps: c => [c.role === "editor" ? "Tap **+ New group** to make one, or **Join** under Groups you can join."
    : "Tap **Join** under Groups you can join. Editors make new groups."],
  go: c => [CHAT(c), ["#chat .join, #chat .newgroup", c.role === "editor" ? "Tap **+ New group**, or **Join** a group." : "Tap **Join**."]] },
  { at: "chat", t: "Talk about a person in the tree", who: c => c.talk, steps: () => [
    "Tap them in the tree, then **💬 Family talk about …** at the bottom of their details."],
  go: () => [PERSON, [".panel .talkhead", "Tap **💬 Family talk about …**."]] },
  { at: "chat", t: "Answers to your suggestions", who: c => c.role === "suggest", steps: () => [
    "They come in **🌳 Family tree updates**, under Groups. Nobody writes there: it's only for you."] },
  { at: "chat", t: "Delete a message you wrote", steps: () => ["Tap **⋯** beside it, then delete. \"Message deleted\" stays in its place."],
    go: c => [CHAT(c), ["#chat .dots", "Open a conversation and tap **⋯** beside your message."]] },
  { at: "chat", t: "Get told about new messages", who: c => !c.hide.has("you"), steps: c => [
    `Open ${menu(c, c.label("you", "You"))} and turn on **Notify me of new chat messages on this device**.`,
    ...(c.email ? ["Or turn on the email for a message that waits for you a day."] : [])],
  go: c => [MENU(c), ["#menu-me", "Turn on **Notify me of new chat messages on this device**.", "read"]] },
  { at: "chat", t: "Turn off private chats", who: c => !c.hide.has("you"), steps: c => [`Open ${menu(c, c.label("you", "You"))}, turn off **Private chats**.`,
    "Nobody can message you privately then, and you can't message others. The family chat and groups stay."],
  go: c => [MENU(c), ["#menu-me", "Turn off **Private chats** here.", "read"]] },

  // ---------- Manage ----------
  { at: "manage", t: "Look at suggestions", who: c => c.reviews, steps: c => [
    `Open ${menu(c, c.label("manage", "⚙️ Manage"))} → **Suggestions**. The tree shows them on top, new and changed boxes marked.`,
    "Tick the ones to take, then **Approve** or **Reject**. The person who sent them gets a message.",
    "Changed your mind? **History** has **Undo**."],
  go: c => [...MANAGE(c), ["#manage [data-sec=suggest]", "Tap **Suggestions**."]] },
  { at: "manage", t: "See who changed what", who: c => c.history, steps: c => [
    `Open ${menu(c, c.label("manage", "⚙️ Manage"))} → **History**.${c.admin ? " Undo puts a change back." : ""}`],
  go: c => [...MANAGE(c), ["#manage [data-sec=history]", "Tap **History**."]] },
  { at: "manage", t: "Someone is waiting to join", who: c => c.owner, steps: c => [
    `Open ${menu(c, c.label("manage", "⚙️ Manage"))} → **Waiting to join**.`,
    "Pick what they may do and tap **Let them in**: they get a \"You're in\" email. **Say no** deletes the sign-up."],
  go: c => [...MANAGE(c), ["#manage [data-sec=joining]", "Tap **Waiting to join**."]] },
  { at: "manage", t: "Invite someone with their place in the tree", who: c => c.owner, steps: () => [
    "Tap them in the tree, open **More details**, tap **✉ Invite to the family tree** → **✉ Email**, and pick what they may do.",
    "When they sign in with that email, they're let in and linked to their place by themselves."],
  go: () => [PERSON, MORE, [".panel .invite", "Tap **✉ Invite to the family tree**."]] },
  { at: "manage", t: "Find mistakes in the tree", who: c => c.check, steps: c => [
    `Open ${menu(c, c.label("manage", "⚙️ Manage"))} and look under **🔍 Check the tree**: **Possible duplicates**, **Date problems**, **Split families** and more.`,
    "**See them** shows them on the tree."],
  go: c => [...MANAGE(c), ["#manage [data-sec=dupes]", "Tap **Possible duplicates**, or another check under it."]] },
  { at: "manage", t: "Who can do what, names and menu", who: c => c.owner, steps: c => [
    `Open ${menu(c, c.label("manage", "⚙️ Manage"))} and look under **⚙️ Settings**.`,
    "**Who can do what** sets who may suggest changes; **Menu and buttons** renames or hides menu items; **App name and icon**."],
  go: c => [...MANAGE(c), ["#manage [data-sec=rights]", "Tap **Who can do what**."]] },
];

// The tasks this person may do: this screen's first, then the rest, each with its steps in words and its tour.
export function tasksFor(c, here) {
  const mine = TASKS.filter(x => (!x.who || x.who(c)) && (x.at !== "editor" || c.role !== "guest")
    && (x.at !== "manage" || c.owner || c.reviews || c.history || c.check))
    .map(x => ({ at: x.at, title: x.t, steps: x.steps(c), tour: x.go?.(c) }));
  return [...mine.filter(x => x.at === here), ...mine.filter(x => x.at !== here)];
}
export const TASK_COUNT = TASKS.length;
