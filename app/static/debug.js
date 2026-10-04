// Screen diagnostics for the tree page, loaded only with ?debug in the address.
// Shows a small box of numbers on screen and sends the same numbers to the server
// (data/debug.log), on load and whenever the screen size or zoom changes.
import { auth, BASE } from "./auth.js";

const box = document.createElement("pre");
box.style.cssText = "position:fixed;left:8px;top:8px;z-index:99;max-width:min(560px,calc(100vw - 16px));max-height:45vh;overflow:auto;" +
  "margin:0;padding:8px 10px;font:12px/1.35 ui-monospace,monospace;white-space:pre-wrap;background:rgba(0,0,0,.82);color:#fff;border-radius:8px;";
box.title = "Tap to hide or show";
box.onclick = () => { box.dataset.small = box.dataset.small ? "" : "1"; box.style.maxHeight = box.dataset.small ? "1.6em" : "45vh"; };
document.body.append(box);

const r = el => { if (!el) return null; const b = el.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom].map(Math.round); };

// How tall 100vh / 100dvh are here, and how wide a fixed 16px line of text is (shows text scaling).
function probe(css) {
  const el = document.createElement("div");
  el.style.cssText = `position:absolute;visibility:hidden;left:0;top:0;${css}`;
  el.textContent = css.includes("font") ? "MMMMMMMMMM" : "";
  document.body.append(el);
  const b = el.getBoundingClientRect(); el.remove();
  return css.includes("font") ? Math.round(b.width) : Math.round(b.height);
}

// Things inside their own scrolling box (the tree, the start card, the panel) don't move the page.
function insideScrollBox(e) {
  for (let p = e.parentElement; p && p !== document.body; p = p.parentElement)
    if (getComputedStyle(p).overflow !== "visible") return true;
  return false;
}

function collect(reason) {
  const d = document.documentElement, vv = window.visualViewport;
  const vw = d.clientWidth, vh = d.clientHeight;
  const sticking = [...document.querySelectorAll("body *")]
    .filter(e => e !== box && !insideScrollBox(e) && e.getClientRects().length)
    .map(e => [e, e.getBoundingClientRect()])
    .filter(([, b]) => b.width && (b.right > vw + 1 || b.bottom > vh + 1))
    .slice(0, 15)
    .map(([e, b]) => `${e.tagName.toLowerCase()}${e.id ? "#" + e.id : ""}${typeof e.className === "string" && e.className ? "." + e.className.trim().split(/\s+/).join(".") : ""} r=${Math.round(b.right)} b=${Math.round(b.bottom)}`);
  const mq = q => matchMedia(q).matches;
  return {
    reason, ua: navigator.userAgent, at: location.pathname + location.hash,
    screen: [screen.width, screen.height], dpr: devicePixelRatio, orientation: screen.orientation?.type,
    inner: [innerWidth, innerHeight], client: [vw, vh], scroll: [d.scrollWidth, d.scrollHeight],
    visual: vv && { w: Math.round(vv.width), h: Math.round(vv.height), scale: +vv.scale.toFixed(3), x: Math.round(vv.offsetLeft), y: Math.round(vv.offsetTop) },
    vh100: probe("height:100vh"), dvh100: probe("height:100dvh"), text16: probe("font-size:16px;white-space:nowrap"),
    bodyFont: getComputedStyle(document.body).fontSize,
    media: { portrait: mq("(orientation: portrait)"), under900: mq("(max-width: 899px)"), touch: mq("(pointer: coarse)"), noHover: mq("(hover: none)") },
    boxes: Object.fromEntries(["body", ".app", ".top", ".main", ".treepane", ".treebar", ".navstrip", ".panel"].map(s => [s, r(document.querySelector(s))])),
    sticking,
  };
}

function show(info, sent) {
  const v = info.visual || {};
  box.textContent = [
    `${sent}  (${info.reason})`,
    `screen ${info.screen.join("×")}  dpr ${info.dpr}  ${info.orientation || ""}`,
    `window ${info.inner.join("×")}  page ${info.scroll.join("×")}`,
    `visible ${v.w}×${v.h}  zoom ${v.scale}  at ${v.x},${v.y}`,
    `100vh=${info.vh100}  100dvh=${info.dvh100}  text16=${info.text16}`,
    `narrow layout: ${info.media.under900 || info.media.portrait}  touch: ${info.media.touch}`,
    ...Object.entries(info.boxes).map(([k, b]) => `${k} ${b ? b.join(",") : "—"}`),
    info.sticking.length ? "past the screen edge:" : "nothing past the screen edge",
    ...info.sticking.map(s => "  " + s),
  ].join("\n");
}

async function report(reason) {
  const info = collect(reason);
  show(info, "sending…");
  try {
    const res = await fetch(`${BASE}/debug/log`, { method: "POST", body: JSON.stringify(info),
      headers: { "Content-Type": "application/json", ...(auth.access ? { Authorization: `Bearer ${auth.access}` } : {}) } });
    show(info, res.ok ? "sent ✓" : res.status === 401 ? "not sent yet — will send after you log in" : `not sent (${res.status})`);
    if (res.status === 401) setTimeout(() => report(reason), 5000);
  } catch (e) {
    show(info, `not sent (${e.message})`);
  }
}

let timer;
const later = reason => { clearTimeout(timer); timer = setTimeout(() => report(reason), 800); };
addEventListener("resize", () => later("resize"));
window.visualViewport?.addEventListener("resize", () => later("zoom or visible area changed"));
setTimeout(() => report("page loaded"), 2500);
