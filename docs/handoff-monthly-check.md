# Handoff: Monthly check 3.0 and pocket planning

Last updated 2026-11-06 (see "2026-11-05 follow-up" below). Read this first if you're picking up this work. The design decisions and their reasons are in [monthly-check-3.0.md](monthly-check-3.0.md).

**Delete this file before merging the branch into `main`.** It is for agents working on the branch, not part of the product docs.

## Where the work is

- **Repository:** `RiHuuang/saku-money-tracker` on GitHub.
- **Branch:** `claude/nice-sagan-p8ykyo`. Pushed on 2026-11-06 (through `9046aa5` plus this handoff update).
- **Base:** `main` at `a7c2399` (release 2.4.1). The branch is 18 commits ahead, counting this handoff.
- **Pull request:** none yet. Don't open one until the open item below is done or the owner says to ship with beta banks.

```bash
git clone https://github.com/RiHuuang/saku-money-tracker.git
```
```bash
cd saku-money-tracker
```
```bash
git fetch origin claude/nice-sagan-p8ykyo
```
```bash
git checkout claude/nice-sagan-p8ykyo
```
```bash
npm ci
```
```bash
npm test
```
```bash
npm run build
```

`npm test` should report 128 passing plus the Worker and script checks. `npm run build` needs `VITE_SAKU_API_URL`, which `.env.production` already provides.

If the branch has been merged by the time you read this, start follow-up work from the latest `main`.

## What the owner asked for

1. **Monthly check across banks.** Read statements from several banks at once (BCA, Jago, GoPay, SeaBank, DANA, blu by BCA). Link rows already in Activity even when the names differ (bank "BERNADETTA…" = the user's "trf to ci bebe"). Pair moves between the user's own accounts. Never double-add.
2. **Setup with income.** Setup asks for monthly income and pockets. Saku suggests the split (rules first, then AI refines), and the user can edit it by amount, percentage or slider.
3. **Planner for existing users.** The same planner for existing users, with reject, undo and rollback to the previous pockets.
4. **Design.** Interactive and animated, using only the existing fonts, tokens and classes.

## What's done (commits, oldest first)

| Commit | What |
| --- | --- |
| `e62e236` | Engine: bank registry, deterministic statement reader, statement matcher, multi-bank Worker route, `/v1/import/match`, `/v1/budget/suggest` |
| `620df8c` | Monthly check screen: grouped review (Needs a look · New · Transfers · Already in Saku · Only in Saku), one save, undo |
| `73749d0` | Pocket planning engine: `monthlyIncome`, `incomeKind`, `pocketPlans` on the ledger; rules-first allocation; apply and rollback |
| `29eef14` | Setup page (4 steps), shared allocation editor, Plan with Saku planner, plan hint card |
| `7a7cb26` | Synthetic fixtures for all six banks, dev-only tuning line, decision doc, README |
| `98a5793` | Unique setup pocket keys |
| `b17f1f4` | Undo also reverts "Move it" |
| `ffb984d` | One-command stage benchmark for all six banks |

## Map of the code

| Area | Files |
| --- | --- |
| Bank list (shared by app and Worker) | `worker/banks.js` (+ `worker/banks.d.ts`). Includes `beta` flags, detection, account matching |
| Reading statements | `src/statementLines.ts`: a page is accepted without AI only if its running balance proves every row. `worker/import-ai.js`: bank hints and `answerBank`. `worker/index.js`: `/v1/import/extract` route |
| Deciding rows | `src/statementMatch.ts`: `analyzeStatement`, `applyVerdict`, `balanceMismatch` |
| Monthly check UI | `src/CatchUp.tsx`, statement mode (`analysis`, `rowsView`, `groups`, `monthlyReview`). Draft fields are in `src/importDraft.ts` |
| Name tiebreak / budget AI | `worker/import-match.js`, `worker/budget-ai.js`. Client wrappers: `compareImportNames`, `suggestBudget` in `src/cloud.ts` |
| Pocket planning | `src/allocation.ts`, `src/usePlanSuggestion.ts`, `src/AllocationEditor.tsx`, `src/PocketPlanner.tsx`, `src/Onboarding.tsx`. `applyPocketPlan`, `rollbackPocketPlan` and `pocketHasReferences` are in `src/domain.ts` |
| App wiring | `src/App.tsx`: `edit.type` `"start"` mounts `Onboarding`, `"plan"` mounts `PocketPlanner`. The Undo toast is there too, and the Android back button is forwarded to `[data-back-step]` |
| Strings | `src/locales/en.ts` and `src/locales/id.ts` |
| Styles | End of `src/styles.css` (`.monthly-*`, `.onboarding-*`, `.allocation-*`, `.planner-*`, `.plan-hint`) |
| Tests | `src/statementMatch.test.ts`, `src/allocation.test.ts`, `worker/monthly-check-route.test.mjs`, `scripts/statement-bench.test.mjs` |

## 2026-11-05 follow-up

A review of the branch and a pass on a real phone (Xiaomi, USB, isolated `id.saku.money.stage` debug build) changed these things:

- **Later pages keep their bank.** The Worker trusts `input.source` for text pages instead of re-detecting it, and the app keeps the bank from page 1 (`src/CatchUp.tsx`). Before, page 2 of a GoPay or DANA PDF failed with `unsupported_bank`.
- **Transfers need evidence.** Two rows with equal amounts are only auto-paired when something else links them (activity, a named bank, the owner's name). Otherwise they go to "Needs a look" (`src/statementMatch.ts`).
- **Plans.** Only running instalments come off income. Rollback no longer brings back pockets deleted since the plan. A plan can't rename a pocket onto another pocket's name.
- **Balance check** allows half a rupiah of rounding per row.
- **Layout.** The planner and allocation editor no longer run past the screen edge, and the four Catch up tabs are a 2x2 grid on phones.
- **Tests.** Each fix has a regression test (127 passing).

Checked on the phone: Pockets, Plan with Saku (income to suggested split), and the Monthly check screen. Checked in a 375px browser harness: the four setup steps and the data they produce. **Not checked:** a statement run through Monthly check on the device (it stops at the one-time Cloudflare AI consent, which the owner answers), and the accuracy gate below.

Known and left alone: an `auto` BCA screenshot costs three AI passes instead of two, because the bank is learned from a general first pass; rollback restores a pocket's name, icon and budgets as they were, so edits made after a plan are undone with it.

Building for a phone: Gradle needs JDK 21 (Android Studio's bundled one works), `android/local.properties` with `sdk.dir`, and for an isolated stage build the steps in `RELEASE.md` (`--mode staging`, then `-PSAKU_ISOLATED_STAGE_DEBUG=true`, then `npm run android:sync` to restore production assets).

## Open item: the per-bank accuracy gate

Also unverified: the GoPay hint change in `9046aa5` (top-ups named "Isi saldo"). Run the GoPay bench; revert the hint if it scores worse. On-device checks of Jago, GoPay and DANA are recorded in `docs/monthly-check-3.0.md`; unsaved test drafts may remain in the phone's Monthly check.

**Status: not run** (as of 2026-11-06; no `SAKU_BENCH_TOKEN`/`SAKU_BENCH_UID` was available). Jago, GoPay, SeaBank, DANA and blu by BCA are still `beta: true` in `worker/banks.js`. Their AI accuracy on real statements is unmeasured. The cloud session that built this couldn't reach `stage.sakumoney.my.id`, so `docs/monthly-check-3.0.md` lists them as "to run".

**What beta means for users:** a new row from these banks that wasn't proven by the running balance always waits in "Needs a look". Links to rows already in Saku still work.

**To finish it,** on a machine that can reach stage:

1. Deploy this branch to stage, following the staging steps in `worker/README.md` and `RELEASE.md`.
2. Sign in to stage with a throwaway account. Put its session in `SAKU_BENCH_TOKEN` and its user id in `SAKU_BENCH_UID`, and never print them.
3. Run the benchmark. Use `--bank=jago` to run one bank.
   ```bash
   SAKU_BENCH_TOKEN=… SAKU_BENCH_UID=… node scripts/fixtures/statements/bench.mjs --out=statement-bench.json
   ```
   The gate is: every amount and direction right, at least 95% of names, and nothing invented. The script exits non-zero on a miss.
4. The owner checks one real statement per bank in the app on their own phone. Never commit real statements or real names.
5. For each bank that passes both checks, record its scores and neurons per statement in the table in `docs/monthly-check-3.0.md`, then set `beta: false` for it in `worker/banks.js`.
6. Commit and push. Delete this handoff file, then open the PR into `main`.

If a bank fails, look at the `misses` in the output. Adjust that bank's `hint` in `worker/banks.js` (or its fixture, if the fixture is wrong), then rerun.

## After that

- Delete `docs/handoff-monthly-check.md`, then open the PR into `main` and fill in the repo's PR template if there is one.
- Bump the version and release following `RELEASE.md`. The last release was 2.4.1 (build 16).
- Run the usability test described at the end of `docs/monthly-check-3.0.md`. Pass means decisions per row under 0.3 in month 1 and under 0.1 by month 3, and unlinks under 5%. Development builds show these numbers in a line on the Monthly check screen.

## Gotchas

- A new `src/*.test.ts` file must be added by hand to the `tests` array in `scripts/test.mjs`. Worker and script tests are imported at the end of that file.
- Every string needs a key in both `en.ts` and `id.ts`, or `tsc` and `src/i18n.test.ts` fail. Keep the Indonesian casual (`-mu`).
- Older app builds still send `source: "bca"` to `/v1/import/extract`. That path must keep its exact 2.4.0 behaviour, including the `not_bca` error.
- Bank detection picks the bank named *earliest* in the page. A BCA statement can mention Jago, and blu prints "BCA".
- An account named "Dana darurat" is not the DANA wallet; the regex in `worker/banks.js` handles this.
- Global `main {}` padding leaks into full-screen pages. The setup page resets it with `main.onboarding`.
- `applyPocketPlan` freezes past months' budgets before changing a pocket's default, so a plan never rewrites history. Keep it that way.
- `src/Statements.tsx` is the old on-device path and only renders when `cloudImportEnabled` is false (it's hard-coded to true). It isn't part of this work.
- **UI checks:** UI was checked at 390px in light, dark and reduced-motion modes using a throwaway Vite harness with Playwright, mocking `/v1/*`. The harness isn't committed. To recreate it, mount `CatchUp` (with `statementMode`), `Onboarding` or `PocketPlanner` in a page under a git-excluded folder, and render synthetic PDFs with Chromium's `page.pdf()`.
