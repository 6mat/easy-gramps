// Easy Gramps — Family chat: 💬 Chat in the top bar (with the unread count), a full-screen chat (groups,
// private messages, conversations about a person) and "Family talk about …" in the details panel.
// Text only. The page checks for new messages every 15 s (every 5 s in an open conversation).
// Opening the chat is a browser-history step, like the editor: Back (or a phone's back gesture) closes it.
import { api, auth, LoginNeeded } from "./auth.js";
import { $, P, S, fmtDate, h, name, photoEl, trapTab } from "./common.js";
import { hideDlg, showDlg, toast } from "./editor.js";
import { seeTree } from "./tree.js";
import { renderPanel } from "./panel.js";
import { showLogin } from "./start.js";

let D = null;  // GET /chat: { convs, unread, me, editor, people (login -> person), logins, emoji }
const C = { open: false, cur: null, msgs: [], sure: null, phoneConv: false, back: null, draft: {} };
const talk = {};  // person -> { at, data } for the details panel
const talkDraft = {};  // person -> what's typed in their panel box (the panel redraws often)
let talkFocus = null;  // the person whose panel box had the cursor
let timer = null, convTimer = null;
const TITLE = document.title;

const send = (method, path, body) => api(path, { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) });
function failed(err) {
  if (err instanceof LoginNeeded) return showLogin();
  toast(err.status === 503 ? err.message : `Not sent: ${err.message}`);
}

// ---------- people: the person they found themselves as ("Find me"), else their login name ----------
const personOf = login => (P[D?.people?.[login]] ? D.people[login] : null);
const whoName = login => (login === D?.me ? "You" : personOf(login) ? name(P[personOf(login)]) : login);
const first = p => (p.first || name(p)).split(" ")[0];
function avatar(login) {
  const p = personOf(login);
  return p ? photoEl(P[p]) : h("span", { class: "ph nologin", "aria-hidden": "true" }, (login[0] || "?").toUpperCase());
}
const loginOf = person => Object.keys(D?.people || {}).find(l => D.people[l] === person && P[person]);

// ---------- the top bar's 💬 Chat, kept up to date ----------
export function startChat() {
  $("#chatbtn").hidden = false;
  refresh();
  const asked = +new URLSearchParams(location.search).get("chat");  // a tapped notification opened the page (sw.js)
  if (asked) { history.replaceState(history.state, "", location.pathname + location.hash); openChat(asked); }
  if (!timer) timer = setInterval(() => { if (document.visibilityState === "visible" && auth.access) refresh(); }, 15000);
}
export async function refresh() {
  const firstTime = !D;
  try { D = await api("/chat"); } catch { return; }  // (the next check tries again)
  if (firstTime && S.sel) renderPanel();  // "💬 Message …" for people with a login
  const n = D.unread;
  $("#chatbadge").hidden = !n; $("#chatbadge").textContent = n > 99 ? "99+" : String(n);
  $("#chatbtn").setAttribute("aria-label", n ? `Family chat, ${n} new` : "Family chat");
  document.title = n ? `(${n > 99 ? "99+" : n}) ${TITLE}` : TITLE;  // the tab, and the installed app's icon where it can show a number
  if (navigator.setAppBadge) (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
  if (C.open) renderList();
}
$("#chatbtn").onclick = () => openChat();
// A notification tapped while the page is open (sw.js): its conversation.
navigator.serviceWorker?.addEventListener("message", e => { if (e.data?.chat && auth.access) openChat(e.data.chat); });

// ---------- the chat screen ----------
export async function openChat(cid) {
  if (!C.open) {
    C.open = true; C.back = document.activeElement;
    history.pushState({ ...history.state, eg: (history.state?.eg || 0) + 1, chat: 1 }, "");
    $("#chat").hidden = false;
  }
  if (!D) await refresh();
  C.phoneConv = !!cid;
  await show(cid ?? C.cur ?? D?.convs[0]?.id ?? 1);
  if (!cid) $("#chat .clist .crow.on")?.focus();
}
function hide() {
  if (!C.open) return;
  C.open = false; clearInterval(convTimer); convTimer = null;
  $("#chat").hidden = true;
  C.back?.isConnected && C.back.focus();
}
export function closeChat() { if (C.open) { hide(); history.back(); } }  // (its history step goes too)
window.addEventListener("popstate", () => { if (C.open && !history.state?.chat) hide(); });
$("#chat-back").onclick = () => (narrow() && C.phoneConv ? (C.phoneConv = false, renderAll()) : closeChat());
$("#chat-home").onclick = () => { closeChat(); setTimeout(() => $("#brand").click(), 0); };
const narrow = () => matchMedia("(max-width: 700px)").matches;
window.addEventListener("keydown", e => {
  if (!C.open || !$("#dlg-wrap").hidden) return;
  if (e.key === "Escape") {
    e.preventDefault(); e.stopImmediatePropagation();
    if (C.sure) { C.sure = null; renderConv(); } else if (narrow() && C.phoneConv) { C.phoneConv = false; renderAll(); } else closeChat();
  } else if (e.key === "Tab") trapTab(e, $("#chat"));
}, true);

async function show(cid) {
  const c = D?.convs.find(x => x.id === cid);
  if (C.cur !== cid) { C.msgs = []; C.sure = null; }
  C.cur = cid;
  renderAll();
  if (c && (c.kind !== "group" || c.joined)) await load();
  clearInterval(convTimer);
  convTimer = setInterval(() => { if (document.visibilityState === "visible" && C.open) load(true); }, 5000);
}
async function load(quiet) {
  const cid = C.cur, after = C.msgs.at(-1)?.id || 0;
  const c = D?.convs.find(x => x.id === cid);
  if (!c || (c.kind === "group" && !c.joined)) return;
  try {
    const got = await api(`/chat/c/${cid}?after=${quiet ? after : 0}`);
    if (cid !== C.cur) return;
    if (quiet && !got.length) return;
    C.msgs = quiet ? [...C.msgs, ...got] : got;
    renderConv(true);
    if (got.some(m => !m.mine)) refresh();  // read now: the unread count drops
  } catch (err) { if (!quiet) failed(err); }
}
function renderAll() {
  $("#chat .cbody").classList.toggle("phone-conv", C.phoneConv);
  $("#chat-back").textContent = narrow() && C.phoneConv ? "← Chats" : "← Back";
  renderList(); renderConv(true);
}

// ----- left: the conversations -----
function icon(c) {
  if (c.kind === "private") return avatar(c.other);
  if (c.kind === "person") return P[c.person] ? photoEl(P[c.person]) : h("span", { class: "ph nologin" }, "?");
  return h("span", { class: "cico", "aria-hidden": "true" }, c.emoji || "💬");
}
function title(c) {
  if (c.kind === "private") return whoName(c.other);
  if (c.kind === "person") return P[c.person] ? name(P[c.person]) : "Someone no longer in the tree";
  return c.name;
}
function lastLine(c) {
  const m = c.last;
  if (!m) return c.kind === "group" && !c.joined ? `${c.members} ${c.members === 1 ? "person" : "people"}` : "No messages yet";
  return `${m.mine ? "You" : first({ first: whoName(m.login) })}: ${m.deleted ? "Message deleted" : m.text}`;
}
function row(c) {
  const join = c.kind === "group" && !c.joined;
  return h("div", { class: "crowwrap" },
    h("button", { class: `crow${c.id === C.cur ? " on" : ""}`, onclick: () => { C.phoneConv = true; show(c.id); } },
      icon(c), h("span", { class: "t" }, h("strong", {}, title(c)), h("span", { class: "small muted" }, lastLine(c))),
      c.unread ? h("span", { class: "badge", "aria-label": `${c.unread} new` }, String(c.unread)) : ""),
    join ? h("button", { class: "pill join", onclick: () => joinGroup(c.id, true) }, "Join") : "");
}
function renderList() {
  if (!D) return;
  const of = test => D.convs.filter(test).map(row);
  const head = (text, btn) => h("h3", {}, h("span", {}, text), btn || "");
  const groups = of(c => c.kind === "family" || (c.kind === "group" && c.joined));
  const others = of(c => c.kind === "group" && !c.joined);
  const priv = of(c => c.kind === "private");
  const about = of(c => c.kind === "person");
  $("#chat .clist").replaceChildren(
    head("Groups", D.editor && h("button", { class: "small", onclick: newGroup }, "+ New group")), ...groups,
    ...(others.length ? [head("Groups you can join"), ...others] : []),
    head("Private messages", h("button", { class: "small", onclick: messageSomeone }, "+ Message someone")),
    ...(priv.length ? priv : [h("div", { class: "small muted pad" }, "None yet.")]),
    head("About people"),
    ...(about.length ? about : [h("div", { class: "small muted pad" }, "Write about someone from their details: tap them in the tree.")]));
}

// ----- right: one conversation -----
function dayLabel(t) {
  const d = new Date(t * 1000), today = new Date();
  const y = new Date(today); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return fmtDate({ y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() });
}
const timeOf = t => new Date(t * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
function message(m) {
  const canDel = !m.deleted && (m.mine || D.editor);
  const sure = C.sure === m.id;
  return h("div", { class: `msg${m.mine ? " me" : ""}${sure ? " sure" : ""}` }, avatar(m.login),
    h("div", { class: "mb" },
      h("div", { class: "who" }, h("strong", {}, whoName(m.login)), h("span", { class: "small muted" }, timeOf(m.at))),
      m.deleted ? h("div", { class: "txt gone" }, "Message deleted") : h("div", { class: "txt" }, m.text),
      sure ? h("div", { class: "msgsure" }, h("span", { class: "small" }, `Delete ${m.mine ? "your" : `${first({ first: whoName(m.login) })}'s`} message? Everyone will see “Message deleted”.`),
        h("span", { class: "btnrow" }, h("button", { class: "danger", onclick: () => deleteMessage(m.id) }, "Yes, delete it"),
          h("button", { onclick: () => { C.sure = null; renderConv(); } }, "Cancel"))) : ""),
    canDel && !sure ? h("button", { class: "dots", title: "Delete this message", "aria-label": "Delete this message", onclick: () => { C.sure = m.id; renderConv(); } }, "⋯") : "");
}
function renderConv(toEnd) {
  const box = $("#chat .cconv"), c = D?.convs.find(x => x.id === C.cur);
  if (!c) return box.replaceChildren(h("div", { class: "cempty muted" }, D ? "That conversation isn't there any more." : "Loading…"));
  const list = box.querySelector(".cmsgs"), atEnd = !list || list.scrollHeight - list.scrollTop - list.clientHeight < 60;
  const sub = {
    family: "Everyone with a login",
    group: `${c.members} ${c.members === 1 ? "person" : "people"} · everyone in the family can join`,
    private: `Only you and ${whoName(c.other)} can read this`,
    person: "Everyone with a login can read this and write here",
  }[c.kind];
  const tools = [];
  if (c.kind === "person" && P[c.person]) tools.push(h("button", { class: "pill", onclick: () => { closeChat(); seeTree(c.person); } }, "See their tree →"));
  if (c.kind === "group" && c.joined) tools.push(h("button", { onclick: () => joinGroup(c.id, false) }, "Leave group"));
  if (c.kind === "group" && D.editor) tools.push(C.sure === "group"
    ? h("span", { class: "btnrow" }, h("span", { class: "small" }, "Delete the group and all its messages?"),
      h("button", { class: "danger", onclick: deleteGroup }, "Yes, delete it"), h("button", { onclick: () => { C.sure = null; renderConv(); } }, "Cancel"))
    : h("button", { onclick: () => { C.sure = "group"; renderConv(); } }, "Delete group"));
  const msgs = [];
  let day = null;
  for (const m of C.msgs) {
    const d = dayLabel(m.at);
    if (d !== day) { msgs.push(h("div", { class: "cday" }, d)); day = d; }
    msgs.push(message(m));
  }
  const joinFirst = c.kind === "group" && !c.joined;
  // The writing box stays as it is while new messages come in (keeps the cursor and what's typed).
  const kept = box.dataset.conv === String(c.id) && box.querySelector(".cfoot");
  box.dataset.conv = String(c.id);
  const ta = h("textarea", { rows: 2, placeholder: c.kind === "person" ? `Ask or tell the family something about ${P[c.person] ? first(P[c.person]) : "them"}…` : "Write a message…", "aria-label": "Your message" });
  ta.value = C.draft[c.id] || "";
  ta.addEventListener("input", () => { C.draft[c.id] = ta.value; });
  ta.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey && !narrow()) { e.preventDefault(); sendBtn.click(); } });
  const sendBtn = h("button", { class: "primary", onclick: () => post(c.id, ta, sendBtn) }, "Send");
  box.replaceChildren(
    h("div", { class: "chead" }, icon(c), h("div", { class: "grow" }, h("h2", {}, title(c)), h("div", { class: "small muted" }, sub)), h("div", { class: "btnrow" }, ...tools)),
    h("div", { class: "cmsgs", role: "log", "aria-live": "polite" },
      joinFirst ? h("div", { class: "cempty" }, h("p", {}, "Join this group to read and write in it."), h("button", { class: "primary", onclick: () => joinGroup(c.id, true) }, "Join the group"))
        : msgs.length ? msgs : h("div", { class: "cempty muted" }, "No messages yet. Say hello!")),
    joinFirst ? "" : kept || h("div", { class: "cfoot" }, h("div", { class: "cwrite" }, ta, sendBtn)));
  const nl = box.querySelector(".cmsgs");
  if (toEnd || atEnd) nl.scrollTop = nl.scrollHeight;
}

async function post(cid, ta, btn) {
  const text = ta.value.trim();
  if (!text) return ta.focus();
  btn.disabled = true;
  try {
    const m = await send("POST", `/chat/c/${cid}`, { text });
    C.draft[cid] = ""; ta.value = "";
    if (C.cur === cid && !C.msgs.some(x => x.id === m.id)) C.msgs.push(m);
    renderConv(true); $("#chat .cfoot textarea")?.focus();
    refresh();
  } catch (err) { failed(err); } finally { btn.disabled = false; }
}
async function deleteMessage(id) {
  try {
    const m = await send("DELETE", `/chat/m/${id}`);
    C.msgs = C.msgs.map(x => (x.id === id ? m : x)); C.sure = null;
    renderConv(); refresh();
  } catch (err) { failed(err); }
}
async function joinGroup(cid, on) {
  try {
    await send("POST", `/chat/c/${cid}/join`, { join: on });
    await refresh();
    C.msgs = []; C.phoneConv = true;
    await show(cid);
    toast(on ? "You're in the group ✓" : "You left the group. You can join again any time.");
  } catch (err) { failed(err); }
}
async function deleteGroup() {
  try {
    await send("DELETE", `/chat/c/${C.cur}`);
    C.cur = null; C.sure = null; C.phoneConv = false;
    await refresh(); await show(1);
    toast("Group deleted.");
  } catch (err) { failed(err); }
}

// ---------- dialogs: a new group (editors), a private message ----------
function newGroup() {
  const nameIn = h("input", { id: "grp-name", maxlength: 60, placeholder: "e.g. Reunion 2027", autocomplete: "off" });
  let pick = D.emoji[1];
  const emo = h("div", { class: "chips", role: "radiogroup", "aria-label": "Picture" });
  const drawEmo = () => emo.replaceChildren(...D.emoji.map(e => h("button", { class: `chip emo${e === pick ? " on" : ""}`, role: "radio", "aria-checked": String(e === pick), onclick: () => { pick = e; drawEmo(); } }, e)));
  drawEmo();
  const others = D.logins.filter(l => l !== D.me);
  const boxes = others.map(l => h("label", { class: "pickrow" }, h("input", { type: "checkbox", value: l }), avatar(l), whoName(l)));
  const say = h("div", { role: "status" });
  const make = h("button", { class: "primary", onclick: async () => {
    if (!nameIn.value.trim()) { say.replaceChildren(h("div", { class: "warn" }, "Give the group a name.")); return nameIn.focus(); }
    make.disabled = true;
    try {
      const { id } = await send("POST", "/chat/groups", { name: nameIn.value, emoji: pick, members: boxes.filter(b => b.firstChild.checked).map(b => b.firstChild.value) });
      hideDlg(); await refresh(); C.phoneConv = true; await show(id);
      toast("Group made ✓");
    } catch (err) { make.disabled = false; say.replaceChildren(h("div", { class: "warn" }, err.message)); }
  } }, "Make the group");
  $("#dlg").replaceChildren(h("h3", { id: "dlg-title" }, "New group"),
    h("label", { for: "grp-name", class: "flabel" }, "Name of the group", nameIn),
    h("div", { class: "flabel" }, "Picture", emo),
    h("div", { class: "note" }, "Everyone in the family can see this group and join it. People can leave it whenever they like."),
    others.length ? h("div", { class: "flabel" }, "Add people now (optional)", h("div", { class: "picklist" }, boxes)) : "",
    say, h("div", { class: "btnrow end" }, h("button", { onclick: hideDlg }, "Cancel"), make));
  showDlg(false);
  nameIn.focus();
}
function messageSomeone() {
  const others = D.logins.filter(l => l !== D.me);
  $("#dlg").replaceChildren(h("h3", { id: "dlg-title" }, "Write to someone"),
    others.length ? h("div", { class: "picklist" }, others.map(l => h("button", { class: "pickbtn", onclick: () => { hideDlg(); openPrivate({ login: l }); } }, avatar(l), h("span", {}, h("strong", {}, whoName(l))))))
      : h("p", {}, "No one else has opened the family tree here yet."),
    h("p", { class: "small muted" }, "Everyone who has opened the family tree here is listed."),
    h("div", { class: "btnrow end" }, h("button", { onclick: hideDlg }, "Cancel")));
  showDlg(false);
  $("#dlg .pickbtn")?.focus();
}
async function openPrivate(who) {
  try {
    const { id } = await send("POST", "/chat/private", who);
    await refresh(); await openChat(id);
  } catch (err) { failed(err); }
}

// ---------- the details panel: "Family talk about …" and "Message …" ----------
// Under the name, for someone with a login (they found themselves in the tree): 💬 Message …
export function messageButton(p) {
  const login = loginOf(p.id);
  if (!login || login === D.me) return "";
  return h("button", { class: "msgbtn small", onclick: () => openPrivate({ person: p.id }) }, `💬 Message ${first(p)}`);
}
export function talkSection(p) {
  const box = h("section", { class: "talk" });
  const draw = () => {
    const t = talk[p.id]?.data;
    const ta = h("textarea", { rows: 2, placeholder: `Ask or tell the family something about ${first(p)}…`, "aria-label": `Write about ${first(p)}` });
    ta.value = talkDraft[p.id] || "";
    ta.addEventListener("input", () => { talkDraft[p.id] = ta.value; });
    ta.addEventListener("focus", () => { talkFocus = p.id; });
    ta.addEventListener("blur", () => setTimeout(() => { if (ta.isConnected && talkFocus === p.id) talkFocus = null; }, 0));  // (not when redrawn)
    const btn = h("button", { class: "primary", onclick: async () => {
      const text = ta.value.trim();
      if (!text) return ta.focus();
      btn.disabled = true;
      try {
        await send("POST", `/chat/person/${encodeURIComponent(p.id)}`, { text });
        delete talk[p.id]; talkDraft[p.id] = ""; toast("Sent ✓ Everyone in the family can see it in Chat.");
        await fetchTalk(p.id); draw(); refresh();
      } catch (err) { btn.disabled = false; failed(err); }
    } }, "Send");
    box.replaceChildren(...[h("h3", {}, `Family talk about ${first(p)}`),
      !t ? h("div", { class: "small muted" }, "Loading…")
        : t.count ? [...t.messages.map(m => h("div", { class: "msg small" }, avatar(m.login),
          h("div", { class: "mb" }, h("div", { class: "who" }, h("strong", {}, whoName(m.login)), h("span", { class: "small muted" }, dayLabel(m.at))),
            m.deleted ? h("div", { class: "txt gone" }, "Message deleted") : h("div", { class: "txt" }, m.text)))),
        h("button", { class: "linkish", onclick: () => openChat(t.id) }, t.count > t.messages.length ? `See all ${t.count} messages in Chat →` : "Open in Chat →")]
          : h("div", { class: "small muted" }, `No messages yet. Ask the family something about ${first(p)}, or share a memory.`),
      h("div", { class: "cwrite" }, ta, btn)].flat());  // (replaceChildren prints a nested list as text)
    if (talkFocus === p.id) requestAnimationFrame(() => { if (ta.isConnected && (document.activeElement === document.body || !document.activeElement)) ta.focus(); });
  };
  draw();
  if (!talk[p.id] || Date.now() - talk[p.id].at > 15000) fetchTalk(p.id).then(() => box.isConnected && draw());
  return box;
}
async function fetchTalk(id) {
  try { talk[id] = { at: Date.now(), data: await api(`/chat/person/${encodeURIComponent(id)}?limit=2`) }; }
  catch { talk[id] = { at: Date.now(), data: { id: null, count: 0, messages: [] } }; }
}
