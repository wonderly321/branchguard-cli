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
const writeStepSummary = parseBooleanInput(getInput("summary"), true);
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

writeOutput("exit-code", String(exitCode));
writeOutput("conflict", String(conflict));
if (report) {
  writeOutput("report", report);
}
const summaryWritten = writeSummary(report, writeStepSummary);
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

if (conflict && !failOnConflict) {
  console.log("BranchGuard detected conflicts, but fail-on-conflict is false.");
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

function writeOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) {
    return;
  }

  const delimiter = `branchguard_${name}_${Date.now()}`;
  appendFileSync(process.env.GITHUB_OUTPUT, `${name}<<${delimiter}\n${value}\n${delimiter}\n`, "utf8");
}

function writeSummary(report, enabled) {
  if (!enabled || !report || !process.env.GITHUB_STEP_SUMMARY) {
    return false;
  }

  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`, "utf8");
  return true;
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
