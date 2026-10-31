// Check the tree (app/static/checks.js), without a page: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { duplicates, islands, noRelatives, speller, splitFamilies } from "../app/static/checks.js";

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
