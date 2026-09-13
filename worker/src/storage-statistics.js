const USER_OBJECT_KEY_PATTERN = /^(\d+)\//;

export function storageOwnerFromObjectKey(key) {
	const normalizedKey = String(key || "");
	const userMatch = USER_OBJECT_KEY_PATTERN.exec(normalizedKey);
	if (userMatch) {
		const userId = Number(userMatch[1]);
		if (Number.isSafeInteger(userId) && userId > 0) {
			return { key: `user:${userId}`, type: "user", userId };
		}
	}

	if (normalizedKey.startsWith("telegram/")) {
		return { key: "system:telegram", type: "telegram", userId: null };
	}

	return { key: "system:unknown", type: "unknown", userId: null };
}

export function summarizeStorageObjects(objects = []) {
	const summaries = new Map();

	for (const object of objects) {
		const owner = storageOwnerFromObjectKey(object?.key);
		const current = summaries.get(owner.key) || {
			ownerKey: owner.key,
			ownerType: owner.type,
			ownerId: owner.userId,
			objectCount: 0,
			bytes: 0,
			latestUploadedAt: null,
		};
		const uploadedAt = object?.uploaded ? new Date(object.uploaded) : null;

		current.objectCount += 1;
		current.bytes += Math.max(0, Number(object?.size) || 0);
		if (
			uploadedAt &&
			!Number.isNaN(uploadedAt.getTime()) &&
			(!current.latestUploadedAt || uploadedAt > new Date(current.latestUploadedAt))
		) {
			current.latestUploadedAt = uploadedAt.toISOString();
		}

		summaries.set(owner.key, current);
	}

	return [...summaries.values()];
}


export async function summarizeTelegramStorage(db, requestUrl) {
  const url = new URL(requestUrl);
  const cursor = Math.max(0, Number(url.searchParams.get("cursor") || 0) || 0);
  const pageSize = 1000;
  const { results } = await db.prepare(
    `SELECT object_key, size, created_at
       FROM uploaded_files
      ORDER BY object_key ASC
      LIMIT ? OFFSET ?`
  ).bind(pageSize, cursor).all();
  const items = new Map();
  for (const row of results) {
    const owner = storageOwnerFromObjectKey(row.object_key);
    const current = items.get(owner.key) || { ownerKey: owner.key, ownerType: owner.type, ownerId: owner.userId, objectCount: 0, bytes: 0, latestUploadedAt: null };
    current.objectCount += 1;
    current.bytes += Math.max(0, Number(row.size) || 0);
    if (!current.latestUploadedAt || String(row.created_at) > current.latestUploadedAt) current.latestUploadedAt = String(row.created_at);
    items.set(owner.key, current);
  }
  return {
    items: [...items.values()],
    scannedObjects: results.length,
    truncated: results.length === pageSize,
    cursor: results.length === pageSize ? cursor + results.length : null,
    ...(cursor === 0 ? { users: await import('./data/users.js').then(({ listStorageOwners }) => listStorageOwners(db)) } : {})
  };
}

