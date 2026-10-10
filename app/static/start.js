// Easy Gramps — The start screen (search, recently viewed/changed, add a new person), login and loading.
import { api, auth, BASE, GRAMPS, login, LoginNeeded, onLoginChange, photoSession, SHARED } from "./auth.js";
import { $, ME, P, S, canAdd, desc, fmtDate, h, loadGraph, name, parseView, photoEl, postJSON, years } from "./common.js";
import { searchKeys, showHits } from "./search.js";
import { noteViewed, recentViewed, rememberFocus, renderTree, seeTree, useSettings } from "./tree.js";
import { renderPanel } from "./panel.js";
import { closeEditor, flushSaves, openEditor, renderEditor, restoreView, someoneNew, toast } from "./editor.js";

export function renderAll() {
  renderTree(); renderPanel();
  if (!$("#editor").hidden) { if (S.stack.every(x => P[x])) renderEditor(); else closeEditor(); }
}
// ---------- start screen: nobody chosen yet ----------
export function renderStart() {
  if (S.startShown) return;  // keep what they've typed while the page redraws
  S.startShown = true;
  const card = $("#startcard");
  const q = h("input", { id: "start-q", type: "search", placeholder: "Type a name", autocomplete: "off", "aria-label": "Type a name" });
  const list = h("div", { class: "pick hits" });
  q.addEventListener("input", () => showHits(list, q.value, { open: p => seeTree(p.id), addNew: startAdd }));
  searchKeys(q, list);
  const parts = [h("h2", {}, "Whose family tree would you like to see?"),
    h("label", { for: "start-q", class: "flabel" }, "Search for someone", q), list, recentSections()];
  addForm = null;
  if (canAdd()) {
    const form = newPersonForm();
    form.hidden = true;
    const open = h("button", { class: "pill", onclick: () => addForm() }, "+ Add a new person");
    addForm = text => {
      open.hidden = true; form.hidden = false;
      if (text) form.fill(text);
      form.scrollIntoView({ block: "nearest" });
      form.querySelector("input").focus();
    };
    parts.push(h("div", { class: "startor" }, h("span", {}, "or")), open, form);
  }
  card.replaceChildren(h("div", { class: "startbox" }, parts));
  q.focus();
}
// "+ Add … as a new person" from a search that found no one: the start screen's form, with that name.
let addForm = null;
export function startAdd(text) { addForm?.(text); }

// "Recently viewed" (this device) and "Recently changed" (anyone, from Gramps), each hidden when empty.
function relTime(ts) {
  if (!ts) return "";
  const s = Date.now() / 1000 - ts, day = 86400;
  if (s < 3600) return "just now";
  if (s < day && new Date(ts * 1000).toDateString() === new Date().toDateString()) return "today";
  if (s < 2 * day) return "yesterday";
  if (s < 30 * day) return `${Math.floor(s / day)} days ago`;
  const t = new Date(ts * 1000);
  return fmtDate({ y: t.getFullYear(), m: t.getMonth() + 1, d: t.getDate() });
}
function recentCard(p, sub) {
  return h("button", { class: "recentcard", onclick: () => seeTree(p.id), title: `Open ${name(p)}'s family tree` },
    photoEl(p), h("span", {}, h("strong", {}, name(p)), h("span", { class: "small muted" }, sub)));
}
function recentSections() {
  const viewed = recentViewed().slice(0, 6);
  const viewedBox = h("section", { class: "recent", hidden: !viewed.length },
    h("h3", {}, "Recently viewed"), h("div", { class: "recentlist" }, viewed.map(id => recentCard(P[id], years(P[id]) || desc(P[id]) || " "))));
  const changedList = h("div", { class: "recentlist" }, h("span", { class: "small muted" }, "Loading…"));
  const changedBox = h("section", { class: "recent" }, h("h3", {}, "Recently changed"), changedList);
  api("/tree/recent").then(rows => {
    const items = rows.filter(r => P[r.id]).slice(0, 6);
    changedBox.hidden = !items.length;
    changedList.replaceChildren(...items.map(r => recentCard(P[r.id], [r.by && `by ${r.by}`, relTime(r.changed)].filter(Boolean).join(" · "))));
  }).catch(() => { changedBox.hidden = true; });
  return h("div", { class: "recentgrid" }, viewedBox, changedBox);
}

// "Someone new": name, Male/Female (unless already known) and birthday, plus the "is it one of these?"
// check. Shared by the Add dialog and the start screen's "Add a new person".
function newPersonForm() {
  const nw = someoneNew("np", null);
  let dupOk = false;
  const btn = h("button", { class: "primary", onclick: async () => {
    const person = nw.check(dupOk, p => h("button", { onclick: () => seeTree(p.id) }, "Open their tree"), () => { dupOk = true; btn.click(); });
    if (!person) return;
    btn.disabled = true; btn.textContent = "Saving…";
    try {
      const res = await postJSON("/tree/person", person);
      await loadGraph();
      seeTree(res.added);
      toast(`Saved: ${person.first || person.last} added. Now add their family.`);
      openEditor(res.added);
    } catch (err) {
      if (err instanceof LoginNeeded) return showLogin();
      btn.disabled = false; btn.textContent = "Add this person";
      nw.say(err.message);
    }
  } }, "Add this person");
  const form = h("div", { class: "newperson" }, h("strong", {}, "Someone new"), nw.fields, nw.warn, h("div", { class: "btnrow" }, btn));
  form.fill = nw.fill;
  return form;
}

// ---------- start ----------
function gate(msg, ...kids) {
  const g = $("#gate");
  g.hidden = false;
  g.replaceChildren(h("div", { class: "gate-card" }, msg && h("p", {}, msg), ...kids));
}
function hideGate() { $("#gate").hidden = true; }
// ---------- login: Gramps Web's sign-in buttons (e.g. Google) and/or name + password ----------
let loginShown = false, waiter = null;  // waiter: set while a sign-in window is open
let options = null;                     // what Gramps Web offers, asked once
async function loginOptions() {
  if (!options) {
    try { const r = await fetch(`${BASE}/auth/options`); options = r.ok ? await r.json() : null; } catch { /* keep the default */ }
  }
  return options || { password: true, providers: [] };
}
export async function showLogin(message) {
  loginShown = true; waiter = null;
  const { password, providers } = await loginOptions();
  if (!loginShown) return;  // logged in meanwhile (in Gramps Web or another tab): the tree is loading
  const sso = SHARED ? providers.filter(p => p.id) : [];  // these only work on Gramps Web's own site
  const err = h("div", { role: "status" }, message && h("div", { class: "warn" }, message));
  const form = h("form", { class: "login-form" }, h("h2", {}, "🌳 Family Tree"),
    ...sso.map(p => h("button", { class: "primary", type: "button", onclick: () => signIn(p) }, `Continue with ${p.name || p.id}`)));
  if (password) {
    const user = h("input", { id: "lg-user", autocomplete: "username", autocapitalize: "none" });
    const pass = h("input", { id: "lg-pass", type: "password", autocomplete: "current-password" });
    const btn = h("button", { class: sso.length ? "" : "primary", type: "submit" }, "Log in");
    if (sso.length) form.append(h("p", { class: "small muted" }, "Or log in with your name and password:"));
    form.append(h("label", { for: "lg-user" }, "Your name", user), h("label", { for: "lg-pass" }, "Your password", pass), err, btn);
    form.onsubmit = async e => {
      e.preventDefault(); btn.disabled = true; btn.textContent = "Checking…";
      try { await login(user.value, pass.value); await start(); }
      catch (ex) { err.replaceChildren(h("div", { class: "warn" }, ex.message)); btn.disabled = false; btn.textContent = "Log in"; }
    };
  } else {
    form.onsubmit = e => e.preventDefault();
    form.append(err, sso.length ? "" : h("p", {}, "Signing in isn't set up for this page yet. Ask the family tree's owner."));
  }
  gate("", form);
  form.querySelector("button, input")?.focus();
}
// Sign in with Google (or another provider) in a pop-up; on phones it opens as a new tab. Gramps Web
// keeps the login on this site and then shows its own home page in that window, so this page watches
// for the login to appear rather than waiting to be sent back.
function signIn(p) {
  const url = `${GRAMPS}/api/oidc/login/?provider=${encodeURIComponent(p.id)}`;
  const win = window.open(url, "eg-signin", "popup,width=520,height=700");
  if (!win) { location.href = url; return; }  // pop-ups blocked: sign in in this tab, then come back here
  const say = h("div", { role: "status" });
  const poll = setInterval(() => { if (auth.access) waiter?.(); }, 1000);
  waiter = () => {
    clearInterval(poll); waiter = null;
    try { win.close(); } catch { /* Google may have cut the link to the window */ }
    start().then(() => { if (auth.access) toast("Signed in ✓ If the sign-in window is still open, you can close it."); });
  };
  gate("", h("div", { class: "login-form" }, h("h2", {}, "🌳 Family Tree"),
    h("p", {}, `Finish signing in with ${p.name || p.id} in the other window.`),
    h("p", { class: "small muted" }, "On a phone or tablet it opens as a new tab. When you're done, come back to this one."),
    say,
    h("button", { class: "primary", onclick: () => auth.access ? waiter?.() : say.replaceChildren(h("div", { class: "warn" }, "Not signed in yet. Finish in the other window first.")) },
      "Signed in already? Tap here to continue"),
    h("button", { onclick: () => { clearInterval(poll); showLogin(); } }, "Back")));
}
// Logging in or out in Gramps Web (or another tab) counts here too.
onLoginChange(() => {
  if (!auth.access) return location.replace(location.pathname);  // logged out: leave nothing of the tree on screen
  if (waiter) waiter(); else if (loginShown) start();
});
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && auth.access) waiter?.(); });

export async function start() {
  loginShown = false;
  gate("Loading the family tree…");
  try {
    Object.assign(ME, await api("/auth/me"));
    await photoSession();
    await loadGraph();
  } catch (err) {
    if (err instanceof LoginNeeded) return showLogin();
    if (err.status === 403) return gate(err.message, h("button", { onclick: start }, "Try again"),
      h("button", { onclick: () => { auth.clear(); location.replace(location.pathname); } }, "Log out"));
    return gate(`Couldn't load the family tree: ${err.message}`, h("button", { onclick: start }, "Try again"));
  }
  S.role = ME.can_edit ? "editor" : ME.can_add ? "contributor" : "guest";
  useSettings(ME.settings);
  if (ME.gramps_link) { const a = $("#menu-gramps"); a.href = ME.gramps_link.url; a.textContent = `${ME.gramps_link.label} ↗`; a.hidden = false; }
  const v = parseView();  // a reload comes back to the same tree, selection, editor and pop-up
  S.focus = P[v.focus] ? v.focus : null;
  S.sel = S.focus && P[v.sel] ? v.sel : S.focus;
  if (S.focus) noteViewed(S.focus);
  hideGate();
  S.scrolledFor = null;
  rememberFocus();
  renderAll();
  if (S.focus) await restoreView(v);
}
// Log out: forget the login and reload, so nothing of the tree stays in the page for the next person.
$("#logout").onclick = async () => { await flushSaves(); auth.clear(); location.replace(location.pathname); };
