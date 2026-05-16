#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const actionRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = resolve(actionRoot, "bin", "branchguard.mjs");

const mode = normalizeMode(getInput("mode"));
const base = getInput("base") || "origin/main";
const head = getInput("head") || "HEAD";
const limit = getInput("limit") || "";
const format = normalizeFormat(getInput("format"), getInput("json"));
const failOnConflict = parseBooleanInput(getInput("fail-on-conflict"), true);
const failurePolicy = normalizeFailurePolicy(getInput("fail-on-risk"), failOnConflict);
const writeStepSummary = parseBooleanInput(getInput("summary"), true);
const summaryTitle = getInput("summary-title") || "BranchGuard CI Summary";
const writePrComment = parseBooleanInput(getInput("comment"), false);
const commentHeader = getInput("comment-header") || "<!-- branchguard-report -->";
const githubToken = getInput("github-token") || process.env.GITHUB_TOKEN || "";
const workingDirectory = resolve(getInput("working-directory") || ".");
const outputPath = getInput("output") || "";
const webhookUrl = getInput("webhook-url") || "";
const webhookProvider = normalizeWebhookProvider(getInput("webhook-provider"));
const webhookOn = normalizeWebhookPolicy(getInput("webhook-on"));
const webhookFailOnError = parseBooleanInput(getInput("webhook-fail-on-error"), false);

const args = buildBranchGuardArgs({ mode, base, head, limit, format, outputPath });

if (args.error) {
  console.error(args.error);
  process.exit(1);
}

const commandArgs = args.value;
const displayHead = mode === "matrix" ? "" : head;

function buildBranchGuardArgs(options) {
  const commandArgs = [cliPath];
  if (options.mode === "matrix") {
    commandArgs.push("matrix", "--base", options.base);
    if (options.limit) {
      const parsedLimit = Number.parseInt(options.limit, 10);
      if (!Number.isInteger(parsedLimit) || parsedLimit < 1) {
        return { error: `BranchGuard action received invalid limit "${options.limit}".` };
      }
      commandArgs.push("--limit", String(parsedLimit));
    }
  } else {
    commandArgs.push("check", options.base, options.head);
  }

  appendFormatArgs(commandArgs, options.format);
  if (options.outputPath) {
    commandArgs.push("--output", options.outputPath);
  }

  return { value: commandArgs };
}

function appendFormatArgs(commandArgs, outputFormat) {
  if (outputFormat === "json") {
    commandArgs.push("--json");
  } else if (outputFormat === "markdown") {
    commandArgs.push("--markdown");
  } else if (outputFormat === "html") {
    commandArgs.push("--html");
  }
}

const result = spawnSync(process.execPath, commandArgs, {
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
writeOutput("mode", mode);
writeOutput("conflict", String(conflict));
writeOutput("risk-level", riskLevel);
writeOutput("failure-policy", failurePolicy);
if (report) {
  writeOutput("report", report);
}
if (outputPath) {
  writeOutput("report-path", outputPath);
}
const summaryWritten = writeSummary(report, {
  enabled: writeStepSummary,
  title: summaryTitle,
  mode,
  base,
  head: displayHead,
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

const webhookResult = await sendWebhook(report, {
  enabled: shouldSendWebhook({ url: webhookUrl, webhookOn, conflict, riskLevel }),
  url: webhookUrl,
  provider: webhookProvider,
  mode,
  base,
  head: displayHead,
  exitCode,
  conflict,
  riskLevel,
  workflowWillFail,
});
writeOutput("webhook-sent", String(webhookResult.sent));
if (webhookResult.error) {
  writeOutput("webhook-error", webhookResult.error);
}

if (commentResult.error) {
  console.error(commentResult.error);
  process.exit(1);
}

if (webhookResult.error) {
  console.error(webhookResult.error);
  if (webhookFailOnError) {
    process.exit(1);
  }
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
  if (["json", "markdown", "html", "text"].includes(format)) {
    return format;
  }

  return parseBooleanInput(jsonInput, true) ? "json" : "text";
}

function normalizeMode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["check", "matrix"].includes(normalized)) {
    return normalized;
  }

  return "check";
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

function normalizeWebhookProvider(value) {
  const provider = String(value || "").trim().toLowerCase();
  if (["generic", "feishu", "dingtalk"].includes(provider)) {
    return provider;
  }

  return "generic";
}

function normalizeWebhookPolicy(value) {
  const policy = String(value || "").trim().toLowerCase();
  if (["always", "conflict", "high", "never"].includes(policy)) {
    return policy;
  }

  return "conflict";
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
      const matrixRisk = highestRiskLevel((payload.entries || []).map((entry) => entry.risk_level));
      if (matrixRisk) {
        return matrixRisk;
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

  const htmlRisk = report.match(/data-risk-level="(LOW|MEDIUM|HIGH)"/i);
  if (htmlRisk) {
    return htmlRisk[1].toUpperCase();
  }

  const reportRisks = [...report.matchAll(/\b(LOW|MEDIUM|HIGH)\b/g)].map((match) => match[1]);
  const highestReportRisk = highestRiskLevel(reportRisks);
  if (highestReportRisk) {
    return highestReportRisk;
  }

  return conflict ? "MEDIUM" : "LOW";
}

function highestRiskLevel(levels) {
  const scores = { LOW: 0, MEDIUM: 1, HIGH: 2 };
  return levels.reduce((highest, level) => {
    const normalized = String(level || "").toUpperCase();
    if (!Object.hasOwn(scores, normalized)) {
      return highest;
    }

    if (!highest || scores[normalized] > scores[highest]) {
      return normalized;
    }

    return highest;
  }, "");
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

function shouldSendWebhook(options) {
  if (!options.url || options.webhookOn === "never") {
    return false;
  }

  if (options.webhookOn === "always") {
    return true;
  }

  if (options.webhookOn === "high") {
    return options.riskLevel === "HIGH";
  }

  return options.conflict;
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
          ? options.mode === "matrix"
            ? "Review the highest-risk branches in the detailed report before the next merge window."
            : "Resolve or rebase the branch before merging. Start with the highest-risk directory in the detailed report."
          : "Review the report before merging. This workflow is not blocking because of the configured failure policy."
        : "No merge-conflict action needed.";
  const headRow = options.head ? [`| Head | ${inlineCode(options.head)} |`] : [];

  return [
    `# ${options.title}`,
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| Result | ${escapeMarkdownCell(resultLabel)} |`,
    `| Mode | ${inlineCode(options.mode)} |`,
    `| Base | ${inlineCode(options.base)} |`,
    ...headRow,
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

  const fence = format === "json" ? "json" : format === "html" ? "html" : "text";
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

async function sendWebhook(report, options) {
  if (!options.enabled) {
    return { sent: false };
  }

  const payload = buildWebhookPayload(report, options);
  if (process.env.BRANCHGUARD_WEBHOOK_MOCK_FILE) {
    appendFileSync(
      process.env.BRANCHGUARD_WEBHOOK_MOCK_FILE,
      `${JSON.stringify({ url: options.url, provider: options.provider, payload })}\n`,
      "utf8",
    );
    return { sent: true };
  }

  try {
    const response = await fetch(options.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "branchguard-cli",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      return { sent: false, error: `BranchGuard webhook failed with HTTP ${response.status}.` };
    }

    return { sent: true };
  } catch (error) {
    return { sent: false, error: `BranchGuard webhook failed: ${error.message}` };
  }
}

function buildWebhookPayload(report, options) {
  const title = options.conflict
    ? `BranchGuard ${options.riskLevel} conflict detected`
    : "BranchGuard check passed";
  const text = [
    title,
    `Mode: ${options.mode}`,
    `Base: ${options.base}`,
    ...(options.head ? [`Head: ${options.head}`] : []),
    `Risk: ${options.riskLevel}`,
    `Exit code: ${options.exitCode}`,
    `Workflow: ${options.workflowWillFail ? "failing" : "passing"}`,
    "",
    report || "No BranchGuard report was produced.",
  ].join("\n");

  if (options.provider === "feishu") {
    return {
      msg_type: "text",
      content: {
        text,
      },
    };
  }

  if (options.provider === "dingtalk") {
    return {
      msgtype: "markdown",
      markdown: {
        title,
        text: `### ${title}\n\n${text}`,
      },
    };
  }

  return {
    title,
    mode: options.mode,
    base: options.base,
    ...(options.head ? { head: options.head } : {}),
    exit_code: options.exitCode,
    conflict: options.conflict,
    risk_level: options.riskLevel,
    workflow_will_fail: options.workflowWillFail,
    report,
  };
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
