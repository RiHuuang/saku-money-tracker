// Password-protected backups: AES-256-GCM with a PBKDF2-SHA-256 key. Everything runs on the device and the
// password is never stored, so a forgotten password cannot be recovered.
export const BACKUP_ITERATIONS = 600_000;
const MAX_ITERATIONS = 5_000_000;
export const MIN_PASSWORD_LENGTH = 8;

export type EncryptedBackup = { saku: "encrypted-backup"; version: 1; kdf: "PBKDF2-SHA256"; iterations: number; salt: string; iv: string; data: string };
export class WrongBackupPassword extends Error {}

const toBase64 = (bytes: Uint8Array) => { let text = ""; for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(text); };
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (character) => character.charCodeAt(0));

export function isEncryptedBackup(value: unknown): value is EncryptedBackup {
  const file = value as EncryptedBackup;
  return !!file && file.saku === "encrypted-backup" && file.version === 1 && file.kdf === "PBKDF2-SHA256" &&
    Number.isSafeInteger(file.iterations) && typeof file.salt === "string" && typeof file.iv === "string" && typeof file.data === "string";
}

async function backupKey(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function encryptBackup(json: string, password: string): Promise<string> {
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`Use a password of at least ${MIN_PASSWORD_LENGTH} characters.`);
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await backupKey(password, salt, BACKUP_ITERATIONS), new TextEncoder().encode(json)));
  const file: EncryptedBackup = { saku: "encrypted-backup", version: 1, kdf: "PBKDF2-SHA256", iterations: BACKUP_ITERATIONS, salt: toBase64(salt), iv: toBase64(iv), data: toBase64(data) };
  return JSON.stringify(file);
}

export async function decryptBackup(file: EncryptedBackup, password: string): Promise<string> {
  // Too few iterations would weaken the file; too many could freeze the device.
  if (file.iterations < BACKUP_ITERATIONS || file.iterations > MAX_ITERATIONS) throw new Error("This protected backup uses unsupported settings.");
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(file.iv) }, await backupKey(password, fromBase64(file.salt), file.iterations), fromBase64(file.data));
    return new TextDecoder().decode(plain);
  } catch { throw new WrongBackupPassword("Wrong password, or the backup file is damaged."); }
}
