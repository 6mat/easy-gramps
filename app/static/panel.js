// Easy Gramps — The details panel beside the tree, and the dotted line from the selected box to it.
import { api, LoginNeeded } from "./auth.js";
import { $, ME, P, S, byBirth, canAdd, canEdit, fmtDate, h, name, other, parentFam, photoEl, spouseFams } from "./common.js";
import { REL, hidePanel, seeTree, select } from "./tree.js";
import { openEditor, toast } from "./editor.js";
import { openMerge } from "./merge.js";
import { showLogin } from "./start.js";

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

export function renderPanel() {
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
export function drawSelink() {
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
