#!/usr/bin/env node

import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { canonicalize, verifyEvidencePayload } from "./verify-material-integrity.mjs";

const fixtureRoot = path.resolve("conformance", "fixtures");
const fixturePublicKey = await readFile(path.join(fixtureRoot, "keys", "rfc8032-test-key-1.pem"), "utf8");
const automatedVerifierPublicKey = await readFile(path.join(
  fixtureRoot,
  "noncircular-proof",
  "keys",
  "automated.pem"
), "utf8");
const outcomeRunnerPublicKey = await readFile(path.join(
  fixtureRoot,
  "keys",
  "rfc8032-test-key-3-runner.pem"
), "utf8");
const productionAuthorityContract = JSON.parse(await readFile(path.join(
  fixtureRoot,
  "production-derived-authority",
  "authority-contract.json"
), "utf8"));
const expectedProductionIdentities = new Map([
  ["production-provenance-key", {
    publicKeyDigest: "sha256:06e3fd8fda29bb60ab59557de61edb0aecdb231134be30e75b455f8e1b792fa9",
    producer: { id: "fixture-data-provenance-custodian", role: "data-provenance", trustDomain: "external" }
  }],
  ["production-data-owner-key", {
    publicKeyDigest: "sha256:fb569d8de02aefe7e84ba117e4662b4d8f41894cf44018c86bdb234353c635c3",
    producer: { id: "fixture-data-owner", role: "data-owner", trustDomain: "governance" }
  }],
  ["production-privacy-key", {
    publicKeyDigest: "sha256:8d39ba50abe50f77b6bb8ae7b6927aff7ffbeba35ad2837c0e51e82bcbcc60d5",
    producer: { id: "fixture-privacy-verifier", role: "privacy-verifier", trustDomain: "case_qa" }
  }],
  ["production-isolation-key", {
    publicKeyDigest: "sha256:3f7af13f85e3b4067199dce6886e5f1eacaac28eada32694631f56bebb3a84ce",
    producer: { id: "fixture-isolation-verifier", role: "environment-verifier", trustDomain: "runner" }
  }]
]);
const trustedFixtureIdentities = new Map([
  ["fixture-signature-profile\0Ed25519\0rfc8032-test-key-1", {
    publicKey: fixturePublicKey,
    producer: null
  }],
  ["fixture-automated-verifier-profile\0Ed25519\0rfc8032-test-key-2-verifier", {
    publicKey: automatedVerifierPublicKey,
    producer: { id: "fixture-independent-outcome-verifier", role: "verifier", trustDomain: "external" },
    schemaIds: new Set([
      "agent-eval-outcome-replay-receipt-1",
      "agent-eval-repo-change-grader-assessment-1",
      "agent-eval-repo-change-adjudication-record-1",
      "agent-eval-repo-change-measurement-validity-record-1"
    ]),
    creationPhase: "grading"
  }],
  ["fixture-runner-capture-profile\0Ed25519\0rfc8032-test-key-3-runner", {
    publicKey: outcomeRunnerPublicKey,
    producer: { id: "fixture-runner", role: "runner", trustDomain: "runner" },
    schemaIds: new Set([
      "agent-eval-repo-change-assurance-report-1",
      "agent-eval-repo-change-runner-check-record-1"
    ]),
    creationPhase: "execution"
  }]
]);
const expectedNegative = new Map([
  [path.normalize("material-integrity/negative/missing-artifact-bytes.json"), "payload bytes unavailable"],
  [path.normalize("negative/evidence-missing-byte-length.json"), "byteLength must be"]
]);
const expectedSignatureNegative = new Map([
  [path.normalize("negative/repo-change-measurement-validity-evidence-unauthorized-schema.json"),
    "not authorized for this evidence schema"]
]);

function isEvidenceArtifact(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && value.attestation && value.producer
    && typeof value.id === "string" && typeof value.uri === "string"
    && typeof value.digest === "string";
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

for (const [keyId, expected] of expectedProductionIdentities) {
  const matches = (productionAuthorityContract.authorities ?? [])
    .filter((authority) => authority.attestation?.profileId === "production-derived-fixture-authority-profile"
      && authority.attestation?.algorithm === "Ed25519"
      && authority.attestation?.keyId === keyId);
  if (matches.length !== 1) {
    throw new Error(`trusted production fixture key ${keyId} resolves ${matches.length} times`);
  }
  const authority = matches[0];
  const keyBytes = Buffer.from(authority.attestation.publicKey?.contentBase64 ?? "", "base64");
  const actualDigest = sha256(keyBytes);
  if (actualDigest !== expected.publicKeyDigest
    || authority.attestation.publicKey?.digest !== expected.publicKeyDigest) {
    throw new Error(`trusted production fixture key ${keyId} digest mismatch`);
  }
  if (JSON.stringify(authority.producer) !== JSON.stringify(expected.producer)) {
    throw new Error(`trusted production fixture key ${keyId} producer mapping mismatch`);
  }
  trustedFixtureIdentities.set(`production-derived-fixture-authority-profile\0Ed25519\0${keyId}`, {
    publicKey: createPublicKey({ key: keyBytes, format: "der", type: "spki" }),
    producer: expected.producer
  });
}

async function jsonFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await jsonFiles(absolute));
    else if (entry.isFile() && entry.name.endsWith(".json")) result.push(absolute);
  }
  return result;
}

function collectArtifacts(value, jsonPath = "$", result = []) {
  if (!value || typeof value !== "object") return result;
  if (isEvidenceArtifact(value)) {
    result.push({ artifact: value, jsonPath });
    return result;
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) => collectArtifacts(child, `${jsonPath}[${index}]`, result));
  } else {
    for (const [key, child] of Object.entries(value)) collectArtifacts(child, `${jsonPath}.${key}`, result);
  }
  return result;
}

function attestationIssue(artifact) {
  const identity = trustedFixtureIdentities.get([
    artifact.attestation?.profileId,
    artifact.attestation?.algorithm,
    artifact.attestation?.keyId
  ].join("\0"));
  if (!identity) {
    return "unrecognized fixture attestation identity";
  }
  if (identity.producer && JSON.stringify(artifact.producer) !== JSON.stringify(identity.producer)) {
    return "fixture attestation key is not authorized for this producer";
  }
  if (identity.schemaIds && !identity.schemaIds.has(artifact.schemaMetadata?.schemaId)) {
    return "fixture attestation key is not authorized for this evidence schema";
  }
  if (identity.creationPhase && artifact.creationPhase !== identity.creationPhase) {
    return "fixture attestation key is not authorized for this creation phase";
  }
  const projection = structuredClone(artifact);
  delete projection.attestation.value;
  const message = Buffer.concat([
    Buffer.from("agent-evals-evidence-artifact-1", "ascii"),
    Buffer.from([0]),
    Buffer.from(canonicalize(projection), "utf8")
  ]);
  const signature = Buffer.from(artifact.attestation.value, "base64url");
  return verifySignature(null, message, identity.publicKey, signature)
    ? null
    : "Ed25519 attestation is invalid";
}

let checked = 0;
let failures = 0;
for (const sourcePath of await jsonFiles(fixtureRoot)) {
  const relative = path.relative(fixtureRoot, sourcePath);
  const document = JSON.parse(await readFile(sourcePath, "utf8"));
  for (const { artifact, jsonPath } of collectArtifacts(document)) {
    checked += 1;
    const baseDirectory = sourcePath.includes(`${path.sep}material-integrity${path.sep}`)
      ? path.join(fixtureRoot, "material-integrity")
      : path.dirname(sourcePath);
    const issues = await verifyEvidencePayload(artifact, { baseDirectory });
    const signatureProblem = attestationIssue(artifact);
    const expectedSignatureIssue = expectedSignatureNegative.get(relative);
    if (signatureProblem && (!expectedSignatureIssue || !signatureProblem.includes(expectedSignatureIssue))) {
      failures += 1;
      console.error(`FAIL ${relative} ${jsonPath}: ${signatureProblem}`);
    } else if (!signatureProblem && expectedSignatureIssue) {
      failures += 1;
      console.error(`FAIL ${relative} ${jsonPath}: expected signature issue containing ${JSON.stringify(expectedSignatureIssue)}`);
    }
    const expectedIssue = expectedNegative.get(relative);
    if (expectedIssue) {
      if (!issues.some((issue) => issue.includes(expectedIssue))) {
        failures += 1;
        console.error(`FAIL ${relative} ${jsonPath}: expected issue containing ${JSON.stringify(expectedIssue)}`);
      }
    } else if (issues.length > 0) {
      failures += 1;
      console.error(`FAIL ${relative} ${jsonPath}: ${issues.join("; ")}`);
    }
  }
}

for (const relative of expectedNegative.keys()) {
  const sourcePath = path.join(fixtureRoot, relative);
  const document = JSON.parse(await readFile(sourcePath, "utf8"));
  if (collectArtifacts(document).length === 0) {
    failures += 1;
    console.error(`FAIL ${relative}: expected negative contains no evidence artifact`);
  }
}
for (const relative of expectedSignatureNegative.keys()) {
  const sourcePath = path.join(fixtureRoot, relative);
  const document = JSON.parse(await readFile(sourcePath, "utf8"));
  if (collectArtifacts(document).length === 0) {
    failures += 1;
    console.error(`FAIL ${relative}: expected signature negative contains no evidence artifact`);
  }
}

if (failures > 0) {
  console.error(`${failures} material-evidence checks failed across ${checked} evidence records`);
  process.exitCode = 1;
} else {
  console.log(`PASS ${checked} evidence records have material bytes; ${expectedNegative.size + expectedSignatureNegative.size} declared negatives fail closed`);
}
