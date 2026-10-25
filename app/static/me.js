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
function grampsHomes() {  // [all trees' settings, this tree's key], or null when it can't be read here
  if (!SHARED || !auth.access) return null;
  try {
    const tree = JSON.parse(atob(auth.access.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).tree || "unknown";
    return [JSON.parse(localStorage.getItem("grampsjs_settings_tree") || "{}") || {}, tree];
  } catch { return null; }
}
export function grampsHome(force = false) {
  const id = myPerson(), at = grampsHomes();
  if (!id || !P[id].gid || !at) return;
  const [all, tree] = at;
  if (!force && all[tree]?.homePerson) return;
  all[tree] = { ...all[tree], homePerson: P[id].gid };
  try { localStorage.setItem("grampsjs_settings_tree", JSON.stringify(all)); } catch { /* Gramps Web keeps its own choice */ }
}
// The home person picked in Gramps Web (this browser): often the user, but sometimes an ancestor, so only offered.
function homeGuess() {
  const at = grampsHomes(), gid = at?.[0][at[1]]?.homePerson;
  return gid ? Object.values(P).find(p => p.gid === gid) || null : null;
}
function changed(settings) {
  ME.settings = settings;
  renderMeBox(); renderMenuMe(); renderPanel();
  loadLogins();  // (editors: the panel's "Linked to the login …")
}

// ---------- start screen: "Claim your place in the family tree" (or "Are you …?" from Gramps Web's home person), or a shortcut to your own tree ----------
export function meBox() { return h("div", { id: "mebox" }, ...meBoxParts()); }
function renderMeBox() { $("#mebox")?.replaceChildren(...meBoxParts()); }
function meBoxParts() {
  const mine = myPerson();
  if (mine) return [h("button", { class: "recentcard mecard", onclick: () => seeTree(mine), title: "Open your own family tree" },
    photoEl(P[mine]), h("span", {}, h("strong", {}, "Your family tree"), h("span", { class: "small muted" }, name(P[mine]))))];
  if (store.get(LATER)) return [];
  const guess = homeGuess(), later = h("button", { onclick: () => { store.set(LATER, "1"); renderMeBox(); } }, "Not now");
  if (guess) return [h("div", { class: "mebanner" }, photoEl(guess),
    h("div", {}, h("strong", {}, `Are you ${name(guess)}?`), h("div", { class: "small" }, WHY)),
    h("div", { class: "btnrow" }, h("button", { class: "primary", onclick: e => claim(guess, e.target) }, "Yes, that's me"),
      h("button", { onclick: () => openFindMe() }, "No, find me"), later))];
  return [h("div", { class: "mebanner" }, h("span", { class: "wave", "aria-hidden": "true" }, "👋"),
    h("div", {}, h("strong", {}, "Claim your place in the family tree"), h("div", { class: "small" }, WHY)),
    h("div", { class: "btnrow" }, h("button", { class: "primary", onclick: () => openFindMe() }, "Find me"), later))];
}
const WHY = "Link your login to yourself, so the family can message you in the chat and your own tree is one tap away.";
async function claim(p, btn, say) {
  btn.disabled = true;
  try {
    changed(await send("PUT", "/auth/me/person", { person: p.id }));
    grampsHome(true);  // Gramps Web opens on them too (this device)
    hideDlg();
    toast(`Saved ✓ You are ${name(p)}.`);
  } catch (err) { btn.disabled = false; failed(err, say); }
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
    : [h("button", { onclick: () => { closeMenu(); openFindMe(); } }, "Claim your place in the tree")]));
  if (ME.chat_email) {  // the chat's daily email, when the server can send email
    const sw = h("input", { type: "checkbox", class: "sw", checked: ME.settings?.emails !== false });
    sw.onchange = async () => {
      try { ME.settings = { ...ME.settings, ...(await send("PUT", "/auth/settings", { emails: sw.checked })) }; }
      catch (err) { sw.checked = !sw.checked; failed(err); }
    };
    box.append(h("label", { class: "swrow" }, "Email me when a chat message waits for me a day", sw));
  }
  if (canPush()) box.append(pushSwitch());
}

// ---------- ☰ Menu → You: chat notifications on this device (Web Push; on iPhones only in the installed app) ----------
const canPush = () => ME.push_key && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const pushSub = async () => (await navigator.serviceWorker.ready).pushManager.getSubscription();
function pushSwitch() {
  const sw = h("input", { type: "checkbox", class: "sw" });
  pushSub().then(s => { sw.checked = !!s && Notification.permission === "granted"; }).catch(() => {});
  sw.onchange = async () => {
    sw.disabled = true;
    try {
      if (sw.checked) { await pushOn(); toast("Done ✓ This device will tell you about new chat messages."); } else await pushOff();
    } catch (err) { sw.checked = !sw.checked; failed(err); } finally { sw.disabled = false; }
  };
  return h("label", { class: "swrow" }, "Notify me of new chat messages on this device", sw);
}
async function pushOn() {
  if (await Notification.requestPermission() !== "granted") {
    throw new Error("notifications are blocked for this site. Allow them in the browser's settings for this site, then try again.");
  }
  const reg = await navigator.serviceWorker.ready;
  const key = Uint8Array.from(atob(ME.push_key.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
  let sub = await reg.pushManager.getSubscription();
  const old = sub?.options?.applicationServerKey && new Uint8Array(sub.options.applicationServerKey);
  if (sub && old && !(old.length === key.length && old.every((x, i) => x === key[i]))) { await sub.unsubscribe(); sub = null; }  // the server has a new key
  try { sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }); }
  catch { throw new Error("this browser can't get notifications here. Try again, or use the installed app."); }
  await send("PUT", "/chat/push", sub.toJSON());
}
// Off: this device, and on logout (so the next person to log in here doesn't get them).
export async function pushOff() {
  if (!canPush()) return;
  const sub = await pushSub().catch(() => null);
  if (!sub) return;
  try { await send("DELETE", "/chat/push", { endpoint: sub.endpoint }); } catch { /* forgotten anyway when the push service says it's gone */ }
  await sub.unsubscribe().catch(() => {});
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
  const yes = h("button", { class: "primary", onclick: () => claim(p, yes, say) }, "Yes, this is me");
  $("#dlg").replaceChildren(h("h3", { id: "dlg-title" }, "Is this you?"),
    h("div", { class: "mewho" }, photoEl(p, true), h("div", {}, h("strong", { class: "mename" }, name(p)),
      p.birth || p.birthPlace ? h("div", { class: "muted" }, `Born ${[fmtDate(p.birth), p.birthPlace].filter(Boolean).join(", ")}`) : "",
      parents.length ? h("div", { class: "muted small" }, `Parents: ${parents.join(" and ")}`) : "")),
    h("p", {}, "Your login will be linked to this person, so the family can message you in the chat and your own tree is one tap away."),
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
