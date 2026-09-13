import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
	new URL("../.github/workflows/deploy-worker.yml", import.meta.url),
	"utf8",
).replaceAll("\r\n", "\n");

function getStep(name) {
	const marker = `      - name: ${name}\n`;
	const start = workflow.indexOf(marker);
	assert.notEqual(start, -1, `部署工作流缺少步骤：${name}`);
	const next = workflow.indexOf("      - name: ", start + marker.length);
	return workflow.slice(start, next === -1 ? undefined : next);
}

test("Cloudflare 生产凭据只注入实际调用 Cloudflare 的步骤", () => {
	const deployJobStart = workflow.indexOf("  deploy:\n");
	const stepsStart = workflow.indexOf("    steps:\n", deployJobStart);
	assert.notEqual(deployJobStart, -1);
	assert.notEqual(stepsStart, -1);
	assert.doesNotMatch(
		workflow.slice(deployJobStart, stepsStart),
		/CLOUDFLARE_(?:API_TOKEN|ACCOUNT_ID)/,
	);

	for (const name of [
		"Checkout",
			"Setup Node.js",
			"Install dependencies",
			"Run tests",
			"Build frontend assets",
		"Generate wrangler config for CI",
		"Generate admin bootstrap SQL (optional)",
	]) {
		assert.doesNotMatch(getStep(name), /CLOUDFLARE_(?:API_TOKEN|ACCOUNT_ID)/);
	}

	for (const name of [
		"Ensure Cloudflare resources",
		"Initialize D1 schema (first creation only)",
			"Prepare D1 migrations",
			"Apply D1 migrations",
			"Ensure admin user (optional)",
			"Prepare Worker encryption secret",
			"Deploy worker",
	]) {
		const step = getStep(name);
		assert.match(step, /CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/);
		assert.match(step, /CLOUDFLARE_ACCOUNT_ID: \$\{\{ secrets\.CLOUDFLARE_ACCOUNT_ID \}\}/);
	}
});

test("生产部署在创建或修改云资源前运行完整测试", () => {
	const testsStart = workflow.indexOf("      - name: Run tests\n");
	const resourcesStart = workflow.indexOf("      - name: Ensure Cloudflare resources\n");
	assert.notEqual(testsStart, -1);
	assert.equal(testsStart < resourcesStart, true);
	assert.match(getStep("Run tests"), /run: npm test/);
});

test("首次部署自动创建密钥，普通部署保留密钥，手动轮换才允许更新", () => {
	const prepareStep = getStep("Prepare Worker encryption secret");
	assert.match(prepareStep, /prepare-worker-encryption-secret\.mjs/);
	assert.match(
		prepareStep,
		/EDGECHAT_ENCRYPTION_KEYRING: \$\{\{ secrets\.EDGECHAT_ENCRYPTION_KEYRING \}\}/,
	);
	assert.match(prepareStep, /EDGECHAT_APPLY_ENCRYPTION_KEYRING:/);
	assert.match(prepareStep, /EDGECHAT_ROTATE_ENCRYPTION_KEY:/);
	assert.match(workflow, /apply_encryption_keyring:/);
	assert.match(workflow, /rotate_encryption_key:/);

	const deployStep = getStep("Deploy worker");
	assert.match(deployStep, /if \[\[ -f \.tmp\/worker-secrets\.json \]\]/);
	assert.match(deployStep, /wrangler deploy --config wrangler\.ci\.toml --secrets-file/);
	assert.match(deployStep, /wrangler deploy --config wrangler\.ci\.toml/);
});

test("资源确认脚本仅复用配置的 KV 标题，避免隐式共享会话存储", () => {
	const script = readFileSync(
		new URL("../.github/scripts/ensure-cloudflare-resources.mjs", import.meta.url),
		"utf8",
	).replaceAll("\r\n", "\n");

	assert.doesNotMatch(script, /PRODUCTION_KV_NAMESPACE_TITLE/);
	assert.match(
		script,
		/namespace\.title === kvNamespaceTitle && namespace\.id/,
	);
	assert.match(script, /setOutput\("kv_namespace_title", kv\.title\);/);

	const resourceStep = getStep("Ensure Cloudflare resources");
	assert.match(
		resourceStep,
		/EDGECHAT_KV_NAMESPACE_TITLE: \$\{\{ vars\.EDGECHAT_KV_NAMESPACE_TITLE \|\| 'cfchat-sessions' \}\}/,
	);
});

test("部署工作流不再探测或生成 R2 binding", () => {
	const configStep = getStep("Generate wrangler config for CI");
	assert.doesNotMatch(configStep, /R2_AVAILABLE|R2_BUCKET_NAME|r2_buckets|FILES/);
	assert.match(configStep, /YOUR_D1_DATABASE_ID_HERE/);
	assert.match(configStep, /YOUR_KV_NAMESPACE_ID_HERE/);
});
