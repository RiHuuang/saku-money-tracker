# Monthly Check verification — 7 November 2026

Implementation and verification are on the continuation worktree. Production was not written.

## Implemented

- DANA summary extraction returns zero rows; two independent reads must agree. Summary totals validate detail observations without implying a closing balance.
- Real DANA activity extraction excludes nonmonetary events and preserves truncated descriptions.
- Transfer-route contradictions are held for review. Four unambiguous observations can propose an atomic replacement through an intermediate account; absent or already-claimed evidence prevents that proposal.
- Paired transfer legs preserve their own posting dates; ledger validation accepts different dates.
- Review flags block save, including direct/bulk paths. Explicit source review clears a flag.
- Confirmed printed-account mappings persist. Proven mutually unique internal Jago pocket observations mapped to one account are skipped.
- Dated balance preview checks current and later independently observed balances. Accepted adjustments are audited, exclude income/spending, and retain balance evidence.
- Ledger changes and batch Undo information persist in one snapshot. Undo restores owned transaction, alias, mapping and balance-observation changes, rejects subsequent conflicting edits, and preserves unrelated additions.
- Screenshot dates must be reviewed before saving linked verification or new entries.

## Evidence completed

- Application regression suite: 158 tests passing, plus Worker and script checks. Stage TypeScript/Vite build passed.
- Live Stage DANA summary: HTTP 200, zero rows; incoming 15,500,000, outgoing 15,326,120, send-money 15,000,000, merchant 326,120.
- Live Stage supplied screenshot: HTTP 200, ten monetary rows. Extracted incoming/outgoing totals exactly match the summary. This is extraction/aggregate agreement, not proof of every destination.
- Stage persistence test changed two previously unverified existing ordinary transactions, reloaded durable history, reimported the combined corpus, then undid those changes. No transactions were added. Reloaded transaction content was restored by semantic equality; object-property order is not significant.
- October 31 and November 7 per-account balances were unchanged by verification and Undo.
- Private evidence under `output/real-account-stage-test/`: `implementation-baseline.json`, `dana-summary-stage.json`, `dana-details-stage.json`, `persistence-before.json`, `persistence-saved-reloaded.json`, `persistence-undone-reloaded.json`, `persistence-results.json`.

## Remaining acceptance work

- Live UI upload/review/save/reload/reimport/Undo screenshots and mobile light/dark validation.
- Missing-DANA and missing-single-row scenarios through the complete UI, plus approved multi-hop route replacement and its persisted balance effects.
- Explicit printed periods can be confirmed only after successful page processing; summaries and mixed-account sources cannot be marked complete. Unknown periods produce no Only-in-Saku suggestions, and disjoint periods retain their gaps. Automatic printed-period extraction remains a future convenience.
- Bank accuracy graduation and complete actual-ledger ground truth remain open. Aggregate equality cannot prove individual recipient identities.

Private statements, session artifacts and ledger diffs remain ignored and must not be committed. Stage revision advances for test writes and durable Undo history even when financial transactions are restored.

Live browser reached the authenticated owner workspace after owner-authorized agreement acceptance. DANA files were selected into Monthly Check. Cloudflare AI consent click was rejected by automatic approval review pending explicit external-processing authorization. No browser Save was performed. API-level extraction results must not be presented as browser end-to-end completion.

## Owner correction and browser follow-up

The owner explicitly authorized Cloudflare AI processing, then instructed that the DANA activity screenshot is the transaction input and the DANA statement is a separate totals reference. The summary was removed from the browser draft.

Browser testing exposed a real misclassification: the activity list's monthly aggregate heading could produce a summary response. Added validated `readingMode` request metadata, a transaction-only prompt and a server guard rejecting summary responses in transaction mode. Existing clients retain their previous optional-mode behavior. The regression HTTP test rejects summary substitution.

On Stage version 308b10f9-2b0d-4831-ace3-69840d23e846, the supplied activity screenshot alone produced ten monetary observations: two already present, eight requiring review. No summary source was included. No uncertain financial movements were saved. Private screenshots are `output/real-account-stage-test/dana-screenshot-only-light.png` and `dana-screenshot-only-dark.png`. Browser save/reload/Undo of new financial movements remains unproven; the earlier API persistence evidence is separate.
