// Easy Gramps — the owner's Site settings (☰ Menu → Owner): which menu items everyone sees, who gets the Full Gramps
// link, the app's name and its icon. Kept on the server (main.py /site), the same for everyone.
import { api, BASE } from "./auth.js";
import { $, APP_NAME, ME, P, closeMenu, dateProblems, h, name, postJSON } from "./common.js";
import { seeTree } from "./tree.js";
import { hideDlg, showDlg, toast } from "./editor.js";
import { ROLES } from "./me.js";

const ITEMS = [["theme", "Theme"], ["display", "Display (bigger text, the line to the details)"], ["dates", "Dates"],
  ["you", "You (Find me, email, notifications)"], ["install", "Install as an app"], ["docs", "Family documents"], ["tips", "Show tips"],
  ["keys", "Keyboard keys"], ["source", "Source code"]];
// What the owner may rename (main.py LABELS): key, where, the default text.
const LABELS = [["chat", "#chatbtn .lbl", "Chat"], ["menu", "#menubtn .lbl", "Menu"], ["theme", "[data-item=theme] h3", "Theme"],
  ["display", "[data-item=display] h3", "Display"], ["dates", "[data-item=dates] h3", "Dates"], ["you", "[data-item=you] h3", "You"],
  ["help", "#h-help", "Help"], ["install", "#menu-install", "📲 Install as an app"], ["docs", "#menu-docs", "📚 Family documents"],
  ["tips", "#tips-again", "Show tips"], ["keys", "#menu-keys", "Keyboard keys"], ["goto", "#h-goto", "Go to"],
  ["gramps", "#menu-gramps", "Full Gramps ↗"], ["source", "#menu-source", "Source code ↗"]];
const SUGGEST = [["off", "Off"], ["members", "Members and contributors"], ["everyone", "Everyone, guests too"]];
const GRAMPS = [["nobody", "Nobody"], ["owner", "Only the owner"], ["editors", "Editors and the owner"], ["everyone", "Everyone"]];

export function applySite() {
  const hide = new Set(ME.site?.hide || []);
  document.querySelectorAll("#menupop [data-item]").forEach(el => el.classList.toggle("sitehidden", hide.has(el.dataset.item)));
  $("#menu-owner").hidden = (ME.role ?? 0) < 4;
  $("#menu-joining").textContent = `👋 Waiting to join${ME.joining ? ` (${ME.joining})` : ""}`;
  const role = [...ROLES, [4, "Owner"], [5, "Admin"]].find(([n]) => n === ME.role)?.[1];
  $("#menu-role").textContent = role ? `Logged in as ${ME.full_name || ME.name} (${role})` : "";
  const names = ME.site?.labels || {};
  for (const [k, sel] of LABELS) {
    const el = $(sel);
    if (el && names[k]) el.textContent = el.classList.contains("lbl") ? ` ${names[k]}` : names[k];  // .lbl: after the icon
  }
}

$("#menu-site").onclick = () => { closeMenu(); openSite(); };

// Check dates: everyone whose dates can't be right (common.js dateProblems), from the tree already in the page.
$("#menu-dates").onclick = () => {
  closeMenu();
  const bad = Object.values(P).map(p => [p, dateProblems(p.id)]).filter(([, x]) => x.length).sort(([a], [b]) => name(a).localeCompare(name(b)));
  $("#dlg").replaceChildren(h("button", { class: "dlgx", "aria-label": "Close", onclick: hideDlg }, "✕"),
    h("h3", { id: "dlg-title" }, `Check dates${bad.length ? ` (${bad.length})` : ""}`),
    h("p", { class: "small muted" }, "People whose dates can't be right: died before they were born, born when a parent was under 12, or after a parent died. Years only."),
    bad.length ? h("div", { class: "datelist" }, ...bad.map(([p, x]) => h("div", { class: "sugdone" },
      h("div", {}, h("strong", {}, name(p)), ...x.map(t => h("div", { class: "small" }, t))),
      h("button", { onclick: () => { hideDlg(); seeTree(p.id); } }, "See their tree"))))
      : h("p", {}, h("strong", {}, "Nothing wrong found ✓")),
    h("div", { class: "btnrow end" }, h("button", { onclick: hideDlg }, "Close")));
  showDlg(false);
};

// Waiting to join: accounts Gramps Web keeps disabled until the owner lets them in (main.py /joining). Letting them
// in here also emails them that they're in (Gramps Web itself doesn't).
$("#menu-joining").onclick = () => { closeMenu(); openJoining(); };
async function openJoining() {
  let list;
  try { list = await api("/joining"); } catch (err) { return toast(err.message, false); }
  ME.joining = list.length; applySite();
  const rows = list.map(u => {
    const role = h("select", { "aria-label": `What ${u.name} can do` }, ...ROLES.map(([v, n, what]) => h("option", { value: v }, `${n}: ${what}`)));
    role.value = String(u.role);
    const say = h("div", { class: "small", role: "status" });
    const go = h("button", { class: "primary", onclick: async () => {
      go.disabled = true;
      try {
        const r = await postJSON(`/joining/${encodeURIComponent(u.login)}`, { role: Number(role.value) });
        say.textContent = r.emailed ? `Let in ✓ We emailed ${u.email} that they're in.` : "Let in ✓ No email was sent, so let them know yourself.";
        role.disabled = true; go.hidden = true;
        ME.joining = Math.max(0, (ME.joining || 1) - 1); applySite();
      } catch (err) { go.disabled = false; say.textContent = err.message; }
    } }, "Let them in");
    return h("div", { class: "joinrow" }, h("div", {}, h("strong", {}, u.name), u.email ? ` · ${u.email}` : "",
      u.person ? h("div", { class: "small muted" }, "Invited: their place in the tree is linked when they're in.") : "",
      u.before ? h("div", { class: "small warn" }, "This login was used before and then turned off.") : ""),
      h("div", { class: "btnrow" }, role, go), say);
  });
  $("#dlg").replaceChildren(h("h3", { id: "dlg-title" }, "Waiting to join"),
    h("p", { class: "small muted" }, "People who signed up and are waiting for you. Pick what they can do and let them in; they get an email saying they're in. To say no, leave them here or remove them in Full Gramps."),
    ...(rows.length ? rows : [h("p", { class: "muted" }, "Nobody is waiting ✓")]),
    h("div", { class: "btnrow end" }, h("button", { onclick: hideDlg }, "Close")));
  showDlg(false);
}
function openSite() {
  const s = ME.site || {};
  const nameIn = h("input", { id: "site-name", value: s.name || APP_NAME, maxlength: 40, autocomplete: "off" });
  const shows = ITEMS.map(([k, label]) => {
    const box = h("input", { type: "checkbox", value: k, checked: !(s.hide || []).includes(k) });
    return h("label", { class: "inline" }, box, label);
  });
  const gramps = h("select", { id: "site-gramps" }, ...GRAMPS.map(([v, t]) => h("option", { value: v }, t)));
  gramps.value = s.gramps || "everyone";
  const talk = h("input", { type: "checkbox", checked: s.talk !== false });
  const suggest = h("select", { id: "site-suggest" }, ...SUGGEST.map(([v, t]) => h("option", { value: v }, t)));
  suggest.value = s.suggest || "off";
  const sends = h("select", { id: "site-sends" }, h("option", { value: "auto" }, "Automatically, with each change (easiest)"),
    h("option", { value: "manual" }, "When they press “Send to the editors”"));
  sends.value = s.suggest_send || "auto";
  const renames = LABELS.map(([k, , def]) => h("label", {}, def,
    h("input", { "data-key": k, value: s.labels?.[k] || "", placeholder: def, maxlength: 40, autocomplete: "off" })));
  const iconImg = h("img", { class: "siteicon", src: `${BASE}/icon-192.png?t=${Date.now()}`, alt: "The app's icon now" });
  const say = h("div", { role: "status" });
  const file = h("input", { type: "file", accept: "image/*", hidden: true });
  const icon = async (method, body) => {
    say.replaceChildren("Saving the icon…");
    try { await api("/site/icon", { method, body }); iconImg.src = `${BASE}/icon-192.png?t=${Date.now()}`; say.replaceChildren("Icon saved ✓"); }
    catch (err) { say.replaceChildren(h("div", { class: "warn" }, err.message)); }
  };
  file.onchange = () => file.files[0] && icon("PUT", file.files[0]);
  const save = h("button", { class: "primary", onclick: async () => {
    save.disabled = true;
    try {
      const hide = shows.map(l => l.querySelector("input")).filter(b => !b.checked).map(b => b.value);
      ME.site = await api("/site", { method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nameIn.value, hide, gramps: gramps.value, talk: talk.checked, suggest: suggest.value, suggest_send: sends.value,
          labels: Object.fromEntries(renames.map(l => l.querySelector("input")).map(i => [i.dataset.key, i.value])) }) });
      location.reload();  // the name is in the page itself, the manifest and the Full Gramps links: simplest to load again
    } catch (err) { save.disabled = false; say.replaceChildren(h("div", { class: "warn" }, err.message)); }
  } }, "Save");
  $("#dlg").replaceChildren(h("h3", { id: "dlg-title" }, "Site settings"),
    h("p", { class: "muted small" }, "For everyone who uses the family tree."),
    h("label", { for: nameIn.id }, "Name of the app (browser tab, installed app, top bar)", nameIn),
    h("div", { class: "flabel" }, "Icon",
      h("div", { class: "btnrow" }, iconImg, h("button", { onclick: () => file.click() }, "Choose a picture…"),
        h("button", { onclick: () => icon("DELETE") }, "Use the default"), file)),
    h("fieldset", {}, h("legend", {}, "Show in the menu"), ...shows),
    h("fieldset", {}, h("legend", {}, "In each person's details"),
      h("label", { class: "inline" }, talk, "“Family talk about …” (messages about that person)"),
      h("p", { class: "muted small" }, "Turned off, no one can write new ones. Earlier ones stay in Chat.")),
    h("label", { for: suggest.id }, "Who may suggest changes", suggest),
    h("p", { class: "muted small" }, "They change the tree like an editor, but it goes to the editors first: ☰ Menu → Suggestions shows them on the tree to approve or reject."),
    h("label", { for: sends.id }, "Suggestions are sent", sends),
    h("details", { class: "renames" }, h("summary", {}, "Rename menu items and buttons"),
      h("p", { class: "muted small" }, "Leave a box empty to keep the name in grey. Emoji are fine."), ...renames),
    h("label", { for: gramps.id }, "Full Gramps link for", gramps),
    h("p", { class: "muted small" }, "Hiding the link doesn't change what anyone may do: their role in Gramps Web decides that."),
    say, h("div", { class: "btnrow end" }, h("button", { onclick: hideDlg }, "Cancel"), save));
  showDlg(false);
  nameIn.focus();
}
