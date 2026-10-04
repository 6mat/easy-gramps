// Easy Gramps — Family data and small helpers shared by every part of the page (depends only on auth.js).
import { api, BASE, photoSession } from "./auth.js";

// ---------- family data ----------
export const P = {}, FAMS = [];
export const ME = {};  // the logged-in user (from /auth/me), filled in by start()
export async function loadGraph() {
  const g = await api("/tree/graph");
  for (const k of Object.keys(P)) delete P[k];
  for (const [id, p] of Object.entries(g.people)) P[id] = { residence: "", residenceRest: "", phone: "", email: "", notes: "", otherNotes: [], ...p };
  FAMS.length = 0; FAMS.push(...g.families);
}


export const S = { focus: null, sel: null, history: [], scrolledFor: null, zoom: 1, fit: true, panel: true, pop: null, big: false, full: false, role: "guest", stack: [], add: null, more: false, edMore: false, menu: null, merge: null };

// ---------- helpers ----------
export const $ = s => document.querySelector(s);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function h(tag, attrs = {}, ...kids) {
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
// Search: everyone whose first name, last name or nickname contains every word typed.
export const searchWords = text => text.toLowerCase().split(/\s+/).filter(Boolean);
export const matches = (p, words) => words.every(w => `${p.first} ${p.last} ${p.nick}`.toLowerCase().includes(w));
// People already in the tree with the name being typed: match each part that was given.
export const sameName = (first, last) => Object.values(P).filter(p =>
  (!first || p.first.toLowerCase() === first.toLowerCase()) && (!last || p.last.toLowerCase() === last.toLowerCase()));
export const canAdd = () => S.role !== "guest";
export const canEdit = () => S.role === "editor";
export const canLink = () => canEdit();  // Gramps lets only editors link people into a family (Contributors can only add)
export const name = p => [p.first, p.last].filter(Boolean).join(" ") || "(no name)";
// Their parents' family: the first in Gramps' own order (the server uses the same one when adding a parent).
export const parentFam = id => FAMS.find(f => f.id === P[id]?.pfams?.[0]) || FAMS.find(f => f.kids.includes(id));
// A person's own families in marriage order (1st husband or wife first), then any the order doesn't list.
export const spouseFams = id => {
  const mine = f => f && (f.f === id || f.m === id);
  const own = (P[id]?.fams || []).map(fid => FAMS.find(f => f.id === fid)).filter(mine);
  return [...own, ...FAMS.filter(f => mine(f) && !own.includes(f))];
};
export const other = (f, id) => (f.f === id ? f.m : f.f);
export const byBirth = ids => [...ids].sort((a, b) => (P[a].birth?.y ?? 9999) - (P[b].birth?.y ?? 9999));
export const fmtDate = d => !d ? "" : d.m && d.d ? `${d.d} ${MON[d.m - 1]} ${d.y}` : String(d.y);
export function years(p) {
  const b = p.birth?.y, d = p.death?.y;
  return b || d ? `${b || "?"} – ${d || (p.deceased ? "?" : "")}` : "";
}
export function desc(p) {
  const pf = parentFam(p.id);
  const par = pf && (P[pf.f] || P[pf.m]);
  const word = p.gender === "m" ? "son" : p.gender === "f" ? "daughter" : "child";
  return [years(p), par && `${word} of ${name(par)}`, p.birthPlace].filter(Boolean).join(" · ");
}
// Stand-in "photos" are soft gradients; people without a photo get initials on a tint picked from their name.
const TINTS = [["#dbe6f2", "#9fbbd8"], ["#dcefe9", "#8cc3b4"], ["#f3e3d2", "#d9a878"], ["#ebdff0", "#b995c7"], ["#f4dde2", "#d494a3"], ["#e4ebd8", "#a7ba86"]];
const tint = p => TINTS[[...(p.first + p.last)].reduce((n, ch) => n + ch.charCodeAt(0), 0) % TINTS.length];
export function photoEl(p, big) {
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
export const spouseWord = p => (p.gender === "m" ? "wife" : p.gender === "f" ? "husband" : "husband or wife");
export const relWord = (rel, base) => rel === "spouse" ? spouseWord(base) : rel;

export function postJSON(path, body) {
  return api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
