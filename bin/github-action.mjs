#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
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
