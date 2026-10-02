// 公共配置。不单独执行：每次运行时拼在 scan / apply / verify / rollback 前面一起交给 obsidian eval，
//   obsidian eval code="$(cat "<skill目录>/scripts/config.js" "<skill目录>/scripts/scan.js")"
// 这里只定义常量和函数，不在顶层读任何文件。

const AK_TMP_DIR = "/tmp/ak-image-organize";
const AK_CONFIG_PATH = require("path").join(
  require("os").homedir(), ".config", "ak-skills", "ak-image-organize.json");

// ~ 或 ~/ 开头的路径换成家目录
function akExpandHome(p) {
  if (p === "~") return require("os").homedir();
  if (p.startsWith("~/")) return require("os").homedir() + p.slice(1);
  return p;
}

function akTrimSlashes(p) {
  return String(p).replace(/^\/+|\/+$/g, "");
}

// 算出「待处理区」：返回库内相对目录（"" 表示库根目录），
// 返回 null 表示位置无法标记处理状态，只按文件名判断。
//   pendingDir     配置里的值，可以不填
//   attachSetting  Obsidian「附件默认存放位置」设置：/ 是库根目录，./ 开头是与笔记同目录
//   archiveDir     归档目录
function akResolvePendingDir(pendingDir, attachSetting, archiveDir) {
  let dir;
  if (pendingDir !== undefined && pendingDir !== null) {
    dir = akTrimSlashes(pendingDir);
  } else {
    const setting = String(attachSetting || "/");
    if (setting.startsWith("./")) return null;   // 图跟着笔记走，没有统一的待处理区
    dir = akTrimSlashes(setting);
  }
  if (dir === akTrimSlashes(archiveDir)) return null;   // 待处理区和归档区是同一处，位置区分不了状态
  return dir;
}

function akLoadConfig() {
  const fs = require("fs");
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(AK_CONFIG_PATH, "utf8"));
  } catch (e) {
    return { error: `找不到配置 ${AK_CONFIG_PATH}（${e.message}），先按 SKILL.md 第 0 步生成` };
  }
  if (!cfg.archiveDir) {
    return { error: `配置 ${AK_CONFIG_PATH} 里没有 archiveDir，先按 SKILL.md 第 0 步补上` };
  }
  return {
    archiveDir: akTrimSlashes(cfg.archiveDir),
    pendingDir: akResolvePendingDir(cfg.pendingDir, app.vault.getConfig("attachmentFolderPath"), cfg.archiveDir),
    logDir: akExpandHome(cfg.logDir || "~/.config/ak-skills/ak-image-organize"),
  };
}
