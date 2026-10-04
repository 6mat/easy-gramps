// Easy Gramps — family tree view. Data comes from Gramps Web through this app's /tree/* endpoints.
import { api, auth, login, LoginNeeded, BASE, photoSession } from "./auth.js";

if (new URLSearchParams(location.search).has("debug")) import("./debug.js");  // screen diagnostics

// ---------- family data ----------
const P = {}, FAMS = [];
let ME = null;
async function loadGraph() {
  const g = await api("/tree/graph");
  for (const k of Object.keys(P)) delete P[k];
  for (const [id, p] of Object.entries(g.people)) P[id] = { residence: "", residenceRest: "", phone: "", email: "", notes: "", otherNotes: [], ...p };
  FAMS.length = 0; FAMS.push(...g.families);
}

// Switches for the editing features (all on).
const EDIT_READY = true;

const S = { focus: null, sel: null, history: [], scrolledFor: null, zoom: 1, fit: true, panel: true, pop: null, big: false, full: false, role: "guest", stack: [], add: null, more: false, edMore: false, menu: null, snap: null, merge: null };

// ---------- helpers ----------
const $ = s => document.querySelector(s);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k.nodeType ? k : String(k));
  return el;
}
// People already in the tree with the name being typed: match each part that was given.
const sameName = (first, last) => Object.values(P).filter(p =>
  (!first || p.first.toLowerCase() === first.toLowerCase()) && (!last || p.last.toLowerCase() === last.toLowerCase()));
const canAdd = () => EDIT_READY && S.role !== "guest";
const canEdit = () => EDIT_READY && S.role === "editor";
const canLink = () => canEdit();  // Gramps lets only editors link people into a family (Contributors can only add)
const name = p => [p.first, p.last].filter(Boolean).join(" ") || "(no name)";
// Their parents' family: the first in Gramps' own order (the server uses the same one when adding a parent).
const parentFam = id => FAMS.find(f => f.id === P[id]?.pfams?.[0]) || FAMS.find(f => f.kids.includes(id));
// A person's own families in marriage order (1st husband or wife first), then any the order doesn't list.
const spouseFams = id => {
  const mine = f => f && (f.f === id || f.m === id);
  const own = (P[id]?.fams || []).map(fid => FAMS.find(f => f.id === fid)).filter(mine);
  return [...own, ...FAMS.filter(f => mine(f) && !own.includes(f))];
};
const other = (f, id) => (f.f === id ? f.m : f.f);
const byBirth = ids => [...ids].sort((a, b) => (P[a].birth?.y ?? 9999) - (P[b].birth?.y ?? 9999));
const fmtDate = d => !d ? "" : d.m && d.d ? `${d.d} ${MON[d.m - 1]} ${d.y}` : String(d.y);
function years(p) {
  const b = p.birth?.y, d = p.death?.y;
  return b || d ? `${b || "?"} – ${d || (p.deceased ? "?" : "")}` : "";
}
function desc(p) {
  const pf = parentFam(p.id);
  const par = pf && (P[pf.f] || P[pf.m]);
  const word = p.gender === "m" ? "son" : p.gender === "f" ? "daughter" : "child";
  return [years(p), par && `${word} of ${name(par)}`, p.birthPlace].filter(Boolean).join(" · ");
}
// Stand-in "photos" are soft gradients; people without a photo get initials on a tint picked from their name.
const TINTS = [["#dbe6f2", "#9fbbd8"], ["#dcefe9", "#8cc3b4"], ["#f3e3d2", "#d9a878"], ["#ebdff0", "#b995c7"], ["#f4dde2", "#d494a3"], ["#e4ebd8", "#a7ba86"]];
const tint = p => TINTS[[...(p.first + p.last)].reduce((n, ch) => n + ch.charCodeAt(0), 0) % TINTS.length];
function photoEl(p, big) {
  const cls = `ph${big ? " big" : ""}`;
  if (p.photo && p.photo !== "ph") {
    const src = /^(data|blob):/.test(p.photo) ? p.photo
      : `${BASE}/gapi/media/${p.photo}/thumbnail/${big ? 256 : 96}?square=1`;
    const img = h("img", { src, alt: `Photo of ${name(p)}` });
    const box = h("span", { class: cls }, img);
    let retried = false;
    img.onerror = async () => {
      // The photo cookie may have outlived its token: renew the login once, then try again.
      if (!retried && !src.startsWith("blob:")) { retried = true; if (await renewPhotos()) { img.src = `${src}&r=1`; return; } }
      const [a2] = tint(p); box.replaceChildren((p.first[0] || "") + (p.last[0] || "")); box.style.background = a2;
    };
    return box;
  }
  const [a, b] = tint(p);
  if (p.photo === "ph") { const el = h("span", { class: `${cls} photo`, role: "img", "aria-label": `Photo of ${name(p)}` }); el.style.setProperty("--pa", b); el.style.setProperty("--pb", a); return el; }
  const el = h("span", { class: cls, "aria-hidden": "true" }, (p.first[0] || "") + (p.last[0] || ""));
  el.style.background = a; el.style.color = "#1d1b18";
  return el;
}
let renewing = null;
function renewPhotos() {  // one renewal for all the photos that failed at the same time
  renewing ||= api("/auth/me").then(() => photoSession()).then(() => true, () => false)
    .finally(() => setTimeout(() => { renewing = null; }, 30000));
  return renewing;
}
const spouseWord = p => (p.gender === "m" ? "wife" : p.gender === "f" ? "husband" : "husband or wife");
const relWord = (rel, base) => rel === "spouse" ? spouseWord(base) : rel;

// ---------- undo + toast ----------
let toastTimer, undoToken = null;
// undo: what the server says will reverse the change (shown as an "Undo" button for 10 seconds)
function toast(msg, undo = null) {
  undoToken = undo || null;
  $("#toast-msg").textContent = msg;
  $("#toast-undo").hidden = !undoToken;
  $("#toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $("#toast").hidden = true; undoToken = null; }, 10000);
}
$("#toast-undo").onclick = async () => {
  const token = undoToken;
  if (!token) return;
  undoToken = null;
  $("#toast").hidden = true;
  try {
    await flushSaves();  // typing waiting to be saved goes first, so the reload can't undo it
    await api("/tree/undo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(token) });
    await refresh();
    toast("Undone");
  } catch (err) {
    if (err instanceof LoginNeeded) return showLogin();
    toast(`Couldn't undo: ${err.message}`);
  }
};
// Reload everything from Gramps after a change, keeping the view where it was.
async function refresh() {
  await loadGraph();
  if (!P[S.focus]) S.focus = null;
  S.history = S.history.filter(x => P[x]);
  if (!P[S.sel]) S.sel = S.focus;
  if (!$("#editor").hidden) {
    S.stack = S.stack.filter(x => P[x]);
    if (S.stack.length) await ensureDetails(S.stack.at(-1)).catch(() => {});
  }
  S.menu = null;
  renderAll();
}
function postJSON(path, body) {
  return api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

// ---------- autosave: changes go to Gramps a moment after the last keystroke, one save at a time ----------
const pending = {};          // person id -> fields waiting to be saved
let saveTimer, saveChain = Promise.resolve(), saveFailed = null;
function setStatus(text, cls = "") {
  const st = $("#ed-status");
  st.className = `status ${cls}`.trim();
  st.replaceChildren(text);
  if (cls === "failed") st.append(" ", h("button", { onclick: () => { saveFailed = null; flushSaves(); } }, "Try again"));
}
function autosave(id, patch) {
  pending[id] = { ...pending[id], ...patch };
  setStatus("Saving…", "saving");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSaves, 700);
}
function flushSaves(keepalive = false) {  // keepalive: the page is closing, let the save finish anyway
  clearTimeout(saveTimer);
  const work = Object.entries(pending);
  for (const [id] of work) delete pending[id];
  if (!work.length) return saveChain;
  saveChain = saveChain.then(async () => {
    for (const [id, patch] of work) {
      try {
        await api(`/tree/person/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch), keepalive });
      } catch (err) {
        pending[id] = { ...patch, ...pending[id] };  // keep it for "Try again"
        saveFailed = err;
      }
    }
    if (Object.keys(pending).length && saveFailed) setStatus(`Not saved: ${saveFailed.message}`, "failed");
    else if (!Object.keys(pending).length) setStatus("Saved ✓");
  });
  return saveChain;
}
window.addEventListener("beforeunload", e => { if (Object.keys(pending).length) { flushSaves(true); e.preventDefault(); } });
// Phones and tablets often close a hidden tab without any unload event: save when the page is hidden.
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && Object.keys(pending).length) flushSaves(true); });

// ---------- tree ----------
// Rows are generations: parents, the person (with siblings and spouses), children.
// A couple is joined by a solid line; children hang from the middle of their parents' line.
let BW = 204, BH = 84;
const CG = 52, SG = 18, UG = 48, RGAP = 118;
let REL = {};
const cap = w => w[0].toUpperCase() + w.slice(1);
const ORD = ["1st", "2nd", "3rd", "4th", "5th"];
const kidWord = p => (p.gender === "m" ? "Son" : p.gender === "f" ? "Daughter" : "Child");
const sibWord = p => (p.gender === "m" ? "Brother" : p.gender === "f" ? "Sister" : "Sibling");

// Spread units apart evenly where they overlap, keeping each close to where it wants to be.
function spread(units) {
  units.sort((a, b) => a.want - b.want);
  units.forEach(u => { u.x = u.want - u.w / 2; });
  for (let pass = 0; pass < 20; pass++) {
    let moved = false;
    for (let i = 1; i < units.length; i++) {
      const gap = units[i - 1].x + units[i - 1].w + UG - units[i].x;
      if (gap > 0.5) {
        units.slice(0, i).forEach(u => { u.x -= gap / 2; });
        units.slice(i).forEach(u => { u.x += gap / 2; });
        moved = true;
      }
    }
    if (!moved) break;
  }
}

function renderTree() {
  const empty = !S.focus;
  $(".treepane").classList.toggle("empty", empty);
  $(".main").classList.toggle("nopanel", empty || !S.panel);
  if (empty) {
    S.layout = null; S.pop = null;
    $("#tree-title").textContent = "Family tree";
    $("#tree-home").hidden = $("#tree-back").hidden = $("#tree-see").hidden = $("#show-panel").hidden = true;
    renderStart();
    return;
  }
  S.startShown = false;
  BW = S.big ? 248 : 204; BH = S.big ? 100 : 84;
  const f = S.focus, fp = P[f];
  REL = { [f]: { tag: "", phrase: "" } };
  const rowY = [34, 34 + BH + RGAP, 34 + 2 * (BH + RGAP)];
  const nodes = [], couples = [], fams = [], arches = [];
  const put = (key, x, row, extra = {}) => { const n = { key, x, y: rowY[row], row, ...extra }; nodes.push(n); return n; };
  const pos = {};

  // ----- row 1: siblings, spouses and the person -----
  const pf = parentFam(f);
  const sibs = pf ? byBirth(pf.kids).filter(k => k !== f) : [];
  const sfs = spouseFams(f);
  const married = sfs.filter(x => other(x, f));
  const alone = sfs.filter(x => !other(x, f));
  const female = fp.gender === "f";
  // 1st marriage: a man's wife on his right, a woman's husband on her left. The 2nd goes on the other side.
  const left = [], right = [];
  married.forEach((x, i) => (i === 0 ? (female ? left : right) : i === 1 ? (female ? right : left) : right).push(x));
  const spouseTag = x => {
    const w = cap(spouseWord(fp));
    return married.length > 1 ? `${w} (${ORD[married.indexOf(x)]})` : w;
  };
  let cx = 0;
  sibs.forEach(k => { pos[k] = put(k, cx, 1); REL[k] = { tag: sibWord(P[k]), phrase: `${sibWord(P[k])} of ${fp.first}` }; cx += BW + SG; });
  if (sibs.length) cx += UG - SG;
  const spouseSlot = { slot: true, label: `+ ${cap(spouseWord(fp))}`, act: () => openEditor(f, "spouse") };
  if (!married.length && female) { pos["slot-spouse"] = put("slot-spouse", cx, 1, spouseSlot); cx += BW + CG; }
  for (const x of left) { const o = other(x, f); pos[o] = put(o, cx, 1); cx += BW + CG; }
  pos[f] = put(f, cx, 1, { focus: true });
  const fx = cx; cx += BW;
  if (!married.length && !female) { cx += CG; pos["slot-spouse"] = put("slot-spouse", cx, 1, spouseSlot); cx += BW; }
  if (pos["slot-spouse"]) couples.push([f, "slot-spouse", null, true]);
  for (const x of right) { const o = other(x, f); cx += CG; pos[o] = put(o, cx, 1); cx += BW; }
  for (const x of married) { const o = other(x, f); REL[o] = { tag: spouseTag(x), phrase: `${spouseTag(x)} of ${fp.first}` }; }

  // where each of the person's families drops its children from
  const mid1 = rowY[1] + BH / 2, archY = rowY[1] - 12;
  const drop = {};
  for (const x of left) { const o = other(x, f); couples.push([o, f, x.id]); drop[x.id] = { x: (pos[o].x + BW + fx) / 2, y: mid1 }; }
  right.forEach((x, i) => {
    const o = other(x, f);
    if (i === 0) { couples.push([f, o, x.id]); drop[x.id] = { x: (fx + BW + pos[o].x) / 2, y: mid1 }; }
    else {
      // 3rd and later spouses: their own line leaves the top of the person's box and arches over.
      const prev = other(right[i - 1], f);
      arches.push({ id: `arch-${x.id}`, x1: fx + BW * 0.75 + (i - 1) * 8, x2: pos[o].x + BW * 0.25, y: archY - (i - 1) * 8 });
      drop[x.id] = { x: (pos[prev].x + BW + pos[o].x) / 2, y: archY - (i - 1) * 8 };
    }
  });
  for (const x of alone) drop[x.id] = { x: fx + BW / 2, y: rowY[1] + BH };

  // ----- row 2: children (with their husband or wife), grouped under their parents' line -----
  const kidUnits = [];
  for (const x of [...left, ...right, ...alone]) {
    const kids = byBirth(x.kids);
    const items = kids.map(k => {
      const ks = spouseFams(k).map(y => other(y, k)).find(Boolean);
      return { k, ks, w: ks ? BW * 2 + CG : BW };
    });
    if (canLink()) items.push({ slot: true, famId: x.id, w: BW });
    if (!items.length) continue;
    const w = items.reduce((t, it) => t + it.w, 0) + SG * (items.length - 1);
    kidUnits.push({ fam: x, items, w, want: drop[x.id].x });
  }
  if (!sfs.length && canLink()) kidUnits.push({ fam: null, items: [{ slot: true, famId: null, w: BW }], w: BW, want: fx + BW / 2 });
  spread(kidUnits);
  for (const u of kidUnits) {
    let gx = u.x;
    for (const it of u.items) {
      if (it.slot) pos[`slot-child-${it.famId}`] = put(`slot-child-${it.famId}`, gx, 2, { slot: true, label: "+ Child", act: () => openEditor(f, "child", it.famId || undefined) });
      else {
        pos[it.k] = put(it.k, gx, 2);
        REL[it.k] = { tag: kidWord(P[it.k]), phrase: `${kidWord(P[it.k])} of ${fp.first}` };
        if (it.ks) {
          pos[it.ks] = put(it.ks, gx + BW + CG, 2);
          couples.push([it.k, it.ks, spouseFams(it.k).find(y => other(y, it.k) === it.ks)?.id]);
          const w = P[it.ks].gender === "m" ? "Son-in-law" : P[it.ks].gender === "f" ? "Daughter-in-law" : "Child-in-law";
          REL[it.ks] = { tag: w, phrase: `${P[it.k].first}'s ${spouseWord(P[it.k])} (${w.toLowerCase()} of ${fp.first})` };
        }
      }
      gx += it.w + SG;
    }
    const slots = u.items.filter(i => i.slot).map(i => `slot-child-${i.famId}`);
    if (u.fam) fams.push({ id: u.fam.id, from: drop[u.fam.id], kids: u.items.filter(i => !i.slot).map(i => i.k), slots, row: 2 });
    else {
      // no husband or wife yet: the child placeholder hangs from the dotted line to the spouse placeholder
      const sp = pos["slot-spouse"];
      const from = sp ? { x: (Math.min(fx, sp.x) + BW + Math.max(fx, sp.x)) / 2, y: mid1 } : { x: fx + BW / 2, y: rowY[1] + BH };
      fams.push({ id: "placeholder-kids", from, kids: [], slots, row: 2, dotted: true });
    }
  }

  // ----- row 0: the person's parents, and each spouse's parents, above them -----
  const parUnits = [];
  const fa = pf?.f, mo = pf?.m;
  parUnits.push({ own: true, fam: pf, members: [fa || "slot-father", mo || "slot-mother"], kids: [...sibs, f], want: fx + BW / 2 });
  for (const x of married) {
    const o = other(x, f), opf = parentFam(o);
    if (!opf || !(opf.f || opf.m)) continue;
    parUnits.push({ fam: opf, members: [opf.f, opf.m].filter(Boolean), kids: [o], want: pos[o].x + BW / 2, of: o });
  }
  parUnits.forEach(u => { u.w = u.members.length === 2 ? BW * 2 + CG : BW; });
  spread(parUnits);
  for (const u of parUnits) {
    u.members.forEach((m, i) => {
      const x = u.x + i * (BW + CG);
      if (m.startsWith("slot-")) {
        const rel = m === "slot-father" ? "father" : "mother";
        pos[m] = put(m, x, 0, { slot: true, label: `+ ${cap(rel)}`, act: () => openEditor(f, rel) });
      } else {
        pos[m] = put(m, x, 0);
        const w = m === u.fam?.f ? "father" : "mother";
        REL[m] = u.own ? { tag: cap(w), phrase: `${cap(w)} of ${fp.first}` }
          : { tag: `${cap(spouseWord(fp))}'s ${w}`, phrase: `${P[u.of].first}'s ${w}` };  // box: "Wife's father"
      }
    });
    const real = u.members.filter(m => !m.startsWith("slot-"));
    const empty = u.members.filter(m => m.startsWith("slot-"));
    if (real.length && empty.length) couples.push([real[0], empty[0], null, true]);
    if (!real.length) {
      couples.push([empty[0], empty[1], null, true]);
      fams.push({ id: "placeholder-parents", from: { x: u.x + BW + CG / 2, y: rowY[0] + BH / 2 }, kids: u.kids.filter(k => k === f), slots: [], row: 1, dotted: true });
      continue;
    }
    if (real.length === 2) couples.push([...real, u.fam.id]);
    // Children hang from the middle of the couple line, even when one side is still an empty "Add" slot.
    const from = u.members.length === 2 ? { x: u.x + BW + CG / 2, y: rowY[0] + BH / 2 }
      : { x: pos[real[0]].x + BW / 2, y: rowY[0] + BH };
    fams.push({ id: u.fam.id, from, kids: u.kids, row: 1 });
  }

  // ----- size the canvas; fit it to the screen (never below 60%) unless zoomed by hand -----
  const scroll = $("#treescroll"), inner = $("#treeinner"), size = $("#treesize");
  const minX = Math.min(...nodes.map(n => n.x)), maxX = Math.max(...nodes.map(n => n.x + BW));
  const cw = maxX - minX + 80, ch = Math.max(...nodes.map(n => n.y + BH)) + 40;
  const newTree = S.scrolledFor !== f;
  if (newTree) { S.fit = true; S.fitAll = false; }
  const vw = viewW(), cover = scroll.clientWidth - vw;
  if (S.fit) S.zoom = Math.min(1, Math.max(S.fitAll ? 0.25 : 0.6, Math.min(vw / cw, scroll.clientHeight / ch)));
  const z = S.zoom, extra = cover / z;  // extra room on the right, so everyone can be moved out from under the panel
  const width = Math.max(cw, vw / z) + extra, height = Math.max(ch, scroll.clientHeight / z);
  const OX = (width - extra - (maxX - minX)) / 2 - minX;
  inner.style.width = `${width}px`; inner.style.height = `${height}px`; inner.style.transform = `scale(${z})`;
  size.style.width = `${width * z}px`; size.style.height = `${height * z}px`;
  $("#z-pct").textContent = `${Math.round(z * 100)}%`;
  S.layout = { OX, width, height, extra, fx, rowY, nodes: nodes.filter(n => !n.slot) };

  const rows = $("#rows");
  rows.replaceChildren(...nodes.map(n => {
    const el = n.slot ? slotEl(n.label, n.act) : nodeEl(n.key, n.focus);
    el.style.left = `${n.x + OX}px`; el.style.top = `${n.y}px`;
    el.style.width = `${BW}px`; el.style.height = `${BH}px`;
    return el;
  }), ...nodes.filter(n => !n.slot && n.key === S.sel && canAdd()).slice(0, 1).map(n => plusEl(n, OX)));
  drawLines({ couples, fams, arches, pos, rowY, OX, focusFams: sfs.map(x => x.id) });

  // title bar: back on the left, whose tree in the middle, the selected person's tree on the right
  $("#tree-title").textContent = `${name(fp)}'s family tree`;
  $("#tree-home").hidden = false;
  const back = $("#tree-back"), prev = S.history.at(-1);
  back.hidden = !prev;
  if (prev) back.textContent = `← Back to ${P[prev].first}'s tree`;
  const see = $("#tree-see"), sp = P[S.sel];
  see.hidden = S.sel === S.focus;
  if (!see.hidden) see.textContent = `See ${sp.first}'s tree →`;
  $("#show-panel").hidden = S.panel;
  $("#z-full").innerHTML = S.full ? '✕<span class="lbl"> Exit full screen</span>' : '⛶<span class="lbl"> Full screen</span>';
  $("#z-full").title = S.full ? "Leave full screen" : "Use the whole screen for the tree";

  if (newTree) {
    S.scrolledFor = f;
    scroll.scrollLeft = (fx + OX + BW / 2) * z - vw / 2;
    scroll.scrollTop = (rowY[1] + BH / 2) * z - scroll.clientHeight / 2;
  }
  drawMinimap();
  placePopcard();
  drawSelink();
}

function nodeEl(id, focus) {
  const p = P[id], rel = REL[id]?.tag;
  const el = h("div", { class: `node${focus ? " focus" : ""}${S.sel === id ? " sel" : ""}`, "data-key": id, tabindex: "0",
    role: "button", "aria-label": `${rel ? rel + ": " : ""}${name(p)} ${years(p)}`,
    onclick: e => { e.stopPropagation(); if (S.dragged) return; select(id, true); },
    onkeydown: e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); select(id); showPanel(); } } },
    focus ? h("span", { class: "tag" }, "This tree") : rel && h("span", { class: "tag" }, rel),
    photoEl(p), h("span", { class: "nm", title: name(p) }, name(p)), h("span", { class: "yr" }, years(p) || "No dates yet"),
    h("span", { class: "pl" }, p.birthPlace || " "));
  return el;
}
// The ✎ on the selected box sits beside it in the page (a button inside the box's own button
// confuses screen readers), placed over the box's bottom-right corner as before.
function plusEl(n, OX) {
  const p = P[n.key];
  const el = h("button", { class: "plus", title: `Edit ${p.first}`, "aria-label": `Edit ${name(p)}`,
    onclick: e => { e.stopPropagation(); openEditor(n.key); } }, "✎");
  el.style.left = `${n.x + OX + BW - 22}px`; el.style.top = `${n.y + BH - 22}px`;
  return el;
}
function slotEl(label, onClick) {
  return canLink() ? h("button", { class: "slot tslot", onclick: e => { e.stopPropagation(); onClick(); } }, `Add ${label.slice(2).toLowerCase()}`)
    : h("span", { class: "slot tslot" }, `No ${label.slice(2).toLowerCase()} added`);
}

function drawLines({ couples, fams, arches, pos, rowY, OX, focusFams }) {
  const svg = $("#lines"), inner = $("#treeinner");
  // One colour per family, the person's own families first so they get the strongest colours.
  const order = [...new Set([...focusFams, ...fams.filter(fm => !fm.dotted).map(fm => fm.id), ...couples.map(c => c[2]).filter(Boolean)])];
  const col = id => `c${Math.max(0, order.indexOf(String(id).replace(/^arch-/, ""))) % 6}`;
  svg.setAttribute("width", inner.offsetWidth); svg.setAttribute("height", inner.offsetHeight);
  const cxOf = k => pos[k].x + OX + BW / 2;
  const H = [], V = [];
  // Each family's sibling bar gets its own height ("lane") so bars of different families never merge.
  for (const row of [1, 2]) {
    const lanes = [];
    const list = fams.filter(fm => fm.row === row && (fm.kids.length || fm.slots?.length)).map(fm => {
      const xs = [fm.from.x + OX, ...fm.kids.map(cxOf), ...(fm.slots || []).map(cxOf)];
      return { fm, x1: Math.min(...xs), x2: Math.max(...xs) };
    }).sort((a, b) => a.x1 - b.x1);
    for (const it of list) {
      let lane = lanes.findIndex(segs => segs.every(sg => it.x2 + 14 < sg.x1 || it.x1 > sg.x2 + 14));
      if (lane < 0) { lanes.push([]); lane = lanes.length - 1; }
      lanes[lane].push(it);
      const fm = it.fm, y = rowY[row] - 24 - lane * 12, id = fm.id;
      const solid = !fm.dotted && fm.kids.length > 0;
      const fromX = fm.from.x + OX;
      const realXs = [fromX, ...fm.kids.map(cxOf)];
      const lo = Math.min(...realXs), hi = Math.max(...realXs);
      V.push({ id, x: fromX, y1: fm.from.y, y2: y, dot: !solid });
      if (hi - lo > 1) H.push({ id, x1: lo, x2: hi, y, dot: !solid });
      fm.kids.forEach(k => V.push({ id, x: cxOf(k), y1: y, y2: rowY[row], dot: !solid }));
      for (const sk of fm.slots || []) {
        const sx = cxOf(sk);
        if (sx < lo) H.push({ id, x1: sx, x2: lo, y, dot: true });
        if (sx > hi) H.push({ id, x1: hi, x2: sx, y, dot: true });
        V.push({ id, x: sx, y1: y, y2: rowY[row], dot: true });
      }
    }
  }
  for (const a of arches) {
    H.push({ id: a.id, x1: a.x1 + OX, x2: a.x2 + OX, y: a.y });
    V.push({ id: a.id, x: a.x1 + OX, y1: a.y, y2: rowY[1] }, { id: a.id, x: a.x2 + OX, y1: a.y, y2: rowY[1] });
  }
  const d = [];
  // Where another family's line crosses a horizontal line, the horizontal line hops over it.
  for (const hz of H) {
    const hops = V.filter(v => v.id !== hz.id && v.x > hz.x1 + 7 && v.x < hz.x2 - 7 &&
      Math.min(v.y1, v.y2) < hz.y - 1 && Math.max(v.y1, v.y2) > hz.y + 1).map(v => v.x).sort((a, b) => a - b);
    let path = `M${hz.x1} ${hz.y}`;
    for (const x of hops) path += `H${x - 5}a5 5 0 0 1 10 0`;
    d.push(`<path class="${col(hz.id)}${hz.dot ? " dot" : ""}" d="${path}H${hz.x2}"/>`);
  }
  for (const v of V) d.push(`<path class="${col(v.id)}${v.dot ? " dot" : ""}" d="M${v.x} ${v.y1}V${v.y2}"/>`);
  for (const [a, b, id, dotted] of couples) {
    const A = pos[a], B = pos[b];
    const [l, r] = A.x < B.x ? [A, B] : [B, A];
    d.push(`<path class="couple ${dotted ? "dot" : col(id)}" d="M${l.x + OX + BW} ${l.y + BH / 2}H${r.x + OX}"/>`);
  }
  svg.innerHTML = d.join("");
}
// At most one redraw per frame: resize and scroll fire many times a second.
const perFrame = fn => { let queued = false; return () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; fn(); }); }; };
window.addEventListener("resize", perFrame(() => renderTree()));

function select(id, fromClick) {
  S.sel = id; S.more = false;
  S.pop = fromClick && !S.panel ? id : null;
  renderTree(); renderPanel();
  if (fromClick) reveal(id);
}
function rememberFocus() {
  history.replaceState(null, "", location.pathname + location.search + (S.focus ? `#/p/${S.focus}` : ""));
}
const RECENT_KEY = "eg_recent_viewed";
function recentViewed() { try { return JSON.parse(store.get(RECENT_KEY) || "[]").filter(id => P[id]); } catch { return []; } }
function noteViewed(id) { store.set(RECENT_KEY, JSON.stringify([id, ...recentViewed().filter(x => x !== id)].slice(0, 8))); }
function seeTree(id) {
  noteViewed(id);
  if (S.focus && id !== S.focus) S.history.push(S.focus);
  queueMicrotask(rememberFocus);
  S.focus = S.sel = id; S.more = false; S.pop = null;
  renderTree(); renderPanel();
}
$("#tree-back").onclick = () => {
  const prev = S.history.pop();
  if (!prev || !P[prev]) return;
  S.focus = S.sel = prev; S.more = false; S.pop = null;
  renderTree(); renderPanel();
};
$("#tree-see").onclick = () => seeTree(S.sel);

// Home: back to "Whose family tree would you like to see?" from anywhere (saves anything pending first).
async function goHome() {
  if (!$("#editor").hidden) await closeEditor();
  if (S.full) toggleFull(false);
  S.focus = S.sel = null; S.history = []; S.pop = null; S.more = false; S.startShown = false;
  rememberFocus();
  renderAll();
}
$("#tree-home").onclick = goHome;
$("#ed-home").onclick = goHome;
$("#brand").onclick = e => { e.preventDefault(); goHome(); };
// Clicking empty space goes back to the tree's own person (but not at the end of a drag).
$("#treeinner").addEventListener("click", () => { if (S.dragged) return; S.pop = null; if (S.sel !== S.focus) select(S.focus); else placePopcard(); });

// ----- zoom -----
function setZoom(z, px, py) {
  const scroll = $("#treescroll");
  px ??= viewW() / 2; py ??= scroll.clientHeight / 2;
  const old = S.zoom, oldOX = S.layout.OX;
  const lx = (scroll.scrollLeft + px) / old - oldOX, ly = (scroll.scrollTop + py) / old;
  S.fit = false; S.fitAll = false;
  S.zoom = Math.min(1.6, Math.max(0.25, Math.round(z * 100) / 100));
  renderTree();
  scroll.scrollLeft = (lx + S.layout.OX) * S.zoom - px;
  scroll.scrollTop = ly * S.zoom - py;
  drawMinimap(); placePopcard();
}
$("#z-in").onclick = () => setZoom(S.zoom + 0.1);
$("#z-out").onclick = () => setZoom(S.zoom - 0.1);
$("#z-fit").onclick = () => {
  S.fit = true; S.fitAll = true;
  renderTree();
  const sc = $("#treescroll");
  sc.scrollLeft = (sc.scrollWidth - sc.clientWidth) / 2;  // the panel's extra room is on the right, so this centres in the visible part
  sc.scrollTop = (sc.scrollHeight - sc.clientHeight) / 2;
  drawMinimap(); placePopcard();
};
$("#z-centre").onclick = () => {
  const sc = $("#treescroll"), L = S.layout, z = S.zoom;
  sc.scrollTo({ left: (L.fx + L.OX + BW / 2) * z - viewW() / 2, top: (L.rowY[1] + BH / 2) * z - sc.clientHeight / 2, behavior: "smooth" });
};
// Double-tap: back to the opening zoom, centred on that person (or on the tree's own person).
function viewOn(id) {
  S.fit = true; S.fitAll = false;
  renderTree();
  const sc = $("#treescroll"), L = S.layout, n = L.nodes.find(x => x.key === id) || L.nodes.find(x => x.key === S.focus);
  if (!n) return;
  sc.scrollTo({ left: (n.x + L.OX + BW / 2) * S.zoom - viewW() / 2, top: (n.y + BH / 2) * S.zoom - sc.clientHeight / 2, behavior: "smooth" });
}
// The width of the tree you can actually see: not counting the details panel floating over its right side.
function viewW() {
  const sc = $("#treescroll"), panel = $("#panel");
  if (!S.panel || !S.focus || !panel.offsetParent || matchMedia("(orientation: portrait), (max-width: 899px)").matches) return sc.clientWidth;
  return Math.max(120, panel.getBoundingClientRect().left - sc.getBoundingClientRect().left - 12);
}
// After picking someone, move the tree if they're hidden under the panel or off the edge.
function reveal(id) {
  const el = id && $("#rows").querySelector(`[data-key="${id}"]`);
  if (!el) return;
  const sc = $("#treescroll"), box = sc.getBoundingClientRect(), r = el.getBoundingClientRect();
  const right = box.left + viewW() - 16, left = box.left + 16, bottom = box.top + sc.clientHeight - 16, top = box.top + 16;
  const dx = r.right > right ? r.right - right : r.left < left ? r.left - left : 0;
  const dy = r.bottom > bottom ? r.bottom - bottom : r.top < top ? r.top - top : 0;
  if (dx || dy) sc.scrollBy({ left: dx, top: dy, behavior: "smooth" });
}
$("#treescroll").addEventListener("wheel", e => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  const r = $("#treescroll").getBoundingClientRect();
  setZoom(S.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientX - r.left, e.clientY - r.top);
}, { passive: false });

// ----- on the tree: drag to move, pinch (or Ctrl + scroll) to zoom, double-tap to centre -----
// The page itself never zooms (see the viewport tag and touch-action in tree.css); only the tree does.
document.addEventListener("wheel", e => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
(() => {
  const sc = $("#treescroll");
  const pts = new Map();  // fingers (or the mouse) currently down: id -> {x, y}
  let pan = null, pinch = null, lastTap = null, frame = 0;
  const two = () => { const [a, b] = [...pts.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) }; };
  const startPan = (p, moved) => { pan = { x: p.x, y: p.y, l: sc.scrollLeft, t: sc.scrollTop, moved }; };
  sc.addEventListener("pointerdown", e => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) { startPan(pts.get(e.pointerId), false); S.dragged = false; }
    if (pts.size === 2) {
      const m = two();
      pinch = { d: Math.max(m.d, 1), z: S.zoom, x: m.x, y: m.y }; pan = null;
      for (const id of pts.keys()) try { sc.setPointerCapture(id); } catch {}
    }
  });
  sc.addEventListener("pointermove", e => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pts.size >= 2) {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!pinch || pts.size < 2) return;
        const m = two(), r = sc.getBoundingClientRect();
        setZoom(pinch.z * m.d / pinch.d, m.x - r.left, m.y - r.top);
        sc.scrollLeft -= m.x - pinch.x; sc.scrollTop -= m.y - pinch.y;  // two fingers moving together move the tree
        pinch.x = m.x; pinch.y = m.y;
      });
      return;
    }
    if (!pan) return;
    const dx = e.clientX - pan.x, dy = e.clientY - pan.y;
    if (!pan.moved && Math.abs(dx) + Math.abs(dy) > 6) { pan.moved = true; sc.classList.add("dragging"); try { sc.setPointerCapture(e.pointerId); } catch {} }
    if (pan.moved) { sc.scrollLeft = pan.l - dx; sc.scrollTop = pan.t - dy; }
  });
  const end = e => {
    if (!pts.has(e.pointerId)) return;
    const wasPinch = !!pinch, tap = pan && !pan.moved && !wasPinch && e.type === "pointerup";
    pts.delete(e.pointerId);
    if (pts.size === 1) { pinch = null; startPan([...pts.values()][0], true); return; }  // one finger left: keep moving with it
    if (pts.size) return;
    S.dragged = wasPinch || !!pan?.moved;
    pan = null; pinch = null; sc.classList.remove("dragging");
    setTimeout(() => { S.dragged = false; }, 0);
    if (!tap) { lastTap = null; return; }
    const now = performance.now(), node = e.target.closest?.(".node")?.dataset.key || null;
    if (lastTap && now - lastTap.t < 350 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
      lastTap = null;
      setTimeout(() => viewOn(node || S.focus), 0);  // after the tap's own click has selected them
    } else lastTap = { t: now, x: e.clientX, y: e.clientY };
  };
  sc.addEventListener("pointerup", end); sc.addEventListener("pointercancel", end);
  sc.addEventListener("scroll", perFrame(() => { drawMinimap(); placePopcard(); drawSelink(); }));
})();

// ----- overview map: the whole tree in miniature, with the visible part outlined -----
function drawMinimap() {
  const sc = $("#treescroll"), mm = $("#minimap"), L = S.layout;
  if (!L) return;
  const needed = sc.scrollWidth > sc.clientWidth + 2 || sc.scrollHeight > sc.clientHeight + 2;
  mm.classList.toggle("idle", !needed);
  mm.title = needed ? "The whole tree. Click or drag the orange box to move around." : "The whole tree fits on screen.";
  mm.setAttribute("aria-label", mm.title);
  // The zoom buttons keep their room; the map fits into whatever width is left beside them.
  const room = Math.max(40, Math.min(200, mm.parentElement.clientWidth - 10));
  const m = Math.min(room / (L.width - L.extra), 38 / L.height), z = S.zoom;
  const w = (L.width - L.extra) * m, hh = L.height * m;
  const rects = L.nodes.map(n => `<rect class="${n.focus ? "mm-focus" : "mm-node"}" x="${(n.x + L.OX) * m}" y="${n.y * m}" width="${BW * m}" height="${BH * m}" rx="1.5"/>`).join("");
  const vx = sc.scrollLeft / z * m, vy = sc.scrollTop / z * m, vw = viewW() / z * m, vh = sc.clientHeight / z * m;
  const view = needed ? `<rect class="mm-view" x="${vx}" y="${vy}" width="${Math.min(vw, w)}" height="${Math.min(vh, hh)}" rx="2"/>` : "";
  mm.innerHTML = `<svg width="${w}" height="${hh}" viewBox="0 0 ${w} ${hh}" aria-hidden="true">${rects}${view}</svg>`;
  mm.dataset.m = m;
}
(() => {
  const mm = $("#minimap");
  let down = false;
  const jump = e => {
    const sc = $("#treescroll"), svg = mm.querySelector("svg"), m = Number(mm.dataset.m);
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    sc.scrollLeft = (e.clientX - r.left) / m * S.zoom - viewW() / 2;
    sc.scrollTop = (e.clientY - r.top) / m * S.zoom - sc.clientHeight / 2;
  };
  mm.addEventListener("pointerdown", e => { if (mm.classList.contains("idle")) return; down = true; mm.setPointerCapture(e.pointerId); jump(e); });
  mm.addEventListener("pointermove", e => { if (down) jump(e); });
  mm.addEventListener("pointerup", () => { down = false; });
})();

// ----- side panel: hide it, bring it back with ⓘ; while hidden, a click shows a quick card -----
function showPanel() { S.panel = true; S.pop = null; layoutPanel(); }
function hidePanel() { S.panel = false; layoutPanel(); }
function layoutPanel() {
  $(".main").classList.toggle("nopanel", !S.panel);
  renderTree(); renderPanel();
  if (S.panel) reveal(S.sel);
}
$("#show-panel").onclick = showPanel;

function placePopcard() {
  const card = $("#popcard");
  if (!S.pop || S.panel || !P[S.pop]) { card.hidden = true; card.dataset.for = ""; return; }
  const el = $("#rows").querySelector(`[data-key="${S.pop}"]`);
  if (!el) { card.hidden = true; return; }
  const p = P[S.pop], pane = $(".treepane").getBoundingClientRect(), r = el.getBoundingClientRect();
  if (card.dataset.for !== S.pop) {
    card.dataset.for = S.pop;
    const rel = S.pop !== S.focus && REL[p.id]?.phrase;
    card.replaceChildren(
      h("div", { class: "pc-head" }, photoEl(p), h("div", {}, h("strong", {}, name(p)),
        rel && h("div", { class: "small muted" }, rel))),
      h("div", { class: "small" }, [years(p), p.birthPlace].filter(Boolean).join(" · ") || "No dates yet"),
      h("div", { class: "btnrow" },
        h("button", { class: "primary", onclick: showPanel }, "More info"),
        S.pop !== S.focus && h("button", { onclick: () => seeTree(p.id) }, "Their tree"),
        canAdd() && h("button", { onclick: () => openEditor(p.id) }, "✎ Edit person")));
  }
  card.hidden = false;
  const left = Math.min(Math.max(8, r.left - pane.left), pane.width - card.offsetWidth - 8);
  let top = r.bottom - pane.top + 10;
  if (top + card.offsetHeight > pane.height - 8) top = r.top - pane.top - card.offsetHeight - 10;
  card.style.left = `${left}px`; card.style.top = `${top}px`;
}

// ----- full screen: the tree takes the whole screen -----
function toggleFull(on = !S.full) {
  S.full = on;
  document.body.classList.toggle("fullmode", on);
  try {
    if (on && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
    if (!on && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  } catch {}
  S.scrolledFor = null;
  renderTree(); renderPanel();
}
$("#z-full").onclick = () => toggleFull();
document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement && S.full) toggleFull(false); });

// ----- ☰ menu: light / dark theme and help -----
const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } },
                set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} } };
function applyTheme(t) {
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  const r = document.getElementById(`th-${t || "system"}`); if (r) r.checked = true;
}
applyTheme(store.get("eg_theme") || "system");
document.querySelectorAll('input[name="theme"]').forEach(r => r.addEventListener("change", () => {
  store.set("eg_theme", r.value === "system" ? null : r.value); applyTheme(r.value);
}));
$("#menubtn").onclick = e => {
  e.stopPropagation();
  const pop = $("#menupop"); pop.hidden = !pop.hidden;
  $("#menubtn").setAttribute("aria-expanded", String(!pop.hidden));
};
document.addEventListener("click", e => { if (!e.target.closest(".menuwrap")) { $("#menupop").hidden = true; $("#menubtn").setAttribute("aria-expanded", "false"); } });
function showTip(on) { $("#tipbar").hidden = !on; renderTree(); }
$("#tip-close").onclick = () => { store.set("eg_tip_done", "1"); showTip(false); };
$("#tips-again").onclick = () => { store.set("eg_tip_done", null); $("#menupop").hidden = true; showTip(true); };
$("#tipbar").hidden = !!store.get("eg_tip_done");

// ----- the zoom & map strip can be hidden; remembered on this device -----
function showNav(on) {
  $(".navstrip").hidden = !on; $("#navcorner").hidden = on;
  store.set("eg_nav_hidden", on ? null : "1");
  renderTree();
}
$("#nav-hide").onclick = () => showNav(false);
$("#nav-show").onclick = () => showNav(true);
if (store.get("eg_nav_hidden")) { $(".navstrip").hidden = true; $("#navcorner").hidden = false; }

// ----- A+ bigger text -----
function setBig(on) {
  S.big = on;
  document.body.classList.toggle("big", on);
  $("#bigtext").checked = on;
  store.set("eg_big", on ? "1" : null);
  S.scrolledFor = null;
  renderTree(); renderPanel();
}
$("#bigtext").addEventListener("change", () => setBig($("#bigtext").checked));
if (store.get("eg_big")) { S.big = true; document.body.classList.add("big"); $("#bigtext").checked = true; }

// ----- the dotted line from the selected box to the details panel; remembered on this device -----
S.link = !store.get("eg_noline");
$("#showlink").checked = S.link;
$("#showlink").addEventListener("change", () => {
  S.link = $("#showlink").checked;
  store.set("eg_noline", S.link ? null : "1");
  drawSelink();
});

// ----- arrow keys: ↑ parent, ↓ eldest child, ← → neighbours in the row, Enter details, Esc clear -----
document.addEventListener("keydown", e => {
  if (!$("#editor").hidden || !$("#dlg-wrap").hidden || !$("#menupop").hidden || e.target.closest("input, textarea, select")) return;
  const L = S.layout;
  if (!L) return;
  const at = id => L.nodes.find(n => n.key === id);
  const cur = at(S.sel) || at(S.focus);
  const nearest = row => L.nodes.filter(n => n.row === row).sort((a, b) => Math.abs(a.x - cur.x) - Math.abs(b.x - cur.x))[0];
  let next = null;
  if (e.key === "ArrowUp") {
    const pf = parentFam(cur.key);
    next = (pf && (at(pf.f) || at(pf.m))) || nearest(cur.row - 1);
  } else if (e.key === "ArrowDown") {
    next = byBirth(spouseFams(cur.key).flatMap(x => x.kids)).map(at).find(Boolean) || nearest(cur.row + 1);
  } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    const row = L.nodes.filter(n => n.row === cur.row).sort((a, b) => a.x - b.x);
    next = row[row.indexOf(cur) + (e.key === "ArrowLeft" ? -1 : 1)];
  } else if (e.key === "Enter" && e.target === document.body) { showPanel(); return; }
  else if (e.key === "Escape") { if (S.full) toggleFull(false); else { S.pop = null; select(S.focus); } return; }
  else return;
  e.preventDefault();
  if (!next) return;
  select(next.key, true);
  $("#rows").querySelector(`[data-key="${next.key}"]`)?.focus({ preventScroll: true });
});

// ---------- right panel ----------
async function toggleMore(id) {
  S.more = !S.more;
  renderPanel();
  if (S.more && !P[id]._details) {
    try { Object.assign(P[id], await api(`/tree/details/${id}`), { _details: true }); }
    catch (err) { if (err instanceof LoginNeeded) return showLogin(); toast(`Couldn't load details: ${err.message}`, false); }
    if (S.sel === id) renderPanel();
  }
}

function renderPanel() {
  if (!S.focus || !P[S.sel]) return;
  const p = P[S.sel], pf = parentFam(p.id);
  const isMember = S.sel !== S.focus;
  $("#panel").classList.toggle("sel-view", isMember);
  $("#panel").classList.toggle("focus-view", !isMember);
  const row = (k, v) => v ? [h("dt", {}, k), h("dd", {}, v)] : [];
  const go = id => (REL[id] ? select(id) : seeTree(id));
  const chips = ids => ids.length ? h("div", { class: "chips" }, ids.map(id => h("button", { class: "chip", onclick: () => go(id) }, name(P[id])))) : null;
  const famRow = (label, ids) => ids.length ? h("div", { class: "fam" }, h("h3", {}, label), chips(ids)) : "";
  const parents = pf ? [pf.f, pf.m].filter(Boolean) : [];
  const spouses = spouseFams(p.id).map(x => other(x, p.id)).filter(Boolean);
  const kids = byBirth(spouseFams(p.id).flatMap(x => x.kids));
  const rel = S.sel !== S.focus && REL[p.id]?.phrase;
  const panel = $("#panel");
  panel.replaceChildren(
    h("div", { class: "ptop" },
      h("button", { class: "pill hide", onclick: hidePanel, title: "Hide this panel to give the tree more room" }, "Hide panel »"),
      canAdd() && h("button", { class: "pill edit", onclick: () => openEditor(p.id) }, "✎ Edit person")),
    h("div", { class: "who" }, photoEl(p, true),
      h("div", {}, rel && h("div", { class: "muted small" }, rel), h("h2", {}, name(p)),
        p.nick && h("div", { class: "muted" }, `Called “${p.nick}”`))),
    h("dl", { class: "kv" },
      row("Born", [fmtDate(p.birth), p.birthPlace].filter(Boolean).join(", ") || "Not known"),
      row("Passed away", p.deceased ? fmtDate(p.death) || "Date not known" : "")),
    famRow("Parents", parents),
    famRow(p.gender === "f" ? "Husband" : p.gender === "m" ? (spouses.length > 1 ? "Wives" : "Wife") : "Spouse", spouses),
    famRow("Children", kids),
    h("button", { class: "moretoggle", "aria-expanded": String(S.more), onclick: () => toggleMore(p.id) },
      S.more ? "Fewer details ▴" : "More details ▾"));
  if (S.more) {
    const priv = !ME?.can_view_private;  // Gramps lets Members and up see private details
    const notes = [p.notes, ...p.otherNotes].filter(Boolean).join("\n\n");
    const any = p.burial || p.residence || p.phone || p.email || notes;
    panel.append(h("div", { class: "details" },
      h("dl", { class: "kv" },
        row("Buried at", p.burial), row("Lives in", [p.residence, p.residenceRest].filter(Boolean).join(", ")),
        row("Phone", priv ? "" : p.phone), row("Email", priv ? "" : p.email), row("Notes", notes)),
      !priv && (p.phone || p.email) ? h("div", { class: "private" }, "🔒 Phone and email are private. Guests can't see them.") : "",
      priv && (p.phone || p.email) ? h("div", { class: "private" }, "🔒 Phone and email are hidden from Guests.") : "",
      !any ? h("div", { class: "muted small" }, "No more details yet.") : ""));
  }
  if (canEdit()) panel.append(h("button", { class: "ghost dupbtn", onclick: () => openMerge(p.id) },
    "Is this person in the tree twice?"));
  drawSelink();
}

// A curved line tying the selected member's box to their details panel, so it's clear the
// panel belongs to that box even though the title bar names a different person's tree.
function drawSelink() {
  const svg = $("#selink");
  if (!svg) return;
  const panel = $("#panel"), node = $("#rows")?.querySelector(`[data-key="${S.sel}"]`);
  const show = S.link !== false && S.sel && S.panel && P[S.sel] && $("#editor").hidden
    && !$(".treepane").classList.contains("empty") && panel.offsetParent && node;
  if (!show) { svg.replaceChildren(); return; }
  svg.classList.toggle("own", S.sel === S.focus);  // blue for the tree's own person, amber for anyone else
  const pane = $(".treepane").getBoundingClientRect(), scroll = $("#treescroll").getBoundingClientRect();
  const nr = node.getBoundingClientRect(), pr = panel.getBoundingClientRect();
  const head = panel.querySelector("h2")?.getBoundingClientRect() || pr;
  svg.setAttribute("width", pane.width); svg.setAttribute("height", pane.height);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const cx = nr.left + nr.width / 2, cy = nr.top + nr.height / 2;
  const portrait = matchMedia("(orientation: portrait), (max-width: 899px)").matches;
  // Route through open space (the gap above/below the box, then along the panel's edge) so the
  // line doesn't cut across other boxes. Points are in pane coordinates.
  let pts, ex, ey;
  if (portrait) {  // panel below: drop from the box, run to under the box, then down into the panel top
    const sx = clamp(cx, scroll.left + 8, scroll.right - 8) - pane.left;
    const sy = clamp(nr.bottom, scroll.top + 8, scroll.bottom - 4) - pane.top;
    ex = clamp(cx, pr.left + 18, pr.right - 18) - pane.left;
    ey = pr.top - pane.top;
    const lane = clamp(nr.bottom + 20, scroll.top + 10, pr.top - 8) - pane.top;
    pts = [[sx, sy], [sx, lane], [ex, lane], [ex, ey]];
  } else {  // panel on the right: always leave the box from the bottom, into the gap below, then over to the panel
    const sx = clamp(cx, scroll.left + 8, Math.min(scroll.right, pr.left) - 8) - pane.left;
    const sy = clamp(nr.bottom, scroll.top + 8, scroll.bottom - 8) - pane.top;
    const lane = clamp(nr.bottom + 20, scroll.top + 12, scroll.bottom - 8) - pane.top;
    ex = pr.left - pane.left;
    ey = clamp((head.top + head.bottom) / 2, pr.top + 12, pr.bottom - 12) - pane.top;
    pts = [[sx, sy], [sx, lane], [ex, lane], [ex, ey]];
  }
  const d = roundedPath(pts, 12);
  svg.replaceChildren();
  const mk = (tag, attrs) => { const e = document.createElementNS("http://www.w3.org/2000/svg", tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
  svg.append(mk("path", { d, class: "selink-line" }),
    mk("circle", { cx: ex, cy: ey, r: 3.5, class: "selink-dot" }),
    mk("circle", { cx: pts[0][0], cy: pts[0][1], r: 3, class: "selink-dot" }));
}

// A polyline with rounded corners, for the selection connector.
function roundedPath(pts, r) {
  if (pts.length < 2) return "";
  const len = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p0 = pts[i - 1], p1 = pts[i], p2 = pts[i + 1];
    const rr = Math.min(r, len(p0, p1) / 2, len(p1, p2) / 2);
    const u1 = [(p1[0] - p0[0]) / len(p0, p1), (p1[1] - p0[1]) / len(p0, p1)];
    const u2 = [(p2[0] - p1[0]) / len(p1, p2), (p2[1] - p1[1]) / len(p1, p2)];
    const a = [p1[0] - u1[0] * rr, p1[1] - u1[1] * rr], b = [p1[0] + u2[0] * rr, p1[1] + u2[1] * rr];
    d += ` L ${a[0].toFixed(1)} ${a[1].toFixed(1)} Q ${p1[0]} ${p1[1]} ${b[0].toFixed(1)} ${b[1].toFixed(1)}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${last[0]} ${last[1]}`;
  return d;
}

// ---------- search ----------
$("#q").addEventListener("input", () => {
  const words = $("#q").value.toLowerCase().split(/\s+/).filter(Boolean);
  const res = $("#results");
  if (!words.length) { res.hidden = true; return; }
  const hits = Object.values(P).filter(p => words.every(w => `${p.first} ${p.last} ${p.nick}`.toLowerCase().includes(w)))
    .sort((a, b) => name(a).localeCompare(name(b)));
  res.replaceChildren(...(hits.length ? hits.map(p => h("button", { onclick: () => {
    res.hidden = true; $("#q").value = ""; seeTree(p.id);
  } }, h("strong", {}, name(p)), h("div", { class: "small muted" }, desc(p) || "No details yet")))
    : [h("div", { class: "small muted pad" }, "No one found with that name.")]));
  res.hidden = false;
});
document.addEventListener("click", e => { if (!e.target.closest(".search")) $("#results").hidden = true; });


// ---------- full-screen family editor ----------
async function ensureDetails(id) {
  if (P[id]._details) return;
  Object.assign(P[id], await api(`/tree/details/${id}`), { _details: true });
}
async function openEditor(id, rel, famId) {
  S.stack = [id]; S.edMore = false; S.menu = null;
  setStatus("Saved ✓");
  $("#editor").hidden = false;
  $("#ed-body").replaceChildren(h("p", { class: "muted" }, "Loading…"));
  try { await ensureDetails(id); } catch (err) { if (err instanceof LoginNeeded) return showLogin(); }
  renderEditor();
  if (rel) openAdd(id, rel, famId);
  else $("#ed-back").focus();
}
async function closeEditor() {
  $("#editor").hidden = true; closeDialog();
  await flushSaves();
  // Reload so the tree shows exactly what Gramps now holds.
  try { await loadGraph(); } catch (err) { if (err instanceof LoginNeeded) return showLogin(); }
  if (!P[S.focus]) S.focus = null;
  if (!P[S.sel]) S.sel = S.focus;
  renderTree(); renderPanel();
}
$("#ed-back").onclick = closeEditor;
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  if (!$("#dlg-wrap").hidden) { e.stopImmediatePropagation(); S.merge ? closeMerge() : closeDialog(); }
  else if (!$("#menupop").hidden) { e.stopImmediatePropagation(); $("#menupop").hidden = true; $("#menubtn").setAttribute("aria-expanded", "false"); $("#menubtn").focus(); }
  else if (!$("#editor").hidden) closeEditor();
}, true);  // capture: before the tree's arrow-key handler

function rcard(id, rel, famObj, base, isNew) {
  const p = P[id];
  const card = h("div", { class: `rcard${isNew ? " new" : ""}` },
    h("span", { class: "role" }, rel === "spouse" ? spouseWord(P[base]) : rel),
    photoEl(p), h("span", { class: "nm" }, name(p)),
    h("button", { class: "more", "aria-label": `Options for ${name(p)}`, "aria-expanded": String(S.menu === `${rel}:${id}`),
      onclick: () => { S.menu = S.menu === `${rel}:${id}` ? null : `${rel}:${id}`; renderEditor(); } }, "⋯"),
    h("span", { class: "yr" }, years(p) || "No dates"), h("span", { class: "ds" }, p.birthPlace || ""));
  if (S.menu === `${rel}:${id}`) card.append(menuEl(id, rel, famObj, base));
  if (S.menu === `confirm:${rel}:${id}`) card.append(confirmEl(id, rel, famObj, base));
  return card;
}
function menuEl(id, rel, famObj, base) {
  return h("div", { class: "menu" },
    h("button", { onclick: async () => { await flushSaves(); await ensureDetails(id).catch(() => {}); S.stack.push(id); S.menu = null; S.edMore = false; renderEditor(); } }, `Open ${P[id].first}'s family`),
    canLink() && h("button", { class: "danger", onclick: () => { S.menu = `confirm:${rel}:${id}`; renderEditor(); } }, "Remove from this family"));
}
function confirmEl(id, rel, famObj, base) {
  const w = relWord(rel, P[base]);
  return h("div", { class: "menu" },
    h("div", { class: "small" }, `Remove ${P[id].first} as ${P[base].first}'s ${w}? ${P[id].first} stays in the tree.`),
    h("div", { class: "btnrow" },
      h("button", { class: "danger", onclick: () => removeLink(id, rel, famObj, base) }, "Remove"),
      h("button", { onclick: () => { S.menu = null; renderEditor(); } }, "Cancel")));
}
async function removeLink(id, rel, x, base) {
  const who = P[id].first, whose = P[base].first, w = relWord(rel, P[base]);
  S.menu = null;
  setStatus("Saving…", "saving");
  try {
    await flushSaves();
    const res = await postJSON("/tree/unlink", { person: base, rel, other: id, famId: x.id });
    await refresh();
    setStatus("Saved ✓");
    toast(`Removed ${who} as ${whose}'s ${w}. ${who} is still in the tree.`, res.undo);
  } catch (err) {
    if (err instanceof LoginNeeded) return showLogin();
    setStatus(`Not saved: ${err.message}`, "failed");
    renderEditor();
  }
}

function field(label, input, cls) { return h("label", { class: cls || "", for: input.id }, label, input); }
function bindText(p, key, id, opts = {}) {
  const el = h(opts.area ? "textarea" : "input", { id, type: opts.type || "text", disabled: !canEdit() || opts.disabled, rows: opts.area ? 3 : null });
  el.value = p[key] || "";
  el.addEventListener("input", () => { p[key] = el.value; if (key === "first" || key === "last") $("#ed-title").textContent = `${name(p)}'s family`; autosave(p.id, { [key]: el.value }); });
  return el;
}
function dateInputs(prefix, label, get, set) {
  const d = get() || {};
  const yearOnlyStart = !!(d.y && !(d.m && d.d));
  const pad = n => String(n).padStart(2, "0");
  const cal = h("input", { id: `${prefix}-date`, type: "date", disabled: !canEdit(), "aria-label": label });
  cal.value = d.y && d.m && d.d ? `${d.y}-${pad(d.m)}-${pad(d.d)}` : "";
  const yr = h("input", { id: `${prefix}-year`, type: "number", min: "1500", max: "2100", placeholder: "Year", disabled: !canEdit(), "aria-label": `${label}: year` });
  yr.value = yearOnlyStart ? d.y : "";
  const yo = h("input", { id: `${prefix}-yo`, type: "checkbox", disabled: !canEdit() });
  yo.checked = yearOnlyStart;
  const sync = () => { cal.hidden = yo.checked; yr.hidden = !yo.checked; };
  const save = () => {
    if (yo.checked) set(yr.value ? { y: Number(yr.value) } : null);
    else if (cal.value) { const [y, m, dd] = cal.value.split("-").map(Number); set({ y, m, d: dd }); }
    else set(null);
  };
  yo.addEventListener("change", () => { if (yo.checked && cal.value) yr.value = cal.value.slice(0, 4); sync(); save(); });
  cal.addEventListener("change", save); yr.addEventListener("input", save);
  sync();
  return h("div", {}, cal, yr, h("label", { class: "inline small", for: yo.id }, yo, "I only know the year"));
}

function centreCard(p) {
  const file = h("input", { id: "ed-photo-file", type: "file", accept: "image/*", hidden: true });
  file.addEventListener("change", () => {
    const f = file.files[0]; if (!f) return;
    file.value = "";
    if (f.size > 20 * 1024 * 1024) return setStatus("Photo not saved: it's too big (20 MB at most)", "failed");
    // Show it straight away, then upload it as their main photo (the old one comes back if that fails).
    const old = p.photo, preview = URL.createObjectURL(f);
    p.photo = preview; renderEditor();
    const fd = new FormData(); fd.append("photo", f, f.name);
    setStatus("Saving photo…", "saving");
    saveChain = saveChain.then(() => api(`/tree/person/${p.id}/photo`, { method: "POST", body: fd }))
      .then(res => { p.photo = res.photo; setStatus("Saved ✓"); })
      .catch(err => {
        p.photo = old; URL.revokeObjectURL(preview);
        if (err instanceof LoginNeeded) return showLogin();
        if (!$("#editor").hidden) renderEditor();
        setStatus(`Photo not saved: ${err.message}`, "failed");
      });
  });
  const gender = h("fieldset", {}, h("legend", {}, "Male or female"),
    ...[["m", "Male"], ["f", "Female"]].map(([v, l]) => {
      const r = h("input", { type: "radio", name: "ed-gender", id: `ed-g-${v}`, disabled: !canEdit() });
      r.checked = p.gender === v;
      r.addEventListener("change", () => { p.gender = v; autosave(p.id, { gender: v }); });
      return h("label", { class: "inline", for: r.id }, r, l);
    }));
  const passed = h("input", { id: "ed-passed", type: "checkbox", disabled: !canEdit() });
  passed.checked = !!p.deceased;
  const deathBox = h("div", { class: "box full" },
    h("div", { class: "flabel" }, "Date of death", dateInputs("ed-death", "Date of death", () => p.death, v => { p.death = v; autosave(p.id, { death: v }); })),
    field("Place of burial", bindText(p, "burial", "ed-burial")));
  deathBox.hidden = !p.deceased;
  passed.addEventListener("change", () => {
    p.deceased = passed.checked; deathBox.hidden = !passed.checked;
    if (!passed.checked) { p.death = null; p.burial = ""; }
    autosave(p.id, { deceased: passed.checked });
  });
  // These four come from a separate request; if it failed, don't let empty boxes overwrite real values.
  const off = { disabled: !p._details };
  const moreBox = h("div", { class: "box full" },
    !p._details && h("div", { class: "warn full" }, "Couldn't load these details.",
      h("button", { onclick: async () => { try { await ensureDetails(p.id); } catch (err) { if (err instanceof LoginNeeded) return showLogin(); } renderEditor(); } }, "Try again")),
    field("Residing at", bindText(p, "residence", "ed-res", off), "full"),
    p.residenceRest ? h("div", { class: "small muted full" }, `…, ${p.residenceRest} (change that part in Full Gramps)`) : "",
    field("Phone (private)", bindText(p, "phone", "ed-phone", { type: "tel", ...off })),
    field("Email (private)", bindText(p, "email", "ed-email", { type: "email", ...off })),
    field("Notes", bindText(p, "notes", "ed-notes", { area: true, ...off }), "full"),
    p.otherNotes.length ? h("div", { class: "small muted full" },
      `+ ${p.otherNotes.length} more ${p.otherNotes.length === 1 ? "note" : "notes"}. Open Full Gramps to change ${p.otherNotes.length === 1 ? "it" : "them"}.`) : "");
  moreBox.hidden = !S.edMore;
  return h("div", { class: "centre" },
    h("div", { class: "photo-row full" }, photoEl(p, true),
      canEdit() && h("button", { onclick: () => file.click() }, p.photo ? "Change photo" : "Add photo"), file,
      !canEdit() && h("span", { class: "small muted" }, "Only editors can change details or link family members. You can add new people from the start screen.")),
    field("First name", bindText(p, "first", "ed-first")),
    field("Last name", bindText(p, "last", "ed-last")),
    field("Nickname", bindText(p, "nick", "ed-nick")),
    gender,
    h("div", { class: "flabel" }, "Birthday", dateInputs("ed-birth", "Birthday", () => p.birth, v => { p.birth = v; autosave(p.id, { birth: v }); })),
    field("Place of birth", bindText(p, "birthPlace", "ed-bplace")),
    h("label", { class: "inline full", for: "ed-passed" }, passed, "Passed away?"),
    deathBox,
    h("button", { class: "full", "aria-expanded": String(S.edMore), onclick: () => { S.edMore = !S.edMore; moreBox.hidden = !S.edMore; } },
      "More details ▸ (residing at, phone, email, notes)"),
    moreBox);
}

function renderEditor() {
  const id = S.stack.at(-1), p = P[id];
  $("#ed-title").textContent = `${name(p)}'s family`;
  $("#crumbs").replaceChildren(...(S.stack.length > 1 ? S.stack.flatMap((x, i) => [
    i ? " › " : "",
    i === S.stack.length - 1 ? h("span", {}, P[x].first)
      : h("button", { onclick: () => { S.stack = S.stack.slice(0, i + 1); S.menu = null; renderEditor(); } }, P[x].first)]) : []));
  const lastNew = S.newlyAdded;
  const pf = parentFam(id);
  const parentsRow = h("div", { class: "ed-row" },
    pf?.f ? rcard(pf.f, "father", pf, id, lastNew === pf.f) : canLink() && h("button", { class: "slot ed-slot", onclick: () => openAdd(id, "father") }, "Add father"),
    pf?.m ? rcard(pf.m, "mother", pf, id, lastNew === pf.m) : canLink() && h("button", { class: "slot ed-slot", onclick: () => openAdd(id, "mother") }, "Add mother"));
  const sfs = spouseFams(id);
  const sw = spouseWord(p);
  const spouseCol = h("div", { class: "spouses" },
    ...sfs.filter(x => other(x, id)).map(x => rcard(other(x, id), "spouse", x, id, lastNew === other(x, id))),
    canLink() && h("button", { class: "slot ed-slot", onclick: () => openAdd(id, "spouse") },
      sfs.some(x => other(x, id)) ? `Another ${sw}` : `Add ${sw}`));
  const kidGroups = sfs.map(x => {
    const o = other(x, id);
    const g = h("div", { class: "kidgroup" },
      h("span", { class: "glabel" }, o ? `Children with ${P[o].first}` : "Children (other parent not added)"),
      h("div", { class: "ed-row" }, ...byBirth(x.kids).map(k => rcard(k, "child", x, id, lastNew === k)),
        canLink() && h("button", { class: "slot ed-slot", onclick: () => openAdd(id, "child", x.id) }, "Add child")));
    g.style.setProperty("--fc", `var(--f${sfs.indexOf(x) % 6})`);
    return g;
  });
  if (!sfs.length) kidGroups.push(h("div", { class: "kidgroup" }, h("span", { class: "glabel" }, "Children"),
    canLink() && h("button", { class: "slot ed-slot", onclick: () => openAdd(id, "child") }, "Add child")));
  $("#ed-body").replaceChildren(
    h("section", { class: "ed-sec" }, h("h3", {}, "Parents"), parentsRow),
    h("section", { class: "ed-sec" }, h("div", { class: "mid" }, centreCard(p), spouseCol)),
    h("section", { class: "ed-sec" }, h("h3", {}, "Children"), h("div", { class: "kids" }, kidGroups)));
}

// ---------- add dialog ----------
// The pop-up dialog (Add, Merge): focus goes into it, Tab stays inside, and focus returns on close.
let dlgOpener = null;
function showDlg(wide) {
  dlgOpener = document.activeElement;
  $("#dlg").classList.toggle("wide", wide);
  $("#dlg-wrap").hidden = false;
}
function hideDlg() {
  $("#dlg-wrap").hidden = true;
  if (dlgOpener?.isConnected) dlgOpener.focus();
  dlgOpener = null;
}
$("#dlg-wrap").addEventListener("keydown", e => {
  if (e.key !== "Tab") return;
  const f = [...$("#dlg").querySelectorAll("button, input, select, textarea, [tabindex]")].filter(x => !x.disabled && x.offsetParent);
  if (!f.length) return;
  const i = f.indexOf(document.activeElement);
  if (e.shiftKey && i <= 0) { e.preventDefault(); f.at(-1).focus(); }
  else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
});
function openAdd(pid, rel, famId) {
  S.add = { pid, rel, famId: famId || null, dupOk: false, justAdded: null };
  showDlg(false);
  renderAdd();
}
function closeDialog() { hideDlg(); if (S.add) S.add.justAdded = null; S.add = null; if (!$("#editor").hidden) renderEditor(); }

// ---------- merge two records of the same person ----------
const dateEq = (a, b) => (!a && !b) || (a && b && a.y === b.y && (a.m || 0) === (b.m || 0) && (a.d || 0) === (b.d || 0) && !!a.about === !!b.about);
const genderShow = g => g === "m" ? "Male" : g === "f" ? "Female" : "Not set";
const MERGE_FIELDS = [
  { k: "first", label: "First name", text: true, get: p => p.first || "", show: v => v || "—", empty: v => !v },
  { k: "last", label: "Last name", text: true, get: p => p.last || "", show: v => v || "—", empty: v => !v },
  { k: "nick", label: "Nickname", text: true, get: p => p.nick || "", show: v => v || "—", empty: v => !v },
  { k: "gender", label: "Male or female?", get: p => p.gender || "", show: genderShow, eq: (a, b) => (a || "") === (b || ""), empty: v => !v },
  { k: "birth", label: "Birthday", get: p => p.birth || null, show: v => fmtDate(v) || "—", eq: dateEq, empty: v => !v },
  { k: "birthPlace", label: "Place of birth", text: true, get: p => p.birthPlace || "", show: v => v || "—", empty: v => !v },
  { k: "death", label: "Date of death", get: p => p.death || null, show: v => fmtDate(v) || "—", eq: dateEq, empty: v => !v },
  { k: "burial", label: "Place of burial", text: true, get: p => p.burial || "", show: v => v || "—", empty: v => !v },
];

function openMerge(id) {
  S.merge = { keep: id, absorb: null, q: name(P[id]), choice: {}, text: {}, confirm: false, busy: false };
  showDlg(true);
  renderMerge();
  $("#merge-q")?.focus();
}
function swapMerge() {
  const m = S.merge;
  [m.keep, m.absorb] = [m.absorb, m.keep];
  m.choice = {}; m.text = {}; m.confirm = false;
  renderMerge();
}
function mergeDefault(f, keep, absorb) {  // which side wins by default: keep's value unless it's empty
  return !f.empty(f.get(keep)) ? "keep" : (!f.empty(f.get(absorb)) ? "absorb" : "keep");
}

function renderMerge() {
  const m = S.merge, dlg = $("#dlg");
  const eq = (f, a, b) => (f.eq || ((x, y) => x === y))(f.get(a), f.get(b));

  if (!m.absorb) {  // step 1: find the duplicate
    const keep = P[m.keep];
    const words = m.q.toLowerCase().split(/\s+/).filter(Boolean);
    const hits = Object.values(P).filter(p => p.id !== m.keep
      && (!words.length || words.every(w => `${p.first} ${p.last} ${p.nick}`.toLowerCase().includes(w))))
      .sort((a, b) => (b.last === keep.last) - (a.last === keep.last) || name(a).localeCompare(name(b)))
      .slice(0, 40);
    const input = h("input", { id: "merge-q", type: "search", value: m.q, placeholder: "Search a name", autocomplete: "off" });
    input.addEventListener("input", () => { m.q = input.value; const l = $("#merge-list"); if (l) l.replaceChildren(...candidates()); });
    function candidates() {
      const ws = m.q.toLowerCase().split(/\s+/).filter(Boolean);
      const list = Object.values(P).filter(p => p.id !== m.keep
        && (!ws.length || ws.every(w => `${p.first} ${p.last} ${p.nick}`.toLowerCase().includes(w))))
        .sort((a, b) => (b.last === keep.last) - (a.last === keep.last) || name(a).localeCompare(name(b))).slice(0, 40);
      return list.length ? list.map(p => h("button", { class: "pickrow", onclick: () => { m.absorb = p.id; renderMerge(); } },
        photoEl(p), h("span", {}, h("strong", {}, name(p)), h("span", { class: "small muted" }, desc(p) || "No details yet"))))
        : [h("div", { class: "small muted pad" }, "No one else found with that name.")];
    }
    dlg.replaceChildren(
      h("h2", { id: "dlg-title" }, "Is this person in the tree twice?"),
      h("p", { class: "muted" }, "Keeping ", h("strong", {}, name(keep)), ". Find the other copy to combine into them."),
      input,
      h("div", { id: "merge-list", class: "pick" }, ...candidates()),
      h("div", { class: "btnrow end" }, h("button", { onclick: closeMerge }, "Cancel")));
    return;
  }

  // step 2: compare and choose
  const keep = P[m.keep], absorb = P[m.absorb];
  const rows = MERGE_FIELDS.map(f => {
    const same = eq(f, keep, absorb);
    const sel = m.choice[f.k] || mergeDefault(f, keep, absorb);
    const editable = f.text && !same;
    const opt = (side, who) => h("button", {
      class: `cmpopt${!same && !editable && sel === side ? " on" : ""}${f.empty(f.get(who)) ? " empty" : ""}`,
      disabled: same, onclick: () => {
        if (editable) { m.text[f.k] = f.get(who); const inp = $(`#cmp-${f.k}`); if (inp) inp.value = f.get(who); }
        else { m.choice[f.k] = side; renderMerge(); }
      } }, f.show(f.get(who)));
    const final = (same || sel === "keep") ? f.get(keep) : f.get(absorb);
    const result = h("div", { class: "cmpresult" }, h("span", { class: "cmpres-lbl" }, "Will be saved as"),
      editable ? (() => { const inp = h("input", { id: `cmp-${f.k}`, type: "text", "aria-label": `${f.label}: will be saved as`,
        value: f.k in m.text ? m.text[f.k] : (f.empty(f.get(keep)) ? f.get(absorb) : f.get(keep)) });
        inp.addEventListener("input", () => { m.text[f.k] = inp.value; }); return inp; })()
      : h("div", { class: `cmpfinal${f.empty(final) ? " empty" : ""}` }, f.show(final)));
    return h("div", { class: `cmprow${same ? " same" : ""}${editable ? " text" : ""}` },
      h("div", { class: "cmplabel" }, f.label),
      opt("keep", keep), opt("absorb", absorb), result);
  });
  const diffs = MERGE_FIELDS.filter(f => !eq(f, keep, absorb)).length;

  dlg.replaceChildren(
    h("h2", { id: "dlg-title" }, "Combine two people into one"),
    h("div", { class: "cmphead" },
      h("button", { class: "ghost swap", title: "Swap which one is kept", onclick: swapMerge }, "⇄"),
      h("div", { class: "cmpwho keepcol" }, h("div", { class: "cmptag" }, "KEEP"), photoEl(keep), h("strong", {}, name(keep))),
      h("div", { class: "cmpwho" }, h("div", { class: "cmptag muted" }, "REMOVE"), photoEl(absorb), h("strong", {}, name(absorb))),
      h("div", { class: "cmpwho rescol" }, h("div", { class: "cmptag" }, "AFTER MERGE"), h("strong", {}, "Will be saved as"))),
    diffs ? h("p", { class: "small muted" }, "Tap a value to use it. Names and places can also be typed, pasted or dragged into the “Will be saved as” column. Photos, notes, phone and all family links are combined automatically.")
          : h("p", { class: "small muted" }, "These match. Photos, notes, phone and all family links will be combined."),
    h("div", { class: "cmp" }, ...rows),
    m.confirm
      ? h("div", { class: "warn" },
          h("div", {}, h("strong", {}, name(absorb)), " will be removed and folded into ", h("strong", {}, name(keep)),
            ". This can't be undone with the Undo button."),
          h("div", { class: "btnrow" },
            h("button", { class: "danger", disabled: m.busy, onclick: doMerge }, m.busy ? "Combining…" : "Yes, combine them"),
            h("button", { disabled: m.busy, onclick: () => { m.confirm = false; renderMerge(); } }, "Go back")))
      : h("div", { class: "btnrow end" },
          h("button", { onclick: () => { m.absorb = null; m.choice = {}; renderMerge(); } }, "← Pick someone else"),
          h("button", { onclick: closeMerge }, "Cancel"),
          h("button", { class: "primary", onclick: () => { m.confirm = true; renderMerge(); } }, `Combine, keep ${keep.first || "this one"}`)));
}

async function doMerge() {
  const m = S.merge, keep = P[m.keep], absorb = P[m.absorb];
  const fields = {};
  for (const f of MERGE_FIELDS) {
    const eqf = f.eq || ((x, y) => x === y);
    if (eqf(f.get(keep), f.get(absorb))) continue;
    let v;
    if (f.text && f.k in m.text) v = m.text[f.k];                       // typed / pasted / dragged
    else if (f.text) v = f.empty(f.get(keep)) ? f.get(absorb) : f.get(keep);  // default text winner
    else v = (m.choice[f.k] || mergeDefault(f, keep, absorb)) === "absorb" ? f.get(absorb) : f.get(keep);
    if (!eqf(v, f.get(keep))) fields[f.k] = v;                          // only send real changes
  }
  m.busy = true; renderMerge();
  try {
    await flushSaves();
    const res = await api("/tree/merge", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keep: m.keep, absorb: m.absorb, fields }) });
    closeMerge();
    if (S.focus === m.absorb) S.focus = res.merged;
    S.sel = res.merged;
    await refresh();
    seeTree(res.merged);
    toast(`Combined into ${res.name}.`);
  } catch (err) {
    m.busy = false;
    if (err instanceof LoginNeeded) return showLogin();
    renderMerge();
    toast(`Couldn't combine: ${err.message}`);
  }
}
function closeMerge() { hideDlg(); $("#dlg").classList.remove("wide"); S.merge = null; }


function linked(pid) {
  const ids = new Set([pid]);
  const pf = parentFam(pid); if (pf) [pf.f, pf.m].forEach(x => x && ids.add(x));
  for (const x of spouseFams(pid)) { const o = other(x, pid); if (o) ids.add(o); x.kids.forEach(k => ids.add(k)); }
  return ids;
}
function impliedGender(rel, base) {
  if (rel === "father") return "m";
  if (rel === "mother") return "f";
  if (rel === "spouse") return base.gender === "m" ? "f" : base.gender === "f" ? "m" : "";
  return null;
}

function renderAdd() {
  const A = S.add, base = P[A.pid], dlg = $("#dlg");
  const x = A.famId && FAMS.find(f => f.id === A.famId);
  const o = x && other(x, A.pid);
  const what = A.rel === "child" ? (o ? `child of ${base.first} and ${P[o].first}` : `child of ${base.first}`)
    : `${relWord(A.rel, base)} of ${base.first}`;
  const title = h("h3", { id: "dlg-title" }, `Add ${what}`);
  // 1) someone already in the tree
  const skip = linked(A.pid);
  const q = h("input", { id: "add-q", type: "search", placeholder: "Type a name to look for", autocomplete: "off" });
  const list = h("div", { class: "pick" });
  q.addEventListener("input", () => {
    const words = q.value.toLowerCase().split(/\s+/).filter(Boolean);
    const hits = !words.length ? [] : Object.values(P).filter(p => !skip.has(p.id) &&
      words.every(w => `${p.first} ${p.last} ${p.nick}`.toLowerCase().includes(w)));
    list.replaceChildren(...hits.map(p => h("div", { class: "row-p" },
      h("div", {}, h("strong", {}, name(p)), h("div", { class: "small muted" }, desc(p) || "No details yet")),
      h("button", { onclick: () => doAdd({ existing: p.id }) }, "Choose"))));
    if (words.length && !hits.length) list.append(h("div", { class: "small muted" }, "No one found. Add them as someone new below."));
  });
  // 2) someone new
  const first = h("input", { id: "add-first" }), last = h("input", { id: "add-last" });
  const ig = impliedGender(A.rel, base);
  let gender = ig ?? "";
  const genderEl = ig === null
    ? h("fieldset", { class: "full" }, h("legend", {}, "Male or female"), ...[["m", "Male"], ["f", "Female"]].map(([v, l]) => {
        const r = h("input", { type: "radio", name: "add-g", id: `add-g-${v}` });
        r.addEventListener("change", () => { gender = v; });
        return h("label", { class: "inline", for: r.id }, r, l);
      }))
    : ig ? h("div", { class: "small muted" }, `Will be saved as ${ig === "m" ? "male" : "female"}.`) : "";
  let bd = null;
  const bdOn = h("input", { id: "add-bd-on", type: "checkbox" });
  const bdBox = h("div", {}, dateInputs("add-bd", "Birthday", () => null, v => { bd = v; }));
  bdBox.hidden = true;
  bdOn.addEventListener("change", () => { bdBox.hidden = !bdOn.checked; });
  const warn = h("div", { id: "add-warn" });
  const submit = () => {
    const fn = first.value.trim(), ln = last.value.trim();
    if (!fn && !ln) { warn.replaceChildren(h("div", { class: "warn" }, "Please write a first or last name.")); first.focus(); return; }
    const dups = sameName(fn, ln);
    if (dups.length && !A.dupOk) {
      warn.replaceChildren(h("div", { class: "warn" },
        h("strong", {}, `There ${dups.length === 1 ? "is 1 person" : `are ${dups.length} people`} called ${[fn, ln].filter(Boolean).join(" ")} already. Is it one of these?`),
        ...dups.map(p => h("div", { class: "row-p" },
          h("div", {}, h("strong", {}, name(p)), h("div", { class: "small muted" }, desc(p) || "No details yet")),
          skip.has(p.id) ? h("span", { class: "small muted" }, "Already in this family") : h("button", { onclick: () => doAdd({ existing: p.id }) }, "Use this person"))),
        h("div", {}, h("button", { onclick: () => { A.dupOk = true; submit(); } }, "No, add as someone new"))));
      return;
    }
    doAdd({ new: { first: fn, last: ln, gender, birth: bdOn.checked && bd ? bd : null } });
  };
  dlg.replaceChildren(title,
    h("label", { for: "add-q" }, "Already in the tree?", q), list,
    h("hr"),
    h("strong", {}, "Or someone new"),
    h("div", { class: "grid2" }, field("First name", first), field("Last name", last), genderEl,
      h("div", { class: "full" }, h("label", { class: "inline", for: "add-bd-on" }, bdOn, "Add their birthday"), bdBox)),
    warn,
    h("div", { class: "btnrow" }, h("button", { class: "primary", onclick: submit }, "Add"), h("button", { onclick: closeDialog }, "Cancel")));
  q.focus();
}

async function doAdd(choice) {
  const A = S.add, base = P[A.pid];
  const buttons = [...$("#dlg").querySelectorAll("button")];
  buttons.forEach(b => { b.disabled = true; });
  setStatus("Saving…", "saving");
  try {
    await flushSaves();
    const res = await postJSON("/tree/relative", { person: A.pid, rel: A.rel, famId: A.famId, ...choice });
    const who = choice.existing ? P[choice.existing].first : (choice.new.first || choice.new.last);
    hideDlg(); S.add = null;
    S.newlyAdded = res.added;
    await refresh();
    S.newlyAdded = null;
    setStatus("Saved ✓");
    toast(`Saved: ${who} added as ${base.first}'s ${relWord(A.rel, base)}.`, res.undo);
  } catch (err) {
    if (err instanceof LoginNeeded) return showLogin();
    buttons.forEach(b => { b.disabled = false; });
    setStatus("Saved ✓");
    $("#add-warn")?.replaceChildren(h("div", { class: "warn" }, err.message));
  }
}

function renderAll() {
  renderTree(); renderPanel();
  if (!$("#editor").hidden) { if (S.stack.every(x => P[x])) renderEditor(); else closeEditor(); }
}
// ---------- start screen: nobody chosen yet ----------
function renderStart() {
  if (S.startShown) return;  // keep what they've typed while the page redraws
  S.startShown = true;
  const card = $("#startcard");
  const q = h("input", { id: "start-q", type: "search", placeholder: "Type a name", autocomplete: "off", "aria-label": "Type a name" });
  const list = h("div", { class: "pick" });
  q.addEventListener("input", () => {
    const words = q.value.toLowerCase().split(/\s+/).filter(Boolean);
    const hits = !words.length ? [] : Object.values(P).filter(p => words.every(w => `${p.first} ${p.last} ${p.nick}`.toLowerCase().includes(w)))
      .sort((a, b) => name(a).localeCompare(name(b))).slice(0, 30);
    list.replaceChildren(...hits.map(p => h("button", { class: "row-p pickbtn", onclick: () => seeTree(p.id) },
      photoEl(p), h("span", {}, h("strong", {}, name(p)), h("span", { class: "small muted" }, desc(p) || "No details yet")))));
    if (words.length && !hits.length) list.append(h("div", { class: "muted" }, "No one found with that name."));
  });
  const parts = [h("h2", {}, "Whose family tree would you like to see?"),
    h("label", { for: "start-q", class: "flabel" }, "Search for someone", q), list, recentSections()];
  if (canAdd()) {
    const form = newPersonForm();
    form.hidden = true;
    const open = h("button", { class: "pill", onclick: () => { open.hidden = true; form.hidden = false; form.querySelector("input").focus(); } }, "+ Add a new person");
    parts.push(h("div", { class: "startor" }, h("span", {}, "or")), open, form);
  }
  card.replaceChildren(h("div", { class: "startbox" }, parts));
  q.focus();
}

// "Recently viewed" (this device) and "Recently changed" (anyone, from Gramps), each hidden when empty.
function relTime(ts) {
  if (!ts) return "";
  const s = Date.now() / 1000 - ts, day = 86400;
  if (s < 3600) return "just now";
  if (s < day && new Date(ts * 1000).toDateString() === new Date().toDateString()) return "today";
  if (s < 2 * day) return "yesterday";
  if (s < 30 * day) return `${Math.floor(s / day)} days ago`;
  return new Date(ts * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
function recentCard(p, sub) {
  return h("button", { class: "recentcard", onclick: () => seeTree(p.id), title: `Open ${name(p)}'s family tree` },
    photoEl(p), h("span", {}, h("strong", {}, name(p)), h("span", { class: "small muted" }, sub)));
}
function recentSections() {
  const viewed = recentViewed().slice(0, 6);
  const viewedBox = h("section", { class: "recent", hidden: !viewed.length },
    h("h3", {}, "Recently viewed"), h("div", { class: "recentlist" }, viewed.map(id => recentCard(P[id], years(P[id]) || desc(P[id]) || " "))));
  const changedList = h("div", { class: "recentlist" }, h("span", { class: "small muted" }, "Loading…"));
  const changedBox = h("section", { class: "recent" }, h("h3", {}, "Recently changed"), changedList);
  api("/tree/recent").then(rows => {
    const items = rows.filter(r => P[r.id]).slice(0, 6);
    changedBox.hidden = !items.length;
    changedList.replaceChildren(...items.map(r => recentCard(P[r.id], [r.by && `by ${r.by}`, relTime(r.changed)].filter(Boolean).join(" · "))));
  }).catch(() => { changedBox.hidden = true; });
  return h("div", { class: "recentgrid" }, viewedBox, changedBox);
}

function newPersonForm() {
  const first = h("input", { id: "np-first" }), last = h("input", { id: "np-last" });
  let gender = "";
  const genderEl = h("fieldset", { class: "full" }, h("legend", {}, "Male or female"), ...[["m", "Male"], ["f", "Female"]].map(([v, l]) => {
    const r = h("input", { type: "radio", name: "np-g", id: `np-g-${v}` });
    r.addEventListener("change", () => { gender = v; });
    return h("label", { class: "inline", for: r.id }, r, l);
  }));
  let bd = null;
  const bdOn = h("input", { id: "np-bd-on", type: "checkbox" });
  const bdBox = h("div", {}, dateInputs("np-bd", "Birthday", () => null, v => { bd = v; }));
  bdBox.hidden = true;
  bdOn.addEventListener("change", () => { bdBox.hidden = !bdOn.checked; });
  const warn = h("div");
  let dupOk = false;
  const btn = h("button", { class: "primary", onclick: async () => {
    const fn = first.value.trim(), ln = last.value.trim();
    if (!fn && !ln) { warn.replaceChildren(h("div", { class: "warn" }, "Please write a first or last name.")); first.focus(); return; }
    const dups = sameName(fn, ln);
    if (dups.length && !dupOk) {
      warn.replaceChildren(h("div", { class: "warn" },
        h("strong", {}, `There ${dups.length === 1 ? "is 1 person" : `are ${dups.length} people`} called ${[fn, ln].filter(Boolean).join(" ")} already. Is it one of these?`),
        ...dups.map(p => h("div", { class: "row-p" },
          h("div", {}, h("strong", {}, name(p)), h("div", { class: "small muted" }, desc(p) || "No details yet")),
          h("button", { onclick: () => seeTree(p.id) }, "Open their tree"))),
        h("div", {}, h("button", { onclick: () => { dupOk = true; btn.click(); } }, "No, add as someone new"))));
      return;
    }
    btn.disabled = true; btn.textContent = "Saving…";
    try {
      const res = await postJSON("/tree/person", { first: fn, last: ln, gender, birth: bdOn.checked && bd ? bd : null });
      await loadGraph();
      seeTree(res.added);
      toast(`Saved: ${fn || ln} added. Now add their family.`);
      openEditor(res.added);
    } catch (err) {
      if (err instanceof LoginNeeded) return showLogin();
      btn.disabled = false; btn.textContent = "Add this person";
      warn.replaceChildren(h("div", { class: "warn" }, err.message));
    }
  } }, "Add this person");
  return h("div", { class: "newperson" },
    h("strong", {}, "Someone new"),
    h("div", { class: "grid2" }, field("First name", first), field("Last name", last), genderEl,
      h("div", { class: "full" }, h("label", { class: "inline", for: "np-bd-on" }, bdOn, "Add their birthday"), bdBox)),
    warn, h("div", { class: "btnrow" }, btn));
}

// ---------- start ----------
function gate(msg, ...kids) {
  const g = $("#gate");
  g.hidden = false;
  g.replaceChildren(h("div", { class: "gate-card" }, msg && h("p", {}, msg), ...kids));
}
function hideGate() { $("#gate").hidden = true; }
function showLogin(message) {
  const user = h("input", { id: "lg-user", autocomplete: "username", autocapitalize: "none" });
  const pass = h("input", { id: "lg-pass", type: "password", autocomplete: "current-password" });
  const err = h("div", { role: "status" }, message && h("div", { class: "warn" }, message));
  const btn = h("button", { class: "primary", type: "submit" }, "Log in");
  const form = h("form", { class: "login-form" },
    h("h2", {}, "🌳 Family Tree"),
    h("label", { for: "lg-user" }, "Your name", user),
    h("label", { for: "lg-pass" }, "Your password", pass), err, btn);
  form.onsubmit = async e => {
    e.preventDefault(); btn.disabled = true; btn.textContent = "Checking…";
    try { await login(user.value, pass.value); await start(); }
    catch (ex) { err.replaceChildren(h("div", { class: "warn" }, ex.message)); btn.disabled = false; btn.textContent = "Log in"; }
  };
  gate("", form);
  user.focus();
}
async function start() {
  gate("Loading the family tree…");
  try {
    ME = await api("/auth/me");
    await photoSession();
    await loadGraph();
  } catch (err) {
    if (err instanceof LoginNeeded) return showLogin();
    return gate(`Couldn't load the family tree: ${err.message}`, h("button", { onclick: start }, "Try again"));
  }
  S.role = ME.can_edit ? "editor" : ME.can_add ? "contributor" : "guest";
  if (ME.gramps_link) { const a = $("#menu-gramps"); a.href = ME.gramps_link.url; a.textContent = `${ME.gramps_link.label} ↗`; a.hidden = false; }
  const want = decodeURIComponent(location.hash.match(/^#\/p\/(.+)$/)?.[1] || "");
  S.focus = S.sel = P[want] ? want : null;
  if (S.focus) noteViewed(S.focus);
  hideGate();
  S.scrolledFor = null;
  rememberFocus();
  renderAll();
}
$("#logout").onclick = () => { auth.clear(); location.hash = ""; showLogin(); };
start();

