// Easy Gramps — Check the tree (☰ Menu): things in the family data that are probably mistakes, worked out from the graph
// alone (no calls to Gramps). Plain functions of (P, FAMS), so tests/checks.test.mjs runs them without a page.
// people: {id: {first, last, gender "m"|"f"|"", birth {y}, birthPlace}}; fams: [{id, f, m, kids}].

const members = f => [f.f, f.m, ...f.kids].filter(Boolean);

// The same father (or mother) in 2+ families with no partner listed: usually brothers and sisters split by mistake.
export function splitFamilies(fams) {
  const alone = {};
  for (const f of fams) {
    const p = f.f && !f.m ? f.f : f.m && !f.f ? f.m : null;
    if (p) (alone[p] ||= []).push(f);
  }
  return Object.entries(alone).filter(([, fs]) => fs.length > 1).map(([id, fs]) => ({ id, fams: fs }));
}

// No one else in any family with them.
export function noRelatives(people, fams) {
  const linked = new Set(fams.flatMap(f => (members(f).length > 1 ? members(f) : [])));
  return Object.keys(people).filter(id => !linked.has(id));
}

// Groups of 2+ people linked to each other but not to the biggest group (the main tree): biggest first.
export function islands(people, fams) {
  const up = {}, top = x => (up[x] === x ? x : (up[x] = top(up[x])));
  for (const id of Object.keys(people)) up[id] = id;
  for (const f of fams) {
    const [a, ...rest] = members(f).filter(x => x in up);
    for (const b of rest) up[top(b)] = top(a);
  }
  const groups = {};
  for (const id of Object.keys(people)) (groups[top(id)] ||= []).push(id);
  const all = Object.values(groups).filter(g => g.length > 1).sort((a, b) => b.length - a.length);
  return all.slice(1);
}

// ---------- Possible duplicates: points for each clue; a pair over the line is listed, with the reasons ----------
// How names are compared: spellings that sound the same come out the same (Lakshmi, Laxmi → laksmi), and the
// consonants alone catch vowel spellings (Mohammed, Muhammad → mhmd). `same`: the family's own "Lakshmi = Laxmi" lines.
export function speller(same = "") {
  const plain = w => (w || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "")
    .replace(/x/g, "ks").replace(/ph/g, "f").replace(/w/g, "v").replace(/([bdgkpt])h/g, "$1").replace(/sh/g, "s")
    .replace(/q/g, "k").replace(/c(?=[eiy])/g, "s").replace(/c/g, "k").replace(/z/g, "s").replace(/y/g, "i")
    .replace(/ee/g, "i").replace(/oo/g, "u").replace(/(.)\1+/g, "$1").replace(/(.)h$/, "$1");
  const alias = {};
  for (const line of same.split("\n")) {
    const words = line.split(/[=,]/).map(plain).filter(Boolean);
    for (const w of words.slice(1)) alias[w] = words[0];
  }
  const norm = w => { const p = plain(w); return alias[p] || p; };
  const bones = w => w && w[0] + w.slice(1).replace(/[aeiou]/g, "");
  return { norm, bones };
}

function typo(a, b) {  // at most one letter added, dropped or changed
  if (Math.abs(a.length - b.length) > 1 || a.length < 4) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return [a.slice(i + 1) === b.slice(i + 1), a.slice(i + 1) === b.slice(i), a.slice(i) === b.slice(i + 1)].some(Boolean);
}

const LEVELS = { strict: [9, 7], normal: [7, 5], loose: [6, 4] };  // [very likely, maybe]

// opts: the admin's settings {year, kin, place, level, same}; notsame: [[a, b]] someone said aren't the same.
// → {likely: [...], maybe: [...]}, each {a, b, score, why: ["Same name", "Both born 1952", …]}
export function duplicates(people, fams, opts = {}, notsame = []) {
  const o = { year: true, kin: true, place: true, level: "normal", same: "", ...opts };
  const { norm, bones } = speller(o.same);
  const said = new Set(notsame.map(([a, b]) => [a, b].sort().join("|")));
  const ppl = Object.values(people).map(p => ({ p, f: norm(p.first.split(/\s+/)[0]), l: norm(p.last) })).filter(x => x.f);
  // Relatives, for "same parents" and "already related" (never a duplicate of their own father, wife or child)
  const parents = {}, spouses = {}, kids = {};
  for (const f of fams) {
    for (const k of f.kids) (parents[k] ||= new Set()).add(f.f).add(f.m);
    if (f.f && f.m) { (spouses[f.f] ||= new Set()).add(f.m); (spouses[f.m] ||= new Set()).add(f.f); }
    for (const x of [f.f, f.m]) if (x) for (const k of f.kids) (kids[x] ||= new Set()).add(k);
  }
  for (const s of Object.values(parents)) s.delete(null), s.delete(undefined);
  const shared = (a, b) => [...(a || [])].filter(x => b?.has(x));
  // Only pairs that could match are compared: the same first name's consonants, or the same initial and surname.
  const blocks = {};
  for (const x of ppl) for (const k of [`f:${bones(x.f)}`, x.l && `l:${x.f[0]}:${bones(x.l)}`]) if (k) (blocks[k] ||= []).push(x);
  const seen = new Set(), found = [];
  for (const group of Object.values(blocks)) for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
    const [x, y] = [group[i], group[j]], key = [x.p.id, y.p.id].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    if (said.has(key)) continue;
    const r = score(x, y);
    if (r && r.score >= LEVELS[o.level][1]) found.push({ a: x.p.id, b: y.p.id, ...r });
  }
  function score(x, y) {
    const a = x.p, b = y.p, why = [];
    if (a.gender && b.gender && a.gender !== b.gender) return null;
    if (parents[a.id]?.has(b.id) || parents[b.id]?.has(a.id) || spouses[a.id]?.has(b.id)) return null;
    let n = 0;
    const initial = (s, t) => (s.length === 1 || t.length === 1) && s[0] === t[0];
    if (x.f === y.f) { n += 3; } else if (bones(x.f) === bones(y.f) || typo(x.f, y.f)) { n += 2; why.push("First names sound alike"); }
    else if (initial(x.f, y.f)) { n += 1; why.push("Initial matches"); } else return null;
    if (x.l && y.l) {
      if (x.l === y.l) n += 2;
      else if (bones(x.l) === bones(y.l) || typo(x.l, y.l)) { n += 1; why.push("Surnames sound alike"); } else n -= 2;
    }
    if (x.f === y.f && x.l === y.l) why.unshift("Same name");
    const [ya, yb] = [a.birth?.y, b.birth?.y];
    if (o.year && ya && yb) {
      const d = Math.abs(ya - yb);
      if (d === 0) { n += 3; why.push(`Both born ${ya}`); } else if (d <= 2) { n += 1; why.push(`Born ${ya} and ${yb}`); } else if (d > 5) n -= 4;
    }
    if (o.kin) {
      const ps = shared(parents[a.id], parents[b.id]), sp = shared(spouses[a.id], spouses[b.id]), ks = shared(kids[a.id], kids[b.id]);
      if (ps.length) { n += 3; why.push(ps.length > 1 ? "Same parents" : `Same ${people[ps[0]]?.gender === "f" ? "mother" : "father"}`); }
      if (sp.length) { n += 3; why.push(`Same ${a.gender === "f" ? "husband" : a.gender === "m" ? "wife" : "husband or wife"}`); }
      if (ks.length) { n += 3; why.push("Same child"); }
    }
    if (o.place && a.birthPlace && a.birthPlace === b.birthPlace) { n += 1; why.push(`Both born in ${a.birthPlace}`); }
    return { score: n, why };
  }
  found.sort((p, q) => q.score - p.score);
  return { likely: found.filter(d => d.score >= LEVELS[o.level][0]), maybe: found.filter(d => d.score < LEVELS[o.level][0]) };
}
