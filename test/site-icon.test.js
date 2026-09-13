import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Hono } from "hono";
import initSqlJs from "sql.js";

import { registerAdminRoutes } from "../worker/src/api/admin.js";
import { getSiteSettings, updateSiteSettings } from "../worker/src/data/site-settings.js";
import { runScheduledGc } from "../worker/src/gc.js";
import {
	classifyStoredSiteIcon,
	normalizeSiteIconForStorage,
} from "../worker/src/site-icon.js";
import { createD1Adapter } from "./support/d1.js";

const SQL = await initSqlJs();
const schemaSql = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");

function createHarness(key = "1/icon.png") {
	const database = new SQL.Database();
	database.exec(schemaSql);
	database.run(
		`INSERT INTO users (id, username, display_name, password_hash, password_salt)
		 VALUES (1, 'admin', 'Admin', 'hash', 'salt')`,
	);
	database.run(
		"INSERT INTO uploaded_files (object_key, owner_user_id, created_at) VALUES (?, 1, datetime('now', '-2 day'))",
		[key],
	);
	return { database, db: createD1Adapter(database), key };
}

test("站点图标统一本地 key，保留真正外链并区分未知 origin", () => {
	assert.equal(normalizeSiteIconForStorage("/files/1%2Ficon.png"), "r2:1/icon.png");
	assert.equal(
		normalizeSiteIconForStorage(
			"https://chat.example/files/1%2Ficon.png",
			["https://chat.example"],
		),
		"r2:1/icon.png",
	);
	assert.equal(
		normalizeSiteIconForStorage(
			"https://cdn.example/files/1%2Ficon.png",
			["https://chat.example"],
		),
		"https://cdn.example/files/1%2Ficon.png",
	);
	assert.deepEqual(
		classifyStoredSiteIcon(
			"https://cdn.example/files/1%2Ficon.png",
			["https://chat.example"],
		),
		{ kind: "external", key: null },
	);
	assert.deepEqual(
		classifyStoredSiteIcon("https://cdn.example/files/1%2Ficon.png"),
		{ kind: "ambiguous", key: "1/icon.png" },
	);
	assert.deepEqual(classifyStoredSiteIcon("https://cdn.example/icon.png"), {
		kind: "external",
		key: null,
	});
});

for (const [label, storedValue] of [
	["历史相对路径", "/files/1%2Ficon.png"],
	["历史完整 URL", "https://chat.example/files/1%2Ficon.png"],
	["历史裸 key", "1/icon.png"],
]) {
	test(`${label}站点图标不会被孤儿 GC 误删`, async () => {
		const { database, db } = createHarness();
		database.run(
			"UPDATE site_settings SET setting_value = ? WHERE setting_key = 'site_icon_url'",
			[storedValue],
		);
		const deleted = [];
		await runScheduledGc({
			DB: db,
			FILES: { async delete(key) { deleted.push(key); } },
		});
		assert.deepEqual(deleted, []);
		assert.equal(
			database.exec("SELECT COUNT(*) FROM uploaded_files")[0].values[0][0],
			1,
		);
	});
}

test("本站完整 URL 保存为原子保护的本地 key，外链不阻止无关孤儿清理", async () => {
	const local = createHarness();
	const saved = await updateSiteSettings(local.db, {
		siteName: "Edgechat",
		siteIconUrl: "https://chat.example/files/1%2Ficon.png",
		siteOrigin: "https://chat.example",
	});
	assert.equal(saved.siteIconUrl, "/files/1%2Ficon.png");
	assert.equal(
		local.database.exec(
			"SELECT setting_value FROM site_settings WHERE setting_key = 'site_icon_url'",
		)[0].values[0][0],
		"r2:1/icon.png",
	);
	const localDeletes = [];
	await runScheduledGc({
		DB: local.db,
		FILES: { async delete(key) { localDeletes.push(key); } },
	});
	assert.deepEqual(localDeletes, []);

	const external = createHarness("1/orphan.png");
	await updateSiteSettings(external.db, {
		siteName: "Edgechat",
		siteIconUrl: "https://cdn.example/icon.png",
		siteOrigin: "https://chat.example",
	});
	assert.deepEqual(await getSiteSettings(external.db), {
		siteName: "Edgechat",
		siteIconUrl: "https://cdn.example/icon.png",
	});
	const externalDeletes = [];
	await runScheduledGc({
		DB: external.db,
		FILES: { async delete(key) { externalDeletes.push(key); } },
	});
	assert.deepEqual(externalDeletes, ["1/orphan.png"]);
});

test("可信 origin 已配置时，外域 /files/ URL 不会保护同名本地孤儿", async () => {
	const external = createHarness();
	external.database.run(
		"UPDATE site_settings SET setting_value = 'https://cdn.example/files/1%2Ficon.png' WHERE setting_key = 'site_icon_url'",
	);
	const deleted = [];
	await runScheduledGc({
		DB: external.db,
		FILES: { async delete(key) { deleted.push(key); } },
		SITE_ORIGINS: "https://chat.example",
	});
	assert.deepEqual(deleted, ["1/icon.png"]);
});

test("站点图标写入在 pending 阶段和删除完成后都拒绝失效 key", async () => {
	const { database, db } = createHarness();
	database.run("INSERT INTO pending_r2_delete (object_key) VALUES ('1/icon.png')");
	await assert.rejects(
		updateSiteSettings(db, { siteIconUrl: "/files/1%2Ficon.png" }),
		/r2_local_object_unavailable/,
	);
	database.run("DELETE FROM uploaded_files WHERE object_key = '1/icon.png'");
	database.run("DELETE FROM pending_r2_delete WHERE object_key = '1/icon.png'");
	await assert.rejects(
		updateSiteSettings(db, { siteIconUrl: "/files/1%2Ficon.png" }),
		/r2_local_object_unavailable/,
	);
});

test("管理 API 将站点图标竞态映射为明确业务错误", async () => {
	const { database, db } = createHarness();
	database.run("INSERT INTO pending_r2_delete (object_key) VALUES ('1/icon.png')");
	const app = new Hono();
	registerAdminRoutes(app);
	const response = await app.fetch(
		new Request("https://chat.example/api/admin/site-settings", {
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				siteName: "Edgechat",
				siteIconUrl: "https://chat.example/files/1%2Ficon.png",
			}),
		}),
		{ DB: db },
	);
	assert.equal(response.status, 400);
	assert.deepEqual(await response.json(), {
		error: "站点图标文件不存在或正在清理，请重新上传",
	});
});
