# BranchGuard

[![npm version](https://img.shields.io/npm/v/branchguard-cli.svg)](https://www.npmjs.com/package/branchguard-cli)
[![npm beta](https://img.shields.io/npm/v/branchguard-cli/beta.svg?label=beta)](https://www.npmjs.com/package/branchguard-cli)
[![license](https://img.shields.io/npm/l/branchguard-cli.svg)](./LICENSE)

BranchGuard is a lightweight Git merge conflict pre-check CLI.

npm package: `branchguard-cli`

Repository: [wonderly321/branchguard-cli](https://github.com/wonderly321/branchguard-cli)

It answers one practical question before you merge:

> Will this branch conflict with my base branch, and where?

Current status: v0.1 prototype. The implementation is a zero-dependency Node.js CLI so the product workflow can be validated quickly. The SDD documents still keep the longer-term Go/Rust single-binary direction.

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
```

## CI

See [docs/examples/github-action.yml](./docs/examples/github-action.yml) for a pull request conflict check example.

## Risk Levels

- `LOW`: no conflicts.
- `MEDIUM`: one or two normal file conflicts.
- `HIGH`: three or more conflicts, or conflicts in high-risk files.

High-risk files currently include lock files, migrations, schema files, OpenAPI files, proto files, and GraphQL files.

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
- [Release checklist](./docs/release-checklist.md)
- [npm publish guide](./docs/npm-publish.md)
