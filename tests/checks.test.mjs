// Check the tree (app/static/checks.js), without a page: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { duplicates, islands, noRelatives, route, speller, splitFamilies, upTo } from "../app/static/checks.js";

const person = (id, first, last, gender = "", y, birthPlace = "") => [id, { id, first, last, gender, birth: y ? { y } : null, birthPlace }];

test("split families, no relatives, groups not connected", () => {
  const P = Object.fromEntries([person("dad", "Tom", "Lee", "m"), person("s1", "Sam", "Lee", "m"), person("s2", "Max", "Lee", "m"),
    person("lone", "Ann", "Ray", "f"), person("x", "Ivy", "Fox", "f"), person("y", "Joe", "Fox", "m")]);
  const F = [{ id: "f1", f: "dad", m: null, kids: ["s1"] }, { id: "f2", f: "dad", m: null, kids: ["s2"] }, { id: "f3", f: "y", m: "x", kids: [] }];
  assert.deepEqual(splitFamilies(F).map(s => [s.id, s.fams.length]), [["dad", 2]]);
  assert.deepEqual(noRelatives(P, F), ["lone"]);
  assert.deepEqual(islands(P, F).map(g => g.sort()), [["x", "y"]]);
});

test("names that sound alike come out the same", () => {
  const { norm, bones } = speller("Rajan = Rajanna");
  assert.equal(norm("Lakshmi"), norm("Laxmi"));
  assert.equal(bones(norm("Mohammed")), bones(norm("Muhammad")));
  assert.equal(norm("Rajanna"), norm("Rajan"));
  assert.equal(norm("Zoë"), norm("Zoe"));
});

test("possible duplicates", () => {
  const P = Object.fromEntries([person("dad", "Raj", "Kumar", "m"),
    person("a", "Lakshmi", "Kumar", "f", 1952), person("b", "Laxmi", "Kumar", "f", 1953),  // sound alike, same father: very likely
    person("c", "Ravi", "Kumar", "m", 1950), person("d", "Ravi", "Kumar", "m", 1990),       // far apart in years: no
    person("e", "Ravi", "Kumar", "f", 1950),                                               // a woman: never Ravi's duplicate
    person("g", "K", "Menon", "m"), person("h", "Kiran", "Menon", "m")]);                   // only the initial: too little
  const F = [{ id: "f1", f: "dad", m: null, kids: ["a", "b"] }];
  const d = duplicates(P, F);
  assert.deepEqual(d.likely.map(x => [x.a, x.b].sort()), [["a", "b"]]);
  assert.ok(d.likely[0].why.includes("Same father") && d.likely[0].why.includes("Born 1952 and 1953"));
  const all = [...d.likely, ...d.maybe].map(x => [x.a, x.b].sort().join());
  assert.ok(!all.includes("c,d") && !all.includes("c,e") && !all.includes("g,h"));
  assert.equal(duplicates(P, F, {}, [["b", "a"]]).likely.length, 0);  // someone said they aren't the same
  assert.equal(duplicates(P, F, { kin: false, year: false, level: "strict" }).likely.length, 0);
});

test("routes for Related to…", () => {
  // gpa+gma → dad, uncle; dad+mum → me; uncle → cousin; me+wife; wife's brother has the same parents as wife
  const F = [{ id: "g", f: "gpa", m: "gma", kids: ["dad", "uncle"] }, { id: "d", f: "dad", m: "mum", kids: ["me"] },
    { id: "u", f: "uncle", m: null, kids: ["cousin"] }, { id: "w", f: "me", m: "wife", kids: [] }, { id: "in", f: "x", m: null, kids: ["wife", "bro"] }];
  const tops = new Set(["gpa", "gma"]);
  assert.deepEqual(upTo(F, "me", tops), ["me", "dad", "gpa"]);
  assert.deepEqual(upTo(F, "cousin", tops), ["cousin", "uncle", "gpa"]);
  assert.equal(upTo(F, "wife", tops), null);
  assert.deepEqual(route(F, "me", "bro").map(s => [s.id, s.how]), [["me", undefined], ["wife", "spouse"], ["x", "parent"], ["bro", "child"]]);
  assert.equal(route(F, "me", "nobody"), null);
});

test("dates are typed and shown in the chosen format", async () => {
  globalThis.document ??= { documentElement: { dataset: {} } };  // common.js reads the page's settings when it loads
  const { fmtDate, parseTyped, setDateFormat } = await import("../app/static/common.js");
  const d = { y: 1950, m: 3, d: 12 };
  for (const [f, shown, typed] of [["d mon y", "12 Mar 1950", "12/3/1950"], ["d/m/y", "12/03/1950", "12.03.1950"], ["m/d/y", "03/12/1950", "3/12/1950"],
    ["y-m-d", "1950-03-12", "19500312"], ["mon d, y", "March 12, 1950", "3/12/1950"]]) {
    setDateFormat(f);
    assert.equal(fmtDate(d), shown);
    assert.deepEqual(parseTyped(shown), d, f);
    assert.deepEqual(parseTyped(typed), d, f);
  }
  assert.equal(parseTyped("31 Feb 1950"), null);
  assert.equal(parseTyped("12 Foo 1950"), null);
});

const HELP = { owner: false, admin: false, history: false, reviews: false, check: false, auto: true, talk: true, email: false, dms: true,
  hide: new Set(), label: (k, d) => d, date: "DD/MM/YYYY", eg: "12/03/1950", digits: "12031950" };
const ALL = { owner: true, admin: true, history: true, reviews: true, check: true, email: true };

test("How to… follows who may do what, the owner's names and hidden items", async () => {
  const { tasksFor, TASK_COUNT } = await import("../app/static/helptext.js");
  const titles = c => tasksFor({ ...HELP, ...c }, "tree").map(t => t.title);
  const steps = c => tasksFor({ ...HELP, ...c }, "tree").flatMap(t => t.steps).join(" ");
  assert.ok(!titles({ role: "guest" }).includes("Change someone's details"));
  assert.ok(titles({ role: "guest" }).includes("Change or add things in the tree"));
  assert.ok(!titles({ role: "guest" }).includes("Go back to the tree"));  // guests never open Edit person
  assert.match(steps({ role: "suggest" }), /✎ Suggest a change.*Family tree updates/);
  assert.match(steps({ role: "suggest", auto: false }), /Send to the editors/);
  assert.match(steps({ role: "editor" }), /✎ Edit person/);
  assert.doesNotMatch(steps({ role: "editor" }), /Suggest a change|Family tree updates/);
  assert.ok(titles({ role: "contributor" }).includes("Add a person who has no relatives in the tree yet"));
  assert.ok(!titles({ role: "suggest" }).includes("Add a person who has no relatives in the tree yet"));
  assert.ok(!titles({ role: "editor", hide: new Set(["docs"]) }).includes("Old family papers"));
  assert.match(steps({ role: "guest", label: (k, d) => (k === "menu" ? "More" : d) }), /☰ More/);
  assert.ok(!titles({ role: "editor" }).includes("Someone is waiting to join"));
  assert.ok(titles({ role: "editor", owner: true }).includes("Someone is waiting to join"));
  assert.equal(tasksFor({ ...HELP, role: "editor" }, "chat")[0].at, "chat");  // this screen's first
  assert.equal(tasksFor({ ...HELP, ...ALL, role: "editor" }, "tree").length, TASK_COUNT - 2);  // all but guests' note, suggesters' updates
});

// The help points at the app's real buttons, by selector and by name. Changed a button, a class or a label? This fails
// until app/static/helptext.js says the same.
test("How to… and Show me still match the app's buttons and words", async () => {
  const { tasksFor } = await import("../app/static/helptext.js");
  const fs = await import("node:fs");
  const uncomment = text => text.replace(/<!--[\s\S]*?-->/g, "").replace(/(^|\s)(\/\/|#) .*$/gm, "");  // a label only in a comment doesn't count
  const read = dir => fs.readdirSync(dir).filter(f => /\.(js|html|py)$/.test(f) && f !== "helptext.js").map(f => uncomment(fs.readFileSync(`${dir}/${f}`, "utf8")));
  const src = [...read("app/static"), ...read("app")].join("\n");
  const tasks = ["editor", "suggest", "contributor", "guest"].flatMap(role => tasksFor({ ...HELP, ...ALL, role, dms: true }, "tree"));
  const hasClass = c => new RegExp(String.raw`class(Name)?\s*[:=]\s*["\`][^"\`]*(?<![\w-])${c}(?![\w-])`).test(src);
  const hasId = id => src.includes(`id="${id}"`) || src.includes(`id: "${id}"`);
  for (const t of tasks) for (const [sel, , mode] of t.tour || []) {
    assert.ok([undefined, "tap", "read", "any"].includes(mode), `${t.title}: mode ${mode}`);
    if (!sel) continue;
    const bare = sel.replace(/:not\([^)]*\)/g, "");
    for (const [, kind, name] of bare.matchAll(/([#.])([\w-]+)/g)) assert.ok(kind === "#" ? hasId(name) : hasClass(name), `${t.title}: ${kind}${name} is gone`);
    for (const [, attr, value] of bare.matchAll(/\[([\w-]+)=([\w-]+)\]/g)) assert.ok(src.includes(`"${attr}"`) && src.includes(`["${value}",`), `${t.title}: [${attr}=${value}] is gone`);
  }
  // Every **button name**, in the steps and in Show me's bubble, is still on a button somewhere ("…" stands for a name).
  const said = tasks.flatMap(t => [...t.steps, ...(t.tour || []).map(s => s[1])]).join(" ");
  for (const [, term] of said.matchAll(/\*\*(.+?)\*\*/g))
    for (const part of term.split("…").map(x => x.replace(/^[^\p{L}\p{N}]+/u, "").trim()).filter(Boolean))
      assert.ok(src.includes(part), `"${term}" isn't in the app any more`);
});
