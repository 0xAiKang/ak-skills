// 回滚最近一批重命名。默认回滚日志里最后一个 batch。
// 可选：/tmp/ak-image-organize/rollback-config.json  { "batch": "2026-01-01T..." }
// 运行前要拼上 config.js（见 SKILL.md）。
(async () => {
  const C = akLoadConfig();
  if (C.error) return JSON.stringify({ error: C.error });
  const fs = require("fs");
  const LOG = `${C.logDir}/rename-log.jsonl`;

  let entries;
  try {
    entries = fs.readFileSync(LOG, "utf8").split("\n")
      .filter(Boolean).map((l) => JSON.parse(l));
  } catch (e) { return JSON.stringify({ error: `读不到日志：${LOG} — ${e}` }); }
  if (!entries.length) return JSON.stringify({ error: "日志为空，无可回滚内容" });

  let batch = entries[entries.length - 1].batch;
  // 读完即删（和 scan、apply 一样）：留着的话，下次默认回滚会回滚到这个旧批次
  try {
    const cfgPath = `${AK_TMP_DIR}/rollback-config.json`;
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    fs.unlinkSync(cfgPath);
    if (cfg.batch) batch = cfg.batch;
  } catch (e) {}

  const target = entries.filter((e) => e.batch === batch);
  const done = [], failed = [];

  // 倒序回滚，避免同批内路径互相占用
  for (const e of target.slice().reverse()) {
    const f = app.vault.getAbstractFileByPath(e.to);
    if (!f) { failed.push({ ...e, why: "当前路径找不到文件（可能已被再次改名）" }); continue; }
    if (app.vault.getAbstractFileByPath(e.from)) {
      failed.push({ ...e, why: "原路径已被占用" }); continue;
    }
    try { await app.fileManager.renameFile(f, e.from); done.push(e); }
    catch (err) { failed.push({ ...e, why: String(err) }); }
  }

  if (done.length) {
    const kept = entries.filter((e) => !done.some((d) => d.to === e.to && d.batch === e.batch));
    fs.writeFileSync(LOG, kept.map((e) => JSON.stringify(e)).join("\n") + (kept.length ? "\n" : ""));
  }

  return JSON.stringify({
    batch,
    rolledBack: done.length,
    failedCount: failed.length,
    failed,
    hint: "回滚后重新跑 verify.js 确认断链数已恢复。",
  }, null, 1);
})()
