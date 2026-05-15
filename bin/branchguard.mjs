#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const VERSION = "0.1.0";
const EXIT_OK = 0;
const EXIT_ERROR = 1;
const EXIT_CONFLICT = 2;
const CONFIG_FILE = ".branchguard.json";

const HIGH_RISK_PATTERNS = [
  /^package-lock\.json$/,
  /^pnpm-lock\.yaml$/,
  /^yarn\.lock$/,
  /^Cargo\.lock$/,
  /^go\.sum$/,
  /^composer\.lock$/,
  /^db\/migrations\//,
  /^migrations\//,
  /^schema\//,
  /^openapi\//,
  /\.proto$/,
  /\.graphql$/,
];

const DEFAULT_CONFIG = {
  highRiskPatterns: [
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
    "**/*.graphql",
  ],
  ignorePatterns: ["dist/**", "coverage/**", "node_modules/**"],
};

function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    process.exit(EXIT_OK);
  }

  if (command === "--version" || command === "-v" || command === "version") {
    console.log(`branchguard ${VERSION}`);
    process.exit(EXIT_OK);
  }

  if (command === "doctor") {
    const result = doctor();
    printDoctor(result);
    process.exit(result.ok ? EXIT_OK : EXIT_ERROR);
  }

  if (command === "init") {
    const exitCode = handleInit(args.slice(1));
    process.exit(exitCode);
  }

  if (command === "check") {
    const exitCode = handleCheck(args.slice(1));
    process.exit(exitCode);
  }

  if (command === "matrix") {
    const exitCode = handleMatrix(args.slice(1));
    process.exit(exitCode);
  }

  printError({
    code: "UNKNOWN_COMMAND",
    message: `unknown command "${command}"`,
    hint: "run `branchguard --help` to see available commands",
  });
  process.exit(EXIT_ERROR);
}

function handleInit(args) {
  const force = args.includes("--force");
  const json = args.includes("--json");
  const unknown = args.filter((arg) => arg !== "--force" && arg !== "--json");

  if (unknown.length > 0) {
    printMaybeJsonError(
      {
        code: "UNKNOWN_OPTION",
        message: `unknown init option "${unknown[0]}"`,
        hint: "example: branchguard init",
      },
      json,
    );
    return EXIT_ERROR;
  }

  const configPath = getConfigPath();
  if (existsSync(configPath) && !force) {
    printMaybeJsonError(
      {
        code: "CONFIG_EXISTS",
        message: `${CONFIG_FILE} already exists`,
        hint: "run `branchguard init --force` to overwrite it",
      },
      json,
    );
    return EXIT_ERROR;
  }

  writeFileSync(configPath, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, "utf8");

  if (json) {
    console.log(JSON.stringify({ config_path: configPath, created: true }, null, 2));
  } else {
    console.log(`Created ${configPath}`);
  }

  return EXIT_OK;
}

function handleCheck(args) {
  const output = parseOutputFormat(args);
  if (output.error) {
    printMaybeJsonError(output.error, output.format === "json");
    return EXIT_ERROR;
  }

  const positional = args.filter((arg) => arg !== "--json" && arg !== "--markdown");

  if (positional.length !== 2) {
    const error = {
      code: "INVALID_ARGUMENTS",
      message: "check requires <base> and <head>",
      hint: "example: branchguard check main feature/login",
    };
    printMaybeJsonError(error, output.format === "json");
    return EXIT_ERROR;
  }

  const [base, head] = positional;
  const preflight = preflightCheck(base, head);
  if (!preflight.ok) {
    printMaybeJsonError(preflight.error, output.format === "json");
    return EXIT_ERROR;
  }

  const config = loadConfig();
  if (config.error) {
    printMaybeJsonError(config.error, output.format === "json");
    return EXIT_ERROR;
  }

  const result = checkBranches(base, head, config);
  if (result.error) {
    printMaybeJsonError(result.error, output.format === "json");
    return EXIT_ERROR;
  }

  if (output.format === "json") {
    console.log(JSON.stringify(result, null, 2));
  } else if (output.format === "markdown") {
    printCheckMarkdown(result);
  } else {
    printCheckResult(result);
  }

  return result.has_conflict ? EXIT_CONFLICT : EXIT_OK;
}

function handleMatrix(args) {
  const options = parseMatrixArgs(args);
  if (options.error) {
    printMaybeJsonError(options.error, options.format === "json");
    return EXIT_ERROR;
  }

  const repo = preflightRepo();
  if (!repo.ok) {
    printMaybeJsonError(repo.error, options.format === "json");
    return EXIT_ERROR;
  }

  const baseExists = refExists(options.base);
  if (!baseExists) {
    printMaybeJsonError(
      {
        code: "REF_NOT_FOUND",
        message: `base ref "${options.base}" not found or is not a commit`,
        hint: "run `git branch --all` to check available branches",
      },
      options.format === "json",
    );
    return EXIT_ERROR;
  }

  const config = loadConfig();
  if (config.error) {
    printMaybeJsonError(config.error, options.format === "json");
    return EXIT_ERROR;
  }

  const branchesResult = listLocalBranches();
  if (branchesResult.error) {
    printMaybeJsonError(branchesResult.error, options.format === "json");
    return EXIT_ERROR;
  }

  const branches = branchesResult.branches
    .filter((branch) => branch !== options.base)
    .slice(0, options.limit);

  const entries = [];
  for (const branch of branches) {
    const result = checkBranches(options.base, branch, config);
    if (result.error) {
      printMaybeJsonError(result.error, options.format === "json");
      return EXIT_ERROR;
    }
    entries.push({
      branch,
      has_conflict: result.has_conflict,
      risk_level: result.risk_level,
      conflict_count: result.conflict_count,
      ignored_conflict_count: result.ignored_conflict_count,
    });
  }

  const matrix = {
    base: options.base,
    branch_count: entries.length,
    entries,
  };

  if (options.format === "json") {
    console.log(JSON.stringify(matrix, null, 2));
  } else if (options.format === "markdown") {
    printMatrixMarkdown(matrix);
  } else {
    printMatrixResult(matrix);
  }

  return entries.some((entry) => entry.has_conflict) ? EXIT_CONFLICT : EXIT_OK;
}

function parseMatrixArgs(args) {
  const result = {
    base: "",
    format: "text",
    limit: 20,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json" || arg === "--markdown") {
      const output = parseOutputFormat([arg], result.format);
      if (output.error) {
        result.error = output.error;
        return result;
      }
      result.format = output.format;
      continue;
    }

    if (arg === "--base") {
      result.base = args[index + 1] || "";
      index += 1;
      continue;
    }

    if (arg === "--limit") {
      const rawLimit = args[index + 1] || "";
      const limit = Number.parseInt(rawLimit, 10);
      if (!Number.isInteger(limit) || limit < 1) {
        result.error = {
          code: "INVALID_LIMIT",
          message: `invalid --limit value "${rawLimit}"`,
          hint: "use a positive integer, for example: --limit 20",
        };
        return result;
      }
      result.limit = limit;
      index += 1;
      continue;
    }

    result.error = {
      code: "UNKNOWN_OPTION",
      message: `unknown matrix option "${arg}"`,
      hint: "example: branchguard matrix --base main",
    };
    return result;
  }

  if (!result.base) {
    result.error = {
      code: "MISSING_BASE",
      message: "matrix requires --base <base>",
      hint: "example: branchguard matrix --base main",
    };
  }

  return result;
}

function parseOutputFormat(args, currentFormat = "text") {
  const result = { format: currentFormat };

  for (const arg of args) {
    if (arg !== "--json" && arg !== "--markdown") {
      continue;
    }

    const nextFormat = arg === "--json" ? "json" : "markdown";
    if (result.format !== "text" && result.format !== nextFormat) {
      result.error = {
        code: "OUTPUT_FORMAT_CONFLICT",
        message: "choose only one output format",
        hint: "use either --json or --markdown",
      };
      return result;
    }
    result.format = nextFormat;
  }

  return result;
}

function doctor() {
  const checks = [];
  const gitVersion = runGit(["--version"]);

  if (gitVersion.status !== 0) {
    checks.push({
      name: "Git executable",
      ok: false,
      detail: "git is not available on PATH",
    });
    return { ok: false, checks };
  }

  const versionText = (gitVersion.stdout || gitVersion.stderr).trim();
  const version = parseGitVersion(versionText);
  checks.push({ name: "Git executable", ok: true, detail: versionText });

  const inside = runGit(["rev-parse", "--is-inside-work-tree"]);
  checks.push({
    name: "Git repository",
    ok: inside.status === 0 && inside.stdout.trim() === "true",
    detail:
      inside.status === 0 && inside.stdout.trim() === "true"
        ? "current directory is inside a Git repository"
        : "current directory is not inside a Git repository",
  });

  const modernMergeTree = supportsModernMergeTree();
  checks.push({
    name: "Modern merge-tree",
    ok: modernMergeTree,
    detail: modernMergeTree
      ? "git merge-tree --write-tree is available"
      : `git ${version || "unknown"} does not expose --write-tree; deprecated merge-tree fallback will be used`,
    warning: !modernMergeTree,
  });

  if (inside.status === 0 && inside.stdout.trim() === "true") {
    const dirty = runGit(["status", "--porcelain"]);
    checks.push({
      name: "Working tree",
      ok: dirty.status === 0,
      detail:
        dirty.status === 0 && dirty.stdout.trim().length === 0
          ? "working tree is clean"
          : "working tree has local changes; checks still run read-only, but results may surprise you",
      warning: dirty.status === 0 && dirty.stdout.trim().length > 0,
    });
  }

  return { ok: checks.every((check) => check.ok || check.warning), checks };
}

function preflightCheck(base, head) {
  const repo = preflightRepo();
  if (!repo.ok) {
    return repo;
  }

  for (const ref of [base, head]) {
    if (!refExists(ref)) {
      return {
        ok: false,
        error: {
          code: "REF_NOT_FOUND",
          message: `ref "${ref}" not found or is not a commit`,
          hint: "run `git branch --all` to check available branches",
        },
      };
    }
  }

  return { ok: true };
}

function preflightRepo() {
  const inside = runGit(["rev-parse", "--is-inside-work-tree"]);
  if (inside.status !== 0 || inside.stdout.trim() !== "true") {
    return {
      ok: false,
      error: {
        code: "NOT_GIT_REPOSITORY",
        message: "current directory is not inside a Git repository",
        hint: "run branchguard from a Git repository",
      },
    };
  }
  return { ok: true };
}

function getRepoRootOrCwd() {
  const root = runGit(["rev-parse", "--show-toplevel"]);
  if (root.status === 0 && root.stdout.trim()) {
    return root.stdout.trim();
  }
  return process.cwd();
}

function getConfigPath() {
  return join(getRepoRootOrCwd(), CONFIG_FILE);
}

function loadConfig() {
  const configPath = getConfigPath();
  const config = {
    path: configPath,
    highRiskPatterns: [...HIGH_RISK_PATTERNS],
    ignorePatterns: compileGlobPatterns(DEFAULT_CONFIG.ignorePatterns),
  };

  if (!existsSync(configPath)) {
    return config;
  }

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    return {
      error: {
        code: "CONFIG_PARSE_FAILED",
        message: `could not parse ${CONFIG_FILE}`,
        hint: error.message,
      },
    };
  }

  for (const key of ["highRiskPatterns", "ignorePatterns"]) {
    if (parsed[key] !== undefined && !Array.isArray(parsed[key])) {
      return {
        error: {
          code: "CONFIG_INVALID",
          message: `${key} must be an array in ${CONFIG_FILE}`,
          hint: `example: "${key}": ["path/**"]`,
        },
      };
    }
  }

  if (parsed.highRiskPatterns) {
    config.highRiskPatterns.push(...compileGlobPatterns(parsed.highRiskPatterns));
  }

  if (parsed.ignorePatterns) {
    config.ignorePatterns = compileGlobPatterns(parsed.ignorePatterns);
  }

  return config;
}

function compileGlobPatterns(patterns) {
  return patterns.map((pattern) => globToRegExp(pattern));
}

function globToRegExp(pattern) {
  const normalized = normalizePath(String(pattern));
  let source = "";

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];

    if (char === "*" && next === "*") {
      source += ".*";
      index += 1;
      continue;
    }

    if (char === "*") {
      source += "[^/]*";
      continue;
    }

    source += escapeRegExp(char);
  }

  return new RegExp(`^${source}$`);
}

function escapeRegExp(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function refExists(ref) {
  const exists = runGit(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  return exists.status === 0;
}

function listLocalBranches() {
  const branches = runGit(["for-each-ref", "--format=%(refname:short)", "refs/heads"]);
  if (branches.status !== 0) {
    return {
      error: {
        code: "BRANCH_LIST_FAILED",
        message: "could not list local branches",
        hint: branches.stderr.trim() || "run `git branch` manually for details",
      },
    };
  }

  return {
    branches: branches.stdout
      .split(/\r?\n/)
      .map((branch) => branch.trim())
      .filter(Boolean),
  };
}

function checkBranches(base, head, config = loadConfig()) {
  if (supportsModernMergeTree()) {
    return checkWithModernMergeTree(base, head, config);
  }
  return checkWithDeprecatedMergeTree(base, head, config);
}

function checkWithModernMergeTree(base, head, config) {
  const merge = runGit(["merge-tree", "--write-tree", "--name-only", base, head]);
  const output = `${merge.stdout}\n${merge.stderr}`.trim();
  const hasConflict = merge.status === 1;

  if (merge.status !== 0 && merge.status !== 1) {
    return {
      error: {
        code: "MERGE_TREE_FAILED",
        message: "git merge-tree failed",
        hint: output || "run `git merge-tree --write-tree` manually for details",
      },
    };
  }

  const files = extractConflictFiles(output);
  return buildCheckResult(base, head, hasConflict, files, config);
}

function checkWithDeprecatedMergeTree(base, head, config) {
  const mergeBase = runGit(["merge-base", base, head]);
  if (mergeBase.status !== 0 || !mergeBase.stdout.trim()) {
    return {
      error: {
        code: "MERGE_BASE_FAILED",
        message: `could not find a merge base for "${base}" and "${head}"`,
        hint: "ensure both refs belong to the same repository history",
      },
    };
  }

  const merge = runGit(["merge-tree", mergeBase.stdout.trim(), base, head]);
  const output = `${merge.stdout}\n${merge.stderr}`.trim();

  if (merge.status !== 0) {
    return {
      error: {
        code: "MERGE_TREE_FAILED",
        message: "git merge-tree failed",
        hint: output || "run `git merge-tree` manually for details",
      },
    };
  }

  const files = extractDeprecatedConflictFiles(output);
  return buildCheckResult(base, head, files.length > 0, files, config);
}

function buildCheckResult(base, head, hasConflict, paths, config) {
  const allConflictPaths = [...new Set(paths.map(normalizePath))]
    .filter(Boolean)
    .sort();
  const ignoredConflictFiles = allConflictPaths
    .filter((path) => isIgnoredPath(path, config))
    .map((path) => ({ path }));
  const conflictFiles = allConflictPaths
    .filter((path) => !isIgnoredPath(path, config))
    .map((path) => {
      const highRisk = isHighRiskPath(path, config);
      return {
        path,
        type: "content",
        risk: highRisk ? "HIGH" : "MEDIUM",
      };
    });

  const riskLevel = calculateRisk(conflictFiles);
  const hasActiveConflict = hasConflict && conflictFiles.length > 0;
  return {
    base,
    head,
    has_conflict: hasActiveConflict,
    risk_level: riskLevel,
    conflict_count: conflictFiles.length,
    conflict_files: conflictFiles,
    ignored_conflict_count: ignoredConflictFiles.length,
    ignored_conflict_files: ignoredConflictFiles,
    summary: hasActiveConflict
      ? `${conflictFiles.length} conflicting file${conflictFiles.length === 1 ? "" : "s"} detected`
      : ignoredConflictFiles.length > 0
        ? `no actionable conflicts detected; ${ignoredConflictFiles.length} ignored conflict${ignoredConflictFiles.length === 1 ? "" : "s"} skipped`
      : "no merge conflicts detected",
  };
}

function calculateRisk(conflictFiles) {
  if (conflictFiles.length === 0) {
    return "LOW";
  }
  if (conflictFiles.some((file) => file.risk === "HIGH")) {
    return "HIGH";
  }
  if (conflictFiles.length >= 3) {
    return "HIGH";
  }
  return "MEDIUM";
}

function isHighRiskPath(path, config) {
  return config.highRiskPatterns.some((pattern) => pattern.test(path));
}

function isIgnoredPath(path, config) {
  return config.ignorePatterns.some((pattern) => pattern.test(path));
}

function extractConflictFiles(output) {
  const files = [];
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const conflictPath = extractModernConflictPath(trimmed);
    if (conflictPath) {
      files.push(conflictPath);
      continue;
    }

    const tabParts = trimmed.split(/\t+/);
    const candidate = tabParts[tabParts.length - 1];
    if (looksLikePath(candidate)) {
      files.push(candidate);
    }
  }
  return files;
}

function extractModernConflictPath(line) {
  const mergeConflict = line.match(/^CONFLICT \([^)]+\): Merge conflict in (.+)$/);
  if (mergeConflict) {
    return mergeConflict[1].trim();
  }

  const leftInTree = line.match(/^CONFLICT \([^)]+\): .* of (.+?) left in tree\.?$/);
  if (leftInTree) {
    return leftInTree[1].trim();
  }

  return "";
}

function extractDeprecatedConflictFiles(output) {
  const files = [];
  let currentFile = "";
  let conflictInCurrentFile = false;
  let pendingConflictBlock = false;

  for (const line of output.split(/\r?\n/)) {
    const added = line.match(/^added in both(?:\s+(.+))?$/);
    const changed = line.match(/^changed in both(?:\s+(.+))?$/);
    const removed = line.match(/^removed in (?:local|remote)(?:\s+(.+))?$/);

    if (added || changed || removed) {
      if (currentFile && conflictInCurrentFile) {
        files.push(currentFile);
      }
      currentFile = ((added || changed || removed)[1] || "").trim();
      conflictInCurrentFile = false;
      pendingConflictBlock = true;
      continue;
    }

    if (pendingConflictBlock && !currentFile) {
      const fileMeta = line.match(/^\s+(?:base|our|their)\s+\d+\s+[0-9a-f]+\s+(.+)$/);
      if (fileMeta) {
        currentFile = fileMeta[1].trim();
        continue;
      }
    }

    if (line.includes("<<<<<<<") || line.includes("=======") || line.includes(">>>>>>>")) {
      conflictInCurrentFile = true;
      pendingConflictBlock = false;
    }
  }

  if (currentFile && conflictInCurrentFile) {
    files.push(currentFile);
  }

  return files;
}

function supportsModernMergeTree() {
  const help = runGit(["merge-tree", "-h"]);
  const text = `${help.stdout}\n${help.stderr}`;
  return text.includes("--write-tree");
}

function runGit(args) {
  return spawnSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    windowsHide: true,
  });
}

function parseGitVersion(versionText) {
  const match = versionText.match(/git version\s+([0-9]+(?:\.[0-9]+){1,2})/);
  return match ? match[1] : "";
}

function normalizePath(path) {
  return path.replaceAll("\\", "/").replace(/^["']|["']$/g, "");
}

function looksLikePath(value) {
  if (!value) {
    return false;
  }

  const trimmed = value.trim();
  if (
    !trimmed ||
    /^(CONFLICT|Auto-merging|warning:|error:|fatal:)\b/i.test(trimmed) ||
    /^[0-9a-f]{7,64}$/i.test(trimmed)
  ) {
    return false;
  }

  return (
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed.includes(".") ||
    /^[^\s:]+$/.test(trimmed)
  );
}

function printCheckResult(result) {
  console.log("BranchGuard");
  console.log(`Base: ${result.base}`);
  console.log(`Head: ${result.head}`);
  console.log("");
  console.log(`Risk: ${result.risk_level}`);
  console.log(`Conflicts: ${result.conflict_count} file${result.conflict_count === 1 ? "" : "s"}`);

  if (result.conflict_files.length > 0) {
    console.log("");
    for (const file of result.conflict_files) {
      console.log(`${file.path}${file.risk === "HIGH" ? "  [HIGH]" : ""}`);
    }
    console.log("");
    console.log("Suggestion:");
    console.log("- Merge or rebase this branch sooner.");
    console.log("- Coordinate with owners of the conflicting files.");
    if (result.risk_level === "HIGH") {
      console.log("- Review high-risk files carefully before merging.");
    }
  } else {
    console.log("");
    console.log("No merge conflicts detected.");
    if (result.ignored_conflict_count > 0) {
      console.log(`Ignored conflicts: ${result.ignored_conflict_count} file${result.ignored_conflict_count === 1 ? "" : "s"}`);
    }
  }
}

function printCheckMarkdown(result) {
  console.log("# BranchGuard Report");
  console.log("");
  console.log(`**Base:** ${inlineCode(result.base)}`);
  console.log(`**Head:** ${inlineCode(result.head)}`);
  console.log(`**Risk:** ${result.risk_level}`);
  console.log(`**Conflicts:** ${result.conflict_count} file${result.conflict_count === 1 ? "" : "s"}`);
  console.log("");
  console.log(result.summary);

  if (result.conflict_files.length > 0) {
    console.log("");
    console.log("| File | Type | Risk |");
    console.log("| --- | --- | --- |");
    for (const file of result.conflict_files) {
      console.log(`| ${inlineCode(file.path)} | ${escapeMarkdownCell(file.type)} | ${escapeMarkdownCell(file.risk)} |`);
    }
    console.log("");
    console.log("## Recommendation");
    console.log("");
    console.log("- Merge or rebase this branch sooner.");
    console.log("- Coordinate with owners of the conflicting files.");
    if (result.risk_level === "HIGH") {
      console.log("- Review high-risk files carefully before merging.");
    }
  }

  if (result.ignored_conflict_count > 0) {
    console.log("");
    console.log(`Ignored conflicts: ${result.ignored_conflict_count} file${result.ignored_conflict_count === 1 ? "" : "s"}.`);
  }
}

function printMatrixResult(matrix) {
  console.log("BranchGuard Matrix");
  console.log(`Base: ${matrix.base}`);
  console.log(`Branches: ${matrix.branch_count}`);
  console.log("");

  if (matrix.entries.length === 0) {
    console.log("No local branches to compare.");
    return;
  }

  const branchWidth = Math.max(
    "Branch".length,
    ...matrix.entries.map((entry) => entry.branch.length),
  );
  const conflictWidth = "Conflicts".length;
  const riskWidth = "Risk".length;

  console.log(
    `${padRight("Branch", branchWidth)}  ${padRight("Conflicts", conflictWidth)}  ${padRight("Risk", riskWidth)}`,
  );
  console.log(`${"-".repeat(branchWidth)}  ${"-".repeat(conflictWidth)}  ${"-".repeat(riskWidth)}`);

  for (const entry of matrix.entries) {
    console.log(
      `${padRight(entry.branch, branchWidth)}  ${padRight(String(entry.conflict_count), conflictWidth)}  ${padRight(entry.risk_level, riskWidth)}`,
    );
  }
}

function printMatrixMarkdown(matrix) {
  console.log("# BranchGuard Matrix");
  console.log("");
  console.log(`**Base:** ${inlineCode(matrix.base)}`);
  console.log(`**Branches:** ${matrix.branch_count}`);

  if (matrix.entries.length === 0) {
    console.log("");
    console.log("No local branches to compare.");
    return;
  }

  console.log("");
  console.log("| Branch | Conflicts | Risk |");
  console.log("| --- | ---: | --- |");
  for (const entry of matrix.entries) {
    console.log(
      `| ${inlineCode(entry.branch)} | ${entry.conflict_count} | ${escapeMarkdownCell(entry.risk_level)} |`,
    );
  }
}

function printDoctor(result) {
  console.log("BranchGuard Doctor");
  console.log("");
  for (const check of result.checks) {
    const mark = check.ok ? "OK" : check.warning ? "WARN" : "FAIL";
    console.log(`[${mark}] ${check.name}: ${check.detail}`);
  }
}

function printHelp() {
  console.log(`BranchGuard ${VERSION}

Usage:
  branchguard init [--force] [--json]
  branchguard check <base> <head> [--json|--markdown]
  branchguard matrix --base <base> [--limit 20] [--json|--markdown]
  branchguard doctor
  branchguard --version
  branchguard --help

Examples:
  branchguard init
  branchguard check main feature/login
  branchguard check origin/main HEAD --json
  branchguard check origin/main HEAD --markdown
  branchguard matrix --base main
`);
}

function printError(error) {
  console.error(`Error: ${error.message}`);
  if (error.hint) {
    console.error(`Hint: ${error.hint}`);
  }
}

function printMaybeJsonError(error, json) {
  if (json) {
    console.log(JSON.stringify({ error }, null, 2));
  } else {
    printError(error);
  }
}

function padRight(value, width) {
  return value + " ".repeat(Math.max(0, width - value.length));
}

function inlineCode(value) {
  return `\`${String(value).replaceAll("`", "\\`")}\``;
}

function escapeMarkdownCell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function isMainModule() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  main();
}

export { extractConflictFiles, extractDeprecatedConflictFiles };
