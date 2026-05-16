# Changelog

## Unreleased

## 0.3.1

Published to npm as `branchguard-cli@0.3.1`.

Changed:

- Localized the primary README for Chinese users.
- Added `README.en.md` for English readers.

## 0.3.0

Published to npm as `branchguard-cli@0.3.0`.

Added:

- `--output <file>` for `check` and `matrix` reports.
- GitHub Action pull request comment creation/update via `comment: "true"`.
- GitHub Action outputs for `comment-written` and `comment-url`.
- Directory risk summary in check JSON, text, and Markdown reports.
- Recent-contributor hints for conflict files and directory summaries.
- Productized GitHub Actions step summary with result table and recommended next step.
- GitHub Action `fail-on-risk` policy with `risk-level` and `failure-policy` outputs.
- Self-contained HTML reports for `check` and `matrix`.
- GitHub Action `output` input for writing report files.
- GitHub Action webhook notifications for generic, Feishu, and DingTalk payloads.
- GitHub Action `mode: matrix` for scheduled branch conflict reports.

## 0.2.0

Prepared for npm release as `branchguard-cli@0.2.0`.

Added:

- GitHub Action entrypoint with `base`, `head`, `json`, `fail-on-conflict`, and `working-directory` inputs.
- GitHub Action outputs for `exit-code`, `conflict`, and `report`.
- Markdown output for `check`, `matrix`, and the GitHub Action `format` input.
- GitHub Action step summary support.
- GitLab CI merge request example.
- Modern `git merge-tree --write-tree` conflict output parser hardening.

## 0.1.0

Initial product-ready CLI prototype.

Published to npm as `branchguard-cli@0.1.0`.

Added:

- `branchguard init`
- `branchguard doctor`
- `branchguard check <base> <head>`
- `branchguard matrix --base <base>`
- JSON output
- Exit code `2` for detected conflicts
- `.branchguard.json` configuration
- Configurable `highRiskPatterns`
- Configurable `ignorePatterns`
- Git 2.37 fallback for older `git merge-tree` output
- npm package metadata for `branchguard-cli`
- GitHub Action example
