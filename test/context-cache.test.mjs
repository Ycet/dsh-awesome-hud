import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test("context module renders the current session cache hit rate after the existing token fields", async () => {
	const source = await readFile(join(root, "lib/client.js"), "utf8");

	assert.match(source, /function cacheHitPercent\(usage\)/);
	assert.match(source, /const billedInput = uncached \+ cacheRead \+ cacheWrite;/);
	assert.match(source, /\(cacheRead \/ billedInput \* 100\)\.toFixed\(1\)/);
	assert.match(source, /usage: projection\.tokenUsage \?\? null/);
	assert.match(source, /contextUsed: "已用 \{tokens\}"/);
	assert.match(source, /contextCacheHit: "缓存命中 \{percent\}"/);
	assert.match(source, /className: "hud-breakdown-sep"/);
	assert.match(source, /className: "hud-breakdown-item"/);
});
