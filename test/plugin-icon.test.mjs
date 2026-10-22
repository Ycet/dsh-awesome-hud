import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// 插件根目录：test/plugin-icon.test.mjs → test/ → 插件包根目录
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifestPath = resolve(root, "package.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
// 与 DSH package-meta.js 的 MAX_ICON_BYTES 保持一致（256 KiB）
const MAX_ICON_BYTES = 256 * 1024;
const PNG_SIGNATURE = "89504e470d0a1a0a";

test("package.json 声明包内相对图标路径", () => {
  assert.equal(manifest.icon, "icon.png");
  assert.equal(isAbsolute(manifest.icon), false);
  // 非绝对路径、非 URL（DSH 只接受相对清单目录的文件路径）
  assert.doesNotMatch(manifest.icon, /^[A-Za-z][A-Za-z\d+.-]*:/u);
  const target = resolve(root, manifest.icon);
  const local = relative(root, target);
  assert.ok(local !== "" && local !== ".." && !local.startsWith(`..${sep}`) && !isAbsolute(local), "icon 必须留在插件包内");
  assert.ok(existsSync(target), "icon 文件必须存在");
  // DSH 会读取真实文件；符号链接指向包外会被拒绝，这里也要求普通文件
  assert.equal(lstatSync(target).isSymbolicLink(), false);
  assert.equal(statSync(target).isFile(), true);
  assert.equal(extname(target).toLowerCase(), ".png");
});

test("图标为 448×448 PNG 且原始字节不超过 256 KiB", () => {
  const bytes = readFileSync(resolve(root, manifest.icon));
  assert.ok(bytes.length <= MAX_ICON_BYTES, `icon 超过 256 KiB：${bytes.length} bytes`);
  assert.equal(bytes.subarray(0, 8).toString("hex"), PNG_SIGNATURE, "必须是 PNG 文件");
  assert.equal(bytes.subarray(12, 16).toString("ascii"), "IHDR", "首个数据块必须是 IHDR");
  assert.equal(bytes.readUInt32BE(16), 448, "图标宽度必须是 448");
  assert.equal(bytes.readUInt32BE(20), 448, "图标高度必须是 448");
});

test("npm files 清单包含图标，中英文 README 均引用该图标", () => {
  assert.ok(Array.isArray(manifest.files), "package.json files 必须是数组");
  assert.ok(manifest.files.includes(manifest.icon), "files 必须包含图标，避免打包后丢失");
  for (const name of ["README.md", "README_en.md"]) {
    const text = readFileSync(resolve(root, name), "utf8");
    assert.match(text, /<img src="icon\.png" width="96" height="96"/, `${name} 必须在标题下展示图标`);
  }
});

test("版本号与 README 版本/升级标题保持同步", () => {
  const version = String(manifest.version);
  assert.match(version, /^\d+\.\d+\.\d+$/u);
  const zh = readFileSync(resolve(root, "README.md"), "utf8");
  const en = readFileSync(resolve(root, "README_en.md"), "utf8");
  const zhVersion = new RegExp(`当前版本：\\*\\*${version.replaceAll(".", "\\.")}\\*\\*`, "u");
  const enVersion = new RegExp(`Current version: \\*\\*${version.replaceAll(".", "\\.")}\\*\\*`, "u");
  const zhNotes = new RegExp(`## ⬆️ 升级说明（v0\\.11\\.x → v${version.replaceAll(".", "\\.")}）`, "u");
  const enNotes = new RegExp(`## ⬆️ Upgrade Notes \\(v0\\.11\\.x → v${version.replaceAll(".", "\\.")}\\)`, "u");
  assert.match(zh, zhVersion);
  assert.match(en, enVersion);
  assert.match(zh, zhNotes);
  assert.match(en, enNotes);
});
