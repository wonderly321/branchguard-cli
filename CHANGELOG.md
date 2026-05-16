# Changelog

## Unreleased

Added:

- `--output <file>` for `check` and `matrix` reports.
- GitHub Action pull request comment creation/update via `comment: "true"`.
- GitHub Action outputs for `comment-written` and `comment-url`.
- Directory risk summary in check JSON, text, and Markdown reports.

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
