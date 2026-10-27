// Easy Gramps — Suggestions (suggest.py; the owner turns them on in Site settings). People who can't change the tree
// use the same editor; each change goes to the editors as they make it (Site settings: automatic), or collects in a
// draft on this device until they press "Send to the editors". Their waiting ones show on their tree. Editors open
// ☰ Menu → Suggestions: the tree shows what it would look like with the checked ones, the list is in the panel.
import { api } from "./auth.js";
import { $, FAMS, ME, P, S, closeMenu, fmtDate, h, loadGraph, name, parentFam, postJSON, relWord } from "./common.js";
import { seeTree } from "./tree.js";
import { renderAll } from "./start.js";
import { closeEditor, flushSaves, hideDlg, showDlg, toast } from "./editor.js";

const PLACES = new Set(["birthPlace", "burial"]);
const GRAPH = new Set(["first", "last", "nick", "gender", "birth", "birthPlace", "deceased", "death", "burial"]);  // in the tree's data
const WORD = { first: "First name", last: "Last name", nick: "Nickname", gender: "Gender", birth: "Born", birthPlace: "Place of birth",
  deceased: "Passed away", death: "Died", burial: "Buried at", residence: "Lives in", phone: "Phone", email: "Email", notes: "Notes",
  work: "Work", education: "Education" };
const ABC = "abcdefghijklmnopqrstuvwxyz0123456789";
const standIn = () => "new-" + [...crypto.getRandomValues(new Uint8Array(8))].map(b => ABC[b % 36]).join("");
const isStandIn = x => typeof x === "string" && x.startsWith("new-");

export const suggesting = () => S.role === "suggest";
const auto = () => (ME.site?.suggest_send || "auto") === "auto";
const KEY = () => `eg_suggestion:${ME.name || ""}`;  // per login: a shared tablet doesn't send one person's changes as another's
let draft = { items: [] };  // not sent yet (loaded in suggestMenu)
let mine = [];  // their suggestions waiting for an editor (from the server)
const keep = () => { try { localStorage.setItem(KEY(), JSON.stringify(draft)); } catch { /* this device only */ } };

// ---------- the tree with the suggestions on top ----------
let base = null;  // the tree as Gramps has it, taken at each load before the suggestions go on top
S.overlay = () => {
  if (!suggesting() && !S.review) return;
  base = structuredClone({ P, FAMS });
  apply(shown());
};
const shown = () => S.review ? S.review.rows.filter(r => up(S.review.ticked).has(r.id)).map(r => r.item) : suggesting() ? [...mine, ...draft.items] : [];
let made = {};  // stand-ins already approved → their real ids
const real = id => made[id] || id;
function rebuild() {  // again from `base` with what's checked now (no trip to the server)
  const b = structuredClone(base);
  for (const k of Object.keys(P)) delete P[k];
  Object.assign(P, b.P);
  FAMS.length = 0; FAMS.push(...b.FAMS);
  apply(shown());
}
function apply(items) {
  const mark = (id, how) => { const p = P[id]; if (p) { p.sug = p.sug === "new" ? "new" : how; p.sugN = (p.sugN || 0) + 1; } };
  for (const it of items) {
    if (it.op === "set") {
      const p = P[real(it.id)];
      if (!p) continue;
      p[it.field] = PLACES.has(it.field) ? it.label || "" : it.value;
      if (it.field === "deceased" && !it.value) { p.death = null; p.burial = ""; }
      if (it.field === "death" && it.value) p.deceased = true;
      mark(p.id, "changed");
    } else link(it, mark);
  }
}
function link(it, mark) {
  const pid = real(it.person), me = P[pid];
  const oid = it.existing ? real(it.existing) : it.as;
  if (!me) return;
  if (it.new && !P[oid]) {
    const g = { father: "m", mother: "f", spouse: me.gender === "m" ? "f" : me.gender === "f" ? "m" : "" }[it.rel];
    P[oid] = { id: oid, gid: "", first: "", last: "", nick: "", birthPlace: "", deceased: false, death: null, burial: "", photo: null,
      photos: [], crops: {}, fams: [], pfams: [], gids: {}, residence: "", residenceRest: "", phone: "", email: "", notes: "",
      otherNotes: [], work: "", otherWork: [], education: "", otherEducation: [], _details: true, ...it.new, gender: it.new.gender || g || "" };
  }
  const o = P[oid];
  if (!o) return;
  const fam = (f, m, kids) => {
    const x = { id: it.fam || standIn(), gid: "", f, m, kids };
    FAMS.push(x);
    for (const i of [f, m]) if (i) P[i].fams.push(x.id);
    for (const k of kids) P[k].pfams.unshift(x.id);
  };
  if (it.rel === "father" || it.rel === "mother") {
    const pf = parentFam(pid);
    if (pf) { pf[it.rel === "father" ? "f" : "m"] = oid; o.fams.push(pf.id); }
    else fam(it.rel === "father" ? oid : null, it.rel === "mother" ? oid : null, [pid]);
  } else if (it.rel === "spouse") {
    const meFather = me.gender === "m" || (me.gender !== "f" && o.gender !== "m");
    fam(meFather ? pid : oid, meFather ? oid : pid, []);
  } else {
    const x = it.famId && FAMS.find(f => f.id === real(it.famId));
    if (x) { x.kids.push(oid); o.pfams.unshift(x.id); }
    else fam(me.gender === "f" ? null : pid, me.gender === "f" ? pid : null, [oid]);
  }
  mark(oid, it.new ? "new" : "changed");
}

// ---------- suggesting: the editor's saves go into the draft ----------
export function draftSet(id, patch) {
  for (const [field, value] of Object.entries(patch)) {
    const like = x => x.op === "set" && x.id === id && x.field === field;
    const was = draft.items.find(like), sent = mine.find(like);
    const before = (was || sent) ? (was || sent).before : GRAPH.has(field) ? base?.P[id]?.[field] : P[id]?._orig?.[field];
    draft.items = draft.items.filter(x => x !== was);
    const label = PLACES.has(field) ? P[id]?.[field] || "" : undefined;
    const same = JSON.stringify(PLACES.has(field) ? label : value ?? "") === JSON.stringify(before ?? "");
    // (back to what Gramps has: nothing to send, unless one was sent already, which the server then takes off the list)
    if (!same || sent || isStandIn(id)) draft.items.push({ op: "set", id, field, value, before: before ?? "", label });
  }
  keep(); redrawBar();
  if (auto()) sendNow();
}
export function draftAdd(A, choice) {
  const it = { op: "add", person: A.pid, rel: A.rel, ...(A.famId && { famId: A.famId }), ...choice, fam: standIn(),
    label: choice.existing ? name(P[choice.existing]) : name(choice.new) };
  if (choice.new) it.as = standIn();
  draft.items.push(it); keep();
  if (auto()) sendNow();
  return { added: it.as || choice.existing };
}
let sending = Promise.resolve(), unsent = false;
function sendNow() {  // one at a time, in order: a later change may use a new person an earlier one made
  sending = sending.then(async () => {
    const items = draft.items.slice();
    if (!items.length) return;
    try {
      await postJSON("/suggestions", { items });
      mine.push(...items);  // on their tree all the time (the tree may redraw before loadMine is back)
      draft.items = draft.items.filter(x => !items.includes(x)); keep(); unsent = false;
      await loadMine();
      if (base && !S.review) { rebuild(); renderAll(); }
    } catch (err) {
      unsent = true;  // no internet: kept, and sent with the next change or when the page opens again
      if (err.status >= 400 && err.status < 500 && ![401, 429].includes(err.status)) {  // refused: trying again won't help
        draft.items = draft.items.filter(x => !items.includes(x)); keep(); unsent = false;
        toast(`Not sent: ${err.message}`, false);
      }
    }
    redrawBar();
  });
  return sending;
}
async function loadMine() {
  const d = await api("/suggestions");
  mine = d.items.map(r => r.item); made = d.made;
}
export function draftBar() {
  if (!suggesting()) return "";
  const n = draft.items.length, waits = mine.length ? ` ${mine.length} waiting for an editor.` : "";
  if (auto()) return h("div", { class: "sugbar", id: "sugbar" },
    h("div", {}, "📝 What you change here goes to the editors as a suggestion. It shows in green or amber until an editor adds it to the tree.", h("strong", {}, waits)),
    unsent ? h("div", { class: "warn small" }, "Not sent yet (no internet?). It goes with your next change, or when you open the family tree again.") : "");
  if (!n) return h("div", { class: "sugbar", id: "sugbar" }, "📝 What you change here is a suggestion: an editor looks at it before it goes in the tree.", h("strong", {}, waits));
  const note = h("input", { id: "sug-note", value: draft.note || "", maxlength: 500, autocomplete: "off" });
  note.oninput = () => { draft.note = note.value; keep(); };
  const drop = h("button", { onclick: async () => {
    if (drop.dataset.sure !== "1") { drop.dataset.sure = "1"; drop.textContent = "Yes, throw them away"; return; }
    draft = { items: [] }; keep(); await closeEditor(); await loadGraph(); renderAll();
  } }, "Discard");
  const send = h("button", { class: "primary", onclick: async () => {
    send.disabled = true;
    try {
      await flushSaves();
      await postJSON("/suggestions", { items: draft.items, note: draft.note || "" });
      draft = { items: [] }; keep();
      await loadMine().catch(() => {});
      toast("Sent ✓ An editor will look at it. You'll get a message in Chat.");
      await closeEditor(); await loadGraph(); renderAll();
    } catch (err) { send.disabled = false; toast(`Not sent: ${err.message}`, false); }
  } }, "Send to the editors");
  return h("div", { class: "sugbar", id: "sugbar" },
    h("strong", {}, `📝 Your suggestion: ${n} ${n === 1 ? "change" : "changes"}`),
    h("label", { for: note.id }, "Where is it from? (optional)", note),
    h("div", { class: "btnrow" }, send, drop));
}
function redrawBar() { $("#sugbar")?.replaceWith(draftBar()); }

// ---------- reviewing (editors) ----------
export function suggestMenu() {
  if (suggesting()) {  // their unsent draft (this device) and their waiting ones (server), on the tree
    try { draft = JSON.parse(localStorage.getItem(KEY())) || { items: [] }; } catch { draft = { items: [] }; }
    loadMine().then(() => { if (base) { rebuild(); renderAll(); } if (auto()) sendNow(); }).catch(() => {});
  }
  const b = $("#menu-suggest");
  $("#menu-review").hidden = ME.suggestions == null;
  b.textContent = `📝 Suggestions${ME.suggestions ? ` (${ME.suggestions})` : ""}`;
}
$("#menu-suggest").onclick = () => { closeMenu(); openReview(); };

async function openReview() {
  let d;
  try { d = await api("/suggestions"); } catch (err) { return toast(err.message, false); }
  ME.suggestions = d.items.length; suggestMenu();
  made = d.made;
  if (!d.items.length) { if (S.review) await closeReview(); return openHistory("No suggestions waiting ✓"); }
  const was = S.review;  // after approving: what they left unchecked stays unchecked
  const ticked = d.items.filter(r => !was?.rows.some(o => o.id === r.id) || was.ticked.has(r.id)).map(r => r.id);
  S.review = { rows: d.items, ticked: new Set(ticked), render: renderReview, sure: false, closed: was?.closed || new Set() };
  await loadGraph();
  S.panel = true;
  seeTree(whose(d.items[0].item));
}
async function closeReview() {
  S.review = null;
  await loadGraph();
  if (!P[S.focus]) S.focus = null;
  if (!P[S.sel]) S.sel = S.focus;
  renderAll();
}
const anchor = it => [it.op === "set" ? it.id : it.as || it.existing, it.person].map(real).find(x => x && P[x]);
const whose = it => anchor(it) || S.focus;
const needs = it => [it.id, it.person, it.famId, it.existing].filter(x => isStandIn(x) && !made[x]);
const gives = it => [it.as, it.fam].filter(Boolean);
const giver = (r, rows) => {  // the row that adds the new person (or family) this one builds on (approved ones too: History)
  const x = [r.item.id, r.item.person, r.item.famId, r.item.existing].find(isStandIn);
  return x && rows.find(o => gives(o.item).includes(x));
};
function tick(r, on) {  // a new person's own changes go with them (checked or unchecked together)
  const R = S.review;
  if (on === R.ticked.has(r.id)) return;
  R.ticked[on ? "add" : "delete"](r.id);
  for (const x of gives(r.item)) for (const o of R.rows) if (needs(o.item).includes(x)) tick(o, on);
}
function up(ids) {  // these, and the new people they need (approving them needs those too)
  const out = new Set(ids), rows = S.review.rows;
  for (const k of out) for (const x of needs(rows.find(r => r.id === k)?.item || {})) {
    const o = rows.find(r => gives(r.item).includes(x));
    if (o) out.add(o.id);
  }
  return out;
}
function down(ids) {  // these, and what builds on the new people in them (rejecting them takes those too)
  const out = new Set(ids), rows = S.review.rows;
  for (const k of out) for (const x of gives(rows.find(r => r.id === k)?.item || {})) for (const o of rows) if (needs(o.item).includes(x)) out.add(o.id);
  return out;
}
function retick(change) {
  change(); S.review.sure = false;
  rebuild();
  if (!P[S.focus]) S.focus = whose(S.review.rows[0].item);
  if (!P[S.sel]) S.sel = S.focus;
  renderAll();
}
const show = (f, v) => v == null || v === "" ? "(none)" : typeof v === "boolean" ? (v ? "Yes" : "No")
  : f === "gender" ? { m: "Male", f: "Female" }[v] || v : typeof v === "object" ? (v.y ? fmtDate(v) : v.new || "(none)") : String(v);
function says(r, decided) {
  const it = r.item;
  if (it.op === "add") {
    const p = P[real(it.person)];
    return [h("strong", {}, it.new ? `New: ${it.label}` : it.label), ` as ${p ? `${p.first || name(p)}'s ${relWord(it.rel, p)}` : it.rel}`];
  }
  const p = P[real(it.id)];
  const now = GRAPH.has(it.field) && !isStandIn(it.id) && base?.P[real(it.id)]?.[it.field];
  const moved = !decided && GRAPH.has(it.field) && !isStandIn(it.id) && JSON.stringify(now ?? "") !== JSON.stringify(it.before ?? "");
  return [h("strong", {}, p ? name(p) : "Someone new"), ` · ${WORD[it.field]}: ${show(it.field, it.before)} → `,
    h("strong", {}, PLACES.has(it.field) ? it.label || "(none)" : show(it.field, it.value)),
    moved ? h("div", { class: "warn small" }, `⚠ Changed since: now ${show(it.field, now)}`) : ""];
}

// By family (the couple the change is about, or the family they grew up in), and in each family a change that
// builds on a new person sits under the row that adds them.
function families(rows) {
  const groups = new Map();
  for (const r of rows) {
    let top = r;
    for (let i = 0; i < 100; i++) { const o = giver(top, rows); if (!o) break; top = o; }
    const id = anchor(top.item), p = P[id];
    const f = p && (FAMS.find(x => x.id === p.fams?.[0]) || parentFam(id));
    const key = f ? f.id : id || "?";
    const label = f ? `${[f.f, f.m].filter(x => P[x]).map(x => P[x].first || name(P[x])).join(" & ")}'s family` : p ? name(p) : "Others";
    if (!groups.has(key)) groups.set(key, { key, label, id, rows: [] });
    groups.get(key).rows.push(r);
  }
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
}
function nested(rows, row) {  // row(r) → its element; the ones that build on it, indented under it
  const kids = new Map(rows.map(r => [r.id, []])), tops = [];
  for (const r of rows) { const o = giver(r, rows); (o ? kids.get(o.id) : tops).push(r); }
  const one = r => kids.get(r.id).length ? h("div", {}, row(r), h("div", { class: "sugkids" }, ...kids.get(r.id).map(one))) : row(r);
  return tops.map(one);
}
function famBox(g, open, onToggle, go, rows) {
  const box = h("details", { class: "sugfam", open },
    h("summary", {}, h("button", { class: "linkish famname", title: "See this family in the tree", onclick: e => { e.preventDefault(); go(); } },
      `${g.label} (${g.rows.length})`)), ...rows);
  box.ontoggle = () => onToggle(box.open);
  return box;
}

function renderReview() {
  const R = S.review, panel = $("#panel");
  const row = r => {
    const box = h("input", { type: "checkbox", checked: R.ticked.has(r.id), "aria-label": "Check this one" });
    box.onchange = () => retick(() => tick(r, box.checked));
    const note = r.note && r.note !== giver(r, R.rows)?.note ? h("div", { class: "small muted" }, `“${r.note}”`) : "";
    return h("div", { class: `sugrow${whose(r.item) === S.sel ? " here" : ""}` }, box,
      h("button", { class: "linkish", onclick: () => { const id = whose(r.item); P[id] && seeTree(id); } }, ...says(r)), note,
      r.error ? h("div", { class: "warn small" }, `Couldn't add it: ${r.error}`) : "");
  };
  const groups = families(R.rows).map(g => famBox(g, !R.closed.has(g.key), o => R.closed[o ? "delete" : "add"](g.key),
    () => g.id && P[g.id] && seeTree(g.id), nested(g.rows, row)));
  const yes = up(R.ticked), no = down(R.ticked), n = R.ticked.size;
  const extra = (set, word) => {
    const more = R.rows.filter(r => set.has(r.id) && !R.ticked.has(r.id));
    return more.length ? h("p", { class: "small" }, `${word}: `, ...more.flatMap((r, i) => [i ? "; " : "", ...says(r, true)])) : "";
  };
  const approve = h("button", { class: "primary", disabled: !n, onclick: () => {
    if (yes.size > n && R.sure !== "approve") { R.sure = "approve"; return renderReview(); }
    decide({ approve: [...yes] });
  } }, R.sure === "approve" ? `Yes, approve ${yes.size}` : `Approve (${n})`);
  const reject = h("button", { class: "danger", disabled: !n, onclick: () => {
    if (R.sure !== "reject") { R.sure = "reject"; return renderReview(); }
    decide({ reject: [...no] });
  } }, R.sure === "reject" ? `Yes, reject ${no.size}` : `Reject (${n})`);
  panel.replaceChildren(
    h("div", { class: "ptop" }, h("h2", {}, "Suggestions"), h("button", { class: "pill", onclick: () => openHistory() }, "History"),
      h("button", { class: "pill", onclick: closeReview }, "Done")),
    h("p", { class: "small muted" }, "The tree shows the family with the checked ones: new people in green, changed people in amber. Tap a family's name to see it in the tree."),
    h("div", { class: "btnrow" }, h("button", { onclick: () => retick(() => R.rows.forEach(r => R.ticked.add(r.id))) }, "Check all"),
      h("button", { onclick: () => retick(() => R.ticked.clear()) }, "Uncheck all")),
    ...groups,
    h("div", { class: "dupbar" },
      R.sure === "approve" ? extra(yes, "Also approves, because the checked ones need them") : "",
      R.sure === "reject" ? extra(no, "Also rejects, because they build on the checked ones") : "",
      h("div", { class: "btnrow" }, approve, reject)));
  panel.querySelector(".sugrow.here")?.scrollIntoView({ block: "nearest" });
}
async function decide(body) {
  const buttons = [...$("#panel").querySelectorAll("button, input")];
  buttons.forEach(b => { b.disabled = true; });  // until the list is back (a second click would act on the old one)
  try {
    const r = await postJSON("/suggestions/decide", body);
    await openReview();
    toast([r.approved && `${r.approved} added to the tree ✓`, r.rejected && `${r.rejected} rejected`,
      r.failed.length && `${r.failed.length} couldn't be added: see why in the list`].filter(Boolean).join(". "));
  } catch (err) { buttons.forEach(b => { b.disabled = false; }); toast(err.message, false); }
}

// What editors decided, newest first, a page at a time, by family. Undo puts one back on the list (an approved one is
// taken out of the tree first); a rejected one can be deleted for good.
const H = { items: [], more: false, who: [], login: "", closed: new Set() };
async function openHistory(first) {
  H.items = []; H.first = first;
  await moreHistory();
}
async function moreHistory() {
  const last = H.items.at(-1);
  const q = new URLSearchParams({ ...(last && { before: `${last.decided}:${last.id}` }), ...(H.login && { login: H.login }) });
  let d;
  try { d = await api(`/suggestions/history?${q}`); } catch (err) { return toast(err.message, false); }
  made = d.made;
  H.items.push(...d.items); H.more = d.more; H.who = d.who;
  renderHistory();
}
function renderHistory() {
  const say = h("div", { role: "status" });
  const sure = (btn, text, go) => async () => {
    if (btn.dataset.sure !== "1") { btn.dataset.sure = "1"; btn.textContent = text; return; }
    btn.disabled = true;
    try { await go(); } catch (err) { btn.disabled = false; say.replaceChildren(h("div", { class: "warn" }, err.message)); }
  };
  const row = r => {
    const yes = r.status === "approved";
    const undo = r.undo && h("button", {}, "Undo");
    if (undo) undo.onclick = sure(undo, yes ? "Yes, take it out of the tree" : "Yes, back to the list", async () => {
      await postJSON(`/suggestions/${r.id}/undo`, {});
      hideDlg();
      await openReview();
      toast(yes ? "Undone ✓ It's out of the tree and back on the list." : "Back on the list ✓");
    });
    const del = !yes && h("button", { class: "danger" }, "Delete");
    if (del) del.onclick = sure(del, "Yes, delete", async () => {
      await postJSON("/suggestions/delete", { ids: [r.id] });
      H.items = H.items.filter(x => x.id !== r.id); renderHistory();
    });
    return h("div", { class: "sugdone" }, h("span", { "aria-hidden": "true" }, yes ? "✓" : "✗"),
      h("div", {}, h("div", {}, ...says(r, true)),
        h("div", { class: "small muted" }, `${yes ? "Approved" : "Rejected"} by ${r.by} · ${new Date(r.decided * 1000).toLocaleDateString()} · from ${r.name}`)),
      h("div", { class: "btnrow" }, undo || "", del || ""));
  };
  const who = h("select", { "aria-label": "Suggested by" }, h("option", { value: "" }, "Everyone"),
    ...H.who.map(w => h("option", { value: w.login, selected: w.login === H.login }, w.name)));
  who.onchange = () => { H.login = who.value; openHistory(); };
  const all = h("button", { class: "danger" }, "Delete all rejected");
  all.onclick = sure(all, "Yes, delete every rejected one", async () => {
    const r = await postJSON("/suggestions/delete", { rejected: "all" });
    toast(`${r.deleted} deleted`); openHistory();
  });
  const groups = families(H.items).map(g => famBox(g, !H.closed.has(g.key), o => H.closed[o ? "delete" : "add"](g.key),
    () => { if (g.id && P[g.id]) { hideDlg(); seeTree(g.id); } }, nested(g.rows, row)));
  $("#dlg").replaceChildren(h("h3", { id: "dlg-title" }, "Decided suggestions"),
    H.first ? h("p", {}, h("strong", {}, H.first)) : "",
    h("p", { class: "small muted" }, "Approved or rejected by mistake? Undo puts it back on the list to decide again; an approved one is taken out of the tree first."),
    h("div", { class: "btnrow" }, h("label", {}, "Suggested by ", who), H.items.some(r => r.status === "rejected") ? all : ""),
    ...(groups.length ? groups : [h("p", { class: "muted" }, "Nothing decided yet.")]),
    H.more ? h("button", { onclick: moreHistory }, "Show older") : "", say,
    h("div", { class: "btnrow end" }, h("button", { onclick: hideDlg }, "Close")));
  showDlg(true);
}
