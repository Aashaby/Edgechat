CREATE TABLE IF NOT EXISTS telegram_storage_objects (
  object_key TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  file_unique_id TEXT,
  message_id INTEGER NOT NULL,
  chat_id TEXT NOT NULL,
  filename TEXT NOT NULL DEFAULT '',
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_telegram_storage_file_id
  ON telegram_storage_objects(file_id);

CREATE INDEX IF NOT EXISTS idx_telegram_storage_message
  ON telegram_storage_objects(chat_id, message_id);

DROP TRIGGER IF EXISTS prevent_pending_site_icon_insert;
DROP TRIGGER IF EXISTS prevent_pending_site_icon_update;

CREATE TRIGGER prevent_pending_site_icon_insert
BEFORE INSERT ON site_settings
WHEN NEW.setting_key = 'site_icon_url'
  AND NEW.setting_value GLOB 'tg:*'
  AND NOT EXISTS (
    SELECT 1 FROM uploaded_files
    WHERE object_key = substr(NEW.setting_value, 4)
      AND NOT EXISTS (SELECT 1 FROM pending_r2_delete WHERE object_key = uploaded_files.object_key)
  )
BEGIN
  SELECT RAISE(ABORT, 'storage_local_object_unavailable');
END;

CREATE TRIGGER prevent_pending_site_icon_update
BEFORE UPDATE OF setting_value ON site_settings
WHEN NEW.setting_key = 'site_icon_url'
  AND NEW.setting_value GLOB 'tg:*'
  AND NOT EXISTS (
    SELECT 1 FROM uploaded_files
    WHERE object_key = substr(NEW.setting_value, 4)
      AND NOT EXISTS (SELECT 1 FROM pending_r2_delete WHERE object_key = uploaded_files.object_key)
  )
BEGIN
  SELECT RAISE(ABORT, 'storage_local_object_unavailable');
END;
