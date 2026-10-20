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
