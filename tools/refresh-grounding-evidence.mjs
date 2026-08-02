#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  sha256Canonical
} from "./verify-repository-grounding.mjs";

function clone(value) {
  return structuredClone(value);
}

function assertionDigest(assertion) {
  const projection = clone(assertion);
  delete projection.resultDigest;
  return sha256Canonical(projection);
}

export function refreshGroundingEvidence(evidence, workspace, verifierDigest) {
  void workspace;
  evidence.subjectCoverage = { outcomes: [], claims: [] };
  evidence.causalContract = null;
  evidence.causalReplay = null;
  evidence.verifierExecution.verifier.digest = verifierDigest;
  evidence.verifierExecution.inputs = evidence.verifierExecution.inputs.filter((entry) =>
    ["workspace_manifest", "target_subject", "dependency_manifest"].includes(entry.role));
  evidence.assertions = evidence.assertions.map((assertion) => ({
    id: assertion.id,
    type: assertion.type,
    verdict: "insufficient_evidence",
    reasonCode: "no_executable_subject_contract",
    resultDigest: ""
  }));
  for (const assertion of evidence.assertions) assertion.resultDigest = assertionDigest(assertion);
  const assertionResults = evidence.assertions.map((assertion) => ({
    type: assertion.type,
    verdict: "insufficient_evidence",
    resultDigest: assertion.resultDigest
  }));
  evidence.verifierExecution.output = {
    overallVerdict: "insufficient_evidence",
    reasonCodes: ["no_executable_subject_contract"],
    assertionResults,
    outputDigest: ""
  };
  evidence.verifierExecution.output.outputDigest = sha256Canonical({
    overallVerdict: "insufficient_evidence",
    reasonCodes: ["no_executable_subject_contract"],
    assertionResults
  });
  evidence.verdict = "insufficient_evidence";
  return evidence;
}

async function main() {
  const [verifierPath, ...pairs] = process.argv.slice(2);
  if (!verifierPath || pairs.length === 0 || pairs.some((_, index) => index % 2 === 0 && !pairs[index + 1])) {
    process.stderr.write("usage: node tools/refresh-grounding-evidence.mjs <verifier.mjs> <evidence.json> <workspace.json> [...]\n");
    process.exitCode = 2;
    return;
  }
  const verifierBytes = await readFile(path.resolve(verifierPath));
  const { sha256Bytes } = await import("./verify-repository-grounding.mjs");
  const verifierDigest = sha256Bytes(verifierBytes);
  for (let index = 0; index < pairs.length; index += 2) {
    const evidenceAbsolute = path.resolve(pairs[index]);
    const workspaceAbsolute = path.resolve(pairs[index + 1]);
    const evidence = JSON.parse(await readFile(evidenceAbsolute, "utf8"));
    const workspace = JSON.parse(await readFile(workspaceAbsolute, "utf8"));
    refreshGroundingEvidence(evidence, workspace, verifierDigest);
    await writeFile(evidenceAbsolute, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    process.stdout.write(`${path.relative(process.cwd(), evidenceAbsolute)}\n`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  await main();
}
