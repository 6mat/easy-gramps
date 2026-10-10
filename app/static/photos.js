// Easy Gramps — Photos: the big view (tap a photo in the details panel or the editor), with ‹ › between
// a person's photos, and for editors "Use as profile photo" / "Remove from this person".
// It's a browser-history step, like the editor: Back (or a phone's back gesture) closes it.
import { BASE } from "./auth.js";
import { $, h, renewPhotos } from "./common.js";

export const thumbUrl = (m, size = 192) => `${BASE}/gapi/media/${m}/thumbnail/${size}?square=1`;
const bigUrl = m => `${BASE}/gapi/media/${m}/thumbnail/1024`;

let V = null;  // { list, at, who, actions, back }: the open view
// actions (editors only): { main(m), remove(m) }, each resolving to the person's photo list afterwards.
export function openViewer(list, at, who, actions) {
  if (!list.length) return;
  V = { list: [...list], at, who, actions, back: document.activeElement, sure: false };
  history.pushState({ ...history.state, eg: (history.state?.eg || 0) + 1, photo: 1 }, "");
  $("#viewer").hidden = false;
  draw();
  $("#viewer .vclose").focus();
}
function hide() {
  if (!V) return;
  const back = V.back;
  V = null;
  $("#viewer").hidden = true; $("#viewer").replaceChildren();
  back?.isConnected && back.focus();
}
export function closeViewer() { if (V) { hide(); history.back(); } }  // (its history step goes too)
window.addEventListener("popstate", () => { if (V && !history.state?.photo) hide(); });

function step(by) {
  if (!V || V.list.length < 2) return;
  V.at = (V.at + by + V.list.length) % V.list.length; V.sure = false;
  draw();
}
function draw() {
  const { list, at, who, actions } = V, m = list[at];
  const img = h("img", { src: bigUrl(m), alt: list.length > 1 ? `Photo ${at + 1} of ${list.length}: ${who}` : `Photo of ${who}` });
  let retried = false;
  img.onerror = async () => { if (!retried) { retried = true; if (await renewPhotos()) img.src = `${bigUrl(m)}?r=1`; } };
  const busy = btn => async fn => {
    btn.disabled = true;
    try {
      V.list = await fn(m);
      if (!V) return;
      if (!V.list.length) return closeViewer();
      V.at = Math.min(V.list.indexOf(m) >= 0 ? V.list.indexOf(m) : V.at, V.list.length - 1); V.sure = false;
      draw();
    } catch { btn.disabled = false; }  // (the editor says what went wrong)
  };
  const tools = actions && h("div", { class: "vactions" },
    V.sure
      ? [h("span", {}, `Take this photo off ${who}? It stays in Gramps.`),
        h("button", { class: "danger", onclick: e => busy(e.currentTarget)(actions.remove) }, "Yes, remove it"),
        h("button", { onclick: () => { V.sure = false; draw(); } }, "Cancel")]
      : [at > 0 && h("button", { onclick: e => busy(e.currentTarget)(actions.main) }, "Use as profile photo"),
        at === 0 && h("span", { class: "small" }, "★ Profile photo"),
        h("button", { onclick: () => { V.sure = true; draw(); } }, "Remove from this person")]);
  $("#viewer").replaceChildren(
    h("div", { class: "vbar" },
      h("span", {}, h("strong", {}, who), list.length > 1 && ` · ${at + 1} of ${list.length}`),
      h("button", { class: "vclose", onclick: closeViewer }, "✕ Close")),
    h("div", { class: "vstage", onclick: e => { if (e.target === e.currentTarget) closeViewer(); } },
      list.length > 1 && h("button", { class: "vstep", "aria-label": "Previous photo", onclick: () => step(-1) }, "‹"),
      img,
      list.length > 1 && h("button", { class: "vstep", "aria-label": "Next photo", onclick: () => step(1) }, "›")),
    tools);
}
// Keys while it's open: ← → between photos, Esc closes; nothing reaches the tree or the editor.
window.addEventListener("keydown", e => {
  if (!V) return;
  if (e.key === "Escape") closeViewer();
  else if (e.key === "ArrowLeft") step(-1);
  else if (e.key === "ArrowRight") step(1);
  else if (e.key !== "Tab" && e.key !== "Enter" && e.key !== " ") e.preventDefault();
  if (e.key === "Tab") {  // keep Tab inside the view
    const all = [...$("#viewer").querySelectorAll("button:not(:disabled)")];
    const i = all.indexOf(document.activeElement);
    if (e.shiftKey ? i <= 0 : i === all.length - 1) { e.preventDefault(); all.at(e.shiftKey ? -1 : 0)?.focus(); }
  }
  e.stopImmediatePropagation();
}, true);
// Swipe left or right on a phone or tablet.
let downX = null;
$("#viewer").addEventListener("pointerdown", e => { downX = e.clientX; });
$("#viewer").addEventListener("pointerup", e => {
  if (downX != null && Math.abs(e.clientX - downX) > 60 && e.target.closest(".vstage")) step(e.clientX < downX ? 1 : -1);
  downX = null;
});
