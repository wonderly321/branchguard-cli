# Changelog

## Unreleased

Added:

- GitHub Action entrypoint with `base`, `head`, `json`, `fail-on-conflict`, and `working-directory` inputs.
- GitHub Action outputs for `exit-code`, `conflict`, and `report`.
- Markdown output for `check`, `matrix`, and the GitHub Action `format` input.
- GitLab CI merge request example.

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
