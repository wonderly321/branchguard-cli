# 掘金技术文草稿

# 我做了一个提前发现 Git 合并冲突的 CLI：BranchGuard

## 1. 问题不是不会解冲突，而是发现太晚

小团队里 Git 冲突最烦的地方，通常不是技术上完全不会解决，而是发生时间不对。

常见场景：

- 多个 feature 分支并行开发。
- PR 快合并时才发现核心文件冲突。
- 上线前统一集成，临时找人协调。
- 新人或外包同学不熟悉分支规范。
- 冲突结果只出现在某个人本地，团队其他人不知道。

所以 BranchGuard 没有尝试做完整 Git GUI，也不做自动解冲突。它只做一个更早的提醒：

> 这个分支合到 main 之前，会不会冲突？

## 2. BranchGuard 是什么

BranchGuard 是一个轻量 CLI / GitHub Action。

本地用法：

```bash
npm install -g branchguard-cli
branchguard doctor
branchguard check main feature/login
branchguard matrix --base main
```

CI 用法：

```yaml
- uses: wonderly321/branchguard-cli@v0.3.1
  with:
    base: origin/main
    head: HEAD
    format: markdown
    fail-on-risk: high
    comment: "true"
    github-token: ${{ github.token }}
```

它会输出：

- 是否存在冲突。
- 冲突文件列表。
- 风险等级：`LOW` / `MEDIUM` / `HIGH`。
- 按目录聚合的风险摘要。
- 最近贡献者提示。
- Markdown / HTML / JSON 报告。

## 3. 为什么选择 `git merge-tree`

BranchGuard 的核心原则是只读：

- 不切换分支。
- 不创建 merge commit。
- 不写 Git index。
- 不上传代码。

在较新的 Git 版本里，它优先使用：

```bash
git merge-tree --write-tree <base> <head>
```

这可以在不污染工作区的情况下推演一次合并。旧版 Git 会走兼容解析逻辑。

## 4. 为什么需要风险等级

并不是所有冲突都应该阻塞团队。

例如普通 UI 文案冲突，可以提醒开发者协调；但这些文件冲突往往更危险：

- `package-lock.json`
- `pnpm-lock.yaml`
- `db/migrations/**`
- `schema/**`
- `openapi/**`
- `*.proto`
- `*.graphql`

所以 BranchGuard 支持：

```yaml
fail-on-risk: high
```

意思是：普通冲突先报告，高风险冲突才让 CI 失败。

## 5. PR 评论比 CI 日志更重要

很多 CI 检查的问题不是“没跑”，而是结果没人看。

BranchGuard 支持在 PR 下创建或更新一条评论，团队成员不需要点进 CI 日志，也能看到冲突文件、风险等级和建议协调人。

这对小团队尤其重要，因为问题会出现在协作界面，而不是藏在某个开发者本地。

## 6. 适合谁，不适合谁

适合：

- 5-20 人小团队。
- 多分支并行开发。
- 想在 PR 阶段提前发现冲突。
- 想保留轻量、透明、可放进 CI 的工具链。

不适合：

- 想要完整 Git GUI 的用户。
- 期待工具自动解决复杂冲突。
- 已经有成熟内部研发平台的大团队。

## 7. 当前状态

BranchGuard 目前已经发布到 npm：

```bash
npm install -g branchguard-cli
```

项目地址：

- GitHub: https://github.com/wonderly321/branchguard-cli
- npm: https://www.npmjs.com/package/branchguard-cli

现在最想收集真实反馈：

- 你们团队每周大概遇到几次冲突？
- 你更希望它出现在 PR 评论、飞书通知，还是每周 HTML 报告？
- 高风险才阻塞 CI 是否合理？
- 什么能力会让你愿意把它作为团队流程的一部分？

