# P4-2 transaction merge plan

This change is stacked on P4-1 so Android's foreground app and widget job can
share one durable sync base. The Worker keeps its whole-snapshot revision API.

## Local sync base

- Keep the last **acknowledged** cloud snapshot and revision per user. On Android,
  store transaction rows and non-transaction metadata in SQLite beside the
  ledger; on web, use the existing browser storage. Never use a candidate
  upload as the base until the server acknowledges its exact revision.
- Persist local deletion tombstones by transaction ID in the same local write
  transaction as the ledger deletion. Clear them only after a cloud revision
  containing that deletion is acknowledged. Cloud restore clears tombstones
  after the remote snapshot is safely adopted.
- The Android `WidgetCloudSyncJob` must update the shared sync base when its
  upload succeeds; otherwise a later foreground 409 would merge against stale
  history. A crash between server acknowledgement and local base update must
  leave the ledger dirty, so the next attempt downloads the remote snapshot.
- Bind the base and tombstones to the signed-in user. Never merge snapshots
  from different Google identities. On sign-out, retain local ledger data under
  its user ID according to the existing sign-out policy; account deletion
  removes that user's base and tombstones too.

## Three-way rule at HTTP 409

Download the latest remote snapshot and revision. For each transaction ID,
compare `base`, `local`, and `remote` by content, ignoring JSON property order:

| Local versus base | Remote versus base | Result |
| --- | --- | --- |
| unchanged | changed or deleted | take remote |
| changed or deleted | unchanged | take local (respect tombstone) |
| same change | same change | take either once |
| different changes | different changes | show a conflict for that ID |
| new ID on one side | absent on other | include it once |
| new same ID with different content | new same ID with different content | conflict |

Apply the same three-way rule to all non-transaction `Data` fields as one
metadata unit. Simultaneous incompatible pocket/account/budget edits must keep
the existing manual choice flow. After merging, run `validateData`; invalid
references or transfer pairs also require manual review. Preserve local row
order, then append remote-only rows in their remote order.

Upload the merged whole snapshot with the downloaded remote revision. Another
409 retries from the **same acknowledged base** against the latest remote,
up to a bounded count; do not mark the base or clear tombstones on a failed
attempt. If the local ledger changes while download or upload is in flight,
restart with the newest local snapshot. The user sees the existing conflict
choice only for ambiguous edits, never a silent overwrite.

## As implemented

- The base is one table, `ledger_sync_base`, on Android (written by
  `src/nativeLedger.ts` and by `LedgerDatabase.saveSyncBase` from the widget
  job) and `saku-sync-base-v1-<user>` in Preferences on web. It is written
  after every acknowledged upload, every adopted cloud copy, and when the user
  reviews a conflict in favour of the device (the reviewed cloud copy is then
  the base for the next upload).
- Deletions are derived from the base: a row in the base but missing locally
  was deleted here. Because the base only advances on acknowledgement, this is
  the durable tombstone list, and no separate store is needed.
- A base whose revision is newer than the cloud's, or that belongs to another
  user, is ignored and the existing review screen is shown.
- The foreground app merges at three points: a 409 during upload (up to three
  merges per sync run), a live notice of a newer cloud copy while this device
  has unsynced edits, and opening the workspace with unsynced edits. Each saves
  the merge, records the cloud revision, and uploads; an edit made meanwhile
  restarts from the newest local ledger instead.
- The closed-app widget job records the base but does not merge. On a 409 with
  different content it leaves the ledger dirty, and the app merges it on next
  open.

## Acceptance gate

1. Independent additions on phone and web both appear after a 409 with their
   original IDs, amounts, and account/pocket links; both devices converge.
2. A deletion on one device and unrelated edit on the other stay deleted and
   edited respectively; deletion versus edit of the **same** ID prompts review.
3. Simultaneous different edits of one ID and incompatible metadata changes
   prompt review. Identical edits merge once.
4. App restart during a conflict preserves tombstones and the original base;
   a later retry cannot resurrect a deleted transaction.
5. Closed-app widget sync and foreground sync share the base. A mutation during
   upload stays dirty; account switching cannot merge another user's rows.
6. Existing web and Android tests, stage-device flow, build, and PR CI pass.
