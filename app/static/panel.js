// Easy Gramps — The details panel beside the tree, and the dotted line from the selected box to it.
import { bookLinks } from "./docs.js";
import { api, LoginNeeded } from "./auth.js";
import { $, ME, P, S, byBirth, canAdd, canEdit, fieldName, fmtDate, h, kin, layout, name, other, parentFam, photoEl, spouseFams, spouseHeading, thumbUrl, grampsLink } from "./common.js";
import { REL, hidePanel, seeTree, select } from "./tree.js";
import { openEditor, toast, twiceWarn } from "./editor.js";
import { openDelete, openMerge } from "./merge.js";
import { openViewer } from "./photos.js";
import { showLogin } from "./start.js";
import { loginLine, meTag } from "./me.js";
import { messageButton, talkSection } from "./chat.js";
import { myWaiting, suggesting } from "./suggest.js";

// ---------- right panel ----------
async function loadDetails(id) {
  if (P[id]._details || P[id]._loading) return;
  P[id]._loading = true;
  try { Object.assign(P[id], await api(`/tree/details/${id}`), { _details: true }); }
  catch (err) { if (err instanceof LoginNeeded) return showLogin(); return toast(`Couldn't load details: ${err.message}`, false); }
  finally { if (P[id]) P[id]._loading = false; }
  if (S.sel === id) renderPanel();
}
function toggleMore(id) { S.more = !S.more; renderPanel(); if (S.more) loadDetails(id); }
const fromGraph = k => k.startsWith("r:") || k === "burial";  // the rest come with /tree/details

// One field of the layout for p: words, the relatives' buttons, or "" (nothing to show).
function shown(p, k, chips) {
  if (k.startsWith("r:")) { const ids = kin(p.id, k); return ids.length ? chips(ids) : ""; }
  if (k.startsWith("a:")) return [p[k], ...(p.also?.[k] || [])].filter(Boolean).join("; ");
  if (k.startsWith("e:")) {  // theirs first, then the others of that type (as a witness, godparent…: their part in brackets)
    const one = (date, place, what, role) => { const t = [fmtDate(date), place, what].filter(Boolean).join(", "); return t && role ? `${t} (${role})` : t; };
    return [one(p[`${k}.date`], p[`${k}.place`], p[`${k}.desc`]), ...(p.also?.[k] || []).map(x => one(x.date, x.place, x.desc, x.role))]
      .filter(Boolean).join("; ");
  }
  const all = (one, more) => [one, ...(more || [])].filter(Boolean);
  return { burial: p.burial, residence: all(p.residence, [p.residenceRest]).join(", "), work: all(p.work, p.otherWork).join("; "),
    education: all(p.education, p.otherEducation).join("; "), phone: p.phone, email: p.email, notes: all(p.notes, p.otherNotes).join("\n\n") }[k] || "";
}

export function renderPanel() {
  if (!S.focus || !P[S.sel]) return;
  if (S.review) { S.review.render(); drawSelink(); return; }  // the suggestions' list (suggest.js)
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
  const panel = $("#panel"), rows = where => layout().filter(r => r.where === where).flatMap(r => row(fieldName(r.k), shown(p, r.k, chips)));
  if (layout().some(r => r.where === "top" && !fromGraph(r.k))) loadDetails(p.id);
  panel.replaceChildren(
    h("div", { class: "ptop" },
      h("button", { class: "pill hide", onclick: hidePanel, title: "Hide this panel to give the tree more room" }, "Hide panel »"),
      canAdd() && h("button", { class: "pill edit", onclick: () => openEditor(p.id) }, S.role === "suggest" ? "✎ Suggest a change" : "✎ Edit person")),
    h("div", { class: "who" }, p.photos[0] && p.photos[0] === p.photo
      ? h("button", { class: "phbtn", title: "Show the photo bigger", "aria-label": `Show ${name(p)}'s photo bigger`, onclick: () => openViewer(p.photos, 0, name(p)) }, photoEl(p, true))
      : photoEl(p, true),
      h("div", {}, rel && h("div", { class: "muted small" }, rel), h("h2", {}, name(p)),
        p.nick && h("div", { class: "muted" }, `Called “${p.nick}”`), meTag(p), messageButton(p))),
    p.photos.length > 1 ? h("div", { class: "phstrip", role: "group", "aria-label": "Photos" },
      p.photos.map((m, i) => h("button", { title: "Show it bigger", "aria-label": `Photo ${i + 1} of ${p.photos.length}`, onclick: () => openViewer(p.photos, i, name(p)) },
        h("img", { src: thumbUrl(m, 96, p.crops?.[m]), alt: "", loading: "lazy" })))) : "",  // ("" not false: replaceChildren would print it)
    h("dl", { class: "kv" },
      row("Born", [fmtDate(p.birth), p.birthPlace].filter(Boolean).join(", ") || "Not known"),
      row("Passed away", p.deceased ? fmtDate(p.death) || "Date not known" : ""), ...rows("top")),
    famRow("Parents", parents),
    famRow(spouseHeading(p, spouses.length), spouses),
    ...[...new Set(spouses.filter((o, i) => spouses.indexOf(o) !== i))]
      .map(o => twiceWarn(p, o, spouseFams(p.id).filter(x => other(x, p.id) === o), renderPanel)),
    famRow("Children", kids),
    h("button", { class: "moretoggle", "aria-expanded": String(S.more), onclick: () => toggleMore(p.id) },
      S.more ? "Fewer details ▴" : "More details ▾"));
  if (S.more) {
    const more = rows("more"), locked = layout().some(r => r.see > 0 && (r.k === "phone" && p.phone || r.k === "email" && p.email));
    const any = more.length || p.contactHidden || p.books?.length;
    panel.append(h("div", { class: "details" },
      loginLine(p),
      h("dl", { class: "kv" }, ...more),
      ...bookLinks(p),
      locked ? h("div", { class: "private" }, "🔒 Not everyone sees phone and email.") : "",
      p.contactHidden ? h("div", { class: "private" }, "🔒 Phone and email are kept private.") : "",
      !any ? h("div", { class: "muted small" }, "No more details yet.") : "",
      canEdit() ? h("div", { class: "glinks small" }, h("span", { class: "muted" }, "Open in Full Gramps:"),
        ...[["person", p.gid, "this person"], ["event", p.gids.birth, "birth"], ["place", p.gids.birthPlace, "place of birth"],
          ["event", p.gids.death, "death"], ["event", p.gids.burial, "burial"], ["place", p.gids.burialPlace, "burial place"]]
          .map(([kind, gid, what]) => grampsLink(kind, gid, `${what} ↗`, `Open ${name(p)}'s ${what} in Full Gramps`))) : ""));
  }
  panel.append(myWaiting(p.id));  // (suggesters: what they suggested about them, each with Delete)
  if (ME.site?.talk !== false) panel.append(talkSection(p));  // the owner can turn it off (Site settings)
  if (canEdit() || suggesting()) panel.append(h("div", { class: "dupbar" },
    canEdit() && h("button", { class: "dupbtn", onclick: () => openMerge(p.id) }, "Duplicate profile? Merge."),
    p.sug !== "gone" && !S.review && h("button", { class: "danger delbtn", onclick: () => openDelete(p.id) }, "Delete this person")));
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
