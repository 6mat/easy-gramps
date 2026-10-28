// Easy Gramps — ☰ Menu → Family documents: every file in Gramps that isn't a picture (a PDF book, letters…), added in
// Full Gramps (Media). Read opens a PDF in the browser's own viewer in a new tab; Download saves any of them. Each link
// carries a ticket for that file (main.py file_ticket): an installed app's new tab may not have the login cookie.
import { api, BASE, refreshLogin } from "./auth.js";
import { $, closeMenu, h, postJSON, thumbUrl } from "./common.js";
import { hideDlg, showDlg, toast } from "./editor.js";
import { openBook } from "./book.js";

const KIND = { "application/pdf": "PDF", "application/msword": "Word", "text/plain": "Text",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word" };
const fileUrl = (d, download) => `${BASE}/gapi/media/${d.id}/file?ticket=${d.ticket}&name=${encodeURIComponent(d.title)}${download ? "&download=1" : ""}`;

$("#menu-docs").onclick = () => { closeMenu(); openDocs(); };
async function openDocs() {
  const list = h("div", { class: "doclist", role: "status" }, "Loading…");
  $("#dlg").replaceChildren(h("h3", { id: "dlg-title" }, $("#menu-docs").textContent), list,  // the owner may rename it
    h("div", { class: "btnrow end" }, h("button", { onclick: hideDlg }, "Close")));
  showDlg(false);
  try {
    await refreshLogin();  // a login with its full time ahead: the links stand for it (10 minutes, main.py file_ticket)
    const docs = await api("/tree/documents");
    list.removeAttribute("role");
    list.replaceChildren(...(docs.length ? docs.map(row)
      : [h("p", { class: "muted" }, "Nothing here yet. The owner adds files in Full Gramps (Media).")]));
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

// ---------- a page of a book on a person (a Gramps citation; familytree.py books) ----------
// A PDF opens in our own viewer (book.js) at that page, with the paragraph marked; anything else in a new tab. A fresh
// ticket each time: the one that came with the details lasts 10 minutes.
async function fresh(pid, b) {
  await refreshLogin();
  const x = (await api(`/tree/details/${pid}`)).books.find(y => y.id === b.id);
  if (!x) throw new Error("That page isn't on this person any more.");
  const url = fileUrl({ id: x.media, ticket: x.ticket, title: x.title });
  return { ...x, url, whole: `${url}${parseInt(x.page, 10) > 0 ? `#page=${parseInt(x.page, 10)}` : ""}` };
}
async function readBook(pid, b) {
  if (b.mime !== "application/pdf") {
    const w = window.open("", "_blank");  // (before the wait, or the browser blocks it)
    try { w.location = (await fresh(pid, b)).whole; } catch (err) { w?.close(); toast(err.message, false); }
    return;
  }
  try { openBook(await fresh(pid, b)); } catch (err) { toast(err.message, false); }
}
const bookText = b => `📖 ${b.title || "Book"}${b.page ? `, page ${b.page}` : ""}${b.area ? " (marked)" : ""}`;
export function bookLinks(p) {
  return (p.books || []).map(b => h("button", { class: "linkish bookline", onclick: () => readBook(p.id, b) }, bookText(b)));
}
// The editor's list (editors): each page with Mark the paragraph and Remove, and "+ Add a book page" (pick the
// document; a PDF then opens at the page typed, to go to the paragraph and mark it).
export function bookEditor(p, saved) {
  const box = h("div", { class: "full books" }, h("div", { class: "flabel" }, "Book pages about them"));
  const call = async (path, body, btn) => {
    btn.disabled = true;
    try { await postJSON(`/tree/person/${p.id}/books${path}`, body); await saved(); }
    catch (err) { btn.disabled = false; box.append(h("div", { class: "warn" }, err.message)); }
  };
  for (const b of p.books || []) {
    const rm = h("button", {}, "Remove");
    rm.onclick = () => { if (rm.dataset.sure !== "1") { rm.dataset.sure = "1"; rm.textContent = "Confirm remove"; } else call("/remove", { id: b.id }, rm); };
    const mark = b.mime === "application/pdf" && h("button", {}, b.area ? "Change the mark" : "Mark the paragraph");
    if (mark) mark.onclick = async () => {
      let x;
      try { x = await fresh(p.id, b); } catch (err) { return box.append(h("div", { class: "warn" }, err.message)); }
      const got = await openBook(x, true);
      if (got) call("/mark", { id: b.id, ...got }, mark);
    };
    box.append(h("div", { class: "bookrow" }, h("button", { class: "linkish", onclick: () => readBook(p.id, b) }, bookText(b)),
      h("div", { class: "btnrow" }, mark, rm)));
  }
  const open = h("button", {}, "+ Add a book page");
  open.onclick = async () => {
    open.disabled = true;
    let docs;
    try { await refreshLogin(); docs = await api("/tree/documents"); } catch (err) { open.disabled = false; return box.append(h("div", { class: "warn" }, err.message)); }
    if (!docs.length) return open.replaceWith(h("div", { class: "small muted" }, "No books yet. The owner adds them in Full Gramps (Media)."));
    const pick = h("select", { id: "book-doc" }, ...docs.map(d => h("option", { value: d.id }, d.title)));
    const page = h("input", { id: "book-page", inputmode: "numeric", maxlength: 50, autocomplete: "off", placeholder: "1" });
    const add = h("button", { class: "primary" });
    const pdf = () => docs.find(d => d.id === pick.value)?.mime === "application/pdf";
    const label = () => { add.textContent = pdf() ? "Next: mark the paragraph" : "Add"; };
    pick.onchange = label; label();
    add.onclick = async () => {
      const d = docs.find(x => x.id === pick.value);
      if (!pdf()) return page.value.trim() ? call("", { media: d.id, page: page.value.trim() }, add) : page.focus();
      const url = fileUrl(d);
      const got = await openBook({ media: d.id, url, whole: url, title: d.title, page: page.value.trim() }, true);
      if (got) call("", { media: d.id, ...got }, add);
    };
    open.replaceWith(h("div", { class: "bookform" }, h("label", { for: "book-doc" }, "Book", pick), h("label", { for: "book-page" }, "Page", page), add));
    pick.focus();
  };
  box.append(open);
  return box;
}
