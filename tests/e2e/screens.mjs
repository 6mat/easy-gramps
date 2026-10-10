// Every-screen check for Easy Gramps, run against a local app that talks to the public Gramps Web demo.
//
//   APP=http://localhost:8095/family/ node tests/e2e/screens.mjs            # read-only (member login)
//   APP=http://localhost:8095/family/ node tests/e2e/screens.mjs --write    # also edits, as "editor"
//
// --write creates throwaway people named "ZZTEST …" on the demo and deletes them again at the end
// (and any ZZTEST leftovers from an earlier run). Never point it at a real family tree.
// Fails (exit 1) on any Content-Security-Policy violation, page error, console error or 5xx.
import { chromium } from "playwright";
import fs from "node:fs";

const APP = process.env.APP || "http://localhost:8095/family/";
const DEMO = process.env.GRAMPS_DEMO || "https://demo.grampsweb.org";
const WRITE = process.argv.includes("--write");
const SHOTS = process.env.SHOTS || "";  // folder for screenshots, optional
const T = 60000;  // the demo is slow: loading the whole tree takes several seconds
const problems = [], steps = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});

async function newPage(viewport = { width: 1366, height: 900 }) {
  const ctx = await browser.newContext({ viewport, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(T);
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener("securitypolicyviolation", e => window.__csp.push(`${e.violatedDirective} ${e.blockedURI || "inline"} ${e.sourceFile || ""}:${e.lineNumber || ""}`));
  });
  page.on("pageerror", e => problems.push(`page error: ${e.message}`));
  page.on("console", m => {
    if (m.type() !== "error") return;
    const t = m.text();
    // 401 on the first /auth/me (not logged in yet) and blocked outside fonts in sandboxes are expected noise.
    if (/401 \(Unauthorized\)|ERR_CERT_AUTHORITY_INVALID|fonts\.g/.test(t)) return;
    problems.push(`console: ${t}`);
  });
  page.on("response", r => { if (r.status() >= 500 && r.url().startsWith(APP)) problems.push(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`); });
  return page;
}
async function step(page, name, fn) {
  const t0 = Date.now();
  try { await fn(); steps.push(`ok   ${name}`); }
  catch (e) { steps.push(`FAIL ${name}: ${e.message.split("\n")[0]}`); problems.push(`step "${name}" failed`); }
  console.log(`${steps.at(-1)}  (${Math.round((Date.now() - t0) / 1000)}s)`);
  const csp = await page.evaluate(() => window.__csp.splice(0)).catch(() => []);
  for (const c of csp) problems.push(`CSP (${name}): ${c}`);
  // A value that slipped onto the screen as a word ("false" under a name, #1.3.2): never shown on purpose.
  const stray = await page.evaluate(() => document.body.innerText.match(/\b(false|undefined|null|NaN)\b/)?.[0]).catch(() => null);
  if (stray) problems.push(`"${stray}" shown on screen (${name})`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${String(steps.length).padStart(2, "0")}-${name.replace(/\W+/g, "-")}.png` }).catch(() => {});
}
async function login(page, user) {
  await page.goto(APP);
  await page.fill("#lg-user", user); await page.fill("#lg-pass", user);
  await page.click(".login-form button[type=submit]");
  await page.waitForSelector("#gate", { state: "hidden" });
}
const status = page => page.textContent("#ed-status");
async function saved(page) { await page.waitForFunction(() => /Saved/.test(document.querySelector("#ed-status").textContent)); }

// ---------- Gramps API (cleanup of ZZTEST records) ----------
async function grampsToken(user) {
  for (let i = 0; i < 10; i++) {
    const r = await fetch(`${DEMO}/api/token/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: user, password: user }) });
    if (r.ok) return (await r.json()).access_token;
    await sleep(3000);  // Gramps limits logins per IP
  }
  throw new Error("couldn't log in to the demo");
}
async function cleanup() {
  const tok = await grampsToken("editor");
  const g = (path, opts = {}) => fetch(`${DEMO}/api${path}`, { ...opts, headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json", ...(opts.headers || {}) } });
  const people = await (await g("/people/?keys=handle,primary_name,family_list,parent_family_list,event_ref_list,note_list,media_list")).json();
  const zz = p => [p.primary_name.first_name || "", ...(p.primary_name.surname_list || []).map(s => s.surname || "")].some(x => x.includes("ZZTEST"));
  const mine = people.filter(zz), ids = new Set(mine.map(p => p.handle));
  const fams = new Set(mine.flatMap(p => [...(p.family_list || []), ...(p.parent_family_list || [])]));
  const events = new Set(mine.flatMap(p => (p.event_ref_list || []).map(r => r.ref)));
  const notes = new Set(mine.flatMap(p => p.note_list || []));
  const media = new Set(mine.flatMap(p => (p.media_list || []).map(m => m.ref)));
  for (const fh of fams) {
    const r = await g(`/families/${fh}`); if (!r.ok) continue;
    const f = await r.json();
    const members = [f.father_handle, f.mother_handle, ...(f.child_ref_list || []).map(c => c.ref)].filter(Boolean);
    if (!members.every(m => ids.has(m))) continue;  // never touch a family that has real people in it
    (f.event_ref_list || []).forEach(e => events.add(e.ref));
    await g(`/families/${fh}`, { method: "PUT", body: JSON.stringify({ ...f, father_handle: null, mother_handle: null, child_ref_list: [] }) });
    await g(`/families/${fh}`, { method: "DELETE" });  // the demo answers 500 here even when it worked
  }
  for (const p of mine) {
    const r = await g(`/people/${p.handle}`, { method: "DELETE" });
    if (r.status >= 500) {  // the demo refuses when the person still points at a family that's gone: clear that, retry
      const cur = await g(`/people/${p.handle}`); if (!cur.ok) continue;
      const fresh = await cur.json();
      const alive = async hs => (await Promise.all((hs || []).map(async f => (await g(`/families/${f}`)).ok ? f : null))).filter(Boolean);
      fresh.family_list = await alive(fresh.family_list); fresh.parent_family_list = await alive(fresh.parent_family_list);
      await g(`/people/${p.handle}`, { method: "PUT", body: JSON.stringify(fresh) });
      await g(`/people/${p.handle}`, { method: "DELETE" });
    }
  }
  const unused = async (kind, h) => { const r = await g(`/${kind}/${h}?backlinks=1`); if (!r.ok) return false; const j = await r.json(); return !Object.values(j.backlinks || {}).some(v => v.length); };
  for (const [kind, set] of [["events", events], ["notes", notes], ["media", media]])
    for (const h of set) if (await unused(kind, h)) await g(`/${kind}/${h}`, { method: "DELETE" });
  // Photos taken off a ZZTEST person stay in Gramps (on purpose): delete those too.
  for (const m of await (await g("/media/?keys=handle,desc")).json())
    if ((m.desc || "").startsWith("Photo of ZZTEST") && await unused("media", m.handle)) await g(`/media/${m.handle}`, { method: "DELETE" });
  const places = await (await g("/places/?keys=handle,name")).json();
  for (const pl of places) if (pl.name.value.startsWith("ZZTEST") && await unused("places", pl.handle)) await g(`/places/${pl.handle}`, { method: "DELETE" });
  const left = (await (await g("/people/?keys=handle,primary_name")).json()).filter(zz).length;
  return `${mine.length} ZZTEST people removed, ${left} left`;
}

// ---------- read-only: every screen as a Member ----------
{
  const page = await newPage();
  await step(page, "login screen", async () => { await page.goto(APP); await page.waitForSelector("#lg-user"); });
  await step(page, "installable as an app", async () => {  // what Chrome's "Install app" needs
    const cdp = await page.context().newCDPSession(page);
    const m = await cdp.send("Page.getAppManifest");
    if (!m.url || m.errors.length) throw new Error(`manifest: ${m.url || "none"} ${JSON.stringify(m.errors)}`);
    await page.evaluate(() => navigator.serviceWorker.ready);
    const errs = (await cdp.send("Page.getInstallabilityErrors")).installabilityErrors;
    if (errs.length) throw new Error(`can't be installed: ${errs.map(e => e.errorId).join(", ")}`);
    await cdp.detach();
  });
  await step(page, "log in", () => login(page, "member"));
  await step(page, "start screen", async () => { await page.waitForSelector("#start-q"); await page.waitForSelector(".recentgrid"); });
  await step(page, "start search: preview and keys", async () => {
    await page.fill("#start-q", "Stewart");  // a surname in the demo tree
    await page.click("#startcard .hit .info >> nth=0");
    await page.waitForSelector("#startcard .preview:not([hidden]) button:has-text('See their tree')");
    await page.focus("#start-q");
    for (const k of ["ArrowDown", "ArrowDown", "ArrowRight"]) await page.keyboard.press(k);
    const open = await page.$$eval("#startcard .hit", rows => rows.map(r => !r.querySelector(".preview").hidden));
    if (open.join() !== [false, true, ...open.slice(2).map(() => false)].join()) throw new Error(`→ opened the wrong preview: ${open}`);
    for (const k of ["ArrowLeft", "ArrowUp", "ArrowUp"]) await page.keyboard.press(k);
    if (await page.evaluate(() => document.activeElement.id) !== "start-q") throw new Error("↑ didn't go back to the search box");
  });
  await step(page, "no one found", async () => {
    await page.fill("#start-q", "ZZTEST nobody"); await page.waitForSelector("#startcard .nohit");
    if (await page.$("#startcard .nohit .addnew")) throw new Error("a Member is offered to add someone");
  });
  await step(page, "start search + open a tree", async () => {
    await page.fill("#start-q", "Stewart");
    await page.click("#startcard .hitmain >> nth=0");
    await page.waitForSelector(".node.focus");
  });
  await step(page, "select someone, panel", async () => {
    await page.click(".node:not(.focus) >> nth=0");
    await page.waitForSelector("#panel.sel-view");
  });
  await step(page, "more details", async () => { await page.click("#panel .moretoggle"); await page.waitForSelector("#panel .details"); });
  await step(page, "see their tree, back", async () => {
    await page.click("#tree-see"); await page.waitForSelector("#tree-back:not([hidden])");
    await page.click("#tree-back"); await page.waitForSelector("#tree-back[hidden]", { state: "attached" });
  });
  await step(page, "hide panel, quick card", async () => {
    await page.click("#panel .pill.hide"); await page.waitForSelector("#show-panel:not([hidden])");
    await page.click(".node:not(.focus) >> nth=0"); await page.waitForSelector("#popcard:not([hidden])");
    await page.click("#show-panel"); await page.waitForSelector("#panel.sel-view, #panel.focus-view");
  });
  await step(page, "zoom buttons + map", async () => {
    for (const b of ["#z-in", "#z-out", "#z-fit", "#z-centre"]) { await page.click(b); await sleep(200); }
    await page.click("#minimap", { force: true });
    await page.click("#nav-hide"); await page.click("#nav-show");
  });
  await step(page, "keyboard", async () => {
    await page.click(".node.focus"); for (const k of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Escape"]) await page.keyboard.press(k);
    await page.keyboard.press("?"); await page.waitForSelector("table.keys"); await page.keyboard.press("Escape");
    const pct = await page.textContent("#z-pct"); await page.keyboard.press("+");
    if (await page.textContent("#z-pct") === pct) throw new Error("+ didn't zoom");
    await page.keyboard.press("0");
    await page.focus(".node.focus"); await page.keyboard.press("Enter"); await page.waitForSelector("#editor:not([hidden])");
    await page.keyboard.press("Escape"); await page.waitForSelector("#editor", { state: "hidden" });
  });
  await step(page, "full screen", async () => {  // the top bar hides, so ⌂ Home shows in the tree's title strip
    if (await page.isVisible("#tree-home")) throw new Error("⌂ Home pill shown outside full screen");
    await page.click("#z-full"); await page.waitForSelector("body.fullmode"); await page.waitForSelector("#tree-home", { state: "visible" });
    await page.click("#z-full");
  });
  await step(page, "photo bigger from the panel; Esc and Back close it", async () => {
    await page.fill("#q", "Elizabeth II"); await page.click("#results .hitmain >> nth=0");
    await page.click("#panel .phbtn"); await page.waitForSelector("#viewer:not([hidden]) .vstage img");
    await page.keyboard.press("Escape"); await page.waitForSelector("#viewer", { state: "hidden" });
    const at = page.url();
    await page.click("#panel .phbtn"); await page.waitForSelector("#viewer:not([hidden])");
    await page.goBack(); await page.waitForSelector("#viewer", { state: "hidden" });
    if (page.url() !== at || !(await page.isVisible(".node.focus"))) throw new Error("Back did more than close the photo");
  });
  await step(page, "top search: photos, preview, no one found", async () => {
    await page.fill("#q", "Stewart"); await page.waitForSelector("#results .hit .hitmain .ph");
    await page.click("#results .hit .info >> nth=0"); await page.waitForSelector("#results .preview:not([hidden])");
    await page.fill("#q", "ZZTEST nobody"); await page.waitForSelector("#results .nohit");
    await page.fill("#q", "");
  });
  await step(page, "menu: date format, kept with the login", async () => {
    const saved = () => page.evaluate(() => fetch(`${document.documentElement.dataset.base}/auth/me`,
      { headers: { Authorization: `Bearer ${localStorage.access_token || localStorage.eg_access}` } }).then(r => r.json()).then(u => u.settings.dates));
    await page.click("#menubtn"); await page.selectOption("#datefmt", "y-m-d"); await sleep(1000);
    if (await saved() !== "y-m-d") throw new Error("the date format wasn't saved with the login");
    await page.selectOption("#datefmt", "d mon y"); await sleep(1000); await page.click("#menubtn");
  });
  await step(page, "menu: theme, bigger text, line, tips", async () => {
    await page.click("#menubtn");
    for (const t of ["dark", "light", "system"]) await page.click(`label:has(#th-${t})`);
    await page.click("label:has(#bigtext)"); await page.click("label:has(#bigtext)");
    await page.click("label:has(#showlink)"); await page.click("label:has(#showlink)");
    await page.click("#tips-again"); await page.click("#tip-close");
  });
  await step(page, "portrait / narrow", async () => { await page.setViewportSize({ width: 800, height: 1100 }); await sleep(500); await page.setViewportSize({ width: 1366, height: 900 }); });
  await step(page, "log out", async () => { await page.click("#menubtn"); await page.click("#logout"); await page.waitForSelector("#lg-user"); });
  await page.context().close();
}

// ---------- editing, as an Editor (ZZTEST records only) ----------
if (WRITE) {
  console.log("cleanup before:", await cleanup());
  await sleep(1500);
  const page = await newPage();
  await step(page, "editor log in", () => login(page, "editor"));
  await step(page, "add a new person (start screen)", async () => {
    await page.click("button.pill:has-text('Add a new person')");
    await page.fill("#np-first", "ZZTEST"); await page.fill("#np-last", "Screen");
    await page.click("label[for=np-g-m]");
    await page.click(".newperson button.primary");
    await page.waitForSelector("#editor:not([hidden]) #ed-first");
  });
  await step(page, "editor fields autosave", async () => {
    await page.fill("#ed-nick", "Screenie");
    await page.fill("#ed-birth-date", "1950-05-04");
    const sent = [];  // what the editor saves: places must be picked or confirmed, never made while typing (#49)
    const rec = r => { if (r.method() === "PATCH") sent.push(r.postData()); };
    page.on("request", rec);
    await page.fill("#ed-bplace", "Lond");
    await page.click("#ed-bplace-list li:has-text('London') >> nth=0");
    await page.click("label[for=ed-passed]");
    await page.fill("#ed-death-date", "2020-01-02");
    await page.fill("#ed-burial", "ZZTEST Cemetery"); await page.press("#ed-burial", "Tab");
    await page.click(".place button:has-text('Add it as a new place')");
    await page.click("button.full:has-text('More details')");
    await page.fill("#ed-res", "ZZTEST City"); await page.fill("#ed-phone", "555-0100");
    await page.fill("#ed-email", "zztest@example.com"); await page.fill("#ed-notes", "ZZTEST note");
    await sleep(1000); await saved(page);
    await page.click("label[for=ed-birth-yo]"); await page.fill("#ed-birth-year", "1951");
    await sleep(1000); await saved(page);
    page.off("request", rec);
    const places = sent.flatMap(b => Object.entries(JSON.parse(b)).filter(([k]) => k === "birthPlace" || k === "burial").map(([, v]) => v));
    if (places.length !== 2 || !places[0].id || places[1].new !== "ZZTEST Cemetery") throw new Error(`places saved as ${JSON.stringify(places)}`);
  });
  await step(page, "photo upload", async () => {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    await page.setInputFiles("#ed-photo-file", { name: "zztest.png", mimeType: "image/png", buffer: png });
    await page.waitForFunction(() => /Saved/.test(document.querySelector("#ed-status").textContent) && !document.querySelector(".centre .ph img")?.src.startsWith("data:"));
  });
  await step(page, "more photos: add, big view, profile photo, remove, Back", async () => {
    const png = c => Buffer.from(`iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==`, "base64");
    await page.setInputFiles("#ed-photos-file", [{ name: "zztest2.png", mimeType: "image/png", buffer: png() }, { name: "zztest3.png", mimeType: "image/png", buffer: png() }]);
    await page.waitForFunction(() => document.querySelectorAll(".phtile").length === 3 && /Saved/.test(document.querySelector("#ed-status").textContent), null, { timeout: T });
    const bar = () => page.textContent("#viewer .vbar");
    await page.click(".phtile >> nth=2"); await page.waitForSelector("#viewer:not([hidden])");
    if (!/3 of 3/.test(await bar())) throw new Error(`opened at ${await bar()}`);
    await page.keyboard.press("ArrowLeft"); if (!/2 of 3/.test(await bar())) throw new Error("← didn't go back a photo");
    const second = await page.getAttribute("#viewer .vstage img", "src");
    await page.click("#viewer button:has-text('Use as profile photo')");
    await page.waitForSelector("#viewer :text('★ Profile photo')");
    if (!/1 of 3/.test(await bar()) || await page.getAttribute("#viewer .vstage img", "src") !== second) throw new Error("the profile photo didn't move first");
    await page.click("#viewer button:has-text('Remove from this person')"); await page.click("#viewer button:has-text('Yes, remove it')");
    await page.waitForFunction(() => /1 of 2/.test(document.querySelector("#viewer .vbar").textContent));
    await page.keyboard.press("Escape"); await page.waitForSelector("#viewer", { state: "hidden" });
    if (await page.locator(".phtile").count() !== 2) throw new Error("the removed photo is still in the editor");
    await page.click(".phtile >> nth=1"); await page.waitForSelector("#viewer:not([hidden])");
    await page.goBack(); await page.waitForSelector("#viewer", { state: "hidden" });
    if (!(await page.isVisible("#editor"))) throw new Error("Back closed the editor too");
  });
  const addNew = async (slot, first, last) => {
    await page.click(`button.ed-slot:has-text('${slot}') >> nth=0`);
    await page.fill("#add-first", first); await page.fill("#add-last", last);
    const g = await page.$("label[for=add-g-m]"); if (g) await g.click();
    await page.click("#dlg button.primary");
    const dup = page.locator("#dlg button:has-text('No, add as someone new')");
    await Promise.race([page.waitForSelector("#toast:not([hidden])"), dup.waitFor().then(() => dup.click())]);
    await page.waitForSelector("#toast:not([hidden])"); await saved(page);
  };
  await step(page, "add father (new) + undo", async () => {
    await addNew("Add father", "ZZTEST", "Dad");
    await page.click("#toast-undo"); await page.waitForFunction(() => document.querySelector("#toast-msg").textContent === "Undone");
  });
  await step(page, "add mother, spouse, child", async () => {
    await addNew("Add mother", "ZZTEST", "Mum");
    await addNew("Add wife", "ZZTEST", "Wife");
    await addNew("Add child", "ZZTEST", "Kid");
  });
  await step(page, "add someone already in the tree", async () => {
    await page.click("button.ed-slot:has-text('Add father')");
    await page.waitForSelector("#add-first");  // opens on "someone new"; the search is one tap away
    if (await page.$("#add-q")) throw new Error("search box shown before choosing 'already in the tree'");
    await page.click("#dlg .addmode:has-text('already in the tree')");
    await page.fill("#add-q", "ZZTEST Kid"); await page.waitForTimeout(300);
    if (await page.$("#dlg .hit")) throw new Error("someone already in this family was offered");
    await page.fill("#add-q", "Victoria");  // someone outside this family (only previewed, never chosen)
    await page.click("#dlg .hit .info >> nth=0");  // ⓘ: who is it, before linking them
    await page.waitForSelector("#dlg .preview:not([hidden]) button:has-text('Choose')");
    await page.click("#dlg button:has-text('Cancel')");
  });
  await step(page, "remove a link + undo", async () => {
    await page.click(".rcard:has-text('ZZTEST Kid') button.more");
    await page.click(".rcard .menu button.danger");
    await page.click(".rcard .menu button.danger:has-text('Remove')");
    await page.waitForSelector("#toast:not([hidden])");
    await page.click("#toast-undo"); await page.waitForFunction(() => document.querySelector("#toast-msg").textContent === "Undone");
  });
  await step(page, "open a relative's family, crumbs", async () => {
    await page.click(".rcard:has-text('ZZTEST Mum') button.more");
    await page.click(".rcard .menu button:has-text('family')");
    await page.waitForSelector("#crumbs button");
    await page.click("#crumbs button");
  });
  await step(page, "back to tree", async () => { await page.click("#ed-back"); await page.waitForSelector("#editor", { state: "hidden" }); await page.waitForSelector(".node.focus"); });
  await step(page, "add from a tree slot", async () => {
    await page.click(".tslot:has-text('Add father')");
    await page.waitForSelector("#dlg-wrap:not([hidden])");
    await page.click("#dlg button:has-text('Cancel')");
    await page.click("#ed-back"); await page.waitForSelector("#editor", { state: "hidden" });
  });
  await step(page, "merge dialog: find, compare, swap, combine", async () => {
    await page.click(".node:has-text('ZZTEST Wife')"); await page.waitForSelector("#panel .dupbtn");
    await page.click("#panel .dupbtn");
    if (!/Duplicate profile\? Merge\./.test(await page.textContent("#dlg-title"))) throw new Error("old title");
    await page.fill("#merge-q", "ZZTEST Mum");
    await page.click("#merge-list .info >> nth=0"); await page.waitForSelector("#merge-list .preview:not([hidden])");
    await page.click("#merge-list .hitmain >> nth=0");
    await page.waitForSelector(".cmp");
    await page.click(".cmphead .swap"); await page.click(".cmphead .swap");
    await page.fill("#cmp-last", "Merged");
    await page.click("#dlg button.primary"); await page.click("#dlg button.danger");
    await page.waitForFunction(() => /Combined/.test(document.querySelector("#toast-msg").textContent));
  });
  await step(page, "a mother who is already his wife: no couple twice; a couple listed twice: combine", async () => {
    const api = (path, body) => page.evaluate(([path, body]) => fetch(`${document.documentElement.dataset.base}${path}`, {
      method: body ? "POST" : "GET", body: body && JSON.stringify(body),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.access_token || localStorage.eg_access}` } }).then(r => r.json()), [path, body]);
    const pa = (await api("/tree/person", { first: "ZZTEST", last: "Pa", gender: "m" })).added;
    const ma = (await api("/tree/relative", { person: pa, rel: "spouse", new: { first: "ZZTEST", last: "Ma" } })).added;
    const son = await api("/tree/relative", { person: pa, rel: "child", new: { first: "ZZTEST", last: "Son" } });  // with Pa only
    await api("/tree/relative", { person: pa, rel: "child", famId: son.famId, new: { first: "ZZTEST", last: "Girl" } });
    const couples = async () => (await api("/tree/graph")).families.filter(f => f.f === pa && f.m === ma);
    await page.goto(`${APP}#/p/${son.added}/edit/${son.added}`); await page.reload();
    await page.click("#editor:not([hidden]) button.ed-slot:has-text('Add mother')", { timeout: T });
    await page.waitForSelector("#dlg .note:has-text('same family')");  // the sister gets this mother too: said first
    await page.click("#dlg .addmode:has-text('already in the tree')");
    await page.fill("#add-q", "ZZTEST Ma"); await page.click("#dlg .hit .hitmain >> nth=0");
    await page.waitForFunction(() => /already had with/.test(document.querySelector("#toast-msg").textContent), null, { timeout: T });
    let c = await couples();
    if (c.length !== 1 || c[0].kids.length !== 2) throw new Error(`couple recorded ${c.length} times, ${c[0]?.kids.length} children`);
    // The couple recorded twice straight in Gramps (as a half-done tidy-up there can leave it): the editor offers to combine.
    const tok = await grampsToken("editor");
    await fetch(`${DEMO}/api/objects/`, { method: "POST", headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify([{ _class: "Family", handle: crypto.randomUUID().replace(/-/g, ""), father_handle: pa, mother_handle: ma, child_ref_list: [], type: "Married" }]) });
    await page.goto(`${APP}#/p/${pa}/edit/${pa}`); await page.reload();
    await page.click(".twice button:has-text('Combine them')", { timeout: T });
    await page.click(".twice button:has-text('Yes, combine')");
    await page.waitForFunction(() => /Combined/.test(document.querySelector("#toast-msg").textContent), null, { timeout: T });
    c = await couples();
    if (c.length !== 1 || c[0].kids.length !== 2 || await page.$(".twice")) throw new Error(`still ${c.length} families for the couple`);
    await page.click("#ed-back"); await page.waitForSelector(".node.focus");
  });
  await step(page, "home", async () => {  // ⌂ Family Tree; the start screen has one search and no leftover line
    await page.click("#brand"); await page.waitForSelector("#start-q"); await page.waitForSelector(".recentcard");
    if (await page.isVisible("#q") || await page.isVisible("#tree-title")) throw new Error("top search or title strip on the start screen");
    if (await page.evaluate(() => document.querySelector("#selink").children.length)) throw new Error("dotted line left on the start screen");
  });
  // Names, places and notes that look like code must show as typed and never become page elements (#9).
  // (The CSP would stop the scripts anyway, so this looks for the elements themselves, not for alerts.)
  await step(page, "odd characters show as typed", async () => {
    const first = "ZZTEST <img src=x onerror=alert(1)>", last = `"><b id=zzinj>x</b>'`;
    const place = "ZZTEST <svg onload=alert(1)>", note = "<script>alert(1)</script>";
    const alerts = []; page.on("dialog", d => { alerts.push(d.message()); d.dismiss(); });
    const check = async where => {
      const bad = await page.evaluate(() => document.querySelectorAll('img[src="x"], [onerror], [onload], #zzinj, script:not([src])').length);
      if (bad || alerts.length) throw new Error(`${where}: ${bad} injected elements, alerts ${JSON.stringify(alerts)}`);
      if (!(await page.evaluate(t => document.body.innerText.includes(t), first))) throw new Error(`${where}: the name isn't shown as typed`);
    };
    await page.click("button.pill:has-text('Add a new person')");
    await page.fill("#np-first", first); await page.fill("#np-last", last);
    await page.click("label[for=np-g-f]");
    await page.click(".newperson button.primary");
    await page.waitForSelector("#editor:not([hidden]) #ed-first");
    await page.fill("#ed-bplace", place); await page.press("#ed-bplace", "Tab");
    await page.click(".place button:has-text('Add it as a new place')");
    await page.click("button.full:has-text('More details')");
    await page.fill("#ed-notes", note); await page.press("#ed-notes", "Tab");
    await saved(page); await check("editor");
    await page.click("#ed-back"); await page.waitForSelector(".node.focus");
    await page.click("#panel .moretoggle"); await page.waitForSelector("#panel .details");
    await check("tree and panel");
    if (!(await page.evaluate(t => document.querySelector("#panel").innerText.includes(t), note))) throw new Error("the note isn't shown as typed");
    await page.fill("#q", "ZZTEST img"); await page.waitForSelector("#results .hit"); await page.click("#results .info >> nth=0");
    await check("top search and preview"); await page.fill("#q", "");
    await page.click("#panel .dupbtn"); await page.fill("#merge-q", "ZZTEST"); await page.waitForTimeout(500); await check("merge dialog");
    await page.click("#dlg button:has-text('Cancel')");
    await page.click("#brand"); await page.waitForSelector(".recentcard"); await check("start screen");
  });
  await step(page, "no one found: add them with that name", async () => {
    await page.fill("#start-q", "ZZTEST Nobody Here"); await page.click("#startcard .nohit .addnew");
    if (await page.inputValue("#np-first") !== "ZZTEST" || await page.inputValue("#np-last") !== "Nobody Here") throw new Error("the name wasn't filled in");
    await page.click(".recentcard >> nth=0"); await page.waitForSelector(".node.focus");
    await page.fill("#q", "ZZTEST Nobody Here"); await page.click("#results .nohit .addnew");
    await page.waitForSelector("#start-q");
    if (await page.inputValue("#np-first") !== "ZZTEST" || await page.inputValue("#np-last") !== "Nobody Here") throw new Error("the top search's add didn't fill in the name");
  });
  await page.context().close();
  await sleep(1500);
  console.log("cleanup after:", await cleanup());
}

await browser.close();
if (problems.length) { console.log("\nPROBLEMS:\n" + [...new Set(problems)].join("\n")); process.exit(1); }
console.log(`\nAll screens OK (${WRITE ? "read + write" : "read-only"}).`);
