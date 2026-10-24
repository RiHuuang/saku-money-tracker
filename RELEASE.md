# Saku production release

## Current direct APK release — October 24

Saku 2.3.3 (versionCode 13) fixes Android's `Invalid Saku update metadata` failure. Capacitor represents ordinary APK byte counts as an Android `Integer`, while the updater previously requested only a boxed `Long`; the native validation therefore rejected the 40.1 MB release before opening a network connection. The updater now reads either numeric representation, and a native regression test covers the exact 40,128,200-byte shape that failed on the phone.

Builds 12 and earlier contain the broken native updater and cannot repair that native code through their own prompt. They need one manual install of 2.3.3 from Saku's browser download; build 13 preserves the existing app data and fixes later in-app upgrades.

The Activity filter section is now a single contained toolbar with a clear filter heading, aligned Pocket and Account choice controls, and an anchored result count. Its responsive layout was visually checked in wide dark mode and a true 390 px light-mode frame, while the same semantic surface tokens cover system-resolved appearance. The clean app was deployed to staging as Worker version `5f09bf2d-3f10-48e3-8d72-e455d2925468` and production as Worker version `da376dc2-8ec1-495a-bdf0-4a45ff683c84`.

All 53 application tests and Worker suites passed. Android release lint, release unit tests including the updater regression, and `assembleRelease` passed. The release-signed APK is `output/saku-2.3.3-build13-release.apk`, 40,128,400 bytes, with SHA-256 `973B397760E754C4DFBCE9D1BE30C1CCB572E44DE6FDA64B452D276B424FBDE3`. Its package is `id.saku.money`; APK v2 signature verification passed with signer SHA-1 `02:90:A5:5A:B9:24:7C:D1:DA:EA:CE:94:8F:48:BC:26:A8:0D:9F:33`. The production health endpoint returned successfully, the live manifest reports 2.3.3/build 13, and the versioned production download matched the local byte count and SHA-256 exactly. No release APK was installed during this pass because no Android device was connected.

### Previous 2.3.2 release — October 24

Saku 2.3.2 (versionCode 12) aligns the web app, Android widgets, native quick entry, legal pages, and Indonesian landing page around one readable Saku design system. Light, dark, and system preferences now carry through app surfaces and widget resources; card editing uses the shared dialog pattern; Catch Up follows the app's typography and hierarchy; and narrow mobile layouts no longer push core controls outside the viewport.

The clean build was verified on staging as Worker version `f8fff78c-6bfe-486c-922b-41015674909a`, including a real 390 px viewport pass across Home, Activity, Plans, Catch Up, Settings, legal pages, and the landing page. All 53 application tests passed. Android release lint, release unit tests, and `assembleRelease` passed after the production web assets were synced. The production app and legal pages were deployed as Worker version `2bfc77e9-6069-4f43-9887-d3fc465ba58c`; the landing page was deployed as version `ece38867-8f7a-4646-8f47-531fe40bf26f`. Production Home, health, privacy, terms, landing, and release-manifest requests returned HTTP 200.

The release-signed APK is `output/saku-2.3.2-build12-release.apk`, 40,128,200 bytes, with SHA-256 `665400EAD85538FFE39C6088344E288C5715D29F7866959351A0542D6F3126CC`. Its package is `id.saku.money`; APK v2 signature verification passed with signer SHA-1 `02:90:A5:5A:B9:24:7C:D1:DA:EA:CE:94:8F:48:BC:26:A8:0D:9F:33`. The production versioned download matched the local byte count and SHA-256 exactly, and the live manifest reports 2.3.2/build 12 with minimum supported build 7. No release APK was installed during this pass because no Android device was connected.

### Previous 2.3.1 release — October 23

Saku 2.3.1 (versionCode 11) packages the latest production interface work for Android. It clarifies opening-balance setup with account-specific cards and example-only amounts, hides the balance-adjustment dialog scrollbar while keeping it scrollable, uses the app's sans-serif numerals for balance values, and tones down the Catch Up source cards so file status and account selection are easier to scan.

Pull requests [#11](https://github.com/RiHuuang/saku-money-tracker/pull/11), [#12](https://github.com/RiHuuang/saku-money-tracker/pull/12), and [#13](https://github.com/RiHuuang/saku-money-tracker/pull/13) passed CI and were merged through the staging-first workflow. The final web build was deployed to production as Cloudflare Worker version `c8e8e4c3-e9a6-4b84-9aa7-07c797f25ada`; production Home and `/health` returned HTTP 200, and the served CSS and JavaScript matched the merged build byte-for-byte.

The release-signed APK is `output/saku-2.3.1-build11-release.apk`, 40,353,539 bytes, with SHA-256 `3772695BDD7EB14319B11D59B988E766D7F4206904D3A45A4C7F28AB46A175D5`. Its package is `id.saku.money`; APK v2 signature verification passed with signer SHA-1 `02:90:A5:5A:B9:24:7C:D1:DA:EA:CE:94:8F:48:BC:26:A8:0D:9F:33`. Android release lint, release unit tests, and `assembleRelease` passed from a clean isolated Gradle cache.

### Previous 2.3.0 release — October 22

Saku 2.3.0 (versionCode 10) brings screenshot and PDF Catch Up into the production app and adds auditable account-balance adjustments. A balance correction records the exact delta, date, and required reason while staying out of income and spending totals. The Catch Up source card was also rebuilt into a stable responsive layout with a clear file identity, processing status, account choice, and mixed-account control.

This release followed the staging-first path. The feature was deployed to the isolated `saku-stage` D1 database and `saku-stage-data` R2 bucket as Worker version `388263f9-06c3-4040-899d-da4788bbc1c4`. Google OAuth callbacks for `stage.sakumoney.my.id` were registered and the sign-in flow reached the Google account chooser. An isolated synthetic ledger then verified create, persistence, and deletion of a Rp25.000 balance adjustment at cloud revisions 1 through 3; the staging account and cloud objects were removed afterward. Local browser checks also covered adjustment save, Activity labeling, deletion, the Catch Up image/PDF picker, and the redesigned source card.

Pull request [#9](https://github.com/RiHuuang/saku-money-tracker/pull/9) passed `app-and-worker` CI and was squash-merged into `main` as commit `63f892b3a3e09c52e55d77a8b3beb48d40fd7498`. The merged commit was then rebuilt and published to production as Cloudflare Worker version `1afe704f-2986-46d7-8dcd-2bda101ddc52`. Production health returned `{"ok":true}`, Google sign-in returned a valid 302 to Google's account chooser with the production callback, and the signed release manifest reports 2.3.0/build 10 with minimum supported build 7.

The release-signed APK is `output/saku-2.3.0-build10-release.apk`, 40,352,815 bytes, with SHA-256 `8A970930E4552D8B1DE18EF595A22F8F364E669B5D97CFE67F22334BFC6AC761`. Its package is `id.saku.money`; APK signature verification passed with signer SHA-1 `02:90:A5:5A:B9:24:7C:D1:DA:EA:CE:94:8F:48:BC:26:A8:0D:9F:33`. A complete download from the production versioned route matched the local byte count and SHA-256 exactly. The production web app visibly loaded Catch Up and the corrected source-card layout from the signed-in account without making a ledger write.

All 53 application tests, the production and staging web builds, Android release lint, release unit tests, `assembleRelease`, staging debug lint, debug unit tests, and `assembleDebug` passed. Physical installation of build 10 and the resulting in-app update prompt remain unverified because the Xiaomi phone was disconnected during final release validation.

### Previous 2.2.1 release

Saku 2.2.1 (versionCode 9) fixed update checks after restarting Saku and kept update status available between daily checks. Its production manifest was superseded by build 10 on October 22.

### Previous 2.2.0 release — October 21

Saku 2.2.0 (versionCode 8) adds verified in-app Android updates, the redesigned adaptive choice picker, and corrected Home balance contrast. The app checks the signed production release manifest at most once every 24 hours, offers a three-day reminder for optional releases, shows a metered-network warning, and verifies the downloaded APK's size, SHA-256, package id, version code, and signing certificate before opening Android's installer. Critical releases keep the offline ledger available while requiring an update before cloud sync resumes.

The release-signed APK is `output/saku-2.2.0-build8-release.apk`, 40,350,643 bytes, with SHA-256 `A87C6ACCE54EB7F61E1D76231967C4B61C09E089E57080270CC5DFD4BACE60C0`. APK v2 signature verification passed and its signer SHA-1 is `02:90:A5:5A:B9:24:7C:D1:DA:EA:CE:94:8F:48:BC:26:A8:0D:9F:33`, matching the existing Saku release certificate. Release lint, release unit tests, `assembleRelease`, the web build, all application tests, and all Worker tests passed.

The APK and manifest were published to the private production R2 bucket before production Worker version `b64fb51b-9699-4c69-a58a-6240b9265699` was deployed. The versioned download and `/download/saku.apk` both returned HTTP 200 with the exact byte count; a complete downloaded copy matched the APK SHA-256. The manifest reports 2.2.0/build 8 and minimum supported build 7, so the installed 2.1.2 release could continue syncing during the rollout.

The signed production APK was then installed in place over 2.1.2 on the physical Xiaomi phone. Android preserved the signed-in profile, eight accounts, balances, and the 82-transaction October ledger. A cold launch reached Home with `Synced`; Settings showed `Saku 2.2.0 · build 8`, the updater reported `Up to date`, and Google backup reported `Up to date`. The production Home screen also confirmed the recorded-cash amount and supporting values render in white on the green balance card. No test transaction or other ledger write was made.

### Previous 2.1.2 release

Saku 2.1.2 moves **Record payment** into a dialog and records payments above tracked card debt as card credit, increasing available credit by the full cash payment. The dialog previews the resulting credit and available limit before saving. The signed versionCode 7 APK passed release unit tests, release lint, and `assembleRelease`; it uses the existing release certificate and has SHA-256 `8ABDFA784DC956430881FEBE46F4FBDEA2FAF7C634AD61EBB21C41F2EB55B92B`. A browser check confirmed the production dialog and overpayment preview without submitting a financial transaction.

### Previous 2.1.1 release

Saku 2.1.1 fixes the Android 2.1.0 sign-in/sync failure: the ignored `.env.production` still targeted the frozen Google Cloud API. The production API address is now checked into `.env.production`; Vite rejects another target for a production build, and Gradle rejects another target for a release build. Both the foreground bundle and widget BuildConfig target `https://app.sakumoney.my.id`. The signed versionCode 6 APK was built with the existing release certificate (SHA-1 `02:90:A5:5A:B9:24:7C:D1:DA:EA:CE:94:8F:48:BC:26:A8:0D:9F:33`), and its SHA-256 is `7EE21E6B865ACB1200B7FC796994F3B66FAA67B5F4F5842D5F5B9F68B0A32629`. It was installed over 2.1.0 on the Xiaomi phone without clearing app data; the user signed in and confirmed the status reached `Synced`.

### Previous 2.1.0 release

Saku 2.1.0 (versionCode 5) passed release unit tests, release lint, and `assembleRelease`; its signed APK SHA-256 was `630DE53CBA4FAACDC8D2D98E1C37E45D9E3554188A71BB2EA0348F72E78CA249`. It was installed on the phone and served as the production download, then superseded by 2.1.1 after its stale Android API address caused sign-in and sync to fail.

### Previous 2.0.1 release

`output/saku-app-v4-release-candidate.apk` is versionCode 4 / versionName 2.0.1 and embeds `https://app.sakumoney.my.id` in foreground web assets and native widget BuildConfig. Release unit tests and `assembleRelease` passed with Android Studio JDK 21. APK v2 signature verification passed; its certificate SHA-1 is `02:90:A5:5A:B9:24:7C:D1:DA:EA:CE:94:8F:48:BC:26:A8:0D:9F:33`, matching the registered Android release client. APK SHA-256 is `35F207C1C3B68F2B2ADBA78428383C28EC6E3FB679599BDE745963086E622A95` (40,056,074 bytes).

The APK is installed on the physical Xiaomi phone. Release-app Google sign-in restored the 74-transaction ledger: Activity showed 43 October and 31 September transactions, with seven pockets. Production Cloudflare writes are enabled; the original eight-tab Google Sheet mirror reached `Up to date` and matched the imported ledger. The exact APK was uploaded to private R2 and a full download from `https://app.sakumoney.my.id/download/saku.apk` returned HTTP 200, 40,056,074 bytes, and the same SHA-256. The Indonesian landing page at `https://sakumoney.my.id/` now links to this download and the production web app.

A physical Quick Entry widget on the release app saved a temporary Rp1 expense named `SakuWidgetSyncTest`; production advanced from revision 34 to 35 and the app showed the changed Cash balance and `Up to date` mirror state. The user removed that entry. A later read of the private production backup at revision 48 found no test entry, 81 transactions, seven pockets, and `sheetPending=false`. Relative to the pre-install 74-transaction export, 72 original transaction IDs remained unchanged, two had been removed, and nine new IDs were present. This reflects intervening phone activity and was left untouched. The release-build favorite-widget 15-second cooldown and Undo remain to be verified separately. Website Google login and an outside-test-list account remain unverified. GCP and staging writes remain frozen. Keep the verified recovery archives; after Cloudflare writes began, rollback requires freezing and reconciling Cloudflare first. A portable encrypted signing-key backup remains pending a user-selected destination.

## Historical preparation notes

Historical staging update (October 5, 16:20 UTC): `output/saku-stage-bounded-login-debug.apk`, SHA-256 `F16C41BCA131BAD912C57246DD82DDFFD67279FC6186D2AEAFBD61CC79C3EB9D`, includes the two-request Google login flow and separate Sheets token refresh. Debug unit tests/build passed; installed in place with the current 54-transaction ledger checksum unchanged and matching staging revision 8. A fresh Google sign-in with this APK remains to be tested. Google Console now reports verified branding on workers.dev. The release APK below predates these changes and must be rebuilt before distribution.

The user selected direct APK distribution. A release key now exists outside the repository at `C:\Users\richa\.saku\release-signing\saku-release.jks`, alias `saku-release`. Its password is protected for the current Windows user in `password.dpapi` in the same directory. Retain the key and recover its password into a secure password manager before moving machines; the Windows-protected password file alone is not a portable backup.

Google created **Saku Android Release**, client `213129330817-05dujdug3caecamnbllnc42n7qrtcg64.apps.googleusercontent.com`, for package `id.saku.money` and certificate SHA-1 `02:90:A5:5A:B9:24:7C:D1:DA:EA:CE:94:8F:48:BC:26:A8:0D:9F:33`. The staging release (`versionCode=3`) passed release lint and unit tests; APK v2 signature verification passed. It is saved privately at `output/saku-stage-signed-release.apk`, SHA-256 `042C0A4E8FFC9EF948D3220E4E370F3562D36D53A46824854B6BF2BB6DA27976`. It still targets staging and is not a production download. The installed debug app has not been uninstalled or replaced with this differently signed release.

The `/download/saku.apk` Worker route streams only R2 key `releases/saku.apk`; the bucket remains private. The release APK exceeds Workers' 25 MiB static-asset limit. The route is enabled and its full response checksum has been verified as described above.

The newer debug staging artifact `output/saku-stage-sheet-refresh-debug.apk` includes separate Sheets token-refresh recovery. Its SHA-256 is `67DE540E89D3BC5AFDB84EFB8AEA6713C5FF95FB331C816E7B0ECC95923D34FE`; it passed debug unit tests and was installed without uninstalling the phone app. The phone ledger checksum remained unchanged. Rebuild the signed release with this recovery change before testing or distributing it; the signed staging artifact above predates it.

## Required account work

1. Use the deployed Cloudflare Worker URL for the web app, API, OAuth callback, Privacy Notice, User Agreement, and account-deletion URL. Complete Google's domain verification before public release; if it rejects the shared `workers.dev` host, public launch remains blocked pending a domain decision.
2. In Google Auth Platform, complete Branding, Audience, and Data Access. Keep only `openid`, `email`, `profile`, and `drive.file`, publish the app, and submit any requested verification evidence.
3. Register the production Android OAuth client for `id.saku.money` using the SHA-1 of the certificate that signs the APK users actually install. For a Play release, use **App integrity > App signing**; for direct APK distribution, use the release keystore certificate. Keep the web OAuth client for server code exchange.
4. If using Play, complete App access, Ads, Content rating, Target audience, Data safety, Financial features, and account-deletion declarations. Answers must match the final reviewed Privacy Notice. Enable Play App Signing.
5. Keep the release/upload keystore outside this repository and backed up securely.

Deploy and validate the Worker before distributing the new Android build. The API temporarily accepts agreement versions `2026-09-28`, `2026-09-29`, and `2026-10-03` so existing installations can sign in during the rollout; remove older versions after the minimum supported app version has moved to the current agreement. See [`worker/README.md`](worker/README.md) for export, import, and cutover checks.

## Build configuration

For a **staging debug APK only**, set both API variables to `https://stage.sakumoney.my.id`, run `npm run build -- --mode staging`, then run `node --require ./scripts/os-userinfo.cjs ./node_modules/@capacitor/cli/bin/capacitor sync android` and `:app:assembleDebug` with JDK 21. The default Vite build rejects a staging API, and Gradle rejects staging for release builds. After saving the debug APK, clear both shell variables and run `npm run android:sync` to restore production web assets before any release work. Do not install this debug APK over the release-signed user app.

Create the ignored `.env.production`:

```dotenv
VITE_SAKU_API_URL=https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev
```

Set release secrets only in the current shell or CI secret store:

```powershell
$env:SAKU_RELEASE_KEYSTORE = "C:\secure\saku-upload.jks"
$env:SAKU_RELEASE_KEY_ALIAS = "saku-upload"
$storeSecret = Read-Host "Keystore password" -AsSecureString
$keySecret = Read-Host "Key password" -AsSecureString
$env:SAKU_RELEASE_STORE_PASSWORD = [Net.NetworkCredential]::new("", $storeSecret).Password
$env:SAKU_RELEASE_KEY_PASSWORD = [Net.NetworkCredential]::new("", $keySecret).Password
```

Set monotonically increasing release values in `%USERPROFILE%\.gradle\gradle.properties`, not the repository:

```properties
SAKU_VERSION_CODE=8
SAKU_VERSION_NAME=2.2.0
```

Build and inspect the release:

```powershell
npm ci
npm test
npm audit --omit=dev
npm --prefix server test
npx wrangler deploy --dry-run
npm run android:sync
cd android
.\gradlew.bat clean lintRelease testReleaseUnitTest bundleRelease
```

Upload `android/app/build/outputs/bundle/release/app-release.aab` first to Play's internal-testing track. Install the Play-generated build on physical devices; verify Google sign-in, sync, account deletion, widgets, PDF processing, low-storage handling, offline reopening, and upgrade from the previous build.

If there is no Play listing, build `:app:assembleRelease` with the same signing variables and verify the certificate and checksum of `android/app/build/outputs/apk/release/app-release.apk` before direct distribution. Register that certificate's SHA-1 in the existing Google OAuth project, then test the **distributed APK itself** on a physical device. A newly signed release cannot update an installation signed with the debug key; export the device ledger first, uninstall the debug build only after its backup is verified, and restore the ledger after installing the release. Do not replace a working install or distribute the APK until Cloudflare login, restore, and the Paid-plan cutover checks pass.

## Before production rollout

- Obtain legal review for the Privacy Notice and User Agreement served by the API.
- Confirm the privacy, terms, and deletion pages work without authentication on the verified production domain.
- Monitor Cloudflare Workers Free CPU and request limits, D1 usage, and R2 Standard storage and operation usage. Keep the R2 bucket private.
- Retain the verified GCP recovery export and arrange ownership for OAuth client secret and token encryption key rotation.
- Run Play pre-launch reports and stage rollout rather than releasing to 100 percent immediately.
- Keep a tested rollback artifact and document support response and account-deletion handling.
