---
name: ak-image-organize
description: 整理 Obsidian 库里名字没有意义的图片附件（Pasted image、截屏、IMG_1234、带时间戳尾巴的文件名等）：结合图片画面和引用它的笔记上下文，起一个脱离笔记也能认出来的名字，归档到附件目录。全程用 Obsidian 自己的改名接口，保证双链不断；改完做断链校验，出问题可以回滚。用户说「整理图片」「整理附件」「图片改名」「这些图没名字」「归档附件」「处理截图」时使用。不用于：压缩、裁剪、转换图片格式；生成或编辑图片；整理 Obsidian 以外的相册或文件夹。
license: MIT
compatibility: 必须在 Obsidian 桌面端里运行，并启用 Obsidian CLI：脚本通过 obsidian eval 调用 Obsidian 自己的改名接口和链接索引。不支持其他编辑器。
metadata:
  author: 0xAiKang
  version: 1.0.0
---

# Obsidian 图片整理

把没有语义的图片文件名，改成脱离上下文也能认出来的名字，并归档到附件目录，全程不断链。

## 零、读配置

脚本从 `~/.config/ak-skills/ak-image-organize.json` 读配置，配置项如下：

| 配置项 | 含义 | 示例 |
|---|---|---|
| `archiveDir` | 必填。起好名字的图归档到这个目录（库内相对路径） | `attachments` |
| `pendingDir` | 可选。新粘贴的图落在哪个目录，也就是待处理区（库内相对路径，`/` 表示库根目录）。不填就按 Obsidian「设置 → 文件与链接 → 附件默认存放路径」 | `/` |
| `logDir` | 可选。改名日志目录（绝对路径，可以用 `~`），回滚靠它。默认 `~/.config/ak-skills/ak-image-organize` | `~/.config/ak-skills/ak-image-organize` |

**读不到配置时**（脚本会返回「找不到配置」），在对话里最多问 2 个问题：

1. 起好名字的图归档到哪个目录？
2. 新粘贴的图落在哪里？不知道就按 Obsidian 的附件设置。

把要写入的 JSON 给用户看，用户同意后写入。脚本只认这个文件，所以本 skill 必须有配置文件才能运行；用户不同意写入，就停下来说明原因。

## 一、位置即状态

这个 skill 用**图片所在位置**区分处理状态，不是用文件名前缀：

| 位置 | 含义 |
|---|---|
| `pendingDir`（待处理区） | Obsidian 粘贴的图默认落在这里，名字多半没有语义 |
| `archiveDir`（归档区） | **已归档区**。名字已有语义 |

待处理区和归档区分开时，位置本身就标记了处理状态：待处理区里还有图，就说明还有图没整理。两者是同一个目录，或者 Obsidian 的附件设置是「与笔记同目录」时，位置区分不了状态，脚本只按文件名判断。

**不要擅自建议用户改 Obsidian 的附件设置。** 待处理区和归档区分开，往往是用户有意的安排：图一旦混进归档目录，就分不出哪些还没处理。

判定一张图要不要处理：**先看位置，再看名字是否承载语义**。无语义的特征——

- `Pasted image 20240101120000.png`、`截屏2026-07-19 10.00.00.png`、`Screenshot ....png`、`CleanShot ....png`
- `IMG_1234.jpg`、`PXL_...`、`mmexport...`、`微信图片_...`
- `image.png`、`未命名.png`、`图片 1.png`
- **主题名后挂 10 位以上时间戳**：`某某笔记标题-1782803047329.webp` —— 主体有语义但尾巴是垃圾，属于半成品，也要处理（举例一律用虚构名，别写真实文件名，否则日后 grep 查残留会误命中本文档）

## 二、绝不手工改链接

用 `app.fileManager.renameFile(file, newPath)`。它在重命名/移动的同时，由 Obsidian 自动改写全库所有引用。

为什么不能 grep 替换 `![[旧文件名]]`：

- 漏 `![[图.png|300]]` 这类带尺寸/别名参数的嵌入
- 漏 `.canvas` 文件里的节点引用、Excalidraw 嵌入（装了 Excalidraw 插件时）
- Obsidian 的新链接格式设为「尽可能简短」（`newLinkFormat = shortest`）时，同一张图的链接可能写全路径也可能只写文件名，正则覆盖不全

`renameFile` 走 Obsidian 内部链接索引，上述情况全部覆盖。这是「保证不断链」从人工承诺变成机制保证的唯一方式。

对应地：**不要用 shell 的 `mv`，也不要用 `app.vault.rename`**——后者是底层 API，不更新链接。

## 三、执行流程

四步，有硬闸门，不能跳步。所有脚本都在本 skill 的 `scripts/` 下，用 `obsidian eval` 跑，每次都要把 `scripts/config.js` 拼在前面：

```bash
obsidian eval code="$(cat "<skill目录>/scripts/config.js" "<skill目录>/scripts/<脚本名>")"
```

`<skill目录>` 换成本 SKILL.md 所在目录的绝对路径。Obsidian 桌面端要开着，命令作用于当前打开的库。

### 1. 记基线 + 扫描

```bash
obsidian eval code="$(cat "<skill目录>/scripts/config.js" "<skill目录>/scripts/verify.js")"   # 存基线
obsidian eval code="$(cat "<skill目录>/scripts/config.js" "<skill目录>/scripts/scan.js")"
```

scan 返回「找不到配置」时，先回到「零、读配置」。

`verify.js` 首次运行会把当前全库未解析链接数写进基线文件，最后一步用它做差值比对。

`scan.js` 默认只取 **10 张**。要改批量或指定文件，先写配置：

```bash
mkdir -p /tmp/ak-image-organize
cat > /tmp/ak-image-organize/scan-config.json <<'JSON'
{ "limit": 5, "files": [] }
JSON
```

`files` 填具体文件名则只扫这几张，忽略 `limit`。

**`limit` 是软上限。** scan 按「引用它的笔记」分组，同一篇笔记里的图必定同批返回，不会从中间切断——否则系列图的编号会跨批次算错。所以实际返回数量可能超过 limit，这是正确行为，不要因此调小 limit 重跑。

**默认走小批量。** 用户没指定数量时不要一次跑几十张——批量越大，命名质量越糊，出问题回滚成本也越高。

scan 为每张图输出：路径、大小、判定理由、引用它的笔记标题与前后文、`siblingsInSameNote`（同笔记引用的其他图，含已归档的）。最后一项用于延续系列编号和避开撞名。

### 2. 命名

对每张图：

1. **看图**：用 Read 工具读图片文件，理解画面内容。
2. **看语境**：读 scan 给出的引用笔记标题 + 图片前后文。
3. **合成名字**：语境决定「这张图在讲什么」，画面决定「具体是什么」。两者冲突时以语境为准——名字要服务于「在笔记里找得到、认得出」。

命名标准与正反例 → 读 `references/naming.md`。这一步是全流程质量的瓶颈，**不要跳过**。

无人引用的孤儿图：无语境可依，只能靠画面命名，且在报告里单独标出——它们可能是废图，删不删由用户定，**skill 不删任何文件**。

### 3. 确认（硬闸门）

输出预览表，**等用户点头才能进第 4 步**：

| 旧文件名 | 新文件名 | 引用笔记 | 命名依据 |
|---|---|---|---|

批量重命名会改写大量笔记，难以回滚。没有明确确认就执行，属于越权。

### 4. 执行 + 校验

把确认后的方案写成 plan，再执行：

```bash
cat > /tmp/ak-image-organize/plan.json <<'JSON'
[ { "from": "旧文件名.webp", "to": "新文件名.webp" } ]
JSON
obsidian eval code="$(cat "<skill目录>/scripts/config.js" "<skill目录>/scripts/apply.js")"
obsidian eval code="$(cat "<skill目录>/scripts/config.js" "<skill目录>/scripts/verify.js")"
```

`from` 用文件名或完整路径都行；`to` 只写文件名（含扩展名），目标目录由配置项 `archiveDir` 决定。扩展名不要改。

`apply.js` 会在改名前做全库同名校验并跳过冲突项，同时把每一条 `from → to` 追加到 `logDir` 下的 `rename-log.jsonl`。

`verify.js` 第二次运行做差值比对：**未解析链接数必须与基线一致**。多出来的每一条都会被列出——那就是断链，立刻用 `scripts/rollback.js` 回滚最近一批（同样要拼上 config.js）。

最后向用户报告：成功数、跳过数（及原因）、断链校验结果。

## 四、注意事项

- **改名前必须全库查同名**。Obsidian 链接格式为「尽可能简短」时，链接通常只写文件名。一旦出现两个同名文件，`![[某图.png]]` 指向哪一个就不确定了，等于隐性断链。`apply.js` 已内建该校验，但你自己手动操作时要记得。
- **冲突不要粗暴加 1、2、3**。同主题的系列图用 `主题 2.png`、`主题 3.png`（空格分隔）；不同主题撞名说明名字取得不够具体，回去重新命名而不是加后缀。
- **一张图被多篇笔记引用很常见**，名字要取多处语境的公约数，别只看第一篇。scan 会把所有引用位置都列出来。
- **`.md` 之外的引用**：canvas 和 Excalidraw 的引用不出现在 `resolvedLinks` 里，扫描时统计不到，但 `renameFile` 会正确更新它们。所以「显示 0 引用」不等于孤儿——真删之前需人工确认。
- **不要用 `obsidian eval` 跑纯读操作**（启动开销大）。本 skill 的 scan/verify 用 eval 是因为需要 `metadataCache` 的链接索引，shell 拿不到。
- **`obsidian` 命令卡死**时，常见根因是安装包版本落后于后台自动更新的应用代码，两层版本不一致。重启 Obsidian 无效，需要重新下载安装最新安装包。跑命令时可用 `perl -e 'alarm 40; exec @ARGV' obsidian ...` 加超时保护，避免锁死终端。
- **eval 里不要 return TFile 之类不能 JSON 化的对象**，会卡住或输出 `[object Object]`。脚本一律 `return JSON.stringify(...)`。
- **装了同步插件时，apply.js 的输出可能被同步日志刷屏**（有的同步插件每次文件变动都打日志）。管道过滤掉再看：

  ```bash
  ... | grep -v -E "Graph cache|changed but|ServiceDatabase|Entry removed"
  ```

- **改完图别急着下结论，做一次不依赖缓存的独立验证**：`grep` 笔记原文确认新链接已写入、旧文件名零残留。`verify.js` 读的是 `metadataCache`，与磁盘真实内容是两个来源，两边都对上才算真的没断。
- **图在表格单元格里时**（如日记里的左右对照表），改名后要回头确认表头与图的对应关系没错位——这类图的语义完全依赖所在列，错位了文件名就是错的，但断链检查发现不了。
- **先分「只需搬家」和「需要命名」两类，再分批。** 待处理区里常有一批名字已经有语义、只是没归档的图（曾经有一次占了约 1/4）。这类 `from` 和 `to` 写成同名直接搬，不用看图不用命名，风险几乎为零；剩下带时间戳尾巴的才需要逐张看图。混在一起按固定批量切，等于把机械操作和判断操作一起拖慢。
- **scan 给的前后文未必是图真正对应的段落。** 它取的是文件名出现位置的 ±3 行，但图可能被贴在与上文无关的位置。曾经遇到一对图：上文在讲终端代理配置，画面却是「笔记内容变空白 → 用版本历史找回」。**画面与语境明显冲突时，别硬按语境编名字**——按画面命名，并把这处图文错配单独报给用户，可能是当时贴错了位置。
