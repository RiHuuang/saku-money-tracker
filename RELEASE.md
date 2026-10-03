# Saku production release

## Required account work

1. Put the API behind a custom HTTPS domain you control. Verify that domain in Google Search Console, then use it for the OAuth homepage, Privacy Notice, User Agreement, and account-deletion URL.
2. In Google Auth Platform, complete Branding, Audience, and Data Access. Keep only `openid`, `email`, `profile`, and `drive.file`, publish the app, and submit any requested verification evidence.
3. Create the production Android OAuth client for `id.saku.money` with the SHA-1 shown by Play Console under **App integrity > App signing**. Keep the web OAuth client for the server authorization code exchange.
4. In Play Console, complete App access, Ads, Content rating, Target audience, Data safety, Financial features, and account-deletion declarations. Answers must match the final reviewed Privacy Notice.
5. Enable Play App Signing and keep the upload keystore outside this repository and backed up securely.

Deploy the backend before distributing the new Android build. The API temporarily accepts agreement versions `2026-09-28`, `2026-09-29`, and `2026-10-03` so existing installations can sign in during the rollout; remove older versions after the minimum supported app version has moved to the current agreement.

## Build configuration

Create the ignored `.env.production`:

```dotenv
VITE_SAKU_API_URL=https://api.YOUR_VERIFIED_DOMAIN
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
SAKU_VERSION_CODE=2
SAKU_VERSION_NAME=2.0.0
```

Build and inspect the release:

```powershell
npm ci
npm test
npm audit --omit=dev
npm --prefix server ci
npm --prefix server test
npm --prefix server audit --omit=dev
npm run android:sync
cd android
.\gradlew.bat clean lintRelease testReleaseUnitTest bundleRelease
```

Upload `android/app/build/outputs/bundle/release/app-release.aab` first to Play's internal-testing track. Install the Play-generated build on physical devices; verify Google sign-in, sync, account deletion, widgets, PDF processing, low-storage handling, offline reopening, and upgrade from the previous build.

## Before production rollout

- Obtain legal review for the Privacy Notice and User Agreement served by the API.
- Confirm the privacy, terms, and deletion pages work without authentication on the verified production domain.
- Configure Cloud Billing budgets and alerts, Cloud Run maximum instances, Firestore/Storage quotas, log-based error alerts, and Secret Manager rotation ownership.
- Review IAM so only the Cloud Run service account and named maintainers can access production data.
- Verify Cloud Storage public access prevention and uniform bucket-level access.
- Run Play pre-launch reports and stage rollout rather than releasing to 100 percent immediately.
- Keep a tested rollback artifact and document support response and account-deletion handling.
