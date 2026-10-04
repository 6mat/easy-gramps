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
  for (const p of mine) await g(`/people/${p.handle}`, { method: "DELETE" });
  const unused = async (kind, h) => { const r = await g(`/${kind}/${h}?backlinks=1`); if (!r.ok) return false; const j = await r.json(); return !Object.values(j.backlinks || {}).some(v => v.length); };
  for (const [kind, set] of [["events", events], ["notes", notes], ["media", media]])
    for (const h of set) if (await unused(kind, h)) await g(`/${kind}/${h}`, { method: "DELETE" });
  const left = (await (await g("/people/?keys=handle,primary_name")).json()).filter(zz).length;
  return `${mine.length} ZZTEST people removed, ${left} left`;
}

// ---------- read-only: every screen as a Member ----------
{
  const page = await newPage();
  await step(page, "login screen", async () => { await page.goto(APP); await page.waitForSelector("#lg-user"); });
  await step(page, "log in", () => login(page, "member"));
  await step(page, "start screen", async () => { await page.waitForSelector("#start-q"); await page.waitForSelector(".recentgrid"); });
  await step(page, "start search + open a tree", async () => {
    await page.fill("#start-q", "Stewart");  // a surname in the demo tree
    await page.click("#startcard .pickbtn >> nth=0");
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
  });
  await step(page, "full screen", async () => { await page.click("#z-full"); await page.waitForSelector("body.fullmode"); await page.click("#z-full"); });
  await step(page, "top search", async () => { await page.fill("#q", "Stewart"); await page.waitForSelector("#results button"); await page.fill("#q", ""); });
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
    await page.fill("#ed-bplace", "ZZTEST Town");
    await page.click("label[for=ed-passed]");
    await page.fill("#ed-death-date", "2020-01-02");
    await page.fill("#ed-burial", "ZZTEST Cemetery");
    await page.click("button.full:has-text('More details')");
    await page.fill("#ed-res", "ZZTEST City"); await page.fill("#ed-phone", "555-0100");
    await page.fill("#ed-email", "zztest@example.com"); await page.fill("#ed-notes", "ZZTEST note");
    await sleep(1000); await saved(page);
    await page.click("label[for=ed-birth-yo]"); await page.fill("#ed-birth-year", "1951");
    await sleep(1000); await saved(page);
  });
  await step(page, "photo upload", async () => {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    await page.setInputFiles("#ed-photo-file", { name: "zztest.png", mimeType: "image/png", buffer: png });
    await page.waitForFunction(() => /Saved/.test(document.querySelector("#ed-status").textContent) && !document.querySelector(".centre .ph img")?.src.startsWith("data:"));
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
    await page.fill("#add-q", "ZZTEST Kid");
    await page.click("#dlg .row-p button:has-text('Choose')").catch(() => {});  // the Kid is skipped (already family)
    await page.fill("#add-q", "ZZTEST Wife"); await page.waitForTimeout(300);
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
    await page.fill("#merge-q", "ZZTEST Mum");
    await page.click("#merge-list .pickrow >> nth=0");
    await page.waitForSelector(".cmp");
    await page.click(".cmphead .swap"); await page.click(".cmphead .swap");
    await page.fill("#cmp-last", "Merged");
    await page.click("#dlg button.primary"); await page.click("#dlg button.danger");
    await page.waitForFunction(() => /Combined/.test(document.querySelector("#toast-msg").textContent));
  });
  await step(page, "home", async () => { await page.click("#tree-home"); await page.waitForSelector("#start-q"); await page.waitForSelector(".recentcard"); });
  await page.context().close();
  await sleep(1500);
  console.log("cleanup after:", await cleanup());
}

await browser.close();
if (problems.length) { console.log("\nPROBLEMS:\n" + [...new Set(problems)].join("\n")); process.exit(1); }
console.log(`\nAll screens OK (${WRITE ? "read + write" : "read-only"}).`);
