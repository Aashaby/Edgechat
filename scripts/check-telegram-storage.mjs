import { createTelegramStorageProvider, getTelegramStorageLimits, telegramStorageConfigured } from '../worker/src/storage/telegram.js';

const env = process.env;
if (!telegramStorageConfigured(env)) {
  console.error('Telegram storage is not configured. Set TELEGRAM_STORAGE_BOT_TOKEN, TELEGRAM_STORAGE_CHAT_ID and (when using the proxy) TELEGRAM_STORAGE_PROXY_SECRET.');
  process.exit(2);
}

const provider = createTelegramStorageProvider(env);
const limits = getTelegramStorageLimits(env);
console.log(JSON.stringify({
  configured: true,
  limits,
}, null, 2));

for (const backend of ['telegram-cloud', 'telegram-cloud-proxy', 'telegram-local']) {
  if (backend === 'telegram-local' && !env.TELEGRAM_STORAGE_LOCAL_API_BASE_URL) continue;
  try {
    console.log(JSON.stringify(await provider.health(backend)));
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      backend,
      error: String(error?.message || error),
    }));
  }
}
