// Easy Gramps service worker: lets phones install the page as an app. It keeps nothing on the phone:
// every request goes to the network as usual. Only a page that can't load at all (no internet) gets a
// plain "No internet" page instead of the browser's own error.
const OFFLINE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Family Tree</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; font: 18px/1.5 system-ui, sans-serif;
    background: #f6f3ee; color: #1d1b18; }
  main { max-width: 420px; padding: 28px; text-align: center; }
  h1 { font-size: 26px; margin: 0 0 8px; }
  button { font: inherit; border: 0; cursor: pointer; margin-top: 16px; padding: 12px 28px; border-radius: 12px; background: #1f5f99;
    color: #fff; font-weight: 700; }
  @media (prefers-color-scheme: dark) { body { background: #171614; color: #ece8e1; } }
</style></head><body><main>
<h1>🌳 No internet</h1>
<p>The family tree needs an internet connection. Check your Wi-Fi or mobile data, then try again.</p>
<button onclick="location.reload()">Try again</button>
</main></body></html>`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", e => {
  if (e.request.mode !== "navigate") return;  // everything else: straight to the network, untouched
  e.respondWith(fetch(e.request).catch(() => new Response(OFFLINE, { headers: { "Content-Type": "text/html; charset=utf-8" } })));
});
