# BranchGuard 需求规格

## 版本范围

本文定义 BranchGuard v0.1 MVP 的需求。v0.1 只做本地 CLI，不做 VS Code 插件、云端服务和支付系统。

## 用户故事

### US-001：检查两个分支是否会冲突

作为开发者，我希望在合并 `feature/login` 到 `main` 前运行一条命令，提前知道是否会发生冲突。

验收标准：

- 输入 base branch 和 head branch。
- 输出是否有冲突。
- 输出冲突文件列表。
- 命令不修改当前工作区、index 或分支。

### US-002：查看冲突风险等级

作为小团队负责人，我希望工具能告诉我冲突风险是低、中、高，而不是只给一堆 Git 原始输出。

验收标准：

- 无冲突时显示 `LOW`。
- 有少量普通文件冲突时显示 `MEDIUM`。
- 有多个文件、锁文件、数据库 migration、schema、路由配置等冲突时显示 `HIGH`。

### US-003：输出机器可读结果

作为 CI 维护者，我希望工具支持 JSON 输出，方便接入 GitHub Action 或 GitLab CI。

验收标准：

- 支持 `--json`。
- JSON 包含 base、head、has_conflict、risk_level、conflict_files、summary。
- 有冲突时可以通过 exit code 区分。

### US-004：查看多个分支的冲突矩阵

作为技术负责人，我希望一次性查看多个分支之间的潜在冲突，方便安排合并顺序。

验收标准：

- 支持 `matrix` 命令。
- 默认以当前仓库本地分支为候选。
- 支持指定 base，例如 `branchguard matrix --base main`。
- 输出表格展示每个分支和 base 的冲突文件数量。

### US-005：诊断本地环境

作为用户，我希望当工具不可用时能知道原因，例如 Git 版本太低、当前目录不是 Git 仓库、分支不存在。

验收标准：

- 支持 `doctor` 命令。
- 检查 Git 是否可用。
- 检查 Git 版本是否支持所需能力。
- 检查当前目录是否在 Git 仓库内。

## 功能需求

### REQ-001：基础命令结构

工具命令名暂定为 `branchguard`。

必须支持：

```bash
branchguard init [--force] [--json]
branchguard check <base> <head>
branchguard check <base> <head> --json
branchguard matrix --base <base>
branchguard doctor
branchguard --help
branchguard --version
```

### REQ-002：冲突检测

`check` 命令必须模拟 base 与 head 的三方合并。

要求：

- 不改变当前工作区。
- 不改变 Git index。
- 不产生 merge commit。
- 能识别 Git 报告的文本冲突。
- 能识别常见的 delete/modify、rename、file/directory 等冲突类型，若底层 Git 可提供。

### REQ-003：输出格式

默认人类可读输出：

```text
BranchGuard
Base: main
Head: feature/login

Risk: HIGH
Conflicts: 4 files

src/api/user.ts
src/pages/Login.vue
package-lock.json
db/migrations/202605160001_add_user_table.sql

Suggestion:
- Merge or rebase feature/login sooner.
- Resolve lock file carefully.
- Ask owners of src/api/user.ts to coordinate.
```

JSON 输出示例：

```json
{
  "base": "main",
  "head": "feature/login",
  "has_conflict": true,
  "risk_level": "HIGH",
  "conflict_count": 4,
  "conflict_files": [
    {
      "path": "src/api/user.ts",
      "type": "content",
      "risk": "MEDIUM"
    },
    {
      "path": "package-lock.json",
      "type": "content",
      "risk": "HIGH"
    }
  ],
  "summary": "4 conflicting files detected"
}
```

### REQ-004：退出码

退出码定义：

- `0`：检查成功，无冲突。
- `1`：运行错误，例如不是 Git 仓库、分支不存在、Git 不可用。
- `2`：检查成功，但发现冲突。

### REQ-005：风险等级规则

初版风险规则：

- `LOW`：无冲突。
- `MEDIUM`：1-2 个普通源码文件冲突。
- `HIGH`：满足任一条件：
  - 冲突文件数量大于等于 3。
  - 包含 lock file，例如 `package-lock.json`、`pnpm-lock.yaml`、`yarn.lock`、`Cargo.lock`。
  - 包含 migration 文件。
  - 包含 schema、OpenAPI、GraphQL、proto 文件。
  - 包含二进制文件冲突。

### REQ-006：配置文件

v0.1 支持配置文件。

配置文件名：

```text
.branchguard.json
```

可能配置：

```json
{
  "highRiskPatterns": [
    "package-lock.json",
    "pnpm-lock.yaml",
    "db/migrations/**",
    "openapi/**",
    "**/*.proto"
  ],
  "ignorePatterns": [
    "dist/**",
    "coverage/**"
  ]
}
```

要求：

- `branchguard init` 可以生成默认配置。
- `branchguard init --force` 可以覆盖已有配置。
- `highRiskPatterns` 用于标记高风险冲突。
- `ignorePatterns` 用于忽略非行动项冲突。
- 如果所有冲突都被忽略，命令返回 `0`，JSON 输出保留 `ignored_conflict_count`。

### REQ-007：跨平台

v0.1 目标平台：

- Windows 10/11。
- macOS。
- Linux。

要求：

- 路径输出统一使用 `/`。
- Windows 下不能依赖 Bash。
- 命令参数解析在 PowerShell、CMD、Git Bash 中都应可用。

## 非功能需求

### NFR-001：安全

- 默认只读。
- 不上传代码。
- 不读取非当前仓库的业务文件，除非 Git 检查需要。
- 不执行远程脚本。

### NFR-002：性能

目标：

- 中小仓库，单次 `check` 在 1 秒内完成。
- 10 个分支以内的 `matrix` 在 10 秒内完成。

如果仓库过大，需要显示进度或提示。

### NFR-003：兼容性

- 优先使用本机 Git 的稳定能力。
- 如果 Git 版本不支持所需能力，输出明确诊断。
- 后续可以引入纯 Git 库实现更强兼容，但 v0.1 不强求。

### NFR-004：可测试性

必须包含：

- 人造冲突仓库 fixture。
- 无冲突场景测试。
- 文本冲突测试。
- delete/modify 测试。
- lock file 高风险规则测试。
- JSON 输出快照测试。

## MVP 不做事项

- 不做自动解决冲突。
- 不做 GUI。
- 不做 VS Code 插件。
- 不做账号系统。
- 不做云端同步。
- 不做团队权限管理。
- 不做复杂 AI 建议。

## MVP 验收清单

- 可以安装并运行 `branchguard --version`。
- 可以在真实 Git 仓库运行 `branchguard check main feature/foo`。
- 有冲突时列出冲突文件并返回 exit code `2`。
- 无冲突时返回 exit code `0`。
- 错误场景返回 exit code `1` 并给出可读错误。
- 支持 `--json`。
- 支持 `doctor`。
- 支持 `init`。
- 支持 `.branchguard.json` 的 `highRiskPatterns` 和 `ignorePatterns`。
- 有 README 示例和 3 个演示仓库场景。
