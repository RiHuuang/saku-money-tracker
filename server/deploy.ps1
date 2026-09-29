param(
  [string]$ProjectId = "saku-money-tracker",
  [string]$Region = "us-central1",
  [string]$Bucket = "$ProjectId-saku-data",
  [Parameter(Mandatory = $true)][string]$OAuthClientId,
  [Parameter(Mandatory = $true)][Security.SecureString]$OAuthClientSecret,
  [Parameter(Mandatory = $true)][ValidatePattern("^[^@\s]+@[^@\s]+\.[^@\s]+$")][string]$SupportEmail,
  [string]$AllowedOrigins = "https://localhost"
)
$ErrorActionPreference = "Stop"
$ServiceAccount = "saku-api@$ProjectId.iam.gserviceaccount.com"
$Apis = @(
  "run.googleapis.com", "cloudbuild.googleapis.com", "artifactregistry.googleapis.com",
  "firestore.googleapis.com", "storage.googleapis.com", "secretmanager.googleapis.com",
  "sheets.googleapis.com", "drive.googleapis.com"
)

gcloud config set project $ProjectId
gcloud services enable $Apis --project $ProjectId

gcloud storage buckets describe "gs://$Bucket" --project $ProjectId 2>$null
if ($LASTEXITCODE -ne 0) {
  gcloud storage buckets create "gs://$Bucket" --project $ProjectId --location $Region --uniform-bucket-level-access
}
gcloud storage buckets update "gs://$Bucket" --project $ProjectId --uniform-bucket-level-access --public-access-prevention

gcloud firestore databases describe --database="(default)" --project $ProjectId 2>$null
if ($LASTEXITCODE -ne 0) {
  gcloud firestore databases create --database="(default)" --location=nam5 --type=firestore-native --project $ProjectId
}
gcloud firestore databases update --database="(default)" --delete-protection --project $ProjectId --quiet

gcloud iam service-accounts describe $ServiceAccount --project $ProjectId 2>$null
if ($LASTEXITCODE -ne 0) {
  gcloud iam service-accounts create saku-api --display-name="Saku Cloud Run API" --project $ProjectId
}
gcloud projects add-iam-policy-binding $ProjectId --member="serviceAccount:$ServiceAccount" --role="roles/datastore.user" --condition=None | Out-Null
gcloud storage buckets add-iam-policy-binding "gs://$Bucket" --member="serviceAccount:$ServiceAccount" --role="roles/storage.objectAdmin" | Out-Null

function Set-Secret([string]$Name, [string]$Value) {
  gcloud secrets describe $Name --project $ProjectId 2>$null
  if ($LASTEXITCODE -ne 0) { gcloud secrets create $Name --replication-policy=automatic --project $ProjectId }
  $Temp = [IO.Path]::GetTempFileName()
  try {
    [IO.File]::WriteAllText($Temp, $Value, [Text.UTF8Encoding]::new($false))
    gcloud secrets versions add $Name --data-file=$Temp --project $ProjectId
  } finally { Remove-Item -LiteralPath $Temp -Force -ErrorAction SilentlyContinue }
  gcloud secrets add-iam-policy-binding $Name --member="serviceAccount:$ServiceAccount" --role="roles/secretmanager.secretAccessor" --project $ProjectId | Out-Null
}

$SecretText = [Net.NetworkCredential]::new("", $OAuthClientSecret).Password
Set-Secret "saku-google-oauth-client-secret" $SecretText
gcloud secrets describe "saku-token-encryption-key" --project $ProjectId 2>$null
if ($LASTEXITCODE -ne 0) {
  $TokenBytes = [byte[]]::new(32)
  [Security.Cryptography.RandomNumberGenerator]::Fill($TokenBytes)
  Set-Secret "saku-token-encryption-key" ([Convert]::ToBase64String($TokenBytes))
}
gcloud secrets add-iam-policy-binding "saku-token-encryption-key" --member="serviceAccount:$ServiceAccount" --role="roles/secretmanager.secretAccessor" --project $ProjectId | Out-Null

gcloud run deploy saku-api --source . --project $ProjectId --region $Region `
  --service-account $ServiceAccount --allow-unauthenticated --min-instances=0 --max-instances=3 `
  --cpu=1 --memory=512Mi --concurrency=40 --timeout=60 `
  --set-env-vars="GOOGLE_CLOUD_PROJECT=$ProjectId,GOOGLE_OAUTH_CLIENT_ID=$OAuthClientId,SAKU_BUCKET=$Bucket,ALLOWED_ORIGINS=$AllowedOrigins,SUPPORT_EMAIL=$SupportEmail" `
  --set-secrets="GOOGLE_OAUTH_CLIENT_SECRET=saku-google-oauth-client-secret:latest,TOKEN_ENCRYPTION_KEY=saku-token-encryption-key:latest"

gcloud run services describe saku-api --project $ProjectId --region $Region --format="value(status.url)"
