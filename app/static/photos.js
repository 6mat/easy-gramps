// Easy Gramps — Photos: the big view (tap a photo in the details panel or the editor), with ‹ › between
// a person's photos, "In this photo:" (everyone it's on), and for editors "Use as profile photo" / "Remove from this
// person" and "Tag people" (drag a box around a face, pick who it is: Gramps keeps it as their part of the picture).
// It's a browser-history step, like the editor: Back (or a phone's back gesture) closes it.
import { BASE, LoginNeeded } from "./auth.js";
import { $, MEDIA, P, canEdit, grampsLink, h, matches, name, postJSON, renewPhotos, searchWords, trapTab } from "./common.js";
import { hitRows } from "./search.js";
import { renderAll, showLogin } from "./start.js";

const bigUrl = m => `${BASE}/gapi/media/${m}/thumbnail/1024`;

let V = null;  // { list, at, who, actions, back, tagging, box, err }: the open view; box: the face being tagged, in %
// actions (editors only): { main(m), remove(m) }, each resolving to the person's photo list afterwards.
export function openViewer(list, at, who, actions) {
  if (!list.length) return;
  V = { list: [...list], at, who, actions, back: document.activeElement, sure: false, tagging: false, box: null, err: "" };
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
function closeViewer() { if (V) { hide(); history.back(); } }  // (its history step goes too)
window.addEventListener("popstate", () => { if (V && !history.state?.photo) hide(); });

function step(by) {
  if (!V || V.list.length < 2) return;
  V.at = (V.at + by + V.list.length) % V.list.length; V.sure = false; V.box = null; V.err = "";
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
  const stage = h("div", { class: "vstage", onclick: e => { if (e.target === e.currentTarget) closeViewer(); } });
  const layer = boxes(m, img, stage);
  const on = Object.values(P).filter(p => p.photos?.includes(m)).sort((a, b) => name(a).localeCompare(name(b)));
  const tools = V.tagging ? tagTools(m) : (actions || canEdit()) && h("div", { class: "vactions" },
    !actions ? [] : V.sure
      ? [h("span", {}, `Take this photo off ${who}? It stays in Gramps.`),
        h("button", { class: "danger", onclick: e => busy(e.currentTarget)(actions.remove) }, "Yes, remove it"),
        h("button", { onclick: () => { V.sure = false; draw(); } }, "Cancel")]
      : [at > 0 && h("button", { onclick: e => busy(e.currentTarget)(actions.main) }, "Use as profile photo"),
        at === 0 && h("span", { class: "small" }, "★ Profile photo"),
        h("button", { onclick: () => { V.sure = true; draw(); } }, "Remove from this person")],
    !V.sure && canEdit() && h("button", { onclick: () => { V.tagging = true; draw(); } }, "Tag people"));
  $("#viewer").replaceChildren(
    h("div", { class: "vbar" },
      h("span", {}, h("strong", {}, who), list.length > 1 && ` · ${at + 1} of ${list.length}`),
      h("span", { class: "vtools" }, grampsLink("media", MEDIA[m], "Open in Full Gramps ↗", "Open this photo in Full Gramps"),
        h("button", { class: "vclose", onclick: closeViewer }, "✕ Close"))),
    stage,
    on.some(p => name(p) !== who) ? h("div", { class: "vwho small" }, `In this photo: ${on.map(name).join(", ")}`) : "",
    tools || "");  // (replaceChildren would print false or undefined as text)
  stage.replaceChildren(...[
    list.length > 1 && !V.tagging && h("button", { class: "vstep", "aria-label": "Previous photo", onclick: () => step(-1) }, "‹"),
    img, layer,
    list.length > 1 && !V.tagging && h("button", { class: "vstep", "aria-label": "Next photo", onclick: () => step(1) }, "›")].filter(Boolean));
}

// ---------- tagging people on a photo (editors) ----------
// The layer over the picture as drawn: while tagging, everyone's box (their part of it, as in Gramps) and the one being
// drawn. Boxes are in % of the picture, so they fit any size.
function boxes(m, img, stage) {
  const layer = h("div", { class: `vboxes${V.tagging ? " drawing" : ""}` });
  const fit = () => {
    const r = img.getBoundingClientRect(), s = stage.getBoundingClientRect();
    Object.assign(layer.style, { left: `${r.left - s.left}px`, top: `${r.top - s.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  };
  img.addEventListener("load", fit);
  V.fit = fit;
  if (!V.tagging) return layer;
  const box = (r, text, cls = "") => {
    const el = h("div", { class: `vbox ${cls}` }, text && h("span", {}, text));
    Object.assign(el.style, { left: `${r[0]}%`, top: `${r[1]}%`, width: `${r[2] - r[0]}%`, height: `${r[3] - r[1]}%` });  // (the CSP allows no style="")
    return el;
  };
  for (const p of Object.values(P)) if (p.crops?.[m]) layer.append(box(p.crops[m], name(p)));
  const mine = V.box && box(V.box, "", "new");
  if (mine) layer.append(mine);
  const at = e => {
    const r = layer.getBoundingClientRect(), c = v => Math.min(100, Math.max(0, Math.round(v)));
    return [c((e.clientX - r.left) / r.width * 100), c((e.clientY - r.top) / r.height * 100)];
  };
  let from = null, drawn = mine;
  layer.onpointerdown = e => { e.preventDefault(); from = at(e); layer.setPointerCapture(e.pointerId); };
  layer.onpointermove = e => {
    if (!from) return;
    const to = at(e);
    V.box = [Math.min(from[0], to[0]), Math.min(from[1], to[1]), Math.max(from[0], to[0]), Math.max(from[1], to[1])];
    drawn?.remove(); drawn = box(V.box, "", "new"); layer.append(drawn);
  };
  layer.onpointerup = () => {
    if (!from) return;
    from = null;
    if (!V.box || V.box[2] - V.box[0] < 3 || V.box[3] - V.box[1] < 3) V.box = null;  // a tap, not a box
    draw();
  };
  return layer;
}
function tagTools(m) {
  const done = h("button", { onclick: () => { V.tagging = false; V.box = null; V.err = ""; draw(); } }, "Done");
  if (!V.box) return h("div", { class: "vactions vtag" }, h("span", {}, "Drag a box around a face."), done);
  const q = h("input", { id: "vtag-q", type: "search", placeholder: "Type their name", autocomplete: "off" });
  const list = h("div", { class: "pick hits" });
  q.addEventListener("input", () => {
    const words = searchWords(q.value);
    const hits = !words.length ? [] : Object.values(P).filter(p => matches(p, words)).sort((a, b) => name(a).localeCompare(name(b)));
    list.replaceChildren(...hitRows(hits.slice(0, 8), p => tagAs(p, m), "This is them"));
  });
  setTimeout(() => q.focus());
  return h("div", { class: "vtag" },
    h("label", { for: "vtag-q" }, "Who is this?", q), list,
    V.err && h("div", { class: "warn" }, V.err),
    h("div", { class: "btnrow" }, h("button", { onclick: () => { V.box = null; V.err = ""; draw(); } }, "Cancel"), done));
}
async function tagAs(p, m) {
  const rect = V.box;
  try {
    await postJSON(`/tree/person/${p.id}/photos`, { media: m, do: "tag", rect });
  } catch (err) {
    if (err instanceof LoginNeeded) { closeViewer(); return showLogin(); }
    if (V) { V.err = `Not saved: ${err.message}`; draw(); }
    return;
  }
  if (!p.photos.includes(m)) p.photos = [...p.photos, m];
  p.photo ||= m;
  p.crops = { ...p.crops, [m]: rect };
  if (V) { V.box = null; V.err = ""; draw(); }
  renderAll();
}
addEventListener("resize", () => V?.fit?.());
// Keys while it's open: ← → between photos, Esc closes; nothing reaches the tree or the editor.
window.addEventListener("keydown", e => {
  if (!V) return;
  if (V.tagging && e.key === "Escape") { e.stopImmediatePropagation(); V.box ? (V.box = null) : (V.tagging = false); V.err = ""; return draw(); }
  if (e.target.closest?.(".vtag") && e.key !== "Tab") return e.stopImmediatePropagation();  // typing a name, choosing them
  if (e.key === "Escape") closeViewer();
  else if (e.key === "ArrowLeft") step(-1);
  else if (e.key === "ArrowRight") step(1);
  else if (e.key !== "Tab" && e.key !== "Enter" && e.key !== " ") e.preventDefault();
  if (e.key === "Tab") trapTab(e, $("#viewer"));  // keep Tab inside the view
  e.stopImmediatePropagation();
}, true);
// Swipe left or right on a phone or tablet.
let downX = null;
$("#viewer").addEventListener("pointerdown", e => { downX = V?.tagging ? null : e.clientX; });
$("#viewer").addEventListener("pointerup", e => {
  if (downX != null && Math.abs(e.clientX - downX) > 60 && e.target.closest(".vstage")) step(e.clientX < downX ? 1 : -1);
  downX = null;
});
