#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const actionRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = resolve(actionRoot, "bin", "branchguard.mjs");

const base = getInput("base") || "origin/main";
const head = getInput("head") || "HEAD";
const format = normalizeFormat(getInput("format"), getInput("json"));
const failOnConflict = parseBooleanInput(getInput("fail-on-conflict"), true);
const failurePolicy = normalizeFailurePolicy(getInput("fail-on-risk"), failOnConflict);
const writeStepSummary = parseBooleanInput(getInput("summary"), true);
const summaryTitle = getInput("summary-title") || "BranchGuard CI Summary";
const writePrComment = parseBooleanInput(getInput("comment"), false);
const commentHeader = getInput("comment-header") || "<!-- branchguard-report -->";
const githubToken = getInput("github-token") || process.env.GITHUB_TOKEN || "";
const workingDirectory = resolve(getInput("working-directory") || ".");

const args = [cliPath, "check", base, head];
if (format === "json") {
  args.push("--json");
} else if (format === "markdown") {
  args.push("--markdown");
}

const result = spawnSync(process.execPath, args, {
  cwd: workingDirectory,
  encoding: "utf8",
  env: process.env,
  windowsHide: true,
});

if (result.stdout) {
  process.stdout.write(result.stdout);
}

if (result.stderr) {
  process.stderr.write(result.stderr);
}

if (result.error) {
  console.error(`BranchGuard action failed to start: ${result.error.message}`);
}

const exitCode = result.error ? 1 : typeof result.status === "number" ? result.status : 1;
const conflict = exitCode === 2;
const report = (result.stdout || "").trim();
const riskLevel = extractRiskLevel(report, format, conflict);
const workflowWillFail = shouldFailWorkflow({ exitCode, conflict, riskLevel, failurePolicy });

writeOutput("exit-code", String(exitCode));
writeOutput("conflict", String(conflict));
writeOutput("risk-level", riskLevel);
writeOutput("failure-policy", failurePolicy);
if (report) {
  writeOutput("report", report);
}
const summaryWritten = writeSummary(report, {
  enabled: writeStepSummary,
  title: summaryTitle,
  base,
  head,
  exitCode,
  conflict,
  riskLevel,
  failurePolicy,
  format,
  workflowWillFail,
});
writeOutput("summary-written", String(summaryWritten));

const commentResult = await upsertPullRequestComment(report, {
  enabled: writePrComment,
  header: commentHeader,
  token: githubToken,
});
writeOutput("comment-written", String(commentResult.written));
if (commentResult.url) {
  writeOutput("comment-url", commentResult.url);
}

if (commentResult.error) {
  console.error(commentResult.error);
  process.exit(1);
}

if (conflict && !workflowWillFail) {
  console.log(`BranchGuard detected ${riskLevel} conflicts, but failure policy is ${failurePolicy}.`);
  process.exit(0);
}

process.exit(exitCode);

function getInput(name) {
  const exactKey = `INPUT_${name.replace(/ /g, "_").toUpperCase()}`;
  const normalizedKey = `INPUT_${name.replace(/[\s-]+/g, "_").toUpperCase()}`;
  return (process.env[exactKey] || process.env[normalizedKey] || "").trim();
}

function normalizeFormat(formatInput, jsonInput) {
  const format = String(formatInput || "").trim().toLowerCase();
  if (["json", "markdown", "text"].includes(format)) {
    return format;
  }

  return parseBooleanInput(jsonInput, true) ? "json" : "text";
}

function parseBooleanInput(value, fallback) {
  if (!value) {
    return fallback;
  }

  if (/^(1|true|yes|on)$/i.test(value)) {
    return true;
  }

  if (/^(0|false|no|off)$/i.test(value)) {
    return false;
  }

  return fallback;
}

function normalizeFailurePolicy(value, failOnConflict) {
  const policy = String(value || "").trim().toLowerCase();
  if (["any", "high", "never"].includes(policy)) {
    return policy;
  }

  return failOnConflict ? "any" : "never";
}

function extractRiskLevel(report, format, conflict) {
  if (!report) {
    return conflict ? "MEDIUM" : "LOW";
  }

  if (format === "json") {
    try {
      const payload = JSON.parse(report);
      if (["LOW", "MEDIUM", "HIGH"].includes(payload.risk_level)) {
        return payload.risk_level;
      }
    } catch {
      return conflict ? "MEDIUM" : "LOW";
    }
  }

  const markdownRisk = report.match(/\*\*Risk:\*\*\s*(LOW|MEDIUM|HIGH)/);
  if (markdownRisk) {
    return markdownRisk[1];
  }

  const textRisk = report.match(/^Risk:\s*(LOW|MEDIUM|HIGH)$/m);
  if (textRisk) {
    return textRisk[1];
  }

  return conflict ? "MEDIUM" : "LOW";
}

function shouldFailWorkflow(options) {
  if (options.exitCode === 1) {
    return true;
  }

  if (!options.conflict) {
    return false;
  }

  if (options.failurePolicy === "never") {
    return false;
  }

  if (options.failurePolicy === "high") {
    return options.riskLevel === "HIGH";
  }

  return true;
}

function writeOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) {
    return;
  }

  const delimiter = `branchguard_${name}_${Date.now()}`;
  appendFileSync(process.env.GITHUB_OUTPUT, `${name}<<${delimiter}\n${value}\n${delimiter}\n`, "utf8");
}

function writeSummary(report, options) {
  if (!options.enabled || !report || !process.env.GITHUB_STEP_SUMMARY) {
    return false;
  }

  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${buildStepSummary(report, options)}\n`, "utf8");
  return true;
}

function buildStepSummary(report, options) {
  const resultLabel =
    options.exitCode === 1
      ? "Error"
      : options.conflict
        ? "Conflicts detected"
        : "No conflicts detected";
  const workflowLabel = options.workflowWillFail ? "Failing" : "Passing";
  const recommendation =
    options.exitCode === 1
      ? "Check the action logs and verify both Git refs are available."
      : options.conflict
        ? options.workflowWillFail
          ? "Resolve or rebase the branch before merging. Start with the highest-risk directory in the detailed report."
          : "Review the report before merging. This workflow is not blocking because of the configured failure policy."
        : "No merge-conflict action needed.";

  return [
    `# ${options.title}`,
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| Result | ${escapeMarkdownCell(resultLabel)} |`,
    `| Base | ${inlineCode(options.base)} |`,
    `| Head | ${inlineCode(options.head)} |`,
    `| Risk | ${escapeMarkdownCell(options.riskLevel)} |`,
    `| Exit code | ${inlineCode(String(options.exitCode))} |`,
    `| Failure policy | ${inlineCode(options.failurePolicy)} |`,
    `| Workflow status | ${escapeMarkdownCell(workflowLabel)} |`,
    "",
    "## Recommended Next Step",
    "",
    recommendation,
    "",
    "## Detailed Report",
    "",
    formatDetailedReport(report, options.format),
  ].join("\n");
}

function formatDetailedReport(report, format) {
  if (format === "markdown") {
    return demoteMarkdownHeadings(report);
  }

  const fence = format === "json" ? "json" : "text";
  return `\`\`\`${fence}\n${report}\n\`\`\``;
}

function demoteMarkdownHeadings(markdown) {
  return markdown.replace(/^(#{1,5})\s/gm, "#$1 ");
}

function inlineCode(value) {
  return `\`${String(value).replaceAll("`", "\\`")}\``;
}

function escapeMarkdownCell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

async function upsertPullRequestComment(report, options) {
  if (!options.enabled) {
    return { written: false };
  }

  if (!report) {
    return { written: false };
  }

  const body = `${options.header}\n${report}`;
  if (process.env.BRANCHGUARD_COMMENT_MOCK_FILE) {
    appendFileSync(process.env.BRANCHGUARD_COMMENT_MOCK_FILE, `${JSON.stringify({ body })}\n`, "utf8");
    return { written: true, url: "mock://branchguard-comment" };
  }

  if (!options.token) {
    return {
      written: false,
      error: "BranchGuard PR comment requested, but no github-token input or GITHUB_TOKEN env var was provided.",
    };
  }

  const context = getPullRequestContext();
  if (!context) {
    console.log("BranchGuard PR comment skipped because this event is not a pull_request event.");
    return { written: false };
  }

  const commentsPath = `/repos/${context.repository}/issues/${context.number}/comments`;
  const comments = await githubRequest(commentsPath, {
    method: "GET",
    token: options.token,
    query: "per_page=100",
  });
  if (comments.error) {
    return { written: false, error: comments.error };
  }

  const existing = comments.data.find((comment) => String(comment.body || "").includes(options.header));
  if (existing) {
    const update = await githubRequest(`/repos/${context.repository}/issues/comments/${existing.id}`, {
      method: "PATCH",
      token: options.token,
      body: { body },
    });
    if (update.error) {
      return { written: false, error: update.error };
    }
    return { written: true, url: update.data.html_url || existing.html_url || "" };
  }

  const created = await githubRequest(commentsPath, {
    method: "POST",
    token: options.token,
    body: { body },
  });
  if (created.error) {
    return { written: false, error: created.error };
  }

  return { written: true, url: created.data.html_url || "" };
}

function getPullRequestContext() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    return null;
  }

  let event;
  try {
    event = JSON.parse(readFileSync(eventPath, "utf8"));
  } catch {
    return null;
  }

  if (!event.pull_request || !event.pull_request.number || !event.repository?.full_name) {
    return null;
  }

  return {
    number: event.pull_request.number,
    repository: event.repository.full_name,
  };
}

async function githubRequest(path, options) {
  const baseUrl = process.env.GITHUB_API_URL || "https://api.github.com";
  const url = new URL(path.replace(/^\//, ""), `${baseUrl.replace(/\/$/, "")}/`);
  if (options.query) {
    url.search = options.query;
  }

  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${options.token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "branchguard-cli",
  };

  if (options.body) {
    headers["Content-Type"] = "application/json";
  }

  try {
    const response = await fetch(url, {
      method: options.method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) {
      return {
        error: `GitHub API ${options.method} ${url.pathname} failed with ${response.status}: ${data?.message || text}`,
      };
    }
    return { data };
  } catch (error) {
    return {
      error: `GitHub API ${options.method} ${url.pathname} failed: ${error.message}`,
    };
  }
}
