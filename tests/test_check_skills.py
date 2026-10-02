"""tools/check_skills.py 的测试：在临时目录里造一个假仓库，逐项验证检查规则。"""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

CHECKER = Path(__file__).resolve().parent.parent / "tools" / "check_skills.py"

VALID_FRONTMATTER = """---
name: ak-demo
description: 演示用的 skill。用户说「演示」时使用。不用于：其他任何事。
license: MIT
compatibility: 适用于任何支持 Agent Skills 的工具。
metadata:
  author: 0xAiKang
  version: 1.0.0
---
"""

VALID_BODY = """
# 演示

按 `references/guide.md` 执行。
"""


class CheckSkillsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.skill = self.root / "skills" / "ak-demo"
        (self.skill / "references").mkdir(parents=True)
        (self.skill / "references" / "guide.md").write_text("指南\n", encoding="utf-8")
        self.write_skill_md(VALID_FRONTMATTER, VALID_BODY)

    def tearDown(self):
        self.tmp.cleanup()

    def write_skill_md(self, frontmatter, body):
        (self.skill / "SKILL.md").write_text(frontmatter + body, encoding="utf-8")

    def run_checker(self, *args):
        result = subprocess.run(
            [sys.executable, str(CHECKER), "--root", str(self.root), *args],
            capture_output=True,
            text=True,
        )
        return result.returncode, result.stdout + result.stderr

    def test_valid_skill_passes(self):
        code, out = self.run_checker()
        self.assertEqual(code, 0, out)

    def test_name_must_match_folder(self):
        self.write_skill_md(VALID_FRONTMATTER.replace("name: ak-demo", "name: ak-other"), VALID_BODY)
        code, out = self.run_checker()
        self.assertEqual(code, 1)
        self.assertIn("name", out)

    def test_missing_license(self):
        self.write_skill_md(VALID_FRONTMATTER.replace("license: MIT\n", ""), VALID_BODY)
        code, out = self.run_checker()
        self.assertEqual(code, 1)
        self.assertIn("license", out)

    def test_description_too_long(self):
        long_desc = "长" * 1025
        self.write_skill_md(
            VALID_FRONTMATTER.replace(
                "description: 演示用的 skill。用户说「演示」时使用。不用于：其他任何事。",
                f"description: {long_desc}",
            ),
            VALID_BODY,
        )
        code, out = self.run_checker()
        self.assertEqual(code, 1)
        self.assertIn("description", out)

    def test_angle_bracket_in_frontmatter(self):
        self.write_skill_md(
            VALID_FRONTMATTER.replace("不用于：其他任何事。", "不用于：<其他>。"), VALID_BODY
        )
        code, out = self.run_checker()
        self.assertEqual(code, 1)
        self.assertIn("尖括号", out)

    def test_referenced_file_missing(self):
        self.write_skill_md(VALID_FRONTMATTER, VALID_BODY + "\n再读 `references/x.md`。\n")
        code, out = self.run_checker()
        self.assertEqual(code, 1)
        self.assertIn("references/x.md", out)

    def test_markdown_link_target_missing(self):
        self.write_skill_md(
            VALID_FRONTMATTER,
            VALID_BODY + "\n模板见 [references/guide.md](guide.md)。\n",
        )
        code, out = self.run_checker()
        self.assertEqual(code, 1)
        self.assertIn("guide.md", out)
        self.assertIn("链接", out)

    def test_external_and_anchor_links_ignored(self):
        self.write_skill_md(
            VALID_FRONTMATTER,
            VALID_BODY + "\n见 [官网](https://example.com) 和 [上文](#演示)。\n",
        )
        code, out = self.run_checker()
        self.assertEqual(code, 0, out)

    def test_readme_inside_skill_forbidden(self):
        (self.skill / "README.md").write_text("说明\n", encoding="utf-8")
        code, out = self.run_checker()
        self.assertEqual(code, 1)
        self.assertIn("README", out)

    def test_config_key_not_documented(self):
        (self.skill / "config.example.json").write_text(
            json.dumps({"fooDir": ""}), encoding="utf-8"
        )
        code, out = self.run_checker()
        self.assertEqual(code, 1)
        self.assertIn("fooDir", out)

    def test_privacy_hit(self):
        self.write_skill_md(VALID_FRONTMATTER, VALID_BODY + "\n这里提到了秘密词。\n")
        patterns = self.root / "patterns.txt"
        patterns.write_text("# 注释行\n秘密词\n", encoding="utf-8")
        code, out = self.run_checker("--privacy", str(patterns))
        self.assertEqual(code, 1)
        self.assertIn("秘密词", out)
        self.assertIn("skills/ak-demo/SKILL.md", out)


if __name__ == "__main__":
    unittest.main()
