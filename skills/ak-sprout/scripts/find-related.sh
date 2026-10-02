#!/bin/bash
#
# find-related.sh — 轻量「类语义」检索，替代 RAG
#
# 通过 obsidian eval 查询 Obsidian 的内存 metadataCache，
# 只返回命中的 (笔记名, summary) 对，不读完整文件。Token 开销远低于读索引。
#
# 用法：
#   find-related.sh tag <tag-前缀>          按 tag 前缀
#   find-related.sh title <子串>            按标题包含
#   find-related.sh summary <子串>          按 summary 包含
#   find-related.sh body <子串>             按正文包含
#   find-related.sh keywords "<t1>,<t2>,..." 多词评分检索（核心模式）
#   find-related.sh outlinks <笔记名>       该笔记链向谁
#   find-related.sh backlinks <笔记名>      谁链向该笔记
#   find-related.sh neighbors <笔记名>      2-hop 图扩散
#
# 选项：
#   --scope <目录>        只搜这个目录下的笔记（库内相对路径，或库内的绝对路径，~/ 开头会展开）；
#                         不给就搜整个库；绝对路径不在 Obsidian 当前打开的库里时报错、退出码 2
#   --json                输出 JSON（默认紧凑文本）
#   --limit N             最多返回 N 条（默认 20）
#   --exclude <笔记名>    排除某条（写新笔记找相关时排除自己）
#
# 退出码：0 成功（即使 0 结果也算成功），1 用法错误，2 执行错误（含 --scope 不在当前库里）。

set -euo pipefail

# ---------------- args ----------------

FORMAT="text"
LIMIT="20"
EXCLUDE=""
SCOPE=""
POSITIONAL=()

# 支持选项放在任何位置（mode/arg 前后均可）
while [[ $# -gt 0 ]]; do
  case "$1" in
    --json) FORMAT="json"; shift ;;
    --limit) LIMIT="$2"; shift 2 ;;
    --exclude) EXCLUDE="$2"; shift 2 ;;
    --scope) SCOPE="$2"; shift 2 ;;
    --help|-h)
      awk 'NR==1 {next} /^#/ {print; next} {exit}' "$0"
      exit 0
      ;;
    --) shift; POSITIONAL+=("$@"); break ;;
    -*)
      echo "未知选项：$1。见 find-related.sh --help" >&2
      exit 1
      ;;
    *) POSITIONAL+=("$1"); shift ;;
  esac
done

if [[ ${#POSITIONAL[@]} -lt 2 ]]; then
  echo "用法错误：见 find-related.sh --help" >&2
  exit 1
fi

# ~ 和 ~/ 开头的 --scope 展开成家目录（JS 那边不认 ~）
if [[ "$SCOPE" == "~" || "$SCOPE" == "~/"* ]]; then
  SCOPE="$HOME${SCOPE:1}"
fi

MODE="${POSITIONAL[0]}"
ARG="${POSITIONAL[1]}"

# ---------------- JS escape via Python ----------------
# 把 bash 字符串安全转成 JS 字符串字面量（带引号）。
js_str() {
  python3 -c 'import sys, json; print(json.dumps(sys.argv[1]))' "$1"
}

ARG_JS=$(js_str "$ARG")
EXCLUDE_JS=$(js_str "$EXCLUDE")
LIMIT_JS="$LIMIT"
FORMAT_JS=$(js_str "$FORMAT")
SCOPE_JS=$(js_str "$SCOPE")

# ---------------- shared JS prelude ----------------
# 在 eval 里定义通用工具函数：拿 frontmatter / 输出格式化。
read -r -d '' PRELUDE <<'PRELUDE_EOF' || true
const limit = LIMIT_PLACEHOLDER;
const exclude = EXCLUDE_PLACEHOLDER;
const format = FORMAT_PLACEHOLDER;
// 搜索范围：库内相对目录，结尾带 /；空字符串表示整个库。
// 传入库内的绝对路径时，先去掉库根目录前缀。
// 绝对路径不在当前打开的库里时记下原因，run_eval 据此报错退出，不假装成 0 条命中。
let scopeError = "";
const scope = (() => {
  let s = SCOPE_PLACEHOLDER;
  const base = app.vault.adapter.basePath + "/";
  if (s.startsWith("/") && s.replace(/\/+/g, "") !== "") {
    if (!(s + "/").startsWith(base)) {
      scopeError = `--scope 不在 Obsidian 当前打开的库（${base.slice(0, -1)}）里：${s}`;
      return "";
    }
    s = s.slice(base.length);
  }
  s = s.replace(/^\/+|\/+$/g, "");
  return s ? s + "/" : "";
})();

function getMeta(file) {
  const c = app.metadataCache.getFileCache(file) || {};
  const fm = c.frontmatter || {};
  let tags = fm.tags || [];
  if (typeof tags === "string") tags = [tags];
  tags = (Array.isArray(tags) ? tags : []).map(t => String(t).replace(/^#/, "").trim());
  return {
    name: file.basename,
    path: file.path,
    pillar: file.path.split("/")[1] || "",
    tags,
    summary: (fm.summary || "").trim(),
    links: (c.links || []).map(l => l.link.split("#")[0].split("|")[0]),
  };
}

function inScope(f) {
  return !scope || f.path.startsWith(scope);
}

function formatOut(items) {
  const cut = items.slice(0, limit);
  if (format === "json") {
    return JSON.stringify({ count: items.length, returned: cut.length, hits: cut }, null, 2);
  }
  const lines = cut.map(it => {
    const prefix = it.score !== undefined ? `[${it.score}] ` : "- ";
    const tail = it.matched ? `  (匹配：${it.matched.join("、")})` : "";
    return `${prefix}${it.name} — ${it.summary || "(无 summary)"}${tail}`;
  });
  const omitted = items.length > cut.length ? `\n... 还有 ${items.length - cut.length} 条已省略（用 --limit 调）` : "";
  return `共 ${items.length} 条命中：\n${lines.join("\n")}${omitted}`;
}
PRELUDE_EOF

PRELUDE="${PRELUDE//LIMIT_PLACEHOLDER/$LIMIT_JS}"
PRELUDE="${PRELUDE//EXCLUDE_PLACEHOLDER/$EXCLUDE_JS}"
PRELUDE="${PRELUDE//FORMAT_PLACEHOLDER/$FORMAT_JS}"
PRELUDE="${PRELUDE//SCOPE_PLACEHOLDER/$SCOPE_JS}"

# ---------------- mode bodies ----------------

run_eval() {
  local body="$1"
  local code="(async () => { $PRELUDE
if (scopeError) return '__SCOPE_ERROR__' + scopeError;
$body
})()"
  local out
  out=$(obsidian eval code="$code" | sed '1s/^=> //')
  if [[ "$out" == __SCOPE_ERROR__* ]]; then
    echo "${out#__SCOPE_ERROR__}" >&2
    exit 2
  fi
  printf '%s\n' "$out"
}

case "$MODE" in
  tag)
    BODY=$(cat <<'JS'
const q = ARG_PLACEHOLDER;
const hits = [];
for (const f of app.vault.getMarkdownFiles()) {
  if (!inScope(f)) continue;
  if (f.basename === exclude) continue;
  const m = getMeta(f);
  if (m.tags.some(t => t === q || t.startsWith(q + "/"))) {
    hits.push({ name: m.name, summary: m.summary, pillar: m.pillar });
  }
}
hits.sort((a, b) => a.name.localeCompare(b.name, "zh"));
return formatOut(hits);
JS
)
    ;;
  title)
    BODY=$(cat <<'JS'
const q = ARG_PLACEHOLDER;
const hits = [];
for (const f of app.vault.getMarkdownFiles()) {
  if (!inScope(f)) continue;
  if (f.basename === exclude) continue;
  if (f.basename.includes(q)) {
    const m = getMeta(f);
    hits.push({ name: m.name, summary: m.summary, pillar: m.pillar });
  }
}
hits.sort((a, b) => a.name.localeCompare(b.name, "zh"));
return formatOut(hits);
JS
)
    ;;
  summary)
    BODY=$(cat <<'JS'
const q = ARG_PLACEHOLDER;
const hits = [];
for (const f of app.vault.getMarkdownFiles()) {
  if (!inScope(f)) continue;
  if (f.basename === exclude) continue;
  const m = getMeta(f);
  if (m.summary.includes(q)) {
    hits.push({ name: m.name, summary: m.summary, pillar: m.pillar });
  }
}
hits.sort((a, b) => a.name.localeCompare(b.name, "zh"));
return formatOut(hits);
JS
)
    ;;
  body)
    BODY=$(cat <<'JS'
const q = ARG_PLACEHOLDER;
const hits = [];
for (const f of app.vault.getMarkdownFiles()) {
  if (!inScope(f)) continue;
  if (f.basename === exclude) continue;
  const content = await app.vault.cachedRead(f);
  if (content.includes(q)) {
    const m = getMeta(f);
    hits.push({ name: m.name, summary: m.summary, pillar: m.pillar });
  }
}
hits.sort((a, b) => a.name.localeCompare(b.name, "zh"));
return formatOut(hits);
JS
)
    ;;
  keywords)
    # 多词评分：title 命中 3 分，summary 命中 2 分，body 命中 1 分，按分排
    BODY=$(cat <<'JS'
const raw = ARG_PLACEHOLDER;
const terms = raw.split(",").map(s => s.trim()).filter(Boolean);
if (terms.length === 0) return formatOut([]);
const hits = [];
for (const f of app.vault.getMarkdownFiles()) {
  if (!inScope(f)) continue;
  if (f.basename === exclude) continue;
  const m = getMeta(f);
  const content = await app.vault.cachedRead(f);
  let score = 0;
  const matched = [];
  for (const t of terms) {
    let hit = false;
    if (m.name.includes(t)) { score += 3; hit = true; }
    if (m.summary.includes(t)) { score += 2; hit = true; }
    if (content.includes(t) && !m.name.includes(t) && !m.summary.includes(t)) { score += 1; hit = true; }
    if (hit) matched.push(t);
  }
  if (score > 0) hits.push({ name: m.name, summary: m.summary, pillar: m.pillar, score, matched });
}
hits.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "zh"));
return formatOut(hits);
JS
)
    ;;
  outlinks)
    BODY=$(cat <<'JS'
const target = ARG_PLACEHOLDER;
const tf = app.vault.getMarkdownFiles().find(f => f.basename === target);
if (!tf) return "未找到笔记：" + target;
const m = getMeta(tf);
const hits = [];
const seen = new Set([target, exclude].filter(Boolean));
for (const name of m.links) {
  if (seen.has(name)) continue;
  seen.add(name);
  const linked = app.metadataCache.getFirstLinkpathDest(name, tf.path);
  if (!linked) { hits.push({ name, summary: "(未解析的双链)", pillar: "?" }); continue; }
  const lm = getMeta(linked);
  hits.push({ name: lm.name, summary: lm.summary, pillar: lm.pillar });
}
return formatOut(hits);
JS
)
    ;;
  backlinks)
    BODY=$(cat <<'JS'
const target = ARG_PLACEHOLDER;
const tf = app.vault.getMarkdownFiles().find(f => f.basename === target);
if (!tf) return "未找到笔记：" + target;
const back = app.metadataCache.getBacklinksForFile(tf);
const hits = [];
for (const [path, _] of (back?.data || new Map())) {
  const f = app.vault.getAbstractFileByPath(path);
  if (!f || f.basename === exclude) continue;
  if (!inScope(f)) continue;
  const m = getMeta(f);
  hits.push({ name: m.name, summary: m.summary, pillar: m.pillar });
}
hits.sort((a, b) => a.name.localeCompare(b.name, "zh"));
return formatOut(hits);
JS
)
    ;;
  neighbors)
    BODY=$(cat <<'JS'
const target = ARG_PLACEHOLDER;
const tf = app.vault.getMarkdownFiles().find(f => f.basename === target);
if (!tf) return "未找到笔记：" + target;
const seen = new Set([target, exclude].filter(Boolean));
const tier1 = [];
const tier2 = [];

const hop = (file, depth) => {
  const m = getMeta(file);
  for (const linkName of m.links) {
    if (seen.has(linkName)) continue;
    const linked = app.metadataCache.getFirstLinkpathDest(linkName, file.path);
    if (!linked || !inScope(linked)) continue;
    seen.add(linked.basename);
    const lm = getMeta(linked);
    const entry = { name: lm.name, summary: lm.summary, pillar: lm.pillar, via: depth === 1 ? "direct" : `via [[${file.basename}]]` };
    if (depth === 1) tier1.push({ ...entry, _file: linked });
    else tier2.push(entry);
  }
};

hop(tf, 1);
for (const t of tier1.slice()) hop(t._file, 2);

const all = [
  ...tier1.map(({_file, ...rest}) => rest),
  ...tier2
];
return formatOut(all);
JS
)
    ;;
  *)
    echo "未知模式：$MODE。见 find-related.sh --help" >&2
    exit 1
    ;;
esac

# 把 ARG_PLACEHOLDER 替换为真正的 JS 字符串字面量
BODY="${BODY//ARG_PLACEHOLDER/$ARG_JS}"

run_eval "$BODY"
