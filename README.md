# Saku

An offline-first Android money tracker, built with React, TypeScript and Capacitor. Amounts are whole Indonesian rupiah. The installable Android application and the planned Cloudflare-hosted browser app share the same application.

## Run

```sh
npm install
npm run dev
npm test
npm run android:sync
npm run android:open
```

Android requires JDK 21 and Android SDK 36. Build a debug APK in Android Studio, or run `gradlew.bat assembleDebug` from `android` with `JAVA_HOME` and `ANDROID_HOME` set to your installed toolchains. Google Play releases use an AAB and environment-provided signing credentials; see [`RELEASE.md`](RELEASE.md).

The debug APK is `android/app/build/outputs/apk/debug/app-debug.apk`. On a connected Android 12+ arm64 phone, install it with `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`, or open the APK on the phone and permit installation from that source. Saku appears in the app drawer and can be placed on the home screen like any other app. It does not need the computer or dev server after installation. On a fresh install, open **Monthly check** and download the model once while online; afterward PDFs can be processed in airplane mode. Use `npx wrangler dev` with a locally initialized D1 database to test browser login; the standalone Vite server does not provide the API. The browser has no native PDF AI.

## Included

- Transaction create, edit, delete, search, filters, monthly CSV export and full-history CSV export. Saved quick entries prefill frequent transactions; Android also offers a Quick add launcher shortcut.
- Three native Android home-screen widgets: four one-tap favorites with exact Undo, a compact Expense/Income/Transfer entry window, and a cash/spending/pocket snapshot. Favorites and snapshots support per-widget privacy mode.
- Custom pocket names, icons and colors, with a recurring base budget and explicit monthly overrides. Expenses subtract from their pocket; income increases recorded cash.
- Monthly income, expenses, account balances, category breakdown, weekly cash flow, remaining budgets, and overspending warnings.
- CSV and Android-only PDF statement reconciliation for multiple banks/accounts, with explicit review, conservative duplicate handling, and opt-in import of missing transactions.
- Local profile, Google registration/sign-in, revision-checked cloud backup, a private Google Sheets mirror, account management, JSON backup and validated restore. Native storage uses Capacitor Preferences; Saku session secrets use Android Keystore-backed AES-GCM storage.
- Native Android back navigation and the Android share sheet for exports.
- Credit cards with limits, balances, available credit, purchases, installment schedules and payments. Recurring expenses/income can be reviewed and marked paid or charged each month; the recurring list shows annual cost.
- Shared-bill entry records the full bank/card payment and the user's own share, with later friend reimbursements. Android receipt OCR can suggest a total and merchant for review without storing the photo.

The production Android build starts with a short plain-language agreement and requires Google sign-in before setup. New users choose their own accounts, opening balances, pockets, cards, and optional existing installments from editable suggestions; Saku does not save sample financial data. A signed-in user can reopen their own workspace offline. Browser development preview data is isolated from the Android workspace.

## Android widgets

After signing in and saving the initial ledger, long-press an empty area of the Android home screen, choose **Widgets**, then find **Saku**. **Quick Favorites** records one of up to four saved quick entries immediately, even while Saku is closed; its inline Undo removes only that exact widget-created transaction. **Quick Entry** opens a small floating Expense, Income, or Transfer form with live rupiah separators. **Money Snapshot** shows total cash, today, the last seven days, and current pocket budget remaining.

Long-press a Favorites or Snapshot widget and choose its configuration action to change selected favorites or hide amounts. Each widget instance keeps its own choices. Widget writes stay offline, mark the active user's cloud state dirty, and join the next normal foreground sync. Signing out removes all financial values and direct-add actions from the widgets.

## Budget semantics

The total balance includes all recorded transactions through the selected month, across all accounts. Pockets are spending envelopes, not separate bank accounts. Pocket budgets renew monthly without rolling unused allowance forward. A new pocket's amount becomes its recurring default; subsequent edits affect the selected month only. Pocket name, color and icon are shared across months. Deletion is blocked while transactions reference the pocket. Move those transactions first.

"Available" is the smaller of nonnegative recorded cash and the sum of positive pocket remainders. It is not a live bank balance or a guarantee that all planned spending is funded. Overspent pockets remain visible as negative remaining balances. **Unassigned** expenses reduce account cash and count as spending without reducing a pocket. Account transfers are created from **Add transaction** as two linked ledger legs; they move cash between accounts without changing income, expenses, pocket budgets, or total cash. Pocket transfers move budget allocation rather than cash.

Card purchases charge the full personal amount to the pocket on purchase day and the full billed amount to card debt. A later card payment reduces recorded cash and restores card credit, without counting as another expense. A shared expense charges only your share to the pocket but keeps the full payment in cash/card records for statement matching. Friend reimbursements increase cash without counting as income. Scheduled installments show the purchase amount divided across months; the schedule does not automatically assign payments to individual installments. Recurring items remain drafts until explicitly recorded.

## Statement checks

On Android, install the one-time Qwen3 0.6B mixed INT4 model (497,516,544 bytes) in **Monthly check** before selecting PDFs. The app requires Android 12+, arm64, roughly 6 GB RAM, and at least 800 MB free storage for setup. The model is downloaded from the pinned [LiteRT Community revision](https://huggingface.co/litert-community/Qwen3-0.6B/tree/a3c5d805ae362dff7f580bc25f2dfb9a5a7eaa76) and verified with SHA-256 `7900eb4e7362d88c58782c6f9999bb7a129e03544aa98b8f338ea0cc5d8c22c1`. The model stays in private app storage and can be removed from the same screen. Later statement processing works offline.

PDF.js reads selectable text. Pages without usable text are rendered one at a time and passed to bundled ML Kit Latin OCR. Passwords are prompted locally and are not saved. PDF files are limited to 20 MB and 50 pages. Clear bank and credit-card table rows are parsed deterministically; irregular leftovers run through the model in small sequential chunks with a compact context sampled across the complete document. Each suggestion shows its page/source line and editable fields; missing or conflicting evidence is flagged. After comparison, one focused review card at a time can be swiped right to accept or left to decline, with visible equivalent buttons. A final confirmation is required before ledger writes. Recognized opening/closing balances are checked against extracted rows when possible. Malformed model responses cannot write to the ledger. PDF images and drafts remain in memory only for the review session.

CSV files still support per-file accounts, column mapping, Indonesian/English number formats, and explicit date order. Supported dates: ISO YYYY-MM-DD or explicit D/M/YYYY and M/D/YYYY. Debit/credit columns take priority over an amount column. For a single amount column, select a type column or use negative expenses and positive income. Zero, fractional rupiah, invalid dates and invalid numeric grouping are rejected. Repeated same-day, same-account, same-direction, same-amount rows are held for manual review, even if they are legitimate repeat payments. No fuzzy match is auto-approved. Files themselves stay in memory and are not saved.

CSV example:

```csv
date,description,debit,credit
2026-09-01,Salary,,10000000
2026-09-02,Rent,1500000,
```

Banks with proprietary CSV preambles must export or prepare a simple table first. XLSX and image-only files are not supported; scans must be inside PDFs. Browser preview offers CSV only. Card PDFs can be assigned to a card for exact matching, but missing card rows are held for manual entry because installment lines and payments often differ from purchase records. Matching partial statements does not establish that a whole month is reconciled. Printed balance labels and bank layouts vary, so balance checks can be unavailable or require manual inspection.

## Google sign-in and Sheets sync

**Continue with Google** is registration and sign-in on Android and the hosted browser app. Android uses Google Identity Services to obtain a one-time server authorization code; the browser uses Google's redirect flow with PKCE. The Worker validates Google's signed ID token and keys the Saku user by its immutable `sub`. Saku never receives or stores a Google password.

After sign-in, the user can grant `drive.file` separately to create or reconnect a private `Saku` folder and `Saku Money Tracker` spreadsheet in that same Google account. Declining Drive permission does not block Saku login; the cloud backup remains available and the Sheet shows as pending. The permission lets Saku access only Drive files it created or the user explicitly opened with it. The Sheet contains `Transactions`, `Pockets`, `Accounts`, `Cards`, `Recurring`, `Quick_entries`, `Pocket_transfers`, and `Existing_installments` tabs. Formula-like text is escaped before it reaches Sheets.

The Cloudflare migration uses R2 for private ledger snapshots and profile images, and D1 for user/sheet metadata, optimistic sync revision, an AES-256-GCM encrypted Google refresh token, and hashes of Saku session secrets. New backups stream as bounded JSON; imported gzip backups remain readable. Plain Android session tokens remain only in Android Keystore-protected storage; the browser uses secure, HttpOnly cookies. Conflicting revisions fail instead of silently replacing another device's copy. Device data remains usable offline; foreground edits sync immediately, and a network-constrained Android job syncs widget edits while Saku is closed.

The Cloudflare Worker and deployment checklist are in [`worker/README.md`](worker/README.md). The old Cloud Run implementation remains in [`server/`](server/) for the verified data migration. Android builds require the Worker URL in `.env.production`; previously distributed builds still point to Cloud Run until replaced.

## Device verification

The debug build has been installed and smoke-tested on a Xiaomi 15 running Android 16 at `1200x2670`. Earlier tests verified Google session persistence, the 497,516,544-byte PDF model, the combined transfer editor, profile-photo trigger, and swipe review deck. All three launcher widgets were bound and rendered together; Quick Entry formatted `1000000` as `1,000,000`, and all seven Android instrumentation tests passed. The supplied BCA credit-card statement produced 78 distinct candidates with page/source evidence and no validation flags. A later test-runner reinstall cleared device-only state; the Saku Cloud ledger was restored after sign-in, while the PDF model and widget placements must be set up again. The current 2.0 debug build was updated in place, and its native Monthly check PDF layout was visually checked without rerunning instrumentation on the personal phone. This is a development smoke test, not bank certification. Before a public release, broaden testing across other banks, scans, protected PDFs, interrupted downloads, low storage, cancellation, airplane mode, and sustained memory/latency on multiple 6 GB devices.

References checked during development:

- [Capacitor Android environment](https://capacitorjs.com/docs/getting-started/environment-setup)
- [ML Kit on-device text recognition](https://developers.google.com/ml-kit/vision/text-recognition/v2/android)
- [Google AI Edge on-device LLM inference](https://developers.google.com/edge/mediapipe/solutions/genai/llm_inference/android)
- [Google Sheets authorization scopes](https://developers.google.com/workspace/sheets/api/scopes)
- [Google server-side OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)

## Current limits

Single-currency; no automatic recurring posting or app lock yet. Cloud restore replaces the device workspace after confirmation; concurrent cloud writes are blocked by revision, but field-level multi-device merge is not implemented. Manually editing the mirrored Sheet does not write back into Saku. Device storage is application-private, while exported JSON backups are plaintext. Android backup remains disabled. Preferences rewrites the device ledger as one document; migrate to SQLite before large histories. Public release still requires Play App Signing, Play policy completion, legal review of the agreement, Google OAuth production review, and broader hardware/bank compatibility testing.
