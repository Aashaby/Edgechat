import {
  TelegramStorageError,
  createTelegramStorageProvider,
  telegramStorageConfigured,
} from './telegram.js';

/**
 * StorageProvider is the boundary used by EdgeChat's attachment lifecycle.
 * The application depends only on the provider-neutral storage contract.
 */
export function createStorageProvider(env) {
  if (!telegramStorageConfigured(env)) {
    throw new TelegramStorageError('当前部署没有配置 Telegram 文件存储', {
      code: 'storage_not_configured',
    });
  }
  return createTelegramStorageProvider(env);
}

export function storageProviderConfigured(env) {
  return telegramStorageConfigured(env);
}

export async function resolveStorageBackend(db, objectKey) {
  try {
    const row = await db.prepare(
      'SELECT backend FROM telegram_storage_routes WHERE object_key = ? LIMIT 1',
    ).bind(String(objectKey)).first();
    return String(row?.backend || 'telegram-cloud');
  } catch {
    // Pre-v3 databases default historical objects to the cloud Bot API.
    return 'telegram-cloud';
  }
}
