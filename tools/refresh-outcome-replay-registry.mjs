#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const registryPath = path.join(root, "standard", "outcome-replay-executor-registry.json");
const registry = JSON.parse(await readFile(registryPath, "utf8"));
const pointerFields = [
  "outcomeProfile",
  "semanticContract",
  "executor",
  "classificationApplicabilityRule"
];

function sha256Bytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

for (const entry of registry.executors ?? []) {
  if (entry.outcomeProfile?.id !== entry.outcomeProfileId) {
    throw new Error(`${entry.outcomeProfileId} has a mismatched outcomeProfile pointer`);
  }
  for (const field of pointerFields) {
    const pointer = entry[field];
    if (!pointer?.uri) throw new Error(`${entry.outcomeProfileId} has no ${field} pointer`);
    const absolute = path.resolve(path.dirname(registryPath), pointer.uri);
    const relative = path.relative(root, absolute);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`${entry.outcomeProfileId} ${field} pointer escapes the repository`);
    }
    pointer.digest = sha256Bytes(await readFile(absolute));
  }
}

await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
process.stdout.write(`${path.relative(root, registryPath)}\n`);
