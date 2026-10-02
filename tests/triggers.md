# 触发测试句

每个 skill 写 5 句应该触发它的话、3 句不该触发它的话。改了 description 之后用这些句子检查触发是否准确。

检查方法：把本机所有 skill 的 name 和 description 汇总给一个新开的 Agent，让它只根据 description 判断每句话会用哪个 skill（或者不用 skill），不执行任何 skill。应触发的句子要选中对应 skill，不应触发的句子不能选中它。

## ak-domain-learner

应触发：

1. 我想系统学一下量化交易，完全零基础
2. 帮我从零入门 Kubernetes
3. 给我讲讲保险这个行业，我想能跟内行聊
4. 继续学 Rust，接着上次
5. I want to learn color grading from zero

不应触发：

1. Docker 是什么？
2. 帮我读一下这个 PDF 并总结
3. 调研一下 2026 年的 AI Agent 框架

## ak-weekly-review

## ak-sprout

## ak-image-organize
