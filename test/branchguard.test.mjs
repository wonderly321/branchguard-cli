import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(rootDir, "bin", "branchguard.mjs");
const tempRoot = join(rootDir, ".tmp");

test("prints version", () => {
  const result = runCli(["--version"], rootDir);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /branchguard 0\.1\.0/);
});

test("reports an error outside a git repository", () => {
  mkdirSync(tempRoot, { recursive: true });
  const workdir = mkdtempSync(join(tempRoot, "branchguard-not-repo-"));
  try {
    const result = runCli(["check", "main", "feature", "--json"], workdir, {
      GIT_CEILING_DIRECTORIES: tempRoot,
    });
    assert.equal(result.status, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.error.code, "NOT_GIT_REPOSITORY");
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
});

test("init creates a default config file", () => {
  const repo = createFixtureRepo();
  try {
    const result = runCli(["init"], repo);
    assert.equal(result.status, 0);
    const configPath = join(repo, ".branchguard.json");
    assert.equal(existsSync(configPath), true);
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    assert.deepEqual(config.ignorePatterns, ["dist/**", "coverage/**", "node_modules/**"]);
    assert.ok(config.highRiskPatterns.includes("package-lock.json"));
  } finally {
    rmSync(dirname(repo), { recursive: true, force: true });
  }
});

test("detects clean and conflicting branch checks", () => {
  const repo = createFixtureRepo();
  try {
    const clean = runCli(["check", "main", "feature-clean", "--json"], repo);
    assert.equal(clean.status, 0);
    assert.equal(JSON.parse(clean.stdout).has_conflict, false);

    const conflict = runCli(["check", "main", "feature-conflict", "--json"], repo);
    assert.equal(conflict.status, 2);
    const payload = JSON.parse(conflict.stdout);
    assert.equal(payload.has_conflict, true);
    assert.equal(payload.conflict_count, 1);
    assert.equal(payload.conflict_files[0].path, "app.txt");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("marks configured high-risk conflicts", () => {
  const repo = createFixtureRepo({ conflictFile: "custom-risk.txt" });
  try {
    writeFileSync(
      join(repo, ".branchguard.json"),
      JSON.stringify({ highRiskPatterns: ["custom-risk.txt"] }, null, 2),
      "utf8",
    );

    const result = runCli(["check", "main", "feature-conflict", "--json"], repo);
    assert.equal(result.status, 2);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.risk_level, "HIGH");
    assert.equal(payload.conflict_files[0].risk, "HIGH");
  } finally {
    rmSync(dirname(repo), { recursive: true, force: true });
  }
});

test("ignores configured conflict paths", () => {
  const repo = createFixtureRepo({ conflictFile: "generated/app.txt" });
  try {
    writeFileSync(
      join(repo, ".branchguard.json"),
      JSON.stringify({ ignorePatterns: ["generated/**"] }, null, 2),
      "utf8",
    );

    const result = runCli(["check", "main", "feature-conflict", "--json"], repo);
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.has_conflict, false);
    assert.equal(payload.conflict_count, 0);
    assert.equal(payload.ignored_conflict_count, 1);
    assert.equal(payload.ignored_conflict_files[0].path, "generated/app.txt");
  } finally {
    rmSync(dirname(repo), { recursive: true, force: true });
  }
});

test("matrix checks local branches against a base", () => {
  const repo = createFixtureRepo();
  try {
    const result = runCli(["matrix", "--base", "main", "--json"], repo);
    assert.equal(result.status, 2);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.base, "main");
    assert.equal(payload.entries.length, 2);
    assert.deepEqual(
      payload.entries.map((entry) => [entry.branch, entry.conflict_count]).sort(),
      [
        ["feature-clean", 0],
        ["feature-conflict", 1],
      ],
    );
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

function createFixtureRepo(options = {}) {
  const conflictFile = options.conflictFile || "app.txt";
  mkdirSync(tempRoot, { recursive: true });
  const parent = mkdtempSync(join(tempRoot, "branchguard-repo-parent-"));
  const repo = join(parent, "repo");
  mkdirSync(repo);

  git(repo, ["init"]);
  git(repo, ["branch", "-M", "main"]);
  git(repo, ["config", "user.email", "branchguard@example.test"]);
  git(repo, ["config", "user.name", "BranchGuard Test"]);

  mkdirSync(dirname(join(repo, conflictFile)), { recursive: true });
  writeFileSync(join(repo, conflictFile), "hello\n", "utf8");
  git(repo, ["add", conflictFile]);
  git(repo, ["commit", "-m", "initial"]);

  git(repo, ["checkout", "-b", "feature-conflict"]);
  writeFileSync(join(repo, conflictFile), "feature change\n", "utf8");
  git(repo, ["commit", "-am", "feature change"]);

  git(repo, ["checkout", "main"]);
  writeFileSync(join(repo, conflictFile), "main change\n", "utf8");
  git(repo, ["commit", "-am", "main change"]);

  git(repo, ["checkout", "-b", "feature-clean"]);
  writeFileSync(join(repo, "other.txt"), "new file\n", "utf8");
  git(repo, ["add", "other.txt"]);
  git(repo, ["commit", "-m", "clean feature"]);

  git(repo, ["checkout", "main"]);
  return repo;
}

function git(cwd, args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(
    result.status,
    0,
    `git ${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result;
}

function runCli(args, cwd, env = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
    windowsHide: true,
  });
}
