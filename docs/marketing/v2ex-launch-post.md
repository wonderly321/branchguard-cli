# V2EX 首发帖草稿

## 标题备选

- 做了一个提前发现 Git 合并冲突的小工具，想找小团队试用
- 不想为了冲突预检装重型 Git GUI，于是做了个轻量 CLI
- 给 5-20 人小团队用的 Git 冲突预警工具，想听真实反馈

## 正文

大家好，我最近做了一个开源小工具 BranchGuard，想找真实小团队试用一下。

它解决的问题很窄：

> 一个分支合到 main 之前，会不会产生冲突？冲突在哪些文件？风险高不高？应该找谁协调？

我自己观察到的场景是：小团队不是不会解决冲突，而是经常发现得太晚。PR 快合并、上线前集成、多个 feature 分支并行时，才发现一堆文件互相压着。IDE 里的冲突解决工具很好用，但它通常不适合在 CI 里提前提醒团队。

BranchGuard 现在能做这些：

- 本地一行命令检查两个 ref 是否会冲突。
- GitHub Action 在 PR 阶段自动检查。
- 生成 Markdown / HTML / JSON 报告。
- 只在高风险冲突时阻塞 CI，普通冲突可以先提醒。
- PR 自动评论，避免结果只躺在 CI 日志里。
- 飞书 / 钉钉 webhook 通知。
- 不上传代码，不依赖云服务。

安装：

```bash
npm install -g branchguard-cli
branchguard doctor
branchguard check main feature/login
branchguard matrix --base main
```

GitHub Action 示例：

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

项目地址：

- GitHub: https://github.com/wonderly321/branchguard-cli
- npm: https://www.npmjs.com/package/branchguard-cli

想重点请教几个问题：

1. 你们团队有没有“快合并才发现冲突”的高频痛点？
2. PR 自动评论对你们有用，还是 HTML artifact 更有用？
3. `fail-on-risk: high` 作为默认策略是否合理？
4. 飞书、钉钉、企业微信、Slack，哪个通知更值得优先做深？
5. 这种工具如果有团队版，你们觉得什么能力值得付费？

目前还很早期，我更想先找到真实使用场景，而不是堆功能。愿意试的朋友可以直接在 GitHub 提 issue，也可以在楼里说你们团队的协作方式。

