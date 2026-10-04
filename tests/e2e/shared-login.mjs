// Shared-login check: Easy Gramps on the same site as Gramps Web, without a real Google account.
//
//   GRAMPS_PUBLIC_URL=http://localhost:8096 … uvicorn main:app --port 8095   # the app, against the demo
//   node tests/e2e/shared-login.mjs
//
// Port 8096 plays "Gramps Web on the same site": /family goes to the app, and the sign-in link
// /api/oidc/login/ does what Gramps Web's page does after Google (saves the login in localStorage,
// then shows its own home page), using the demo's "editor" login instead of Google. Read-only.
import { chromium } from "playwright";
import http from "node:http";

const APP_PORT = Number(process.env.APP_PORT || 8095), SITE = "http://localhost:8096", APP = `${SITE}/family/`;
const T = 60000;  // the demo is slow: loading the whole tree takes several seconds
let passwordOn = true;
const KEYS = ["access_token", "access_token_expires", "refresh_token", "id_token"];

const site = http.createServer((req, res) => {
  const u = new URL(req.url, SITE);
  if (u.pathname === "/family/auth/options") {  // Gramps Web's sign-in settings, with Google switched on
    res.setHeader("content-type", "application/json");
    return res.end(JSON.stringify({ password: passwordOn, providers: [{ id: "google", name: "Google" }] }));
  }
  if (u.pathname === "/api/oidc/login/") {
    res.setHeader("content-type", "text/html");
    return res.end(`<p>Signing in…</p><script>
      fetch("/family/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "editor", password: "editor" }) }).then(r => r.json()).then(t => setTimeout(() => {
        localStorage.setItem("access_token", t.access_token); localStorage.setItem("access_token_expires", String(Date.now() + 9e5));
        localStorage.setItem("refresh_token", t.refresh_token); localStorage.setItem("id_token", "zztest");
        location.href = "/"; }, 1500));</script>`);
  }
  if (!u.pathname.startsWith("/family")) { res.setHeader("content-type", "text/html"); return res.end("<h1>Gramps Web</h1>"); }
  const up = http.request({ host: "127.0.0.1", port: APP_PORT, path: req.url, method: req.method, headers: req.headers },
    r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  up.on("error", () => { res.statusCode = 502; res.end(); });
  req.pipe(up);
});
await new Promise(r => site.listen(8096, r));

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const page = await ctx.newPage(), gw = await ctx.newPage();  // gw: a Gramps Web tab
const problems = [];
page.on("pageerror", e => problems.push(`page error: ${e.message}`));
const keys = p => p.evaluate(ks => Object.fromEntries([...ks, "eg_access", "eg_refresh"].map(k => [k, !!localStorage.getItem(k)])), KEYS);
const loginScreen = () => page.waitForSelector("button:has-text('Continue with Google')", { timeout: T });
const tree = () => page.waitForSelector("#start-q", { timeout: T });
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); }
  catch (e) { problems.push(`${name}: ${e.message.split("\n")[0]}`); console.log(`FAIL ${name}`); }
}
const must = (cond, what) => { if (!cond) throw new Error(what); };

await gw.goto(`${SITE}/`);
await check("login screen shows Google and the password form", async () => {
  await page.goto(APP); await loginScreen(); must(await page.$("#lg-user"), "no password form");
});
await check("Continue with Google: pop-up, then the tree loads by itself", async () => {
  const [pop] = await Promise.all([page.waitForEvent("popup"), page.click("button:has-text('Continue with Google')")]);
  await page.waitForSelector("text=Finish signing in with Google in the other window");
  await tree();
  await page.waitForFunction(() => /Signed in/.test(document.querySelector("#toast-msg")?.textContent || ""), null, { timeout: T });
  await page.waitForTimeout(500);
  must(pop.isClosed(), "the sign-in window stayed open");
  const k = await keys(page); must(k.access_token && k.refresh_token && !k.eg_access, JSON.stringify(k));
});
await check("Log out logs out of Gramps Web too", async () => {
  await page.click("#menubtn"); await page.click("#logout"); await loginScreen();
  const k = await keys(page); must(KEYS.every(x => !k[x]), JSON.stringify(k));
});
await check("password login is shared too", async () => {
  await page.fill("#lg-user", "editor"); await page.fill("#lg-pass", "editor"); await page.click("button[type=submit]");
  await tree();
  const k = await keys(page); must(k.access_token && k.refresh_token && k.access_token_expires && !k.id_token, JSON.stringify(k));
});
await check("logging out in Gramps Web logs this page out", async () => {
  await gw.evaluate(ks => ks.forEach(k => localStorage.removeItem(k)), KEYS);
  await loginScreen();
});
let tok;
await check("logging in in Gramps Web logs this page in", async () => {
  tok = await gw.evaluate(() => fetch("/family/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "editor", password: "editor" }) }).then(r => r.json()));
  await gw.evaluate(t => { localStorage.setItem("refresh_token", t.refresh_token); localStorage.setItem("access_token", t.access_token); }, tok);
  await tree();
});
await check("a login from before sharing carries over once", async () => {
  await gw.evaluate(([ks, t]) => { ks.forEach(k => localStorage.removeItem(k)); localStorage.setItem("eg_access", t.access_token); localStorage.setItem("eg_refresh", t.refresh_token); }, [KEYS, tok]);
  await page.goto(APP); await tree();
  const k = await keys(page); must(k.access_token && k.refresh_token && !k.eg_access && !k.eg_refresh, JSON.stringify(k));
});
await check("password form hidden when Gramps Web turns password login off", async () => {
  passwordOn = false;
  await page.click("#menubtn"); await page.click("#logout"); await loginScreen();
  must(!(await page.$("#lg-user")), "password form still shown");
});

await browser.close(); site.close();
if (problems.length) { console.log("\nPROBLEMS:\n" + problems.join("\n")); process.exit(1); }
console.log("\nShared login OK.");
