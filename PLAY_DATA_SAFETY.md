# Play Console data-safety worksheet

Use this as an implementation map, not as legal advice. Recheck every answer against the exact release and Google's current form wording before submission.

## Data Saku handles

| Play data category | Examples in Saku | Collected | Shared | Purpose |
| --- | --- | --- | --- | --- |
| Personal info | Google user ID, email, display name | Yes | No | Account management, authentication |
| Photos | Optional profile photo | Optional | No | App functionality, profile customization |
| Financial info | Accounts, transaction amounts/descriptions, budgets, cards, recurring items; selected statement content in Catch up | Yes when sync or Catch up is enabled | No | App functionality, cloud backup, user-owned Sheet mirror, AI-assisted import |
| App activity | Sync revision and agreement acceptance | Yes | No | Security, account management, app functionality |
| Files and docs | Selected statement text or page images for Catch up | Optional, when the user chooses Cloudflare AI extraction | No | Processed by Cloudflare Workers AI for app functionality; Saku does not retain the source server-side |

Cloudflare (Workers, D1, R2, Workers AI) processes app, sync and optional Catch up data. Google processes sign-in and the user's optional Sheets/Drive mirror. These are service providers, not a sale or advertising transfer. The Google Sheet is created in the signed-in user's own Drive. Confirm this interpretation against Play Console's current definition of “shared.”

## Security and deletion answers

- Data is encrypted in transit with HTTPS.
- Google refresh tokens are encrypted at rest; session secrets are hashed server-side and encrypted with Android Keystore on-device.
- Users can request deletion inside **Settings > Your data stays with you > Delete account**.
- The public deletion resource is `/account-deletion` on the verified production domain.
- Active cloud records are deleted immediately. Storage soft-delete can retain recoverable objects for up to seven days, as disclosed in the Privacy Notice.
- Android backup is disabled. User-created JSON exports are plaintext and controlled by the user.

## Store declarations to review

- Select the financial-features declarations that describe a personal budgeting and expense-tracking tool; Saku does not provide banking, lending, investing, payments, or financial advice.
- Declare Google sign-in instructions under App access if reviewers need a test account or guided access.
- Declare that the app requires account creation and provide both the in-app deletion path and public deletion URL.
- Receipt OCR uses ML Kit on-device. Catch up sends selected statement page text or images to Cloudflare Workers AI when the user opts in; Saku does not retain the source server-side.
- Do not claim compatibility with banks or statement formats that have not passed physical-device testing.
