import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyData, validateData, type Transaction } from "./domain";
import { recordReconciliationBatch, undoReconciliationBatch } from "./reconciliationBatches";
import { mergeTransactionSnapshots } from "./transactionMerge";
const row = (id: string): Transaction => ({ id, date: "2026-10-10", name: "Synthetic payment", amount: 10000, type: "expense", account: "Cash", pocketId: "", note: "" });
const meta = (id = "check") => ({ id, createdAt: "2026-11-07T00:00:00Z", evidence: ["synthetic-source:row-1"] });
test("monthly batch persists additions, verification and aliases together and Undo preserves unrelated later entries", () => {
  const before = { ...emptyData(), accounts: ["Cash"], transactions: [row("old")] };
  const after = { ...before, transactions: [{ ...row("old"), verified: true }, row("added")], merchantRules: [{ key: "synthetic", name: "Synthetic merchant", pocketId: "", updatedAt: "2026-11-07T00:00:00Z" }] };
  const saved = recordReconciliationBatch(before, after, meta());
  const reloaded = validateData(JSON.parse(JSON.stringify(saved)));
  const undone = undoReconciliationBatch({ ...reloaded, transactions: [...reloaded.transactions, row("later")] }, "check");
  assert.deepEqual(undone.transactions, [row("old"), row("later")]);
  assert.deepEqual(undone.merchantRules, []);
  assert.equal(undone.reconciliationBatches![0].undone, true);
  assert.throws(() => undoReconciliationBatch(undone, "check"));
  assert.throws(() => recordReconciliationBatch(saved, saved, meta()));
});
test("Undo rejects an owned entry or alias edited afterwards without modifying the ledger", () => {
  const before = { ...emptyData(), accounts: ["Cash"] };
  const saved = recordReconciliationBatch(before, { ...before, transactions: [row("added")] }, meta());
  const edited = { ...saved, transactions: [{ ...row("added"), note: "Later edit" }] };
  const snapshot = JSON.stringify(edited);
  assert.throws(() => undoReconciliationBatch(edited, "check"));
  assert.equal(JSON.stringify(edited), snapshot);
});
test("reconciliation history is optional, rejects invalid fingerprints and merges independent batches", () => {
  const before = { ...emptyData(), accounts: ["Cash"] };
  assert.doesNotThrow(() => validateData(before));
  const local = recordReconciliationBatch(before, { ...before, transactions: [row("a")] }, meta("a"));
  const remote = recordReconciliationBatch(before, { ...before, transactions: [row("b")] }, meta("b"));
  const merged = mergeTransactionSnapshots(before, local, remote);
  assert.equal(merged.data?.reconciliationBatches?.length, 2);
  assert.equal(merged.data?.transactions.length, 2);
  assert.throws(() => validateData({ ...local, reconciliationBatches: [{ ...local.reconciliationBatches![0], transactions: [{ id: "a", after: "{broken" }] }] }));
});

test("confirmed statement mappings survive backup validation and reject missing accounts", () => {
  const data = { ...emptyData(), accounts: ["Cash", "Jago"], statementAccountMappings: [{ id: "jago-pocket", bank: "jago", statementAccount: "Spending pocket", account: "Jago" }] };
  assert.deepEqual(validateData(JSON.parse(JSON.stringify(data))).statementAccountMappings, data.statementAccountMappings);
  assert.throws(() => validateData({ ...data, statementAccountMappings: [{ ...data.statementAccountMappings[0], account: "Missing" }] }));
});

test("statement balances retain independent evidence without accepting inferred invalid anchors", () => {
  const data = { ...emptyData(), accounts: ["Cash"], statementBalanceObservations: [{ id: "closing", account: "Cash", date: "2026-10-31", balance: 20000, evidence: "Synthetic printed closing balance" }] };
  assert.deepEqual(validateData(JSON.parse(JSON.stringify(data))).statementBalanceObservations, data.statementBalanceObservations);
  assert.throws(() => validateData({ ...data, statementBalanceObservations: [{ ...data.statementBalanceObservations[0], evidence: "" }] }));
  assert.throws(() => validateData({ ...data, statementBalanceObservations: [{ ...data.statementBalanceObservations[0], balance: -1 }] }));
});

test("Undo reverts batch-owned balance anchors and account mappings", () => {
  const before = { ...emptyData(), accounts: ["Cash"] };
  const after = { ...before, statementBalanceObservations: [{ id: "anchor", account: "Cash", date: "2026-10-31", balance: 10000, evidence: "Synthetic independent balance" }], statementAccountMappings: [{ id: "mapping", bank: "dana", statementAccount: "Wallet", account: "Cash" }] };
  const saved = recordReconciliationBatch(before, after, meta());
  const undone = undoReconciliationBatch(saved, "check");
  assert.deepEqual(undone.statementBalanceObservations, []);
  assert.deepEqual(undone.statementAccountMappings, []);
});
