# npm Publish Guide

Package name: `branchguard-cli`

Repository:

```text
https://github.com/wonderly321/branchguard-cli
```

Installed command:

```bash
branchguard
```

## Verify

Use a project-local npm cache on restricted machines:

```bash
npm run check
npm test
npm pack --dry-run --cache .npm-cache
```

## Publish

Login first:

```bash
npm login
```

Check login:

```bash
npm whoami --registry https://registry.npmjs.org/ --cache .npm-cache
```

Publish beta:

```bash
npm publish --tag beta --cache .npm-cache
```

Install beta:

```bash
npm install --global branchguard-cli@beta
branchguard doctor
```

Promote to latest after smoke testing:

```bash
npm dist-tag add branchguard-cli@0.1.0 latest
```

## Notes

- `branchguard` on npm is already taken, so the package name is `branchguard-cli`.
- The command remains `branchguard`.
- The current implementation requires Node.js 20 or newer.
