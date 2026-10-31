// Easy Gramps — ☰ Menu → ⚙️ Manage: one page, its sections down the side (tabs across the top on a phone). Editors
// see Suggestions; the owner also Waiting to join, Invites, Check the tree (checks.js; editors too if an admin says so) and
// the site settings: name and icon, menu items, who can do what, rename. The settings are kept on the server (main.py /site), the same for everyone. It's a
// browser-history step, like the chat: Back closes it.
import { api, BASE } from "./auth.js";
import { $, APP_NAME, BOX_LINES, BUILT, FAMS, KIN, ME, P, closeMenu, dateProblems, fieldName, h, layout, name, named, postJSON, trapTab, years } from "./common.js";
import { duplicates, islands, noRelatives, splitFamilies } from "./checks.js";
import { openMerge } from "./merge.js";
import { seeTree } from "./tree.js";
import { toast } from "./editor.js";
import { ROLES } from "./me.js";
import { openHistory, openReview } from "./suggest.js";

const ITEMS = [["theme", "Theme"], ["display", "Display (bigger text, the line to the details)"], ["dates", "Dates"],
  ["you", "You (Find me, email, notifications)"], ["install", "Install as an app"], ["docs", "Family documents"], ["tips", "Show tips"],
  ["keys", "Keyboard keys"], ["source", "Source code"]];
// What the owner may rename (main.py LABELS): key, where, the default text.
const LABELS = [["chat", "#chatbtn .lbl", "Chat"], ["menu", "#menubtn .lbl", "Menu"], ["theme", "[data-item=theme] h3", "Theme"],
  ["display", "[data-item=display] h3", "Display"], ["dates", "[data-item=dates] h3", "Dates"], ["you", "[data-item=you] h3", "You"],
  ["help", "#h-help", "Help"], ["install", "#menu-install", "📲 Install as an app"], ["docs", "#menu-docs", "📚 Family documents"],
  ["tips", "#tips-again", "Show tips"], ["keys", "#menu-keys", "Keyboard keys"], ["goto", "#h-goto", "Go to"],
  ["gramps", "#menu-gramps", "Full Gramps ↗"], ["source", "#menu-source", "Source code ↗"],
  ["manage", "", "⚙️ Manage"], ["logout", "#logout", "Log out"]];  // "": shown with a count (named)
const SUGGEST = [["off", "Off"], ["members", "Members and contributors"], ["everyone", "Everyone, guests too"]];
const GRAMPS = [["nobody", "Nobody"], ["owner", "Only the owner"], ["editors", "Editors and the owner"], ["everyone", "Everyone"]];
const isOwner = () => (ME.role ?? 0) >= 4, isAdmin = () => (ME.role ?? 0) >= 5, canCheck = () => !!ME.can_check;
const SEE = [[0, "Everyone"], [1, "Members and up"], [2, "Contributors and up"], [3, "Editors and up"], [4, "Owner and up"], [5, "Admins only"]];
const WHERE = [["top", "At the top"], ["more", "In More details"]];

export function applySite() {
  const hide = new Set(ME.site?.hide || []);
  document.querySelectorAll("#menupop [data-item]").forEach(el => el.classList.toggle("sitehidden", hide.has(el.dataset.item)));
  const waiting = (isOwner() ? ME.joining || 0 : 0) + (ME.suggestions || 0);
  $("#menu-manage").hidden = !isOwner() && ME.suggestions == null;  // (editors: when suggestions are on)
  $("#menu-check").hidden = !canCheck();
  $("#menu-manage").textContent = `${named("manage", "⚙️ Manage")}${waiting ? ` (${waiting})` : ""}`;
  const role = [...ROLES, [4, "Owner"], [5, "Admin"]].find(([n]) => n === ME.role)?.[1];
  $("#menu-role").textContent = role ? `Logged in as ${ME.full_name || ME.name} (${role})` : "";
  const names = ME.site?.labels || {};
  for (const [k, sel] of LABELS) {
    const el = sel && $(sel);
    if (el && names[k]) el.textContent = el.classList.contains("lbl") ? ` ${names[k]}` : names[k];  // .lbl: after the icon
  }
  if (M) nav();
}

// ---------- the page ----------
// [key, name in the side list, who sees it, what's in it, the heading it's under]. A count after the name: something's waiting there.
const count = (k, n = found()[k]?.length) => (n ? ` (${n})` : "");
const CHECK = "🔍 Check the tree";
const SECTIONS = [
  ["suggest", () => `📝 Suggestions${ME.suggestions ? ` (${ME.suggestions})` : ""}`, () => ME.suggestions != null, suggestions],
  ["joining", () => `👋 Waiting to join${ME.joining ? ` (${ME.joining})` : ""}`, isOwner, joining],
  ["invites", () => "✉️ Invites", isOwner, invites],
  ["split", () => `Split families${count("split")}`, canCheck, splitPage, CHECK],
  ["alone", () => `People with no relatives${count("alone")}`, canCheck, alonePage, CHECK],
  ["dupes", () => `Possible duplicates${count("dupes")}`, canCheck, dupesPage, CHECK],
  ["dates", () => `Date problems${count("dates")}`, canCheck, checkDates, CHECK],
  ["islands", () => `Groups not connected${count("islands")}`, canCheck, islandsPage, CHECK],
  ["general", () => "Name and icon", isOwner, general],
  ["menu", () => "Menu items", isOwner, menuItems],
  ["rights", () => "Who can do what", isOwner, rights],
  ["rename", () => "Rename", isOwner, rename],
  ["layout", () => "Layout", isAdmin, layoutPage],
  ["checkset", () => "Check the tree: settings", isAdmin, checkSettings],
];
let M = null;  // the open page: { at (the section shown), back }
const mine = () => SECTIONS.filter(([, , may]) => may());
export function openManage(at) {
  const list = mine();
  if (!list.length) return;
  C = null;  // (Check the tree: worked out again from the tree as it is now)
  if (!M) {
    history.pushState({ ...history.state, eg: (history.state?.eg || 0) + 1, manage: 1 }, "");
    M = { back: document.activeElement };
    $("#manage").hidden = false;
  }
  // First: where something's waiting, else the first section.
  M.at = list.some(([k]) => k === at) ? at : ME.suggestions && list.some(([k]) => k === "suggest") ? "suggest"
    : isOwner() && ME.joining ? "joining" : list[0][0];
  show();
  $("#manage-back").focus();
}
function hide() {
  if (!M) return;
  const { back } = M;
  M = null;
  $("#manage").hidden = true; $("#manage .msec").replaceChildren();
  back?.isConnected && back.focus();
}
export function closeManage() { if (M) { hide(); history.back(); } }  // (its history step goes too)
window.addEventListener("popstate", () => { if (M && !history.state?.manage) hide(); });
$("#manage-back").onclick = closeManage;
$("#menu-manage").onclick = () => { closeMenu(); openManage(); };
$("#menu-check").onclick = () => { closeMenu(); C = null; openManage(["split", "dupes", "dates", "islands", "alone"].find(k => found()[k]?.length) || "split"); };
$("#manage").addEventListener("keydown", e => {
  if (e.key === "Escape" && $("#dlg-wrap").hidden) { e.stopPropagation(); closeManage(); }
  else if (e.key === "Tab" && $("#dlg-wrap").hidden) trapTab(e, $("#manage"));
});

function nav() {
  $("#manage .mnav").replaceChildren(...mine().flatMap(([k, label, , , group], i, all) => [
    group && group !== all[i - 1]?.[4] ? h("h3", {}, group) : "",
    h("button", { "aria-current": k === M.at ? "page" : null, class: group ? "sub" : "",
      onclick: () => { M.at = k; show(); $("#manage .msec h2")?.focus(); } }, label())]));
}
async function show() {
  nav();
  const [at, label, , fill] = SECTIONS.find(([x]) => x === M.at);
  const box = $("#manage .msec");
  box.replaceChildren(h("h2", { tabindex: "-1" }, label()), h("p", { class: "muted", role: "status" }, "Loading…"));
  box.scrollTop = 0;
  let body;
  try { body = await fill(); } catch (err) { body = [h("div", { class: "warn" }, err.message)]; }
  if (M?.at === at) box.replaceChildren(h("h2", { tabindex: "-1" }, label()), ...body);
}
const leave = () => closeManage();  // before going to the tree: the page would cover it

// ---------- Suggestions (editors) ----------
function suggestions() {
  const n = ME.suggestions;
  return [h("p", {}, n ? h("strong", {}, `${n} waiting for an editor.`) : "Nothing is waiting ✓"),
    h("p", { class: "muted small" }, "They show on the tree, as they'd look: approve or reject each one there."),
    h("div", { class: "btnrow" },
      h("button", { class: "primary", onclick: () => { leave(); openReview(true); } }, n ? "Review them on the tree" : "See recent changes on the tree"),
      h("button", { onclick: () => { leave(); openHistory(); } }, "History"))];
}

// ---------- Waiting to join (owner) ----------
// Accounts Gramps Web keeps disabled until the owner lets them in (main.py /joining). Letting them in here also emails
// them that they're in (Gramps Web itself doesn't).
async function joining() {
  const list = await api("/joining");
  ME.joining = list.length; applySite();
  const rows = list.map(u => {
    const role = h("select", { "aria-label": `What ${u.name} can do` }, ...ROLES.map(([v, n, what]) => h("option", { value: v }, `${n}: ${what}`)));
    role.value = String(u.role);
    const say = h("div", { class: "small", role: "status" });
    const go = h("button", { class: "primary", onclick: async () => {
      go.disabled = true;
      try {
        const r = await postJSON(`/joining/${encodeURIComponent(u.login)}`, { role: Number(role.value) });
        say.textContent = r.emailed ? `Let in ✓ We emailed ${u.email} that they're in.` : "Let in ✓ No email was sent, so let them know yourself.";
        role.disabled = true; go.hidden = true;
        ME.joining = Math.max(0, (ME.joining || 1) - 1); applySite();
      } catch (err) { go.disabled = false; say.textContent = err.message; }
    } }, "Let them in");
    return h("div", { class: "joinrow" }, h("div", {}, h("strong", {}, u.name), u.email ? ` · ${u.email}` : "",
      u.person ? h("div", { class: "small muted" }, "Invited: their place in the tree is linked when they're in.") : "",
      u.before ? h("div", { class: "small warn" }, "This login was used before and then turned off.") : ""),
      h("div", { class: "btnrow" }, role, go), say);
  });
  return [h("p", { class: "small muted" }, "People who signed up and are waiting for you. Pick what they can do and let them in; they get an email saying they're in. To say no, leave them here or remove them in Full Gramps."),
    ...(rows.length ? rows : [h("p", { class: "muted" }, "Nobody is waiting ✓")])];
}

// ---------- Invites (owner): the ones nobody has used yet (made with ✉ Invite in someone's details) ----------
async function invites() {
  const list = await api("/invites");
  const roleName = n => ROLES.find(([v]) => v === n)?.[1] || "";
  const rows = list.map(i => {
    const say = h("div", { class: "small", role: "status" });
    const drop = h("button", {}, "Cancel invite");
    drop.onclick = async () => {
      if (drop.dataset.sure !== "1") { drop.dataset.sure = "1"; drop.textContent = "Confirm cancel"; return; }
      drop.disabled = true;
      try { await postJSON("/invites/cancel", { email: i.email }); say.textContent = "Cancelled ✓"; drop.hidden = true; }
      catch (err) { drop.disabled = false; say.textContent = err.message; }
    };
    const who = P[i.person];
    return h("div", { class: "joinrow" }, h("div", {}, h("strong", {}, i.email),
      h("div", { class: "small muted" }, [who ? `For ${name(who)}` : "Their place in the tree is gone", roleName(i.role) && `as ${roleName(i.role)}`,
        i.at && `invited ${new Date(i.at * 1000).toLocaleDateString()}`, i.by && `by ${i.by}`].filter(Boolean).join(" · "))),
      h("div", { class: "btnrow" }, who && h("button", { onclick: () => { leave(); seeTree(who.id); } }, "See their tree"), drop), say);
  });
  return [h("p", { class: "small muted" }, "People you invited who haven't signed in yet. When they do, they get this role and their place in the tree. To invite someone, open their details and press ✉ Invite."),
    ...(rows.length ? rows : [h("p", { class: "muted" }, "No invites waiting.")])];
}

// ---------- Check the tree (the owner; editors too if an admin says so): probable mistakes, from the tree itself ----------
let C = null;  // what was found, worked out once each time the page opens: {split, alone, islands, dates, dupes (once seen)}
function found() {
  if (!C) {
    const byName = ids => ids.sort((a, b) => name(P[a]).localeCompare(name(P[b])));
    C = { split: splitFamilies(FAMS), alone: byName(noRelatives(P, FAMS)), islands: islands(P, FAMS),
      dates: byName(Object.keys(P).filter(id => dateProblems(id).length)) };
  }
  return C;
}
const MAX = 300;  // rows shown at once (a big tree can have many people with no relatives)
const see = id => h("button", { onclick: () => { leave(); seeTree(id); } }, "See them");
const who = id => h("div", {}, h("strong", {}, name(P[id])), years(P[id]) && h("span", { class: "small muted" }, ` ${years(P[id])}`));
function rows(list, row, none) {
  if (!list.length) return [h("p", {}, h("strong", {}, none))];
  return [h("div", { class: "datelist" }, ...list.slice(0, MAX).map(row)),
    list.length > MAX ? h("p", { class: "small muted" }, `And ${list.length - MAX} more: fix some of these first.`) : ""];
}
function splitPage() {
  return [h("p", { class: "small muted" }, "The same father or mother in more than one family with no husband or wife listed. Brothers and sisters are usually in one family: in Full Gramps, merge those families, or remove the children from one and add them to the other."),
    ...rows(found().split, s => {
      const p = P[s.id], partner = s.fams[0].f === s.id ? "mother" : "father";
      return h("div", { class: "sugdone" }, h("div", {}, who(s.id),
        h("div", { class: "small" }, `Children in ${s.fams.length} families with no ${partner} listed: `,
          s.fams.map(f => f.kids.filter(k => P[k]).map(k => P[k].first || name(P[k])).join(", ") || "no children").join("; "))), see(p.id));
    }, "No split families found ✓")];
}
function alonePage() {
  return [h("p", { class: "small muted" }, "People who aren't linked to anyone: often added in the wrong place, or a link was forgotten."),
    ...rows(found().alone, id => h("div", { class: "sugdone" }, who(id), see(id)), "Everyone is linked to someone ✓")];
}
function islandsPage() {
  return [h("p", { class: "small muted" }, "Families linked to each other but not to the main family tree. Maybe a link between them is missing, or someone is in the tree twice."),
    ...rows(found().islands, ids => h("div", { class: "sugdone" }, h("div", {}, h("strong", {}, `${ids.length} people`),
      h("div", { class: "small" }, ids.slice(0, 5).map(id => name(P[id])).join(", ") + (ids.length > 5 ? "…" : ""))), see(ids[0])),
    "Everyone is in one family tree ✓")];
}
function checkDates() {
  return [h("p", { class: "small muted" }, "People whose dates can't be right: died before they were born, born when a parent was under 12, or after a parent died. Years only."),
    ...rows(found().dates, id => h("div", { class: "sugdone" },
      h("div", {}, h("strong", {}, name(P[id])), ...dateProblems(id).map(t => h("div", { class: "small" }, t))), see(id)), "Nothing wrong found ✓")];
}
async function dupesPage() {
  const not = await api("/checks/notsame");
  const d = duplicates(P, FAMS, ME.site?.dupes, not);
  found().dupes = [...d.likely, ...d.maybe]; nav();
  const row = x => {
    const say = h("div", { class: "small", role: "status" });
    const no = h("button", { onclick: async () => {
      no.disabled = true;
      try {
        await postJSON("/checks/notsame", { a: x.a, b: x.b });
        line.remove(); C.dupes = C.dupes.filter(y => y !== x); nav();
      } catch (err) { no.disabled = false; say.textContent = err.message; }
    } }, "Not the same person");
    const line = h("div", { class: "duprow" }, who(x.a), who(x.b), h("div", { class: "small muted" }, x.why.join(" · ")),
      h("div", { class: "btnrow" }, canEditTree() && h("button", { class: "primary", onclick: () => { leave(); openMerge(x.a, x.b); } }, "Compare and merge"),
        see(x.a), no), say);
    return line;
  };
  const part = (title, list) => list.length ? [h("h3", {}, `${title} (${list.length})`), ...rows(list, row, "")] : [];
  return [h("p", { class: "small muted" }, "People who may be in the tree twice: names that sound alike, close birth years, the same parents, husband or wife, or children. “Not the same person” hides a pair for everyone."),
    ...(d.likely.length || d.maybe.length ? [...part("Very likely", d.likely), ...part("Maybe", d.maybe)] : [h("p", {}, h("strong", {}, "No duplicates found ✓"))])];
}
const canEditTree = () => (ME.role ?? 0) >= 3;  // (merging is the editors')

// ---------- Check the tree: settings (admins) ----------
function checkSettings() {
  const s = ME.site || {}, d = { year: true, kin: true, place: true, level: "normal", same: "", ...s.dupes };
  const whoSel = h("select", { id: "chk-who" }, h("option", { value: "owner" }, "Only the owner (and admins)"), h("option", { value: "editors" }, "Editors and the owner"));
  whoSel.value = s.checks || "owner";
  const tick = (k, text) => h("label", { class: "inline" }, h("input", { type: "checkbox", "data-k": k, checked: d[k] }), text);
  const ticks = [tick("year", "Birth years close"), tick("kin", "The same parents, husband or wife, or children"), tick("place", "The same place of birth")];
  const level = h("select", { id: "chk-level" }, h("option", { value: "strict" }, "Strict: only very close matches"),
    h("option", { value: "normal" }, "Normal"), h("option", { value: "loose" }, "Loose: more pairs, more of them wrong"));
  level.value = d.level;
  const same = h("textarea", { id: "chk-same", rows: 5, maxlength: 5000, placeholder: "Lakshmi = Laxmi = Lachmi\nMohammed = Muhammad" }, d.same);
  return [h("label", { for: whoSel.id }, "Who can open Check the tree", whoSel),
    h("fieldset", {}, h("legend", {}, "Possible duplicates: what counts, besides a name that sounds alike"), ...ticks),
    h("label", { for: level.id }, "How close a match", level),
    h("label", { for: same.id }, "Names that are the same in this family, one group per line", same),
    h("p", { class: "muted small" }, "Spellings that sound alike (Laxmi and Lakshmi, Mohammed and Muhammad) are matched already; add the ones that aren't."),
    ...saver(() => ({ checks: whoSel.value, dupes: { ...Object.fromEntries(ticks.map(l => l.querySelector("input")).map(b => [b.dataset.k, b.checked])),
      level: level.value, same: same.value } }), () => { C = null; })];
}

// ---------- the site settings (owner): each section saves its own part ----------
function saver(body, after) {
  const say = h("div", { role: "status" });
  const save = h("button", { class: "primary", onclick: async () => {
    save.disabled = true; say.replaceChildren();
    try {
      ME.site = await api("/site", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body()) });
      if (after === "reload") return location.reload();  // the name is in the page itself, the manifest and the links
      applySite(); after?.(); save.disabled = false; say.replaceChildren("Saved ✓");
    } catch (err) { save.disabled = false; say.replaceChildren(h("div", { class: "warn" }, err.message)); }
  } }, "Save");
  return [say, h("div", { class: "btnrow" }, save)];
}
function general() {
  const s = ME.site || {};
  const nameIn = h("input", { id: "site-name", value: s.name || APP_NAME, maxlength: 40, autocomplete: "off" });
  const iconImg = h("img", { class: "siteicon", src: `${BASE}/icon-192.png?t=${Date.now()}`, alt: "The app's icon now" });
  const say = h("div", { role: "status" });
  const file = h("input", { type: "file", accept: "image/*", hidden: true });
  const icon = async (method, body) => {
    say.replaceChildren("Saving the icon…");
    try { await api("/site/icon", { method, body }); iconImg.src = `${BASE}/icon-192.png?t=${Date.now()}`; say.replaceChildren("Icon saved ✓"); }
    catch (err) { say.replaceChildren(h("div", { class: "warn" }, err.message)); }
  };
  file.onchange = () => file.files[0] && icon("PUT", file.files[0]);
  return [h("p", { class: "muted small" }, "For everyone who uses the family tree."),
    h("label", { for: nameIn.id }, "Name of the app (browser tab, installed app, top bar)", nameIn),
    ...saver(() => ({ name: nameIn.value }), "reload"),
    h("div", { class: "flabel" }, "Icon",
      h("div", { class: "btnrow" }, iconImg, h("button", { onclick: () => file.click() }, "Choose a picture…"),
        h("button", { onclick: () => icon("DELETE") }, "Use the default"), file)), say];
}
function menuItems() {
  const shows = ITEMS.map(([k, label]) => h("label", { class: "inline" },
    h("input", { type: "checkbox", value: k, checked: !(ME.site?.hide || []).includes(k) }), label));
  return [h("fieldset", {}, h("legend", {}, "Show in the menu"), ...shows),
    ...saver(() => ({ hide: shows.map(l => l.querySelector("input")).filter(b => !b.checked).map(b => b.value) }))];
}
function rights() {
  const s = ME.site || {};
  const gramps = h("select", { id: "site-gramps" }, ...GRAMPS.map(([v, t]) => h("option", { value: v }, t)));
  gramps.value = s.gramps || "everyone";
  const talk = h("input", { type: "checkbox", checked: s.talk !== false });
  const suggest = h("select", { id: "site-suggest" }, ...SUGGEST.map(([v, t]) => h("option", { value: v }, t)));
  suggest.value = s.suggest || "off";
  const sends = h("select", { id: "site-sends" }, h("option", { value: "auto" }, "Automatically, with each change (easiest)"),
    h("option", { value: "manual" }, "When they press “Send to the editors”"));
  sends.value = s.suggest_send || "auto";
  return [h("label", { for: suggest.id }, "Who may suggest changes", suggest),
    h("p", { class: "muted small" }, "They change the tree like an editor, but it goes to the editors first: ☰ Menu → Manage → Suggestions shows them on the tree to approve or reject."),
    h("label", { for: sends.id }, "Suggestions are sent", sends),
    h("fieldset", {}, h("legend", {}, "In each person's details"),
      h("label", { class: "inline" }, talk, "“Family talk about …” (messages about that person)"),
      h("p", { class: "muted small" }, "Turned off, no one can write new ones. Earlier ones stay in Chat.")),
    h("label", { for: gramps.id }, "Full Gramps link for", gramps),
    h("p", { class: "muted small" }, "Hiding the link doesn't change what anyone may do: their role in Gramps Web decides that."),
    ...saver(() => ({ gramps: gramps.value, talk: talk.checked, suggest: suggest.value, suggest_send: sends.value }), "reload")];
}
function rename() {
  const renames = LABELS.map(([k, , def]) => h("label", {}, def,
    h("input", { "data-key": k, value: ME.site?.labels?.[k] || "", placeholder: def, maxlength: 40, autocomplete: "off" })));
  return [h("p", { class: "muted small" }, "What the menu items and buttons are called. Leave a box empty to keep the name in grey. Emoji are fine."),
    h("div", { class: "renames" }, ...renames),
    ...saver(() => ({ labels: Object.fromEntries(renames.map(l => l.querySelector("input")).map(i => [i.dataset.key, i.value])) }), "reload")];
}

// ---------- Layout (admins): the details' fields, where they show and who sees them; the person box's lines ----------
// Kept on the server (main.py `layout`, `box`); /tree/details sends each login only the fields its role may see, and
// what's shown can be changed in the editor. Gramps' own privacy still applies on top.
async function layoutPage() {
  const types = await api("/layout/types");
  const rows = layout().map(r => ({ ...r }));  // (an admin gets every row)
  const box = [...(ME.site?.box || ["years", "birthPlace"]), "", ""].slice(0, 4);  // 2nd, 3rd, then their backups
  const pick = (list, v, set, label) => {
    const s = h("select", { "aria-label": label }, ...list.map(([k, t]) => h("option", { value: k }, t)));
    s.value = String(v); s.onchange = () => set(s.value);
    return s;
  };
  const kind = k => k.startsWith("e:") ? "event" : k.startsWith("a:") ? "attribute" : k.startsWith("r:") ? "relatives" : "";
  const list = h("div", { class: "laylist" });
  const add = h("select", { "aria-label": "Add a field" });
  const draw = (focus, at) => {
    list.replaceChildren(...rows.map((r, i) => {
      const n = fieldName(r.k);
      const move = by => { rows.splice(i + by, 0, ...rows.splice(i, 1)); draw(by < 0 ? ".up" : ".down", i + by); };
      return h("div", { class: "layrow" },
        h("div", {}, h("strong", {}, n), kind(r.k) && h("span", { class: "muted small" }, ` ${kind(r.k)}`)),
        pick(WHERE, r.where, v => { r.where = v; }, `Where ${n} shows`),
        pick(SEE, r.see, v => { r.see = Number(v); }, `Who sees ${n}`),
        h("div", { class: "btnrow" },
          h("button", { class: "up", "aria-label": `Move ${n} up`, disabled: !i, onclick: () => move(-1) }, "▲"),
          h("button", { class: "down", "aria-label": `Move ${n} down`, disabled: i === rows.length - 1, onclick: () => move(1) }, "▼"),
          h("button", { class: "drop", "aria-label": `Take ${n} off`, onclick: () => { rows.splice(i, 1); draw(".drop", i); } }, "✕")));
    }));
    const have = new Set(rows.map(r => r.k));
    const group = (label, keys) => { const left = keys.filter(k => !have.has(k)); return left.length ? h("optgroup", { label }, ...left.map(k => h("option", { value: k }, fieldName(k)))) : ""; };
    add.replaceChildren(h("option", { value: "" }, "+ Add a field…"), group("Built in", BUILT), group("Relatives", KIN),
      group("Events: date, place and description", types.events.map(t => `e:${t}`)), group("Attributes: one word or number", types.attributes.map(t => `a:${t}`)));
    const row = list.children[Math.min(at ?? 0, rows.length - 1)];
    if (focus) (row?.querySelector(`${focus}:not(:disabled)`) || row?.querySelector("button:not(:disabled)") || add).focus();
  };
  add.onchange = () => { if (!add.value) return; rows.push({ k: add.value, where: "more", see: 4 }); draw(); list.lastChild.querySelector("select").focus(); };
  draw();
  const line = (i, or) => pick(BOX_LINES, box[i], v => { box[i] = v; }, `The box's ${i % 2 ? "third" : "second"} line${or ? ", when that's empty" : ""}`);
  const reset = h("button", {}, "Back to the default");
  const say = h("div", { role: "status" });
  reset.onclick = async () => {
    if (reset.dataset.sure !== "1") { reset.dataset.sure = "1"; reset.textContent = "Confirm: back to the default"; return; }
    reset.disabled = true;
    try { await api("/site", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ layout: [], box: ["years", "birthPlace"] }) }); location.reload(); }
    catch (err) { reset.disabled = false; say.replaceChildren(h("div", { class: "warn" }, err.message)); }
  };
  return [h("p", { class: "muted small" }, "What each person's details show, in this order. “At the top” is under Born; the rest is under More details. What's shown can be changed in the editor. New fields start as “Owner and up”: choose who else may see them. Gramps still hides private records from logins that can't see private details."),
    list, add,
    h("fieldset", {}, h("legend", {}, "The person boxes on the tree, under the name"),
      h("div", { class: "btnrow" }, h("label", {}, "Second line", line(0)), h("label", {}, "… when it's empty", line(2, 1))),
      h("div", { class: "btnrow" }, h("label", {}, "Third line", line(1)), h("label", {}, "… when it's empty", line(3, 1)))),
    ...saver(() => ({ layout: rows, box }), "reload"), say, h("div", { class: "btnrow" }, reset)];
}
