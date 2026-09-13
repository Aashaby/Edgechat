import {
  canAccessFile,
  getUploadedFileByClientId,
  getUploadedFileByContentHash,
  getUploadedFileMetadata,
  recordUploadedFile
} from '../data/uploaded-files.js';
import { decryptAttachment, decryptAttachmentChunk, encryptAttachment, encryptAttachmentChunk } from '../encryption.js';
import { normalizeContentType, sanitizeFilename } from '../attachment-metadata.js';
import { validateSession } from '../session.js';
import { errorResponse, requestBodyTooLarge } from '../utils.js';
import { createStorageProvider, resolveStorageBackend, storageProviderConfigured } from '../storage/provider.js';

const FILE_RESPONSE_CACHE_CONTROL = 'private, no-store';
const UPLOAD_BODY_OVERHEAD_BYTES = 512 * 1024;
const TELEGRAM_DOWNLOAD_LIMIT = 20 * 1024 * 1024;
const ENCRYPTION_OVERHEAD = 64;
const DEFAULT_SAFE_FILE_SIZE = TELEGRAM_DOWNLOAD_LIMIT - ENCRYPTION_OVERHEAD - 128 * 1024;
const CHUNK_SIZE = 8 * 1024 * 1024;
const CHUNKED_UPLOAD_THRESHOLD = 12 * 1024 * 1024;
const CHUNK_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CHUNKED_FILE_SIZE = 2 * 1024 * 1024 * 1024;

function configuredMaxFileSize(env) {
  const requested = Number(env.MAX_FILE_SIZE || DEFAULT_SAFE_FILE_SIZE);
  const localMax = Number(env.TELEGRAM_STORAGE_LOCAL_MAX_FILE_BYTES || 0);
  const ceiling = Math.max(DEFAULT_SAFE_FILE_SIZE, Math.min(MAX_CHUNKED_FILE_SIZE, localMax || MAX_CHUNKED_FILE_SIZE));
  return Math.max(1, Math.min(requested, ceiling));
}
function chunkedEnabled(env) {
  return String(env.TELEGRAM_STORAGE_CHUNKED_UPLOADS || 'true').toLowerCase() !== 'false';
}
function chunkCountFor(size) { return Math.ceil(Number(size) / CHUNK_SIZE); }
function uploadExpiresAt() { return new Date(Date.now() + CHUNK_UPLOAD_TTL_MS).toISOString(); }
function validUploadId(value) { return /^[0-9a-f-]{36}$/i.test(String(value || '')); }

async function getTelegramStoredObject(env, db, key) {
  const row = await db.prepare(
    `SELECT file_id, message_id, chat_id, filename, content_type, size, storage_mode, chunk_count
       FROM telegram_storage_objects
      WHERE object_key = ? LIMIT 1`
  ).bind(String(key)).first();
  if (!row) return null;
  const mode = String(row.storage_mode || 'single');
  const backend = await resolveStorageBackend(db, key);
  if (mode !== 'chunked') {
    const response = await createStorageProvider(env).get({ fileId: row.file_id, backend });
    return { response, filename: row.filename, contentType: row.content_type, size: Number(row.size || 0), mode };
  }
  const parts = await db.prepare(
    `SELECT chunk_index, file_id, backend, plaintext_size
       FROM telegram_storage_upload_parts
      WHERE upload_id = ? AND status = 'ready'
      ORDER BY chunk_index ASC`
  ).bind(String(row.file_id).replace(/^chunked:/, '')).all();
  const expected = Number(row.chunk_count || 0);
  if (parts.results.length !== expected) throw new Error('Chunked storage manifest is incomplete');
  const provider = createStorageProvider(env);
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for (const part of parts.results) {
          const response = await provider.get({ fileId: part.file_id, backend: part.backend || backend });
          const encrypted = await response.arrayBuffer();
          const decrypted = await decryptAttachmentChunk(env, encrypted, key, Number(part.chunk_index));
          controller.enqueue(decrypted.bytes);
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    }
  });
  return { response: new Response(stream), filename: row.filename, contentType: row.content_type, size: Number(row.size || 0), mode };
}
async function recordTelegramStorageObject(db, object) {
  await db.prepare(
    `INSERT INTO telegram_storage_objects
      (object_key, file_id, file_unique_id, message_id, chat_id, filename, content_type, size, storage_mode, chunk_count, plaintext_size, encryption_version, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(object_key) DO UPDATE SET
       file_id = excluded.file_id,
       file_unique_id = excluded.file_unique_id,
       message_id = excluded.message_id,
       chat_id = excluded.chat_id,
       filename = excluded.filename,
       content_type = excluded.content_type,
       size = excluded.size`
  ).bind(
    object.key, object.fileId, object.fileUniqueId, object.messageId, object.chatId,
    object.filename, object.contentType, Number(object.size || 0), object.storageMode || 'single', Number(object.chunkCount || 0), Number(object.plaintextSize || object.size || 0), Number(object.encryptionVersion || 1)
  ).run();
  await db.prepare(
    `INSERT INTO telegram_storage_routes (object_key, backend, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(object_key) DO UPDATE SET backend = excluded.backend, updated_at = CURRENT_TIMESTAMP`,
  ).bind(object.key, object.backend || 'telegram-cloud').run();
}

async function deleteTelegramStorageObject(env, key) {
  const row = await env.DB.prepare(
    `SELECT file_id, message_id, chat_id, storage_mode FROM telegram_storage_objects WHERE object_key = ? LIMIT 1`
  ).bind(String(key)).first();
  if (!row) return;
  const provider = createStorageProvider(env);
  const mode = String(row.storage_mode || 'single');
  if (mode === 'chunked') {
    const uploadId = String(row.file_id || '').replace(/^chunked:/, '');
    const parts = await env.DB.prepare(`SELECT file_id, message_id, chat_id, backend FROM telegram_storage_upload_parts WHERE upload_id = ? ORDER BY chunk_index`).bind(uploadId).all();
    for (const part of parts.results || []) {
      if (!part.file_id || String(part.file_id).startsWith('pending:')) continue;
      const result = await provider.delete(part);
      if (!result.deleted && !result.permanent) throw new Error('Telegram chunk deletion failed');
    }
  } else {
    const backend = await resolveStorageBackend(env.DB, key);
    const result = await provider.delete({ ...row, backend });
    if (!result.deleted && !result.permanent) throw new Error('Telegram storage deletion failed');
  }
  await env.DB.batch([
    env.DB.prepare('DELETE FROM telegram_storage_objects WHERE object_key = ?').bind(String(key)),
    env.DB.prepare('DELETE FROM telegram_storage_uploads WHERE object_key = ?').bind(String(key)),
    env.DB.prepare('DELETE FROM uploaded_files WHERE object_key = ?').bind(String(key))
  ]);
}
const BLOCKED_MIME_TYPES = new Set([
  'text/html',
  'application/xhtml+xml',
  'image/svg+xml',
  'text/javascript',
  'application/javascript',
  'text/xml',
  'application/xml'
]);

function isInlineContentType(contentType) {
  if (!contentType) {
    return false;
  }
  if (contentType === 'application/pdf') {
    return true;
  }
  if (contentType.startsWith('image/')) {
    return contentType !== 'image/svg+xml';
  }
	if (contentType.startsWith('video/')) {
		return true;
	}
	if (contentType.startsWith('audio/')) {
		return true;
	}
	return false;
}

function contentDispositionValue(kind, filename) {
  const safeUtf8 = sanitizeFilename(filename);
  const safeAscii = safeUtf8
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/"/g, '')
    .trim()
    .slice(0, 150) || 'file';
  return `${kind}; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(safeUtf8)}`;
}

function validateUpload(env, file) {
  const maxFileSize = configuredMaxFileSize(env);
  if (file.size > maxFileSize) {
    throw new Error(`文件大小不能超过 ${Math.round(maxFileSize / 1024 / 1024)}MB`);
  }

  const contentType = normalizeContentType(file.type);
  if (BLOCKED_MIME_TYPES.has(contentType)) {
    throw new Error('该文件类型不允许上传');
  }

  const allowed = String(env.ALLOWED_FILE_TYPES || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  if (allowed.length && !allowed.some((prefix) => contentType.startsWith(prefix))) {
    throw new Error('该文件类型不允许上传');
  }
}

export function registerUploadRoutes(app) {
  app.post('/api/upload', async (c) => {
    if (!storageProviderConfigured(c.env)) {
      return errorResponse('当前部署没有配置 Telegram 文件存储', 503);
    }

    const session = c.get('session');
    const maxFileSize = configuredMaxFileSize(c.env);
    if (requestBodyTooLarge(c.req.raw, maxFileSize + UPLOAD_BODY_OVERHEAD_BYTES)) {
      return errorResponse(`文件大小不能超过 ${Math.round(maxFileSize / 1024 / 1024)}MB`, 413);
    }
    const formData = await c.req.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return errorResponse('请选择文件');
    }

    try {
      const result = await saveUploadedFile(c.env, session, file);
      return c.json({ file: result.file });
    } catch (error) {
      const message = String(error?.message || '');
      if (message.startsWith('文件大小不能超过') || message === '该文件类型不允许上传' || message === '该文件需要使用分片上传') {
        return errorResponse(message);
      }
      throw error;
    }
  });


  app.post('/api/upload/init', async (c) => {
    const session = c.get('session');
    if (!chunkedEnabled(c.env)) return errorResponse('分片上传已禁用', 409);
    const payload = await c.req.json().catch(() => ({}));
    const size = Number(payload.size);
    const filename = sanitizeFilename(String(payload.filename || 'file'));
    const contentType = normalizeContentType(String(payload.contentType || 'application/octet-stream')) || 'application/octet-stream';
    const clientUploadId = String(payload.clientUploadId || '');
    if (BLOCKED_MIME_TYPES.has(contentType)) return errorResponse('该文件类型不允许上传');
    const allowed = String(c.env.ALLOWED_FILE_TYPES || '').split(',').map((item) => item.trim()).filter(Boolean);
    if (allowed.length && !allowed.some((prefix) => contentType.startsWith(prefix))) return errorResponse('该文件类型不允许上传');
    if (!Number.isSafeInteger(size) || size <= CHUNKED_UPLOAD_THRESHOLD || size > Math.min(configuredMaxFileSize(c.env), MAX_CHUNKED_FILE_SIZE)) {
      return errorResponse('分片上传文件大小无效');
    }
    if (clientUploadId && !validUploadId(clientUploadId)) return errorResponse('clientUploadId 必须是 UUID');
    if (clientUploadId) {
      const completedFile = await getUploadedFileByClientId(c.env.DB, session.userId, clientUploadId);
      if (completedFile) return c.json({ completed: true, file: completedFile, resumed: true });
      const existing = await c.env.DB.prepare(`SELECT upload_id, object_key, filename, content_type, total_size, chunk_size, chunk_count, status, expires_at FROM telegram_storage_uploads WHERE owner_user_id = ? AND client_upload_id = ? LIMIT 1`).bind(session.userId, clientUploadId).first();
      if (existing && ['active','completing'].includes(String(existing.status)) && Date.parse(existing.expires_at) > Date.now()) {
        return c.json({ uploadId: existing.upload_id, key: existing.object_key, chunkSize: Number(existing.chunk_size), chunkCount: Number(existing.chunk_count), expiresAt: existing.expires_at, resumed: true });
      }
    }
    const extension = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')) : '';
    const key = `${session.userId}/${Date.now()}-${crypto.randomUUID()}${extension}`;
    const uploadId = crypto.randomUUID();
    const count = chunkCountFor(size);
    await c.env.DB.prepare(`
      INSERT INTO telegram_storage_uploads
      (upload_id, owner_user_id, object_key, filename, content_type, total_size, chunk_size, chunk_count, client_upload_id, status, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
    `).bind(uploadId, session.userId, key, filename, contentType, size, CHUNK_SIZE, count, clientUploadId || null, uploadExpiresAt()).run();
    return c.json({ uploadId, key, chunkSize: CHUNK_SIZE, chunkCount: count, expiresAt: uploadExpiresAt() });
  });

  app.get('/api/upload/:uploadId/status', async (c) => {
    const session = c.get('session');
    const uploadId = String(c.req.param('uploadId') || '');
    if (!validUploadId(uploadId)) return errorResponse('uploadId 无效', 400);
    const row = await c.env.DB.prepare(`SELECT upload_id, object_key, filename, content_type, total_size, chunk_size, chunk_count, status, expires_at FROM telegram_storage_uploads WHERE upload_id = ? AND owner_user_id = ? LIMIT 1`).bind(uploadId, session.userId).first();
    if (!row) return errorResponse('分片上传不存在', 404);
    const parts = await c.env.DB.prepare(`SELECT chunk_index, plaintext_size, status FROM telegram_storage_upload_parts WHERE upload_id = ? ORDER BY chunk_index`).bind(uploadId).all();
    return c.json({ upload: row, parts: parts.results || [] });
  });

  app.put('/api/upload/:uploadId/chunks/:index', async (c) => {
    const session = c.get('session');
    const uploadId = String(c.req.param('uploadId') || '');
    const index = Number(c.req.param('index'));
    if (!validUploadId(uploadId) || !Number.isInteger(index) || index < 0) return errorResponse('分片参数无效', 400);
    const upload = await c.env.DB.prepare(`SELECT * FROM telegram_storage_uploads WHERE upload_id = ? AND owner_user_id = ? LIMIT 1`).bind(uploadId, session.userId).first();
    if (!upload) return errorResponse('分片上传不存在', 404);
    if (String(upload.status) !== 'active') return errorResponse('分片上传已结束', 409);
    if (Date.parse(upload.expires_at) <= Date.now()) return errorResponse('分片上传已过期', 410);
    if (index >= Number(upload.chunk_count)) return errorResponse('分片序号超出范围', 400);
    const bytes = new Uint8Array(await c.req.raw.arrayBuffer());
    const expectedSize = index === Number(upload.chunk_count) - 1
      ? Number(upload.total_size) - Number(upload.chunk_size) * index
      : Number(upload.chunk_size);
    if (bytes.byteLength !== expectedSize) return errorResponse('分片大小不正确', 400);

    const existing = await c.env.DB.prepare(`SELECT file_id, chunk_index, plaintext_size, status FROM telegram_storage_upload_parts WHERE upload_id = ? AND chunk_index = ? LIMIT 1`).bind(uploadId, index).first();
    if (existing?.status === 'ready') return c.json({ ok: true, chunkIndex: index, uploaded: true, size: Number(existing.plaintext_size) });
    if (existing?.status === 'uploading') return errorResponse('该分片正在上传，请稍后重试', 409);

    const reservationId = `pending:${crypto.randomUUID()}`;
    await c.env.DB.prepare(`INSERT INTO telegram_storage_upload_parts (upload_id, chunk_index, file_id, message_id, chat_id, backend, plaintext_size, ciphertext_size, status, updated_at) VALUES (?, ?, ?, 0, ?, 'telegram-cloud', ?, 0, 'uploading', CURRENT_TIMESTAMP) ON CONFLICT(upload_id, chunk_index) DO UPDATE SET file_id = excluded.file_id, message_id = 0, plaintext_size = excluded.plaintext_size, ciphertext_size = 0, status = 'uploading', updated_at = CURRENT_TIMESTAMP`).bind(uploadId, index, reservationId, String(c.env.TELEGRAM_STORAGE_CHAT_ID), bytes.byteLength).run();
    try {
      const encrypted = await encryptAttachmentChunk(c.env, bytes, upload.object_key, index);
      const stored = await createStorageProvider(c.env).put({
        key: `${upload.object_key}.part.${index}`,
        bytes: encrypted,
        filename: `${uploadId}.${String(index).padStart(8, '0')}.part`,
        contentType: 'application/octet-stream',
        size: encrypted.byteLength
      });
      await c.env.DB.prepare(`UPDATE telegram_storage_upload_parts SET file_id = ?, file_unique_id = ?, message_id = ?, chat_id = ?, backend = ?, ciphertext_size = ?, chunk_sha256 = ?, status = 'ready', updated_at = CURRENT_TIMESTAMP WHERE upload_id = ? AND chunk_index = ? AND file_id = ?`).bind(stored.fileId, stored.fileUniqueId, stored.messageId, stored.chatId, stored.backend, encrypted.byteLength, Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join(''), uploadId, index, reservationId).run();
      return c.json({ ok: true, chunkIndex: index, uploaded: true, size: bytes.byteLength, fileId: stored.fileId });
    } catch (error) {
      await c.env.DB.prepare(`DELETE FROM telegram_storage_upload_parts WHERE upload_id = ? AND chunk_index = ? AND file_id = ?`).bind(uploadId, index, reservationId).run();
      throw error;
    }
  });

  app.post('/api/upload/:uploadId/complete', async (c) => {
    const session = c.get('session');
    const uploadId = String(c.req.param('uploadId') || '');
    if (!validUploadId(uploadId)) return errorResponse('uploadId 无效', 400);
    const upload = await c.env.DB.prepare(`SELECT * FROM telegram_storage_uploads WHERE upload_id = ? AND owner_user_id = ? LIMIT 1`).bind(uploadId, session.userId).first();
    if (!upload) return errorResponse('分片上传不存在', 404);
    if (String(upload.status) === 'completed') {
      const existing = await getUploadedFileMetadata(c.env.DB, upload.object_key);
      return c.json({ file: { key: upload.object_key, name: existing?.filename || upload.filename, type: existing?.contentType || upload.content_type, size: Number(existing?.size || upload.total_size), url: `/files/${encodeURIComponent(upload.object_key)}` }, created: false });
    }
    if (Date.parse(upload.expires_at) <= Date.now()) return errorResponse('分片上传已过期', 410);
    const parts = await c.env.DB.prepare(`SELECT * FROM telegram_storage_upload_parts WHERE upload_id = ? AND status = 'ready' ORDER BY chunk_index`).bind(uploadId).all();
    if ((parts.results || []).length !== Number(upload.chunk_count)) return errorResponse('仍有分片未上传', 409);
    const sum = (parts.results || []).reduce((n, p) => n + Number(p.plaintext_size || 0), 0);
    if (sum !== Number(upload.total_size)) return errorResponse('分片总大小校验失败', 409);
    await c.env.DB.prepare(`UPDATE telegram_storage_uploads SET status = 'completing', updated_at = CURRENT_TIMESTAMP WHERE upload_id = ? AND status = 'active'`).bind(uploadId).run();
    const syntheticFileId = `chunked:${uploadId}`;
    try {
      await recordTelegramStorageObject(c.env.DB, {
        key: upload.object_key,
        fileId: syntheticFileId,
        fileUniqueId: null,
        messageId: 0,
        chatId: String(c.env.TELEGRAM_STORAGE_CHAT_ID),
        filename: upload.filename,
        contentType: upload.content_type,
        size: upload.total_size,
        backend: 'telegram-cloud',
        storageMode: 'chunked',
        chunkCount: upload.chunk_count,
        plaintextSize: upload.total_size,
        encryptionVersion: 2
      });
      await recordUploadedFile(c.env.DB, {
        key: upload.object_key,
        ownerUserId: session.userId,
        filename: upload.filename,
        contentType: upload.content_type,
        size: upload.total_size,
        clientUploadId: null,
        contentSha256: null
      });
      await c.env.DB.prepare(`UPDATE telegram_storage_uploads SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE upload_id = ?`).bind(uploadId).run();
      return c.json({ file: { key: upload.object_key, name: upload.filename, type: upload.content_type, size: Number(upload.total_size), url: `/files/${encodeURIComponent(upload.object_key)}` }, created: true, chunked: true });
    } catch (error) {
      await c.env.DB.prepare(`UPDATE telegram_storage_uploads SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE upload_id = ?`).bind(uploadId).run();
      throw error;
    }
  });

  app.delete('/api/upload/:uploadId', async (c) => {
    const session = c.get('session');
    const uploadId = String(c.req.param('uploadId') || '');
    if (!validUploadId(uploadId)) return errorResponse('uploadId 无效', 400);
    const upload = await c.env.DB.prepare(`SELECT * FROM telegram_storage_uploads WHERE upload_id = ? AND owner_user_id = ? LIMIT 1`).bind(uploadId, session.userId).first();
    if (!upload) return errorResponse('分片上传不存在', 404);
    const parts = await c.env.DB.prepare(`SELECT file_id, message_id, chat_id, backend FROM telegram_storage_upload_parts WHERE upload_id = ? AND status = 'ready'`).bind(uploadId).all();
    const provider = createStorageProvider(c.env);
    for (const part of parts.results || []) {
      const result = await provider.delete(part);
      if (!result.deleted && !result.permanent) throw new Error('Telegram chunk deletion failed');
    }
    await c.env.DB.prepare(`DELETE FROM telegram_storage_uploads WHERE upload_id = ?`).bind(uploadId).run();
    return c.json({ ok: true });
  });

  app.get('/files/:key{.+}', async (c) => {
    const key = decodeURIComponent(c.req.param('key'));
    const authorization = c.req.header('authorization') || '';
    const token = authorization.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length).trim()
      : new URL(c.req.url).searchParams.get('token') || '';
    const auth = token ? await validateSession(c.env, token) : null;
    const canRead = await canAccessFile(c.env.DB, key, auth?.ok ? auth.session.userId : null);
    if (!canRead) {
      return new Response('Forbidden', { status: 403 });
    }
    if (!storageProviderConfigured(c.env)) {
      return errorResponse('当前部署没有配置 Telegram 文件存储', 503);
    }

    const [object, fileMetadata] = await Promise.all([
      getTelegramStoredObject(c.env, c.env.DB, key),
      getUploadedFileMetadata(c.env.DB, key)
    ]);
    if (!object) {
      return new Response('Not Found', { status: 404 });
    }

    let body;
    try {
      if (object.mode === 'chunked') {
        body = object.response.body;
      } else {
        const decrypted = await decryptAttachment(c.env, await object.response.arrayBuffer(), key);
        body = decrypted.bytes;
      }
    } catch (error) {
      console.error('Failed to decrypt attachment', { key, error });
      throw error;
    }

    const headers = new Headers();
    headers.set('cache-control', FILE_RESPONSE_CACHE_CONTROL);

    headers.set('x-content-type-options', 'nosniff');
    headers.set('referrer-policy', 'no-referrer');
    headers.set(
      'content-security-policy',
      "sandbox; default-src 'none'; base-uri 'none'; form-action 'none'"
    );

    const contentType =
      normalizeContentType(fileMetadata?.contentType) ||
      normalizeContentType(object.contentType) ||
      normalizeContentType(headers.get('content-type')) ||
      'application/octet-stream';
    headers.set('content-type', contentType);
    const inlineAllowed = isInlineContentType(contentType);
    const dispositionKind =
      inlineAllowed && !contentType.startsWith('text/') ? 'inline' : 'attachment';
    const filename =
      fileMetadata?.filename || object.filename || key.split('/').pop() || 'file';
    headers.set('content-disposition', contentDispositionValue(dispositionKind, filename));

    if (object.mode === 'chunked') headers.set('content-length', String(object.size));
    return new Response(body, { headers });
  });
}

export async function saveUploadedFile(env, session, file, { clientUploadId = null } = {}) {
  validateUpload(env, file);
  if (file.size > CHUNKED_UPLOAD_THRESHOLD) {
    throw new Error('该文件需要使用分片上传');
  }
  if (clientUploadId) {
    const existing = await getUploadedFileByClientId(env.DB, session.userId, clientUploadId);
    if (existing) return { file: existing, created: false };
  }

  const dedupEnabled = String(env.TELEGRAM_STORAGE_DEDUP || 'true').toLowerCase() !== 'false';
  const plaintext = await file.arrayBuffer();
  const contentSha256 = dedupEnabled
    ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', plaintext)), (byte) => byte.toString(16).padStart(2, '0')).join('')
    : null;
  if (contentSha256) {
    const existing = await getUploadedFileByContentHash(env.DB, session.userId, contentSha256);
    if (existing) return { file: existing, created: false, deduplicated: true };
  }

  const extension = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '';
  const key = `${session.userId}/${Date.now()}-${crypto.randomUUID()}${extension}`;
  const filename = sanitizeFilename(file.name);
  const contentType = normalizeContentType(file.type) || 'application/octet-stream';
  const encryptedFile = await encryptAttachment(env, plaintext, key);
  const telegramObject = await createStorageProvider(env).put({
    key,
    bytes: encryptedFile,
    filename,
    contentType,
    size: encryptedFile.byteLength
  });

  try {
    await recordTelegramStorageObject(env.DB, telegramObject);
    await recordUploadedFile(env.DB, {
      key,
      ownerUserId: session.userId,
      filename,
      contentType,
      size: file.size,
      clientUploadId,
      contentSha256
    });
  } catch (error) {
    // 元数据失败时尽力删除 Telegram 中刚写入的存储消息，避免形成可见孤儿。
    try {
      await deleteTelegramStorageObject(env, key);
    } catch (deleteError) {
      console.warn('Failed to delete orphaned Telegram upload after metadata error', deleteError);
    }
    if (clientUploadId && String(error?.message || error).includes('UNIQUE')) {
      const existing = await getUploadedFileByClientId(env.DB, session.userId, clientUploadId);
      if (existing) return { file: existing, created: false };
    }
    throw error;
  }

  return {
    created: true,
    file: {
      key,
      name: filename,
      type: contentType,
      size: file.size,
      url: `/files/${encodeURIComponent(key)}`
    }
  };
}
