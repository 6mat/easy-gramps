// Easy Gramps — The tree: layout, lines, zoom and touch, overview map, quick card, full screen, menu, keys, search.
import { store } from "./auth.js";
import { $, P, S, byBirth, canAdd, canLink, desc, h, matches, name, other, parentFam, photoEl, searchWords, spouseFams, spouseWord, years } from "./common.js";
import { drawSelink, renderPanel } from "./panel.js";
import { closeEditor, openEditor } from "./editor.js";
import { renderAll, renderStart } from "./start.js";

// ---------- tree ----------
// Rows are generations: parents, the person (with siblings and spouses), children.
// A couple is joined by a solid line; children hang from the middle of their parents' line.
let BW = 204, BH = 84;
const CG = 52, SG = 18, UG = 48, RGAP = 118;
export let REL = {};
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

export function renderTree() {
  const empty = !S.focus;
  $(".treepane").classList.toggle("empty", empty);
  $(".main").classList.toggle("nopanel", empty || !S.panel);
  if (empty) {
    S.layout = null; S.pop = null;
    $("#tree-title").textContent = "Family tree";
    $("#tree-home").hidden = $("#tree-back").hidden = $("#tree-see").hidden = $("#show-panel").hidden = true;
    renderStart();
    drawSelink();  // no one selected now: clears the line to the details panel
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
    // Two wives who are sisters share one set of parents: draw them once, with a line down to each.
    const same = parUnits.find(u => u.fam?.id === opf.id);
    if (same) { if (!same.kids.includes(o)) same.kids.push(o); same.of?.push(o); continue; }
    parUnits.push({ fam: opf, members: [opf.f, opf.m].filter(Boolean), kids: [o], of: [o] });
  }
  for (const u of parUnits) if (!u.own) u.want = u.kids.reduce((t, k) => t + pos[k].x + BW / 2, 0) / u.kids.length;
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
          : { tag: `${cap(spouseWord(fp))}'s ${w}`, phrase: `${u.of.map(k => P[k].first).join(" and ")}'s ${w}` };  // box: "Wife's father"
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
  svg.innerHTML = d.join("");  // only numbers and our own class names (c0–c5): never names or places (#9)
}
// At most one redraw per frame: resize and scroll fire many times a second.
const perFrame = fn => { let queued = false; return () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; fn(); }); }; };
window.addEventListener("resize", perFrame(() => renderTree()));

export function select(id, fromClick) {
  S.sel = id; S.more = false;
  S.pop = fromClick && !S.panel ? id : null;
  renderTree(); renderPanel();
  if (fromClick) reveal(id);
}
export function rememberFocus() {
  history.replaceState(null, "", location.pathname + location.search + (S.focus ? `#/p/${S.focus}` : ""));
}
const RECENT_KEY = "eg_recent_viewed";
export function recentViewed() { try { return JSON.parse(store.get(RECENT_KEY) || "[]").filter(id => P[id]); } catch { return []; } }
export function noteViewed(id) { store.set(RECENT_KEY, JSON.stringify([id, ...recentViewed().filter(x => x !== id)].slice(0, 8))); }
export function seeTree(id) {
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
  // Only numbers go into this markup (#9).
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
  for (const ev of ["pointerup", "pointercancel", "lostpointercapture"]) mm.addEventListener(ev, () => { down = false; });
})();

// ----- side panel: hide it, bring it back with ⓘ; while hidden, a click shows a quick card -----
function showPanel() { S.panel = true; S.pop = null; layoutPanel(); }
export function hidePanel() { S.panel = false; layoutPanel(); }
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

// ---------- search ----------
$("#q").addEventListener("input", () => {
  const words = searchWords($("#q").value);
  const res = $("#results");
  if (!words.length) { res.hidden = true; return; }
  const hits = Object.values(P).filter(p => matches(p, words))
    .sort((a, b) => name(a).localeCompare(name(b)));
  res.replaceChildren(...(hits.length ? hits.map(p => h("button", { onclick: () => {
    res.hidden = true; $("#q").value = ""; seeTree(p.id);
  } }, h("strong", {}, name(p)), h("div", { class: "small muted" }, desc(p) || "No details yet")))
    : [h("div", { class: "small muted pad" }, "No one found with that name.")]));
  res.hidden = false;
});
document.addEventListener("click", e => { if (!e.target.closest(".search")) $("#results").hidden = true; });
