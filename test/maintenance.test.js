import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { registerMaintenanceRoutes } from "../worker/src/api/maintenance.ts";
import { durableObjectHealth } from "../worker/src/maintenance/do-health.ts";
import { inspectEnvironment, runSystemCheck } from "../worker/src/maintenance/system-check.ts";
import { ChannelRoom } from "../worker/src/do/ChannelRoom.js";
import { UserInbox } from "../worker/src/do/UserInbox.js";
import { Scheduler } from "../worker/src/do/Scheduler.js";
import { authMiddleware, adminMiddleware } from "../worker/src/middleware.js";

const okDb = { prepare: () => ({ all: async () => ({ results: [{ ok: 1 }] }) }) };
const ns = (response = { ok: true, service: "ChannelRoom" }) => ({ idFromName: () => "health", get: () => ({ fetch: async () => Response.json(response) }) });

test("environment exposes presence only, never secret values", () => {
  const result = inspectEnvironment({ EDGECHAT_ENCRYPTION_KEYRING: "super-secret", ADMIN_USERNAMES: "admin" });
  assert.equal(JSON.stringify(result).includes("super-secret"), false);
  assert.equal(result.find((x) => x.required).present, true);
});

test("system check isolates errors, timeouts, optional R2, and missing bindings", async () => {
  const result = await runSystemCheck({ DB: okDb, SESSIONS: { get: async () => { throw new Error("token leak"); } }, FILES: { list: async () => [] }, CHANNEL_ROOM: ns(), USER_INBOX: ns({ ok: false, service: "UserInbox" }) }, { timeoutMs: 10 });
  assert.equal(result.checks.find((x) => x.id === "sessions").code, "request_failed");
  assert.equal(result.checks.find((x) => x.id === "userInbox").code, "unexpected_response");
  assert.equal(result.checks.find((x) => x.id === "scheduler").status, "missing");
  assert.equal(JSON.stringify(result).includes("token leak"), false);
  const missing = await runSystemCheck({ DB: okDb }, { timeoutMs: 1 });
  assert.equal(missing.checks.find((x) => x.id === "files").status, "disabled");
});

test("DO health requires verified GET and has no storage/alarm side effects", () => {
  const request = new Request("https://internal/health", { headers: { "x-cfchat-internal-auth": "worker-verified" } });
  const response = durableObjectHealth(request, "ChannelRoom");
  assert.equal(response.status, 200);
  assert.deepEqual(response.headers.get("content-type").includes("application/json"), true);
  assert.equal(durableObjectHealth(new Request(request.url), "ChannelRoom").status, 401);
  assert.equal(durableObjectHealth(new Request(request.url, { method: "POST", headers: request.headers }), "ChannelRoom").status, 405);
});

test("real DO health probes are read-only for ChannelRoom, UserInbox, and Scheduler", async () => {
  const calls = { storage: 0, alarm: 0, broadcast: 0 };
  const state = {
    getWebSockets: () => [],
    storage: {
      getAlarm: async () => { calls.storage++; return null; },
      setAlarm: async () => { calls.alarm++; }
    },
    waitUntil: () => {},
    acceptWebSocket: () => {}
  };
  const room = new ChannelRoom(state, {});
  room.broadcast = async () => { calls.broadcast++; };
  const inbox = new UserInbox(state);
  inbox.broadcast = () => { calls.broadcast++; };
  const scheduler = new Scheduler(state, {});
  const request = () => new Request("https://internal/health", { headers: { "x-cfchat-internal-auth": "worker-verified" } });
  for (const object of [room, inbox, scheduler]) {
    const response = await object.fetch(request());
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, service: object.constructor.name });
  }
  assert.deepEqual(calls, { storage: 0, alarm: 0, broadcast: 0 });
});

test("system check times out a never-resolving probe and isolates it", async () => {
  const never = { idFromName: () => "health", get: () => ({ fetch: () => new Promise(() => {}) }) };
  const result = await runSystemCheck({ DB: okDb, CHANNEL_ROOM: never }, { timeoutMs: 5 });
  assert.equal(result.checks.find((x) => x.id === "channelRoom").code, "timeout");
  assert.equal(result.checks.find((x) => x.id === "d1").status, "ok");
});

test("system probes use fixed KV key, R2 limit one, and do not read payloads", async () => {
  let key; let options; let read = false;
  const result = await runSystemCheck({
    DB: okDb,
    SESSIONS: { get: async (value) => { key = value; return { secret: "must-not-be-read" }; } },
    FILES: { list: async (value) => { options = value; return { objects: [], truncated: false }; } }
  }, { timeoutMs: 10 });
  read = JSON.stringify(result).includes("must-not-be-read");
  assert.equal(key, "__edgechat_health__");
  assert.deepEqual(options, { limit: 1 });
  assert.equal(read, false);
});

test("real auth and admin middleware return 401, 403, and allow admins", async () => {
  const app = new Hono();
  app.use("/api/admin/*", authMiddleware, adminMiddleware);
  registerMaintenanceRoutes(app);
  const db = { prepare: () => ({ bind: () => ({ all: async () => ({ results: [{ username: "u", is_disabled: 0, deleted_at: null, session_version: 0, is_admin: 0 }] }) }) }) };
  const env = { DB: db, SESSIONS: { get: async () => null } };
  assert.equal((await app.request("/api/admin/maintenance", {}, env)).status, 401);
  const session = { userId: 1, isAdmin: false, sessionVersion: 0 };
  const authorizedEnv = { ...env, SESSIONS: { get: async () => JSON.stringify(session), put: async () => {} , delete: async () => {} } };
  assert.equal((await app.request("/api/admin/maintenance", { headers: { Authorization: "Bearer token" } }, authorizedEnv)).status, 403);
  const adminDb = { prepare: () => ({ bind: () => ({ all: async () => ({ results: [{ username: "u", is_disabled: 0, deleted_at: null, session_version: 0, is_admin: 1 }] }) }) }) };
  const adminEnv = { DB: adminDb, SESSIONS: { get: async () => JSON.stringify({ ...session, isAdmin: true }), put: async () => {} , delete: async () => {} } };
  const response = await app.request("/api/admin/maintenance", { headers: { Authorization: "Bearer token" } }, adminEnv);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal((await response.json()).checks.length, 8);
});
