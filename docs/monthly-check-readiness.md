# Monthly Check readiness

Published 14 November 2026. [PR #74](https://github.com/RiHuuang/saku-money-tracker/pull/74) merged into main at `57ad5a7638125b91cb1a01f322f8d07a9b320d88`. Production Worker `33c8c6f6-13a5-4c4b-9af4-726243b5a607` serves Saku 2.5.0 / build 17. The signed Android release and final phone checks pass.

## Review experience

The list shows the date, name, amount and a short next action. Detailed questions and fields open in the transaction dialog. Ten unresolved rows appear initially, with a button to reveal the next ten. Other result groups, file controls, coverage, balance checks and history are collapsed. Monthly totals show their status first, with the comparison available on demand. English and Indonesian copy follow the same structure.

## Verified

- Application tests: 163 passing, plus Worker and script checks; TypeScript and the Stage build pass.
- Supplied PDF corpus: 320 independent reference observations across 36 pages; date, amount, direction and printed descriptor checks pass. The actual review retains 319 observations after one identical translated overlap. This does not establish accuracy on unseen layouts.
- Actual Android DANA retest: ten monetary observations, ten correct dates, amounts, directions and activity types. Four incoming top-ups retain their type. The no-amount connection event is absent. The existing 27-transaction device ledger checksum is unchanged.
- Deployed Stage browser, owner account: the supplied DANA activity screenshot produces ten observations. Two existing purchases link; one independently reviewed purchase is saved; seven unresolved movements are withheld. Revision 24 / 183 transactions becomes revision 25 / 184 transactions. Reload is identical; fresh screenshot reimport links the added purchase and adds nothing. UI Undo yields revision 26 / 183 transactions, with the original transactions and merchant rules restored. The undone audit batch remains durable.
- Stage and production use distinct Sheets. Production was read only during the Stage verification.
- Mobile component checks cover light/dark dialogs, initial row limit, revealing all remaining rows, save and Undo. Synthetic component fixtures are distinct from supplied financial evidence.
- The final isolated Stage build 17 was installed in place on the actual Xiaomi phone. All three SQLite ledger tables, all 27 transactions and the app data-folder inode are unchanged. Production's installed package, version and update timestamp are unchanged. The supplied existing DANA draft displays ten rows; missing account confirmation blocks Save. The compact list and transaction dialog were visually inspected in light and dark themes, with a native screenshot as evidence. The phone's three-account workspace was preserved; the separate eight-account owner Stage save test above proves cloud persistence.
- Image-source bank hints now follow explicit account confirmation. A previously incorrect GoPay guess on the DANA image is hidden while unconfirmed, rather than presented as a known bank.
- A separate synthetic Stage workspace tested the deployed route dialog and persistence: a direct BCA-to-Jago pair was atomically replaced by BCA-to-DANA and DANA-to-Jago pairs, preserving October 31 / November 1 dates. Undo restored the baseline. Removing DANA blocked replacement; unchecked screenshot dates opened review without saving. An omitted detail row displayed a totals discrepancy, with no unsupported removal suggestion.

## Scenario coverage

| Scenario | Evidence / behavior |
| --- | --- |
| DANA summary and activity | `statementMatch.test.ts`: ten monetary detail rows reconcile; summary creates no rows. Real activity extraction tested separately. |
| Summary alone or screenshot alone | Extraction contract separates reading modes; totals cannot establish a closing balance or full coverage. |
| Missing detail row | Summary comparison fails; no invented transaction. |
| Missing or partial DANA evidence | Route-conflict and unobserved-leg tests retain review; incomplete coverage cannot suggest ledger removal. |
| Evidence added later / reimport | Actual Stage save/reload/reimport/Undo above; no second financial effect. |
| Overlaps, renamed descriptions, equal values | Matcher tests and private 309-case seeded benchmark; ambiguous multiplicity requires review. |
| Truncated recipients / generic transfer labels | No generic-label-only automatic pairing; manual confirmation remains available. |
| Missing pages / failed reads / disjoint periods | Import-flow and coverage tests; only explicitly complete periods qualify for Only in Saku. |
| Cross-month transfer | Matcher preserves the individual posting dates. |
| October wrong, later balance correct | Balance tests block the correction. All Monthly Check saves and Undo also preserve retained, already-correct independent balance anchors. |
| Fees, cards, pockets, FX, Coins | Tests preserve special handling; internal Jago moves have no income/spending effect, unsupported currencies/rewards and special card rows retain review barriers. |
| Concurrent edits / later edits | Snapshot merge and batch tests reject conflicting Undo and retain unrelated later work. |

These are scoped results, not a claim that every possible financial route is known. Beta bank labels and explicit review boundaries remain. Supplied DANA evidence establishes movement totals, not the wallet's closing balance. Private input files, screenshots, transaction IDs, revisions, checksums and before/after balance previews remain in ignored local verification artifacts.

## Completed publication checks

- Final PR CI passed and the change is merged into main. The production build came from that merged source.
- Signed build 17 passed release lint, unit tests, signature verification and comparison of all 58 packaged web files with the build. Both public APK routes return the exact signed file: SHA-256 `cdaef7caaa519d5e5a4edd4d0b34e7dc5e3a1a172a7e04649b020931bc4828a2`, 43,259,515 bytes.
- The APK and minimum-build-17 manifest were published before the production build gate. Live probes return update-required for build 16; build 17 reaches authentication. Earlier Android clients must update before cloud sync resumes; their offline ledger remains accessible. No Play upload was performed.
- Production health and home return HTTP 200. All 57 public web files match the build; the asset-header configuration is checked through its applied security headers. The public landing page displays version 2.5.0 and the matching release hash.
- A fresh read-only production baseline contained 208 transactions in eight accounts at revision 132. The new parser's dry-run preserved every transaction, account, pocket, card and merchant rule, including October 31, November 7 and November 14 financial previews. The full production snapshot remains byte-identical after deployment. The earlier owner Stage test remains unchanged at revision 26 / 183 transactions.
- The actual phone's isolated Stage installation is build 17 and matches its tested APK checksum. All three ledger tables and 27 transactions remain unchanged. This is Stage installation proof; the production phone app was not upgraded by this verification.
