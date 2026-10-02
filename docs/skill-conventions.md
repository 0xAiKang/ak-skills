# Skill 写法规范

本仓库所有 skill 都按这份规范写。依据是 Anthropic 的《The Complete Guide to Building Skills for Claude》，再加上几条为了让 skill 能分享给别人用而定的规则。

改完 skill 后跑一遍检查脚本，它会检查下面能机械判断的那几条：

```bash
python3 tools/check_skills.py            # 检查全部 skill
python3 tools/check_skills.py ak-sprout  # 只检查一个
```

## 1. 目录与命名

- 每个 skill 放在 `skills/<name>/` 下。
- name 用 kebab-case（小写字母、数字、中划线），带 `ak-` 前缀，和文件夹同名。
- skill 目录里只放这几样：`SKILL.md`（必需）、`references/`（说明和模板）、`scripts/`（可执行脚本）、`config.example.json`（需要配置的 skill 才有）。
- skill 目录里不放 README。给人看的说明写在仓库根目录的 README.md 里。

## 2. frontmatter

字段和顺序固定如下：

```yaml
---
name: ak-xxx
description: ...
license: MIT
compatibility: ...
metadata:
  author: 0xAiKang
  version: 1.0.0
---
```

- `compatibility`：写环境要求，1–500 字符。比如需不需要 Obsidian、需不需要某个命令行工具。
- `metadata.version`：改了 skill 的行为就升版本号，方便用户更新时知道变了什么。

## 3. description

description 每次对话都会被加载，Agent 靠它决定要不要用这个 skill，是整个 skill 里最重要的一段。

- 用中文写，依次写三件事：**做什么**、**什么时候用**（列出用户会说的触发词，包括常见的英文说法）、**不用于什么**。
- 不超过 1024 字符。
- 不能有尖括号（`<` `>`）。
- 不写私人路径、本地工具名、人名。

## 4. 正文结构

按这个顺序写：

1. 一句话说明这个 skill 做什么。
2. 必须遵守的规则（放在最前面，避免被后面的内容淹没）。
3. 第 0 步：读配置（需要配置的 skill 才有，见第 10 节）。
4. 各个步骤，每一步写清楚这一步产出什么。
5. 示例（有合适的才写）。
6. 注意事项：实际使用中踩过的坑。

## 5. 语言

- 标题用中文。
- 称呼统一用「用户」。
- 技术名词保留原文，比如 frontmatter、Obsidian CLI、kebab-case。

## 6. 渐进式加载

- SKILL.md 正文只放核心指令，控制在 5000 词以内。
- 长模板、长参考资料放进 `references/`，正文里写清楚什么时候读哪个文件。

## 7. 路径

- 引用 skill 自己的文件，写相对 skill 目录的路径，比如 `scripts/scan.js`、`references/naming.md`。
- 不写绝对路径，不写某台电脑上特有的目录。

## 8. 隐私

正文、示例、注意事项里不出现真实姓名、真实路径、真实的笔记名和文件名、真实的日期和事件。示例一律虚构，或者取自已经公开发表的文章。

注意事项里的经验教训要保留，只是把「某月某日那次」改成「曾经有一次」这样的一般描述。

## 9. 运行时文件

日志、临时文件不写进 skill 目录。用户用 `npx skills update` 更新时，skill 目录会被整个替换，写在里面的东西会丢。

- 临时文件放 `/tmp/<skill-name>/`。
- 需要长期保留的文件（比如改名日志）放 `~/.config/ak-skills/<skill-name>/`，或者让用户在配置里指定。

## 10. 配置文件约定

skill 里和个人习惯有关的东西（笔记放在哪、文件名长什么样、日记里有哪些固定板块），不写死在 SKILL.md 里，而是放进配置文件。

- **位置**：`~/.config/ak-skills/<skill-name>.json`。不放在 skill 目录里，原因同第 9 节。
- **格式**：JSON。JSON 不能写注释，所以每个配置项的含义写在 SKILL.md「第 0 步」的表格里。
- **示例**：skill 目录里放一份 `config.example.json`，只写通用的默认值。检查脚本会核对：这个文件里的每个键都要在 SKILL.md 正文里出现。
- **首次运行**：读不到配置时，在对话里问用户必要的几项（每个 skill 不超过 4 个问题），把要写入的 JSON 给用户看，用户同意后再写入。用户不想保存，就只按这次的回答执行，不写文件。
