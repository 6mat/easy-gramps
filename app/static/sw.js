// Easy Gramps service worker: lets phones install the page as an app. It keeps nothing on the phone:
// every request goes to the network as usual. Only a page that can't load at all (no internet) gets a
// plain "No internet" page instead of the browser's own error. It also shows the family chat's
// notifications (push.py); tapping one opens its conversation.
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

// One notification per conversation: a newer message replaces the one before (and still rings). None while the
// family tree is on screen: the chat's count shows it there (browsers allow a quiet push only then).
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data.json(); } catch { /* shown with the plain title */ }
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (wins.some(w => w.visibilityState === "visible")) return;
    await self.registration.showNotification(d.title || "Family chat", {
      body: d.body || "", tag: `chat-${d.conv}`, renotify: true, data: { conv: d.conv }, icon: `${self.registration.scope}icon-192.png`,
    });
  })());
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const conv = e.notification.data?.conv;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const win = wins.find(w => w.url.startsWith(self.registration.scope));
    if (win) { await win.focus(); win.postMessage({ chat: conv }); }
    else await self.clients.openWindow(`${self.registration.scope}${conv ? `?chat=${conv}` : ""}`);
  })());
});
