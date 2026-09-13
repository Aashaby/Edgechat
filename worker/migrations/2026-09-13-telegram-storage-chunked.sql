-- Resumable Telegram chunked attachment storage.
ALTER TABLE telegram_storage_objects ADD COLUMN storage_mode TEXT NOT NULL DEFAULT 'single';
ALTER TABLE telegram_storage_objects ADD COLUMN chunk_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE telegram_storage_objects ADD COLUMN plaintext_size INTEGER NOT NULL DEFAULT 0;
ALTER TABLE telegram_storage_objects ADD COLUMN encryption_version INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS telegram_storage_uploads (
  upload_id TEXT PRIMARY KEY,
  owner_user_id INTEGER NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL DEFAULT '',
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  total_size INTEGER NOT NULL,
  chunk_size INTEGER NOT NULL,
  chunk_count INTEGER NOT NULL,
  content_sha256 TEXT,
  client_upload_id TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completing','completed','aborted','expired')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_telegram_storage_uploads_owner_status
  ON telegram_storage_uploads(owner_user_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_telegram_storage_uploads_expiry
  ON telegram_storage_uploads(status, expires_at);

CREATE TABLE IF NOT EXISTS telegram_storage_upload_parts (
  upload_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  file_id TEXT NOT NULL,
  file_unique_id TEXT,
  message_id INTEGER NOT NULL,
  chat_id TEXT NOT NULL,
  backend TEXT NOT NULL DEFAULT 'telegram-cloud',
  plaintext_size INTEGER NOT NULL,
  ciphertext_size INTEGER NOT NULL,
  chunk_sha256 TEXT,
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('uploading','ready','failed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (upload_id, chunk_index),
  UNIQUE (file_id),
  FOREIGN KEY (upload_id) REFERENCES telegram_storage_uploads(upload_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_telegram_storage_upload_parts_upload_status
  ON telegram_storage_upload_parts(upload_id, status, chunk_index);
CREATE INDEX IF NOT EXISTS idx_telegram_storage_upload_parts_message
  ON telegram_storage_upload_parts(chat_id, message_id);

CREATE INDEX IF NOT EXISTS idx_telegram_storage_objects_mode
  ON telegram_storage_objects(storage_mode, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_telegram_storage_uploads_owner_client
  ON telegram_storage_uploads(owner_user_id, client_upload_id) WHERE client_upload_id IS NOT NULL;
