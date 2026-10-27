# Catch up audit (2.4.0)

The owner reports that users find Catch up too complicated and too wordy, especially the "What happened?" (*Apa yang terjadi?*) field. This is an expert review of the Indonesian flow at 390 px. It was rendered against the fake API with one screenshot that extracted two rows. No users were interviewed, so the usability test below is how to confirm the fixes.

## What the user sees today

| Step | What's on screen | Words |
| --- | --- | --- |
| Start | Title, a one-line explanation, a 3-step strip, "Berkas sumbermu" with a limit note | about 40 |
| After choosing a file | The file card plus **three notes**: the account is chosen later, the file has several accounts, and moving money between pockets isn't spending | about 70 more |
| Consent | A modal with 32 words about Cloudflare AI, drafts and Sheet sync | 40 |
| Review | 3 counters, an "Akun = … Kantong = …" legend, 4 tabs, an empty-state sentence, a save summary, a source-check sentence, a confirmation checkbox, and the Add button | 111 |
| One row, expanded | **8 fields** (Keterangan, Tanggal, Jumlah, Arus uang, Akun Saku, Apa yang terjadi?, Metode pembayaran, Kantong), a provenance line, and a 3-way "Apa yang harus Saku lakukan?" choice where each button has its own sub-line | 82 |
| "Apa yang terjadi?" | A searchable sheet with **13 options** | 46 |

To add two clear rows, a user reads about 270 words and makes at least 4 decisions: the file, consent, the source-check checkbox and Add.

## Findings

1. **[HIGH] "Apa yang terjadi?" asks for accounting vocabulary** (`src/CatchUp.tsx:16-23`, `:351`). The 13 options mix the direction of money (refund, income, interest), payment rails (PayLater, top-up), and states that aren't transactions (pending, failed, points, unsure). The user also sets the same direction in "Arus uang" just above it, and a mismatch between the two raises a review error (`reviewIncomeDirection`/`reviewExpenseDirection`). That means two fields to keep consistent and an error when they disagree.
   **Owner decision (2026-10-28): remove "Apa yang terjadi?" entirely.** A row shows only name, date, amount and money in/out. Saku derives the activity from the BCA reading (see `docs/catchup-bca-2.4.0.md`): a credit card payment links to the card, a Flazz top-up goes to the user's e-money account if one exists, and the rest are spending or income. Pending rows get today's date. [< 1 week]
   **Tradeoff:** a user can't hand-pick fee, refund or interest. Those rows land as plain money in or out, which they can edit in Activity afterwards.
2. **[HIGH] Every row opens as a full form.** Eight fields show at once even when the AI was confident. **Proposed change:** show a collapsed row with name, date and amount, and an Edit link. Open the form only for rows with a review issue, and show only the fields related to that issue. [< 1 week]
3. **[MEDIUM] Three upfront notes before extraction** (`extractAccountNote`, `mixedAccountNote` and the pocket-transfer sentence). They explain problems the user hasn't hit yet. **Proposed change:** drop them. With BCA-only input the account is known (the user's BCA account), and a mixed-account warning can appear on the row that needs it. [< 1 day]
4. **[MEDIUM] Review screen chrome:** 3 counters, 4 tabs and a legend. **Proposed change:** keep one line, "2 siap ditambah · 0 perlu dicek", plus a list. Show the "Perlu dicek" rows first and drop the tabs and the legend. [< 1 day]
5. **[MEDIUM] Mandatory source-check checkbox** ("Saya sudah mencocokkan dengan sumber"). It adds a sentence and a tap to every save. **Proposed change:** keep it only for statements, not screenshots, or replace it with a thumbnail of the source next to the list. [< 1 day]
6. **[LOW] The consent text is 32 words** about Cloudflare AI. **Proposed change:** "Gambar dikirim ke Cloudflare AI untuk dibaca. Berkas asli tetap di ponselmu." Keep the full text in the Privacy Notice. [< 1 day]
7. **[LOW] Untranslated placeholder.** The picker search reads "Search apa yang terjadi?", mixing English and Indonesian (a shared `ChoiceField` search placeholder). [< 1 day]
8. **[GOOD]** Drafts stay on the device, saved rows can be undone, and nothing is added without an explicit Add. Keep all three through the simplification.

## How to confirm (usability test)

- **Who:** 5 BCA users who track spending, on their own phones.
- **Task:** "Masukkan transaksi BCA minggu lalu ke Saku dari tangkapan layar myBCA."
- **Measures:**
  - time to add all rows;
  - the number of fields touched;
  - rows added wrongly (direction, amount or date);
  - whether they stopped to read help text.
- **Comparison:** run today's flow and the simplified flow, each with half the participants.
- **Pass:** at least 4 of 5 participants finish without help, with zero wrong directions.
