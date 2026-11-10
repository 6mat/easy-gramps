// Easy Gramps — "? Help": How to… for the screen you're on (its tasks first), as the login and Site settings allow
// (the words are in helptext.js). "👉 Show me" walks you through it: a bubble rings each button to tap, in turn.
import { $, ME, S, closeMenu, dateFormat, dateHint, fmtDate, h, named } from "./common.js";
import { hideDlg, showDlg } from "./editor.js";
import { isOwner } from "./me.js";
import { SCREENS, tasksFor } from "./helptext.js";

const DIGITS = { "y-m-d": "19500312", "m/d/y": "03121950", "mon d, y": "03121950" };
const ctx = () => ({
  role: S.role, owner: isOwner(), admin: (ME.role ?? 0) >= 5, history: (ME.role ?? 0) >= 3, reviews: ME.suggestions != null,
  check: !!ME.can_check, auto: (ME.site?.suggest_send || "auto") === "auto", talk: ME.site?.talk !== false,
  email: !!ME.chat_email, dms: ME.settings?.dms !== false, hide: new Set(ME.site?.hide || []), label: named,
  date: dateHint(), eg: fmtDate({ y: 1950, m: 3, d: 12 }), digits: DIGITS[dateFormat] || "12031950" });
const screen = () => (!$("#manage").hidden ? "manage" : !$("#chat").hidden ? "chat" : !$("#editor").hidden ? "editor" : "tree");
// "Tap **X**" → text with X in bold
const words = s => s.split(/\*\*(.+?)\*\*/).map((x, i) => (i % 2 ? h("b", {}, x) : x));

export function openHelp() {
  closeMenu(); stopTour();
  const here = screen(), all = tasksFor(ctx(), here);
  const list = h("div", { class: "howto" });
  const q = h("input", { type: "search", placeholder: "What do you want to do?", "aria-label": "Search the help", autocomplete: "off" });
  const draw = () => {
    const w = q.value.trim().toLowerCase();
    const hits = all.filter(t => !w || `${t.title} ${t.steps.join(" ")}`.toLowerCase().includes(w));
    const group = (title, items) => items.length ? [h("h4", {}, title), ...items.map(t => h("details", { open: !!w && hits.length < 4 },
      h("summary", {}, t.title), h("ol", {}, ...t.steps.map(s => h("li", {}, ...words(s)))),
      t.tour && h("button", { class: "pill", onclick: () => setTimeout(() => tour(t.tour)) }, "👉 Show me")))] : [];  // (after this click: it would close the menu)
    list.replaceChildren(...group(`On this screen: ${SCREENS[here]}`, hits.filter(t => t.at === here)),
      ...group(here === "tree" ? "Elsewhere" : "Everything else", hits.filter(t => t.at !== here)),
      hits.length ? "" : h("p", { class: "muted" }, "Nothing found. Try another word, or ask in the family chat."));
  };
  q.addEventListener("input", draw);
  draw();
  $("#dlg").replaceChildren(h("h3", { id: "dlg-title" }, "How to…"), q, list,
    h("div", { class: "btnrow" }, h("button", { class: "primary", onclick: hideDlg }, "Close")));
  showDlg(false);
  q.focus();
}

// ---------- 👉 Show me: one step at a time ----------
// The bubble says what to do and rings the button; tapping it moves on, and a later step that's already showing is
// skipped to (the editor already open, say). It never taps anything itself. ✕ Stop or Esc ends it.
let T = null;  // {steps, at, el, shown: the step drawn, bubble, timer}
const layer = () => ["#dlg-wrap", "#manage", "#chat", "#editor"].map(x => $(x)).find(x => !x.hidden);  // what's on top
const showing = el => el.getClientRects().length > 0 && (!layer() || layer().contains(el));
const find = sel => (sel && [...document.querySelectorAll(sel)].find(showing)) || null;

function tour(steps) {
  stopTour(); hideDlg();
  T = { steps, at: 0, el: null, shown: -1, bubble: h("div", { class: "tour", role: "status" }) };
  document.body.append(T.bubble);
  T.timer = setInterval(tick, 300);  // the next button may take a moment (the editor opening, the menu)
  tick();
}
function stopTour() {
  if (!T) return;
  clearInterval(T.timer); T.el?.classList.remove("helpglow"); T.bubble.remove(); T = null;
}
function next() {
  if (T.at === T.steps.length - 1) return finish();
  T.at++; tick();
}
function finish() {
  const was = T;
  clearInterval(T.timer); T.el?.classList.remove("helpglow"); T.el = null;
  T.bubble.replaceChildren(h("p", {}, "That's it ✓"), h("div", { class: "btnrow" }, h("button", { onclick: stopTour }, "Close")));
  place();
  setTimeout(() => { if (T === was) stopTour(); }, 3000);
}
function tick() {
  for (let i = T.steps.length - 1; i > T.at; i--) if (find(T.steps[i][0])) { T.at = i; break; }
  const el = find(T.steps[T.at][0]);
  if (el !== T.el) {
    T.el?.classList.remove("helpglow");
    T.el = el;
    if (el) { el.classList.add("helpglow"); el.scrollIntoView({ block: "nearest" }); }
  }
  if (T.shown !== T.at || !el !== T.lost) draw();  // (the "Can't see it?" line comes and goes)
  place();
}
function draw() {
  const [sel, say, mode] = T.steps[T.at], last = T.at === T.steps.length - 1;
  T.shown = T.at; T.lost = !T.el;
  T.bubble.replaceChildren(h("div", { class: "small muted" }, `Step ${T.at + 1} of ${T.steps.length}`), h("p", {}, ...words(say)),
    sel && !T.el && layer() ? h("p", { class: "small muted" }, "Can't see it? Go back first, with ← Back at the top.") : "",
    h("div", { class: "btnrow" }, (mode === "read" || !sel) && h("button", { class: "primary", onclick: next }, last ? "Done" : "Next ›"),
      h("button", { onclick: stopTour }, "✕ Stop")));
}
// Beside the ringed button (below, or above when there's no room), else at the bottom of the screen.
function place() {
  const b = T.bubble, r = T.el?.getBoundingClientRect(), gap = 12;
  b.classList.toggle("free", !r);
  if (!r) { b.style.top = b.style.left = ""; return; }
  const below = r.bottom + gap + b.offsetHeight < innerHeight;
  b.style.top = `${Math.max(8, below ? r.bottom + gap : r.top - gap - b.offsetHeight)}px`;
  b.style.left = `${Math.min(Math.max(8, r.left), innerWidth - b.offsetWidth - 8)}px`;
}
// Tapping the ringed button (any that matches: any person's box) moves on, once the page has done what the tap does.
document.addEventListener("click", e => {
  if (!T || e.target.closest(".tour")) return;
  const [sel, , mode] = T.steps[T.at];
  if (sel && mode !== "read" && e.target.closest(sel)) setTimeout(() => T && next());
}, true);
document.addEventListener("keydown", e => { if (e.key === "Escape") stopTour(); }, true);

document.addEventListener("click", e => { if (e.target.closest("[data-help]")) openHelp(); });
