# Saku 2.4.0 release runbook

The release candidate is PR #65 (`codex/release-candidate`). It contains all 43 checklist PRs and the fixes that only showed up once they were combined. The steps below are in order and each one says how to check it. Merging, the production deploy and the store upload are owner decisions.

## What is already verified

- `npm test` (91 app tests and all Worker suites), `tsc`, `npm run build` and PR CI.
- **Android, unsigned with production assets:**
  - `assemblePlayRelease`, `assembleDirectRelease` and `bundlePlayRelease` build.
  - `lintPlayRelease` and `lintDirectRelease` pass.
  - Release unit tests pass.
  - The Play APK has no `REQUEST_INSTALL_PACKAGES` and the direct APK keeps it.
- **Isolated stage build:** 11/11 instrumented tests on the `Saku_Stage_SQLite_API33` emulator.
- **Stage** (`saku-stage` version `30e89552-a324-4422-a98a-ba74a9be8de1` runs this branch): the Worker regression passes 17/17. It covers device sessions, refresh-token reuse, landing CORS, the agreement version and the auth rate limit.
- **Sync merge and SQLite storage (#62/#63):**
  - Checked on the owner's Xiaomi 15 and on the web against stage.
  - Covers the closed-app widget job, its 409 path, an edit made during upload and account isolation.
  - Covers an interrupted 3,000-row migration and its retry.
- **Indonesian:** a CDP scan of every tab and the main dialogs finds no English text.

## Before merging

1. **Legal (#58):** have the Indonesian Privacy Notice and User Agreement reviewed, and fill in the operator's legal name and address. Don't publish the legal pages before this.
2. **Store art (#56):** review `docs/brand/play-icon-512.png` and `feature-graphic-1024x500.png`.
3. **Phone pass on this build:** install the isolated stage APK on the phone, then check:
   - app lock;
   - the daily reminder at a set time;
   - the launcher, themed and splash icons;
   - Undo after adding a transaction;
   - the Indonesian UI on the device.
4. **Not in this release:** P3-8.1 savings goals and P3-8.2 debts with friends are specs waiting for approval. P4-4 (on-device LiteRT) is owner-locked. P4-3 (retiring the old server) waits on telemetry.

## Release

1. **Merge #65 with a merge commit**, not a squash. A merge commit keeps every PR head as an ancestor, so GitHub closes all 43 PRs as merged.
2. **Stage from `main`:**
   - Build: `VITE_SAKU_API_URL=https://stage.sakumoney.my.id npm run build -- --mode staging`.
   - Deploy: `npx wrangler deploy --config wrangler.stage.jsonc`.
   - Rerun `worker-regression` (or a manual sign-in) and check that `/health`, `/`, `/privacy` and `/privacy?lang=en` return 200.
3. **Production Worker:**
   - Build: `npm run build` (production mode checks the API URL).
   - Deploy: `npx wrangler deploy --config wrangler.jsonc`.
   - The new `AUTH_RATE_LIMITER` binding (namespace `1001`) is in `wrangler.jsonc`.
   - No D1 migration is needed: `import_ai_user_budget` and the `sessions` columns are created on first use.
   - Smoke: `/health` returns 200, Google sign-in redirects with a 302, the security headers are present, and `/privacy` serves Indonesian.
4. **Landing:** `npx wrangler deploy --config wrangler.landing.jsonc`. Then check two things:
   - the download panel shows the version and SHA-256, with no CSP error in the console;
   - the "Data kamu" section and the screenshots render at 390 px and 1280 px.
5. **Android build:**
   - Set the owner's `SAKU_RELEASE_*` signing environment and `SAKU_API_URL=https://app.sakumoney.my.id`.
   - Run `npm run android:sync`, then `npm run android:release`.
   - `android/app/build.gradle` now defaults to versionCode 15 / 2.4.0.
   - Verify the signer SHA-1 is `02:90:A5:5A:B9:24:7C:D1:DA:EA:CE:94:8F:48:BC:26:A8:0D:9F:33`.
6. **Website APK:**
   - Publish the **direct** APK: `node scripts/publish-android-release.mjs --config=wrangler.jsonc --apk=android/app/build/outputs/apk/direct/release/app-direct-release.apk --version-code=15 --version-name=2.4.0 --minimum-build=7 --notes="Bahasa Indonesia|Catch up by day and from bank notifications|Safer sync across devices"`.
   - Check that `/v1/releases/android/latest` reports 15, and that the downloaded APK's size and SHA-256 match.
7. **Play:**
   - Upload `app-play-release.aab` in Play Console.
   - Update the Data safety form from `PLAY_DATA_SAFETY.md` (Catch up AI processing, notification access).
   - Complete any declaration Play asks for about the notification listener.
8. **First install on a phone:** install the direct APK over 2.3.4 without clearing data. The ledger moves from Preferences to SQLite on first open, so confirm the transaction count and balances match before and after.

## Rollback

| Piece | Current production | Roll back with |
| --- | --- | --- |
| App Worker | `89e0c347-ffc3-49a0-80fa-f6c5cda3d11c` | `npx wrangler rollback --config wrangler.jsonc 89e0c347-ffc3-49a0-80fa-f6c5cda3d11c` |
| Landing Worker | `d53b9304-57fc-4f1b-8e02-bfecf99e4b7e` | `npx wrangler rollback --config wrangler.landing.jsonc d53b9304-57fc-4f1b-8e02-bfecf99e4b7e` |
| Stage Worker | `30e89552-…` (candidate); before the candidate `5f09bf2d-3f10-48e3-8d72-e455d2925468` | `npx wrangler rollback --config wrangler.stage.jsonc 5f09bf2d-3f10-48e3-8d72-e455d2925468` |
| Website APK | 2.3.4 / build 14 (`98f67811…` SHA-256) | Republish build 14's APK with the publish script; `latest.json` is written last |

An installed 2.4.0 has already moved its ledger to SQLite and keeps the Preferences copy, so a downgraded 2.3.4 would read the older Preferences copy. **Don't roll an installed app back.** Fix forward with build 16 instead.
