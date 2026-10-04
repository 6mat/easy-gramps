// Easy Gramps — "Is this person in the tree twice?": find the other copy, compare, combine.
import { api, LoginNeeded } from "./auth.js";
import { $, P, S, desc, fmtDate, h, matches, name, photoEl, searchWords } from "./common.js";
import { seeTree } from "./tree.js";
import { flushSaves, hideDlg, refresh, showDlg, toast } from "./editor.js";
import { showLogin } from "./start.js";

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

export function openMerge(id) {
  S.merge = { keep: id, absorb: null, q: name(P[id]), choice: {}, text: {}, confirm: false, busy: false };
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

function renderMerge() {
  const m = S.merge, dlg = $("#dlg");
  const eq = (f, a, b) => (f.eq || ((x, y) => x === y))(f.get(a), f.get(b));

  if (!m.absorb) {  // step 1: find the duplicate
    const keep = P[m.keep];
    const input = h("input", { id: "merge-q", type: "search", value: m.q, placeholder: "Search a name", autocomplete: "off" });
    input.addEventListener("input", () => { m.q = input.value; const l = $("#merge-list"); if (l) l.replaceChildren(...candidates()); });
    function candidates() {
      const ws = searchWords(m.q);
      const list = Object.values(P).filter(p => p.id !== m.keep
        && (!ws.length || matches(p, ws)))
        .sort((a, b) => (b.last === keep.last) - (a.last === keep.last) || name(a).localeCompare(name(b))).slice(0, 40);
      return list.length ? list.map(p => h("button", { class: "pickrow", onclick: () => { m.absorb = p.id; renderMerge(); } },
        photoEl(p), h("span", {}, h("strong", {}, name(p)), h("span", { class: "small muted" }, desc(p) || "No details yet"))))
        : [h("div", { class: "small muted pad" }, "No one else found with that name.")];
    }
    dlg.replaceChildren(
      h("h2", { id: "dlg-title" }, "Is this person in the tree twice?"),
      h("p", { class: "muted" }, "Keeping ", h("strong", {}, name(keep)), ". Find the other copy to combine into them."),
      input,
      h("div", { id: "merge-list", class: "pick" }, ...candidates()),
      h("div", { class: "btnrow end" }, h("button", { onclick: closeMerge }, "Cancel")));
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
    const final = (same || sel === "keep") ? f.get(keep) : f.get(absorb);
    const result = h("div", { class: "cmpresult" }, h("span", { class: "cmpres-lbl" }, "Will be saved as"),
      editable ? (() => { const inp = h("input", { id: `cmp-${f.k}`, type: "text", "aria-label": `${f.label}: will be saved as`,
        value: f.k in m.text ? m.text[f.k] : (f.empty(f.get(keep)) ? f.get(absorb) : f.get(keep)) });
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
    const eqf = f.eq || ((x, y) => x === y);
    if (eqf(f.get(keep), f.get(absorb))) continue;
    let v;
    if (f.text && f.k in m.text) v = m.text[f.k];                       // typed / pasted / dragged
    else if (f.text) v = f.empty(f.get(keep)) ? f.get(absorb) : f.get(keep);  // default text winner
    else v = (m.choice[f.k] || mergeDefault(f, keep, absorb)) === "absorb" ? f.get(absorb) : f.get(keep);
    if (!eqf(v, f.get(keep))) fields[f.k] = v;                          // only send real changes
  }
  m.busy = true; renderMerge();
  try {
    await flushSaves();
    const res = await api("/tree/merge", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keep: m.keep, absorb: m.absorb, fields }) });
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
