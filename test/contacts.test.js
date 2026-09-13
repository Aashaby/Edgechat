import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import initSqlJs from "sql.js";
import { createSession, hashPassword } from "../worker/src/auth.js";
import worker from "../worker/src/index.js";
import { createD1Adapter, createKvAdapter } from "./support/d1.js";

const SQL = await initSqlJs();
const schema = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");
const password = await hashPassword("password");

async function harness() {
	const database = new SQL.Database();
	database.exec(schema);
	for (const name of ["admin", "existing-dm", "disabled", "deleted", "expired", "temporary", "available"]) {
		database.run(
			"INSERT INTO users (username, display_name, password_hash, password_salt) VALUES (?, ?, ?, ?)",
			[name, name === "available" ? "Same name" : name, password.hash, password.salt],
		);
	}
	database.run("UPDATE users SET is_admin = 1 WHERE id = 1");
	database.run("UPDATE users SET is_disabled = 1 WHERE id = 3");
	database.run("UPDATE users SET deleted_at = CURRENT_TIMESTAMP WHERE id = 4");
	database.run("UPDATE users SET disabled_until = datetime('now', '-1 hour') WHERE id = 5");
	database.run("UPDATE users SET disabled_until = datetime('now', '+1 hour') WHERE id = 6");
	database.run("INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (1, 7)");
	const env = { DB: createD1Adapter(database), SESSIONS: createKvAdapter() };
	const admin = await createSession(env, {
		id: 1, username: "admin", display_name: "admin", is_admin: 1, session_version: 0,
	});
	const member = await createSession(env, {
		id: 2, username: "existing-dm", display_name: "existing-dm", is_admin: 0, session_version: 0,
	});
	async function request(path, { token = admin.token, method = "GET", body } = {}) {
		const response = await worker.fetch(new Request(`https://edgechat.test/api${path}`, {
			method,
			headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		}), env, {});
		return { status: response.status, payload: await response.json() };
	}
	return { admin, member, request };
}

test("通讯录仅向已登录用户返回全部有效本地账号摘要", async () => {
	const { admin, member, request } = await harness();
	assert.equal((await request("/contacts", { token: "" })).status, 401);

	await request("/dm/open", { token: admin.token, method: "POST", body: { userId: 2 } });
	const adminResult = await request("/contacts", { token: admin.token });
	const memberResult = await request("/contacts", { token: member.token });
	assert.equal(adminResult.status, 200);
	assert.equal(memberResult.status, 200);
	assert.deepEqual(adminResult.payload.users.map((user) => user.id), [7, 1, 2, 5]);
	assert.equal(adminResult.payload.users.some((user) => user.id === 1), true, "包含本人");
	assert.equal(adminResult.payload.users.some((user) => user.id === 2), true, "包含已有私信的用户");
	assert.equal(adminResult.payload.users.some((user) => user.id === 7), true, "拉黑关系不影响目录可见性");
	assert.equal(memberResult.payload.users.some((user) => user.id === 2), true, "普通用户同样包含本人");
	for (const user of adminResult.payload.users) {
		assert.deepEqual(Object.keys(user).sort(), ["avatarUrl", "displayName", "id", "username"]);
	}
	assert.equal(adminResult.payload.users.some((user) => [3, 4, 6].includes(user.id)), false);
});

test("通讯录不改变旧 users 与 bootstrap 排除本人的语义", async () => {
	const { admin, request } = await harness();
	const contacts = await request("/contacts", { token: admin.token });
	const users = await request("/users", { token: admin.token });
	const bootstrap = await request("/bootstrap", { token: admin.token });
	assert.equal(contacts.payload.users.some((user) => user.id === 1), true);
	assert.equal(users.payload.users.some((user) => user.id === 1), false);
	assert.equal(bootstrap.payload.users.some((user) => user.id === 1), false);
	assert.equal(contacts.payload.users.some((user) => "bio" in user), false);
});
