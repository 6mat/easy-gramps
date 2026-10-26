// Easy Gramps — ☰ Menu → Family documents: every file in Gramps that isn't a picture (a PDF book, letters…), added in
// Full Gramps (Media). Read opens a PDF in the browser's own viewer in a new tab; Download saves any of them.
import { api, BASE } from "./auth.js";
import { $, closeMenu, h, renewPhotos, thumbUrl } from "./common.js";
import { hideDlg, showDlg } from "./editor.js";

const KIND = { "application/pdf": "PDF", "application/msword": "Word", "text/plain": "Text",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word" };
const fileUrl = (d, download) => `${BASE}/gapi/media/${d.id}/file?name=${encodeURIComponent(d.title)}${download ? "&download=1" : ""}`;

$("#menu-docs").onclick = () => { closeMenu(); openDocs(); };
async function openDocs() {
  const list = h("div", { class: "doclist", role: "status" }, "Loading…");
  $("#dlg").replaceChildren(h("h3", { id: "dlg-title" }, "Family documents"), list,
    h("div", { class: "btnrow end" }, h("button", { onclick: hideDlg }, "Close")));
  showDlg(false);
  try {
    const [docs] = await Promise.all([api("/tree/documents"), renewPhotos()]);  // a fresh login for the file links
    list.removeAttribute("role");
    list.replaceChildren(...(docs.length ? docs.map(row)
      : [h("p", { class: "muted" }, "No family documents yet. The owner adds them in Full Gramps (Media).")]));
  } catch (err) { list.replaceChildren(h("div", { class: "warn" }, err.message)); }
}
function row(d) {
  const cover = h("img", { src: thumbUrl(d.id, 96), alt: "", loading: "lazy" });
  cover.onerror = () => cover.replaceWith(h("span", { class: "doccover", "aria-hidden": "true" }, "📄"));
  return h("div", { class: "docrow" }, cover,
    h("div", { class: "docmain" }, h("strong", {}, d.title), h("div", { class: "small muted" }, KIND[d.mime] || "File"),
      h("div", { class: "btnrow" },
        d.mime === "application/pdf" ? h("a", { class: "btn primary", href: fileUrl(d), target: "_blank", rel: "noopener" }, "Read") : "",
        h("a", { class: "btn", href: fileUrl(d, true), download: "" }, "Download"))));
}
