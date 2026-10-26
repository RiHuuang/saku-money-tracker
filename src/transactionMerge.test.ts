import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyData, type Data, type Transaction } from "./domain";
import { mergeTransactionSnapshots } from "./transactionMerge";

const row = (id: string, amount = 1000): Transaction => ({ id, name: id, amount, type: "expense", date: "2026-10-26", pocketId: "", account: "Cash", note: "" });
const withRows = (...transactions: Transaction[]): Data => ({ ...emptyData(), transactions });

test("independent additions merge once and preserve original IDs", () => {
  const merged = mergeTransactionSnapshots(withRows(), withRows(row("phone")), withRows(row("web")));
  assert.deepEqual(merged.conflicts, []);
  assert.deepEqual(merged.data?.transactions.map((item) => item.id), ["phone", "web"]);
});

test("a deletion survives an unrelated edit, while deletion versus edit conflicts", () => {
  const base = withRows(row("delete"), row("edit"));
  const local = withRows(row("edit"));
  const remote = withRows(row("delete"), row("edit", 2000));
  const merged = mergeTransactionSnapshots(base, local, remote, new Set(["delete"]));
  assert.deepEqual(merged.conflicts, []);
  assert.deepEqual(merged.data?.transactions.map((item) => [item.id, item.amount]), [["edit", 2000]]);
  assert.deepEqual(mergeTransactionSnapshots(base, local, withRows(row("delete", 2000), row("edit")), new Set(["delete"])).conflicts, ["delete"]);
});

test("identical edits and reordered JSON properties do not conflict", () => {
  const base = withRows(row("same"));
  const phone = withRows({ ...row("same"), amount: 2000 });
  const { amount: _amount, ...rest } = row("same");
  const cloud = withRows({ amount: 2000, ...rest });
  const merged = mergeTransactionSnapshots(base, phone, cloud);
  assert.deepEqual(merged.conflicts, []);
  assert.equal(merged.data?.transactions[0].amount, 2000);
});

test("same-ID additions and incompatible workspace edits require review", () => {
  assert.deepEqual(mergeTransactionSnapshots(withRows(), withRows(row("collision")), withRows(row("collision", 2000))).conflicts, ["collision"]);
  const base = withRows();
  const phone = { ...base, name: "Phone" }, web = { ...base, name: "Web" };
  assert.deepEqual(mergeTransactionSnapshots(base, phone, web).conflicts, ["workspace"]);
  assert.deepEqual(mergeTransactionSnapshots(null, phone, web).conflicts, ["workspace"]);
});

test("a persisted tombstone prevents a stale remote add from being silently restored", () => {
  assert.deepEqual(mergeTransactionSnapshots(withRows(), withRows(), withRows(row("deleted")), new Set(["deleted"])).conflicts, ["deleted"]);
});

test("an unverified flag written by the editor is not a change", () => {
  const base = withRows(row("keep"));
  const phone = withRows({ ...row("keep"), amount: 1200, verified: false });
  const cloud = withRows({ ...row("keep"), amount: 1200 });
  assert.deepEqual(mergeTransactionSnapshots(base, phone, cloud).conflicts, []);
  assert.deepEqual(mergeTransactionSnapshots(base, withRows({ ...row("keep"), verified: false }), withRows(row("keep", 3000))).data?.transactions.map((item) => item.amount), [3000]);
  assert.deepEqual(mergeTransactionSnapshots(base, withRows({ ...row("keep"), amount: 1200, verified: true }), cloud).conflicts, ["keep"]);
});

test("independent additions on two devices also merge their learned merchant rules", () => {
  const rule = (key: string, updatedAt: string, pocketId = "") => ({ key, name: key, pocketId, updatedAt });
  const base = { ...withRows(), merchantRules: [rule("shared", "2026-10-01T00:00:00.000Z")] };
  const phone = { ...withRows(row("phone")), merchantRules: [...base.merchantRules, rule("phone", "2026-10-26T01:00:00.000Z")] };
  const web = { ...withRows(row("web")), merchantRules: [...base.merchantRules, rule("web", "2026-10-26T02:00:00.000Z")] };
  const merged = mergeTransactionSnapshots(base, phone, web);
  assert.deepEqual(merged.conflicts, []);
  assert.deepEqual(merged.data?.merchantRules.map((item) => item.key), ["shared", "phone", "web"]);
  const newer = mergeTransactionSnapshots(base, { ...base, merchantRules: [rule("shared", "2026-10-26T01:00:00.000Z", "food")] }, { ...base, merchantRules: [rule("shared", "2026-10-26T03:00:00.000Z", "fun")] });
  assert.deepEqual(newer.data?.merchantRules.map((item) => item.updatedAt), ["2026-10-26T03:00:00.000Z"], "the newer rule wins");
});

test("settings merge per field and per item, and only real clashes need review", () => {
  const base = { ...withRows(), checkedDays: ["2026-10-01"] };
  const phone = { ...base, name: "Phone name", checkedDays: ["2026-10-01", "2026-10-02"] };
  const web = { ...base, accounts: [...base.accounts, "Jago"], checkedDays: ["2026-10-01", "2026-10-03"] };
  const merged = mergeTransactionSnapshots(base, phone, web);
  assert.deepEqual(merged.conflicts, []);
  assert.equal(merged.data?.name, "Phone name");
  assert.ok(merged.data?.accounts.includes("Jago"));
  assert.deepEqual(merged.data?.checkedDays, ["2026-10-01", "2026-10-02", "2026-10-03"]);
  const pocket = (name: string) => ({ ...emptyData(), pockets: [{ id: "p1", name, color: "#176b55", budget: 0, rollover: false }] } as unknown as Data);
  const pockets = pocket("Food");
  assert.deepEqual(mergeTransactionSnapshots(pockets, { ...pockets, pockets: pocket("Meals").pockets }, { ...pockets, pockets: pocket("Groceries").pockets }).conflicts, ["workspace"]);
});
