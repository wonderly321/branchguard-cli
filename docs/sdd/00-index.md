# BranchGuard SDD 文档索引

BranchGuard 是一个暂定名，代表一个轻量 Git 冲突预检查工具。第一阶段先做 CLI，不先做完整 Git GUI 或 VS Code 插件。

核心目标：

> 合并前 10 秒告诉开发者：这两个分支会不会冲突，冲突在哪些文件，风险有多高。

## 文档列表

- [01-product-brief.md](./01-product-brief.md)：产品定位、目标用户、商业假设、成功指标。
- [02-requirements.md](./02-requirements.md)：用户故事、功能需求、非功能需求、MVP 验收标准。
- [03-technical-design.md](./03-technical-design.md)：技术方案、模块设计、命令设计、风险。
- [04-iteration-plan.md](./04-iteration-plan.md)：开发阶段、任务拆分、验证计划。

## 当前决策

- 产品形态：CLI first，后续再做 VS Code 插件、GitHub Action、飞书/钉钉通知。
- 技术卖点：无额外运行时依赖，单文件分发，只读检查，不修改用户仓库。
- 目标用户：5-10 人小团队、外包团队、新人多的团队、频繁并行开发的团队。
- 付费方向：团队版冲突矩阵、CI 检查、通知、报告、责任人识别。

## 术语

- base branch：通常是 `main`、`master`、`develop`。
- head branch：即将合并到 base 的功能分支。
- conflict risk：根据 Git 三方合并模拟结果、冲突文件数量、文件类型、锁文件等规则计算的风险等级。
- read-only check：只模拟合并，不修改工作区、index 或当前分支。
