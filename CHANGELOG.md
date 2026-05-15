# Changelog

## 0.1.0

Initial product-ready CLI prototype.

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
