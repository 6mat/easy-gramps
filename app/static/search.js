// Easy Gramps — Search results, shared by the start screen and the top bar: photo and name, an ⓘ
// preview under the row (born, parents, wife or husband, children), keys (↓ ↑ through the results,
// → preview, ← close it, Enter opens their tree) and a "No one found" you can't miss.
import { P, byBirth, canAdd, desc, fmtDate, h, matches, name, other, parentFam, photoEl, searchWords, spouseFams } from "./common.js";

const LIMIT = 30;

// Rows for these people (the Add pop-up's and the merge dialog's lists too): a tap on the row, or the
// preview's button (`action`, e.g. "Choose"), calls open(p).
export function hitRows(people, open, action = "See their tree →") { return people.map(p => hit(p, open, action)); }

// Fill `list` with the people matching `text`. open(p): see their tree; addNew(text): add someone of that name.
export function showHits(list, text, { open, addNew }) {
  const words = searchWords(text);
  if (!words.length) { list.replaceChildren(); return; }
  const hits = Object.values(P).filter(p => matches(p, words)).sort((a, b) => name(a).localeCompare(name(b)));
  list.replaceChildren(...hits.slice(0, LIMIT).map(p => hit(p, open)));
  if (hits.length > LIMIT) list.append(h("div", { class: "small muted pad" }, `And ${hits.length - LIMIT} more: type more of the name.`));
  if (!hits.length) {
    const said = text.trim();
    list.append(h("div", { class: "nohit", role: "status" },
      h("strong", {}, `No one called “${said}” in the tree.`),
      h("span", {}, "Check the spelling, or try just the first name."),
      canAdd() && addNew && h("button", { class: "addnew", onclick: () => addNew(said) }, `+ Add “${said}” as a new person`)));
  }
}

function hit(p, open, action = "See their tree →") {
  const main = h("button", { class: "pickbtn hitmain", onclick: () => open(p) },
    photoEl(p), h("span", {}, h("strong", {}, name(p)), h("span", { class: "small muted" }, desc(p) || "No details yet")));
  const info = h("button", { class: "info", "aria-expanded": "false", "aria-label": `Preview ${name(p)}`, title: "Preview" }, "ⓘ");
  const card = h("div", { class: "preview", hidden: true });
  const row = h("div", { class: "hit" }, h("div", { class: "hitrow" }, main, info), card);
  row.toggle = on => {
    on ??= card.hidden;
    if (on) {
      row.parentElement?.querySelectorAll(".hit").forEach(r => r !== row && r.toggle(false));  // one at a time
      if (!card.childElementCount) card.append(...preview(p, open, action));
    }
    card.hidden = !on; info.setAttribute("aria-expanded", String(on));
    if (on) row.scrollIntoView({ block: card.offsetHeight + 60 > innerHeight / 2 ? "start" : "nearest" });  // keep the name in sight
  };
  info.onclick = e => { e.stopPropagation(); row.toggle(); };
  return row;
}

function preview(p, open, action) {
  const pf = parentFam(p.id);
  const fams = spouseFams(p.id);
  const parents = pf ? [pf.f, pf.m].filter(x => P[x]) : [];
  const spouses = fams.map(f => other(f, p.id)).filter(x => P[x]);
  const kids = byBirth([...new Set(fams.flatMap(f => f.kids))].filter(x => P[x]));
  const names = ids => ids.slice(0, 8).map(id => name(P[id])).join(", ") + (ids.length > 8 ? ` and ${ids.length - 8} more` : "");
  const line = (label, text) => text && h("div", {}, h("span", { class: "muted" }, `${label}: `), text);
  const spouseLabel = p.gender === "m" ? (spouses.length > 1 ? "Wives" : "Wife")
    : p.gender === "f" ? (spouses.length > 1 ? "Husbands" : "Husband") : "Husband or wife";
  return [photoEl(p, true), h("div", { class: "pvtext" },
    p.nick && h("div", { class: "small muted" }, `Known as ${p.nick}`),
    line("Born", [fmtDate(p.birth), p.birthPlace].filter(Boolean).join(", ")),
    p.deceased && line("Passed away", fmtDate(p.death) || "date not known"),
    line("Parents", names(parents)), line(spouseLabel, names(spouses)), line("Children", names(kids)),
    !parents.length && !spouses.length && !kids.length && h("div", { class: "muted" }, "No family added yet."),
    h("div", {}, h("button", { class: "primary", onclick: () => open(p) }, action)))];
}

// Keys: ↓ from the search box into the results, ↓ ↑ between them (↑ from the first: back to the box),
// → shows the preview, ← closes it, Enter opens their tree, Esc goes back to the box.
export function searchKeys(input, list, onEscape) {
  const mains = () => [...list.querySelectorAll(".hitmain")];
  input.addEventListener("keydown", e => {
    if (e.key === "ArrowDown" && mains()[0]) { e.preventDefault(); mains()[0].focus(); }
  });
  list.addEventListener("keydown", e => {
    const row = e.target.closest(".hit");
    if (!row) return;
    const ms = mains(), i = ms.indexOf(row.querySelector(".hitmain"));
    if (e.key === "ArrowDown") ms[i + 1]?.focus();
    else if (e.key === "ArrowUp") (ms[i - 1] || input).focus();
    else if (e.key === "ArrowRight") row.toggle(true);
    else if (e.key === "ArrowLeft") { row.toggle(false); ms[i].focus(); }
    else if (e.key === "Escape") { input.focus(); onEscape?.(); }
    else return;
    e.preventDefault(); e.stopPropagation();
  });
}
