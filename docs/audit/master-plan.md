# Saku master plan: audit, reality check and staged fixes

Audited on 2026-11-20 at commit `9844806` (branch `claude/saku-audit-redesign-plan-a0cc1c`). The owner approved it on 2026-11-21 with one change, rule O1 below. No code has changed yet. Line numbers refer to that commit.

**Pass 5 (statement reading) was added on 2026-11-22** at the owner's request. It draws on the owner's Gemini deep research of 2026-11-21 on Indonesian notifications, e-statements and reconciliation. Triage G, triage H and Pass 5 cite line numbers from commit `00ce3ba`.

## Owner rule O1 (2026-11-21)

**No SHA or other hash appears anywhere in production: not in the app, on the landing page or on the install page.** Users don't need to know the app's SHA.

- Integrity checks stay in code. The in-app updater still checks every download against the release feed's SHA-256 (`src/appUpdate.tsx:108` → `AppUpdatePlugin.kt:54,76`). It never shows the hash.
- O1 outranks every rule below, including the principal's earlier call to keep the SHA on the install page.

## How this plan was made

- **Phase 0:** the lead read the code and the live site: headers, the JS bundle, `/health` and the release manifest. The lead also took read-only `adb dumpsys` diagnostics from the owner's Xiaomi 15.
- **Phase 1:** five read-only reviewers ran in parallel:
  - `principal-fintech-engineer` (Opus, high effort, veto)
  - `genz-ui-director`, `ux-flow-auditor`, `user-ease-strategist` (Sonnet)
  - `anti-bloat-editor` (Haiku)
- **Phase 2:** the principal issued binding rulings; the flow auditor and editor trimmed scope and copy.
- **Skills:** the reviewers applied vectorlab `anti-slop`, `ux-audit`, `colour-palette`, `typography`, `motion` and `reduced-motion`. `taste-skill` and `setup-ui-ux-skills` are not installed, so they were not used.
- `docs/ux-overhaul-plan.md` still stands: 12 owner decisions and six PRs, cited below as UXP-PR1…6. This plan builds on it.

## Reality check

1. **There is no commit SHA in production, but the landing page shows the APK's SHA-256 twice.**
   - No source maps (`.map` URLs return the 935-byte app page), no build headers, and `/health` returns only `{ok:true}`.
   - A release panel sits in the hero (`landing/index.html:72`) and again in the closing section (`:187`). It shows the version, date, APK SHA-256, a "Salin" copy button and three notes. `landing/script.js:13-40` fills both panels from the public release feed.
   - The install guide tells people to check that SHA before installing (`landing/install-android.html:18`).
   - O1 removes all of it.
2. **The only AI model name is on a screen nobody can open, but its engine still ships.**
   - "Qwen3 0.6B mixed INT4" (`src/Statements.tsx:351`) only renders when cloud import is off, and `cloudImportEnabled` is hard-coded `true` (`src/App.tsx:159,1226`).
   - Its engine `liblitertlm_jni.so` is still 21.8 MB of the 40–43 MB APK.
   - Shipped UI never says "Gemma"; that name exists only in server code.
3. **The bank-alert reader is killed many times a day, even on the owner's phone where it "works".**
   - The owner's Xiaomi logged 12+ kills in 3 days (`reason=13 … OneKeyClean`).
   - HyperOS restarts it only because Autostart is on. Samsung, OPPO, vivo and Transsion get no help (`NotificationCapturePlugin.kt:46-57`).
   - Saku never rescans the notification shade after reconnecting, and has no memory of rows it already handled.
   - Two threads can overwrite each other's inbox changes, and a failed decrypt silently wipes the whole inbox.
4. **Timestamps are half right.**
   - The date already comes from `sbn.postTime` (`SakuNotificationListener.kt:26` → `src/notificationRows.ts:26`).
   - Transactions store no time of day (`src/domain.ts:13-32`).
   - Same-day rows sort by a hash (`src/App.tsx:1504`), so their order is effectively random.
   - Dedupe uses the *latest* post time, so an updated notification becomes a duplicate.
5. **Contrast fails on every input, not just one checkbox.** The `--line` colour borders every input at **1.283:1 in light mode and 1.694:1 in dark**, against a 3:1 minimum.
6. **The privacy promise is false today (P1).**
   - With "tidy names" on, names from captured alerts go to cloud AI before the user adds the row (`src/NotificationReview.tsx:42-53`). That includes the names of people the user sent money to.
   - The disclosure and `PLAY_DATA_SAFETY.md:14,33` say nothing leaves the phone until added.
   - ML Kit also sends usage data to Google, which is not declared.
7. **No Play-compliant app can guarantee capture on a phone that force-stops it.** Android won't restart a force-stopped app until it is opened. The most Saku can do:
   - avoid causing kills;
   - recover alerts still in the shade when the reader reconnects;
   - detect when it has stopped;
   - offer one Fix tap.

   Pass 1 builds exactly that.

## 1. Triage ledger

### A. The four reported issues

| # | Item | Verdict | Evidence | Decision |
|---|---|---|---|---|
| A1 | SHA in the production UI | NEEDED (O1) | The APK SHA-256 is shown at `landing/index.html:72,187`; the install guide asks users to check it (`landing/install-android.html:18`) | Delete both release panels and that install-guide sentence. No SHA on any page or screen; the updater keeps checking it in code (1E-1). |
| A2 | Source maps / build metadata (CWE-200) | SKIP | No `sourceMappingURL` in the 589 KB bundle | Nothing to remove |
| A3 | AI model names in UI | NEEDED | `src/Statements.tsx:351`; the tidy label says "Cloudflare AI" | Delete the dead screen and its engine. The label becomes "…with AI". Cloudflare stays named in the consent sheet and `worker/legal.js:30,91`. |
| A4 | Reader misses alerts on Samsung and Indonesian OEMs | NEEDED (P0) | Section B; device exit log | Pass 1A |
| A5 | Use post time, not approval time | PARTLY HANDLED → BETTER ALTERNATIVE | Reality check item 4 | Keep the earliest post time, add an optional time field, sort by it (1C) |
| A6 | Settings card and checkbox contrast | NEEDED | `src/styles.css:320-322, 2531-2537, 3739-3741` | Pass 2.1–2.3 |
| A7 | Compose fallbacks | SKIP | There is no Jetpack Compose; the UI is the WebView plus XML Views | CSS only |

### B. Android reliability and Play policy

| # | Hypothesis | Verdict | Evidence | Decision |
|---|---|---|---|---|
| B1 | `stopWithTask="false"` | SKIP | The listener is bound by the system (`AndroidManifest.xml:84-92`), so the flag doesn't apply | — |
| B2 | Filter `FLAG_GROUP_SUMMARY` and ongoing notifications | NEEDED (S) | No flag checks (`SakuNotificationListener.kt:22-27`) | 1A-3 |
| B3 | Content-hash dedupe | BETTER ALTERNATIVE | The ID uses post time (`NotificationInbox.kt:142`) and only checks the live inbox (`:61`) | Key on `sbn.key` + content hash, keep the earliest time, add 8-day tombstones |
| B4 | Room queue + WorkManager retry | SKIP | Capture has no network step (`NotificationInbox.kt:136-147`) | A lock and a worker thread instead |
| B5 | `requestRebind()` | ALREADY HANDLED | `SakuNotificationListener.kt:15,19`; `NotificationCapturePlugin.kt:75` | Add a rescan on reconnect (needs tombstones first) |
| B6 | ApplicationExitInfo diagnostics, incl. Android 17 MemoryLimiter | NEEDED (S) | The owner's phone shows `OneKeyClean`. The principal's web check found `MemoryLimiter:AnonSwap` on the Android Developers Blog (Jun/Aug 2026); the lead did not re-check that source. | Read locally, never upload |
| B7 | No `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` | ALREADY HANDLED (keep it absent) | Merged manifest | Read the exemption state; link to the battery settings list, which needs no permission |
| B8 | No fake `dataSync`/`specialUse` foreground service | ALREADY HANDLED | No `FOREGROUND_SERVICE` in the merged manifest | — |
| B9 | No `SCHEDULE_EXACT_ALARM` | ALREADY HANDLED | Removed (`AndroidManifest.xml:9`); reminders are inexact (`src/reminders.ts:74`) | — |
| B10 | Prominent disclosure before notification access | Placement HANDLED; truth and length NEEDED | `src/NotificationAccess.tsx:42-54`, about 150 words | Fix the data flow (1B), then the copy (2.6) |
| B11 | OEM setup gate on resume | BETTER ALTERNATIVE | Access is already re-checked on resume (`src/NotificationAccess.tsx:17`) | A three-state health line with one Fix tap, never a blocking gate |
| B12 | *New:* Android Go phones can't grant notification access | NEEDED (S) | The card is offered on every phone (`src/NotificationAccess.tsx:40`) | Hide it when `isLowRamDevice()` |
| B13 | *New:* self-updater code ships in the Play build | NEEDED (S) | `AppUpdatePlugin.kt` sits in `main/`, gated only at runtime (`MainActivity.java:22`) | Move it to `src/direct/java` |
| B14 | *New:* inbox race, key-creation race, silent wipe, work on the UI thread | NEEDED (S) | `NotificationInbox.kt:53,59-77,110-117,132` | 1A-1, 1A-2 |
| B15 | *New:* a cancellation that arrives after the spend was added is dropped | NEEDED (S) | `NotificationInbox.kt:70-77` | Create a "cancelled" review row |
| B16 | Android 15 hides OTP-like notification text | NEEDED (low) | The parser fails silently on the placeholder | Count the placeholder, never parse it |

### C. Security, storage and UU PDP (Law 27/2022)

| # | Hypothesis | Verdict | Evidence | Decision |
|---|---|---|---|---|
| C1 | EncryptedSharedPreferences → DataStore + Tink | SKIP | Saku already uses Android Keystore AES-GCM directly (`SecureSessionStore.kt:38-59`, `NotificationInbox.kt:109-127`). The SQLite plugin's EncryptedSharedPreferences only runs when its encryption is on, and it is off. | — |
| C2 | Room + SQLCipher | SKIP | Every minSdk 31 phone has file-based encryption; backup is off; the ledger is synced (`docs/p4-storage-migration.md:23`) | A Keystore-bound DB key would add a way to lose all data |
| C3 | `allowBackup=false` + extraction rules | ALREADY HANDLED | `AndroidManifest.xml:23-25` and both XML rule files | — |
| C4 | R8 log stripping | SKIP | Zero `Log` calls; with the current non-optimizing ProGuard file it would do nothing anyway | A CI grep guard instead |
| C5 | No cleartext / network security config | ALREADY HANDLED | `AndroidManifest.xml:30` | — |
| C6 | *New:* Content Security Policy | NEEDED | The web CSP is report-only with no endpoint (`worker/security-headers.js:1,11`), and `connect-src wss:` allows any host. The Android WebView has no CSP at all. | 1D |
| C7 | Granular consent records | NEEDED (S) | Consent is a device-only flag (`src/CatchUp.tsx:23`, `src/merchantCleaning.ts:7`); AI routes don't check it (`worker/index.js:638-740`) | 1B |
| C8 | Self-service export and deletion | ALREADY HANDLED | `src/App.tsx:1528-1530, 2532`; `/account-deletion` | — |
| C9 | Local-first parsing | ALREADY HANDLED | `NotificationParsers.kt` is deterministic | — |
| C10 | *New, P1:* tidying uploads names before the user adds the row | NEEDED | `src/NotificationReview.tsx:42-53` | Only tidy rows already in the ledger |
| C11 | *New, P1:* ML Kit telemetry undeclared | NEEDED | ML Kit's data transport is in the merged manifest; `PLAY_DATA_SAFETY.md:32` says OCR is on-device only | Declare "Diagnostics" |
| C12 | *New:* original statement files are kept forever | NEEDED (S) | IndexedDB with no expiry (`src/importDraft.ts:65-110`) | 30-day expiry |

### D. On-device AI

| # | Hypothesis | Verdict | Evidence | Decision |
|---|---|---|---|---|
| D1 | Tier 0 regex → Tier 1 tiny model → Tier 2 flagship | BETTER ALTERNATIVE | Tier 0 already exists: the notification parser, the local text-statement reader and merchant rules. Tier 1 can't be reached. Tier 2 is Workers AI (`@cf/google/gemma-4-26b-a4b-it`) behind consent. | Remove Tier 1. Keep ML Kit OCR (`src/App.tsx:1723`, `src/pdfReader.ts:50`). |
| D2 | Play Asset Delivery, FunctionGemma 270M, Gemma 3 1B | SKIP for now | Nothing would use it | Only revive under hard constraint HC9 |
| D3 | Unload the model when idle | ALREADY HANDLED | The engine is created and closed per call (`LocalStatementAIPlugin.kt:164-194`) | Moot once removed |
| D4 | Keep the LLM out of the listener's process | ALREADY HANDLED by removing it | Saku runs in a single process | HC9 |
| D5 | Base AAB under 200 MB | ALREADY HANDLED | The APK is 40–43 MB | About 20 MB smaller after 1E |

### E. Two-surface UX

| # | Hypothesis | Verdict | Evidence | Decision |
|---|---|---|---|---|
| E1 | Three.js/WebGL landing hero | VETO → BETTER ALTERNATIVE | HC8 caps added landing JS at 30 KB gzip, and the CSP only allows self-hosted scripts | CSS/SVG kinetic type |
| E2 | Static LCP poster, lazy loading, reduced motion | MOSTLY HANDLED | AVIF/WebP images with `fetchpriority` (`landing/index.html:80-81`) | The hidden dark-theme image also loads at high priority; make it low and lazy |
| E3 | Calm app (60-30-10 colour, borders before shadows, tabular numbers, no WebGL) | PARTLY | Shadow alpha .125 (`src/styles.css:3760`); some money renders without tabular numbers (`src/components.tsx:187,497,504`) | 2.1, 3.2 |
| E4 | WCAG 1.4.11 ≥ 3.0:1 | NEEDED | `--line` at 1.283 / 1.694 | New `--control-border` colour |
| E5 | Collapsible cards | BETTER ALTERNATIVE | `<details>` is already used (`src/App.tsx:1528,1906,2185`) | Native `<details>` plus an optional CSS animation of at most 200 ms. The `grid 0fr/1fr` + `inert` approach is rejected. |

### F. Convenience

| # | Hypothesis | Verdict | Evidence | Decision |
|---|---|---|---|---|
| F1 | 1-hour WorkManager digest + quiet hours | SKIP | One quiet, alert-once summary notification already exists (`NotificationInbox.kt:154-176`) | — |
| F2 | 1-tap Catch-up approval | BETTER ALTERNATIVE | "Add all" already exists (`src/NotificationReview.tsx:119`) | Put it on the Home screen's existing card (4.1) |
| F3 | Auto-learned merchant rules | ALREADY HANDLED | `learnMerchant` is called in 4 places | Learn only when a pocket is set; prefill the pocket with `lastPocketFor` |
| F4 | One-tap OEM recovery | NEEDED | Only Xiaomi gets help today | 1A-7 |
| F5 | *New:* captured rows silently expire after 7 days | NEEDED (S) | `NotificationInbox.kt:48,81` | Show "N expire soon" and fix the count |
| F6 | *New:* captured income is never pre-selected | NEEDED, with guards | `src/importTransactions.ts:43-47` | 4.2 |
| F7 | *New:* opted-in reminders stop after 7 days | NEEDED (S) | `src/reminders.ts:12` | 4.4 |

### G. Statement reading (OCR), from the Gemini research

Gemini's instructions were followed only where they beat what Saku already does.

| # | Research claim | Verdict | Evidence | Decision |
|---|---|---|---|---|
| G1 | A four-layer pipeline: decrypt, text layer or raster OCR, issuer classifier, then a polarity, locale and balance solver | MOSTLY HANDLED | Text layers are read on the phone and proven against the running balance (`src/statementLines.ts:4-9`). Raster pages go to Gemma 4 on Workers AI (`src/importPages.ts:62-79`, `worker/import-ai.js:1`). `worker/banks.js` classifies 7 issuers. | Keep the architecture and fill the gaps in G2–G9 |
| G2 | Unlock PDFs with the stored date of birth, DDMMYYYY first, then DDMMYY | BETTER ALTERNATIVE | Saku stores no birth date. Storing one would add personal data to Data Safety (HC5). | The prompt says the password is often the birth date. Saku tries what the user typed, then its DDMMYYYY and DDMMYY forms. Nothing is stored. |
| G3 | BRI's diagonal watermark corrupts text extraction ("RUBRI", "Page 1 of 7 RI") | NEEDED | The line builder keeps rotated text (`src/importPages.ts:28-41`) | Drop rotated text before building lines. Table text is never rotated. |
| G4 | Y-baseline row clustering and X-coordinate column masks | PARTLY → BETTER ALTERNATIVE | Rows come from fixed 4-pt buckets (`src/importPages.ts:33`). Two parts of one row 0.2 pt apart can land in different buckets, which splits the row. | Cluster rows by baseline, within half a glyph height. No per-bank X masks: a merged column breaks the balance chain, and the page safely goes to AI. |
| G5 | One number normalizer: the last separator decides (two digits are sen, three are thousands). It repairs OCR flips such as `42.940.00` and OVO's `Rp100.000.00`. | PARTLY NEEDED, for AI answers only | `wholeRupiah` returns 0 for `100.000.00`, `42.940.00` and `500.00` (`worker/import-ai.js:95-106`), so those rows arrive with no amount. Non-zero sen also return 0, deliberately: those rows wait for review (`worker/import-ai.test.mjs:96-98`). Text layers are exact, so `moneyToken` stays strict. | Accept zero sen after either mark. Non-zero sen still wait for review; Gemini's rounding is not adopted. |
| G6 | Five polarity grammars | PARTLY | Signed amounts, DB/CR flags and balance deltas already work. Two gaps: split Debet/Kredit columns with `0.00` in the unused side are refused (`src/statementLines.ts:164`), and trailing-hyphen debits (`303,201.91-`, BSI) are not read. | Accept both. The running balance still proves each row's direction. |
| G7 | *New:* a row number before the date (Mandiri Livin' "No", BSI "No.") | NEEDED | `leadingDate` reads `1 01 Okt 2026` as 1 January (`src/statementLines.ts:57`). The balance proof checks money, not dates, so it accepts the wrong date. | Skip a leading number only when a full date or a month name follows. Also read ISO dates (`2026-10-01`, BSI). |
| G8 | Product gate: a mortgage statement (BTN "SALINAN REKENING KORAN KPR") is not cash | NEEDED | Once its bank is supported, a loan's "Sisa Kredit" chain can pass the balance proof | `detectBank` names no bank for loan statements, so they are never read as cash |
| G9 | 19 more institutions | NEEDED, as beta | Text pages from unknown banks are refused before the local proof runs (`src/CatchUp.tsx:240-241`). `bankUnsupported` hard-codes six names and already omits BRI (`src/locales/en.ts:97`). | Add the 14 that public 2025–26 sources verify (5B), all `beta: true`. Rows proven by the balance still skip review. The message stops listing banks. |
| G10 | Per-bank X-coordinate templates and OCR layout-model training | SKIP | Saku trains no OCR model. Text layers are parsed deterministically; everything else goes to Gemma 4. | — |
| G11 | Credit-card rules: inverted CR polarity, REVERSAL CICILAN pairs, FX sub-lines, the Tagihan Baru check | PARTLY HANDLED | BCA cards are parsed locally (`src/statementLines.ts:401`); other issuers' cards go to AI | The new banks' hints say CR means a payment or refund. Netting installment reversals waits for 5E. |
| G12 | Cross-account reconciliation: self-transfer chains, pocket moves, GoPay mirrors, subset-sum card payments | DEFERRED | The research's largest accuracy lever, but it changes matching, not reading | 5E, after 5A–5D ship |
| G13 | The owner's real October PDFs as a CI regression suite | VETO | Real statements are never committed (`docs/monthly-check-3.0.md:77`) | Synthetic fixtures for each grammar. Real files are checked only on the owner's phone. |
| G14 | A QA sprint to capture Tier-3 PDFs (Allo, Bank Neo Commerce, Saqu, Krom, LINE Bank) | DEFERRED | No layouts to verify | Leave them out until a consented sample exists |

### H. Notification items in the same research (for Pass 1A)

| # | Research claim | Verdict | Evidence | Decision |
|---|---|---|---|---|
| H1 | Allowlist 33 bank and wallet packages | NEEDED | `KNOWN_APPS` has 7 (`NotificationCapture.kt:10-18`) | Add packages in 1A, each confirmed on a real phone, as the code comment already requires |
| H2 | Read WhatsApp and LINE, filtered to the bank's sender | VETO | HC4: filtering by sender means reading messages the user didn't choose | — |
| H3 | A 60-second dedupe across parent and standalone apps (GoPay and Gojek) | BETTER ALTERNATIVE | They are two different notifications, so 1A-3's repost dedupe doesn't apply | Show the pair as "Looks like a duplicate" (2.5) |
| H4 | A `BOOT_COMPLETED` receiver | SKIP | The system rebinds the listener after boot (B5); HC2 | — |
| H5 | OTP, promo and reminder filters | ALREADY HANDLED | `NotificationParsers.kt:22` | Add "split bill", "dana tertahan" and "pop-up awareness" when 1A next touches the parser |
| H6 | OVO's `Rp100.000.00` plus a fee sentence; ShopeePay's "Saldo saat ini" | NEEDED with H1 | Matters only once OVO and ShopeePay are allowed apps | Parser fixtures in 1A |
| H7 | Android 15/16 hides OTP-like text | ALREADY PLANNED | B16, 1A-3 | — |

## 2. Staged roadmap

### Hard constraints

These are the principal's binding veto rules; every pass is checked against them. Owner rule O1 outranks all of them.

1. **HC1:** No new Play-sensitive permissions: battery-exemption request, any foreground service, exact alarms, `QUERY_ALL_PACKAGES`, SMS, Accessibility, usage stats. `REQUEST_INSTALL_PACKAGES` stays in the website (`direct`) build only.
2. **HC2:** No new kinds of background work.
3. **HC3:** No notification-derived data leaves the phone before the user adds it.
4. **HC4:** Nothing from apps the user didn't choose is read, logged or counted.
5. **HC5:** The disclosure, the Data Safety form and the real data flows agree. Every cloud call needs a consent record (purpose, version, time).
6. **HC6:** No WebGL or 3D in the app. Motion uses CSS transform/opacity only and respects reduced motion. One exception: a 200 ms or shorter animation on Settings cards.
7. **HC7:** In the app:
   - the main JS chunk stays at or under 600 KB (target 450 KB);
   - no new font weights;
   - layout shift (CLS) at or under 0.1;
   - tap response (INP) at or under 200 ms on a Redmi-class phone.
8. **HC8:** On the landing page:
   - the hero screenshot (`<picture>`) stays the largest element to load;
   - that load (LCP) takes at most 2.5 s on 4G;
   - added JS is at most 30 KB gzip;
   - no CDN.
9. **HC9:** The base AAB stays at or under 150 MB (veto at 200 MB). Any AI model is downloaded on demand, opt-in, and runs in its own process.
10. **HC10:** No blocking gates, no silent data loss, and every failure is visible with exactly one fix.

### Pass 0: reusable review agents (small, docs only)

| File | Model | Tools | Core of the spec |
|---|---|---|---|
| `.claude/agents/principal-fintech-engineer.md` | opus | Read, Glob, Grep, Bash | O1 and HC1–HC10 as its veto list; read-only `adb dumpsys` only |
| `.claude/agents/genz-ui-director.md` | sonnet | Read, Glob, Grep, Bash, Skill | Two-surface rules; colour tables with measured contrast; `anti-slop` |
| `.claude/agents/ux-flow-auditor.md` | sonnet | Read, Glob, Grep, Bash, Skill | Before → after tap counts; contrast table; `ux-audit` + `anti-slop` |
| `.claude/agents/user-ease-strategist.md` | sonnet | Read, Glob, Grep | Search the code before proposing; must respect HC1–HC3 |
| `.claude/agents/anti-bloat-editor.md` | haiku | Read, Glob, Grep, Skill | Helper lines of 12 words or fewer; banned phrases, including hashes (O1); KEEP / TRIM / VETO table |

- Every spec says: read-only; cite `path:line`; never reopen `docs/ux-overhaul-plan.md`; never propose showing a SHA or other hash (O1); only reference skills that are installed.
- `lazy-user.md` stays unchanged and keeps running on every UI PR.
- This plan is already at `docs/audit/master-plan.md`.

### Pass 1: reliability, timestamps, Play policy, security and leakage

Five independent chains. Within each chain, every step depends on the one before it.

**1A Capture pipeline** (`SakuNotificationListener.kt`, `NotificationInbox.kt`, `NotificationCapture.kt`, `NotificationCapturePlugin.kt`, plus tests)

1. **Lock and worker thread.** One process-wide lock around every inbox read-modify-write and around `KeystoreCipher.key()`. Listener work moves to a single background thread, so no encryption or disk write runs on the WebView's UI thread.
2. **Wipe only when unavoidable.** Wipe the inbox only on permanent crypto errors (AEADBadTag, KeyPermanentlyInvalidated, UnrecoverableKey). Record `inboxResetAt` and tell the user once.
3. **Filtering and dedupe:**
   - skip group-summary and ongoing notifications before reading any content;
   - new ID = hash(salt‖`sbn.key`‖hash(title+text));
   - a repost of the same ID counts as an update, and the earliest post time is kept;
   - remember handled rows for 8 days ("tombstones") inside the encrypted inbox;
   - count Android 15 "Sensitive notification content hidden" placeholders and never parse them.
4. **Rescan on reconnect.** In `onListenerConnected`, run `getActiveNotifications()` through the same gate, dedupe and tombstones. This recovers any alert still in the shade after a kill.
5. **Heartbeat and exit log.**
   - Heartbeat, timestamps and counts only: `connectedAt`, `disconnectedAt`, `lastAdmittedAt`, `redactedCount`, `expiredCount`.
   - A local reader keeps the last 16 process-exit reasons and recognises `OneKeyClean` and `MemoryLimiter`. Never uploaded.
   - Call `setProcessStateSummary`.
6. **Richer status.** `status()` adds: listener connected, last captured alert, battery exemption, background restriction, standby bucket, low-RAM phone, unused-app restriction, phone brand family.
7. **Fix tap.** One tap rebinds the listener, then opens the most relevant system screen:
   - stable screens first: `ACTION_APPLICATION_DETAILS_SETTINGS`, `ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS`, `IntentCompat.createManageUnusedAppRestrictionsIntent`;
   - then at most one brand-specific screen per OEM, wrapped in `runCatching` because those names change between OS versions.
8. **Setup:**
   - open Saku's own toggle with `ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS`, falling back to the full list if that fails;
   - website APK on Android 13+ that was never granted access: open App info first, with one line explaining "Allow restricted settings";
   - everywhere else, show that line only if the user comes back without access;
   - hide the reader on Android Go phones.
9. **Late cancellations.** A cancellation arriving after the spend was added creates a "cancelled" review row linked to the ledger entry.
10. **Correct count.** `inbox()` re-runs the summary after purging old rows, so the "N rows" notification stays accurate.
11. **Test hook (debug builds only).** Treat `com.android.shell` as a fake bank, so `adb shell cmd notification post` can drive the real pipeline. A unit test asserts the release allowlist equals `KNOWN_APPS`.

**1B Consent and data flow** (`worker/index.js`, `worker/schema.sql`, `src/NotificationReview.tsx`, `src/merchantCleaning.ts`, `src/CatchUp.tsx`, `PLAY_DATA_SAFETY.md`, `worker/legal.js`)

1. **Consent endpoint.** `POST /v1/me/consent {purpose, version}` stores a database row (user, purpose, version, time, withdrawn time). AI routes return 403 without one.
2. **Tidy only saved rows.** Tidying only sends names of rows already in the ledger, never captured rows waiting in the inbox. Turning the switch on records a consent receipt.
3. **Truthful declarations.** Data Safety and the privacy notice declare ML Kit's "App info & performance → Diagnostics" and describe tidying accurately.
4. **File expiry.** Original statement files in IndexedDB expire after 30 days.

**1C Time and order** (`src/domain.ts`, `src/notificationRows.ts`, `src/importTransactions.ts`, `src/App.tsx:1504`, `WidgetLedger.kt`)

1. **Optional time field.** Add `time?: "HH:MM"`, validated with `^([01]\d|2[0-3]):[0-5]\d$`. The validator doesn't whitelist keys, so older app versions accept it.
2. **Which time to stamp.** Captured rows get the earliest post time. Widget and quick-entry saves stamp the current time.
3. **Sort and show.** Sort by date, then time, then position. Captured rows show their time, e.g. "14:22".
4. **Bank-printed times.** Use a time printed in the bank's text only when it has a full date within [post time − 36 h, post time + 5 min]. Ignore `Notification.when`, which apps set arbitrarily.
5. **Sheets.** Don't add a Sheets column until the minimum supported APK writes it; the column list is hard-coded at `WidgetSheetMirror.kt:12`.

**1D Content Security Policy**

1. **Report endpoint.** Add a Worker endpoint that receives CSP reports and stores counts only.
2. **Android WebView policy.** Inject the policy at runtime from a module imported on line 1 of `main.tsx` (`import "./csp"`). A static meta tag could block Capacitor's inline bridge fallback (`JSInjector.java:92`). Policy: `connect-src 'self' https://app.sakumoney.my.id wss://app.sakumoney.my.id; worker-src 'self' blob:`, no `unsafe-eval`.
3. **Web policy.** Remove the bare `wss:`, keep report-only for 7 clean days, then enforce.

**1E Leakage and the dead AI engine** (`landing/*`, `worker/index.js`, `worker/security-headers.js`, `src/Statements.tsx`, `src/App.tsx`, `LocalStatementAIPlugin.kt`, `android/app/build.gradle`, `src/locales/*`)

1. **No SHA anywhere (O1).**
   - Delete both release panels: the hero (`landing/index.html:72`) and the closing section (`:187`). Delete their fetch and render code (`landing/script.js:13-40`) and their styles (`landing/styles.css:72-78`).
   - Install guide: step 1 ends at the download link. Drop the "Periksa versi dan SHA-256…" sentence (`landing/install-android.html:18`), and drop "dan memeriksa versi unduhan" from the meta description (`:7`).
   - The website then calls no API:
     - remove `https://app.sakumoney.my.id` from the landing `connect-src` in both copies of the policy (`landing/_headers:2`, `worker/security-headers.js:2`);
     - remove the Worker's landing CORS exception for the release feed (`worker/index.js:493,504`);
     - change `worker/android-release.test.mjs:38-40` to expect the landing origin to be refused.
   - Keep `sha256` in the release feed, because the updater checks downloads against it (`src/appUpdate.tsx:108`). The update prompt shows the version and notes, never the hash (`src/appUpdate.tsx:138-141`).
   - Don't move the version, date or notes to the install page. Without the SHA there is nothing left to verify there, and existing users see what's new in the in-app update prompt.
   - Future release checklists drop the step "the download panel shows the version and SHA-256" (last used in `docs/release-2.4.0.md:74`).
2. **Dead AI engine.** Delete the unreachable `Statements` screen and its "Qwen…" line. In the same release, remove the `litertlm-android` dependency and the `generate`, `downloadModel`, `removeModel` and `cancel` methods. Keep ML Kit `recognizeImage`.
3. **Play hygiene.**
   - Move `AppUpdatePlugin.kt` to `src/direct/java`.
   - Add a test that snapshots the manifest's permission list.
   - Switch to `proguard-android-optimize.txt`, guarded by the test suite.

### Pass 2: flows, Settings cards, contrast and copy

Ship the copy changes (2.6) with UXP-PR5, the words pass, so there is only one copy pass.

**2.1 Colour tokens** (`src/styles.css:3704-3735`; contrast measured, unrounded)

| Token | Now | Light | Dark | Measured contrast |
|---|---|---|---|---|
| `--control-border` (new; inputs, selects, checkbox and switch outlines) | `--line` | `#6f8378` | `#7c9a8a` | Light: 4.043 on white, 3.734 on page background, 3.610 on muted surface. Dark: 4.797, 5.654, 4.092 |
| `--line` | `#dbe6dc` / `#365144` | keep, dividers only | keep | decorative only |
| `--muted` | `#60746a` (4.460 on muted surface, fails) | `#5a6e64` | keep | 4.871 / 5.039 |
| `--warning` (text) | `#a86c32` (3.994 on page background, fails) | `#8f5a24` | keep | 5.305 / 5.744 |
| `--focus-ring` (new) | same as `--teal` | `#176b55` | `#92d3b1` | 5.930 / 10.054 on page background |
| Shadows | alpha .125 (`:3760`) | .06 or less | none | — |

- Delete the dead tokens at `:1-12` and the unloaded "DM Sans" font at `:1629`.
- Add one rule, `:root { font-variant-numeric: tabular-nums }`. First confirm Plus Jakarta Sans has tabular figures (V2.2).

**2.2 Controls**

- "Tidy names" becomes a switch (`role="switch"`) on a 48 dp row.
- Checkboxes become 24 px with a `--control-border` outline.
- Every `.checkbox-label` gets a 48 px minimum height. Today the tap target is about 16 px, with 11 px text.

**2.3 Settings as collapsible cards**

Native `<details>`/`<summary>` rows at least 48 px tall, with no buttons inside the summary row.

| # | Card | Open by default when | Collapsed summary |
|---|---|---|---|
| 1 | Bank notification reader | it's Off or needs a check | "On · last alert 2 h ago" / "Off" / "Check" |
| 2 | Accounts | always | "4 accounts" |
| 3 | Google backup | changes are waiting | "Up to date · 14:02" |
| 4 | Daily reminder | never | "On · 20:00" |
| 5 | App lock | never | "Off" |
| 6 | Display (appearance and language merged) | never | "System · Bahasa" |
| 7 | Profile | never | the user's name |
| 8 | Your data (backup, restore, legal, delete) | never | "Backup · Restore · Delete" |
| 9 | About | never | "2.5.0 · up to date" |

- Delete the "Offline first" card (`src/App.tsx:2534-2537`).
- Final step: add an opening animation of 200 ms or less, CSS only (`::details-content` inside `@supports (interpolate-size: allow-keywords)` and `prefers-reduced-motion: no-preference`). Older WebViews simply open instantly.

**2.4 Reader card**

- One button names the detected apps: "Turn on for BCA, GoPay". The four disclosure facts sit on the same screen. Nothing is pre-ticked. A consent receipt is recorded.
- Three health states: **On**, **Off** and **Check**. Check appears when any of these is true:
  - the listener isn't bound 5 s after a rebind;
  - a system kill happened after the last connect;
  - Saku is background-restricted;
  - Saku is in the RESTRICTED standby bucket.
- Check never fires for quiet days, for a missing battery exemption, or for exits the user caused or app updates.
- A proactive "Keep running" row shows only on Samsung and Xiaomi. Other brands get the Fix tap once a stop is detected.

**2.5 Review flow**

- Replace the 13 px checkbox inside a pop-up (`src/NotificationReview.tsx:135`) with an inline "Looks like a duplicate · Skip / Add anyway" choice on the row.
- "Add N" says which rows it left out.
- Delete the swipe hint text; the swipe gesture stays.
- Add one line, "2 expire soon".
- The per-row pocket chip and Undo come from UXP-PR4.

**2.6 Copy, before → after** (each line 12 words or fewer)

| Key | Before | After (EN) | After (ID) |
|---|---|---|---|
| `readBankNotificationsBody` | 23 words | Payment alerts become rows. You decide what joins your ledger. | Notifikasi pembayaran jadi baris. Kamu yang memutuskan apa yang masuk catatan. |
| `notificationAccessOff` | 6 words | Off. Allow access to read payments. | Mati. Izinkan akses untuk membaca pembayaran. |
| Health: on | "Reading notifications from: BCA" (shown even when the reader is dead) | On. Last alert 2 hours ago. | Aktif. Notifikasi terakhir 2 jam lalu. |
| Health: quiet | — | No bank alert for 5 days. | Belum ada notifikasi bank selama 5 hari. |
| Health: stopped | — | Phone stopped Saku. Tap to fix. | HP menghentikan Saku. Ketuk untuk memperbaiki. |
| `xiaomiAutostart` | 15 words | Turn on Autostart so Saku keeps running. | Nyalakan Mulai otomatis agar Saku tetap jalan. |
| Samsung row (new) | — | Set Saku to Unrestricted in battery. | Atur baterai Saku ke Tidak dibatasi. |
| `tidyMerchantNames` | "…with Cloudflare AI" | Tidy merchant names with AI | Rapikan nama merchant dengan AI |
| `tidyMerchantNamesBody` | 16 words | Sends new names to AI. Never amounts or notification text. | Kirim nama baru ke AI. Tidak pernah jumlah atau teks notifikasi. |
| Disclosure (4 paragraphs, about 150 words) | — | **Reads:** only {apps}; others are ignored unread. **Keeps:** amount, in/out, balance, merchant; account and reference numbers removed. **Stored:** encrypted here, gone after 7 days. Nothing syncs until you add it. **Stop:** Pause, untick an app, or turn off in Android. | **Dibaca:** hanya {apps}; lainnya diabaikan. **Disimpan:** jumlah, masuk/keluar, saldo, merchant; nomor rekening dan referensi dihapus. **Tersimpan:** terenkripsi di sini, hilang setelah 7 hari. Tidak ada yang disinkronkan sebelum kamu tambahkan. **Berhenti:** Jeda, hapus centang, atau matikan di Android. |
| Restricted-settings help (5 steps, about 85 words) | — | Blocked? Open Saku's app info, tap ⋮, then Allow restricted settings. | Diblokir? Buka info aplikasi Saku, ketuk ⋮, lalu Izinkan setelan terbatas. |
| `consentText` | 31 words | Pages Saku can't read go to Cloudflare AI. Names you entered may be sent to match rows. Your files stay on this phone. | Halaman yang tak terbaca dikirim ke Cloudflare AI. Nama yang kamu catat bisa dikirim untuk mencocokkan. Berkasmu tetap di ponsel ini. |
| `cloudPageConsentNeeded` | 19 words | This page needs cloud reading. | Halaman ini perlu dibaca lewat cloud. |
| `updateInstalledVersion` | "Saku {version} · build {build}" | Saku {version} | Saku {version} |
| Model line | "Qwen3 0.6B mixed INT4 · 475 MiB…" | Deleted with the dead screen | — |
| Landing release panels (hero and closing) | version · date · SHA-256 · Salin · 3 notes | Deleted (O1) | — |
| Install guide, step 1 | "…Periksa versi dan SHA-256 yang ditampilkan di halaman utama sebelum memasang." | Download the APK from Saku's official link. | Unduh APK dari tautan resmi Saku. |

A copy lint test enforces these banned patterns in `src/locales` and `landing/*.html`:

- model, runtime or vendor names in labels;
- a SHA or other hash (O1), or a build ID, on any screen or page;
- "Here is exactly…" openers;
- explaining a problem before the user hits it;
- helper lines over 12 words;
- hard-coded English;
- pill badges on static metadata.

**2.7 Receipt scan.** Move it to an icon button inside the Amount field. Fill the amount only if it's empty; today it overwrites a typed amount (`src/App.tsx:1721`).

**2.8 Ratchet tests in `npm test`**

- Contrast: controls at least 3.0:1 and text at least 4.5:1, in both themes.
- The copy lint above.
- The count of 9–11 px font sizes can only go down from today's 219. Any screen a PR touches moves to 12 px or more.

**Flows, before → after** (taps counted from Home)

| Journey | Before | After |
|---|---|---|
| J1a Turn on the reader (Play install) | ~11 taps, 8 text blocks | 7 taps, 2 text blocks |
| J1b Website APK on Android 13+ ("Restricted setting") | ~17, including one failed attempt | 12 |
| J1c Samsung | dead end | 7, plus ~5 for the optional "Keep running" step |
| J2 Review 6 rows with pockets and 2 duplicates | ~30 | ~4 (2 at best; 1 from the Home card) |
| J3 The reader stopped silently | never noticed | 0 taps to notice; 1 Fix tap plus 2–4 system taps |
| J4 Change "tidy names" | 3 taps, 2 text blocks, ~16 px target | 3 taps, 0 text blocks, 48 dp target |
| Receipt scan | 4 taps, overwrites a typed amount | 4 taps, fills only an empty amount |

### Pass 3: visual identity and landing motion

**Landing page**

- **Remove the decoration:** rotated ticket cards, the art grid, faded ghost words, the `s.` orbit, hard offset "sticker" shadows (`landing/styles.css:9`), and English labels on the Indonesian page.
- **New hero in pure CSS/SVG:**
  - the headline words rise 8 px in a staggered 300 ms animation;
  - a coin path built from `src/brandMark.ts` draws from "uangmu" to the phone screenshot;
  - a tabular "Rp32.000" counts up.
- **Performance rules:** only transform and opacity animate. With reduced motion it stays still. The screenshot `<picture>` stays the largest element to load; its hidden dark-theme twin becomes `fetchpriority="low" loading="lazy"`.
- **One accent colour:** marigold `#f2b84b`, with dark ink text on it at 6.763:1. Use it only on the main button and one highlighted word. The app never gets it.

**App**

- No new colours; teal stays the only accent.
- Remove `backdrop-filter` blur (`src/styles.css:1362,3108,3892,3930`), or give it an opaque fallback with a 3:1 border.
- Motion of 100–200 ms for state changes only. The balance count-up drops from 520 ms to 300 ms (`src/motion.tsx:11`).

**Gate:** HC8 (Lighthouse mobile) and HC6.

### Pass 4: convenience

| Item | What | Principal's conditions |
|---|---|---|
| 4.1 Home card | Reuse the existing card slot (`src/App.tsx:856`). It shows either "3 ready · 2 need a look · Add 3" or the days-missed message. Later, a one-time "Turn on bank alerts?" | Comes after UXP-PR4 (pocket chip and Undo) and UXP-PR5. Reserve the card's height, or render it only once the count is known, so the page doesn't shift (CLS). |
| 4.2 Income starts as "ready" | Today all captured income waits as "later" and can expire unseen | Only when there's no opposite-direction row for the same amount within 30 min, in the inbox or the ledger; the amount is under Rp 10.000.000; and the name doesn't match the user's profile name. Otherwise it stays "need a look". |
| 4.3 Pocket memory | Prefill the pocket via `lastPocketFor`; learn a rule only when a pocket is set (`src/NotificationReview.tsx:99`) | Stays on the phone |
| 4.4 Reminder tail | After the 7 day-specific reminders, one plain daily reminder repeats (non-waking alarm) | Only when reminders are on; at most one a day; no amounts; cancelled when turned off |
| 4.5 Smaller main chunk | Lazy-load the inactive language and the CSV/papaparse code | Target 450 KB or less |
| 4.6 On-device AI | Nothing to build; Tier 1 is removed in 1E | Revive only under HC9: opt-in, downloaded on demand, own process, served from R2 with SHA-256 |

### Pass 5: statement reading (OCR)

The goal is more statement pages proven on the phone (no AI call, no neurons) and fewer misreads where AI is still needed. 5A–5D are independent chains. 5E is planning only.

**5A Text-layer reader** (`src/statementLines.ts`, `src/importPages.ts`, tests in `src/statementMatch.test.ts`)

1. **Lines.** One pure `pageLines(items)` replaces the 4-pt buckets. Rows cluster by baseline, within half a glyph height, and rotated text (watermarks) is dropped. `src/pdfReader.ts` keeps its own copy, because 1E deletes it with the dead screen.
2. **Dates.** Skip a row number before a date when a full date or a month name follows. Read ISO dates (`2026-10-01`). A wrapped time line (`08:15:00 WIB`) is not part of the description. The year must repeat the day/month separator: before this, `03/10 2061` (a Maybank KODE after the date) read as the year 2061, and `02/10 15` as 2015.
3. **Amounts.** Read three new forms:
   - split Debet/Kredit columns with a printed zero in the unused one;
   - trailing-hyphen debits (`303,201.91-`);
   - a currency word before each amount (`IDR 150.000 IDR 2.850.000`).

   The running balance still proves every direction. "Bagi hasil" counts as interest. A "Saldo Awal" or "Saldo Akhir" line with no amount is a column title (LinkAja), so it no longer rejects the page.
4. **Loan gate.** `detectBank` names no bank for a loan or mortgage statement (`REKENING KORAN KPR`; `Sisa Kredit`, `Sisa Pinjaman` or `Sisa Pokok`), so it is never read as cash.

**5B Banks** (`worker/banks.js`, `scripts/fixtures/statements/`, `docs/monthly-check-3.0.md`, `src/locales/*`)

1. **New banks, all `beta: true`.**
   - Statements and screenshots: Mandiri, BNI, BSI, CIMB Niaga, Permata, OCBC, Maybank, Danamon, BTN, Superbank, LinkAja, Jenius.
   - Screenshots only: OVO, ShopeePay.
   - Each signature uses a legal name or statement title. Each hint gives the bank's polarity grammar and number format in one or two sentences.
   - Every bank's hint moves to `worker/import-ai.js`, its only reader, so the app bundle carries no prompt text (HC7).
2. **Fixtures.** Each statement bank gets a synthetic text fixture in the grammar the research describes. A unit test checks that `detectBank` names the bank and that the page is proven locally.
3. **Copy.** `bankUnsupported` stops listing banks: "Saku can't read this bank yet." / "Saku belum bisa membaca bank ini."
4. **Beta exit.** A bank stays beta until the stage AI bench passes on its fixtures. The owner approves each run, because it spends the AI allowance that stage and production share.

**5C AI answers** (`worker/import-ai.js`)

1. **Amounts.** In `wholeRupiah`, two digits after the last mark are sen, whichever mark it is. `Rp100.000.00`, OCR's `42.940.00` and `500.00` then read correctly. Non-zero sen and decimal numbers still return 0, so the row waits for review, as today.
2. **Notifications stay strict.** `NotificationParsers.kt` keeps its stricter rule, because notification text is never OCR'd. Its comment says so.

**5D PDF password** (`src/importFlow.ts`, `src/CatchUp.tsx`, `src/locales/*`)

1. **Birth-date forms.** The prompt says the password is often the birth date. Saku tries what was typed, then its DDMMYYYY and DDMMYY forms, and stores none of them.
2. **Wrong password.** It says so in the user's language, instead of pdf.js's English error.

**5E Reconciliation** (plan only; its own pass after 5A–5D ship)

- **Self-transfer chains** across wallets: opposite rows of the same amount within ±24 h, naming the user or their account.
- **Pocket moves and auto-sweeps** count as internal.
- **Mirrored wallet rows** (GoPay, OVO) only lend a merchant name to the bank or card row they mirror.
- **Card payments:** one savings debit is matched against several card payments (subset sum, same customer number, ±1 business day). Installment reversals are netted.
- **Gate:** the principal reviews the matching rules. No row is ever dropped silently (HC10).

**Gate:** `npm test` passes, and the tests and fixtures of the seven existing banks are unchanged. Main chunk (HC7): 601,764 bytes after 5A–5D, against 600,576 at `00ce3ba`, which is already over 600,000. Pass 4.5 brings it down.

## 3. Conflicts resolved in Phase 2

| Topic | Positions | Resolution |
|---|---|---|
| Pre-ticked apps | Flow auditor: pre-tick. Editor: never. | One button that names the apps, with the 4 facts on screen and a receipt. The principal ruled this valid explicit consent under UU PDP and Play policy. |
| Restricted-settings help | Editor: put it in the privacy notice. Flow auditor: route by build. | The website build opens App info first. Everywhere else, one help line appears after a failed attempt. The steps stay in-app. |
| Collapse animation | Editor: none. UI director: `::details-content`. Brief: grid + `inert`. | Instant by default, plus a CSS animation of 200 ms or less on Settings only (HC6 amended). Grid + `inert` rejected. |
| Landing 3D | Brief: Three.js. UI director: WebGL up to 45 KB. | CSS/SVG only; Three.js and WebGL vetoed under HC8. |
| Sub-12 px fonts | UI director: fix all 219 now. Editor: fix as touched. | A ratchet test |
| Landing SHA | Principal: keep it, on the install page. UX reviewers: remove it. | **Owner rule O1 (2026-11-21): removed from every page and screen.** The updater still checks it in code. |
| Home card | Editor: no new card. Flow auditor: add one. | Reuse the existing slot, with its height reserved |
| Expiry warning | Ease strategist: a chip on each row. Flow auditor: one line. | One line, plus the count fix |
| Income default | Ease strategist: ready. Flow auditor: unverified. | Ready, with the guards in 4.2 |
| Reminders | Ease strategist: schedule 14 days ahead. Flow auditor: veto. | A plain daily tail reminder |
| Tidy label | Flow auditor: "Clean up shop names". Editor: "…with AI". | "Tidy merchant names with AI", with Cloudflare named in the consent sheet |
| Dead AI engine | Editor: remove in a later PR | Remove in the same release as the dead screen (principal) |
| Disclosure facts | Editor dropped "reference numbers removed" | Kept, because it's true (`InboxRedaction`) |
| Border colours | UI director: `#7c8a82` / `#6b8a79`. Flow auditor: `#6f8378` / `#7c9a8a`. | The flow auditor's values (at least 3.61:1 everywhere) under the UI director's token name |
| Android WebView CSP | Lead: a static meta tag | Runtime injection instead, because of the bridge's inline fallback |

## 4. Rejected or deferred

**Rejected**

- **Release metadata on the website:** the APK SHA-256 anywhere in production (O1), and a version, date and notes line on the install page (nothing left to verify without the SHA).
- **Visual:** a Three.js/WebGL hero (HC8; no conversion value).
- **Storage:** Room + SQLCipher; EncryptedSharedPreferences → DataStore + Tink.
- **Hardening that does nothing here:** R8 `-assumenosideeffects`; a network-security-config file or certificate pinning; `stopWithTask`.
- **Background work:** a WorkManager queue, retries and the 1-hour digest (HC2); a battery-exemption request, a keep-alive foreground service, exact alarms (HC1); a blocking OEM gate (HC10).
- **Unsafe shortcut:** a notification button that adds rows without opening the app. It would be a second ledger writer with no review and no Undo.
- **Consent and setup:** pre-ticked boxes; detecting the installer source.
- **Landing additions:** a 4-step install strip; an auto-capture feature line is allowed only as a swap, never an addition.
- **Expiry:** per-row expiry chips; keeping rows longer than 7 days (that would change Data Safety and the disclosure).
- **Animation:** the `grid 0fr/1fr` + `inert` approach and JS height animation.
- **Reminders and prompts:** a 14-day reminder horizon; a pop-up after onboarding (a card is fine).
- **AI tiers:** Play Asset Delivery, FunctionGemma and Gemma 3 1B.
- **From the Gemini research:**
  - storing the user's birth date to unlock PDFs;
  - per-bank X-coordinate templates and OCR model training;
  - the owner's real statements as a CI suite;
  - reading WhatsApp or LINE to catch bank alerts;
  - a boot receiver.

**Deferred**

- Tier-3 institutions (Allo, Bank Neo Commerce, Saqu, Krom, LINE Bank), until a consented sample exists.
- Reconciliation (5E), until 5A–5D ship.

- A Sheets `time` column, until the minimum supported APK writes it.
- Encrypting the ledger at rest, unless the threat model changes.
- Using the Play-services version of ML Kit. It could save about 23 MB more, but the reviewers did not rule on the extra Google Play services dependency or the first-use download.
- Real-user tap-speed (INP) monitoring; lab checks only for now.

## 5. Verification checklist

Run from the repo root in PowerShell. Device checks use a test phone with a debug build. `L` stands for `id.saku.money/id.saku.money.SakuNotificationListener`.

| # | Proves | Command | Passes when |
|---|---|---|---|
| V0.1 | Agents exist | `Get-ChildItem .claude\agents\*.md` | 6 files, 5 of them with `model:` |
| V1.1 | Pipeline logic | `cd android; .\gradlew.bat :app:testDirectDebugUnitTest :app:testPlayDebugUnitTest` | New tests pass: concurrent writers, key race, temporary vs permanent crypto errors, group summary, repost keeps the earliest time, tombstones, OTP placeholder, cancelled after add, release allowlist |
| V1.2 | Listener bound | `adb shell dumpsys notification \| Select-String SakuNotificationListener` | Listed as connected |
| V1.3 | Capture and time | `adb shell "cmd notification post -S bigtext -t 'BCA mobile' saku1 'Transaksi QRIS sebesar Rp25.000 di KOPI KENANGAN berhasil.'"` | The row shows the post time, and keeps it when added 10+ minutes later |
| V1.4 | Recovery after force-stop | `adb shell am force-stop id.saku.money`, post twice (tags `saku2`, `saku3`), then `adb shell monkey -p id.saku.money -c android.intent.category.LAUNCHER 1` | Both rows appear |
| V1.5 | No re-added rows | Add one row and skip another, then `adb shell cmd notification disallow_listener L` and `allow_listener L` | Inbox unchanged |
| V1.6 | Repost is an update | Post V1.3 again with tag `saku1` | Still one row, with the first time |
| V1.7 | Health "Check" | `adb shell am set-standby-bucket id.saku.money restricted` (reset with `active`), and `adb shell cmd appops set id.saku.money RUN_ANY_IN_BACKGROUND ignore` (reset with `allow`) | Check and Fix appear, and clear after the reset |
| V1.8 | Exit reasons | `adb shell dumpsys activity exit-info id.saku.money` | The newest kill shows in the app. A kill the OS already recovered from (a later `connectedAt`) does not trigger Check. |
| V1.9 | Doze | `adb shell dumpsys deviceidle force-idle`, post, then `adb shell dumpsys deviceidle unforce` | Captured |
| V1.10 | Android Go | `adb shell getprop ro.config.low_ram` on an Android Go phone | Returns `true`, and the reader card is hidden |
| V1.11 | Samsung (manual, One UI 7+) | Put Saku in Deep sleeping apps, post an alert, open Saku | Check appears; after Fix → Unrestricted + Never sleeping, capture works. Match the Indonesian label to the phone's wording. |
| V1.12 | Consent and time logic | `npm test` | AI route returns 403 without consent; opening the inbox makes no tidy call; the time validator and date-then-time sort pass |
| V1.13 | Play permissions | `npm run android:release`, then `java -jar bundletool.jar build-apks --bundle=android\app\build\outputs\bundle\playRelease\app-play-release.aab --output=out\play.apks --mode=universal`, then `tar -xf out\play.apks -C out\play`, then `& "$env:ANDROID_HOME\build-tools\36.0.0\aapt2.exe" dump permissions out\play\universal.apk \| Select-String "REQUEST_INSTALL_PACKAGES\|IGNORE_BATTERY\|EXACT_ALARM\|FOREGROUND_SERVICE\|QUERY_ALL_PACKAGES"` | No output |
| V1.14 | Dead AI engine and updater gone from the Play build | `tar -tf out\play\universal.apk \| Select-String litertlm`, then `& "$env:ANDROID_HOME\cmdline-tools\latest\bin\apkanalyzer.bat" dex packages out\play\universal.apk \| Select-String AppUpdatePlugin` | No output |
| V1.15 | Size | `java -jar bundletool.jar get-size total --apks=out\play.apks` | 150 MB or less, and about 20 MB below 2.5.0 |
| V1.16 | No SHA or model names (O1, A3) | `foreach ($u in "https://sakumoney.my.id/", "https://sakumoney.my.id/install-android.html") { curl.exe -s $u \| Select-String "SHA-256\|sha256\|data-release" }`, then `Select-String -Path src\locales\*.ts,landing\*.html,landing\*.js -Pattern "SHA-256\|sha256\|\{build\}"`, then `Select-String -Path src\*.tsx,src\locales\*.ts,landing\*.html -Pattern "Qwen\|Gemma\|INT4\|MiB\|LiteRT"` | No output |
| V1.17 | CSP | `curl.exe -sI https://app.sakumoney.my.id/ \| Select-String content-security-policy` | After the 7-day soak, the header is enforced and has no bare `wss:`. On Android, `chrome://inspect` shows no violations at start, and `fetch('https://example.com')` is blocked. |
| V2.1 | Ratchet tests | `npm test` | Contrast, copy lint and font-size tests pass |
| V2.2 | Tabular numbers | In the app's DevTools console, compare the widths of "1111" and "8888" with `tabular-nums` | Equal widths |
| V2.3 | Themes and accessibility (manual) | Light/dark × English/Indonesian at 390 px; TalkBack | TalkBack reads "Tidy merchant names with AI, switch, off"; every card row is at least 48 px |
| V2.4 | Animation fallback | An Android 12 emulator with its original WebView; DevTools → Rendering → `prefers-reduced-motion: reduce` | Instant on the old WebView, 200 ms or less on a current one, none with reduced motion |
| V2.5 | Tap counts and copy | Run the `lazy-user`, `ux-flow-auditor` and `anti-bloat-editor` agents on the diff | J1a ≤ 7, J2 ≤ 4, J3 = 0 taps to notice; no "quits the task" findings; zero VETO rows |
| V3.1 | Landing Core Web Vitals | `npx wrangler dev -c wrangler.landing.jsonc`, then `npx lighthouse http://localhost:8787/ --form-factor=mobile --only-categories=performance --output=json --output-path=lh.json`, then `node -e "const a=require('./lh.json').audits;console.log(a['largest-contentful-paint'].numericValue,a['cumulative-layout-shift'].numericValue,a['total-blocking-time'].numericValue)"` | LCP ≤ 2500, CLS ≤ 0.1, TBT ≤ 200, and the largest element is `.hero-device img`. Repeat on production after deploy. |
| V3.2 | Landing JS weight | `node -e "const z=require('zlib'),f=require('fs');console.log(z.gzipSync(f.readFileSync('landing/script.js')).length)"` | No more than today's size + 30 KB |
| V3.3 | Landing CSP and no API calls | `curl.exe -sI https://sakumoney.my.id/ \| Select-String content-security-policy`, then `curl.exe -s -o NUL -w "%{http_code}" -H "Origin: https://sakumoney.my.id" https://app.sakumoney.my.id/v1/releases/android/latest` | Still `script-src 'self'`, with `connect-src 'self'` only; the release feed refuses the landing origin (403) |
| V4.1 | Main chunk size | `npm run build`, then `Get-ChildItem dist\assets\index-*.js \| Select-Object Name, Length` | 450,000 bytes or less |
| V4.2 | Home layout shift | Lighthouse or DevTools Performance on a signed-in Home | CLS ≤ 0.1 with the card slot |
| V4.3 | Convenience logic | `npm test` | Income guards (own name; matching row in inbox and ledger), pocket prefill, learn only with a pocket, and the reminder tail (one a day, cancelled on opt-out) all pass |
| V5.1 | Reader logic | `npm test` | New tests pass: watermark dropped, baseline jitter kept on one row, row number before a date, ISO date, split columns, trailing-hyphen debit, currency words, loan gate, password forms, AI amount forms. Every new statement fixture is detected as its bank and proven locally. |
| V5.2 | Existing banks unchanged | `npm test`, then `node scripts/fixtures/statements/bench.mjs --local` | The BCA, Jago, GoPay, SeaBank, BRI and blu tests pass unchanged |
| V5.3 | AI gate for the new banks (stage; the owner approves the neurons) | `node scripts/fixtures/statements/stage-bench.mjs` | 100% of amounts and directions, at least 95% of names, 0 invented rows. Record neurons per bank, and flip `beta` only then. |
| V5.4 | Real PDFs (owner's phone; never committed) | Catch Up with the owner's BRI PDF and one Mandiri or BNI PDF | BRI: no "RUBRI" text, and its pages are proven with no AI call. Mandiri or BNI: every date matches the PDF. |
| V5.5 | Password forms | A PDF locked with DDMMYY; type the birth date as `05/10/1990` | Opens on the first prompt |
