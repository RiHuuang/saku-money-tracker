CREATE TABLE IF NOT EXISTS users (
  uid TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  snapshot_path TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  access_hash TEXT NOT NULL,
  refresh_hash TEXT NOT NULL,
  access_expires_at INTEGER NOT NULL,
  refresh_expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_uid ON sessions(uid);

CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash TEXT PRIMARY KEY,
  verifier TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_drive_states (
  state_hash TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  verifier TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_logins (
  token_hash TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  transport TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sheet_jobs (
  uid TEXT PRIMARY KEY,
  baseline_path TEXT,
  baseline_revision INTEGER NOT NULL DEFAULT 0,
  target_path TEXT,
  target_revision INTEGER,
  cursor INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS snapshot_uploads (
  id TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  base_revision INTEGER NOT NULL,
  size INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS snapshot_uploads_uid ON snapshot_uploads(uid);

CREATE TABLE IF NOT EXISTS snapshot_upload_parts (
  id TEXT NOT NULL,
  part_index INTEGER NOT NULL,
  size INTEGER NOT NULL,
  PRIMARY KEY(id,part_index)
);
