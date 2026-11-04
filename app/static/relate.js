// Easy Gramps — 🔗 Trace relationship (the details panel; ☰ Menu: two people; Check the tree → Possible duplicates): pick someone ("You" first), then
// how they're related in Gramps' own words (main.py /tree/relation: every way, up to 15 generations back) and a chart of
// the route, worked out from the graph (checks.js): the common ancestors on top, a line down to each of the two. A long
// line folds its middle generations. Not by blood: the shortest route through marriages; nothing: a missing link, said so.
import { api } from "./auth.js";
import { $, FAMS, ME, P, closeMenu, h, matches, name, photoEl, searchWords, years } from "./common.js";
import { hitRows, searchKeys } from "./search.js";
import { seeTree } from "./tree.js";
import { hideDlg, showDlg } from "./editor.js";
import { myPerson } from "./me.js";
import { route, upTo } from "./checks.js";

let R = null;  // { a: whose panel it was opened from (null from the menu: picked first), go(id): see their tree }
const dlg = () => document.getElementById("dlg");

export function openRelate(a, b = null, go = null) {
  R = { a, go: go || (id => { hideDlg(); seeTree(id); }) };
  showDlg(true);
  if (b) show(a, b); else pick();
}
$("#menu-trace").onclick = () => { closeMenu(); openRelate(null); };

function pick() {
  const me = myPerson();
  const input = h("input", { id: "rel-q", type: "search", placeholder: "Search a name", autocomplete: "off", "aria-label": "Search a name" });
  const list = h("div", { class: "pick hits" });
  input.addEventListener("input", () => {
    const ws = searchWords(input.value);
    const found = ws.length ? Object.values(P).filter(p => p.id !== R.a && matches(p, ws)).sort((x, y) => name(x).localeCompare(name(y))).slice(0, 40) : [];
    list.replaceChildren(...(ws.length && !found.length ? [h("div", { class: "small muted pad" }, "No one found with that name.")]
      : hitRows(found, p => choose(p.id), "Choose")));
  });
  const first = !R.a, you = me && me !== R.a;
  const choose = id => first ? (R.a = id, pick()) : show(R.a, id);
  dlg().replaceChildren(
    h("h2", { id: "dlg-title" }, first ? "🔗 Trace relationship" : `🔗 How is ${name(P[R.a])} related to…`),
    first ? h("p", { class: "muted" }, "Pick the first person, then the second.") : "",
    you ? h("button", { class: "primary relme", onclick: () => first ? choose(me) : show(me, R.a) }, `👤 Me (${name(P[me])})`) : "",
    h("label", { for: input.id }, you ? "Or someone else" : "Someone in the tree", input), list,
    h("div", { class: "btnrow end" }, h("button", { onclick: hideDlg }, "Close")));
  searchKeys(input, list);
  (you ? dlg().querySelector(".relme") : input).focus();
}

async function show(a, b) {
  const [A, B] = [P[a], P[b]];
  const title = h("h2", { id: "dlg-title", tabindex: "-1" }, `🔗 ${name(B)} and ${a === myPerson() ? "you" : name(A)}`);
  const end = h("div", { class: "btnrow end" }, h("button", { onclick: pick }, "← Pick someone else"), h("button", { onclick: hideDlg }, "Close"));
  dlg().replaceChildren(title, h("p", { class: "muted", role: "status" }, "Working it out…"), end);
  let ways;
  try { ways = await api(`/tree/relation/${a}/${b}`); }
  catch (err) { return dlg().replaceChildren(title, h("div", { class: "warn" }, err.message), end); }
  if (!R || !dlg().contains(title)) return;  // (closed, or someone else picked meanwhile)
  const whose = a === myPerson() ? "your" : `${name(A)}'s`;
  const out = h("div");
  const draw = i => {
    const w = ways[i];
    out.replaceChildren(
      ways.length > 1 ? h("div", { class: "relways", role: "group", "aria-label": "Ways they're related" }, ...ways.map((x, j) =>
        h("button", { "aria-pressed": String(i === j), onclick: () => draw(j) }, x.say))) : "",
      h("p", { class: "relsay" }, h("strong", {}, name(B)), ` is ${whose} `, h("strong", {}, w.say), "."),
      chart(a, b, w.ancestors) || chain(a, b) || "");
  };
  const more = ways.length > 1 && h("p", { class: "small muted" }, `Related in ${ways.length} ways. That happens when relatives married each other; it can also mean someone is in the tree twice.`);
  if (ways.length) draw(0);
  else {
    const steps = route(FAMS, a, b), c = steps && chain(a, b, steps);
    out.replaceChildren(c ? h("p", { class: "relsay" }, steps.some(s => s.how === "spouse")
      ? "Not related by blood. They're linked through marriage:" : "Related, but further back than 15 generations:")
      : h("div", { class: "warn" }, h("strong", {}, "No link between them in the tree."),
        ` If they are family, a link is missing${ME.can_check ? ": ☰ Menu → Manage → Check the tree → Separate groups helps find it." : ". Tell an editor."}`), c || "");
  }
  dlg().replaceChildren(title, out, more || "", end);
  title.focus();
}

const box = (id, cls = "") => h("button", { class: `relbox ${cls}`, title: `See ${name(P[id])}'s tree`, onclick: () => R.go(id) },
  photoEl(P[id]), h("span", {}, h("strong", {}, name(P[id])), h("span", { class: "small muted" }, years(P[id]) || "")));
const FOLD = 5;  // a line longer than this shows its first and last ones and folds the rest
function column(ids, ends) {
  const col = h("div", { class: "relcol" });
  const one = id => box(id, ends[id] || "");
  const draw = all => col.replaceChildren(...(all || ids.length <= FOLD ? ids.map(one)
    : [one(ids[0]), h("button", { class: "relfold", onclick: () => draw(true) }, `⋮ ${ids.length - 3} more generations`), ...ids.slice(-2).map(one)]));
  draw(false);
  return col;
}

// Blood relatives: the common ancestor (and their husband or wife, when both are) on top, a line down to each.
function chart(a, b, ancestors) {
  const tops = new Set(ancestors.filter(x => P[x]));
  const up = [upTo(FAMS, a, tops), upTo(FAMS, b, tops)];
  if (!tops.size || !up[0] || !up[1]) return null;
  const top = [...new Set([up[0].at(-1), up[1].at(-1)])];
  const partner = FAMS.find(f => (f.f === top[0] && tops.has(f.m)) || (f.m === top[0] && tops.has(f.f)));
  if (top.length === 1 && partner) top.push(partner.f === top[0] ? partner.m : partner.f);
  const ends = { [a]: "a", [b]: "b" };
  const lines = up.map(u => u.slice(0, -1).reverse()).filter(l => l.length);
  const back = Math.max(up[0].length, up[1].length) - 1;
  return h("div", { class: "relchart" },
    h("p", { class: "small muted" }, `${top.length > 1 ? "Common ancestors" : "Common ancestor"}, ${back} generation${back > 1 ? "s" : ""} back:`),
    h("div", { class: "reltop" }, ...top.map(id => box(id, ends[id] || ""))),
    h("div", { class: `relcols n${lines.length}` }, ...lines.map(l => column(l, ends))));
}

// In-laws and the rest: the shortest route through any links, each step in words ("his wife", "her brother"…).
const WORD = { parent: ["father", "mother", "parent"], child: ["son", "daughter", "child"], spouse: ["husband", "wife", "husband or wife"] };
function chain(a, b, steps = route(FAMS, a, b)) {
  if (!steps) return null;
  const g = id => ({ m: 0, f: 1 })[P[id]?.gender] ?? 2;
  const step = (s, i) => [i ? h("div", { class: "relhow small muted" }, `↓ ${["his", "her", "their"][g(steps[i - 1].id)]} ${WORD[s.how][g(s.id)]}`) : "",
    box(s.id, s.id === a ? "a" : s.id === b ? "b" : "")];
  const col = h("div", { class: "relcol relchain" });
  const draw = all => col.replaceChildren(...(all || steps.length <= FOLD + 2 ? steps.flatMap(step) : [...steps.slice(0, 2).flatMap(step),
    h("button", { class: "relfold", onclick: () => draw(true) }, `⋮ ${steps.length - 5} more`), ...steps.slice(-3).flatMap((s, i) => step(s, steps.length - 3 + i))]));
  draw(false);
  return col;
}
