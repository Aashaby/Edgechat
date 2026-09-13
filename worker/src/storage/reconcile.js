import { createStorageProvider } from './provider.js';

export async function reconcileStorageMetadata(env) {
  const [missingMapping, orphanMapping, pendingWithoutUpload, incompleteChunked] = await Promise.all([
    env.DB.prepare(`
      SELECT COUNT(*) AS count
      FROM uploaded_files u
      LEFT JOIN telegram_storage_objects t ON t.object_key = u.object_key
      WHERE t.object_key IS NULL
        AND NOT EXISTS (SELECT 1 FROM pending_storage_delete p WHERE p.object_key = u.object_key)
    `).first(),
    env.DB.prepare(`
      SELECT COUNT(*) AS count
      FROM telegram_storage_objects t
      LEFT JOIN uploaded_files u ON u.object_key = t.object_key
      WHERE u.object_key IS NULL
    `).first(),
    env.DB.prepare(`
      SELECT COUNT(*) AS count
      FROM pending_storage_delete p
      LEFT JOIN uploaded_files u ON u.object_key = p.object_key
      WHERE u.object_key IS NULL
    `).first(),
    env.DB.prepare(`
      SELECT COUNT(*) AS count
      FROM telegram_storage_uploads u
      LEFT JOIN telegram_storage_upload_parts p ON p.upload_id = u.upload_id AND p.status = 'ready'
      WHERE u.status = 'completed'
      GROUP BY u.upload_id
      HAVING COUNT(p.chunk_index) <> u.chunk_count
    `).all(),
  ]);

  const provider = createStorageProvider(env);
  const health = {};
  for (const backend of ['telegram-cloud', 'telegram-cloud-proxy', 'telegram-local']) {
    if (backend === 'telegram-local' && !String(env.TELEGRAM_STORAGE_LOCAL_API_BASE_URL || '').trim()) continue;
    try {
      health[backend] = await provider.health(backend);
    } catch (error) {
      health[backend] = {
        ok: false,
        error: String(error?.message || error),
        retryable: Boolean(error?.retryable),
      };
    }
  }

  return {
    ok: Object.values(health).some((item) => item.ok),
    consistency: {
      uploadedFilesWithoutStorageMapping: Number(missingMapping?.count || 0),
      storageMappingsWithoutUploadedFile: Number(orphanMapping?.count || 0),
      pendingDeletesWithoutUploadedFile: Number(pendingWithoutUpload?.count || 0),
      completedChunkedUploadsWithMissingParts: Number((incompleteChunked?.results || []).length),
    },
    health,
  };
}
