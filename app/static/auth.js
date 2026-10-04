// Login, token refresh and API calls for the family tree page.

// Where the app is mounted (e.g. "/family"); the server fills this into <html data-base>.
export const BASE = document.documentElement.dataset.base || "";

// ---------- storage + api ----------
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};

export const auth = {
  get access() { return store.get("eg_access"); },
  get refresh() { return store.get("eg_refresh"); },
  save(t) { store.set("eg_access", t.access_token); if (t.refresh_token) store.set("eg_refresh", t.refresh_token); },
  clear() { store.set("eg_access", null); store.set("eg_refresh", null); },
};

let refreshing = null;
async function tryRefresh() {
  if (!auth.refresh) return false;
  refreshing ||= fetch(`${BASE}/auth/refresh`, { method: "POST", headers: { Authorization: `Bearer ${auth.refresh}` } })
    .then(async r => { if (!r.ok) return false; auth.save(await r.json()); return true; })
    .finally(() => { refreshing = null; });
  return refreshing;
}

export class LoginNeeded extends Error {}

export async function api(path, opts = {}, retry = true) {
  const headers = { ...(opts.headers || {}) };
  if (auth.access) headers.Authorization = `Bearer ${auth.access}`;
  const r = await fetch(BASE + path, { ...opts, headers });
  if (r.status === 401 && retry && await tryRefresh()) return api(path, opts, false);
  if (r.status === 401) { auth.clear(); throw new LoginNeeded("Please log in"); }
  const data = r.headers.get("content-type")?.includes("json") ? await r.json() : await r.text();
  if (!r.ok) throw new Error(data?.detail || data?.error?.message || `Something went wrong (${r.status})`);
  return data;
}

export async function login(username, password) {
  const r = await fetch(`${BASE}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }) });
  const data = await r.json();
  if (!r.ok) throw new Error(data.detail || "Login failed");
  auth.save(data);
}

// ---------- tiny DOM helper ----------
