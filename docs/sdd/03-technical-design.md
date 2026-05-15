# BranchGuard 技术设计

## 设计目标

- CLI first。
- read-only，不修改用户仓库。
- 无额外运行时依赖，优先单文件二进制分发。
- 第一版快速验证需求，不追求覆盖所有 Git 边界场景。

## 技术路线

### 当前原型路线

当前工作区先采用零依赖 Node.js CLI 原型，文件为 `bin/branchguard.mjs`。

原因：

- 当前开发环境没有 Go/Rust 工具链。
- Node 24 可直接运行，适合快速验证命令设计和 Git 行为。
- 不引入 npm 依赖，仍然贴近“无额外包依赖”的验证目标。

该路线用于 v0.1 需求验证。后续如果验证到真实付费意愿，再迁移到 Go 或 Rust 单文件二进制。

### 推荐路线

使用 Go 或 Rust 开发单文件 CLI。

短期建议：

- 如果目标是最快 MVP：Go。
- 如果目标是长期 Git 底层能力和性能：Rust。

本项目 v0.1 建议优先 Go，理由：

- 跨平台编译简单。
- 单文件发布方便。
- CLI、JSON、子进程调用开发速度快。
- 适合晚上和周末快速推进。

后续如果需要更深的 Git object 操作，可以再评估 Rust 或 Git 专用库。

## Git 检测策略

### 首选策略：调用 `git merge-tree`

使用：

```bash
git merge-tree --write-tree <base> <head>
```

优势：

- Git 官方能力。
- 不读写 working tree 或 index。
- 接近真实 merge 行为。

注意：

- 不同 Git 版本输出略有差异。
- 冲突文件信息需要谨慎解析。
- 需要在 `doctor` 中检测 Git 版本。

### 备选策略：临时 worktree / 临时 clone

当 `merge-tree` 不可用时：

1. 创建临时目录。
2. 使用当前仓库对象数据创建临时工作区。
3. 在临时工作区执行 merge。
4. 收集冲突结果。
5. 删除临时目录。

优势：

- 兼容性更好。

劣势：

- 更慢。
- 实现复杂。
- Windows 文件锁和长路径可能带来问题。

v0.1 可以先不实现备选策略，只在 `doctor` 中明确提示升级 Git。

## 模块设计

```text
cmd/
  branchguard/
    main.go

internal/
  cli/
    commands.go
    output.go
  git/
    repo.go
    merge_tree.go
    branches.go
  analysis/
    conflict.go
    risk.go
  config/
    config.go
  testrepo/
    fixtures.go
```

### cli 模块

职责：

- 参数解析。
- 命令分发。
- exit code 管理。
- 人类可读输出和 JSON 输出。

### git 模块

职责：

- 检测是否在 Git 仓库内。
- 获取 Git 版本。
- 校验分支是否存在。
- 调用 `git merge-tree`。
- 获取本地分支列表。

### analysis 模块

职责：

- 从 Git 输出中提取冲突文件。
- 标记冲突类型。
- 根据规则计算风险等级。
- 生成建议文案。

### config 模块

职责：

- 读取 `.branchguard.json`。
- 合并默认高风险规则。
- 提供 ignore pattern 和 high risk pattern。

v0.1 已在 Node 原型中实现配置读取和 `init` 生成。

## 数据结构

### CheckResult

```go
type CheckResult struct {
    Base          string         `json:"base"`
    Head          string         `json:"head"`
    HasConflict   bool           `json:"has_conflict"`
    RiskLevel     string         `json:"risk_level"`
    ConflictCount int            `json:"conflict_count"`
    ConflictFiles []ConflictFile `json:"conflict_files"`
    Summary       string         `json:"summary"`
}
```

### ConflictFile

```go
type ConflictFile struct {
    Path string `json:"path"`
    Type string `json:"type"`
    Risk string `json:"risk"`
}
```

### MatrixResult

```go
type MatrixResult struct {
    Base    string        `json:"base"`
    Entries []MatrixEntry `json:"entries"`
}
```

### MatrixEntry

```go
type MatrixEntry struct {
    Branch        string `json:"branch"`
    HasConflict   bool   `json:"has_conflict"`
    RiskLevel     string `json:"risk_level"`
    ConflictCount int    `json:"conflict_count"`
}
```

## 命令设计

### check

```bash
branchguard check main feature/login
branchguard check origin/main feature/login
branchguard check main HEAD
branchguard check main feature/login --json
```

行为：

- 校验仓库。
- 校验 base/head。
- 读取 `.branchguard.json`。
- 运行 merge simulation。
- 输出结果。
- 根据结果返回 exit code。

### init

```bash
branchguard init
branchguard init --force
branchguard init --json
```

行为：

- 在 Git 仓库根目录生成 `.branchguard.json`。
- 如果当前目录不在 Git 仓库内，则在当前目录生成。
- 默认不覆盖已有配置。
- `--force` 可覆盖已有配置。

### matrix

```bash
branchguard matrix --base main
branchguard matrix --base origin/main --limit 20
branchguard matrix --base main --json
```

行为：

- 获取本地分支列表。
- 排除 base 自身。
- 对每个分支执行 check。
- 汇总表格。

v0.1 只做 base vs each branch，不做全分支两两矩阵。全分支两两矩阵放到 v0.2。

### doctor

```bash
branchguard doctor
```

检查：

- 是否安装 Git。
- Git 版本。
- 是否在 Git 仓库。
- 当前仓库是否有至少两个分支。
- 当前工作区是否干净。

说明：

工作区不干净不一定阻止检查，但要提示，因为用户可能误解结果。

## 风险规则

默认高风险文件：

```text
package-lock.json
pnpm-lock.yaml
yarn.lock
Cargo.lock
go.sum
composer.lock
db/migrations/**
migrations/**
schema/**
openapi/**
**/*.proto
**/*.graphql
```

风险计算：

```text
if conflict_count == 0:
  LOW
else if contains_high_risk_file:
  HIGH
else if conflict_count >= 3:
  HIGH
else:
  MEDIUM
```

## 错误处理

常见错误：

- 当前目录不是 Git 仓库。
- Git 不存在。
- Git 版本过低。
- base/head 不存在。
- merge-tree 执行失败且不是冲突。
- 输出解析失败。

错误输出格式：

```text
Error: branch "feature/login" not found.
Hint: run `git branch --all` to check available branches.
```

JSON 错误格式：

```json
{
  "error": {
    "code": "BRANCH_NOT_FOUND",
    "message": "branch \"feature/login\" not found",
    "hint": "run `git branch --all` to check available branches"
  }
}
```

## 测试设计

测试 fixture：

- `clean_merge`：两个分支改不同文件，无冲突。
- `text_conflict`：两个分支改同一行。
- `modify_delete`：一边删除文件，一边修改文件。
- `lock_conflict`：两个分支同时修改 lock file。
- `missing_branch`：分支不存在。
- `not_git_repo`：非 Git 仓库。

自动化测试：

- 单元测试风险规则。
- 集成测试调用真实 Git。
- 快照测试 CLI 输出。
- Windows 路径测试。

## 发布方式

v0.1：

- GitHub Releases 提供 Windows/macOS/Linux 二进制。
- Homebrew Tap 可延后。
- npm wrapper 可延后。

后续：

- `winget`。
- `brew install branchguard`。
- `npx branchguard` 包装下载二进制。
- GitHub Action。

## 安全和隐私

- 默认不联网。
- 不上传仓库内容。
- 不收集 telemetry。
- 若未来加入 license 校验，需要明确开关和隐私说明。

## 后续扩展

v0.2：

- 全分支两两冲突矩阵。
- GitHub Action。
- HTML 报告。

v0.3：

- VS Code 插件。
- 飞书/钉钉通知。
- 冲突责任人识别。

v1.0：

- 团队版 license。
- 私有化部署报告服务。
- 更完整的 Git 边界场景支持。
