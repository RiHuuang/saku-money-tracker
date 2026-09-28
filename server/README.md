# Saku Cloud API

The API is a small Cloud Run service for Google registration/sign-in and opt-in ledger sync. It stores:

- `users/{googleSub}` in Firestore: public profile, Sheet IDs, revision, encrypted Google refresh token, and private object paths.
- `sessions/{randomId}` in Firestore: hashes of short-lived access and rotating refresh secrets. Plain session secrets are never stored server-side.
- `ledgers/{googleSub}/...json.gz` in a private Cloud Storage bucket: authoritative, revisioned Saku snapshots.
- `avatars/{googleSub}.webp` in that bucket: the Google profile image resized to 256 x 256, metadata stripped, WebP quality 82.
- `Saku/Saku Money Tracker` in the user's own Drive: a readable mirror with Transactions, Pockets, Accounts, Cards, Recurring, and Quick_entries tabs.

Google passwords never enter Saku. The OAuth client secret and the AES-256 token encryption key are Secret Manager secrets. The Android app requests the non-sensitive `drive.file` scope, so it can access only files it creates or the user explicitly opens with it.

## Configure OAuth

In Google Auth Platform for `saku-money-tracker`:

1. Configure branding, support email, audience, privacy policy, terms, and verified production domains.
2. Add `openid`, `email`, `profile`, and `https://www.googleapis.com/auth/drive.file` under Data Access.
3. Create a **Web application** OAuth client for the backend. Its client ID is compiled into Android; its secret goes only to Secret Manager.
4. Create an **Android** OAuth client for package `id.saku.money` and every trusted signing SHA-1. Use `gradlew.bat signingReport` for the debug certificate; use the Play App Signing SHA-1 for store releases.
5. Keep the app in Testing while developing and add test users. Complete Google verification before a public production release.

## Deploy

Install and authenticate the Google Cloud CLI, then from this directory run:

```powershell
$secret = Read-Host "OAuth web client secret" -AsSecureString
.\deploy.ps1 -OAuthClientId "YOUR_WEB_CLIENT_ID.apps.googleusercontent.com" -OAuthClientSecret $secret
```

The script enables only the required APIs, creates the private US-region bucket and Native-mode Firestore database if absent, creates a least-privilege Cloud Run service account, writes secrets without checking them into source control, and deploys with scale-to-zero. It prints the Cloud Run URL.

The development deployment for project `saku-money-tracker` is live at `https://saku-api-213129330817.us-central1.run.app`; `GET /health` should return `{"ok":true}`.

Create the ignored root `.env.production`:

```dotenv
VITE_SAKU_API_URL=https://YOUR-CLOUD-RUN-URL
```

Create or update `android/gradle.properties` (the OAuth client ID is public configuration, not a client secret):

```properties
SAKU_GOOGLE_WEB_CLIENT_ID=YOUR_WEB_CLIENT_ID.apps.googleusercontent.com
```

Then run `npm run android:sync` and build the signed APK/AAB. Set a billing budget alert and conservative quotas before production. Free Tier is quota-limited, not a hard spending cap.

## Checks

```sh
npm test
npm audit --omit=dev
```

`GET /health` is the unauthenticated readiness endpoint. All other data endpoints use opaque Saku sessions; OAuth codes are one-time, Google refresh tokens are encrypted with AES-256-GCM, snapshots use optimistic revisions, Sheet cells are written with `RAW` input and formula-like strings are escaped.
