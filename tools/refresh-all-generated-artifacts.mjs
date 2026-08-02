#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const generators = [
  { script: "tools/refresh-requirement-registry-digest.mjs" },
  {
    script: "tools/build-profile-requirement-routing.mjs",
    args: [
      "profiles/repo-change-v1/evaluation-profile.json",
      "profiles/repo-change-v1/implementation-contract.json",
      "implementation-contract.json"
    ]
  },
  {
    script: "tools/build-profile-requirement-routing.mjs",
    args: [
      "profiles/repository-review-v1/evaluation-profile.json",
      "profiles/repository-review-v1/implementation-contract.json",
      "implementation-contract.json"
    ]
  },
  {
    script: "tools/build-profile-requirement-routing.mjs",
    args: [
      "conformance/fixtures/architecture-evaluation-profile-child.json",
      "conformance/fixtures/architecture-requirement-implementation-contract.json",
      "architecture-requirement-implementation-contract.json"
    ]
  },
  { script: "tools/refresh-profile-requirement-routing-artifacts.mjs" },
  { script: "tools/refresh-outcome-replay-registry.mjs" },
  { script: "tools/refresh-distribution-manifests.mjs" },
  { script: "tools/refresh-scorecard-support-graph.mjs" },
  { script: "tools/generate-machine-contract-fixtures.mjs" },
  { script: "tools/refresh-outcome-replay-fixture.mjs" },
  { script: "tools/refresh-case-qa-fixture.mjs" },
  { script: "tools/refresh-conformance-support-graph.mjs" },
  { script: "tools/generate-noncircular-proof-fixtures.mjs" },
  { script: "tools/generate-production-derived-authority-vectors.mjs" }
];

function repositoryDigest() {
  const digest = createHash("sha256");
  function visit(directory) {
    const entries = readdirSync(directory, { withFileTypes: true })
      .filter((entry) => ![".git", "node_modules"].includes(entry.name))
      .sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
      } else if (entry.isFile()) {
        const relative = path.relative(root, absolute).split(path.sep).join("/");
        digest.update(relative, "utf8");
        digest.update(Buffer.from([0]));
        digest.update(readFileSync(absolute));
        digest.update(Buffer.from([0]));
      }
    }
  }
  visit(root);
  return digest.digest("hex");
}

const maximumPasses = 5;
for (let pass = 1; pass <= maximumPasses; pass += 1) {
  const before = repositoryDigest();
  process.stdout.write(`Generator DAG pass ${pass}/${maximumPasses}\n`);
  for (const generator of generators) {
    const invocation = [generator.script, ...(generator.args ?? [])];
    process.stdout.write(`==> ${invocation.join(" ")}\n`);
    let result;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      result = spawnSync(process.execPath, invocation, {
        cwd: root,
        encoding: "utf8",
        stdio: "inherit"
      });
      if (!result.error && result.status === 0) break;
      if (attempt < 4) {
        process.stderr.write(`${invocation.join(" ")} failed; retrying (${attempt}/3)\n`);
      }
    }
    if (result.error) throw result.error;
    if (result.status !== 0) {
      process.stderr.write(`${invocation.join(" ")} failed with exit code ${result.status}\n`);
      process.exit(result.status ?? 1);
    }
  }
  if (repositoryDigest() === before) {
    process.stdout.write(`Generator DAG converged after ${pass} pass${pass === 1 ? "" : "es"}.\n`);
    process.exit(0);
  }
}
process.stderr.write(`Generator DAG did not converge after ${maximumPasses} passes.\n`);
process.exit(1);
