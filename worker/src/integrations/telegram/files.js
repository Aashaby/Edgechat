import {
	normalizeContentType,
	safeFilenameExtension,
	sanitizeFilename,
} from "../../attachment-metadata.js";
import { decryptAttachment, encryptAttachment } from "../../encryption.js";
import { downloadTelegramFile, getTelegramFile } from "./client.js";
import { createStorageProvider, resolveStorageBackend, storageProviderConfigured } from "../../storage/provider.js";

export const TELEGRAM_BRIDGE_FILE_LIMIT = 16 * 1024 * 1024;
export const TELEGRAM_FILE_SKIP_REASON = Object.freeze({
	TOO_LARGE: "too_large",
	STORAGE_UNAVAILABLE: "storage_unavailable",
	NOT_FOUND: "not_found",
});
const FILE_RESPONSE_CACHE_CONTROL = "private, no-store";

function telegramObjectKey({ telegramChatId, telegramMessageId, filename }) {
	const extension = safeFilenameExtension(filename);
	return `telegram/${telegramChatId}/${telegramMessageId}-${crypto.randomUUID()}${extension}`;
}

export async function importTelegramAttachment(env, {
	botToken,
	telegramChatId,
	telegramMessageId,
	attachment,
}) {
	if (!attachment) return { attachment: null, skipReason: null };
	if (!storageProviderConfigured(env)) {
		return {
			attachment: null,
			skipReason: TELEGRAM_FILE_SKIP_REASON.STORAGE_UNAVAILABLE,
		};
	}
	if (attachment.fileSize > TELEGRAM_BRIDGE_FILE_LIMIT) {
		return { attachment: null, skipReason: TELEGRAM_FILE_SKIP_REASON.TOO_LARGE };
	}

	const telegramFile = await getTelegramFile(botToken, attachment.fileId);
	const resolvedSize = Number(telegramFile.file_size || attachment.fileSize || 0);
	if (resolvedSize > TELEGRAM_BRIDGE_FILE_LIMIT) {
		return { attachment: null, skipReason: TELEGRAM_FILE_SKIP_REASON.TOO_LARGE };
	}
	const bytes = await downloadTelegramFile(
		botToken,
		telegramFile.file_path,
		TELEGRAM_BRIDGE_FILE_LIMIT,
	);
	const name = sanitizeFilename(attachment.fileName);
	const type = normalizeContentType(attachment.mimeType) || "application/octet-stream";
	const key = telegramObjectKey({ telegramChatId, telegramMessageId, filename: name });
	// 入站 Telegram 文件也先进入 EdgeChat 的 AES-GCM 信封，再写入专用 Telegram 存储频道。
	const encrypted = await encryptAttachment(env, bytes, key);
	const stored = await createStorageProvider(env).put({
		key,
		bytes: encrypted,
		filename: name,
		contentType: type,
		size: encrypted.byteLength,
	});
	await env.DB.prepare(
		`INSERT INTO telegram_storage_objects
		 (object_key, file_id, file_unique_id, message_id, chat_id, filename, content_type, size, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
		 ON CONFLICT(object_key) DO UPDATE SET file_id=excluded.file_id, file_unique_id=excluded.file_unique_id,
		 message_id=excluded.message_id, chat_id=excluded.chat_id, filename=excluded.filename,
		 content_type=excluded.content_type, size=excluded.size`
	).bind(key, stored.fileId, stored.fileUniqueId, stored.messageId, stored.chatId, name, type, bytes.byteLength).run();
	await env.DB.prepare(
		`INSERT INTO telegram_storage_routes (object_key, backend, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
		 ON CONFLICT(object_key) DO UPDATE SET backend=excluded.backend, updated_at=CURRENT_TIMESTAMP`,
	).bind(key, stored.backend || "telegram-cloud").run();
	return {
		attachment: {
			key,
			name,
			type,
			size: bytes.byteLength,
				...(attachment.kind === "voice" || attachment.kind === "audio"
					? {
						kind: attachment.kind,
						durationMs: attachment.durationMs || 0,
						...(attachment.kind === "voice" ? { waveform: [] } : {}),
					}
					: {}),
		},
		skipReason: null,
	};
}

export async function loadEdgeChatAttachment(env, attachment) {
	if (!attachment) {
		return { file: null, skipReason: TELEGRAM_FILE_SKIP_REASON.NOT_FOUND };
	}
	if (Number(attachment.size) > TELEGRAM_BRIDGE_FILE_LIMIT) {
		return { file: null, skipReason: TELEGRAM_FILE_SKIP_REASON.TOO_LARGE };
	}
	if (!storageProviderConfigured(env)) {
		return {
			file: null,
			skipReason: TELEGRAM_FILE_SKIP_REASON.STORAGE_UNAVAILABLE,
		};
	}
	const row = await env.DB.prepare(
		`SELECT file_id FROM telegram_storage_objects WHERE object_key = ? LIMIT 1`
	).bind(String(attachment.key)).first();
	if (!row) return { file: null, skipReason: TELEGRAM_FILE_SKIP_REASON.NOT_FOUND };
	const backend = await resolveStorageBackend(env.DB, attachment.key);
	const object = await createStorageProvider(env).get({ fileId: row.file_id, backend });
	const decrypted = await decryptAttachment(env, await object.arrayBuffer(), attachment.key);
	if (decrypted.bytes.byteLength > TELEGRAM_BRIDGE_FILE_LIMIT) {
		return { file: null, skipReason: TELEGRAM_FILE_SKIP_REASON.TOO_LARGE };
	}
	return {
		file: {
			bytes: decrypted.bytes,
			name: sanitizeFilename(attachment.name),
				type: normalizeContentType(attachment.type) || "application/octet-stream",
				size: decrypted.bytes.byteLength,
				kind: attachment.kind,
				durationMs: Number(attachment.durationMs || 0),
			},
		skipReason: null,
	};
}

export async function deleteImportedTelegramAttachment(env, attachment) {
	if (!attachment?.key) return;
	const row = await env.DB.prepare(
		`SELECT file_id, message_id, chat_id FROM telegram_storage_objects WHERE object_key = ? LIMIT 1`
	).bind(String(attachment.key)).first();
	if (!row) return;
	try {
		const backend = await resolveStorageBackend(env.DB, attachment.key);
	const result = await createStorageProvider(env).delete({ ...row, backend });
		if (!result.deleted && !result.permanent) throw new Error(result.error || "Telegram storage deletion failed");
	} catch (error) {
		console.warn(JSON.stringify({
			message: "telegram orphan attachment delete failed",
			objectKey: attachment.key,
			error: error instanceof Error ? error.message : String(error),
		}));
	}
	await env.DB.prepare(`DELETE FROM telegram_storage_objects WHERE object_key = ?`).bind(String(attachment.key)).run();
}
