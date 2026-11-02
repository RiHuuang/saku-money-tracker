export type ImportRow = {
  id: string;
  sourceId: string;
  account?: string;
  page: number;
  date: string;
  dateEvidence?: string;
  name: string;
  cleanName?: string;
  paymentMethod?: string;
  amount: number;
  direction: "expense" | "income" | "unknown";
  activity: "purchase" | "transfer" | "topup" | "card_payment" | "refund" | "income" | "fee" | "interest" | "pay_later" | "reward" | "pending" | "failed" | "unknown";
  decision: "ready" | "later" | "skip";
  pocketId: string;
  counterparty?: string;
  cardId?: string;
  firstDueMonth?: string;
  confirmedSeparate?: boolean;
  // BCA reading: the transfer note, a field the two reads disagreed on, and a match already in the ledger.
  note?: string;
  check?: string;
  alreadyInSaku?: boolean;
  // Monthly check: the ledger entry the user picked for this row, a link or pair the user undid,
  // the statement row the user paired it with by hand, and whether the user chose add/skip themselves.
  matchId?: string;
  unlinked?: boolean;
  unpaired?: boolean;
  pairRowId?: string;
  userDecided?: boolean;
  // Read without AI from a page whose running balance proves every row.
  proven?: boolean;
  // Saku's guess from the compare-names helper, shown but never applied without a tap.
  aiPick?: string;
};
export type ImportSource = {
  id: string;
  name: string;
  account: string;
  accountConfirmed?: boolean;
  accountDetected?: boolean;
  // SHA-256 of the file, so the same screenshot can't be added to a draft twice.
  hash?: string;
  mixedAccounts?: boolean;
  datesChecked?: boolean;
  file: File;
  processedPages: number;
  pageCount: number;
  error?: string;
  // The bank or wallet the statement is from, the printed opening and closing balances, and the running
  // balance (in sen) the last proven page ended on, so the next page can continue the proof.
  bank?: string;
  totals?: { opening?: number; closing?: number };
  carry?: number;
  // Pages read without AI, for the neuron budget notes in docs/monthly-check-3.0.md.
  localPages?: number;
};
export type ImportDraft = {
  id: string;
  owner: string;
  month: string;
  sources: ImportSource[];
  rows: ImportRow[];
  saved: { id: string; fingerprint: string; pairedRowId?: string }[];
  // Ledger entries this draft marked as checked, so Undo can clear the mark again.
  verified?: string[];
  // Monthly check tuning (shown in development builds only): how many choices the person had to make, and how many
  // automatic links they undid. Stays on the device with the draft.
  stats?: { decisions: number; unlinks: number };
  createdAt: number;
};

const databaseName = "saku-local-imports-v1";
const storeName = "drafts";
export const importConsentKey = (owner: string) => `saku-ai-import-consent-v1-${owner}`;
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function operation<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore, done: (value: T) => void) => void): Promise<T> {
  const db = await database();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    let result: T;
    tx.oncomplete = () => { db.close(); resolve(result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    run(tx.objectStore(storeName), (value) => { result = value; });
  });
}
export const putImportDraft = (draft: ImportDraft) => operation<void>("readwrite", (store, done) => { store.put(draft); done(); });
export const deleteImportDraft = (id: string) => operation<void>("readwrite", (store, done) => { store.delete(id); done(); });
export async function listImportDrafts(owner: string): Promise<ImportDraft[]> {
  const all = await operation<ImportDraft[]>("readonly", (store, done) => { const request = store.getAll(); request.onsuccess = () => done(request.result as ImportDraft[]); });
  return all.filter((draft) => draft.owner === owner).sort((a, b) => b.createdAt - a.createdAt);
}
export async function deleteOwnerImportDrafts(owner: string) {
  for (const draft of await listImportDrafts(owner)) await deleteImportDraft(draft.id);
}
