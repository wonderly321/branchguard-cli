# BranchGuard Release Checklist

This checklist turns the current CLI into a release-ready package.

## Required Before v0.3

- [x] Add PR comment creation/update.
- [x] Add report file output for CI artifacts.
- [x] Add directory risk summaries.
- [x] Add recent-contributor hints.
- [x] Add risk-based GitHub Action failure policy.
- [x] Add HTML reports.
- [x] Add Action report file output.
- [x] Add Feishu/DingTalk webhook output.
- [x] Add scheduled matrix report support.
- [x] Run `npm run check`.
- [x] Run `npm test`.
- [x] Run `npm pack --dry-run --cache .npm-cache`.
- [x] Publish `branchguard-cli@0.3.0`.
- [x] Create `v0.3.0` git tag after npm publish succeeds.

## Required Before v0.2

- [x] Add GitHub Action wrapper.
- [x] Add Markdown report output.
- [x] Add GitHub Actions step summary support.
- [x] Add GitLab CI example.
- [x] Harden modern `git merge-tree --write-tree` conflict parsing.
- [x] Run `npm run check`.
- [x] Run `npm test`.
- [x] Run `npm pack --dry-run --cache .npm-cache`.
- [x] Publish `branchguard-cli@0.2.0`.
- [x] Create `v0.2.0` git tag after npm publish succeeds.

## Required Before v0.1

- [ ] Decide final product name.
- [x] Decide npm package name: `branchguard-cli`.
- [x] Decide distribution path: npm package first.
- [x] Add license.
- [x] Confirm MIT open-source route.
- [x] Create initial local git commit.
- [x] Create GitHub repository.
- [x] Push initial `main` branch to GitHub.
- [x] Add repository URL in `package.json`.
- [x] Login to npm.
- [x] Publish with granular token because npm required 2FA bypass for publishing.
- [x] Use `scripts/publish-beta-with-token.ps1` when direct npm publish is blocked by 2FA policy.
- [x] Add screenshots or terminal demo GIF.
- [x] Add `CHANGELOG.md`.
- [x] Add GitHub repository URL in `package.json`.
- [x] Add package keywords in `package.json`.
- [x] Run `node --test`.
- [x] Run `npm pack --dry-run --cache .npm-cache`.
- [x] Smoke test packed tarball with local npm install.
- [x] Test on Windows PowerShell.
- [ ] Test on macOS or Linux.
- [ ] Test with Git >= 2.38 modern `merge-tree --write-tree`.
- [x] Test with Git 2.37 fallback.

## npm Release Path

- [x] Remove `"private": true` from `package.json`.
- [x] Confirm `branchguard` is taken.
- [x] Confirm `branchguard-cli` is available.
- [x] Add `files` allowlist.
- [x] Run `npm pack --dry-run`.
- [x] Publish beta tag first:

```bash
npm publish --tag beta
```

Published:

```text
branchguard-cli@0.1.0
beta: 0.1.0
latest: 0.1.0
```

## Binary Release Path

Use this path after migrating to Go or Rust.

- [ ] Build Windows x64.
- [ ] Build macOS arm64/x64.
- [ ] Build Linux x64.
- [ ] Attach binaries to GitHub Release.
- [ ] Add checksum file.
- [ ] Add install script.

## Product Page Copy

Short description:

> BranchGuard checks Git branches before merge and reports conflicts, risky files, and branch-level conflict matrices.

Positioning:

> Not another Git GUI. BranchGuard is the pre-merge warning layer for small teams.

Core promise:

> Know before you merge.
