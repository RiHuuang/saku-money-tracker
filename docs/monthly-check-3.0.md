# Monthly check 3.0 and pocket planning

The owner asked for two things, decided on 2026-11-02:

1. **Monthly check** reads statements from several banks at once. It works out where each row belongs, links rows already in Activity (even when the user's wording differs from the bank's), and pairs moves between the user's own accounts.
2. **Setup** asks for monthly income and pockets, then suggests an editable split. Existing users get the same planner and can undo or roll back a plan.

The owner's choices:
- Banks: BCA, Jago, GoPay, SeaBank, DANA and blu by BCA.
- Allocation: rules first, AI refines.
- A unique same-value match under a different name links automatically and is shown collapsed.

## Principles (from the design review)

These came out of a "roast" of the first proposal, and each one changed the design.

- **Statements are the truth for amounts; the user's entries carry the intent (which pocket).** A link only marks an entry as checked. The check must never require re-checking rows already logged.
- **Amount, date and account decide a match; the name only breaks ties.** No model can know that "ci bebe" is "BERNADETTA". What makes later months quiet is alias memory: after one link, Saku remembers `BERNADETTA = trf to ci bebe` as a merchant rule. The copy never claims the AI "understands" the user's transactions.
- **A silent wrong link is worse than a question.** Saku links on its own only when the match is unique on both sides: one Activity entry, and no other statement row with the same account, amount and direction within ±2 days. Every link stays visible and can be undone with one tap.
- **A misread amount must not turn into a fake "New" row next to a fake "Only in Saku" row.** Text statements are checked against their printed opening and closing balances. A bank that hasn't passed its accuracy gate is beta.
- **Spend AI only where a deterministic reading fails.** The free AI allowance is shared, and everyone checks on the 1st of the month.
- **Setup gets longer only by what it earns.** Income can be skipped and given roughly, and pockets and their split share one step.
- **Real spending outweighs templates.**

## How Monthly check works

```
files → per page: bank from the header → running-balance proof (no AI) or Worker AI (bank hints)
      → statementMatch: links · own transfers · one-sided transfers · other-account · misread check
      → Needs a look · New · Transfers · Already in Saku · Only in Saku → one Save → Undo
```

### Reading

- **Bank detection.** The bank is `worker/banks.js` `detectBank`: the bank named *earliest* in the page wins. This matters because a BCA statement's transaction line can name Jago, and blu statements also print "BCA". Unsupported banks are refused before any AI call (`unsupported_bank`).
- **Local proof first.** `src/statementLines.ts` `parseStatementPage` accepts a text page only when the opening balance (or the balance carried from the previous page), plus or minus each amount, lands on every printed balance, and the last row is covered by a printed balance. One wrong digit sends the whole page to AI. Proven rows are marked `proven` and never treated as beta or misread.
- **AI pages.** These go to `/v1/import/extract` with `source` set to the bank id (or `"auto"` for screenshots with no account guess). Each known bank adds its conventions to the prompt. For an `"auto"` screenshot, the first pass also names the bank, so detection costs no extra pass, and a BCA screenshot switches to the field-by-field BCA reader.
- **Older clients.** `source: "bca"` keeps the exact 2.4.0 behaviour for clients that haven't updated.

### Deciding (`src/statementMatch.ts`)

1. **The user's own picks win:** a chosen entry, "it's a new one", "not a transfer", or a hand-made pair.
2. **Links to Activity.** A pair is made when each side is the other's clear best. A clear winner beats the runner-up by a name signal (alias, shared words), not just by a day. Two-legged `account_transfer` entries are included, so a transfer the user already logged links both statement rows.
3. **Own-account transfers across statements.** An out-row and an in-row match on equal amounts within ±2 days on two different accounts. They are scored by activity, by a description naming the other bank, and by the user's own name. An equal-scoring rival sends both to Needs a look.
4. **One-sided transfers.** A row that names another of the user's accounts whose statement wasn't uploaded becomes a transfer with the other side unverified. Next month's statement links to that leg.
5. **Same value under another account.** This shows "You logged this under Cash, move it?".
6. **Everything else is new.** A clean new row is ready to add, because the statement is the truth for amounts. A source whose balance doesn't add up, or whose bank is beta, sends its unproven new rows to Needs a look.

**Only in Saku** lists entries on a checked account, within the statement's own dates, that no statement row matched. They are kept by default.

### Saving and undo

- **Saving:**
  - writes new rows;
  - writes each paired transfer once, with both legs verified;
  - marks linked entries as checked;
  - learns aliases.
- **Undo** removes what this check added and clears the "checked" marks it set.

### Name tiebreak

The tiebreak runs only when the user taps "Ask Saku to compare names", and only for rows with 2 to 5 equal candidates:
- **Limits:** one call per draft, at most 20 rows, with a `MATCH_RESERVATION` of 100 neurons.
- **What is sent:** names, short notes and dates. Amounts already agree.
- **What comes back:** an answer shown as "Saku thinks", which still needs a tap. A candidate the model invents is dropped.

## Accuracy gate per bank

The gate is the same bar as `docs/catchup-bca-2.4.0.md`:
- 100% of amounts and directions;
- at least 95% of names;
- no invented rows on the bank's synthetic fixtures.

A bank stays `beta: true` in `worker/banks.js` until its fixtures pass on stage. Real statements are checked only on the owner's phone and are never committed.

| Bank | Fixture | Local proof (no AI) | AI benchmark on stage | Status |
| --- | --- | --- | --- | --- |
| BCA | `scripts/fixtures/statements/bca.json`, `scripts/fixtures/bca/` | ✓ running balance | screenshots 12/12 (2.4.0) | not beta |
| Jago | `jago.json` | ✓ | to run | beta |
| SeaBank | `seabank.json` | ✓ (sen rounded per row) | to run | beta |
| blu by BCA | `blu.json` | ✓ | to run | beta |
| GoPay | `gopay.json` | no balance column, so AI | to run | beta |
| DANA | `dana.json` | no balance column, so AI | to run | beta |

**Run the gate** with `scripts/fixtures/statements/bench.mjs`. It sends every bank's fixture page through stage `/v1/import/extract` with `source: "auto"`, as the app does for a page it can't prove locally, and exits non-zero on a miss:

```bash
SAKU_BENCH_TOKEN=… SAKU_BENCH_UID=… node scripts/fixtures/statements/bench.mjs --out=statement-bench.json
```

`--bank=jago` runs one bank. `--local` only checks the scorer offline and measures nothing. The 2026-11-02 build session could not run it, because its network policy refused `stage.sakumoney.my.id` and `api.cloudflare.com`. That is why the AI column below still says "to run".

**To graduate a bank:**
1. Add synthetic screenshots and pages for its real formats next to the JSON fixture.
2. Score them against the stage Worker as `scripts/fixtures/bca/bench.mjs` does.
3. Record the scores and the neurons per statement here.
4. Flip `beta`.

**Neuron budget.** A page proven locally costs 0 neurons. An AI page costs two passes (reserved at 2,500 each, then settled at what was actually used). The dev-only line in Monthly check shows "pages read without AI" so the share can be watched while testing.

## Pocket planning

- **Data.** `Data.monthlyIncome`, `incomeKind` and `pocketPlans` (the last 3) are optional. They are validated in `validateData` and merged like any other top-level field.
- **Rules first** (`src/allocation.ts`):
  - Money already promised comes off first: card instalments and recurring bills without a pocket.
  - A pocket's own recurring bill is its floor.
  - With two or more months of history, real average spending carries 70% of the weight.
  - Otherwise savings get 20% (25% for variable income) and the rest is weighted by what a pocket usually needs (rent 3.5, food 3, instalments 2, transport and bills 1.5, family and health 1.2, coffee and subscriptions 0.6, anything else 1). One fun pocket never outweighs food and rent.
  - Amounts round to Rp50.000 (Rp10.000 under Rp3 jt), and the leftover goes to savings.
- **AI refines** (`/v1/budget/suggest`, `worker/budget-ai.js`), with a reservation of 150 neurons. The answer is rejected, and the phone's plan kept, if any of these hold:
  - a pocket is missing or invented;
  - a pocket is below its fixed amount;
  - a pocket is more than ±40% from both real spending and the rules' amount;
  - the total is over income;
  - the answer can't be read.

  Pockets the user set by hand are never overwritten.
- **Editing never moves other pockets.** A sticky bar shows what's left or over, and "Spread the rest" only fills pockets the user hasn't set.
- **Apply** (`applyPocketPlan`):
  - First it writes the old default into every past month that had no override, so a plan never rewrites history.
  - Then it changes the default from this month on.
  - It is one commit, with an Undo toast.
- **Rollback** (`rollbackPocketPlan`):
  - It restores the pockets and the income from before that plan, and rolls back any later plans with it.
  - A pocket the plan created stays if anything now uses it, and the user is told which ones.
- **Setup** (`src/Onboarding.tsx`) has four steps, each skippable after the first. Android back steps back through them. Setup is the first plan, not a change, so it keeps no snapshot.

## How to confirm with users

Run this with 5 people who track spending and hold at least two of the six banks:
1. Ask them to log one week by hand.
2. Then ask them to run Monthly check with that month's statements.

**Measures:**
- decisions per statement row (the dev line shows it);
- unlinks;
- wrong links found afterwards;
- time to finish.

**Pass:**
- under 0.3 decisions per row in the first month and under 0.1 by the third;
- unlinks under 5%;
- no wrong link that the person didn't see and undo.

If decisions don't fall by month 3, the check is making tracking harder: loosen auto-linking, or steer people to log only cash and let statements fill in the rest.
