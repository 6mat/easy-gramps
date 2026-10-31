// Easy Gramps — "Duplicate profile? Merge.": find the other profile, compare, combine.
import { api, LoginNeeded } from "./auth.js";
import { $, P, S, fmtDate, h, matches, name, other, parentFam, photoEl, postJSON, searchWords, spouseFams } from "./common.js";
import { hitRows, searchKeys } from "./search.js";
import { seeTree } from "./tree.js";
import { flushSaves, hideDlg, refresh, showDlg, toast } from "./editor.js";
import { showLogin } from "./start.js";
import { addingRow, isStandIn, suggestDelete, suggesting, withdraw } from "./suggest.js";

// ---------- merge two records of the same person ----------
const dateEq = (a, b) => (!a && !b) || (a && b && a.y === b.y && (a.m || 0) === (b.m || 0) && (a.d || 0) === (b.d || 0) && !!a.about === !!b.about);
const genderShow = g => g === "m" ? "Male" : g === "f" ? "Female" : "Not set";
const MERGE_FIELDS = [
  { k: "first", label: "First name", text: true, get: p => p.first || "", show: v => v || "—", empty: v => !v },
  { k: "last", label: "Last name", text: true, get: p => p.last || "", show: v => v || "—", empty: v => !v },
  { k: "nick", label: "Nickname", text: true, get: p => p.nick || "", show: v => v || "—", empty: v => !v },
  { k: "gender", label: "Male or female?", get: p => p.gender || "", show: genderShow, eq: (a, b) => (a || "") === (b || ""), empty: v => !v },
  { k: "birth", label: "Birthday", get: p => p.birth || null, show: v => fmtDate(v) || "—", eq: dateEq, empty: v => !v },
  { k: "birthPlace", label: "Place of birth", text: true, get: p => p.birthPlace || "", show: v => v || "—", empty: v => !v },
  { k: "death", label: "Date of death", get: p => p.death || null, show: v => fmtDate(v) || "—", eq: dateEq, empty: v => !v },
  { k: "burial", label: "Place of burial", text: true, get: p => p.burial || "", show: v => v || "—", empty: v => !v },
];

export function openMerge(id, absorb = null) {  // absorb: already known (Check the tree → Possible duplicates)
  S.merge = { keep: id, absorb, q: name(P[id]), choice: {}, text: {}, confirm: false, busy: false };
  showDlg(true);
  renderMerge();
  $("#merge-q")?.focus();
}
function swapMerge() {
  const m = S.merge;
  [m.keep, m.absorb] = [m.absorb, m.keep];
  m.choice = {}; m.text = {}; m.confirm = false;
  renderMerge();
}
function mergeDefault(f, keep, absorb) {  // which side wins by default: keep's value unless it's empty
  return !f.empty(f.get(keep)) ? "keep" : (!f.empty(f.get(absorb)) ? "absorb" : "keep");
}
const valuesEq = (f, a, b) => (f.eq || ((x, y) => x === y))(a, b);
// What a field will be saved as, for the screen and the save alike: typed text, else the side picked
// (by default the kept person's value, unless it's empty).
function finalValue(f, keep, absorb) {
  const m = S.merge;
  if (f.text && f.k in m.text) return m.text[f.k];
  return (m.choice[f.k] || mergeDefault(f, keep, absorb)) === "absorb" ? f.get(absorb) : f.get(keep);
}

function renderMerge() {
  const m = S.merge, dlg = $("#dlg");
  const eq = (f, a, b) => valuesEq(f, f.get(a), f.get(b));

  if (!m.absorb) {  // step 1: find the duplicate
    const keep = P[m.keep];
    const input = h("input", { id: "merge-q", type: "search", value: m.q, placeholder: "Search a name", autocomplete: "off" });
    input.addEventListener("input", () => { m.q = input.value; const l = $("#merge-list"); if (l) l.replaceChildren(...candidates()); });
    function candidates() {
      const ws = searchWords(m.q);
      const list = Object.values(P).filter(p => p.id !== m.keep
        && (!ws.length || matches(p, ws)))
        .sort((a, b) => (b.last === keep.last) - (a.last === keep.last) || name(a).localeCompare(name(b))).slice(0, 40);
      // ⓘ shows who each one is (born, parents, family), so the right profile gets merged.
      return list.length ? hitRows(list, p => { m.absorb = p.id; renderMerge(); }, "Choose")
        : [h("div", { class: "small muted pad" }, "No one else found with that name.")];
    }
    dlg.replaceChildren(
      h("h2", { id: "dlg-title" }, "Duplicate profile? Merge."),
      h("p", { class: "muted" }, "Keeping ", h("strong", {}, name(keep)), ". Find their other profile to merge into this one."),
      input,
      h("div", { id: "merge-list", class: "pick hits" }, ...candidates()),
      h("div", { class: "btnrow end" }, h("button", { onclick: closeMerge }, "Cancel")));
    searchKeys(input, $("#merge-list"));
    return;
  }

  // step 2: compare and choose
  const keep = P[m.keep], absorb = P[m.absorb];
  const rows = MERGE_FIELDS.map(f => {
    const same = eq(f, keep, absorb);
    const sel = m.choice[f.k] || mergeDefault(f, keep, absorb);
    const editable = f.text && !same;
    const opt = (side, who) => h("button", {
      class: `cmpopt${!same && !editable && sel === side ? " on" : ""}${f.empty(f.get(who)) ? " empty" : ""}`,
      disabled: same, onclick: () => {
        if (editable) { m.text[f.k] = f.get(who); const inp = $(`#cmp-${f.k}`); if (inp) inp.value = f.get(who); }
        else { m.choice[f.k] = side; renderMerge(); }
      } }, f.show(f.get(who)));
    const final = same ? f.get(keep) : finalValue(f, keep, absorb);
    const result = h("div", { class: "cmpresult" }, h("span", { class: "cmpres-lbl" }, "Will be saved as"),
      editable ? (() => { const inp = h("input", { id: `cmp-${f.k}`, type: "text", "aria-label": `${f.label}: will be saved as`,
        value: final });
        inp.addEventListener("input", () => { m.text[f.k] = inp.value; }); return inp; })()
      : h("div", { class: `cmpfinal${f.empty(final) ? " empty" : ""}` }, f.show(final)));
    return h("div", { class: `cmprow${same ? " same" : ""}${editable ? " text" : ""}` },
      h("div", { class: "cmplabel" }, f.label),
      opt("keep", keep), opt("absorb", absorb), result);
  });
  const diffs = MERGE_FIELDS.filter(f => !eq(f, keep, absorb)).length;

  dlg.replaceChildren(
    h("h2", { id: "dlg-title" }, "Combine two people into one"),
    h("div", { class: "cmphead" },
      h("button", { class: "ghost swap", title: "Swap which one is kept", onclick: swapMerge }, "⇄"),
      h("div", { class: "cmpwho keepcol" }, h("div", { class: "cmptag" }, "KEEP"), photoEl(keep), h("strong", {}, name(keep))),
      h("div", { class: "cmpwho" }, h("div", { class: "cmptag muted" }, "REMOVE"), photoEl(absorb), h("strong", {}, name(absorb))),
      h("div", { class: "cmpwho rescol" }, h("div", { class: "cmptag" }, "AFTER MERGE"), h("strong", {}, "Will be saved as"))),
    diffs ? h("p", { class: "small muted" }, "Tap a value to use it. Names and places can also be typed, pasted or dragged into the “Will be saved as” column. Photos, notes, phone and all family links are combined automatically.")
          : h("p", { class: "small muted" }, "These match. Photos, notes, phone and all family links will be combined."),
    h("div", { class: "cmp" }, ...rows),
    m.confirm
      ? h("div", { class: "warn" },
          h("div", {}, h("strong", {}, name(absorb)), " will be removed and folded into ", h("strong", {}, name(keep)),
            ". This can't be undone with the Undo button."),
          h("div", { class: "btnrow" },
            h("button", { class: "danger", disabled: m.busy, onclick: doMerge }, m.busy ? "Combining…" : "Yes, combine them"),
            h("button", { disabled: m.busy, onclick: () => { m.confirm = false; renderMerge(); } }, "Go back")))
      : h("div", { class: "btnrow end" },
          h("button", { onclick: () => { m.absorb = null; m.choice = {}; renderMerge(); } }, "← Pick someone else"),
          h("button", { onclick: closeMerge }, "Cancel"),
          h("button", { class: "primary", onclick: () => { m.confirm = true; renderMerge(); } }, `Combine, keep ${keep.first || "this one"}`)));
}

async function doMerge() {
  const m = S.merge, keep = P[m.keep], absorb = P[m.absorb];
  const fields = {};
  for (const f of MERGE_FIELDS) {
    if (valuesEq(f, f.get(keep), f.get(absorb))) continue;
    const v = finalValue(f, keep, absorb);
    if (!valuesEq(f, v, f.get(keep))) fields[f.k] = v;  // only send real changes
  }
  m.busy = true; renderMerge();
  try {
    await flushSaves();
    const res = await postJSON("/tree/merge", { keep: m.keep, absorb: m.absorb, fields });
    closeMerge();
    if (S.focus === m.absorb) S.focus = res.merged;
    S.sel = res.merged;
    await refresh();
    seeTree(res.merged);
    toast(`Combined into ${res.name}.`);
  } catch (err) {
    m.busy = false;
    if (err instanceof LoginNeeded) return showLogin();
    renderMerge();
    toast(`Couldn't combine: ${err.message}`);
  }
}
export function closeMerge() { hideDlg(); $("#dlg").classList.remove("wide"); S.merge = null; }

// ---------- "Delete this person": one made by mistake or in the wrong place, from the tree and Gramps ----------
// main.py `delete_mode` says whether this login deletes them now or asks (a suggestion someone else approves).
// Suggesters see it as deleting either way: their own suggested new person really is deleted (the suggestion).
export async function openDelete(id) {
  const p = P[id], pf = parentFam(id), word = `Delete ${p.first || name(p)}`;
  const kin = [pf?.f, pf?.m, ...spouseFams(id).flatMap(f => [other(f, id), ...f.kids])].filter(x => x && P[x]);
  const dlg = $("#dlg"), go = h("button", { class: "danger" }, word), cancel = h("button", { onclick: hideDlg }, "Cancel");
  const links = kin.length ? h("p", {}, "Their links to ", h("strong", {}, kin.map(k => name(P[k])).join(", ")), " go too; those people stay.") : "";
  const run = (busy, act, done) => async () => {
    go.disabled = true; go.textContent = busy;
    try { await act(); hideDlg(); toast(done); }
    catch (err) {
      if (err instanceof LoginNeeded) return showLogin();
      go.disabled = false; go.textContent = word;
      toast(`Couldn't delete: ${err.message}`);
    }
  };
  const open = (...body) => { dlg.replaceChildren(h("h2", { id: "dlg-title" }, `Delete ${name(p)}?`), ...body, h("div", { class: "btnrow end" }, cancel, go)); showDlg(false); cancel.focus(); };
  if (isStandIn(id)) {  // someone they suggested adding: the suggestion goes
    const row = addingRow(id);
    if (!row) return toast("An editor has looked at that one already.");
    go.onclick = run("Deleting…", async () => { await withdraw(row.id); if (S.focus === null && kin[0]) seeTree(kin[0]); }, `Deleted ${name(p)} ✓`);
    return open(h("p", {}, "They were waiting for an editor to add them. What you suggested about them goes too."));
  }
  let how;
  try { how = await api(`/tree/person/${id}/delete`); } catch (err) { return toast(err.message, false); }
  if (how.mode === "no") return toast("You can't delete people in this tree.", false);
  if (how.mode === "suggest") {
    const why = h("textarea", { id: "del-why", maxlength: 500, rows: 2 });
    go.onclick = run(suggesting() ? "Deleting…" : "Sending…", () => suggestDelete(id, why.value.trim()),
      suggesting() ? "Done ✓ They go from the tree once an editor agrees." : "Sent ✓ Another editor will look at it in ☰ Menu → Manage → Suggestions.");
    if (!suggesting()) go.textContent = "Ask another editor";
    return open(h("p", {}, suggesting() ? "An editor checks it first, then they go from the tree and from Gramps." : how.why),
      suggesting() && how.why ? h("p", { class: "small muted" }, how.why) : "", links,
      h("label", { for: why.id }, "Why? (optional, helps the editor)", why));
  }
  go.onclick = async () => {
    go.disabled = true; go.textContent = "Deleting…";
    try {
      await flushSaves();
      await api(`/tree/person/${id}`, { method: "DELETE" });
      if (S.focus === id) S.focus = kin[0] || null;  // stay with the family (or the start screen when there's none)
      if (S.sel === id) S.sel = S.focus;
      await refresh();  // (the dialog stays up till then: the old panel still has their buttons)
      hideDlg();
      if (S.focus) seeTree(S.focus);
      toast(`Deleted ${name(p)}.`);
    } catch (err) {
      if (err instanceof LoginNeeded) return showLogin();
      go.disabled = false; go.textContent = `Delete ${p.first || name(p)}`;
      toast(`Couldn't delete: ${err.message}`);
    }
  };
  open(h("p", {}, "They go from the tree and from Gramps, with their own events (birth, death and so on). ",
    "Photos and documents stay in Gramps."), links,
  h("p", { class: "warn" }, "This can't be undone. A duplicate? Use Merge instead: it keeps what both have."));
}
