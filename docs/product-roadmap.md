# BranchGuard Product Roadmap

## v0.1: CLI Product

Goal: A usable local CLI that can be shared with developers.

Included:

- npm package name: `branchguard-cli`
- command name: `branchguard`
- `branchguard init`
- `branchguard doctor`
- `branchguard check <base> <head>`
- `branchguard matrix --base <base>`
- JSON output
- Configurable high-risk patterns
- Configurable ignore patterns
- Tests and README

## v0.2: CI Ready

Goal: Make BranchGuard useful in pull request workflows.

Planned:

- GitHub Action wrapper. (done on `main`; release as `v0.2.0`)
- GitLab CI example. (done on `main`; release as `v0.2.0`)
- Markdown report output. (done on `main`; release as `v0.2.0`)
- PR comment creation/update. (done on `main`; release later)
- Better modern `git merge-tree --write-tree` parsing on newer Git versions. (done on `main`; release as `v0.2.0`)

Tracking issues:

- [#1 GitHub Action wrapper](https://github.com/wonderly321/branchguard-cli/issues/1)
- [#2 Markdown report output](https://github.com/wonderly321/branchguard-cli/issues/2)
- Modern Git merge-tree parser hardening

## v0.3: Team Workflow

Goal: Make it valuable for small teams instead of only individuals.

Planned:

- Report file output for CI artifacts. (done on `main`; release later)
- Recent-contributor hints via `git log`. (done on `main`; release later)
- Risk summary grouped by directory. (done on `main`; release later)
- Productized GitHub Actions step summary. (done on `main`; release later)
- Weekly conflict report.
- Feishu/DingTalk webhook output.
- HTML report.

## v1.0: Commercial Shape

Goal: Paid team edition.

Planned:

- License key support.
- Team config presets.
- Private CI distribution.
- VS Code extension.
- Single binary releases.

## Commercial Strategy

BranchGuard follows an open-core path:

- Open-source MIT CLI for local checks.
- Free npm package for individual developers and small teams.
- Paid Pro/team features later, focused on CI workflows, reports, notifications, and team policies.

The free CLI should stay useful on its own. Paid features should save team coordination time rather than lock basic conflict detection away.

## Explicit Non-Goals

- Full Git GUI.
- Automatic conflict resolution.
- Cloud code hosting.
- Uploading source code.
