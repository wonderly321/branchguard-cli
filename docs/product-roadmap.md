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

- GitHub Action wrapper.
- GitLab CI example.
- Markdown report output.
- PR comment body generation.
- Better modern `git merge-tree --write-tree` parsing on newer Git versions.

## v0.3: Team Workflow

Goal: Make it valuable for small teams instead of only individuals.

Planned:

- Branch owner detection via `git blame`.
- Risk summary grouped by directory.
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
