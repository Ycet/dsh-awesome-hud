import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test("git graph reset is gated by current-branch ancestry and Git operation state", async () => {
	const host = await readFile(join(root, "lib/index.js"), "utf8");

	assert.match(host, /async function gitOperationInProgress\(subprocess, cwd\)/);
	assert.match(host, /\["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "REBASE_HEAD"\]/);
	assert.match(host, /\["merge-base", "--is-ancestor", commit, "HEAD"\]/);
	assert.match(host, /async "git\/reset-status"\(payload\)/);
	assert.match(host, /async "git\/reset"\(payload\)/);
	assert.match(host, /\["reset", `--\$\{mode\}`, commit\]/);
	assert.match(host, /currentBranch: normalizeBranch\(branchRaw\.stdout\) \?\? null/);
});

test("git graph keeps only the current local branch blue and renders compact inline confirmations", async () => {
	const client = await readFile(join(root, "lib/client.js"), "utf8");

	assert.match(client, /"data-current": ref\.kind === "branch" && ref\.text === currentBranch/);
	assert.match(client, /\.hud-git-ref\[data-kind=branch\]\{color:#111827;background:#e5e7eb/);
	assert.match(client, /\.hud-git-ref\[data-kind=branch\]\[data-current=true\]\{color:#fff;background:var\(--dsw-alias-state-business-primary\)/);
	assert.match(client, /renderResetItem\("soft", "gitResetSoft"\)/);
	assert.match(client, /renderResetItem\("mixed", "gitResetMixed"\)/);
	assert.match(client, /renderResetItem\("hard", "gitResetHard"\)/);
	assert.match(client, /const renderMergeItem = \(\) =>/);
	assert.match(client, /menu\.confirmMode === "merge"/);
	assert.match(client, /renderMenuConfirmation\("merge", executeMerge/);
	assert.match(client, /className: "hud-git-menu-confirm"/);
	assert.match(client, /className: "hud-git-menu-cancel"/);
	assert.match(client, /padding:3px 7px;font-size:12px;line-height:17px/);
});

test("git commit message input is multiline and Enter does not submit", async () => {
	const client = await readFile(join(root, "lib/client.js"), "utf8");

	assert.match(client, /react\.createElement\("textarea", \{[\s\S]{0,240}className: "hud-commit-input"/);
	assert.match(client, /rows: 3/);
	assert.doesNotMatch(client, /commitMessage\.trim\(\) !== "" && !aiBusy\) doCommit\(\)/);
});

test("commit generation and destructive confirmations use surface-filled button styles", async () => {
	const client = await readFile(join(root, "lib/client.js"), "utf8");

	assert.match(client, /\.hud-btn-ai\{background:var\(--hud-surface-bg\)\}/);
	assert.match(client, /\.hud-btn-ai:hover:not\(:disabled\)\{background:color-mix\(in srgb,var\(--dsw-alias-label-primary\) 8%,transparent\)\}/);
	assert.match(client, /\.hud-btn-danger,\.hud-git-menu-confirm\{border:1px solid var\(--dsw-alias-state-error-primary\);background:var\(--hud-surface-bg\);color:var\(--dsw-alias-state-error-primary\)\}/);
	assert.match(client, /\.hud-btn-danger:hover:not\(:disabled\),\.hud-git-menu-confirm:hover:not\(:disabled\)\{background:color-mix\(in srgb,var\(--dsw-alias-state-error-primary\) 10%,var\(--hud-surface-bg\)\);filter:none\}/);
	assert.match(client, /\.hud-git-menu-cancel\{border:1px solid var\(--dsw-alias-label-primary\);background:var\(--hud-surface-bg\);color:var\(--dsw-alias-label-primary\)\}/);
	assert.match(client, /\.hud-git-menu-cancel:hover:not\(:disabled\)\{background:color-mix\(in srgb,var\(--dsw-alias-label-primary\) 8%,var\(--hud-surface-bg\)\)\}/);
});
