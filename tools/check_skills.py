#!/usr/bin/env python3
"""检查 skills/ 下每个 skill 的结构是否符合 docs/skill-conventions.md，可选做隐私扫描。

用法：
  python3 tools/check_skills.py [--root DIR] [--privacy FILE] [SKILL_NAME ...]

不给 SKILL_NAME 就检查 skills/ 下全部。全部通过退出码 0，有问题退出码 1，
每条问题输出一行「<位置>: <问题>」。

--privacy FILE：每行一个正则（# 开头为注释）。不给 SKILL_NAME 时扫描仓库里
除 docs/superpowers/、.git/、README.md 以外的所有文本文件；给了 SKILL_NAME 时
只扫这些 skill 的目录。
"""
import argparse
import json
import re
import sys
from pathlib import Path

import yaml

REQUIRED_KEYS = ["name", "description", "license", "compatibility", "metadata"]
NAME_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
VERSION_RE = re.compile(r"^\d+\.\d+\.\d+$")
# 只认 ASCII 路径：Python 的 \w 会匹配中文，会把正文里的「scripts/下的脚本」误判成文件引用
REF_RE = re.compile(r"(?:references|scripts)/[A-Za-z0-9_./-]+")
FORBIDDEN_NAMES = {"README.md", ".DS_Store"}
SKIP_DIRS = {".git", ".superpowers"}


def split_frontmatter(text):
    if not text.startswith("---\n"):
        return None, None, text
    end = text.find("\n---", 4)
    if end < 0:
        return None, None, text
    raw = text[4:end]
    body = text[end + 4 :]
    return raw, yaml.safe_load(raw), body


def check_skill(skill_dir):
    problems = []
    folder = skill_dir.name
    skill_md = skill_dir / "SKILL.md"
    if not skill_md.is_file():
        return [f"{folder}: 缺少 SKILL.md"]

    text = skill_md.read_text(encoding="utf-8")
    raw, fm, body = split_frontmatter(text)
    if fm is None or not isinstance(fm, dict):
        return [f"{folder}: frontmatter 缺失或无法解析"]

    keys = list(fm.keys())
    for key in REQUIRED_KEYS:
        if key not in fm:
            problems.append(f"{folder}: frontmatter 缺少 {key}")
    if keys != [k for k in REQUIRED_KEYS if k in fm] and all(k in fm for k in REQUIRED_KEYS):
        problems.append(f"{folder}: frontmatter 字段顺序应为 {', '.join(REQUIRED_KEYS)}")

    name = fm.get("name")
    if name != folder:
        problems.append(f"{folder}: name「{name}」与文件夹名不一致")
    elif not NAME_RE.match(name):
        problems.append(f"{folder}: name 必须是 kebab-case")

    desc = fm.get("description")
    if not isinstance(desc, str) or not desc.strip():
        problems.append(f"{folder}: description 为空")
    elif len(desc) > 1024:
        problems.append(f"{folder}: description 有 {len(desc)} 字符，超过 1024")

    if "license" in fm and fm["license"] != "MIT":
        problems.append(f"{folder}: license 应为 MIT")

    compat = fm.get("compatibility")
    if "compatibility" in fm and (not isinstance(compat, str) or not 1 <= len(compat) <= 500):
        problems.append(f"{folder}: compatibility 长度应为 1–500 字符")

    meta = fm.get("metadata")
    if "metadata" in fm:
        if not isinstance(meta, dict):
            problems.append(f"{folder}: metadata 应为对象")
        else:
            if meta.get("author") != "0xAiKang":
                problems.append(f"{folder}: metadata.author 应为 0xAiKang")
            if not VERSION_RE.match(str(meta.get("version", ""))):
                problems.append(f"{folder}: metadata.version 应为 x.y.z")

    if "<" in raw or ">" in raw:
        problems.append(f"{folder}: frontmatter 里不能有尖括号")

    for ref in sorted(set(REF_RE.findall(body))):
        ref = ref.rstrip(".")
        if not (skill_dir / ref).exists():
            problems.append(f"{folder}: 正文引用的 {ref} 不存在")

    for path in skill_dir.rglob("*"):
        rel = path.relative_to(skill_dir)
        if path.name in FORBIDDEN_NAMES or path.suffix == ".edtz":
            problems.append(f"{folder}: 不应包含 {rel}（skill 目录里不放 README、.DS_Store、.edtz）")
        if path.is_dir() and path.name == "logs":
            problems.append(f"{folder}: 不应包含运行日志目录 {rel}")

    example = skill_dir / "config.example.json"
    if example.is_file():
        try:
            config = json.loads(example.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            problems.append(f"{folder}: config.example.json 不是合法 JSON：{e}")
        else:
            for key in config:
                if key not in body:
                    problems.append(f"{folder}: 配置项 {key} 在 SKILL.md 正文里没有说明")

    return problems


def iter_text_files(base, root):
    for path in sorted(base.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(root)
        parts = rel.parts
        if parts[0] in SKIP_DIRS or rel.as_posix().startswith("docs/superpowers/"):
            continue
        if rel.as_posix() == "README.md":
            continue
        try:
            yield rel, path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue


def privacy_scan(patterns_file, bases, root):
    patterns = []
    for line in Path(patterns_file).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            patterns.append(re.compile(line))
    problems = []
    for base in bases:
        for rel, text in iter_text_files(base, root):
            for lineno, line in enumerate(text.splitlines(), 1):
                for pat in patterns:
                    if pat.search(line):
                        problems.append(f"{rel.as_posix()}:{lineno}: 隐私词「{pat.pattern}」")
    return problems


def main():
    parser = argparse.ArgumentParser(description="检查 skill 结构与隐私")
    parser.add_argument("--root", default=str(Path(__file__).resolve().parent.parent))
    parser.add_argument("--privacy")
    parser.add_argument("skills", nargs="*")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    skills_root = root / "skills"
    if args.skills:
        dirs = [skills_root / s for s in args.skills]
        missing = [d.name for d in dirs if not d.is_dir()]
        if missing:
            print(f"找不到 skill：{', '.join(missing)}")
            return 1
    else:
        dirs = sorted(d for d in skills_root.iterdir() if d.is_dir()) if skills_root.is_dir() else []

    problems = []
    for d in dirs:
        problems += check_skill(d)
    if args.privacy:
        bases = dirs if args.skills else [root]
        problems += privacy_scan(args.privacy, bases, root)

    for p in problems:
        print(p)
    if problems:
        print(f"共 {len(problems)} 个问题")
        return 1
    print(f"通过：检查了 {len(dirs)} 个 skill" + ("，隐私扫描无命中" if args.privacy else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
