// Easy Gramps — the owner's Site settings (☰ Menu → Owner): which menu items everyone sees, who gets the Full Gramps
// link, the app's name and its icon. Kept on the server (main.py /site), the same for everyone.
import { api, BASE } from "./auth.js";
import { $, APP_NAME, ME, closeMenu, h } from "./common.js";
import { hideDlg, showDlg } from "./editor.js";

const ITEMS = [["theme", "Theme"], ["display", "Display (bigger text, the line to the details)"], ["dates", "Dates"],
  ["you", "You (Find me, email, notifications)"], ["install", "Install as an app"], ["tips", "Show tips"],
  ["keys", "Keyboard keys"], ["source", "Source code"]];
const GRAMPS = [["nobody", "Nobody"], ["owner", "Only the owner"], ["editors", "Editors and the owner"], ["everyone", "Everyone"]];

export function applySite() {
  const hide = new Set(ME.site?.hide || []);
  document.querySelectorAll("#menupop [data-item]").forEach(el => el.classList.toggle("sitehidden", hide.has(el.dataset.item)));
  $("#menu-owner").hidden = (ME.role ?? 0) < 4;
}

$("#menu-site").onclick = () => { closeMenu(); openSite(); };
function openSite() {
  const s = ME.site || {};
  const nameIn = h("input", { id: "site-name", value: s.name || APP_NAME, maxlength: 40, autocomplete: "off" });
  const shows = ITEMS.map(([k, label]) => {
    const box = h("input", { type: "checkbox", value: k, checked: !(s.hide || []).includes(k) });
    return h("label", { class: "inline" }, box, label);
  });
  const gramps = h("select", { id: "site-gramps" }, ...GRAMPS.map(([v, t]) => h("option", { value: v }, t)));
  gramps.value = s.gramps || "everyone";
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
        body: JSON.stringify({ name: nameIn.value, hide, gramps: gramps.value }) });
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
    h("label", { for: gramps.id }, "Full Gramps link for", gramps),
    h("p", { class: "muted small" }, "Hiding the link doesn't change what anyone may do: their role in Gramps Web decides that."),
    say, h("div", { class: "btnrow end" }, h("button", { onclick: hideDlg }, "Cancel"), save));
  showDlg(false);
  nameIn.focus();
}
