import assert from "node:assert/strict";
import { test } from "node:test";
import { BACKUP_ITERATIONS, WrongBackupPassword, decryptBackup, encryptBackup, isEncryptedBackup } from "./backupCrypto";

const ledger = JSON.stringify({ name: "Rani", transactions: [{ name: "Kopi Tuku", amount: 28000 }] });

test("a protected backup round-trips and hides its contents", async () => {
  const text = await encryptBackup(ledger, "correct horse");
  const file = JSON.parse(text);
  assert.equal(isEncryptedBackup(file), true);
  assert.ok(file.iterations >= 600_000 && file.iterations === BACKUP_ITERATIONS);
  assert.equal(text.includes("Kopi Tuku") || text.includes("Rani"), false, "no plaintext names in the file");
  assert.equal(await decryptBackup(file, "correct horse"), ledger);
  assert.notEqual((await encryptBackup(ledger, "correct horse")), text, "salt and IV differ per export");
});

test("wrong passwords, tampering and weak settings fail cleanly", async () => {
  const file = JSON.parse(await encryptBackup(ledger, "correct horse"));
  await assert.rejects(decryptBackup(file, "wrong horse"), WrongBackupPassword);
  const bytes = Buffer.from(file.data, "base64"); bytes[0] ^= 1;
  await assert.rejects(decryptBackup({ ...file, data: bytes.toString("base64") }, "correct horse"), WrongBackupPassword);
  await assert.rejects(decryptBackup({ ...file, iterations: 1000 }, "correct horse"), /unsupported settings/);
  await assert.rejects(encryptBackup(ledger, "short"), /at least 8/);
  assert.equal(isEncryptedBackup({ version: 3, transactions: [] }), false, "plain backups are not mistaken for protected ones");
});
