const TELEGRAM_DEFAULT_API_BASE = "https://api.telegram.org";
const TOKEN_PATTERN = /^\d+:[A-Za-z0-9_-]+$/;
const FILE_PATH_PATTERN = /^[A-Za-z0-9_./-]+$/;
const DEFAULT_CLOUD_UPLOAD_LIMIT = 50 * 1024 * 1024;
const DEFAULT_CLOUD_DOWNLOAD_LIMIT = 20 * 1024 * 1024;

export class TelegramStorageError extends Error {
  constructor(message, { code = "telegram_storage_error", retryable = false, backend = null } = {}) {
    super(message);
    this.name = "TelegramStorageError";
    this.code = code;
    this.retryable = retryable;
    this.backend = backend;
  }
}

function normalizeBase(value, fallback = TELEGRAM_DEFAULT_API_BASE) {
  const raw = String(value || fallback).trim().replace(/\/+$/, "");
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new TelegramStorageError("Telegram 存储 API 地址无效", { code: "invalid_api_base" });
  }
  if (url.protocol !== "https:") {
    throw new TelegramStorageError("Telegram 存储 API 地址必须使用 HTTPS", { code: "invalid_api_base" });
  }
  return url.toString().replace(/\/$/, "");
}

function token(value) {
  const valueString = String(value || "").trim();
  if (!TOKEN_PATTERN.test(valueString)) {
    throw new TelegramStorageError("Telegram 存储 Bot Token 未配置或格式无效", { code: "storage_not_configured" });
  }
  return valueString;
}

function chatId(value) {
  const result = String(value || "").trim();
  if (!result) throw new TelegramStorageError("Telegram 存储 Chat ID 未配置", { code: "storage_not_configured" });
  return result;
}

function hasProxy(env) {
  const raw = String(env.TELEGRAM_STORAGE_API_BASE_URL || "").trim().replace(/\/+$/, "");
  return Boolean(raw && !/^https:\/\/api\.telegram\.org$/i.test(raw));
}

function proxyHeaders(env, headers = {}) {
  const result = new Headers(headers);
  const secret = String(env.TELEGRAM_STORAGE_PROXY_SECRET || "").trim();
  if (hasProxy(env) && secret) result.set("X-EdgeChat-Proxy-Secret", secret);
  if (hasProxy(env)) result.set("X-EdgeChat-Telegram-Bot-Token", token(env.TELEGRAM_STORAGE_BOT_TOKEN));
  return result;
}

function endpoint(env, backend) {
  if (backend === "telegram-local") {
    return normalizeBase(env.TELEGRAM_STORAGE_LOCAL_API_BASE_URL);
  }
  const configured = String(env.TELEGRAM_STORAGE_API_BASE_URL || "").trim();
  return normalizeBase(configured || TELEGRAM_DEFAULT_API_BASE);
}

function isProxyEndpoint(env, backend) {
  return hasProxy(env) && (backend === "telegram-cloud-proxy" || backend === "telegram-cloud");
}

function selectBackend(env, size = 0) {
  const localBase = String(env.TELEGRAM_STORAGE_LOCAL_API_BASE_URL || "").trim();
  const localMax = Number(env.TELEGRAM_STORAGE_LOCAL_MAX_FILE_BYTES || 0);
  const cloudSafe = Number(env.TELEGRAM_STORAGE_CLOUD_SAFE_FILE_BYTES || DEFAULT_CLOUD_DOWNLOAD_LIMIT - 128 * 1024);
  if (localBase && localMax > 0 && Number(size) > cloudSafe) return "telegram-local";
  if (hasProxy(env)) return "telegram-cloud-proxy";
  return "telegram-cloud";
}

function botApiPath(env, backend, method) {
  if (isProxyEndpoint(env, backend)) return `/bot/${encodeURIComponent(method)}`;
  return `/bot${token(env.TELEGRAM_STORAGE_BOT_TOKEN)}/${method}`;
}

function botFilePath(env, backend, filePath) {
  const safePath = String(filePath || "").replace(/^\/+/, "");
  if (!safePath || safePath.includes("..") || safePath.includes("\\") || !FILE_PATH_PATTERN.test(safePath)) {
    throw new TelegramStorageError("Telegram 文件路径无效", { code: "invalid_file_path" });
  }
  if (isProxyEndpoint(env, backend)) return `/file/${safePath}`;
  return `/file/bot${token(env.TELEGRAM_STORAGE_BOT_TOKEN)}/${safePath}`;
}

async function parseResult(response, backend) {
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) {
    const description = body?.description || `Telegram API 请求失败：${response.status}`;
    throw new TelegramStorageError(description, {
      code: response.status >= 500 ? "upstream_unavailable" : response.status === 429 ? "rate_limited" : "telegram_rejected",
      retryable: response.status >= 500 || response.status === 429,
      backend,
    });
  }
  return body.result;
}

async function apiJson(env, backend, method, payload) {
  const headers = isProxyEndpoint(env, backend)
    ? proxyHeaders(env, { "Content-Type": "application/json" })
    : new Headers({ "Content-Type": "application/json" });
  const response = await fetch(`${endpoint(env, backend)}${botApiPath(env, backend, method)}`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  return parseResult(response, backend);
}

async function apiMultipart(env, backend, method, formData) {
  const headers = isProxyEndpoint(env, backend) ? proxyHeaders(env) : new Headers();
  const response = await fetch(`${endpoint(env, backend)}${botApiPath(env, backend, method)}`, {
    method: "POST",
    headers,
    body: formData,
  });
  return parseResult(response, backend);
}

async function getFileInfo(env, backend, fileId) {
  return apiJson(env, backend, "getFile", { file_id: String(fileId) });
}

async function download(env, backend, filePath) {
  const headers = isProxyEndpoint(env, backend) ? proxyHeaders(env) : new Headers();
  const response = await fetch(`${endpoint(env, backend)}${botFilePath(env, backend, filePath)}`, {
    method: "GET",
    headers,
  });
  if (!response.ok) {
    throw new TelegramStorageError(`Telegram 文件下载失败：${response.status}`, {
      code: response.status >= 500 ? "upstream_unavailable" : response.status === 429 ? "rate_limited" : "download_failed",
      retryable: response.status >= 500 || response.status === 429,
      backend,
    });
  }
  return response;
}

export function telegramStorageConfigured(env) {
  try {
    token(env.TELEGRAM_STORAGE_BOT_TOKEN);
    chatId(env.TELEGRAM_STORAGE_CHAT_ID);
    const proxy = String(env.TELEGRAM_STORAGE_API_BASE_URL || "").trim();
    if (proxy) {
      normalizeBase(proxy);
      if (!String(env.TELEGRAM_STORAGE_PROXY_SECRET || "").trim()) throw new Error("Telegram storage proxy secret is required");
    }
    const local = String(env.TELEGRAM_STORAGE_LOCAL_API_BASE_URL || "").trim();
    if (local) normalizeBase(local);
    return true;
  } catch {
    return false;
  }
}

export function getTelegramStorageLimits(env) {
  const cloudSafe = Math.max(
    1,
    Number(env.TELEGRAM_STORAGE_CLOUD_SAFE_FILE_BYTES || DEFAULT_CLOUD_DOWNLOAD_LIMIT - 128 * 1024),
  );
  const localMax = Math.max(0, Number(env.TELEGRAM_STORAGE_LOCAL_MAX_FILE_BYTES || 0));
  return {
    cloudUploadBytes: DEFAULT_CLOUD_UPLOAD_LIMIT,
    cloudDownloadBytes: DEFAULT_CLOUD_DOWNLOAD_LIMIT,
    cloudSafeBytes: cloudSafe,
    localMaxBytes: localMax,
    maxBytes: localMax > cloudSafe ? localMax : cloudSafe,
  };
}

export function createTelegramStorageProvider(env) {
  const storageChatId = chatId(env.TELEGRAM_STORAGE_CHAT_ID);

  return {
    name: "telegram",

    async put({ key, bytes, filename, contentType, size }) {
      const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      const backend = selectBackend(env, size || data.byteLength);
      const form = new FormData();
      form.set("chat_id", storageChatId);
      form.set("disable_content_type_detection", "true");
      form.set(
        "document",
        new Blob([data], { type: contentType || "application/octet-stream" }),
        filename || "file",
      );
      const result = await apiMultipart(env, backend, "sendDocument", form);
      const document = result?.document;
      if (!document?.file_id || !result?.message_id) {
        throw new TelegramStorageError("Telegram 未返回可用的文件引用", { code: "invalid_upload_response", backend });
      }
      return {
        provider: "telegram",
        backend,
        fileId: String(document.file_id),
        fileUniqueId: document.file_unique_id ? String(document.file_unique_id) : null,
        messageId: Number(result.message_id),
        chatId: storageChatId,
        size: Number(size || document.file_size || data.byteLength || 0),
        filename: String(filename || "file"),
        contentType: String(contentType || "application/octet-stream"),
        key: String(key),
      };
    },

    async get({ fileId, backend = "telegram-cloud" }) {
      let activeBackend = backend;
      let fileInfo;
      try {
        fileInfo = await getFileInfo(env, activeBackend, fileId);
      } catch (error) {
        // A cloud-only file cannot be recovered by message_id through the public Bot API.
        // If it was originally stored on cloud and local is configured, retrying local is useful
        // only for deployments that share the same Telegram Bot API data plane.
        if (activeBackend !== "telegram-local" && String(env.TELEGRAM_STORAGE_LOCAL_API_BASE_URL || "").trim()) {
          activeBackend = "telegram-local";
          fileInfo = await getFileInfo(env, activeBackend, fileId);
        } else {
          throw error;
        }
      }
      return download(env, activeBackend, fileInfo.file_path);
    },

    async delete({ messageId, chatId: objectChatId, backend = "telegram-cloud" }) {
      if (!messageId) return { deleted: true, permanent: false };
      await apiJson(env, backend, "deleteMessage", {
        chat_id: String(objectChatId || storageChatId),
        message_id: Number(messageId),
      });
      return { deleted: true, permanent: false };
    },

    async health(backend = "telegram-cloud") {
      const result = await apiJson(env, backend, "getMe", {});
      return { ok: true, backend, username: result?.username || null };
    },
  };
}

export async function putTelegramObject(env, args) {
  return createTelegramStorageProvider(env).put(args);
}

export async function getTelegramObject(env, fileId, backend = "telegram-cloud") {
  return createTelegramStorageProvider(env).get({ fileId, backend });
}

export async function deleteTelegramObject(env, mapping) {
  return createTelegramStorageProvider(env).delete(mapping);
}

export async function deleteTelegramObjectBestEffort(env, mapping) {
  try {
    return await deleteTelegramObject(env, mapping);
  } catch (error) {
    const message = String(error?.message || error);
    if (/48 hours|message can't be deleted|message to delete not found|message identifier is not specified/i.test(message)) {
      return { deleted: false, permanent: true, error: message };
    }
    throw error;
  }
}
