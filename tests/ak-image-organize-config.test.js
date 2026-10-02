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
