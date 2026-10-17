import assert from "node:assert/strict";
import { test } from "node:test";
import { runImportSources } from "./importFlow";

test("a failed source is recorded and later sources still run", async () => {
  const attempted: string[] = [], errors: string[] = [];
  const failed = await runImportSources(["broken.pdf", "wallet.png", "bank.pdf"], () => false, async (source) => {
    attempted.push(source);
    if (source === "broken.pdf") throw new Error("Unreadable PDF");
  }, async (source, error) => { errors.push(`${source}: ${(error as Error).message}`); return true; });
  assert.deepEqual(attempted, ["broken.pdf", "wallet.png", "bank.pdf"]);
  assert.deepEqual(errors, ["broken.pdf: Unreadable PDF"]);
  assert.equal(failed, 1);
});

test("a fatal failure stops later sources", async () => {
  const attempted: string[] = [];
  await assert.rejects(runImportSources(["first", "second"], () => false, async (source) => {
    attempted.push(source);
    throw new Error("Daily allowance exhausted");
  }, async () => false), /Daily allowance exhausted/);
  assert.deepEqual(attempted, ["first"]);
});

test("pause leaves remaining sources untouched", async () => {
  const attempted: string[] = [];
  let paused = false;
  const failed = await runImportSources(["first", "second"], () => paused, async (source) => {
    attempted.push(source);
    paused = true;
  }, async () => true);
  assert.deepEqual(attempted, ["first"]);
  assert.equal(failed, 0);
});
