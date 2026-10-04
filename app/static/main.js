// Easy Gramps — the page's entry point. Data comes from Gramps Web through this app's /tree/* endpoints.
// Each module sets up its own buttons when loaded; then the login check and the first load start here.
import "./tree.js";
import "./panel.js";
import "./editor.js";
import "./merge.js";
import { BASE } from "./auth.js";
import { start } from "./start.js";
// Lets phones install the page as an app (it keeps nothing offline; see sw.js).
if ("serviceWorker" in navigator) navigator.serviceWorker.register(`${BASE}/sw.js`, { scope: `${BASE}/` }).catch(() => {});

if (new URLSearchParams(location.search).has("debug")) import("./debug.js");  // screen diagnostics

start();
