# BranchGuard 中文推广包

目标不是“大规模曝光”，而是尽快找到 10 个真实小团队，把 BranchGuard 放进真实仓库跑起来。

## 当前定位

一句话：

> BranchGuard 是一个提前发现 Git 合并冲突的轻量 CLI / GitHub Action，适合 5-20 人小团队在 PR 或每周巡检时提前发现风险。

不要主打“自动解决冲突”。当前产品更适合主打：

- 合并前提前知道会不会冲突。
- PR 里自动留言，减少临上线才炸。
- 只在高风险冲突时阻塞 CI。
- 生成 HTML 报告，方便团队同步。
- 不上传代码，不依赖云服务。

## 首批目标用户

优先找这些人：

- 5-20 人业务研发团队的 Tech Lead。
- 外包或项目制团队负责人。
- 经常并行多需求开发的前后端团队。
- 已经在 GitHub Actions / GitLab CI 里跑检查的团队。
- 明确抱怨过 Git 冲突、PR 合并混乱、发布前回滚的人。

暂时不要优先找：

- 大厂成熟平台团队。
- 只想要完整 Git GUI 的个人用户。
- 期待自动解决复杂冲突的人。
- 不用 GitHub/GitLab CI 的纯本地团队。

## 7 天推广节奏

Day 0：准备材料

- 确认 npm 安装命令可用：`npm install -g branchguard-cli`
- 确认 GitHub Action 示例可复制。
- 准备 1 个真实 demo 截图或终端录屏。
- 打开反馈 issue，集中收问题。

Day 1：小范围真实用户

- 发给 5 个认识的程序员或 Tech Lead。
- 只问一个问题：能不能在你们一个真实仓库里跑一次？
- 不要求 star，不要求转发。

Day 2-3：开发者社区首发

- 发 V2EX 帖，语气保持“找真实团队试用/拍砖”。
- 发掘金技术文，重点讲实现和适用场景。
- 每条回复都记录到反馈 issue 或 metrics 文档。

Day 4-7：跟进转化

- 帮 3 个愿意试的团队接入 GitHub Action。
- 记录他们卡在哪里：安装、权限、CI、报告、默认策略。
- 暂停新功能开发，优先修“阻碍首次使用”的问题。

## 材料索引

- [V2EX 首发帖](./v2ex-launch-post.md)
- [掘金技术文](./juejin-article.md)
- [私信与跟进模板](./outreach-templates.md)
- [7 天指标记录](./metrics.md)
- [GitHub 反馈 issue 正文](./feedback-issue.md)

## 对外链接

- GitHub: https://github.com/wonderly321/branchguard-cli
- npm: https://www.npmjs.com/package/branchguard-cli
