// Easy Gramps — The full-screen family editor: toast with Undo, autosave, fields, relatives, the Add dialog and "Someone new".
import { api, LoginNeeded } from "./auth.js";
import { $, FAMS, P, S, byBirth, canEdit, canLink, desc, dropClosedSteps, h, loadGraph, matches, name, other, ownStep, parentFam, parseView, photoEl, postJSON, pushView, relWord, sameName, saveView, searchWords, spouseFams, spouseWord, years } from "./common.js";
import { renderTree } from "./tree.js";
import { renderPanel } from "./panel.js";
import { closeMerge } from "./merge.js";
import { openViewer, thumbUrl } from "./photos.js";
import { renderAll, showLogin } from "./start.js";

// ---------- undo + toast ----------
let toastTimer, undoToken = null;
// undo: what the server says will reverse the change (shown as an "Undo" button for 10 seconds)
export function toast(msg, undo = null) {
  undoToken = undo || null;
  $("#toast-msg").textContent = msg;
  $("#toast-undo").hidden = !undoToken;
  $("#toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $("#toast").hidden = true; undoToken = null; }, 10000);
}
$("#toast-undo").onclick = async () => {
  const token = undoToken;
  if (!token) return;
  undoToken = null;
  $("#toast").hidden = true;
  try {
    await flushSaves();  // typing waiting to be saved goes first, so the reload can't undo it
    await api("/tree/undo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(token) });
    await refresh();
    toast("Undone");
  } catch (err) {
    if (err instanceof LoginNeeded) return showLogin();
    toast(`Couldn't undo: ${err.message}`);
  }
};
// Reload everything from Gramps after a change, keeping the view where it was.
export async function refresh() {
  await loadGraph();
  if (!P[S.focus]) S.focus = null;
  S.history = S.history.filter(x => P[x]);
  if (!P[S.sel]) S.sel = S.focus;
  if (!$("#editor").hidden) {
    S.stack = S.stack.filter(x => P[x]);
    if (S.stack.length) await ensureDetails(S.stack.at(-1)).catch(() => {});
  }
  S.menu = null;
  renderAll();
}
// ---------- autosave: typing is saved when you leave the box or stop for 2 s; ticks and buttons at once ----------
const pending = {};          // person id -> fields waiting to be saved
let saveTimer, saveChain = Promise.resolve(), saveFailed = null;
function setStatus(text, cls = "") {
  const st = $("#ed-status");
  st.className = `status ${cls}`.trim();
  st.replaceChildren(text);
  if (cls === "failed") st.append(" ", h("button", { onclick: () => { saveFailed = null; flushSaves(); } }, "Try again"));
}
function autosave(id, patch, wait = 700) {
  pending[id] = { ...pending[id], ...patch };
  setStatus("Saving…", "saving");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSaves, wait);
}
export function flushSaves(keepalive = false) {  // keepalive: the page is closing, let the save finish anyway
  clearTimeout(saveTimer);
  const work = Object.entries(pending);
  for (const [id] of work) delete pending[id];
  if (!work.length) return saveChain;
  saveChain = saveChain.then(async () => {
    for (const [id, patch] of work) {
      try {
        await api(`/tree/person/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch), keepalive });
      } catch (err) {
        pending[id] = { ...patch, ...pending[id] };  // keep it for "Try again"
        saveFailed = err;
      }
    }
    if (Object.keys(pending).length && saveFailed) setStatus(`Not saved: ${saveFailed.message}`, "failed");
    else if (!Object.keys(pending).length) setStatus("Saved ✓");
  });
  return saveChain;
}
window.addEventListener("beforeunload", e => { if (Object.keys(pending).length) { flushSaves(true); e.preventDefault(); } });
// Phones and tablets often close a hidden tab without any unload event: save when the page is hidden.
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && Object.keys(pending).length) flushSaves(true); });

// ---------- full-screen family editor ----------
async function ensureDetails(id) {
  if (P[id]._details) return;
  Object.assign(P[id], await api(`/tree/details/${id}`), { _details: true });
}
export async function openEditor(id, rel, famId, restoring = false) {
  S.stack = [id]; S.edMore = false; S.menu = null;
  setStatus("Saved ✓");
  $("#editor").hidden = false;
  if (!restoring) pushView();  // Back closes it again
  $("#ed-body").replaceChildren(h("p", { class: "muted" }, "Loading…"));
  try { await ensureDetails(id); } catch (err) { if (err instanceof LoginNeeded) return showLogin(); }
  renderEditor();
  if (rel) openAdd(id, rel, famId);
  else $("#ed-back").focus();
}
export async function closeEditor() {
  if (!$("#editor").hidden) { S.add = null; $("#editor").hidden = true; hideDlg(); dropClosedSteps(); }
  await flushSaves();
  // Reload so the tree shows exactly what Gramps now holds.
  try { await loadGraph(); } catch (err) { if (err instanceof LoginNeeded) return showLogin(); }
  if (!P[S.focus]) S.focus = null;
  if (!P[S.sel]) S.sel = S.focus;
  renderTree(); renderPanel();
}
$("#ed-back").onclick = closeEditor;
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  if (!$("#dlg-wrap").hidden) { e.stopImmediatePropagation(); S.merge ? closeMerge() : closeDialog(); }
  else if (!$("#menupop").hidden) { e.stopImmediatePropagation(); $("#menupop").hidden = true; $("#menubtn").setAttribute("aria-expanded", "false"); $("#menubtn").focus(); }
  else if (!$("#editor").hidden) closeEditor();
}, true);  // capture: before the tree's arrow-key handler

function rcard(id, rel, famObj, base, isNew) {
  const p = P[id];
  const card = h("div", { class: `rcard${isNew ? " new" : ""}` },
    h("span", { class: "role" }, rel === "spouse" ? spouseWord(P[base]) : rel),
    photoEl(p), h("span", { class: "nm" }, name(p)),
    h("button", { class: "more", "aria-label": `Options for ${name(p)}`, "aria-expanded": String(S.menu === `${rel}:${id}`),
      onclick: () => { S.menu = S.menu === `${rel}:${id}` ? null : `${rel}:${id}`; renderEditor(); } }, "⋯"),
    h("span", { class: "yr" }, years(p) || "No dates"), h("span", { class: "ds" }, p.birthPlace || ""));
  if (S.menu === `${rel}:${id}`) card.append(menuEl(id, rel, famObj, base));
  if (S.menu === `confirm:${rel}:${id}`) card.append(confirmEl(id, rel, famObj, base));
  return card;
}
function menuEl(id, rel, famObj, base) {
  return h("div", { class: "menu" },
    h("button", { onclick: async () => { await flushSaves(); await ensureDetails(id).catch(() => {}); S.stack.push(id); S.menu = null; S.edMore = false; renderEditor(); } }, `Open ${P[id].first}'s family`),
    canLink() && h("button", { class: "danger", onclick: () => { S.menu = `confirm:${rel}:${id}`; renderEditor(); } }, "Remove from this family"));
}
function confirmEl(id, rel, famObj, base) {
  const w = relWord(rel, P[base]);
  return h("div", { class: "menu" },
    h("div", { class: "small" }, `Remove ${P[id].first} as ${P[base].first}'s ${w}? ${P[id].first} stays in the tree.`),
    h("div", { class: "btnrow" },
      h("button", { class: "danger", onclick: () => removeLink(id, rel, famObj, base) }, "Remove"),
      h("button", { onclick: () => { S.menu = null; renderEditor(); } }, "Cancel")));
}
async function removeLink(id, rel, x, base) {
  const who = P[id].first, whose = P[base].first, w = relWord(rel, P[base]);
  S.menu = null;
  setStatus("Saving…", "saving");
  try {
    await flushSaves();
    const res = await postJSON("/tree/unlink", { person: base, rel, other: id, famId: x.id });
    await refresh();
    setStatus("Saved ✓");
    toast(`Removed ${who} as ${whose}'s ${w}. ${who} is still in the tree.`, res.undo);
  } catch (err) {
    if (err instanceof LoginNeeded) return showLogin();
    setStatus(`Not saved: ${err.message}`, "failed");
    renderEditor();
  }
}

function field(label, input, cls) { return h("label", { class: cls || "", for: input.id }, label, input); }
function bindText(p, key, id, opts = {}) {
  const el = h(opts.area ? "textarea" : "input", { id, type: opts.type || "text", disabled: !canEdit() || opts.disabled, rows: opts.area ? 3 : null });
  el.value = p[key] || "";
  el.addEventListener("input", () => { p[key] = el.value; if (key === "first" || key === "last") $("#ed-title").textContent = `${name(p)}'s family`; autosave(p.id, { [key]: el.value }, 2000); });
  el.addEventListener("change", () => flushSaves());  // left the box
  return el;
}

// Place boxes: pick from the places Gramps already has; a new place is made only when you say so (#49).
let places = null;  // every place, loaded once when a place box is first used
const loadPlaces = () => places ??= api("/tree/places").catch(err => { places = null; throw err; });
function placeField(label, p, key, id) {
  const el = h("input", { id, type: "text", disabled: !canEdit(), autocomplete: "off", role: "combobox",
    "aria-autocomplete": "list", "aria-expanded": "false", "aria-controls": `${id}-list` });
  const list = h("ul", { id: `${id}-list`, class: "suggest", role: "listbox", hidden: true });
  const ask = h("div", { class: "ask small", hidden: true });
  let shown = [], at = -1, saved = el.value = p[key] || "";
  const close = () => { list.hidden = true; el.setAttribute("aria-expanded", "false"); el.removeAttribute("aria-activedescendant"); at = -1; };
  const use = (value, label) => { p[key] = saved = el.value = label; close(); ask.hidden = true; autosave(p.id, { [key]: value }, 0); };
  const pick = x => use({ id: x.id }, x.name);
  const mark = i => {
    at = i;
    [...list.children].forEach((li, j) => li.setAttribute("aria-selected", String(j === i)));
    el.setAttribute("aria-activedescendant", `${id}-o${i}`);
  };
  el.addEventListener("input", async () => {
    ask.hidden = true;
    const words = searchWords(el.value);
    if (!words.length) return close();
    let all;
    try { all = await loadPlaces(); } catch { return close(); }
    if (searchWords(el.value).join(" ") !== words.join(" ")) return;  // typed on meanwhile
    const starts = x => x.name.toLowerCase().startsWith(words[0]) ? 0 : 1;
    shown = all.filter(x => words.every(w => `${x.name} ${x.area}`.toLowerCase().includes(w)))
      .sort((a, b) => starts(a) - starts(b)).slice(0, 8);
    list.replaceChildren(...shown.map((x, i) => h("li", { id: `${id}-o${i}`, role: "option", "aria-selected": "false",
      onmousedown: e => e.preventDefault(), onclick: () => pick(x) },  // mousedown: keep the typing box focused
      x.name, x.area && h("span", { class: "muted" }, ` · ${x.area}`))));
    at = -1;
    list.hidden = !shown.length; el.setAttribute("aria-expanded", String(!!shown.length));
  });
  el.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); return at >= 0 ? pick(shown[at]) : el.blur(); }
    if (list.hidden) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); mark((at + (e.key === "ArrowDown" ? 1 : shown.length - 1)) % shown.length); }
    else if (e.key === "Escape") { e.stopPropagation(); close(); }
  });
  el.addEventListener("blur", async () => {  // left the box: use what's typed
    close();
    const text = el.value.trim();
    if (text === saved.trim()) return;
    if (!text) return use("", "");
    let all = null;
    try { all = await loadPlaces(); } catch { /* ask anyway; Gramps then reuses a place with exactly this name */ }
    const same = all?.find(x => x.name.toLowerCase() === text.toLowerCase());
    if (same) return pick(same);
    ask.replaceChildren(`"${text}" isn't one of the places yet.`,
      h("button", { onclick: () => { use(all ? { new: text } : text, text); places = null; } }, "Add it as a new place"),
      h("button", { onclick: () => { el.value = saved; ask.hidden = true; setStatus("Saved ✓"); } }, "Change it back"));
    ask.hidden = false;
    setStatus("Place not saved yet");
  });
  return h("div", { class: "place" }, field(label, el), list, ask);
}
function dateInputs(prefix, label, get, set) {
  const d = get() || {};
  const yearOnlyStart = !!(d.y && !(d.m && d.d));
  const pad = n => String(n).padStart(2, "0");
  const cal = h("input", { id: `${prefix}-date`, type: "date", disabled: !canEdit(), "aria-label": label });
  cal.value = d.y && d.m && d.d ? `${d.y}-${pad(d.m)}-${pad(d.d)}` : "";
  const yr = h("input", { id: `${prefix}-year`, type: "number", min: "1500", max: "2100", placeholder: "Year", disabled: !canEdit(), "aria-label": `${label}: year` });
  yr.value = yearOnlyStart ? d.y : "";
  const yo = h("input", { id: `${prefix}-yo`, type: "checkbox", disabled: !canEdit() });
  yo.checked = yearOnlyStart;
  const sync = () => { cal.hidden = yo.checked; yr.hidden = !yo.checked; };
  let sent;
  const save = () => {
    let v = null;
    if (yo.checked) v = yr.value ? { y: Number(yr.value) } : null;
    else if (cal.value) { const [y, m, dd] = cal.value.split("-").map(Number); v = { y, m, d: dd }; }
    if (JSON.stringify(v) !== sent) { sent = JSON.stringify(v); set(v); }
  };
  yo.addEventListener("change", () => { if (yo.checked && cal.value) yr.value = cal.value.slice(0, 4); sync(); save(); });
  // The year is saved once it has 4 digits or you leave the box, not at "1", "19", "195".
  cal.addEventListener("change", save); yr.addEventListener("change", save);
  yr.addEventListener("input", () => { if (/^\d{4}$/.test(yr.value)) save(); });
  sync();
  return h("div", {}, cal, yr, h("label", { class: "inline small", for: yo.id }, yo, "I only know the year"));
}

// More photos, one after another (each after the person's other photos).
function addPhotos(p, files) {
  const ok = files.filter(f => f.size <= 20 * 1024 * 1024);
  if (ok.length < files.length) setStatus("A photo was too big (20 MB at most) and wasn't added", "failed");
  ok.forEach((f, i) => {
    saveChain = saveChain.then(async () => {
      setStatus(ok.length > 1 ? `Saving photo ${i + 1} of ${ok.length}…` : "Saving photo…", "saving");
      const fd = new FormData(); fd.append("photo", f, f.name); fd.append("main", "0");
      const res = await api(`/tree/person/${p.id}/photo`, { method: "POST", body: fd });
      p.photos = [...p.photos, res.added]; p.photo = res.photo;
      if (!$("#editor").hidden) renderEditor();
    });
  });
  if (ok.length) saveChain = saveChain.then(() => { setStatus("Saved ✓"); renderTree(); renderPanel(); }, err => {
    if (err instanceof LoginNeeded) return showLogin();
    setStatus(`Photo not saved: ${err.message}`, "failed");
  });
}
// From the big view: make a photo the profile photo, or take it off this person. Resolves to their photos.
async function photoAct(p, m, what) {
  setStatus("Saving…", "saving");
  try {
    await flushSaves();
    const res = await postJSON(`/tree/person/${p.id}/photos`, { media: m, do: what });
    p.photos = what === "remove" ? p.photos.filter(x => x !== m) : [m, ...p.photos.filter(x => x !== m)];
    p.photo = res.photo;
    setStatus("Saved ✓");
    if (!$("#editor").hidden) renderEditor();
    renderTree(); renderPanel();
    return p.photos;
  } catch (err) {
    if (err instanceof LoginNeeded) showLogin();
    else setStatus(`Not saved: ${err.message}`, "failed");
    throw err;
  }
}

function centreCard(p) {
  const file = h("input", { id: "ed-photo-file", type: "file", accept: "image/*", hidden: true });
  file.addEventListener("change", () => {
    const f = file.files[0]; if (!f) return;
    file.value = "";
    if (f.size > 20 * 1024 * 1024) return setStatus("Photo not saved: it's too big (20 MB at most)", "failed");
    // Show it straight away, then upload it as their main photo (the old one comes back if that fails).
    const old = p.photo, preview = URL.createObjectURL(f);
    p.photo = preview; renderEditor();
    const fd = new FormData(); fd.append("photo", f, f.name);
    setStatus("Saving photo…", "saving");
    saveChain = saveChain.then(() => api(`/tree/person/${p.id}/photo`, { method: "POST", body: fd }))
      .then(res => { p.photo = res.photo; p.photos = [res.photo, ...p.photos.filter(x => x !== res.photo)]; setStatus("Saved ✓"); })
      .catch(err => {
        p.photo = old; URL.revokeObjectURL(preview);
        if (err instanceof LoginNeeded) return showLogin();
        if (!$("#editor").hidden) renderEditor();
        setStatus(`Photo not saved: ${err.message}`, "failed");
      });
  });
  // More photos: added after the others; tap one to see it big (editors: make it the profile photo, or take it off).
  const more = h("input", { id: "ed-photos-file", type: "file", accept: "image/*", multiple: true, hidden: true });
  more.addEventListener("change", () => { const files = [...more.files]; more.value = ""; addPhotos(p, files); });
  const view = i => openViewer(p.photos, i, name(p), canEdit() && { main: m => photoAct(p, m, "main"), remove: m => photoAct(p, m, "remove") });
  const mainPhoto = p.photos[0] && p.photos[0] === p.photo
    ? h("button", { class: "phbtn", title: "Show the photo bigger", "aria-label": `Show ${name(p)}'s photo bigger`, onclick: () => view(0) }, photoEl(p, true))
    : photoEl(p, true);
  const photos = (p.photos.length > 1 || canEdit()) && h("div", { class: "photos full" },
    h("div", { class: "flabel" }, p.photos.length ? `Photos (${p.photos.length})` : "Photos"),
    h("div", { class: "phgrid" },
      ...p.photos.map((m, i) => h("button", { class: "phtile", title: "Show it bigger", "aria-label": `Photo ${i + 1} of ${p.photos.length}`, onclick: () => view(i) },
        h("img", { src: thumbUrl(m), alt: "", loading: "lazy" }), i === 0 && h("span", { class: "star", title: "Profile photo" }, "★"))),
      canEdit() && h("button", { class: "phadd", onclick: () => more.click() }, "+ Add photos")),
    more);
  const gender = h("fieldset", {}, h("legend", {}, "Male or female"),
    ...[["m", "Male"], ["f", "Female"]].map(([v, l]) => {
      const r = h("input", { type: "radio", name: "ed-gender", id: `ed-g-${v}`, disabled: !canEdit() });
      r.checked = p.gender === v;
      r.addEventListener("change", () => { p.gender = v; autosave(p.id, { gender: v }); });
      return h("label", { class: "inline", for: r.id }, r, l);
    }));
  const passed = h("input", { id: "ed-passed", type: "checkbox", disabled: !canEdit() });
  passed.checked = !!p.deceased;
  const deathBox = h("div", { class: "box full" },
    h("div", { class: "flabel" }, "Date of death", dateInputs("ed-death", "Date of death", () => p.death, v => { p.death = v; autosave(p.id, { death: v }); })),
    placeField("Place of burial", p, "burial", "ed-burial"));
  deathBox.hidden = !p.deceased;
  passed.addEventListener("change", () => {
    p.deceased = passed.checked; deathBox.hidden = !passed.checked;
    if (!passed.checked) { p.death = null; p.burial = ""; }
    autosave(p.id, { deceased: passed.checked });
  });
  // These four come from a separate request; if it failed, don't let empty boxes overwrite real values.
  const off = { disabled: !p._details };
  const moreBox = h("div", { class: "box full" },
    !p._details && h("div", { class: "warn full" }, "Couldn't load these details.",
      h("button", { onclick: async () => { try { await ensureDetails(p.id); } catch (err) { if (err instanceof LoginNeeded) return showLogin(); } renderEditor(); } }, "Try again")),
    field("Residing at", bindText(p, "residence", "ed-res", off), "full"),
    p.residenceRest ? h("div", { class: "small muted full" }, `…, ${p.residenceRest} (change that part in Full Gramps)`) : "",
    field("Phone (private)", bindText(p, "phone", "ed-phone", { type: "tel", ...off })),
    field("Email (private)", bindText(p, "email", "ed-email", { type: "email", ...off })),
    field("Notes", bindText(p, "notes", "ed-notes", { area: true, ...off }), "full"),
    p.otherNotes.length ? h("div", { class: "small muted full" },
      `+ ${p.otherNotes.length} more ${p.otherNotes.length === 1 ? "note" : "notes"}. Open Full Gramps to change ${p.otherNotes.length === 1 ? "it" : "them"}.`) : "");
  moreBox.hidden = !S.edMore;
  return h("div", { class: "centre" },
    h("div", { class: "photo-row full" }, mainPhoto,
      canEdit() && h("button", { onclick: () => file.click() }, p.photo ? "Change photo" : "Add photo"), file,
      !canEdit() && h("span", { class: "small muted" }, "Only editors can change details or link family members. You can add new people from the start screen.")),
    photos,
    field("First name", bindText(p, "first", "ed-first")),
    field("Last name", bindText(p, "last", "ed-last")),
    field("Nickname", bindText(p, "nick", "ed-nick")),
    gender,
    h("div", { class: "flabel" }, "Birthday", dateInputs("ed-birth", "Birthday", () => p.birth, v => { p.birth = v; autosave(p.id, { birth: v }); })),
    placeField("Place of birth", p, "birthPlace", "ed-bplace"),
    h("label", { class: "inline full", for: "ed-passed" }, passed, "Passed away?"),
    deathBox,
    h("button", { class: "full", "aria-expanded": String(S.edMore), onclick: () => { S.edMore = !S.edMore; moreBox.hidden = !S.edMore; } },
      "More details ▸ (residing at, phone, email, notes)"),
    moreBox);
}

export function renderEditor() {
  const id = S.stack.at(-1), p = P[id];
  saveView();
  $("#ed-title").textContent = `${name(p)}'s family`;
  $("#crumbs").replaceChildren(...(S.stack.length > 1 ? S.stack.flatMap((x, i) => [
    i ? " › " : "",
    i === S.stack.length - 1 ? h("span", {}, P[x].first)
      : h("button", { onclick: () => { S.stack = S.stack.slice(0, i + 1); S.menu = null; renderEditor(); } }, P[x].first)]) : []));
  const lastNew = S.newlyAdded;
  const pf = parentFam(id);
  const parentsRow = h("div", { class: "ed-row" },
    pf?.f ? rcard(pf.f, "father", pf, id, lastNew === pf.f) : canLink() && h("button", { class: "slot ed-slot", onclick: () => openAdd(id, "father") }, "Add father"),
    pf?.m ? rcard(pf.m, "mother", pf, id, lastNew === pf.m) : canLink() && h("button", { class: "slot ed-slot", onclick: () => openAdd(id, "mother") }, "Add mother"));
  const sfs = spouseFams(id);
  const sw = spouseWord(p);
  const spouseCol = h("div", { class: "spouses" },
    ...sfs.filter(x => other(x, id)).map(x => rcard(other(x, id), "spouse", x, id, lastNew === other(x, id))),
    canLink() && h("button", { class: "slot ed-slot", onclick: () => openAdd(id, "spouse") },
      sfs.some(x => other(x, id)) ? `Another ${sw}` : `Add ${sw}`));
  const kidGroups = sfs.map(x => {
    const o = other(x, id);
    const g = h("div", { class: "kidgroup" },
      h("span", { class: "glabel" }, o ? `Children with ${P[o].first}` : "Children (other parent not added)"),
      h("div", { class: "ed-row" }, ...byBirth(x.kids).map(k => rcard(k, "child", x, id, lastNew === k)),
        canLink() && h("button", { class: "slot ed-slot", onclick: () => openAdd(id, "child", x.id) }, "Add child")));
    g.style.setProperty("--fc", `var(--f${sfs.indexOf(x) % 6})`);
    return g;
  });
  if (!sfs.length) kidGroups.push(h("div", { class: "kidgroup" }, h("span", { class: "glabel" }, "Children"),
    canLink() && h("button", { class: "slot ed-slot", onclick: () => openAdd(id, "child") }, "Add child")));
  $("#ed-body").replaceChildren(
    h("section", { class: "ed-sec" }, h("h3", {}, "Parents"), parentsRow),
    h("section", { class: "ed-sec" }, h("div", { class: "mid" }, centreCard(p), spouseCol)),
    h("section", { class: "ed-sec" }, h("h3", {}, "Children"), h("div", { class: "kids" }, kidGroups)));
}

// ---------- add dialog ----------
// The pop-up dialog (Add, Merge): focus goes into it, Tab stays inside, and focus returns on close.
let dlgOpener = null;
export function showDlg(wide) {
  dlgOpener = document.activeElement;
  $("#dlg").classList.toggle("wide", wide);
  $("#dlg-wrap").hidden = false;
}
export function hideDlg() {
  $("#dlg-wrap").hidden = true;
  if (dlgOpener?.isConnected) dlgOpener.focus();
  dlgOpener = null;
}
$("#dlg-wrap").addEventListener("keydown", e => {
  if (e.key !== "Tab") return;
  const f = [...$("#dlg").querySelectorAll("button, input, select, textarea, [tabindex]")].filter(x => !x.disabled && x.offsetParent);
  if (!f.length) return;
  const i = f.indexOf(document.activeElement);
  if (e.shiftKey && i <= 0) { e.preventDefault(); f.at(-1).focus(); }
  else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
});
function openAdd(pid, rel, famId, restoring = false) {
  S.add = { pid, rel, famId: famId || null, dupOk: false, justAdded: null };
  showDlg(false);
  renderAdd();
  if (!restoring) pushView();  // Back closes it again
}
function closeDialog() {
  const was = S.add;
  hideDlg(); if (S.add) S.add.justAdded = null; S.add = null;
  if (was) dropClosedSteps();
  if (!$("#editor").hidden) renderEditor();
}
// The browser's Back (or a phone's back gesture): close whatever the address no longer shows.
window.addEventListener("popstate", () => {
  if (ownStep()) return;  // our own step back after closing something
  const v = parseView();
  if (!v.add && S.add) closeDialog();
  else if (!v.edit && !$("#editor").hidden) closeEditor();
  else saveView();  // nothing to close (e.g. Forward): keep the address true to the screen
});
// After a reload: open the editor (and the Add pop-up) the address names, if they still make sense.
export async function restoreView(v) {
  if (!v.edit || !P[v.edit]) return saveView();
  await openEditor(v.edit, null, null, true);
  if (v.add && P[v.add.pid] && canLink() && ["father", "mother", "spouse", "child"].includes(v.add.rel)) openAdd(v.add.pid, v.add.rel, v.add.famId, true);
  saveView();
}



function linked(pid) {
  const ids = new Set([pid]);
  const pf = parentFam(pid); if (pf) [pf.f, pf.m].forEach(x => x && ids.add(x));
  for (const x of spouseFams(pid)) { const o = other(x, pid); if (o) ids.add(o); x.kids.forEach(k => ids.add(k)); }
  return ids;
}
function impliedGender(rel, base) {
  if (rel === "father") return "m";
  if (rel === "mother") return "f";
  if (rel === "spouse") return base.gender === "m" ? "f" : base.gender === "f" ? "m" : "";
  return null;
}

function renderAdd() {
  const A = S.add, base = P[A.pid], dlg = $("#dlg");
  const x = A.famId && FAMS.find(f => f.id === A.famId);
  const o = x && other(x, A.pid);
  const what = A.rel === "child" ? (o ? `child of ${base.first} and ${P[o].first}` : `child of ${base.first}`)
    : `${relWord(A.rel, base)} of ${base.first}`;
  const title = h("h3", { id: "dlg-title" }, `Add ${what}`);
  const skip = linked(A.pid);
  const show = mode => { A.mode = mode; renderAdd(); };
  // One thing at a time: someone new (the usual case), or, after a tap, someone already in the tree.
  if (A.mode === "pick") {
    const q = h("input", { id: "add-q", type: "search", placeholder: "Type a name to look for", autocomplete: "off" });
    const list = h("div", { class: "pick" });
    q.addEventListener("input", () => {
      const words = searchWords(q.value);
      const hits = !words.length ? [] : Object.values(P).filter(p => !skip.has(p.id) && matches(p, words));
      list.replaceChildren(...hits.map(p => h("div", { class: "row-p" },
        h("div", {}, h("strong", {}, name(p)), h("div", { class: "small muted" }, desc(p) || "No details yet")),
        h("button", { onclick: () => doAdd({ existing: p.id }) }, "Choose"))));
      if (words.length && !hits.length) list.append(h("div", { class: "small muted" }, "No one found. ",
        h("button", { class: "linkish", onclick: () => show("new") }, "Add them as someone new")));
    });
    dlg.replaceChildren(title,
      h("button", { class: "addmode", onclick: () => show("new") }, "← Back to someone new"),
      h("label", { for: "add-q" }, "Someone already in the tree: type their name", q), list,
      h("div", { id: "add-warn" }),
      h("div", { class: "btnrow" }, h("button", { onclick: closeDialog }, "Cancel")));
    q.focus();
    return;
  }
  const nw = A.nw ??= someoneNew("add", impliedGender(A.rel, base));  // kept while switching, so typing isn't lost
  const submit = () => {
    const person = nw.check(A.dupOk,
      p => skip.has(p.id) ? h("span", { class: "small muted" }, "Already in this family") : h("button", { onclick: () => doAdd({ existing: p.id }) }, "Use this person"),
      () => { A.dupOk = true; submit(); });
    if (person) doAdd({ new: person });
  };
  dlg.replaceChildren(title,
    canLink() ? h("button", { class: "addmode", onclick: () => show("pick") }, "🔍 Pick someone already in the tree") : "",
    h("strong", {}, "Someone new"),
    nw.fields, nw.warn,
    h("div", { class: "btnrow" }, h("button", { class: "primary", onclick: submit }, "Add"), h("button", { onclick: closeDialog }, "Cancel")));
  dlg.querySelector("#add-first")?.focus();
}

async function doAdd(choice) {
  const A = S.add, base = P[A.pid];
  const buttons = [...$("#dlg").querySelectorAll("button")];
  buttons.forEach(b => { b.disabled = true; });
  setStatus("Saving…", "saving");
  try {
    await flushSaves();
    const res = await postJSON("/tree/relative", { person: A.pid, rel: A.rel, famId: A.famId, ...choice });
    const who = choice.existing ? P[choice.existing].first : (choice.new.first || choice.new.last);
    hideDlg(); S.add = null; dropClosedSteps();
    S.newlyAdded = res.added;
    await refresh();
    S.newlyAdded = null;
    setStatus("Saved ✓");
    toast(`Saved: ${who} added as ${base.first}'s ${relWord(A.rel, base)}.`, res.undo);
  } catch (err) {
    if (err instanceof LoginNeeded) return showLogin();
    buttons.forEach(b => { b.disabled = false; });
    setStatus("Saved ✓");
    $("#add-warn")?.replaceChildren(h("div", { class: "warn" }, err.message));
  }
}

export function someoneNew(prefix, knownGender) {  // knownGender: "m"/"f" (shown as a note), "" (not asked), null (asked)
  const first = h("input", { id: `${prefix}-first` }), last = h("input", { id: `${prefix}-last` });
  let gender = knownGender ?? "";
  const genderEl = knownGender == null
    ? h("fieldset", { class: "full" }, h("legend", {}, "Male or female"), ...[["m", "Male"], ["f", "Female"]].map(([v, l]) => {
        const r = h("input", { type: "radio", name: `${prefix}-g`, id: `${prefix}-g-${v}` });
        r.addEventListener("change", () => { gender = v; });
        return h("label", { class: "inline", for: r.id }, r, l);
      }))
    : knownGender ? h("div", { class: "small muted" }, `Will be saved as ${knownGender === "m" ? "male" : "female"}.`) : "";
  let bd = null;
  const bdOn = h("input", { id: `${prefix}-bd-on`, type: "checkbox" });
  const bdBox = h("div", {}, dateInputs(`${prefix}-bd`, "Birthday", () => null, v => { bd = v; }));
  bdBox.hidden = true;
  bdOn.addEventListener("change", () => { bdBox.hidden = !bdOn.checked; });
  const warn = h("div", { id: `${prefix}-warn` });
  const say = msg => warn.replaceChildren(h("div", { class: "warn" }, msg));
  return {
    fields: h("div", { class: "grid2" }, field("First name", first), field("Last name", last), genderEl,
      h("div", { class: "full" }, h("label", { class: "inline", for: bdOn.id }, bdOn, "Add their birthday"), bdBox)),
    warn, say,
    fill(text) {  // a name from a search: the first word is the first name, the rest the last name
      const [f = "", ...rest] = text.trim().split(/\s+/);
      first.value = f; last.value = rest.join(" ");
    },
    // The person typed in, or null after saying why not: no name yet, or people of that name exist
    // (each listed with action(p); "No, add as someone new" calls addAnyway).
    check(dupOk, action, addAnyway) {
      const fn = first.value.trim(), ln = last.value.trim();
      if (!fn && !ln) { say("Please write a first or last name."); first.focus(); return null; }
      const dups = sameName(fn, ln);
      if (dups.length && !dupOk) {
        warn.replaceChildren(h("div", { class: "warn" },
          h("strong", {}, `There ${dups.length === 1 ? "is 1 person" : `are ${dups.length} people`} called ${[fn, ln].filter(Boolean).join(" ")} already. Is it one of these?`),
          ...dups.map(p => h("div", { class: "row-p" },
            h("div", {}, h("strong", {}, name(p)), h("div", { class: "small muted" }, desc(p) || "No details yet")), action(p))),
          h("div", {}, h("button", { onclick: addAnyway }, "No, add as someone new"))));
        return null;
      }
      return { first: fn, last: ln, gender, birth: bdOn.checked && bd ? bd : null };
    },
  };
}
