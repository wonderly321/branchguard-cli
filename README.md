# BranchGuard

[![npm version](https://img.shields.io/npm/v/branchguard-cli.svg)](https://www.npmjs.com/package/branchguard-cli)
[![npm beta](https://img.shields.io/npm/v/branchguard-cli/beta.svg?label=beta)](https://www.npmjs.com/package/branchguard-cli)
[![license](https://img.shields.io/npm/l/branchguard-cli.svg)](./LICENSE)

BranchGuard is a lightweight Git merge conflict pre-check CLI.

npm package: `branchguard-cli`

Repository: [wonderly321/branchguard-cli](https://github.com/wonderly321/branchguard-cli)

It answers one practical question before you merge:

> Will this branch conflict with my base branch, and where?

Current status: v0.3.0 is published on npm. The implementation is a zero-dependency Node.js CLI so the product workflow can be validated quickly. The SDD documents still keep the longer-term Go/Rust single-binary direction.

![BranchGuard terminal demo](./docs/assets/branchguard-demo.svg)

## Usage

Install from npm:

```bash
npm install --global branchguard-cli
branchguard doctor
```

Install from GitHub:

```bash
npm install --global github:wonderly321/branchguard-cli
branchguard doctor
```

Run from inside a Git repository:

```bash
branchguard init
branchguard check main feature/login
branchguard check main feature/login --json
branchguard check main feature/login --markdown
branchguard check main feature/login --markdown --output branchguard-report.md
branchguard check main feature/login --html --output branchguard-report.html
branchguard matrix --base main
```

Or run the local checkout:

```bash
node ./bin/branchguard.mjs check main feature/login
```

## Commands

### `init`

Creates a default `.branchguard.json` file.

```bash
node ./bin/branchguard.mjs init
node ./bin/branchguard.mjs init --force
```

### `doctor`

Checks whether Git is available, whether the current directory is a Git repository, and whether modern `git merge-tree --write-tree` is available.

```bash
node ./bin/branchguard.mjs doctor
```

### `check`

Checks whether two refs can merge cleanly.

```bash
node ./bin/branchguard.mjs check <base> <head>
```

Example:

```bash
node ./bin/branchguard.mjs check main feature/login
node ./bin/branchguard.mjs check main feature/login --markdown
node ./bin/branchguard.mjs check main feature/login --markdown --output branchguard-report.md
node ./bin/branchguard.mjs check main feature/login --html --output branchguard-report.html
```

Exit codes:

- `0`: no conflict.
- `1`: command or environment error.
- `2`: conflicts detected.

### `matrix`

Checks all local branches against a base branch.

```bash
node ./bin/branchguard.mjs matrix --base main
node ./bin/branchguard.mjs matrix --base main --limit 20
node ./bin/branchguard.mjs matrix --base main --json
node ./bin/branchguard.mjs matrix --base main --markdown
node ./bin/branchguard.mjs matrix --base main --markdown --output branchguard-matrix.md
node ./bin/branchguard.mjs matrix --base main --html --output branchguard-matrix.html
```

## Output Formats

BranchGuard supports human text output by default, plus JSON, Markdown, and HTML for automation:

```bash
branchguard check main feature/login --json
branchguard check main feature/login --markdown
branchguard check main feature/login --markdown --output branchguard-report.md
branchguard check main feature/login --html --output branchguard-report.html
```

`--output <file>` writes the same report that is printed to stdout. Parent directories are created automatically.

Markdown, HTML, and JSON reports include a directory summary so teams can quickly see which module or root-level file is creating the most risk.

HTML reports are self-contained files with inline CSS, so they work well as CI artifacts.

Reports also include lightweight recent-contributor hints from `git log` on the base and head refs. These are not strict code ownership rules; they are quick routing hints for who may know the conflicting files best.

## CI

See [docs/examples/github-action.yml](./docs/examples/github-action.yml) for a GitHub pull request conflict check example.

See [docs/examples/github-weekly-report.yml](./docs/examples/github-weekly-report.yml) for a scheduled weekly branch conflict report.

See [docs/examples/gitlab-ci.yml](./docs/examples/gitlab-ci.yml) for a GitLab merge request conflict check example.

Direct GitHub Action usage:

```yaml
permissions:
  contents: read
  issues: write
  pull-requests: read

steps:
  - uses: actions/checkout@v4
    with:
      fetch-depth: 0

  - uses: wonderly321/branchguard-cli@main
    with:
      base: origin/main
      head: HEAD
      format: markdown
      fail-on-risk: high
      comment: "true"
      github-token: ${{ github.token }}
```

For the published v0.2.0 action, pin the action without PR comments:

```yaml
- uses: wonderly321/branchguard-cli@v0.2.0
  with:
    base: origin/main
    head: HEAD
    format: markdown
```

When `format: markdown` is used, the Action can also write the report to the GitHub Actions step summary.

The step summary includes a scan-friendly result table, recommended next step, and detailed report.

Use `fail-on-risk: high` when a team wants normal conflicts to create comments and summaries without blocking CI. Supported values are `any`, `high`, and `never`. The older `fail-on-conflict` input still works for compatibility.

When `comment: "true"` is used on `main`, the Action creates or updates one BranchGuard pull request comment.

Team webhook notifications:

```yaml
- uses: wonderly321/branchguard-cli@main
  with:
    base: origin/main
    head: HEAD
    format: markdown
    fail-on-risk: high
    webhook-url: ${{ secrets.BRANCHGUARD_WEBHOOK_URL }}
    webhook-provider: feishu
    webhook-on: high
```

`webhook-provider` supports `generic`, `feishu`, and `dingtalk`. `webhook-on` supports `conflict`, `high`, `always`, and `never`. Webhook delivery failures do not fail CI unless `webhook-fail-on-error: "true"` is set.

HTML artifact usage:

```yaml
- uses: wonderly321/branchguard-cli@main
  with:
    base: origin/main
    head: HEAD
    format: html
    output: branchguard-report.html
    fail-on-risk: high

- uses: actions/upload-artifact@v4
  if: always()
  with:
    name: branchguard-report
    path: branchguard-report.html
```

Weekly matrix report usage:

```yaml
- uses: wonderly321/branchguard-cli@main
  with:
    mode: matrix
    base: origin/main
    limit: 20
    format: html
    output: branchguard-weekly-report.html
    fail-on-risk: high
```

## Risk Levels

- `LOW`: no conflicts.
- `MEDIUM`: one or two normal file conflicts.
- `HIGH`: three or more conflicts, or conflicts in high-risk files.

High-risk files currently include lock files, migrations, schema files, OpenAPI files, proto files, and GraphQL files.

Directory risk is grouped from conflicting files. A directory is marked `HIGH` when it contains a high-risk conflict or three or more conflicting files.

## Configuration

Create a config file:

```bash
node ./bin/branchguard.mjs init
```

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

`highRiskPatterns` marks matching conflicts as `HIGH`.

`ignorePatterns` removes matching conflicts from actionable results. If all conflicts are ignored, BranchGuard exits with `0` and reports `ignored_conflict_count` in JSON.

## Design Notes

BranchGuard is read-only. It does not create merge commits, change branches, write to the index, or upload code.

On newer Git versions it uses modern `git merge-tree --write-tree`. On this development machine Git is `2.37.2`, so the prototype also supports the older `git merge-tree <base-tree> <branch1> <branch2>` output format.

## SDD

The specification-driven development docs are in [docs/sdd](./docs/sdd).

## Product Docs

- [Product roadmap](./docs/product-roadmap.md)
- [v0.3.0 release notes](./docs/releases/v0.3.0.md)
- [v0.2.0 release notes](./docs/releases/v0.2.0.md)
- [v0.1.0 release notes](./docs/releases/v0.1.0.md)
- [Release checklist](./docs/release-checklist.md)
- [npm publish guide](./docs/npm-publish.md)
