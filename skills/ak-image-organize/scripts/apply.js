// 按 plan 重命名并归档图片。用 fileManager.renameFile，由 Obsidian 自动更新全部引用。
// 输入：/tmp/ak-image-organize/plan.json   [{ "from": "旧名或路径", "to": "新名.webp" }]
// 运行前要拼上 config.js（见 SKILL.md）。
(async () => {
  const C = akLoadConfig();
  if (C.error) return JSON.stringify({ error: C.error });
  const fs = require("fs");
  const PLAN_PATH = `${AK_TMP_DIR}/plan.json`;
  const ATTACH_DIR = C.archiveDir;
  const LOG_DIR = C.logDir;

  let plan;
  try { plan = JSON.parse(fs.readFileSync(PLAN_PATH, "utf8")); }
  catch (e) { return JSON.stringify({ error: `读不到 plan：${PLAN_PATH} — ${e}` }); }
  if (!Array.isArray(plan) || !plan.length)
    return JSON.stringify({ error: "plan 为空或不是数组" });
  // 读完即删：防止残留的旧 plan 被下一次运行误执行
  try { fs.unlinkSync(PLAN_PATH); } catch (e) {}

  if (!app.vault.getAbstractFileByPath(ATTACH_DIR)) {
    try { await app.vault.createFolder(ATTACH_DIR); } catch (e) {}
  }

  const allFiles = app.vault.getFiles();
  const batch = `${new Date().toISOString()}`;
  const done = [], skipped = [];

  for (const item of plan) {
    const from = String(item.from || "").trim();
    const to = String(item.to || "").trim();
    if (!from || !to) { skipped.push({ from, to, why: "from/to 不能为空" }); continue; }

    const src = allFiles.find((f) => f.path === from) ||
                allFiles.find((f) => f.name === from.split("/").pop());
    if (!src) { skipped.push({ from, to, why: "源文件不存在" }); continue; }

    if (to.includes("/")) { skipped.push({ from, to, why: "to 只写文件名，不要带路径" }); continue; }
    const newExt = to.split(".").pop().toLowerCase();
    if (newExt !== src.extension.toLowerCase()) {
      skipped.push({ from, to, why: `扩展名不能改（原 .${src.extension}）` }); continue;
    }
    if (/[\\:*?"<>|#^\[\]]/.test(to)) {
      skipped.push({ from, to, why: "文件名含 Obsidian 链接不安全的字符" }); continue;
    }
    if (/[-_]\d{10,}\./.test(to)) {
      skipped.push({ from, to, why: "新名仍带时间戳尾巴，重起一个" }); continue;
    }

    // shortest 链接格式下，全库同名会让 ![[名]] 指向不确定 —— 视为断链
    const clash = allFiles.find((f) => f.name === to && f.path !== src.path);
    if (clash) { skipped.push({ from, to, why: `全库已存在同名文件：${clash.path}` }); continue; }

    const dest = `${ATTACH_DIR}/${to}`;
    if (app.vault.getAbstractFileByPath(dest)) {
      skipped.push({ from, to, why: "目标路径已被占用" }); continue;
    }

    const oldPath = src.path;
    try {
      await app.fileManager.renameFile(src, dest);
      done.push({ from: oldPath, to: dest });
    } catch (e) {
      skipped.push({ from, to, why: `renameFile 失败：${e}` });
    }
  }

  if (done.length) {
    try {
      fs.mkdirSync(LOG_DIR, { recursive: true });
      const lines = done.map((d) => JSON.stringify({ batch, ...d })).join("\n") + "\n";
      fs.appendFileSync(`${LOG_DIR}/rename-log.jsonl`, lines);
    } catch (e) {
      return JSON.stringify({
        batch, done, skipped,
        warn: `文件已改名但日志写入失败（回滚需手工）：${e}`,
      }, null, 1);
    }
  }

  return JSON.stringify({
    batch,
    okCount: done.length,
    skipCount: skipped.length,
    done,
    skipped,
    next: "立刻跑 verify.js 做断链比对；若有新增未解析链接，用 rollback.js 回滚本批。",
  }, null, 1);
})()
