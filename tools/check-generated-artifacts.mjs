#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    ...options
  });
  if (result.error) throw result.error;
  return result;
}

function status() {
  const result = run("git", ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
  return result.stdout.trim();
}

const before = status();
if (before) {
  process.stderr.write("Generated-artifact idempotence check requires a clean worktree; refusing to overwrite local changes.\n");
  process.stderr.write(`${before}\n`);
  process.exit(2);
}

const refresh = run(process.execPath, ["tools/refresh-all-generated-artifacts.mjs"], { stdio: "inherit" });
if (refresh.status !== 0) process.exit(refresh.status ?? 1);

const after = status();
if (after) {
  process.stderr.write("Generated artifacts are stale or the generator DAG is not idempotent:\n");
  process.stderr.write(`${after}\n`);
  process.exit(1);
}
process.stdout.write("Generated artifacts are current and idempotent.\n");
