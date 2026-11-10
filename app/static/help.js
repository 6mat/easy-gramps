// Easy Gramps — "? Help": How to… for the screen you're on (its tasks first), as the login and Site settings allow
// (the words are in helptext.js). "Show me" closes it and rings the button to tap for a few seconds.
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
  closeMenu();
  const here = screen(), all = tasksFor(ctx(), here);
  const list = h("div", { class: "howto" });
  const q = h("input", { type: "search", placeholder: "What do you want to do?", "aria-label": "Search the help", autocomplete: "off" });
  const draw = () => {
    const w = q.value.trim().toLowerCase();
    const hits = all.filter(t => !w || `${t.title} ${t.steps.join(" ")}`.toLowerCase().includes(w));
    const group = (title, items) => items.length ? [h("h4", {}, title), ...items.map(t => h("details", { open: !!w && hits.length < 4 },
      h("summary", {}, t.title), h("ol", {}, ...t.steps.map(s => h("li", {}, ...words(s)))),
      t.show && h("button", { class: "pill", onclick: () => setTimeout(() => showMe(t.show)) }, "👉 Show me")))] : [];
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

// Open what it's in (the menu, the chat), then ring the first one that's showing. (Run after the click that asked: a click
// outside the menu closes it.)
function showMe({ sel, menu, chat }) {
  hideDlg();
  if (chat && $("#chat").hidden) $("#chatbtn").click();
  if (menu && $("#menupop").hidden) $("#menubtn").click();
  const el = [...document.querySelectorAll(sel)].find(x => x.offsetParent || x.getClientRects().length);
  if (!el) return;
  el.scrollIntoView({ block: "nearest" });
  el.classList.add("helpglow");
  setTimeout(() => el.classList.remove("helpglow"), 4000);
}

document.addEventListener("click", e => { if (e.target.closest("[data-help]")) openHelp(); });
