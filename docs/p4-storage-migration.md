# P4-1 Android SQLite migration plan

This plan belongs to the P4-1 branch, based on P2-7 (`db55dcc`). P2 notification
capture is already in that stack. The browser keeps its current Preferences store.
Do not switch the Android reader until the app, widget, and background sync paths
can all use the same database.

## Current write paths

| Writer or reader | Current source | Required change |
| --- | --- | --- |
| `src/storage.ts` | `saku-ledger-v3-<user>` JSON in Capacitor Preferences | Open native SQLite; migrate once; persist transaction rows and ledger metadata in one database transaction. |
| `WidgetLedger.kt` | Same Preferences JSON, including quick add and Undo | Read and update the same SQLite tables. Keep the existing tap guard and revision notification. |
| `WidgetCloudSyncJob.kt` | Same Preferences JSON during upload and conflict resolution | Serialize a consistent SQLite snapshot and compare its revision after upload; never clear `dirty` for a newer ledger. |
| Web app | Preferences/IndexedDB | No store change. |

`saku-cloud-state-v1` and the secure session remain in their existing stores.
Cloud synchronization still transfers the validated v3 JSON format. SQLite is a
local storage change, not a new server format.

## Database and migration

- Use `@capacitor-community/sqlite` on Android, with an unencrypted database named
  `saku-ledger`. Android's own app sandbox protects the file. The plugin's Android
  file naming convention is `<name>SQLite.db`; confirm that path against the
  installed plugin version before native code opens it.
- Store non-transaction `Data` fields as one validated JSON document per user.
  Store transactions separately with `(user_id, transaction_id)` primary key,
  position, and JSON payload. This targets the current whole-ledger rewrite cost
  without inventing tables for every domain field. `loadData` assembles the same
  `Data` object that `validateData` already accepts.
- On first Android open for a user, read the v3 Preferences value. Validate it,
  then write metadata and every transaction in one SQLite transaction. Read it
  back and compare canonical content before marking the migration complete. Keep
  the Preferences copy through at least one release as a recovery source; never
  overwrite an existing SQLite ledger with it on a later launch. Empty ledgers
  need an explicit database row so they are distinguishable from an unmigrated
  user.
- On ordinary saves, write only inserted, changed, or deleted transaction rows
  and changed metadata. `replaceData` may replace all rows because cloud restore
  intentionally replaces the snapshot. Serialize all writers with SQLite
  transactions so widget quick adds cannot be overwritten by a stale app save.
- Keep `removeUserData` scoped to one user, deleting its database rows and its old
  Preferences key only after the cloud account cleanup path has completed.

## Write ordering and sync safety

The app currently writes the ledger, then marks cloud state dirty. A crash in
that gap can leave a saved local transaction unsynced. The migration must make
the durable ledger revision authoritative: increment it in the same SQLite
transaction as a ledger change. `WidgetCloudSyncJob` and the foreground sync
must compare the revision they uploaded with the current database revision
before clearing `dirty`. On launch, a database revision newer than the last
acknowledged revision must restore `dirty`, even if Preferences says false.

Do not write a whole JSON mirror back to Preferences on each save; that would
retain the cost this item is meant to remove. Keep the existing v3 key only as
the one-time migration source until a separately verified removal release.

## Acceptance gate

1. Automated migration fixture: a populated v3 Preferences ledger and an empty
   one each survive migration; a simulated interrupted migration retries without
   duplicates or data loss.
2. Native app: add, edit, delete, restore, and account switch preserve exact IDs,
   amounts, ordering, pockets, and balance check-ins across process restarts.
3. Closed-app widget: quick add, transfer, favorite, and Undo update the same
   ledger seen by the app; repeated taps remain idempotent.
4. Background sync: a widget mutation uploads after the app is closed; a second
   mutation during upload stays dirty and later syncs; a 409 leaves local rows
   intact for conflict resolution.
5. Existing web storage and Android sign-in work; `npm test`, `npm run build`,
   Android debug build and unit tests pass. Verify on a separate stage package,
   never over an installed release app.

P4-2's three-way merge should build on this revision-safe storage layer; it
must not silently resolve simultaneous edits to the same transaction.
