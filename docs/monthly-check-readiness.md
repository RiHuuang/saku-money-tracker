# Monthly Check readiness

Updated 14 November 2026. Production publication remains gated on the final signed Android build and phone verification.

## Review experience

The list shows the date, name, amount and a short next action. Detailed questions and fields open in the transaction dialog. Ten unresolved rows appear initially, with a button to reveal the next ten. Other result groups, file controls, coverage, balance checks and history are collapsed. Monthly totals show their status first, with the comparison available on demand. English and Indonesian copy follow the same structure.

## Verified

- Application tests: 163 passing, plus Worker and script checks; TypeScript and the Stage build pass.
- Supplied PDF corpus: 320 independent reference observations across 36 pages; date, amount, direction and printed descriptor checks pass. The actual review retains 319 observations after one identical translated overlap. This does not establish accuracy on unseen layouts.
- Actual Android DANA retest: ten monetary observations, ten correct dates, amounts, directions and activity types. Four incoming top-ups retain their type. The no-amount connection event is absent. The existing 27-transaction device ledger checksum is unchanged.
- Deployed Stage browser, owner account: the supplied DANA activity screenshot produces ten observations. Two existing purchases link; one independently reviewed purchase is saved; seven unresolved movements are withheld. Revision 24 / 183 transactions becomes revision 25 / 184 transactions. Reload is identical; fresh screenshot reimport links the added purchase and adds nothing. UI Undo yields revision 26 / 183 transactions, with the original transactions and merchant rules restored. The undone audit batch remains durable.
- Stage and production use distinct Sheets. Production was read only during the Stage verification.
- Mobile component checks cover light/dark dialogs, initial row limit, revealing all remaining rows, save and Undo. Synthetic component fixtures are distinct from supplied financial evidence.
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

## Remaining release gates

- Install the compact Stage build in place and inspect the actual phone UI without changing its ledger.
- Build and verify the signed production APK, preserving the release certificate and production API target.
- Complete pull-request checks, merge to main, deploy production, and verify public web/download artifacts against the built files.
