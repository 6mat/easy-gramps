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

function openHelp() {
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

// ---------- 👉 Show me: a guide, one step at a time ----------
// Everything but the button to tap is blurred (the veil: four panes around it, so it stays tappable); the bubble says
// what to do. Tapping that button moves on; with a screen open (the editor, chat, a pop-up), a later step already showing
// there is skipped to. A tap on the blur nudges the ring; a second one ends the guide, as do Exit and Esc. With no button to ring
// (any person will do, or it isn't on screen), the bubble pulses instead. It never taps anything itself. At the end,
// "Done ✓" goes by itself or with any tap. Steps: [selector, words, mode, what to do when it isn't on screen].
let T = null;  // {steps, at, el, shown: the step drawn, lost, done, bubble, veil, timer}
const layer = () => ["#dlg-wrap", "#manage", "#chat", "#editor"].map(x => $(x)).find(x => !x.hidden);  // what's on top
const showing = el => el.getClientRects().length > 0 && (!layer() || layer().contains(el));
const find = sel => (sel && [...document.querySelectorAll(sel)].find(showing)) || null;

function tour(steps) {
  stopTour(); hideDlg();
  const veil = h("div", { class: "tourveil", "aria-hidden": "true" }, ...[0, 1, 2, 3].map(() => h("div")));
  veil.addEventListener("click", e => { e.stopPropagation(); e.preventDefault(); if (++T.taps > 1) stopTour(); else nudge(); });  // (not to the page: it'd close the menu)
  T = { steps, at: 0, el: null, shown: -1, lost: null, taps: 0, veil, bubble: h("div", { class: "tour", role: "status" }) };
  document.body.append(veil, T.bubble);
  T.timer = setInterval(tick, 300);  // the next button may take a moment (the editor opening, the menu)
  T.watch = new MutationObserver(() => { if (!T.queued) T.queued = requestAnimationFrame(() => { if (T) { T.queued = 0; if (!T.done) tick(); } }); });
  T.watch.observe(document.body, { childList: true, subtree: true });  // a redrawn panel: ring its new button at once
  tick();
}
function stopTour() {
  if (!T) return;
  clearInterval(T.timer); T.watch.disconnect(); T.el?.classList.remove("helpglow"); T.bubble.remove(); T.veil.remove(); T = null;
}
function next() {
  if (T.at === T.steps.length - 1) return finish();
  T.at++; tick();
}
function finish() {
  const was = T;
  clearInterval(T.timer); T.el?.classList.remove("helpglow"); T.el = null; T.done = true;
  T.bubble.replaceChildren(h("p", { class: "tourdone" }, "Done ✓"));
  place();
  setTimeout(() => { if (T === was) stopTour(); }, 2500);
}
function nudge() {
  if (!T.el) return;
  T.el.classList.remove("helpglow"); void T.el.offsetWidth; T.el.classList.add("helpglow");  // the ring pulses again
}
function tick() {
  if (layer()) for (let i = T.steps.length - 1; i > T.at; i--) if (find(T.steps[i][0])) { T.at = i; break; }
  const [sel, , mode] = T.steps[T.at], el = mode === "any" ? null : find(sel);
  if (el !== T.el) {
    T.el?.classList.remove("helpglow");
    T.el = el;
    if (el) { el.classList.add("helpglow"); el.scrollIntoView({ block: "nearest" }); el.focus?.({ preventScroll: true }); }
  }
  const lost = !!sel && !(mode === "any" ? find(sel) : el);
  if (T.shown !== T.at || lost !== T.lost) { T.lost = lost; draw(); }  // (the "not on screen" line comes and goes)
  place();
}
function draw() {
  const [sel, say, mode, hint] = T.steps[T.at], last = T.at === T.steps.length - 1;  // (T.lost: from tick)
  T.shown = T.at; T.taps = 0;
  T.bubble.replaceChildren(
    h("div", { class: "tourhead" }, h("span", {}, `👉 Guide · ${T.at + 1} of ${T.steps.length}`), h("button", { class: "tourexit", onclick: stopTour }, "Exit")),
    h("p", {}, ...words(say)),
    sel && T.lost ? h("p", { class: "small muted" }, hint || (layer() ? "It isn't on this screen. Tap ← Back first, then try again." : "Can't see it yet. Close what's open, or scroll.")) : "",
    mode === "read" || !sel ? h("button", { class: "primary", onclick: next }, last ? "Done" : "Next ›") : "");
  T.bubble.classList.remove("helpglow");
  if (!T.el) { void T.bubble.offsetWidth; T.bubble.classList.add("helpglow"); }  // no ring on the page: the bubble is what to look at
}
// The bubble beside the ringed button (below, or above when there's no room), else at the bottom; the veil around it.
// No button on screen: no veil, so you can go and find it.
function place() {
  const b = T.bubble, r = T.el?.getBoundingClientRect(), gap = 12, pad = 8;
  b.classList.toggle("free", !r);
  if (r) {
    const below = r.bottom + pad + gap + b.offsetHeight < innerHeight;
    b.style.top = `${Math.max(8, below ? r.bottom + pad + gap : r.top - pad - gap - b.offsetHeight)}px`;
    b.style.left = `${Math.min(Math.max(8, r.left), innerWidth - b.offsetWidth - 8)}px`;
  } else b.style.top = b.style.left = "";
  T.veil.hidden = T.done || (!!T.steps[T.at][0] && !T.el);  // (and "any": nothing to single out)
  if (T.veil.hidden) return;
  const x1 = r ? r.left - pad : 0, y1 = r ? r.top - pad : 0, x2 = r ? r.right + pad : 0, y2 = r ? r.bottom + pad : 0;
  const [top, bottom, left, right] = T.veil.children;  // around the hole; no hole (a step with words only): top covers all
  Object.assign(top.style, { left: "0", top: "0", width: "100%", height: r ? `${Math.max(0, y1)}px` : "100%" });
  Object.assign(bottom.style, { left: "0", top: `${y2}px`, width: "100%", height: r ? `${Math.max(0, innerHeight - y2)}px` : "0" });
  Object.assign(left.style, { left: "0", top: `${y1}px`, width: `${Math.max(0, x1)}px`, height: r ? `${y2 - y1}px` : "0" });
  Object.assign(right.style, { left: `${x2}px`, top: `${y1}px`, width: `${Math.max(0, innerWidth - x2)}px`, height: r ? `${y2 - y1}px` : "0" });
}
// Tapping the ringed button (any that matches: any person's box) moves on, once the page has done what the tap does.
document.addEventListener("click", e => {
  if (!T) return;
  if (T.done) return stopTour();  // "Done ✓": any tap closes it
  if (e.target.closest(".tour")) return;
  const [sel, , mode] = T.steps[T.at];
  const at = T.at;  // (unless it has moved on by itself meanwhile: the screen it opened has the next button)
  if (sel && mode !== "read" && e.target.closest(sel)) setTimeout(() => T?.at === at && next());
}, true);
document.addEventListener("keydown", e => { if (e.key === "Escape") stopTour(); }, true);
addEventListener("scroll", () => T && place(), { capture: true, passive: true });  // keep the hole on the button
addEventListener("resize", () => T && place());

document.addEventListener("click", e => { if (e.target.closest("[data-help]")) openHelp(); });
