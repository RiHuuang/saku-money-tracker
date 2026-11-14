# Monthly check real-format benchmark — 2026-11-06

Corpus: eight owner-provided PDFs in ignored `.tstexmpl/E-Statements`, 36 pages. Source PDFs, extracted text, references, browser drafts, and per-row results remain outside Git. Tests use isolated ledgers; the owner's live ledger was not modified.

## Extraction results

| PDF format | Pages | Reference rows | Extracted rows | Exact amounts | Dates | Directions | Source descriptors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| BCA bank/pockets | 14 | 116 | 116 | 116/116 | 116/116 | 116/116 | 116/116 |
| BCA credit cards | 5 | 82 | 82 | 82/82 | 82/82 | 82/82 | 82/82 |
| blu | 1 | 3 | 3 | 3/3 | 3/3 | 3/3 | 3/3 |
| BRI | 1 | 4 | 4 | 4/4 | 4/4 | 4/4 | 4/4 |
| GoPay | 3 | 38 | 38 | 38/38 | 38/38 | 38/38 | 38/38 |
| Jago | 8 | 61 | 61 | 61/61 | 61/61 | 61/61 | 61/61 |
| SeaBank English | 2 | 8 | 8 | 8/8 | 8/8 | 8/8 | 8/8 |
| SeaBank Indonesian | 2 | 8 | 8 | 8/8 | 8/8 | 8/8 | 8/8 |
| **Total** | **36** | **320** | **320** | **320/320** | **320/320** | **320/320** | **320/320** |

Each measured field scores **100% on this corpus**. No missing or extra rows were observed against the independent reference. Both SeaBank language copies are intentionally counted as separate input documents.

The application uses PDF.js. A separate reference pipeline uses Python pdfplumber and separate row/column rules, without importing application parsers. The reference compares source page, transaction date, exact decimal amount, and direction in document order. Document readers additionally verify available running balances, debit/credit totals, row counts, card subtotals, and closing balances.

“Source descriptors” measures retention of the printed merchant/recipient or transaction description after whitespace/case/punctuation normalization. BCA references use the recipient/merchant continuation; other formats use their printed description. It is not a subjective score for merchant-name cleanup, nor an assessment of unseen layouts. One long BCA note initially truncated its recipient; the reader now preserves the recipient separately.

## Matching and duplicates

| Scenario | Result | Scope |
| --- | ---: | --- |
| Existing entry with unrelated user wording | 309/309 | One isolated ledger per eligible real extracted row; exact account/value/date, different description |
| Two equal existing candidates | 309/309 sent to review | Same isolated cases with a second equal candidate |
| Overlap count and account identity preserved | 309/309 | One prior row vs two repetitions and a different-account row |
| Selected real transfers in combined corpus | 3/3 paired | Three independently selected Jago→BCA/blu moves, tested with all 320 rows present |

The 309-row denominator excludes seven GoPay Coins rows, one SGD row, and three values rounding below one rupiah. It does not claim that every possible real transfer or arbitrary user ledger was benchmarked. Equal new rows from different sources on the same account/date/value/direction require review, even if their names differ, covering translated copies. “Add all” cannot bypass that warning. Existing card payments can link both the bank debit and the card credit to the same ledger payment.

## Browser and deployment evidence

The actual browser PDF reader returned all 320 rows from all 36 pages, including the encrypted BCA document, using local text reading with zero image/AI pages. The actual Monthly check screen processed 36/36 pages without source errors or AI requests, retaining 319 draft rows after one identical overlap was suppressed. Remaining translated duplicates require review rather than being silently added.

An additional fabricated image that cannot be proven locally stopped with a cloud-consent requirement and zero AI requests. The app now asks for cloud consent only when a page needs it. The earlier unconditional cloud-consent click was rejected by approval review and was not executed.

Stage deployed: `ca48e3a6-0c72-4935-b257-0d5d5a4c968f`, at `https://stage.sakumoney.my.id`. Browser corpus testing used an isolated local harness with the same application components. Stage publication is not Android device validation.

## Financial review boundaries

- Original fractional amounts are retained as `exactAmount`; ordinary ledger entries use whole rupiah. Values below one rupiah stay for review and cannot become zero-value ledger entries.
- SGD is retained with its printed currency, displayed separately, and cannot be saved or matched as rupiah. There is no automatic currency conversion. The empty USD pocket remains an empty section.
- Jago pockets and funding accounts retain their printed labels. Exact account-name matches can map automatically; other mappings require the owner to choose.
- Credit-card installments, reversals, payments, and transfers retain their distinctions and require review before adding. Extraction accuracy does not imply those special rows should each become a new expense.
- Beta flags remain in place. This benchmark establishes these supplied formats, not general accuracy on every format or future bank revision.

## Local evidence

Private reproducible scripts and results are retained under ignored `.tstexmpl`: `independent-extract.py`, `independent-reference.py`, `read-all.mjs`, `score-independent.py`, `description-score.py`, `matching-benchmark.mjs`, and `combined-transfers.mjs`; results are in `audit/`. The browser harness is ignored under `output/`. Source identifiers and personal row contents are deliberately absent from this report.
