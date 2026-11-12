// The browser's save queue (app/static/queue.js) and login renewal (app/static/auth.js api()), without a page.
import { test } from "node:test";
import assert from "node:assert/strict";

const kv = {};
globalThis.localStorage = { getItem: k => kv[k] ?? null, setItem: (k, v) => { kv[k] = String(v); }, removeItem: k => { delete kv[k]; } };
globalThis.location = { origin: "https://family.example" };
globalThis.document = { documentElement: { dataset: { base: "/eg", gramps: "" } } };
const { api, auth } = await import("../app/static/auth.js");
const { enqueue, queueIdle } = await import("../app/static/queue.js");

const reply = (status, body) => ({ status, ok: status < 400, headers: { get: () => "application/json" }, json: async () => body });
const later = () => { let done; const p = new Promise((ok, no) => { done = { ok, no }; }); return Object.assign(p, done); };

test("two calls refused at once renew the login once, then both are sent again", async () => {
  auth.save({ access_token: "old", refresh_token: "r1" });
  const seen = [], renewed = later();
  globalThis.fetch = async (url, opts = {}) => {
    const tok = opts.headers?.Authorization;
    seen.push([url, tok]);
    if (url === "/eg/auth/refresh") { await renewed; return reply(200, { access_token: "new" }); }
    if (url === "/eg/auth/session") return reply(200, {});
    return tok === "Bearer new" ? reply(200, { url }) : reply(401, {});
  };
  const both = Promise.all([api("/a"), api("/b")]);
  await new Promise(r => setTimeout(r, 10));  // both have been refused and wait on the renewal
  renewed.ok();
  assert.deepEqual(await both, [{ url: "/eg/a" }, { url: "/eg/b" }]);
  assert.equal(seen.filter(([u]) => u === "/eg/auth/refresh").length, 1);
  assert.deepEqual(seen.filter(([u, t]) => u.length === 5 && t === "Bearer new").map(([u]) => u).sort(), ["/eg/a", "/eg/b"]);
});

test("saves go out one after another, and a failed one doesn't block the next", async () => {
  const log = [], first = later();
  globalThis.fetch = async url => { log.push(`start ${url}`); if (url === "1") await first; log.push(`end ${url}`); return url; };
  const a = enqueue(async () => { await fetch("1"); throw new Error("Not saved"); });
  const b = enqueue(() => fetch("2"));
  await new Promise(r => setTimeout(r, 10));
  assert.deepEqual(log, ["start 1"]);  // the second waits for the first
  first.ok();
  await assert.rejects(a, /Not saved/);
  assert.equal(await b, "2");
  await queueIdle();
  assert.deepEqual(log, ["start 1", "end 1", "start 2", "end 2"]);
});
