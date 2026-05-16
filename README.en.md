# BranchGuard

[![npm version](https://img.shields.io/npm/v/branchguard-cli.svg)](https://www.npmjs.com/package/branchguard-cli)
[![npm beta](https://img.shields.io/npm/v/branchguard-cli/beta.svg?label=beta)](https://www.npmjs.com/package/branchguard-cli)
[![license](https://img.shields.io/npm/l/branchguard-cli.svg)](./LICENSE)

BranchGuard is a lightweight Git merge conflict pre-check CLI and GitHub Action.

[中文说明](./README.md)

It answers one practical question before you merge:

> Will this branch conflict with my base branch, and where?

Current status: v0.3.0 is published on npm. The implementation is a zero-dependency Node.js CLI and is read-only by default. It does not create merge commits, change branches, write to the Git index, or upload code.

![BranchGuard terminal demo](./docs/assets/branchguard-demo.svg)

## Quick Start

Install from npm:

```bash
npm install --global branchguard-cli
branchguard doctor
```

Run from inside a Git repository:

```bash
branchguard init
branchguard check main feature/login
branchguard check main feature/login --markdown
branchguard check main feature/login --html --output branchguard-report.html
branchguard matrix --base main
```

## Commands

### `doctor`

Checks whether Git is available, whether the current directory is a Git repository, and whether the Git version supports the required merge-tree capability.

```bash
branchguard doctor
```

### `init`

Creates a default `.branchguard.json` file.

```bash
branchguard init
branchguard init --force
```

### `check`

Checks whether two refs can merge cleanly.

```bash
branchguard check <base> <head>
```

Examples:

```bash
branchguard check main feature/login
branchguard check origin/main HEAD --json
branchguard check origin/main HEAD --markdown
branchguard check origin/main HEAD --html --output branchguard-report.html
```

Exit codes:

- `0`: no conflict.
- `1`: command or environment error.
- `2`: conflicts detected.

### `matrix`

Checks local branches against a base branch.

```bash
branchguard matrix --base main
branchguard matrix --base main --limit 20
branchguard matrix --base main --markdown
branchguard matrix --base main --html --output branchguard-matrix.html
```

## Output Formats

BranchGuard supports text output by default, plus JSON, Markdown, and HTML:

```bash
branchguard check main feature/login --json
branchguard check main feature/login --markdown
branchguard check main feature/login --html --output branchguard-report.html
```

Reports include:

- Conflicting files.
- `LOW`, `MEDIUM`, or `HIGH` risk level.
- Directory-level risk summaries.
- Recent-contributor hints from `git log`.
- Ignored conflict counts.

HTML reports are self-contained files with inline CSS, so they work well as CI artifacts.

## GitHub Action

Pull request conflict check:

```yaml
name: BranchGuard

on:
  pull_request:
    branches:
      - main

permissions:
  contents: read
  issues: write
  pull-requests: read

jobs:
  conflict-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0

      - uses: wonderly321/branchguard-cli@v0.3.0
        with:
          base: origin/main
          head: HEAD
          format: markdown
          fail-on-risk: high
          comment: "true"
          github-token: ${{ github.token }}
```

`fail-on-risk` supports `any`, `high`, and `never`.

When `comment: "true"` is used, the Action creates or updates one BranchGuard pull request comment.

## Weekly Matrix Reports

```yaml
- uses: wonderly321/branchguard-cli@v0.3.0
  with:
    mode: matrix
    base: origin/main
    limit: 20
    format: html
    output: branchguard-weekly-report.html
    fail-on-risk: high

- uses: actions/upload-artifact@v7
  if: always()
  with:
    name: branchguard-weekly-report
    path: branchguard-weekly-report.html
```

## Webhooks

The GitHub Action supports generic, Feishu, and DingTalk webhook payloads:

```yaml
- uses: wonderly321/branchguard-cli@v0.3.0
  with:
    base: origin/main
    head: HEAD
    format: markdown
    fail-on-risk: high
    webhook-url: ${{ secrets.BRANCHGUARD_WEBHOOK_URL }}
    webhook-provider: feishu
    webhook-on: high
```

`webhook-provider` supports `generic`, `feishu`, and `dingtalk`.

`webhook-on` supports `conflict`, `high`, `always`, and `never`.

## Risk Levels

- `LOW`: no conflicts.
- `MEDIUM`: one or two normal file conflicts.
- `HIGH`: three or more conflicts, or conflicts in high-risk files.

High-risk files include lock files, migrations, schema files, OpenAPI files, proto files, and GraphQL files.

## Configuration

Default `.branchguard.json`:

```json
{
  "highRiskPatterns": [
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "Cargo.lock",
    "go.sum",
    "composer.lock",
    "db/migrations/**",
    "migrations/**",
    "schema/**",
    "openapi/**",
    "**/*.proto",
    "**/*.graphql"
  ],
  "ignorePatterns": [
    "dist/**",
    "coverage/**",
    "node_modules/**"
  ]
}
```

## Docs

- [Product roadmap](./docs/product-roadmap.md)
- [v0.3.0 release notes](./docs/releases/v0.3.0.md)
- [Release checklist](./docs/release-checklist.md)
- [npm publish guide](./docs/npm-publish.md)
- [SDD docs](./docs/sdd)
