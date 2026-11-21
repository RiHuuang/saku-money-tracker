// Banks lock e-statements with the birth date as DDMMYYYY (Mandiri, BNI, BCA cards) or DDMMYY (BCA savings,
// Danamon). Try exactly what was typed, then both forms of a typed date. Nothing is stored.
export function pdfPasswords(typed: string): string[] {
  const value = typed.trim();
  const date = value.match(/^(\d{2})(\d{2})(\d{4}|\d{2})$/) || value.match(/^(\d{1,2})[\s./-](\d{1,2})[\s./-](\d{4}|\d{2})$/);
  if (!date || +date[1] < 1 || +date[1] > 31 || +date[2] < 1 || +date[2] > 12) return [typed];
  const [day, month, short] = [date[1].padStart(2, "0"), date[2].padStart(2, "0"), date[3].slice(-2)];
  // A two-digit year is the latest one not in the future.
  const long = date[3].length === 4 ? date[3] : `${+short > new Date().getFullYear() % 100 ? 19 : 20}${short}`;
  return [...new Set([typed, `${day}${month}${long}`, `${day}${month}${short}`])];
}

export async function runImportSources<T>(
  sources: readonly T[],
  paused: () => boolean,
  process: (source: T) => Promise<void>,
  onError: (source: T, error: unknown) => Promise<boolean>,
): Promise<number> {
  let failed = 0;
  for (const source of sources) {
    if (paused()) break;
    try { await process(source); }
    catch (error) {
      const continueRun = await onError(source, error);
      failed++;
      if (!continueRun) throw error;
    }
  }
  return failed;
}
