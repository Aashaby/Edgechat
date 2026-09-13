import assert from 'node:assert/strict';
import test from 'node:test';
import { Hono } from 'hono';
import { registerUploadRoutes } from './api/upload.js';
import { encryptAttachment } from './encryption.js';

const keyring = JSON.stringify({
  activeKeyId: 'v1',
  keys: {
    v1: Buffer.from(Uint8Array.from({ length: 32 }, (_, index) => 255 - index)).toString('base64')
  }
});

function fileDb({ accessible, metadata = true, mapping = true }) {
  return {
    prepare(sql) {
      return {
        bind() {
          return {
            async first() {
              if (sql.includes('FROM telegram_storage_objects')) {
                return mapping ? {
                  file_id: 'telegram-file-id',
                  message_id: 7,
                  chat_id: '-100123',
                  filename: 'telegram-photo.jpg',
                  content_type: 'image/jpeg',
                  size: 3
                } : null;
              }
              return null;
            },
            async all() {
              if (sql.includes('SELECT filename, content_type, size')) {
                return metadata
                  ? { results: [{ filename: '报告.bin', content_type: 'application/octet-stream', size: 4 }] }
                  : { results: [] };
              }
              return { results: accessible ? [{ found: 1 }] : [] };
            }
          };
        }
      };
    }
  };
}

const storageEnv = {
  TELEGRAM_STORAGE_BOT_TOKEN: '123456:Test_Token',
  TELEGRAM_STORAGE_CHAT_ID: '-100123',
  TELEGRAM_STORAGE_API_BASE_URL: 'https://api.telegram.org',
  EDGECHAT_ENCRYPTION_KEYRING: keyring
};

function installTelegramFetch(ciphertext) {
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('/bot123456:Test_Token/getFile')) {
      return new Response(JSON.stringify({ ok: true, result: { file_path: 'documents/test.bin' } }), {
        headers: { 'content-type': 'application/json' }
      });
    }
    if (url.includes('/file/bot123456:Test_Token/documents/test.bin')) {
      return new Response(ciphertext, { headers: { 'content-type': 'application/octet-stream' } });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  return () => { globalThis.fetch = original; };
}

test('attachment upload reports when Telegram storage is not configured', async () => {
  const app = new Hono();
  app.use('/api/*', async (c, next) => {
    c.set('session', { userId: 42 });
    return next();
  });
  registerUploadRoutes(app);

  const formData = new FormData();
  formData.set('file', new File(['hello'], 'hello.txt', { type: 'text/plain' }));
  const response = await app.request('https://edgechat.test/api/upload', { method: 'POST', body: formData }, {});

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: '当前部署没有配置 Telegram 文件存储' });
});

test('authorized attachment download decrypts bytes and disables shared caching', async () => {
  const objectKey = '42/example.bin';
  const plaintext = Uint8Array.from([1, 2, 3, 4]);
  const ciphertext = await encryptAttachment(keyring, plaintext, objectKey);
  const restore = installTelegramFetch(ciphertext);
  try {
    const app = new Hono();
    registerUploadRoutes(app);
    const response = await app.request(`https://edgechat.test/files/${objectKey}`, {}, {
      DB: fileDb({ accessible: true }),
      ...storageEnv
    });

    assert.equal(response.status, 200);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), plaintext);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.match(response.headers.get('content-disposition'), /%E6%8A%A5%E5%91%8A\.bin/);
  } finally {
    restore();
  }
});

test('unauthorized attachment download is rejected before reading Telegram storage', async () => {
  let storageRead = false;
  const original = globalThis.fetch;
  globalThis.fetch = async () => { storageRead = true; throw new Error('must not read'); };
  try {
    const app = new Hono();
    registerUploadRoutes(app);
    const response = await app.request('https://edgechat.test/files/42/private.bin', {}, {
      DB: fileDb({ accessible: false }),
      ...storageEnv
    });
    assert.equal(response.status, 403);
    assert.equal(storageRead, false);
  } finally {
    globalThis.fetch = original;
  }
});

test('authorized attachment download reports when Telegram storage is not configured', async () => {
  const app = new Hono();
  registerUploadRoutes(app);
  const response = await app.request('https://edgechat.test/files/42/private.bin', {}, { DB: fileDb({ accessible: true }) });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: '当前部署没有配置 Telegram 文件存储' });
});

test('telegram attachment downloads through message authorization without uploaded file ownership', async () => {
  const objectKey = 'telegram/-1001/9-example.jpg';
  const plaintext = Uint8Array.from([5, 6, 7]);
  const ciphertext = await encryptAttachment(keyring, plaintext, objectKey);
  const restore = installTelegramFetch(ciphertext);
  try {
    const app = new Hono();
    registerUploadRoutes(app);
    const response = await app.request(`https://edgechat.test/files/${encodeURIComponent(objectKey)}`, {}, {
      DB: fileDb({ accessible: true, metadata: false }),
      ...storageEnv
    });
    assert.equal(response.status, 200);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), plaintext);
    assert.equal(response.headers.get('content-type'), 'image/jpeg');
    assert.match(response.headers.get('content-disposition'), /telegram-photo\.jpg/);
  } finally {
    restore();
  }
});
