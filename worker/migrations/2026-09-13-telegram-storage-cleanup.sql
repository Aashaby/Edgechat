-- Storage backend bridge: preserve the historical R2 cleanup queue while introducing the provider-neutral queue.
-- The old table is removed only after v3 has replaced every trigger that referenced it.
CREATE TABLE IF NOT EXISTS pending_storage_delete (
  object_key TEXT PRIMARY KEY,
  retry_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pending_storage_delete_next_retry
  ON pending_storage_delete(next_retry_at, retry_count);

INSERT OR IGNORE INTO pending_storage_delete (object_key, retry_count, next_retry_at, last_error, created_at, updated_at)
SELECT object_key, retry_count, next_retry_at, last_error, created_at, updated_at
FROM pending_r2_delete;
