import { dispatchAuthInvalid, getStoredToken } from './auth-storage.js';
import { getEdgeChatServerOrigin, resolveServerUrl } from './capacitor-platform.ts';
import { localizedError, localizeErrorMessage } from './localized-error.js';
import { getRuntimeFileUrl, isDemoMode, requestRuntime } from './runtime.js';

function buildHeaders(extra = {}) {
  const headers = { ...extra };
  const token = getStoredToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function request(path, options = {}) {
  if (isDemoMode) {
    try {
      return await requestRuntime(path, options);
    } catch (error) {
      throw localizedError(error);
    }
  }

  const response = await fetch(resolveServerUrl(`/api${path}`), {
    ...options,
    headers: buildHeaders(options.headers),
    body:
      options.body instanceof FormData ||
      options.body instanceof ArrayBuffer ||
      ArrayBuffer.isView(options.body) ||
      (typeof Blob !== 'undefined' && options.body instanceof Blob) ||
      (typeof ReadableStream !== 'undefined' && options.body instanceof ReadableStream) ||
      typeof options.body === 'string'
        ? options.body
        : options.body
          ? JSON.stringify(options.body)
          : undefined
  });

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const rawMessage = payload?.error?.message || payload?.error || payload || 'Request failed';
    const error = new Error(localizeErrorMessage(rawMessage));
    error.status = response.status;
    error.payload = payload;
    error.rawMessage = rawMessage;

    if (response.status === 401 && typeof window !== 'undefined') {
      dispatchAuthInvalid(error.message);
    }

    throw error;
  }

  return payload;
}

export default {
  login(credentials) {
    return request('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: credentials
    });
  },
  logout() {
    return request('/auth/logout', { method: 'POST' });
  },
  session() {
    return request('/auth/session');
  },
  getSite() {
    return request('/site');
  },
  changePassword(payload) {
    return request('/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },
  updateProfile(payload) {
    return request('/me/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },
  getUsers() {
    return request('/users');
  },
  getContacts(options = {}) {
    return request('/contacts', options);
  },
  getUserProfile(userId, options = {}) {
    return request(`/users/${encodeURIComponent(userId)}/profile`, options);
  },
  bootstrap() {
    return request('/bootstrap');
  },
  getChannels() {
    return request('/channels');
  },
  createGroup(payload) {
    return request('/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },
  joinChannel(channelId) {
    return request(`/channels/${channelId}/join`, { method: 'POST' });
  },
  getChannelMembers(channelId) {
    return request(`/channels/${channelId}/members`);
  },
  inviteChannelMembers(channelId, userIds) {
    return request(`/channels/${channelId}/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { userIds }
    });
  },
  removeChannelMember(channelId, userId) {
    return request(`/channels/${channelId}/members/${userId}`, {
      method: 'DELETE'
    });
  },
  deleteOwnedChannel(channelId) {
    return request(`/channels/${channelId}`, {
      method: 'DELETE'
    });
  },
  updateChannel(channelId, payload) {
    return request(`/channels/${channelId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },
  getMessages(kind, roomId, before) {
    const query = new URLSearchParams({ kind, roomId: String(roomId) });
    if (before) {
      query.set('before', String(before));
    }
    return request(`/messages?${query.toString()}`);
  },
  getRecentMessages(kind, roomId, limit = 30) {
    const query = new URLSearchParams({ limit: String(limit) });
    return request(
      `/v1/rooms/${encodeURIComponent(kind)}/${Number(roomId)}/messages?${query.toString()}`
    );
  },
  sendRoomMessage(kind, roomId, payload) {
    return request(`/v1/rooms/${encodeURIComponent(kind)}/${Number(roomId)}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },
  markRoomRead(kind, roomId, messageId) {
    return request('/messages/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        kind,
        roomId,
        ...(messageId ? { messageId } : {})
      }
    });
  },
  openDm(userId) {
    return request('/dm/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { userId }
    });
  },
  listDms() {
    return request('/dm');
  },
  blockUser(userId) {
    return request(`/users/${Number(userId)}/block`, { method: 'PUT' });
  },
  unblockUser(userId) {
    return request(`/users/${Number(userId)}/block`, { method: 'DELETE' });
  },
  async uploadFile(file, { onProgress = null, clientUploadId = null } = {}) {
    const CHUNKED_THRESHOLD = 12 * 1024 * 1024;
    if (!(file instanceof File) || file.size <= CHUNKED_THRESHOLD) {
      const form = new FormData();
      form.append('file', file);
      return request('/upload', { method: 'POST', body: form });
    }
    const resumeKey = `edgechat-upload:${file.name}:${file.size}:${file.lastModified}`;
    let uploadIdHint = clientUploadId || '';
    if (!uploadIdHint && typeof sessionStorage !== 'undefined') uploadIdHint = sessionStorage.getItem(resumeKey) || '';
    if (!uploadIdHint) uploadIdHint = crypto.randomUUID();
    const init = await request('/upload/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        size: file.size,
        filename: file.name,
        contentType: file.type || 'application/octet-stream',
        clientUploadId: uploadIdHint
      }
    });
    if (init.completed) {
      if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(resumeKey);
      return { file: init.file, created: false, deduplicated: true };
    }
    const { uploadId, chunkSize, chunkCount } = init;
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(resumeKey, uploadId);
    let completed = 0;
    try {
      const status = await request(`/upload/${encodeURIComponent(uploadId)}/status`);
      const done = new Set((status.parts || []).filter((part) => part.status === 'ready').map((part) => Number(part.chunk_index)));
      for (let index = 0; index < chunkCount; index += 1) {
        if (done.has(index)) {
          completed += Math.min(chunkSize, file.size - index * chunkSize);
          if (typeof onProgress === 'function') onProgress(completed / file.size);
          continue;
        }
        const start = index * chunkSize;
        const end = Math.min(file.size, start + chunkSize);
        const body = await file.slice(start, end).arrayBuffer();
        await request(`/upload/${encodeURIComponent(uploadId)}/chunks/${index}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/octet-stream' },
          body
        });
        completed += end - start;
        if (typeof onProgress === 'function') onProgress(completed / file.size);
      }
      const result = await request(`/upload/${encodeURIComponent(uploadId)}/complete`, { method: 'POST' });
      if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(resumeKey);
      return result;
    } catch (error) {
      // 保留服务端上传会话以便刷新/网络恢复后继续；仅在明确取消时由调用方删除。
      error.uploadId = uploadId;
      throw error;
    }
  },
  getRoomWebSocketUrl(kind, roomId) {
    const token = getStoredToken();
    const url = new URL(`/api/ws/${kind}/${roomId}`, getEdgeChatServerOrigin());
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('token', token || '');
    return url.toString();
  },
  getInboxWebSocketUrl() {
    const token = getStoredToken();
    const url = new URL('/api/inbox/ws', getEdgeChatServerOrigin());
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('token', token || '');
    return url.toString();
  },
  getFileUrl(keyOrUrl) {
    const raw = String(keyOrUrl || '');
    if (!raw) {
      return '';
    }
    if (isDemoMode) {
      return getRuntimeFileUrl(raw);
    }

    const url = raw.startsWith('/files/')
      ? new URL(resolveServerUrl(raw), getEdgeChatServerOrigin())
      : new URL(resolveServerUrl(`/files/${encodeURIComponent(raw)}`), getEdgeChatServerOrigin());
    const token = getStoredToken();
    if (token) {
      url.searchParams.set('token', token);
    }
    return resolveServerUrl(url.pathname + url.search);
  },
  adminUsers() {
    return request('/admin/users');
  },
  adminOverview() {
    return request('/admin/overview');
  },
  adminMaintenance() {
    return request('/admin/maintenance');
  },
  adminStorageScan(cursor = '') {
    const query = new URLSearchParams();
    if (cursor) {
      query.set('cursor', cursor);
    }
    const suffix = query.size ? `?${query.toString()}` : '';
    return request(`/admin/storage/scan${suffix}`);
  },
  adminSiteSettings() {
    return request('/admin/site-settings');
  },
  adminTelegram() {
    return request('/admin/telegram');
  },
  saveAdminTelegramConfig(payload) {
    return request('/admin/telegram/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },
  createAdminTelegramMapping(payload) {
    return request('/admin/telegram/mappings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },
  updateAdminTelegramMapping(mappingId, payload) {
    return request(`/admin/telegram/mappings/${mappingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },
  deleteAdminTelegramMapping(mappingId) {
    return request(`/admin/telegram/mappings/${mappingId}`, { method: 'DELETE' });
  },
  listAdminRegisterLinks() {
    return request('/admin/register-links');
  },
  createAdminRegisterLink(payload) {
    return request('/admin/register-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },
  revokeAdminRegisterLink(inviteId) {
    return request(`/admin/register-links/${inviteId}`, {
      method: 'DELETE'
    });
  },
  updateAdminSiteSettings(payload) {
    return request('/admin/site-settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },
  createUser(payload) {
    return request('/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },
  updateUser(userId, payload) {
    return request(`/admin/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },
  resetPassword(userId, password) {
    return request(`/admin/users/${userId}/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { password }
    });
  },
  deleteUser(userId) {
    return request(`/admin/users/${userId}`, {
      method: 'DELETE'
    });
  },
  adminChannels() {
    return request('/admin/channels');
  },
  deleteChannel(channelId) {
    return request(`/admin/channels/${channelId}`, {
      method: 'DELETE'
    });
  },
  adminDms() {
    return request('/admin/dms');
  },
  getRegisterInvite(token) {
    return request(`/register-links/${encodeURIComponent(token)}`);
  },
  registerWithInvite(token, payload) {
    return request(`/register-links/${encodeURIComponent(token)}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  }
};
