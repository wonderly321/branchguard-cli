import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(rootDir, "bin", "branchguard.mjs");
const action = join(rootDir, "bin", "github-action.mjs");
const tempRoot = join(rootDir, ".tmp");
const { extractConflictFiles } = await import(pathToFileURL(cli).href);

test("prints version", () => {
  const result = runCli(["--version"], rootDir);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /branchguard 0\.2\.0/);
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
    assert.ok(payload.conflict_files[0].recent_contributors.length > 0);
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

test("parses modern merge-tree conflict output", () => {
  const output = [
    "Auto-merging app.txt",
    "CONFLICT (content): Merge conflict in app.txt",
    "CONFLICT (add/add): Merge conflict in src/with space.txt",
    "100644 abcdef1234567890 1\tpackage-lock.json",
    "README",
    "fatal: not a path",
  ].join("\n");

  assert.deepEqual(extractConflictFiles(output).sort(), [
    "README",
    "app.txt",
    "package-lock.json",
    "src/with space.txt",
  ]);
});

test("prints markdown reports for check and matrix", () => {
  const repo = createFixtureRepo();
  try {
    const check = runCli(["check", "main", "feature-conflict", "--markdown"], repo);
    assert.equal(check.status, 2);
    assert.match(check.stdout, /# BranchGuard Report/);
    assert.match(check.stdout, /\| `app.txt` \| content \| MEDIUM \|/);

    const matrix = runCli(["matrix", "--base", "main", "--markdown"], repo);
    assert.equal(matrix.status, 2);
    assert.match(matrix.stdout, /# BranchGuard Matrix/);
    assert.match(matrix.stdout, /\| `feature-conflict` \| 1 \| MEDIUM \|/);
  } finally {
    rmSync(dirname(repo), { recursive: true, force: true });
  }
});

test("prints html reports for check and matrix", () => {
  const repo = createFixtureRepo();
  const reportPath = join(dirname(repo), "reports", "branchguard-report.html");
  try {
    const check = runCli(["check", "main", "feature-conflict", "--html", "--output", reportPath], repo);
    assert.equal(check.status, 2);
    assert.match(check.stdout, /<!doctype html>/);
    const report = readFileSync(reportPath, "utf8");
    assert.match(report, /data-risk-level="MEDIUM"/);
    assert.match(report, /Merge Conflict Report/);
    assert.match(report, /Directory Summary/);
    assert.match(report, /app\.txt/);
    assert.match(report, /risk-medium/);

    const matrix = runCli(["matrix", "--base", "main", "--html"], repo);
    assert.equal(matrix.status, 2);
    assert.match(matrix.stdout, /Branch Conflict Matrix/);
    assert.match(matrix.stdout, /feature-conflict/);
    assert.match(matrix.stdout, /risk-medium/);
  } finally {
    rmSync(dirname(repo), { recursive: true, force: true });
  }
});

test("summarizes conflicts by directory", () => {
  const repo = createFixtureRepo({
    conflictFiles: ["src/app.js", "src/auth/login.js", "package-lock.json"],
  });
  try {
    const result = runCli(["check", "main", "feature-conflict", "--json"], repo);
    assert.equal(result.status, 2);
    const payload = JSON.parse(result.stdout);
    assert.deepEqual(
      payload.directory_summary.map((entry) => [entry.path, entry.conflict_count, entry.risk]),
      [
        [".", 1, "HIGH"],
        ["src", 1, "MEDIUM"],
        ["src/auth", 1, "MEDIUM"],
      ],
    );
    const rootSummary = payload.directory_summary.find((entry) => entry.path === ".");
    assert.deepEqual(
      rootSummary.recent_contributors.map((contributor) => contributor.name).sort(),
      ["BranchGuard Test", "Feature Owner", "Main Owner"],
    );

    const markdown = runCli(["check", "main", "feature-conflict", "--markdown"], repo);
    assert.equal(markdown.status, 2);
    assert.match(markdown.stdout, /## Directory Summary/);
    assert.match(markdown.stdout, /\| `\(root\)` \| 1 \| HIGH \| BranchGuard Test, Feature Owner, Main Owner \|/);
    assert.match(markdown.stdout, /\| `src\/auth` \| 1 \| MEDIUM \| BranchGuard Test, Feature Owner, Main Owner \|/);
  } finally {
    rmSync(dirname(repo), { recursive: true, force: true });
  }
});

test("writes check and matrix reports to output files", () => {
  const repo = createFixtureRepo();
  const reportPath = join(dirname(repo), "reports", "branchguard-report.md");
  const matrixPath = join(dirname(repo), "reports", "branchguard-matrix.md");
  try {
    const check = runCli(["check", "main", "feature-conflict", "--markdown", "--output", reportPath], repo);
    assert.equal(check.status, 2);
    assert.match(check.stdout, /# BranchGuard Report/);
    assert.match(readFileSync(reportPath, "utf8"), /\| `app.txt` \| content \| MEDIUM \|/);

    const matrix = runCli(["matrix", "--base", "main", "--markdown", "--output", matrixPath], repo);
    assert.equal(matrix.status, 2);
    assert.match(matrix.stdout, /# BranchGuard Matrix/);
    assert.match(readFileSync(matrixPath, "utf8"), /\| `feature-conflict` \| 1 \| MEDIUM \|/);
  } finally {
    rmSync(dirname(repo), { recursive: true, force: true });
  }
});

test("github action wrapper reports conflicts without failing when configured", () => {
  const repo = createFixtureRepo();
  const outputPath = join(dirname(repo), "github-output.txt");
  try {
    const result = runAction(repo, {
      GITHUB_OUTPUT: outputPath,
      INPUT_BASE: "main",
      INPUT_HEAD: "feature-conflict",
      INPUT_JSON: "true",
      INPUT_FAIL_ON_CONFLICT: "false",
      INPUT_WORKING_DIRECTORY: repo,
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /BranchGuard detected MEDIUM conflicts/);

    const output = readFileSync(outputPath, "utf8");
    assert.match(output, /exit-code<<branchguard_exit-code_/);
    assert.match(output, /\n2\nbranchguard_exit-code_/);
    assert.match(output, /conflict<<branchguard_conflict_/);
    assert.match(output, /\ntrue\nbranchguard_conflict_/);
    assert.match(output, /failure-policy<<branchguard_failure-policy_/);
    assert.match(output, /\nnever\nbranchguard_failure-policy_/);
    assert.match(output, /"has_conflict": true/);
  } finally {
    rmSync(dirname(repo), { recursive: true, force: true });
  }
});

test("github action wrapper can fail only on high risk conflicts", () => {
  const mediumRepo = createFixtureRepo();
  const mediumOutputPath = join(dirname(mediumRepo), "github-output.txt");
  try {
    const medium = runAction(mediumRepo, {
      GITHUB_OUTPUT: mediumOutputPath,
      INPUT_BASE: "main",
      INPUT_HEAD: "feature-conflict",
      INPUT_FORMAT: "markdown",
      INPUT_FAIL_ON_RISK: "high",
      INPUT_WORKING_DIRECTORY: mediumRepo,
    });

    assert.equal(medium.status, 0);
    const mediumOutput = readFileSync(mediumOutputPath, "utf8");
    assert.match(mediumOutput, /risk-level<<branchguard_risk-level_/);
    assert.match(mediumOutput, /\nMEDIUM\nbranchguard_risk-level_/);
    assert.match(mediumOutput, /failure-policy<<branchguard_failure-policy_/);
    assert.match(mediumOutput, /\nhigh\nbranchguard_failure-policy_/);
  } finally {
    rmSync(dirname(mediumRepo), { recursive: true, force: true });
  }

  const highRepo = createFixtureRepo();
  const highOutputPath = join(dirname(highRepo), "github-output.txt");
  try {
    writeFileSync(
      join(highRepo, ".branchguard.json"),
      JSON.stringify({ highRiskPatterns: ["app.txt"] }, null, 2),
      "utf8",
    );

    const high = runAction(highRepo, {
      GITHUB_OUTPUT: highOutputPath,
      INPUT_BASE: "main",
      INPUT_HEAD: "feature-conflict",
      INPUT_FORMAT: "markdown",
      INPUT_FAIL_ON_RISK: "high",
      INPUT_WORKING_DIRECTORY: highRepo,
    });

    assert.equal(high.status, 2);
    const highOutput = readFileSync(highOutputPath, "utf8");
    assert.match(highOutput, /\nHIGH\nbranchguard_risk-level_/);
    assert.match(highOutput, /\nhigh\nbranchguard_failure-policy_/);
  } finally {
    rmSync(dirname(highRepo), { recursive: true, force: true });
  }
});

test("github action wrapper can run matrix reports", () => {
  const repo = createFixtureRepo();
  const outputPath = join(dirname(repo), "github-output.txt");
  try {
    const result = runAction(repo, {
      GITHUB_OUTPUT: outputPath,
      INPUT_MODE: "matrix",
      INPUT_BASE: "main",
      INPUT_LIMIT: "5",
      INPUT_FORMAT: "markdown",
      INPUT_FAIL_ON_RISK: "high",
      INPUT_WORKING_DIRECTORY: repo,
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /# BranchGuard Matrix/);
    assert.match(result.stdout, /\| `feature-conflict` \| 1 \| MEDIUM \|/);
    const output = readFileSync(outputPath, "utf8");
    assert.match(output, /mode<<branchguard_mode_/);
    assert.match(output, /\nmatrix\nbranchguard_mode_/);
    assert.match(output, /risk-level<<branchguard_risk-level_/);
    assert.match(output, /\nMEDIUM\nbranchguard_risk-level_/);
  } finally {
    rmSync(dirname(repo), { recursive: true, force: true });
  }
});

test("github action wrapper writes pull request comment in mock mode", () => {
  const repo = createFixtureRepo();
  const outputPath = join(dirname(repo), "github-output.txt");
  const commentPath = join(dirname(repo), "github-comment.jsonl");
  try {
    const result = runAction(repo, {
      BRANCHGUARD_COMMENT_MOCK_FILE: commentPath,
      GITHUB_OUTPUT: outputPath,
      INPUT_BASE: "main",
      INPUT_HEAD: "feature-conflict",
      INPUT_FORMAT: "markdown",
      INPUT_COMMENT: "true",
      INPUT_FAIL_ON_CONFLICT: "false",
      INPUT_WORKING_DIRECTORY: repo,
    });

    assert.equal(result.status, 0);

    const output = readFileSync(outputPath, "utf8");
    assert.match(output, /comment-written<<branchguard_comment-written_/);
    assert.match(output, /\ntrue\nbranchguard_comment-written_/);
    assert.match(output, /comment-url<<branchguard_comment-url_/);

    const comment = JSON.parse(readFileSync(commentPath, "utf8").trim());
    assert.match(comment.body, /<!-- branchguard-report -->/);
    assert.match(comment.body, /# BranchGuard Report/);
    assert.match(comment.body, /\| `app.txt` \| content \| MEDIUM \|/);
  } finally {
    rmSync(dirname(repo), { recursive: true, force: true });
  }
});

test("github action wrapper sends team webhooks in mock mode", () => {
  const repo = createFixtureRepo();
  const outputPath = join(dirname(repo), "github-output.txt");
  const webhookPath = join(dirname(repo), "webhook.jsonl");
  try {
    const result = runAction(repo, {
      BRANCHGUARD_WEBHOOK_MOCK_FILE: webhookPath,
      GITHUB_OUTPUT: outputPath,
      INPUT_BASE: "main",
      INPUT_HEAD: "feature-conflict",
      INPUT_FORMAT: "markdown",
      INPUT_FAIL_ON_CONFLICT: "false",
      INPUT_WEBHOOK_URL: "mock://branchguard",
      INPUT_WEBHOOK_PROVIDER: "dingtalk",
      INPUT_WORKING_DIRECTORY: repo,
    });

    assert.equal(result.status, 0);
    const output = readFileSync(outputPath, "utf8");
    assert.match(output, /webhook-sent<<branchguard_webhook-sent_/);
    assert.match(output, /\ntrue\nbranchguard_webhook-sent_/);

    const webhook = JSON.parse(readFileSync(webhookPath, "utf8").trim());
    assert.equal(webhook.url, "mock://branchguard");
    assert.equal(webhook.provider, "dingtalk");
    assert.equal(webhook.payload.msgtype, "markdown");
    assert.match(webhook.payload.markdown.title, /BranchGuard MEDIUM conflict detected/);
    assert.match(webhook.payload.markdown.text, /Base: main/);
    assert.match(webhook.payload.markdown.text, /\| `app.txt` \| content \| MEDIUM \|/);
  } finally {
    rmSync(dirname(repo), { recursive: true, force: true });
  }
});

test("github action wrapper can limit webhooks to high risk conflicts", () => {
  const repo = createFixtureRepo();
  const outputPath = join(dirname(repo), "github-output.txt");
  const webhookPath = join(dirname(repo), "webhook.jsonl");
  try {
    const result = runAction(repo, {
      BRANCHGUARD_WEBHOOK_MOCK_FILE: webhookPath,
      GITHUB_OUTPUT: outputPath,
      INPUT_BASE: "main",
      INPUT_HEAD: "feature-conflict",
      INPUT_FORMAT: "markdown",
      INPUT_FAIL_ON_CONFLICT: "false",
      INPUT_WEBHOOK_URL: "mock://branchguard",
      INPUT_WEBHOOK_ON: "high",
      INPUT_WORKING_DIRECTORY: repo,
    });

    assert.equal(result.status, 0);
    const output = readFileSync(outputPath, "utf8");
    assert.match(output, /webhook-sent<<branchguard_webhook-sent_/);
    assert.match(output, /\nfalse\nbranchguard_webhook-sent_/);
    assert.equal(existsSync(webhookPath), false);
  } finally {
    rmSync(dirname(repo), { recursive: true, force: true });
  }
});

test("github action wrapper writes html report files", () => {
  const repo = createFixtureRepo();
  const outputPath = join(dirname(repo), "github-output.txt");
  const reportPath = join(dirname(repo), "branchguard-report.html");
  try {
    const result = runAction(repo, {
      GITHUB_OUTPUT: outputPath,
      INPUT_BASE: "main",
      INPUT_HEAD: "feature-conflict",
      INPUT_FORMAT: "html",
      INPUT_FAIL_ON_RISK: "high",
      INPUT_OUTPUT: reportPath,
      INPUT_WORKING_DIRECTORY: repo,
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /<!doctype html>/);
    const report = readFileSync(reportPath, "utf8");
    assert.match(report, /data-risk-level="MEDIUM"/);
    assert.match(report, /Merge Conflict Report/);
    const output = readFileSync(outputPath, "utf8");
    assert.match(output, /risk-level<<branchguard_risk-level_/);
    assert.match(output, /\nMEDIUM\nbranchguard_risk-level_/);
    assert.match(output, /report-path<<branchguard_report-path_/);
    assert.match(output, new RegExp(`\\n${escapeRegExp(reportPath)}\\nbranchguard_report-path_`));
  } finally {
    rmSync(dirname(repo), { recursive: true, force: true });
  }
});

test("github action wrapper writes markdown step summary", () => {
  const repo = createFixtureRepo();
  const outputPath = join(dirname(repo), "github-output.txt");
  const summaryPath = join(dirname(repo), "github-step-summary.md");
  try {
    const result = runAction(repo, {
      GITHUB_OUTPUT: outputPath,
      GITHUB_STEP_SUMMARY: summaryPath,
      INPUT_BASE: "main",
      INPUT_HEAD: "feature-conflict",
      INPUT_FORMAT: "markdown",
      INPUT_SUMMARY_TITLE: "BranchGuard Pull Request Check",
      INPUT_FAIL_ON_CONFLICT: "false",
      INPUT_WORKING_DIRECTORY: repo,
    });

    assert.equal(result.status, 0);

    const output = readFileSync(outputPath, "utf8");
    assert.match(output, /summary-written<<branchguard_summary-written_/);
    assert.match(output, /\ntrue\nbranchguard_summary-written_/);

    const summary = readFileSync(summaryPath, "utf8");
    assert.match(summary, /# BranchGuard Pull Request Check/);
    assert.match(summary, /\| Result \| Conflicts detected \|/);
    assert.match(summary, /\| Risk \| MEDIUM \|/);
    assert.match(summary, /\| Failure policy \| `never` \|/);
    assert.match(summary, /\| Workflow status \| Passing \|/);
    assert.match(summary, /## Recommended Next Step/);
    assert.match(summary, /## Detailed Report/);
    assert.match(summary, /## BranchGuard Report/);
    assert.match(summary, /\| `app.txt` \| content \| MEDIUM \|/);
  } finally {
    rmSync(dirname(repo), { recursive: true, force: true });
  }
});

function createFixtureRepo(options = {}) {
  const conflictFiles = options.conflictFiles || [options.conflictFile || "app.txt"];
  mkdirSync(tempRoot, { recursive: true });
  const parent = mkdtempSync(join(tempRoot, "branchguard-repo-parent-"));
  const repo = join(parent, "repo");
  mkdirSync(repo);

  git(repo, ["init"]);
  git(repo, ["branch", "-M", "main"]);
  git(repo, ["config", "user.email", "branchguard@example.test"]);
  git(repo, ["config", "user.name", "BranchGuard Test"]);

  for (const conflictFile of conflictFiles) {
    mkdirSync(dirname(join(repo, conflictFile)), { recursive: true });
    writeFileSync(join(repo, conflictFile), "hello\n", "utf8");
  }
  git(repo, ["add", ...conflictFiles]);
  git(repo, ["commit", "-m", "initial"]);

  git(repo, ["checkout", "-b", "feature-conflict"]);
  git(repo, ["config", "user.email", "feature@example.test"]);
  git(repo, ["config", "user.name", "Feature Owner"]);
  for (const conflictFile of conflictFiles) {
    writeFileSync(join(repo, conflictFile), "feature change\n", "utf8");
  }
  git(repo, ["commit", "-am", "feature change"]);

  git(repo, ["checkout", "main"]);
  git(repo, ["config", "user.email", "main@example.test"]);
  git(repo, ["config", "user.name", "Main Owner"]);
  for (const conflictFile of conflictFiles) {
    writeFileSync(join(repo, conflictFile), "main change\n", "utf8");
  }
  git(repo, ["commit", "-am", "main change"]);

  git(repo, ["checkout", "-b", "feature-clean"]);
  git(repo, ["config", "user.email", "branchguard@example.test"]);
  git(repo, ["config", "user.name", "BranchGuard Test"]);
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

function runAction(cwd, env = {}) {
  return spawnSync(process.execPath, [action], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
    windowsHide: true,
  });
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
