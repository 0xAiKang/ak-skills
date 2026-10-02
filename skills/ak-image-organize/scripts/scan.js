// 扫描待处理图片，并为每张图收集命名所需的语境。
// 可选配置：/tmp/ak-image-organize/scan-config.json  { "limit": 10, "files": ["a.webp"] }
// 运行前要拼上 config.js（见 SKILL.md）。
(async () => {
  const C = akLoadConfig();
  if (C.error) return JSON.stringify({ error: C.error });
  const fs = require("fs");
  const CFG_PATH = `${AK_TMP_DIR}/scan-config.json`;
  const ATTACH_DIR = C.archiveDir;
  const IMG_EXT = /^(png|jpe?g|webp|gif|svg|heic|bmp)$/i;

  // 读完即删：残留的旧配置会静默改变下次的默认行为
  let cfg = { limit: 10, files: [] };
  try {
    Object.assign(cfg, JSON.parse(fs.readFileSync(CFG_PATH, "utf8")));
    fs.unlinkSync(CFG_PATH);
  } catch (e) {}

  // 文件名是否毫无语义
  const MEANINGLESS = [
    /^Pasted image/i,
    /^(截屏|截图)/,
    /^(Screenshot|Screen Shot|CleanShot)/i,
    /^(IMG[_-]|DSC[_-]?\d|PXL[_-]|mmexport|微信图片|WX[a-z]*\d)/i,
    /^(image|图片|未命名|untitled|下载|download)[-_ ]?\d*\.[a-z0-9]+$/i,
    /^\d+\.[a-z0-9]+$/i,                    // 纯数字文件名
    /^[0-9a-f]{16,}\.[a-z0-9]+$/i,          // hash 名
  ];
  const TIMESTAMP_TAIL = /[-_]\d{10,}\.[a-z0-9]+$/i;   // 主体有语义但挂了时间戳尾巴

  // 待处理区：C.pendingDir 为 null 时位置不标记状态，只按文件名判断
  const dirOf = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
  const why = (f) => {
    const inPending = C.pendingDir !== null && dirOf(f.path) === C.pendingDir;
    if (MEANINGLESS.some((re) => re.test(f.name))) return inPending ? "待处理区 + 文件名无语义" : "文件名无语义";
    if (TIMESTAMP_TAIL.test(f.name)) return inPending ? "待处理区 + 时间戳尾巴" : "时间戳尾巴";
    if (inPending) return "位于待处理区";
    return null;
  };

  const all = app.vault.getFiles().filter((f) => IMG_EXT.test(f.extension));

  // 反向索引：图片路径 -> 引用它的笔记
  const refs = {};
  for (const [src, tgts] of Object.entries(app.metadataCache.resolvedLinks))
    for (const t of Object.keys(tgts)) (refs[t] ||= []).push(src);

  let targets;
  if (cfg.files && cfg.files.length) {
    const want = new Set(cfg.files.map((s) => s.split("/").pop()));
    targets = all.filter((f) => want.has(f.name));
  } else {
    // 按「引用它的第一篇笔记」分组，同一篇笔记里的系列图必须同批处理，
    // 否则编号（主题 2 / 主题 3）会因为跨批次而算错。
    const pendingList = all.filter((f) => why(f) !== null);
    const groups = new Map();
    for (const f of pendingList) {
      const key = (refs[f.path] || [])[0] || "￿未被引用";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(f);
    }
    targets = [];
    for (const key of [...groups.keys()].sort()) {
      if (targets.length >= cfg.limit) break;   // 组内不截断，故实际数量可能略超 limit
      targets.push(...groups.get(key));
    }
  }

  const out = [];
  for (const f of targets) {
    const citers = refs[f.path] || [];
    const contexts = [];
    for (const p of citers.slice(0, 5)) {
      const nf = app.vault.getAbstractFileByPath(p);
      if (!nf) continue;
      let body = "";
      try { body = await app.vault.cachedRead(nf); } catch (e) { continue; }
      const lines = body.split("\n");
      const hit = lines.findIndex((l) => l.includes(f.name));
      const snippet = hit < 0 ? "" :
        lines.slice(Math.max(0, hit - 3), hit + 4).join("\n").slice(0, 600);
      const fm = app.metadataCache.getFileCache(nf)?.frontmatter;
      contexts.push({
        note: p,
        noteTitle: nf.basename,
        noteSummary: (fm?.summary || "").slice(0, 200),
        around: snippet,
      });
    }
    // 同一篇笔记引用的其他图（含已归档的）——用于延续系列编号、避免撞名
    const siblings = [];
    for (const p of citers) {
      const links = app.metadataCache.resolvedLinks[p] || {};
      for (const t of Object.keys(links)) {
        if (t === f.path) continue;
        const tf = app.vault.getAbstractFileByPath(t);
        if (tf && IMG_EXT.test(tf.extension) && !siblings.includes(tf.name)) siblings.push(tf.name);
      }
    }

    out.push({
      path: f.path,
      name: f.name,
      ext: f.extension,
      kb: Math.round((f.stat?.size || 0) / 1024),
      reason: why(f) || "指定处理",
      alreadyArchived: f.path.startsWith(ATTACH_DIR + "/"),
      refCount: citers.length,
      siblingsInSameNote: siblings,
      contexts,
      note: citers.length === 0
        ? "无 .md 引用；canvas / Excalidraw 引用不计入统计，勿据此判定为孤儿"
        : undefined,
    });
  }

  const pending = all.filter((f) => why(f) !== null).length;
  return JSON.stringify({
    scanned: out.length,
    pendingTotal: pending,
    hint: pending > out.length
      ? `全库还有 ${pending - out.length} 张待处理，本次只取 ${out.length} 张。改 ${CFG_PATH} 的 limit 可调整。`
      : "已覆盖全部待处理图片。",
    images: out,
  }, null, 1);
})()
