import assert from "node:assert/strict";
import { loadFixture, score } from "./fixtures/statements/bench.mjs";

const jago = loadFixture("jago");
const perfect = jago.expectedRows.map((row) => ({ ...row, cleanName: row.name }));
assert.equal(score(jago.expectedRows, perfect).gate, true);
const flipped = perfect.map((row, index) => index === 0 ? { ...row, direction: "expense" } : row);
assert.equal(score(jago.expectedRows, flipped).gate, false, "one wrong direction fails the gate");
const wrongDate = perfect.map((row, index) => index === 0 ? { ...row, date: "2026-10-31" } : row);
assert.equal(score(jago.expectedRows, wrongDate).gate, false, "one wrong date fails the gate");
const repeated = [{ date: "2026-10-01", amount: 100, direction: "expense", name: "First" }, { date: "2026-10-02", amount: 100, direction: "income", name: "Second" }];
assert.equal(score(repeated, [...repeated].reverse()).gate, true, "repeat amounts match independent of row order");
assert.equal(score(jago.expectedRows, [...perfect, { date: "2026-10-20", amount: 1, direction: "expense", name: "made up" }]).invented, 1, "an extra row counts as invented");
assert.equal(score(jago.expectedRows, perfect.slice(1)).gate, false, "a missed row fails the gate");
for (const bank of ["bca", "jago", "seabank", "blu", "gopay", "dana"]) assert.ok(loadFixture(bank).expectedRows.every((row) => row.name), `${bank}: every expected row names its party`);
console.log("Statement bench: gate scoring, invented and missed rows, and six-bank fixtures passed");
