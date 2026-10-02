// ak-image-organize 的 scripts/config.js 测试。
// config.js 不是模块，运行时被拼在每个脚本前面交给 obsidian eval；
// 这里用 vm 在独立上下文里执行它，再调用它定义的函数。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const src = fs.readFileSync(
  path.join(__dirname, "..", "skills", "ak-image-organize", "scripts", "config.js"),
  "utf8",
);
const ctx = { require };
vm.runInNewContext(src, ctx);

test("pendingDir 显式给 / 表示库根目录", () =>
  assert.equal(ctx.akResolvePendingDir("/", "./", "attachments"), ""));
test("未配置时取 Obsidian 设置：/ 是根目录", () =>
  assert.equal(ctx.akResolvePendingDir(undefined, "/", "attachments"), ""));
test("未配置且附件设置为同目录 ./ 时无法按位置判断", () =>
  assert.equal(ctx.akResolvePendingDir(undefined, "./", "attachments"), null));
test("未配置且附件设置为 ./assets 时无法按位置判断", () =>
  assert.equal(ctx.akResolvePendingDir(undefined, "./assets", "attachments"), null));
test("未配置且附件设置为固定目录", () =>
  assert.equal(ctx.akResolvePendingDir(undefined, "inbox/img", "attachments"), "inbox/img"));
test("待处理区与归档区相同时不按位置判断", () =>
  assert.equal(ctx.akResolvePendingDir("attachments/", "/", "attachments"), null));
test("去掉首尾斜杠", () =>
  assert.equal(ctx.akResolvePendingDir("/inbox/", "/", "attachments"), "inbox"));
test("~ 展开为家目录", () => assert.equal(ctx.akExpandHome("~/x"), os.homedir() + "/x"));
test("非 ~ 路径原样返回", () => assert.equal(ctx.akExpandHome("/a/b"), "/a/b"));

test("pendingDir 写成空字符串等于没配置：附件设置为 ./ 时不按位置判断", () =>
  assert.equal(ctx.akResolvePendingDir("", "./", "attachments"), null));
test("pendingDir 写成空字符串等于没配置：附件设置为 / 时是根目录", () =>
  assert.equal(ctx.akResolvePendingDir("", "/", "attachments"), ""));

// akLoadConfig：用假的 fs 和 app，不碰真实的配置文件
function loadWith(json, attach = "/") {
  const fake = (name) => (name === "fs"
    ? { readFileSync: () => { if (json === null) throw new Error("ENOENT"); return JSON.stringify(json); } }
    : require(name));
  const c = { require: fake, app: { vault: { getConfig: () => attach } } };
  vm.runInNewContext(src, c);
  return c.akLoadConfig();
}
test("akLoadConfig：没有配置文件时报错", () => assert.match(loadWith(null).error, /找不到配置/));
test("akLoadConfig：archiveDir 是 / 时报错，不能把图归档到库根目录", () =>
  assert.match(loadWith({ archiveDir: "/" }).error, /archiveDir/));
test("akLoadConfig：logDir 不写时展开成家目录下的默认目录", () =>
  assert.equal(loadWith({ archiveDir: "attachments" }).logDir, os.homedir() + "/.config/ak-skills/ak-image-organize"));
