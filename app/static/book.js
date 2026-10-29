// Easy Gramps — a page of a book in our own viewer (PDF.js, in static/pdfjs): it opens at the page with the paragraph
// marked, and an editor marks the paragraph there by dragging a box over it. The box is the citation's "Page area"
// (familytree.py), in percent of the page. It's a browser-history step, like the photo view: Back closes it.
import { $, h, trapTab } from "./common.js";

let lib = null;
const books = new Map();  // the books opened this visit, by media id: the second time is instant
function load(media, url, say) {
  if (!books.has(media)) {
    books.set(media, (async () => {
      if (!lib) {
        lib = await import("./pdfjs/pdf.min.js");
        lib.GlobalWorkerOptions.workerSrc = new URL("./pdfjs/pdf.worker.min.js", import.meta.url).href;
      }
      const task = lib.getDocument({ url, isEvalSupported: false });
      task.onProgress = ({ loaded, total }) => total && say(`Loading the book… ${Math.round(loaded * 100 / total)}%`);
      return task.promise;
    })().catch(err => { books.delete(media); throw err; }));
  }
  return books.get(media);
}

let B = null;  // the open view: { media, url, whole, title, page, area, areaPage, mark, zoom, drawing, pdf, resolve, back, n, el }
// o: {media, url (the file), whole (the file in the browser's own viewer), title, page, area}. mark: an editor marks the
// paragraph; resolves to {page, area} on Save (area null: just the page), or null when closed.
export function openBook(o, mark = false) {
  const again = !!B;
  hide();  // (one already open gives up its place, history step and all)
  return new Promise(resolve => {
    const page = Math.max(1, parseInt(o.page, 10) || 1);
    B = { ...o, page, areaPage: o.area ? page : null, mark, zoom: 1, drawing: false, resolve, back: document.activeElement, n: 0 };
    if (!again) history.pushState({ ...history.state, eg: (history.state?.eg || 0) + 1, book: 1 }, "");
    $("#book").hidden = false;
    frame();
    $("#book .vclose").focus();
    load(B.media, B.url, t => { if (B) B.el.say.textContent = t; }).then(pdf => {
      if (!B || B.media !== o.media) return;
      B.pdf = pdf; B.page = Math.min(B.page, pdf.numPages); B.el.say.textContent = "";
      render(true);
    }, () => { if (B) B.el.say.textContent = "The book didn't open. Check the internet and try again."; });
  });
}
function hide(result = null) {
  if (!B) return;
  const { resolve, back } = B;
  B = null;
  $("#book").hidden = true; $("#book").replaceChildren();
  back?.isConnected && back.focus();
  resolve(result);
}
export function closeBook(result = null) { if (B) { hide(result); history.back(); } }  // (its history step goes too)
window.addEventListener("popstate", () => { if (B && !history.state?.book) hide(); });

function frame() {
  const el = B.el = {
    say: h("div", { class: "bsay", role: "status" }, "Loading the book…"),
    num: h("input", { type: "number", min: 1, class: "bnum", "aria-label": "Page number", enterkeyhint: "go" }),
    of: h("span"),
    page: h("div", { class: "bpage" }),
    box: h("div", { class: "bmark", hidden: true }),
    tools: h("div", { class: "btools" }),
  };
  el.canvas = h("canvas");
  el.page.append(el.canvas, el.box);
  el.stage = h("div", { class: "bstage" }, el.say, el.page);
  
  el.page.addEventListener("pointerdown", draw);
  el.num.onchange = () => go(parseInt(el.num.value, 10) || B.page);
  // Scrolling on past a page's end (or top) turns to the next (or last) one: a wheel, or one more finger swipe there.
  const s = el.stage, atEdge = by => by > 0 ? s.scrollTop + s.clientHeight >= s.scrollHeight - 2 : s.scrollTop <= 0;
  const flip = by => {
    if (Date.now() - (B.turned || 0) < 600 || !atEdge(by)) return;
    B.turned = Date.now(); turn(by, true);
  };
  s.addEventListener("wheel", e => e.deltaY && flip(Math.sign(e.deltaY)), { passive: true });
  let t0 = null;  // the swipe: one finger, not while drawing a box; it started at the edge it goes past
  s.addEventListener("touchstart", e => { t0 = e.touches.length === 1 && !B.drawing ? { y: e.touches[0].clientY, down: atEdge(1), up: atEdge(-1) } : null; }, { passive: true });
  s.addEventListener("touchend", e => {
    const dy = t0 && t0.y - e.changedTouches[0].clientY;
    if (dy > 60 && t0.down) flip(1); else if (dy < -60 && t0.up) flip(-1);
    t0 = null;
  }, { passive: true });
  el.next = h("button", { class: "bnext", onclick: () => turn(1) }, "Next page ›");
  $("#book").replaceChildren(
    h("div", { class: "vbar" }, h("strong", { class: "btitle" }, B.title || "Book"),
      h("button", { class: "vclose", onclick: () => closeBook() }, "✕ Close")),
    h("div", { class: "bnav" },
      h("button", { "aria-label": "Previous page", onclick: () => turn(-1) }, "‹"), h("label", { class: "bpg" }, "Page ", el.num, el.of),
      h("button", { "aria-label": "Next page", onclick: () => turn(1) }, "›"),
      h("button", { "aria-label": "Smaller", onclick: () => zoom(-1) }, "−"),
      h("button", { "aria-label": "Bigger", onclick: () => zoom(1) }, "+"),
      B.whole && h("a", { class: "glink", href: B.whole, target: "_blank", rel: "noopener" }, "Whole book ↗")),
    el.stage, el.tools);
  tools();
}
const ZOOMS = [1, 1.5, 2, 3];
function zoom(by) {
  const z = ZOOMS[Math.min(Math.max(ZOOMS.indexOf(B.zoom) + by, 0), ZOOMS.length - 1)];
  if (z !== B.zoom) { B.zoom = z; render(true); }  // (the marked paragraph back in view)
}
function turn(by, scrolled) { if (B?.pdf) go(B.page + by, scrolled && by < 0); }
function go(to, atEnd) {
  const p = Math.min(Math.max(to, 1), B.pdf.numPages);
  B.el.num.value = p;
  if (p !== B.page) { B.page = p; B.atEnd = atEnd; B.el.stage.scrollTop = 0; render(); }
}

// Draw the page to fit the screen's width (at most 900px, then zoomed), sharp on the screen it's on.
async function render(first) {
  const n = ++B.n, el = B.el;  // a newer render wins
  el.num.value = B.page; el.num.max = B.pdf.numPages; el.of.textContent = ` of ${B.pdf.numPages}`;
  el.next.hidden = B.page >= B.pdf.numPages;
  const page = await B.pdf.getPage(B.page);
  if (!B || n !== B.n) return;
  const fit = Math.min(el.stage.clientWidth - 16, 900) * B.zoom;
  const vp = page.getViewport({ scale: fit / page.getViewport({ scale: 1 }).width });
  const px = Math.min(devicePixelRatio || 1, 2.5, Math.sqrt(16e6 / (vp.width * vp.height)));  // phones refuse huge canvases
  const c = h("canvas", { "aria-label": `Page ${B.page} of ${B.title || "the book"}` });
  c.width = Math.floor(vp.width * px); c.height = Math.floor(vp.height * px);
  await page.render({ canvasContext: c.getContext("2d"), viewport: vp, transform: px === 1 ? null : [px, 0, 0, px, 0, 0] }).promise;
  if (!B || n !== B.n) return;
  el.page.style.width = `${vp.width}px`; el.page.style.height = `${vp.height}px`;
  el.canvas.replaceWith(c); el.canvas = c;
  if (!el.next.isConnected) el.stage.append(el.next);
  if (B.atEnd) { B.atEnd = false; el.stage.scrollTop = el.stage.scrollHeight; }  // scrolled up into it: its bottom
  showBox();
  if (first && !el.box.hidden) el.box.scrollIntoView({ block: "center", inline: "center" });
}
function showBox() {
  const { box } = B.el, a = B.area;
  box.hidden = !a || B.areaPage !== B.page;
  if (!box.hidden) Object.assign(box.style, { left: `${a[0]}%`, top: `${a[1]}%`, width: `${a[2] - a[0]}%`, height: `${a[3] - a[1]}%` });
}

// Marking (editors): with a mouse, drag on the page; on a phone, press "Draw a box" first, so a finger still scrolls.
function draw(e) {
  if (!B?.mark || !B.pdf || !(e.pointerType === "mouse" || B.drawing)) return;
  e.preventDefault();
  const page = B.el.page, r = page.getBoundingClientRect();
  const at = ev => [(ev.clientX - r.left) / r.width * 100, (ev.clientY - r.top) / r.height * 100].map(v => Math.min(Math.max(v, 0), 100));
  const [x0, y0] = at(e);
  page.setPointerCapture(e.pointerId);
  page.onpointermove = ev => {
    const [x, y] = at(ev);
    B.area = [Math.min(x0, x), Math.min(y0, y), Math.max(x0, x), Math.max(y0, y)]; B.areaPage = B.page;
    showBox();
  };
  page.onpointerup = page.onpointercancel = () => {
    page.onpointermove = page.onpointerup = page.onpointercancel = null;
    if (B.area && (B.area[2] - B.area[0] < 2 || B.area[3] - B.area[1] < 1)) B.area = null;  // a tap, not a box
    B.drawing = false; page.classList.remove("drawing");
    showBox(); tools();
  };
}
function tools() {
  const { el } = B;
  el.page.classList.toggle("marking", B.mark);
  if (!B.mark) return el.tools.replaceChildren();
  const pen = h("button", { "aria-pressed": String(B.drawing), class: B.drawing ? "on" : "" }, "✏️ Draw a box");
  pen.onclick = () => { B.drawing = !B.drawing; el.page.classList.toggle("drawing", B.drawing); tools(); };
  el.tools.replaceChildren(
    h("span", { class: "bhint" }, B.drawing ? "Now drag over the paragraph."
      : B.area ? `Marked on page ${B.areaPage} ✓ Draw again to change it.` : "Go to the paragraph, press ✏️ Draw a box, then drag over it."),
    h("div", { class: "btnrow" }, pen,
      B.area && h("button", { onclick: () => { B.area = B.areaPage = null; showBox(); tools(); } }, "Clear the box"),
      h("button", { class: "primary", onclick: () => closeBook({ page: String(B.areaPage ?? B.page), area: B.area || null }) },
        B.area ? "Save" : "Save without a box")));
}

// Keys while it's open (not while typing a page number): ← → turn pages, + − size, Esc closes; nothing reaches the tree or the editor.
window.addEventListener("keydown", e => {
  if (!B) return;
  if (e.key === "Escape") closeBook();
  else if (e.target === B.el.num && e.key !== "Tab") return e.stopImmediatePropagation();  // typing a page number
  else if (e.key === "ArrowLeft") turn(-1);
  else if (e.key === "ArrowRight") turn(1);
  else if (e.key === "+" || e.key === "=") zoom(1);
  else if (e.key === "-") zoom(-1);
  else if (e.key === "Tab") trapTab(e, $("#book"));
  e.stopImmediatePropagation();
}, true);
let wide = innerWidth;
window.addEventListener("resize", () => { if (B?.pdf && innerWidth !== wide) { wide = innerWidth; render(); } });
