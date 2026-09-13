import assert from "node:assert/strict";
import test from "node:test";

import {
  createTelegramStorageProvider,
  getTelegramStorageLimits,
  telegramStorageConfigured,
} from "../worker/src/storage/telegram.js";

function telegramResponse(result, status = 200) {
  return new Response(JSON.stringify({ ok: status < 400, result }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("Telegram Storage v3 validates proxy configuration and exposes provider-neutral limits", () => {
  assert.equal(telegramStorageConfigured({
    TELEGRAM_STORAGE_BOT_TOKEN: "123:ABC_def",
    TELEGRAM_STORAGE_CHAT_ID: "-100123",
    TELEGRAM_STORAGE_API_BASE_URL: "https://proxy.example",
    TELEGRAM_STORAGE_PROXY_SECRET: "secret",
  }), true);
  assert.equal(telegramStorageConfigured({
    TELEGRAM_STORAGE_BOT_TOKEN: "123:ABC_def",
    TELEGRAM_STORAGE_CHAT_ID: "-100123",
    TELEGRAM_STORAGE_API_BASE_URL: "https://proxy.example",
  }), false);
  assert.deepEqual(getTelegramStorageLimits({
    TELEGRAM_STORAGE_LOCAL_MAX_FILE_BYTES: "2000000000",
    TELEGRAM_STORAGE_CLOUD_SAFE_FILE_BYTES: "19000000",
  }), {
    cloudUploadBytes: 50 * 1024 * 1024,
    cloudDownloadBytes: 20 * 1024 * 1024,
    cloudSafeBytes: 19000000,
    localMaxBytes: 2000000000,
    maxBytes: 2000000000,
  });
});

test("provider automatically selects local backend above cloud-safe threshold", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return telegramResponse({
      message_id: 42,
      document: { file_id: "file-42", file_unique_id: "unique-42", file_size: 20_000_000 },
    });
  };

  try {
    const provider = createTelegramStorageProvider({
      TELEGRAM_STORAGE_BOT_TOKEN: "123:ABC_def",
      TELEGRAM_STORAGE_CHAT_ID: "-100123",
      TELEGRAM_STORAGE_API_BASE_URL: "https://proxy.example",
      TELEGRAM_STORAGE_PROXY_SECRET: "secret",
      TELEGRAM_STORAGE_LOCAL_API_BASE_URL: "https://local.example",
      TELEGRAM_STORAGE_LOCAL_MAX_FILE_BYTES: "2000000000",
      TELEGRAM_STORAGE_CLOUD_SAFE_FILE_BYTES: "19000000",
    });

    const result = await provider.put({
      key: "1/big.bin",
      bytes: new Uint8Array([1, 2, 3]),
      filename: "big.bin",
      contentType: "application/octet-stream",
      size: 20_000_000,
    });

    assert.equal(result.backend, "telegram-local");
    assert.equal(calls[0].url, "https://local.example/bot123:ABC_def/sendDocument");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

import { encryptAttachmentChunk, decryptAttachmentChunk } from "../worker/src/encryption.js";

test("chunked attachment encryption authenticates object key and chunk index", async () => {
  const env = {
    EDGECHAT_ENCRYPTION_KEYRING: JSON.stringify({
      activeKeyId: "v1",
      keys: { v1: Buffer.alloc(32, 7).toString("base64") },
    }),
  };
  const plaintext = new TextEncoder().encode("edgechat-chunk".repeat(1024));
  const encrypted = await encryptAttachmentChunk(env, plaintext, "1/example.bin", 4);
  const decrypted = await decryptAttachmentChunk(env, encrypted, "1/example.bin", 4);
  assert.deepEqual(Array.from(decrypted.bytes), Array.from(plaintext));
  await assert.rejects(
    () => decryptAttachmentChunk(env, encrypted, "1/example.bin", 5),
    /chunk index mismatch/,
  );
  await assert.rejects(
    () => decryptAttachmentChunk(env, encrypted, "1/other.bin", 4),
    /chunk authentication failed/,
  );
});
