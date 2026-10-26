// Easy Gramps — the page's entry point. Data comes from Gramps Web through this app's /tree/* endpoints.
// Each module sets up its own buttons when loaded; then the login check and the first load start here.
import "./tree.js";
import "./panel.js";
import "./editor.js";
import "./merge.js";
import "./docs.js";
import { BASE } from "./auth.js";
import { $, closeMenu, h } from "./common.js";
import { hideDlg, showDlg } from "./editor.js";
import { start } from "./start.js";
// Lets phones install the page as an app (it keeps nothing offline; see sw.js).
if ("serviceWorker" in navigator) navigator.serviceWorker.register(`${BASE}/sw.js`, { scope: `${BASE}/` }).catch(() => {});
// Chrome / Edge say when the page can be installed (then the Menu's button installs it); other browsers get the steps.
let installPrompt = null;
const installed = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone;
$("#menu-install").hidden = installed();
addEventListener("beforeinstallprompt", e => { e.preventDefault(); installPrompt = e; });
addEventListener("appinstalled", () => { installPrompt = null; $("#menu-install").hidden = true; });
$("#menu-install").onclick = () => {
  closeMenu();
  if (installPrompt) { installPrompt.prompt(); installPrompt = null; return; }  // a prompt can be shown once
  const apple = /iPhone|iPad|Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
  $("#dlg").replaceChildren(h("h3", { id: "dlg-title" }, "Install as an app"),
    h("p", {}, apple ? "Tap the Share button (a square with an arrow), then “Add to Home Screen”."
      : "Open the browser's menu (⋮ or ☰), then “Install app” or “Add to Home screen”."),
    h("p", { class: "small muted" }, "The family tree then opens from its own icon, like any other app."),
    h("div", { class: "btnrow" }, h("button", { class: "primary", onclick: hideDlg }, "Close")));
  showDlg(false);
  $("#dlg button.primary").focus();
};

if (new URLSearchParams(location.search).has("debug")) import("./debug.js");  // screen diagnostics

start();
