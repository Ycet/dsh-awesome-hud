import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test("HUD client wires Codex quota display and optional RPC fallback", async () => {
	const source = await readFile(join(root, "lib/client.js"), "utf8");
	assert.match(source, /\/codex-subscription/);
	assert.match(source, /callCodexSubscription\(rpc, "status"/);
	assert.match(source, /callCodexSubscription\(rpc, "usage"/);
	assert.match(source, /selectCodexQuotaWindows\(response\.value\)/);
	assert.match(source, /codexFiveHour/);
	assert.match(source, /codexWeekly/);
	assert.match(source, /name: "ChatGPT"/);
	assert.match(source, /openSettingsAccount\("codex"\)/);
	assert.match(source, /usageAvailability/);
});
