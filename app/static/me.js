// Easy Gramps — "Find me": each login linked to its own person in the tree. Anyone with a login can link
// themselves (no approval; one login per person); editors see who is linked and can unlink.
import { api, auth, LoginNeeded, SHARED, store } from "./auth.js";
import { $, ME, P, canEdit, closeMenu, fmtDate, h, matches, name, parentFam, photoEl, searchWords } from "./common.js";
import { hitRows, searchKeys } from "./search.js";
import { hideDlg, showDlg, toast } from "./editor.js";
import { seeTree } from "./tree.js";
import { renderPanel } from "./panel.js";
import { showLogin } from "./start.js";

const LATER = "eg_findme_later";  // "Not now" on the start screen, this device only
let LOGINS = {};                  // editors: person -> login name

export const myPerson = () => (P[ME.settings?.person] ? ME.settings.person : null);

// After login: editors get who is linked to which login (for "Linked to the login …" in the panel).
export async function loadLogins() {
  LOGINS = {};
  if (!canEdit()) return;
  try { LOGINS = await api("/tree/logins"); renderPanel(); } catch { /* the panel just doesn't say */ }
}

const send = (method, path, body) => api(path, { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) });
function failed(err, where) {
  if (err instanceof LoginNeeded) return showLogin();
  where ? where.replaceChildren(h("div", { class: "warn" }, err.message)) : toast(`Not saved: ${err.message}`);
}
// Gramps Web's own "home person" is kept in each browser, per tree (localStorage grampsjs_settings_tree →
// {tree: {homePerson: Gramps ID}}). On the same site (shared login) "Find me" sets it too: always when you say
// "Yes, this is me", and on another device the first time, unless a home person was picked there already.
export function grampsHome(force = false) {
  const id = myPerson();
  if (!SHARED || !id || !P[id].gid || !auth.access) return;
  try {
    const tree = JSON.parse(atob(auth.access.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).tree || "unknown";
    const all = JSON.parse(localStorage.getItem("grampsjs_settings_tree") || "{}") || {};
    if (!force && all[tree]?.homePerson) return;
    all[tree] = { ...all[tree], homePerson: P[id].gid };
    localStorage.setItem("grampsjs_settings_tree", JSON.stringify(all));
  } catch { /* Gramps Web keeps its own choice */ }
}
function changed(settings) {
  ME.settings = settings;
  renderMeBox(); renderMenuMe(); renderPanel();
  loadLogins();  // (editors: the panel's "Linked to the login …")
}

// ---------- start screen: "Are you in this family tree?", or a shortcut to your own tree ----------
export function meBox() { return h("div", { id: "mebox" }, ...meBoxParts()); }
function renderMeBox() { $("#mebox")?.replaceChildren(...meBoxParts()); }
function meBoxParts() {
  const mine = myPerson();
  if (mine) return [h("button", { class: "recentcard mecard", onclick: () => seeTree(mine), title: "Open your own family tree" },
    photoEl(P[mine]), h("span", {}, h("strong", {}, "Your family tree"), h("span", { class: "small muted" }, name(P[mine]))))];
  if (store.get(LATER)) return [];
  return [h("div", { class: "mebanner" }, h("span", { class: "wave", "aria-hidden": "true" }, "👋"),
    h("div", {}, h("strong", {}, "Are you in this family tree?"),
      h("div", { class: "small" }, "Find yourself, so your own family tree is one tap away.")),
    h("div", { class: "btnrow" }, h("button", { class: "primary", onclick: () => openFindMe() }, "Find me"),
      h("button", { onclick: () => { store.set(LATER, "1"); renderMeBox(); } }, "Not now")))];
}

// ---------- ☰ Menu → You ----------
export function renderMenuMe() {
  const box = $("#menu-me");
  if (!box) return;
  const mine = myPerson();
  box.replaceChildren(...(mine
    ? [h("div", { class: "small" }, h("span", { class: "muted" }, "You are "), h("strong", {}, name(P[mine]))),
      h("div", { class: "btnrow" }, h("button", { onclick: () => { closeMenu(); openFindMe(); } }, "Change"),
        h("button", { onclick: unlinkMe }, "That's not me"))]
    : [h("button", { onclick: () => { closeMenu(); openFindMe(); } }, "Find yourself in the tree")]));
  if (ME.chat_email) {  // the chat's daily email, when the server can send email
    const sw = h("input", { type: "checkbox", class: "sw", checked: ME.settings?.emails !== false });
    sw.onchange = async () => {
      try { ME.settings = { ...ME.settings, ...(await send("PUT", "/auth/settings", { emails: sw.checked })) }; }
      catch (err) { sw.checked = !sw.checked; failed(err); }
    };
    box.append(h("label", { class: "swrow" }, "Email me when a chat message waits for me a day", sw));
  }
}
async function unlinkMe() {
  closeMenu();
  try { changed(await send("DELETE", "/auth/me/person")); toast("Done: your login isn't linked to anyone now."); }
  catch (err) { failed(err); }
}

// ---------- the dialog: find yourself, then "Is this you?" ----------
export function openFindMe() {
  showDlg(false);
  findStep(ME.full_name || "");
}
function findStep(text) {
  const q = h("input", { id: "me-q", type: "search", value: text, placeholder: "Type your name", autocomplete: "off", "aria-label": "Type your name" });
  const list = h("div", { class: "pick hits" });
  const show = () => {
    const words = searchWords(q.value);
    const hits = words.length ? Object.values(P).filter(p => matches(p, words)).sort((a, b) => name(a).localeCompare(name(b))) : [];
    list.replaceChildren(...hitRows(hits.slice(0, 30), p => confirmStep(p, q.value), "This is me"));
    if (words.length && !hits.length) list.append(h("div", { class: "nohit", role: "status" },
      h("strong", {}, `No one called “${q.value.trim()}” in the tree.`),
      h("span", {}, "Check the spelling, or try just your first name. Not in the tree yet? Ask an editor to add you.")));
  };
  q.addEventListener("input", show);
  searchKeys(q, list);
  $("#dlg").replaceChildren(h("h3", { id: "dlg-title" }, "Find yourself in the tree"),
    h("p", { class: "muted" }, "Type your name, then tap yourself. Not sure it's you? Tap ⓘ to see their family."),
    q, list, h("div", { class: "btnrow end" }, h("button", { onclick: hideDlg }, "Cancel")));
  show();
  q.focus();
}
function confirmStep(p, text) {
  const pf = parentFam(p.id), parents = pf ? [pf.f, pf.m].filter(x => P[x]).map(x => name(P[x])) : [];
  const say = h("div", { class: "small muted", role: "status" }, "Picked the wrong person? Change it any time in ☰ Menu, or ask an editor.");
  const yes = h("button", { class: "primary", onclick: async () => {
    yes.disabled = true;
    try {
      changed(await send("PUT", "/auth/me/person", { person: p.id }));
      grampsHome(true);  // Gramps Web opens on them too (this device)
      hideDlg();
      toast(`Saved ✓ You are ${name(p)}.`);
    } catch (err) { yes.disabled = false; failed(err, say); }
  } }, "Yes, this is me");
  $("#dlg").replaceChildren(h("h3", { id: "dlg-title" }, "Is this you?"),
    h("div", { class: "mewho" }, photoEl(p, true), h("div", {}, h("strong", { class: "mename" }, name(p)),
      p.birth || p.birthPlace ? h("div", { class: "muted" }, `Born ${[fmtDate(p.birth), p.birthPlace].filter(Boolean).join(", ")}`) : "",
      parents.length ? h("div", { class: "muted small" }, `Parents: ${parents.join(" and ")}`) : "")),
    h("p", {}, "Your login will be linked to this person, so your own family tree is one tap away from the start screen."),
    say,
    h("div", { class: "btnrow end" }, h("button", { onclick: () => findStep(text) }, "No, go back"), yes));
  yes.focus();
}

// ---------- details panel ----------
// Under the name: "This is you" on your own person.
export function meTag(p) {
  return p.id === myPerson() ? h("div", { class: "metag small" }, "👤 This is you") : "";
}
// More details, editors only: which login is linked to this person, with Unlink (two-step).
export function loginLine(p) {
  const login = canEdit() && LOGINS[p.id];
  if (!login) return "";
  const line = h("div", { class: "small loginline" });
  const ask = () => line.replaceChildren(h("span", {}, `Unlink the login “${login}” from ${name(p)}?`),
    h("span", { class: "btnrow" }, h("button", { class: "danger", onclick: unlink }, "Yes, unlink"), h("button", { onclick: plain }, "Cancel")));
  const plain = () => line.replaceChildren(h("span", { class: "muted" }, "Linked to the login "), h("strong", {}, login), " · ",
    h("button", { class: "linkish", onclick: ask }, "Unlink"));
  async function unlink() {
    try {
      await send("DELETE", `/tree/logins/${encodeURIComponent(p.id)}`);
      delete LOGINS[p.id];
      if (p.id === ME.settings?.person) changed({ ...ME.settings, person: undefined }); else renderPanel();
      toast(`Done: ${name(p)} isn't linked to a login now.`);
    } catch (err) { failed(err); }
  }
  plain();
  return line;
}
