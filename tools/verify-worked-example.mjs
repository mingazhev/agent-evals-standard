#!/usr/bin/env node
// Fixture assertion for examples/core: recomputes the attempt-ledger digest
// chain and the pass@1 / paired-difference point estimates from the ledger and
// compares them with the committed ledger and scorecard. Not a validator.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const core = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../examples/core");
const read = async (name) => JSON.parse(await readFile(path.join(core, name), "utf8"));
// RFC 8785 JCS for this fixture: recursively key-sorted JSON, no whitespace (strings and integers only).
const jcs = (v) => Array.isArray(v) ? `[${v.map(jcs).join(",")}]`
  : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${jcs(v[k])}`).join(",")}}`
  : JSON.stringify(v);
const digest = (v) => `sha256:${createHash("sha256").update(jcs(v)).digest("hex")}`;

const ledger = await read("attempt-ledger.json");
const scorecard = await read("scorecard.json");
const failures = [];
const expect = (label, actual, expected) => {
  if (actual !== expected) failures.push(`${label}: expected ${expected}, got ${actual}`);
};

let previous = digest(ledger.runManifest);
for (const { entryDigest, ...entry } of ledger.entries) {
  expect(`entry ${entry.sequence} previousEntryDigest`, entry.previousEntryDigest, previous);
  previous = digest(entry);
  expect(`entry ${entry.sequence} entryDigest`, entryDigest, previous);
}
expect("terminalDigest", ledger.terminalDigest, previous);

// Valid-only point estimate: mean over cases of successes / valid trials.
const solved = (arm) => {
  const perCase = new Map();
  for (const e of ledger.entries.filter((x) => x.armId === arm && x.validity === "valid")) {
    const c = perCase.get(e.caseId) ?? { n: 0, s: 0 };
    c.n += 1;
    c.s += e.primaryOutcome === "solved";
    perCase.set(e.caseId, c);
  }
  return [...perCase.values()].reduce((sum, c) => sum + c.s / c.n, 0) / perCase.size;
};
const round4 = (x) => Math.round(x * 1e4) / 1e4;
const agent = round4(solved("agent-x"));
const diff = round4(solved("agent-x") - solved("control-codemods"));
const estimate = (id) => scorecard.metrics.find((m) => m.id === id).estimate;
expect("pass@1 estimate", estimate("m-agent-pass-at-1"), agent);
expect("paired difference estimate", estimate("m-agent-minus-control"), diff);

if (failures.length) {
  console.error(`Worked example check failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log(`terminalDigest ${previous}\npass@1 estimate ${agent}\npaired difference estimate ${diff}`);
