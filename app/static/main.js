// Easy Gramps — the page's entry point. Data comes from Gramps Web through this app's /tree/* endpoints.
// Each module sets up its own buttons when loaded; then the login check and the first load start here.
import "./tree.js";
import "./panel.js";
import "./editor.js";
import "./merge.js";
import { BASE } from "./auth.js";
import { $, closeMenu } from "./common.js";
import { start } from "./start.js";
// Lets phones install the page as an app (it keeps nothing offline; see sw.js).
if ("serviceWorker" in navigator) navigator.serviceWorker.register(`${BASE}/sw.js`, { scope: `${BASE}/` }).catch(() => {});
// Chrome / Edge say when the page can be installed; the Menu's button shows only then (never on iPhones).
let installPrompt = null;
addEventListener("beforeinstallprompt", e => { e.preventDefault(); installPrompt = e; $("#menu-install").hidden = false; });
addEventListener("appinstalled", () => { installPrompt = null; $("#menu-install").hidden = true; });
$("#menu-install").onclick = () => {
  closeMenu();
  installPrompt?.prompt();  // a prompt can be shown once; Chrome fires beforeinstallprompt again if it's declined
  installPrompt = null; $("#menu-install").hidden = true;
};

if (new URLSearchParams(location.search).has("debug")) import("./debug.js");  // screen diagnostics

start();
