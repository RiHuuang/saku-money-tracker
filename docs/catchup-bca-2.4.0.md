# Catch up for 2.4.0: BCA only

**Decided by the owner on 2026-10-28.** Catch up in 2.4.0 reads only BCA sources: myBCA "Account Information" or "Financial Diary" screenshots, and BCA e-statement PDFs. Several screenshots per draft are still allowed. Other banks are out of scope for this release.

## Task 1: measure the current model on BCA sources

The current model is `@cf/google/gemma-4-26b-a4b-it` (`worker/import-ai.js`), with a first pass plus a verification pass.

1. Build a BCA fixture set under `scripts/fixtures/bca/`. Use **synthetic** screenshots made to look like myBCA, with made-up names and account numbers; never commit the owner's real screenshots. Cover every row type in the table below, including a `PEND` row, a row with no note, and a screen split across two screenshots.
2. Score the first pass and the verified output against the expected rows, using the existing `scripts/score-synthetic-import.py` as a base. Record:
   - per-field accuracy (date, amount, direction, counterparty, note, type);
   - rows missed and rows invented;
   - the neuron cost per screenshot.
3. Run the fixtures on stage. Real-account checks run only on the owner's phone and are never logged.
4. **Pass:** 100% of amounts and directions are correct, at least 95% of names and notes, no invented rows, and the cost stays within the daily cap (`DAILY_CAP` 4000 / `USER_DAILY_CAP` 1200).

## Task 2: BCA-specific reading and output

Replace the general prompt with a BCA prompt, and add deterministic parsing after the model wherever the BCA format allows it.

| Printed on myBCA (example shape) | Meaning | Saku row |
| --- | --- | --- |
| `2710/FTSCY/WS95271 315229.00 <note> <NAME>` + `TRSF E-BANKING CR` + `IDR 315,229.00` | `<NAME>` transferred to me, with note `<note>` | Money **in**, name "Transfer dari <Name>", description `<note>` (none if absent) |
| `…/FTSCY/… 55000.00 <NAME>` + `TRSF E-BANKING CR` | A transfer in with no note | Money in from <Name>, no description |
| `… <NAME>` + `TRSF E-BANKING DB` | I transferred out to <NAME> | Money **out**, "Transfer ke <Name>" |
| `…/FTFVA/… /DANA - - <phone>` + `TRSF E-BANKING DB` | A top-up to DANA (virtual account) | Out. If the user has a DANA account in Saku, a transfer to it |
| `0100 BCA CARD <card no> <OWNER NAME>` + `KARTU KREDIT/PL` | I paid my BCA credit card | A **credit card payment**, linked to the user's BCA card in Saku |
| `TOPUP<phone> …` + `FLAZZ BCA` | A Flazz top-up | A transfer to the user's Flazz/e-money account if one exists ("flazz", "e-money", "kartu elektronik" and similar names); otherwise money out |
| `TGL: MMDD QR <code> 00000.00<merchant>` + `TRANSAKSI DEBIT` | A QRIS payment at `<merchant>` | Money out, name = merchant |
| `<digits>` + `SETORAN PEMINDAHAN` | A deposit by transfer, such as salary | Money in, "Setoran" (the user can rename it, for example to "Gaji") |
| Left column `PEND` instead of a date | Pending, no booking date yet | **Today's date** |
| Left column `DD Mon YYYY` | The booking date | That date (in the left column, not under the name) |

- **Direction comes only from `CR`/`DB` and the amount colour.** The model doesn't guess it.
- **The amount comes from the `IDR` line**, not from the number embedded in the reference.
- **The account is the user's BCA account in Saku.** If there are several BCA accounts, use one picker for the whole draft, not one per row.

## Task 3: skip what is already recorded

Before review, compare each extracted row with the ledger: same account, same amount, same direction, and a date within ±1 day (use the same day for `PEND` rows).

- **An exact match is skipped.** It's shown as "Sudah ada di Saku".
- **No match** is added for review, and incoming transfers are flagged for review.

## Task 4: simpler Catch up screen

Follow `docs/catchup-audit-2.4.0.md`:

1. Remove "Apa yang terjadi?" and the pre-extraction notes.
2. Show collapsed rows, with "Perlu dicek" rows first and one summary line.
3. Shorten the consent text.
4. Fix the "Search …" placeholder.

**Non-BCA files are blocked before upload** with: "Saat ini Susul catatan baru bisa membaca mutasi BCA. Bank lain segera hadir!"

## Ship rule

2.4.0 doesn't deploy to production until Tasks 1–4 pass on stage and on the owner's phone.
