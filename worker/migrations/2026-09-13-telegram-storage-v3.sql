-- Telegram Storage v3: provider metadata sidecar, optional per-owner deduplication, and R2 queue retirement.
-- The sidecar avoids ALTER TABLE compatibility hazards on installations that already ran an earlier Telegram Storage build.
CREATE TABLE IF NOT EXISTS telegram_storage_routes (
  object_key TEXT PRIMARY KEY,
  backend TEXT NOT NULL DEFAULT 'telegram-cloud',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (object_key) REFERENCES telegram_storage_objects(object_key) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_telegram_storage_routes_backend
  ON telegram_storage_routes(backend, updated_at);

INSERT OR IGNORE INTO telegram_storage_routes (object_key, backend)
SELECT object_key, 'telegram-cloud' FROM telegram_storage_objects;

ALTER TABLE uploaded_files ADD COLUMN content_sha256 TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_uploaded_files_owner_sha256
  ON uploaded_files(owner_user_id, content_sha256)
  WHERE content_sha256 IS NOT NULL;

DROP TRIGGER IF EXISTS prevent_pending_message_attachment_insert;
DROP TRIGGER IF EXISTS prevent_pending_message_attachment_update;
DROP TRIGGER IF EXISTS prevent_pending_user_avatar_insert;
DROP TRIGGER IF EXISTS prevent_pending_user_avatar_update;
DROP TRIGGER IF EXISTS prevent_pending_channel_avatar_insert;
DROP TRIGGER IF EXISTS prevent_pending_channel_avatar_update;
DROP TRIGGER IF EXISTS prevent_pending_site_icon_insert;
DROP TRIGGER IF EXISTS prevent_pending_site_icon_update;

CREATE TRIGGER prevent_pending_message_attachment_insert
BEFORE INSERT ON messages
WHEN NEW.attachment_key IS NOT NULL
  AND (
    (
      NEW.sender_kind = 'local'
      AND NOT EXISTS (
        SELECT 1
        FROM uploaded_files
        WHERE object_key = NEW.attachment_key
          AND owner_user_id = NEW.sender_id
          AND NOT EXISTS (
            SELECT 1 FROM pending_storage_delete
            WHERE pending_storage_delete.object_key = uploaded_files.object_key
          )
      )
    )
    OR (
      NEW.sender_kind = 'external'
      AND EXISTS (
        SELECT 1 FROM pending_storage_delete
        WHERE object_key = NEW.attachment_key
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'storage_local_object_unavailable');
END;

CREATE TRIGGER prevent_pending_message_attachment_update
BEFORE UPDATE OF attachment_key ON messages
WHEN NEW.attachment_key IS NOT NULL
  AND (
    (
      NEW.sender_kind = 'local'
      AND NOT EXISTS (
        SELECT 1
        FROM uploaded_files
        WHERE object_key = NEW.attachment_key
          AND owner_user_id = NEW.sender_id
          AND NOT EXISTS (
            SELECT 1 FROM pending_storage_delete
            WHERE pending_storage_delete.object_key = uploaded_files.object_key
          )
      )
    )
    OR (
      NEW.sender_kind = 'external'
      AND EXISTS (
        SELECT 1 FROM pending_storage_delete
        WHERE object_key = NEW.attachment_key
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'storage_local_object_unavailable');
END;

-- 用户头像继续要求本人上传；群头像的管理权限仍由 API 决定，数据库只仲裁文件生命周期。

CREATE TRIGGER prevent_pending_user_avatar_insert
BEFORE INSERT ON users
WHEN NEW.avatar_key IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM uploaded_files
    WHERE object_key = NEW.avatar_key
      AND owner_user_id = NEW.id
      AND NOT EXISTS (
        SELECT 1 FROM pending_storage_delete
        WHERE pending_storage_delete.object_key = uploaded_files.object_key
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'storage_local_object_unavailable');
END;

CREATE TRIGGER prevent_pending_user_avatar_update
BEFORE UPDATE OF avatar_key ON users
WHEN NEW.avatar_key IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM uploaded_files
    WHERE object_key = NEW.avatar_key
      AND owner_user_id = NEW.id
      AND NOT EXISTS (
        SELECT 1 FROM pending_storage_delete
        WHERE pending_storage_delete.object_key = uploaded_files.object_key
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'storage_local_object_unavailable');
END;

CREATE TRIGGER prevent_pending_channel_avatar_insert
BEFORE INSERT ON channels
WHEN NEW.avatar_key IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM uploaded_files
    WHERE object_key = NEW.avatar_key
      AND NOT EXISTS (
        SELECT 1 FROM pending_storage_delete
        WHERE pending_storage_delete.object_key = uploaded_files.object_key
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'storage_local_object_unavailable');
END;

CREATE TRIGGER prevent_pending_channel_avatar_update
BEFORE UPDATE OF avatar_key ON channels
WHEN NEW.avatar_key IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM uploaded_files
    WHERE object_key = NEW.avatar_key
      AND NOT EXISTS (
        SELECT 1 FROM pending_storage_delete
        WHERE pending_storage_delete.object_key = uploaded_files.object_key
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'storage_local_object_unavailable');
END;

CREATE TRIGGER prevent_pending_site_icon_insert
BEFORE INSERT ON site_settings
WHEN NEW.setting_key = 'site_icon_url'
  AND NEW.setting_value GLOB 'tg:*'
  AND NOT EXISTS (
    SELECT 1
    FROM uploaded_files
    WHERE object_key = substr(NEW.setting_value, 4)
      AND NOT EXISTS (
        SELECT 1 FROM pending_storage_delete
        WHERE pending_storage_delete.object_key = uploaded_files.object_key
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'storage_local_object_unavailable');
END;

CREATE TRIGGER prevent_pending_site_icon_update
BEFORE UPDATE OF setting_value ON site_settings
WHEN NEW.setting_key = 'site_icon_url'
  AND NEW.setting_value GLOB 'tg:*'
  AND NOT EXISTS (
    SELECT 1
    FROM uploaded_files
    WHERE object_key = substr(NEW.setting_value, 4)
      AND NOT EXISTS (
        SELECT 1 FROM pending_storage_delete
        WHERE pending_storage_delete.object_key = uploaded_files.object_key
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'storage_local_object_unavailable');
END;

-- The old queue is now unreachable from all active triggers.
DROP TABLE IF EXISTS pending_r2_delete;
