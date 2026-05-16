#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const VERSION = "0.3.1";
const EXIT_OK = 0;
const EXIT_ERROR = 1;
const EXIT_CONFLICT = 2;
const CONFIG_FILE = ".branchguard.json";
const RISK_SCORE = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
};
const RECENT_CONTRIBUTOR_LIMIT = 3;
const RECENT_COMMIT_SCAN_LIMIT = 12;

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
  const options = parseCheckArgs(args);
  if (options.error) {
    printMaybeJsonError(options.error, options.format === "json");
    return EXIT_ERROR;
  }

  if (options.positional.length !== 2) {
    const error = {
      code: "INVALID_ARGUMENTS",
      message: "check requires <base> and <head>",
      hint: "example: branchguard check main feature/login",
    };
    printMaybeJsonError(error, options.format === "json");
    return EXIT_ERROR;
  }

  const [base, head] = options.positional;
  const preflight = preflightCheck(base, head);
  if (!preflight.ok) {
    printMaybeJsonError(preflight.error, options.format === "json");
    return EXIT_ERROR;
  }

  const config = loadConfig();
  if (config.error) {
    printMaybeJsonError(config.error, options.format === "json");
    return EXIT_ERROR;
  }

  const result = checkBranches(base, head, config);
  if (result.error) {
    printMaybeJsonError(result.error, options.format === "json");
    return EXIT_ERROR;
  }

  const emit = emitReport(renderCheckReport(result, options.format), options.outputPath);
  if (emit.error) {
    printMaybeJsonError(emit.error, options.format === "json");
    return EXIT_ERROR;
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

  const emit = emitReport(renderMatrixReport(matrix, options.format), options.outputPath);
  if (emit.error) {
    printMaybeJsonError(emit.error, options.format === "json");
    return EXIT_ERROR;
  }

  return entries.some((entry) => entry.has_conflict) ? EXIT_CONFLICT : EXIT_OK;
}

function parseCheckArgs(args) {
  const result = {
    format: "text",
    outputPath: "",
    positional: [],
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (isOutputFormatFlag(arg)) {
      const output = parseOutputFormat([arg], result.format);
      if (output.error) {
        result.error = output.error;
        return result;
      }
      result.format = output.format;
      continue;
    }

    if (arg === "--output") {
      const outputPath = args[index + 1] || "";
      if (!outputPath || outputPath.startsWith("--")) {
        result.error = {
          code: "MISSING_OUTPUT_PATH",
          message: "missing value for --output",
          hint: "example: branchguard check main feature --html --output branchguard-report.html",
        };
        return result;
      }
      if (result.outputPath) {
        result.error = {
          code: "DUPLICATE_OUTPUT",
          message: "use --output only once",
          hint: "example: --output branchguard-report.md",
        };
        return result;
      }
      result.outputPath = outputPath;
      index += 1;
      continue;
    }

    if (arg.startsWith("--")) {
      result.error = {
        code: "UNKNOWN_OPTION",
        message: `unknown check option "${arg}"`,
        hint: "example: branchguard check main feature/login --html",
      };
      return result;
    }

    result.positional.push(arg);
  }

  return result;
}

function parseMatrixArgs(args) {
  const result = {
    base: "",
    format: "text",
    limit: 20,
    outputPath: "",
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (isOutputFormatFlag(arg)) {
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

    if (arg === "--output") {
      const outputPath = args[index + 1] || "";
      if (!outputPath || outputPath.startsWith("--")) {
        result.error = {
          code: "MISSING_OUTPUT_PATH",
          message: "missing value for --output",
          hint: "example: branchguard matrix --base main --html --output branchguard-matrix.html",
        };
        return result;
      }
      if (result.outputPath) {
        result.error = {
          code: "DUPLICATE_OUTPUT",
          message: "use --output only once",
          hint: "example: --output branchguard-matrix.md",
        };
        return result;
      }
      result.outputPath = outputPath;
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
    if (!isOutputFormatFlag(arg)) {
      continue;
    }

    const nextFormat = arg.slice(2);
    if (result.format !== "text" && result.format !== nextFormat) {
      result.error = {
        code: "OUTPUT_FORMAT_CONFLICT",
        message: "choose only one output format",
        hint: "use --json, --markdown, or --html",
      };
      return result;
    }
    result.format = nextFormat;
  }

  return result;
}

function isOutputFormatFlag(arg) {
  return arg === "--json" || arg === "--markdown" || arg === "--html";
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
  const conflictFilesWithHints = addOwnershipHints(base, head, conflictFiles);

  const riskLevel = calculateRisk(conflictFilesWithHints);
  const hasActiveConflict = hasConflict && conflictFilesWithHints.length > 0;
  const directorySummary = summarizeDirectories(conflictFilesWithHints);
  return {
    base,
    head,
    has_conflict: hasActiveConflict,
    risk_level: riskLevel,
    conflict_count: conflictFilesWithHints.length,
    conflict_files: conflictFilesWithHints,
    directory_summary: directorySummary,
    ignored_conflict_count: ignoredConflictFiles.length,
    ignored_conflict_files: ignoredConflictFiles,
    summary: hasActiveConflict
      ? `${conflictFilesWithHints.length} conflicting file${conflictFilesWithHints.length === 1 ? "" : "s"} detected`
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

function summarizeDirectories(conflictFiles) {
  const groups = new Map();

  for (const file of conflictFiles) {
    const directory = getDirectoryPath(file.path);
    const group = groups.get(directory) || {
      path: directory,
      conflict_count: 0,
      risk: "LOW",
      files: [],
      contributors: new Map(),
    };

    group.conflict_count += 1;
    group.files.push(file.path);
    if (RISK_SCORE[file.risk] > RISK_SCORE[group.risk]) {
      group.risk = file.risk;
    }
    for (const contributor of file.recent_contributors || []) {
      incrementContributor(group.contributors, contributor, contributor.commits);
    }
    groups.set(directory, group);
  }

  for (const group of groups.values()) {
    if (group.risk !== "HIGH" && group.conflict_count >= 3) {
      group.risk = "HIGH";
    }
    group.files.sort();
    group.recent_contributors = sortContributorCounts(group.contributors).slice(0, RECENT_CONTRIBUTOR_LIMIT);
    delete group.contributors;
  }

  return [...groups.values()].sort((left, right) => {
    const riskDiff = RISK_SCORE[right.risk] - RISK_SCORE[left.risk];
    if (riskDiff !== 0) {
      return riskDiff;
    }

    if (right.conflict_count !== left.conflict_count) {
      return right.conflict_count - left.conflict_count;
    }

    return left.path.localeCompare(right.path);
  });
}

function getDirectoryPath(path) {
  const normalized = normalizePath(path);
  const slashIndex = normalized.lastIndexOf("/");
  if (slashIndex < 0) {
    return ".";
  }
  return normalized.slice(0, slashIndex) || ".";
}

function addOwnershipHints(base, head, conflictFiles) {
  return conflictFiles.map((file) => ({
    ...file,
    recent_contributors: getRecentContributors(base, head, file.path),
  }));
}

function getRecentContributors(base, head, path) {
  const counts = new Map();
  const seenCommits = new Set();

  for (const ref of [base, head]) {
    const log = runGit([
      "log",
      `--max-count=${RECENT_COMMIT_SCAN_LIMIT}`,
      "--format=%H%x00%aN%x00%aE",
      ref,
      "--",
      path,
    ]);

    if (log.status !== 0 || !log.stdout.trim()) {
      continue;
    }

    for (const line of log.stdout.split(/\r?\n/)) {
      const [commit, name, email] = line.split("\0");
      if (!commit || seenCommits.has(commit)) {
        continue;
      }

      seenCommits.add(commit);
      incrementContributor(counts, { name, email }, 1);
    }
  }

  return sortContributorCounts(counts).slice(0, RECENT_CONTRIBUTOR_LIMIT);
}

function incrementContributor(counts, contributor, commits) {
  const name = contributor.name || "Unknown";
  const email = contributor.email || "";
  const key = `${name}\0${email}`;
  const current = counts.get(key) || { name, email, commits: 0 };
  current.commits += commits;
  counts.set(key, current);
}

function sortContributorCounts(counts) {
  return [...counts.values()].sort((left, right) => {
    if (right.commits !== left.commits) {
      return right.commits - left.commits;
    }

    const nameCompare = left.name.localeCompare(right.name);
    if (nameCompare !== 0) {
      return nameCompare;
    }

    return left.email.localeCompare(right.email);
  });
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

function renderCheckReport(result, format) {
  if (format === "json") {
    return JSON.stringify(result, null, 2);
  }

  if (format === "markdown") {
    return renderCheckMarkdown(result);
  }

  if (format === "html") {
    return renderCheckHtml(result);
  }

  return renderCheckText(result);
}

function renderMatrixReport(matrix, format) {
  if (format === "json") {
    return JSON.stringify(matrix, null, 2);
  }

  if (format === "markdown") {
    return renderMatrixMarkdown(matrix);
  }

  if (format === "html") {
    return renderMatrixHtml(matrix);
  }

  return renderMatrixText(matrix);
}

function renderCheckText(result) {
  const lines = [
    "BranchGuard",
    `Base: ${result.base}`,
    `Head: ${result.head}`,
    "",
    `Risk: ${result.risk_level}`,
    `Conflicts: ${result.conflict_count} file${result.conflict_count === 1 ? "" : "s"}`,
  ];

  if (result.conflict_files.length > 0) {
    lines.push("");
    lines.push("Directory Summary:");
    for (const directory of result.directory_summary) {
      lines.push(
        `- ${formatDirectoryPath(directory.path)}: ${directory.conflict_count} file${directory.conflict_count === 1 ? "" : "s"} (${directory.risk}); recent: ${formatContributorsText(directory.recent_contributors)}`,
      );
    }
    lines.push("");
    lines.push("Conflicting Files:");
    for (const file of result.conflict_files) {
      lines.push(`${file.path}${file.risk === "HIGH" ? "  [HIGH]" : ""}`);
    }
    lines.push("");
    lines.push("Suggestion:");
    lines.push("- Merge or rebase this branch sooner.");
    lines.push("- Coordinate with owners of the conflicting files.");
    if (result.risk_level === "HIGH") {
      lines.push("- Review high-risk files carefully before merging.");
    }
  } else {
    lines.push("");
    lines.push("No merge conflicts detected.");
    if (result.ignored_conflict_count > 0) {
      lines.push(`Ignored conflicts: ${result.ignored_conflict_count} file${result.ignored_conflict_count === 1 ? "" : "s"}`);
    }
  }

  return lines.join("\n");
}

function renderCheckMarkdown(result) {
  const lines = [
    "# BranchGuard Report",
    "",
    `**Base:** ${inlineCode(result.base)}`,
    `**Head:** ${inlineCode(result.head)}`,
    `**Risk:** ${result.risk_level}`,
    `**Conflicts:** ${result.conflict_count} file${result.conflict_count === 1 ? "" : "s"}`,
    "",
    result.summary,
  ];

  if (result.conflict_files.length > 0) {
    lines.push("");
    lines.push("## Directory Summary");
    lines.push("");
    lines.push("| Directory | Conflicts | Risk | Recent contributors |");
    lines.push("| --- | ---: | --- | --- |");
    for (const directory of result.directory_summary) {
      lines.push(
        `| ${inlineCode(formatDirectoryPath(directory.path))} | ${directory.conflict_count} | ${escapeMarkdownCell(directory.risk)} | ${escapeMarkdownCell(formatContributorsText(directory.recent_contributors))} |`,
      );
    }
    lines.push("");
    lines.push("## Conflicting Files");
    lines.push("");
    lines.push("| File | Type | Risk |");
    lines.push("| --- | --- | --- |");
    for (const file of result.conflict_files) {
      lines.push(`| ${inlineCode(file.path)} | ${escapeMarkdownCell(file.type)} | ${escapeMarkdownCell(file.risk)} |`);
    }
    lines.push("");
    lines.push("## Recommendation");
    lines.push("");
    lines.push("- Merge or rebase this branch sooner.");
    lines.push("- Coordinate with owners of the conflicting files.");
    if (result.risk_level === "HIGH") {
      lines.push("- Review high-risk files carefully before merging.");
    }
  }

  if (result.ignored_conflict_count > 0) {
    lines.push("");
    lines.push(`Ignored conflicts: ${result.ignored_conflict_count} file${result.ignored_conflict_count === 1 ? "" : "s"}.`);
  }

  return lines.join("\n");
}

function renderCheckHtml(result) {
  const directoryRows = result.directory_summary
    .map(
      (directory) => `<tr>
        <td><code>${escapeHtml(formatDirectoryPath(directory.path))}</code></td>
        <td class="number">${directory.conflict_count}</td>
        <td>${renderRiskBadge(directory.risk)}</td>
        <td>${escapeHtml(formatContributorsText(directory.recent_contributors))}</td>
      </tr>`,
    )
    .join("\n");

  const fileRows = result.conflict_files
    .map(
      (file) => `<tr>
        <td><code>${escapeHtml(file.path)}</code></td>
        <td>${escapeHtml(file.type)}</td>
        <td>${renderRiskBadge(file.risk)}</td>
        <td>${escapeHtml(formatContributorsText(file.recent_contributors))}</td>
      </tr>`,
    )
    .join("\n");

  const conflictSections =
    result.conflict_files.length > 0
      ? `
      <section>
        <h2>Directory Summary</h2>
        <table>
          <thead>
            <tr><th>Directory</th><th>Conflicts</th><th>Risk</th><th>Recent contributors</th></tr>
          </thead>
          <tbody>
            ${directoryRows}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Conflicting Files</h2>
        <table>
          <thead>
            <tr><th>File</th><th>Type</th><th>Risk</th><th>Recent contributors</th></tr>
          </thead>
          <tbody>
            ${fileRows}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Recommendation</h2>
        <ul>
          <li>Merge or rebase this branch sooner.</li>
          <li>Coordinate with owners of the conflicting files.</li>
          ${result.risk_level === "HIGH" ? "<li>Review high-risk files carefully before merging.</li>" : ""}
        </ul>
      </section>`
      : `<section class="empty-state"><p>No merge conflicts detected.</p></section>`;

  const ignoredSection =
    result.ignored_conflict_count > 0
      ? `<section class="notice"><p>Ignored conflicts: ${result.ignored_conflict_count} file${result.ignored_conflict_count === 1 ? "" : "s"}.</p></section>`
      : "";

  return renderHtmlDocument({
    title: "BranchGuard Report",
    riskLevel: result.risk_level,
    body: `
      <header>
        <p class="eyebrow">BranchGuard</p>
        <h1>Merge Conflict Report</h1>
        <p class="summary">${escapeHtml(result.summary)}</p>
      </header>

      <section class="stats">
        <div><span>Base</span><strong><code>${escapeHtml(result.base)}</code></strong></div>
        <div><span>Head</span><strong><code>${escapeHtml(result.head)}</code></strong></div>
        <div><span>Risk</span><strong>${renderRiskBadge(result.risk_level)}</strong></div>
        <div><span>Conflicts</span><strong>${result.conflict_count}</strong></div>
      </section>

      ${conflictSections}
      ${ignoredSection}
    `,
  });
}

function renderMatrixText(matrix) {
  const lines = [
    "BranchGuard Matrix",
    `Base: ${matrix.base}`,
    `Branches: ${matrix.branch_count}`,
    "",
  ];

  if (matrix.entries.length === 0) {
    lines.push("No local branches to compare.");
    return lines.join("\n");
  }

  const branchWidth = Math.max(
    "Branch".length,
    ...matrix.entries.map((entry) => entry.branch.length),
  );
  const conflictWidth = "Conflicts".length;
  const riskWidth = "Risk".length;

  lines.push(
    `${padRight("Branch", branchWidth)}  ${padRight("Conflicts", conflictWidth)}  ${padRight("Risk", riskWidth)}`,
  );
  lines.push(`${"-".repeat(branchWidth)}  ${"-".repeat(conflictWidth)}  ${"-".repeat(riskWidth)}`);

  for (const entry of matrix.entries) {
    lines.push(
      `${padRight(entry.branch, branchWidth)}  ${padRight(String(entry.conflict_count), conflictWidth)}  ${padRight(entry.risk_level, riskWidth)}`,
    );
  }

  return lines.join("\n");
}

function renderMatrixMarkdown(matrix) {
  const lines = [
    "# BranchGuard Matrix",
    "",
    `**Base:** ${inlineCode(matrix.base)}`,
    `**Branches:** ${matrix.branch_count}`,
  ];

  if (matrix.entries.length === 0) {
    lines.push("");
    lines.push("No local branches to compare.");
    return lines.join("\n");
  }

  lines.push("");
  lines.push("| Branch | Conflicts | Risk |");
  lines.push("| --- | ---: | --- |");
  for (const entry of matrix.entries) {
    lines.push(
      `| ${inlineCode(entry.branch)} | ${entry.conflict_count} | ${escapeMarkdownCell(entry.risk_level)} |`,
    );
  }

  return lines.join("\n");
}

function renderMatrixHtml(matrix) {
  const riskLevel = highestMatrixRisk(matrix);
  const rows = matrix.entries
    .map(
      (entry) => `<tr>
        <td><code>${escapeHtml(entry.branch)}</code></td>
        <td class="number">${entry.conflict_count}</td>
        <td>${renderRiskBadge(entry.risk_level)}</td>
      </tr>`,
    )
    .join("\n");

  const matrixSection =
    matrix.entries.length > 0
      ? `<section>
        <h2>Branch Matrix</h2>
        <table>
          <thead>
            <tr><th>Branch</th><th>Conflicts</th><th>Risk</th></tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </section>`
      : `<section class="empty-state"><p>No local branches to compare.</p></section>`;

  return renderHtmlDocument({
    title: "BranchGuard Matrix",
    riskLevel,
    body: `
      <header>
        <p class="eyebrow">BranchGuard</p>
        <h1>Branch Conflict Matrix</h1>
        <p class="summary">${matrix.branch_count} branch${matrix.branch_count === 1 ? "" : "es"} checked against <code>${escapeHtml(matrix.base)}</code>.</p>
      </header>

      <section class="stats">
        <div><span>Base</span><strong><code>${escapeHtml(matrix.base)}</code></strong></div>
        <div><span>Branches</span><strong>${matrix.branch_count}</strong></div>
        <div><span>Highest risk</span><strong>${renderRiskBadge(riskLevel)}</strong></div>
      </section>

      ${matrixSection}
    `,
  });
}

function renderHtmlDocument(options) {
  return `<!doctype html>
<html lang="en" data-risk-level="${escapeHtml(options.riskLevel)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(options.title)}</title>
  <style>
    :root { color-scheme: light; --bg: #f7f8fb; --text: #17202a; --muted: #5c6675; --line: #dce2ea; --panel: #ffffff; --blue: #2458d3; --green: #1f7a4d; --amber: #a85d00; --red: #b42318; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { max-width: 1040px; margin: 0 auto; padding: 32px 20px 48px; }
    header { margin-bottom: 24px; }
    h1 { margin: 4px 0 8px; font-size: 32px; line-height: 1.15; letter-spacing: 0; }
    h2 { margin: 28px 0 12px; font-size: 18px; letter-spacing: 0; }
    code { font-family: "SFMono-Regular", Consolas, monospace; font-size: 0.92em; }
    table { width: 100%; border-collapse: collapse; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
    th, td { padding: 10px 12px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
    th { color: var(--muted); font-size: 12px; text-transform: uppercase; }
    tr:last-child td { border-bottom: 0; }
    ul { margin-top: 8px; padding-left: 22px; }
    .eyebrow { margin: 0; color: var(--blue); font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; }
    .summary { margin: 0; color: var(--muted); font-size: 16px; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin: 20px 0 8px; }
    .stats div, .empty-state, .notice { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 14px; }
    .stats span { display: block; color: var(--muted); font-size: 12px; text-transform: uppercase; }
    .stats strong { display: block; margin-top: 4px; font-size: 18px; }
    .number { text-align: right; }
    .risk { display: inline-flex; align-items: center; min-width: 72px; justify-content: center; border-radius: 999px; padding: 2px 10px; font-weight: 700; font-size: 12px; }
    .risk-low { color: var(--green); background: #e8f5ee; }
    .risk-medium { color: var(--amber); background: #fff4df; }
    .risk-high { color: var(--red); background: #feeceb; }
    @media (max-width: 720px) {
      main { padding: 24px 12px 36px; }
      h1 { font-size: 26px; }
      table { display: block; overflow-x: auto; }
      th, td { white-space: nowrap; }
    }
  </style>
</head>
<body>
  <main>
${options.body}
  </main>
</body>
</html>`;
}

function renderRiskBadge(riskLevel) {
  const risk = String(riskLevel || "LOW").toUpperCase();
  return `<span class="risk risk-${risk.toLowerCase()}">${escapeHtml(risk)}</span>`;
}

function highestMatrixRisk(matrix) {
  return matrix.entries.reduce(
    (highest, entry) => (RISK_SCORE[entry.risk_level] > RISK_SCORE[highest] ? entry.risk_level : highest),
    "LOW",
  );
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
  branchguard check <base> <head> [--json|--markdown|--html] [--output <file>]
  branchguard matrix --base <base> [--limit 20] [--json|--markdown|--html] [--output <file>]
  branchguard doctor
  branchguard --version
  branchguard --help

Examples:
  branchguard init
  branchguard check main feature/login
  branchguard check origin/main HEAD --json
  branchguard check origin/main HEAD --markdown
  branchguard check origin/main HEAD --markdown --output branchguard-report.md
  branchguard check origin/main HEAD --html --output branchguard-report.html
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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDirectoryPath(path) {
  return path === "." ? "(root)" : path;
}

function formatContributorsText(contributors) {
  if (!contributors || contributors.length === 0) {
    return "n/a";
  }

  return contributors
    .map((contributor) => `${contributor.name}${contributor.commits > 1 ? ` (${contributor.commits})` : ""}`)
    .join(", ");
}

function emitReport(report, outputPath) {
  console.log(report);

  if (!outputPath) {
    return { ok: true };
  }

  try {
    const resolvedOutputPath = resolve(process.cwd(), outputPath);
    mkdirSync(dirname(resolvedOutputPath), { recursive: true });
    writeFileSync(resolvedOutputPath, `${report}\n`, "utf8");
    return { ok: true, output_path: resolvedOutputPath };
  } catch (error) {
    return {
      error: {
        code: "OUTPUT_WRITE_FAILED",
        message: `could not write report to "${outputPath}"`,
        hint: error.message,
      },
    };
  }
}

function isMainModule() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  main();
}

export { extractConflictFiles, extractDeprecatedConflictFiles };
