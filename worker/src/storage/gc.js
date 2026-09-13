import { createStorageProvider, resolveStorageBackend } from "./provider.js";

export async function deleteStoredObject(env, key) {
  const row = await env.DB.prepare(
    `SELECT file_id, message_id, chat_id, storage_mode
       FROM telegram_storage_objects
      WHERE object_key = ? LIMIT 1`
  ).bind(String(key)).first();
  if (!row) {
    await env.DB.prepare("DELETE FROM pending_storage_delete WHERE object_key = ?").bind(String(key)).run();
    await env.DB.prepare("DELETE FROM uploaded_files WHERE object_key = ?").bind(String(key)).run();
    return;
  }
  const provider = createStorageProvider(env);
  if (String(row.storage_mode || 'single') === 'chunked') {
    const uploadId = String(row.file_id || '').replace(/^chunked:/, '');
    const parts = await env.DB.prepare(`SELECT file_id, message_id, chat_id, backend FROM telegram_storage_upload_parts WHERE upload_id = ? AND status = 'ready' ORDER BY chunk_index`).bind(uploadId).all();
    for (const part of parts.results || []) {
      const result = await provider.delete(part);
      if (!result.deleted && !result.permanent) throw new Error(result.error || "Telegram chunk deletion failed");
    }
  } else {
    const backend = await resolveStorageBackend(env.DB, key);
    const result = await provider.delete({ ...row, backend });
    if (!result.deleted && !result.permanent) throw new Error(result.error || "Telegram object deletion failed");
  }
  await env.DB.batch([
    env.DB.prepare("DELETE FROM telegram_storage_objects WHERE object_key = ?").bind(String(key)),
    env.DB.prepare("DELETE FROM uploaded_files WHERE object_key = ?").bind(String(key)),
    env.DB.prepare("DELETE FROM pending_storage_delete WHERE object_key = ?").bind(String(key)),
    env.DB.prepare("DELETE FROM telegram_storage_uploads WHERE object_key = ?").bind(String(key)),
  ]);
}
