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

If npm requires two-factor authentication:

```bash
npm publish --tag beta --otp <one-time-code> --cache .npm-cache
```

Alternative: create a granular access token on npm with package publishing permission and 2FA bypass enabled, then configure it in your user `.npmrc`.

On Windows, the helper script automates the publish flow without putting secrets in chat:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\publish-beta.ps1
```

If OTP/token automation keeps failing, use the simpler token-only helper:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\publish-beta-with-token.ps1
```

It will:

- run checks and tests
- try direct OTP publish
- if needed, create a short-lived granular token with `--bypass-2fa`
- publish through a temporary `.npmrc`
- delete the temporary `.npmrc`

Install beta:

```bash
npm install --global branchguard-cli@beta
branchguard doctor
```

Promote to latest after smoke testing:

```bash
npm dist-tag add branchguard-cli@0.2.0 latest
```

## Notes

- `branchguard` on npm is already taken, so the package name is `branchguard-cli`.
- The command remains `branchguard`.
- The current implementation requires Node.js 20 or newer.
- If npm account registration is blocked, users can install from GitHub first:

```bash
npm install --global github:wonderly321/branchguard-cli
```
