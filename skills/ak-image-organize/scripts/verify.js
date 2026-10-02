// 断链校验。第一次运行记录基线，第二次运行做差值比对并清除基线。
// 运行前要拼上 config.js（见 SKILL.md）；本脚本只用其中的 AK_TMP_DIR。
(async () => {
  const fs = require("fs");
  const DIR = AK_TMP_DIR;
  const BASELINE = `${DIR}/baseline.json`;

  const snapshot = () => {
    const u = app.metadataCache.unresolvedLinks || {};
    const items = [];
    for (const [src, links] of Object.entries(u))
      for (const target of Object.keys(links)) items.push(`${src} :: ${target}`);
    return items.sort();
  };

  const now = snapshot();

  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(BASELINE, "utf8")); } catch (e) {}

  if (!prev) {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(BASELINE, JSON.stringify({ items: now }));
    return JSON.stringify({
      mode: "基线已记录",
      unresolvedCount: now.length,
      hint: "改完图片后再跑一次本脚本做比对。",
    }, null, 1);
  }

  const before = new Set(prev.items);
  const added = now.filter((x) => !before.has(x));
  const removed = prev.items.filter((x) => !now.includes(x));

  fs.unlinkSync(BASELINE);

  return JSON.stringify({
    mode: "比对完成",
    baselineCount: prev.items.length,
    currentCount: now.length,
    newBrokenLinks: added,
    fixedLinks: removed,
    verdict: added.length === 0
      ? "通过：没有产生新的断链。"
      : `失败：新增 ${added.length} 条断链，立刻用 rollback.js 回滚本批。`,
  }, null, 1);
})()
