// dsh-awesome-hud — v0.21.3：更新日志「最新版本日期 = 该版本修改日期」的回归。
//  1) 第一条版本号必须等于 package.json；
//  2) 日期必须等于该版本最后一次修改的日期（有未提交改动时取写入时间，干净时取最后一次提交日期）；
//  3) 无法判定（非 git 环境）时跳过，不误改历史；
//  4) npm test 前置与 changelog:date 脚本接线齐全。
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TRACKED_FILES, changelogTopEntry, expectedChangelogDate, syncChangelogDate } from "../scripts/changelog-date.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

test("最新版本日期：等于该版本最后一次修改的日期", (t) => {
  const entry = changelogTopEntry();
  assert.equal(entry.version, `v${manifest.version}`, "更新日志第一条必须是当前版本");
  assert.match(entry.date, /^\d{4}-\d{2}-\d{2}$/u, "日期格式必须是 YYYY-MM-DD");
  const expected = expectedChangelogDate();
  if (expected.date === null) {
    t.skip("当前环境无法判定修改日期（不是 git 仓库或 git 不可用）");
    return;
  }
  const reason = expected.source === "dirty" ? "未提交改动的写入时间" : "最后一次提交日期";
  assert.equal(
    entry.date,
    expected.date,
    `v${manifest.version} 的日期是 ${entry.date}，应为 ${expected.date}（依据：${reason}）；执行 npm run changelog:date 修正`,
  );
  // 只校验模式与自动修正模式在同一份数据上必须给出同一个结论。
  assert.equal(syncChangelogDate({ check: true }).status, "ok");
});

test("脚本接线：npm test 前自动对齐，并保留单独修正入口", () => {
  assert.equal(manifest.scripts["changelog:date"], "node scripts/changelog-date.mjs", "提供 changelog:date 脚本");
  assert.equal(manifest.scripts.pretest, "node scripts/changelog-date.mjs", "npm test 前置自动校验并修正日期");
  assert.equal(manifest.files.includes("scripts"), false, "scripts 不随包发布，只用于开发期校验");
  assert.ok(TRACKED_FILES.includes("lib/client.js"), "更新日志数据文件在判定范围内");
  assert.deepEqual([...TRACKED_FILES].sort(), ["lib/client.js", "lib/index.js", "package.json"], "判定范围恰为宿主 / 客户端 / 清单");
});
