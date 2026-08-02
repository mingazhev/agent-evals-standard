#!/usr/bin/env node

import { createPrivateKey, sign } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalize,
  dependencyManifestDigest,
  sha256Bytes,
  sha256Canonical
} from "./verify-repository-grounding.mjs";
import { refreshGroundingEvidence } from "./refresh-grounding-evidence.mjs";

// RFC 8032 test vector 1 is public conformance material, never an operational key.
const fixtureSeed = Buffer.from(
  "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
  "hex"
);
const pkcs8Prefix = Buffer.from("302e020100300506032b657004220420", "hex");
const fixtureProfileId = "fixture-signature-profile";
const fixtureKeyId = "rfc8032-test-key-1";
const evidenceDomain = "agent-evals-evidence-artifact-1";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const positiveRoot = path.join(root, "conformance", "fixtures", "positive");
const statementPath = path.join(positiveRoot, "conformance-statement-decision.json");
const statementEnvelopePath = path.join(positiveRoot, "validation-envelope-conformance-statement.json");
const decisionEnvelopePath = path.join(positiveRoot, "validation-envelope-decision.json");
const decisionPath = path.join(positiveRoot, "governance-decision.json");
const scorecardPath = path.join(positiveRoot, "scorecard.json");
const applicabilityPath = path.join(positiveRoot, "decision-applicability-contract.json");
const verifierPath = path.join(root, "tools", "verify-repository-grounding.mjs");
const profilePath = path.join(root, "profiles", "repo-change-v1", "evaluation-profile.json");
const outcomePath = path.join(root, "profiles", "repo-change-v1", "outcome-profile.json");
const claimTrustPath = path.join(root, "profiles", "repo-change-v1", "operational-signature-profile.json");
const workRegistryPath = path.join(root, "standard", "work-artifact-registry.json");
const schemaManifestPath = path.join(positiveRoot, "schema-manifest.json");
const contractManifestPath = path.join(positiveRoot, "contract-manifest.json");
const requirementRegistryPath = path.join(root, "standard", "requirement-registry.json");

function fixturePrivateKey() {
  return createPrivateKey({
    key: Buffer.concat([pkcs8Prefix, fixtureSeed]),
    format: "der",
    type: "pkcs8"
  });
}

function signatureMessage(domain, document, signatureProperty = "signature") {
  const projection = structuredClone(document);
  delete projection[signatureProperty].value;
  return Buffer.concat([
    Buffer.from(domain, "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalize(projection), "utf8")
  ]);
}

function signFixtureDocument(document) {
  if (!document.schemaVersion || document.signature?.profileId !== fixtureProfileId
    || document.signature?.algorithm !== "Ed25519"
    || document.signature?.keyId !== fixtureKeyId) {
    throw new Error(`refusing to sign non-fixture document ${document.id ?? document.envelopeId}`);
  }
  if (typeof document.digest === "string") {
    const projection = structuredClone(document);
    delete projection.digest;
    delete projection.signature;
    document.digest = sha256Canonical(projection);
  }
  document.signature.value = sign(
    null,
    signatureMessage(document.schemaVersion, document),
    fixturePrivateKey()
  ).toString("base64url");
}

function signEvidenceArtifact(artifact) {
  if (artifact.attestation?.profileId !== fixtureProfileId
    || artifact.attestation?.algorithm !== "Ed25519"
    || artifact.attestation?.keyId !== fixtureKeyId) {
    throw new Error(`refusing to sign non-fixture evidence ${artifact.id}`);
  }
  artifact.attestation.value = sign(
    null,
    signatureMessage(evidenceDomain, artifact, "attestation"),
    fixturePrivateKey()
  ).toString("base64url");
}

async function readJson(absolute) {
  return JSON.parse(await readFile(absolute, "utf8"));
}

async function writeJson(absolute, document) {
  const bytes = Buffer.from(`${JSON.stringify(document, null, 2)}\n`, "utf8");
  await writeFile(absolute, bytes);
  return bytes;
}

function assertIdentity(document, id, version = "0.1.0") {
  const actualId = document.id ?? document.decisionId;
  if (actualId !== id || document.version !== version) {
    throw new Error(`unexpected identity ${actualId}@${document.version}; expected ${id}@${version}`);
  }
}

function pointerBinding(pointer) {
  return { id: pointer.id, version: pointer.version, uri: pointer.uri, digest: pointer.digest };
}

function rebuildDependencyEntries(statement, target) {
  const entries = [{ role: "target_subject", ...pointerBinding(target.targetSubject) }];
  for (const slice of statement.scope.slices) {
    entries.push({ role: "repository_snapshot", scopeSliceId: slice.id, ...pointerBinding(slice.repositorySnapshot) });
    entries.push({ role: "evaluation_profile", scopeSliceId: slice.id, ...pointerBinding(slice.evaluationProfile) });
    entries.push({ role: "work_artifact_registry", scopeSliceId: slice.id, ...pointerBinding(slice.workArtifactRegistry) });
    for (const outcome of slice.outcomeProfiles) {
      entries.push({ role: "outcome_profile", scopeSliceId: slice.id, ...pointerBinding(outcome) });
    }
  }
  const applicabilityPointers = new Map();
  for (const row of target.requirementResults) {
    const pointer = pointerBinding(row.applicabilityContract);
    applicabilityPointers.set(canonicalize(pointer), pointer);
  }
  for (const pointer of applicabilityPointers.values()) {
    entries.push({ role: "applicability_contract", ...pointer });
  }
  for (const entry of target.dependencyManifest.entries) {
    if (entry.role === "conformance_dependency"
      || (entry.role === "target_artifact" && entry.artifactType === "scorecard")) {
      entries.push(structuredClone(entry));
    }
  }
  return entries;
}

const statement = await readJson(statementPath);
if (statement.id !== "conformance-decision-fixture-1" || statement.claim !== "decision") {
  throw new Error("unexpected conformance statement identity or target");
}
const target = statement.targetEvidence?.decision;
if (!target) throw new Error("decision target evidence is missing");
for (const [field, absolute] of [
  ["schemas", schemaManifestPath],
  ["contracts", contractManifestPath]
]) {
  const bytes = await readFile(absolute);
  const manifest = JSON.parse(bytes.toString("utf8"));
  statement[field] = {
    id: manifest.id,
    version: manifest.version,
    uri: path.basename(absolute),
    digest: sha256Bytes(bytes),
    entriesDigest: manifest.entriesDigest
  };
}

const decision = await readJson(decisionPath);
assertIdentity(decision, "governance-decision-fixture-1");
const scorecard = await readJson(scorecardPath);
if (scorecard.schemaVersion !== "agent-eval-scorecard-1" || typeof scorecard.digest !== "string") {
  throw new Error("unexpected scorecard identity or missing self digest");
}
if (decision.scorecards.length !== 1) throw new Error("fixture decision must bind exactly one scorecard");
decision.scorecards[0].digest = scorecard.digest;
signFixtureDocument(decision);
const decisionBytes = await writeJson(decisionPath, decision);
target.targetSubject.digest = sha256Bytes(decisionBytes);

const profile = await readJson(profilePath);
const outcome = await readJson(outcomePath);
const claimTrust = await readJson(claimTrustPath);
const workRegistryBytes = await readFile(workRegistryPath);
const workRegistry = JSON.parse(workRegistryBytes.toString("utf8"));
assertIdentity(profile, "repo-change-v1");
assertIdentity(outcome, "workspace-change-v1");
assertIdentity(claimTrust, "repo-change-operational-signature-profile");
assertIdentity(workRegistry, "repository-sdlc-work-artifact-registry");

const workspaceBySlice = new Map();
for (const slice of statement.scope.slices) {
  const workspacePath = path.resolve(positiveRoot, slice.repositorySnapshot.uri);
  const bytes = await readFile(workspacePath);
  const workspace = JSON.parse(bytes.toString("utf8"));
  if (workspace.id !== slice.repositorySnapshot.id || workspace.version !== slice.repositorySnapshot.version) {
    throw new Error(`workspace identity mismatch for ${slice.id}`);
  }
  slice.repositorySnapshot.digest = sha256Bytes(bytes);
  slice.evaluationProfile.digest = profile.digest;
  slice.evaluationProfile.effectiveProfileDigest = profile.effectiveProfileDigest;
  slice.workArtifactRegistry.digest = sha256Bytes(workRegistryBytes);
  for (const binding of slice.outcomeProfiles) binding.digest = outcome.digest;
  workspaceBySlice.set(slice.id, { workspace, bytes, path: workspacePath });
}
statement.claimTrustProfile.digest = claimTrust.digest;

const applicability = await readJson(applicabilityPath);
assertIdentity(applicability, "decision-applicability-contract");
const requirementRegistry = await readJson(requirementRegistryPath);
const requirementsById = new Map(requirementRegistry.requirements.map((entry) => [entry.id, entry]));
for (const rule of applicability.rules) {
  const requirement = requirementsById.get(rule.requirementId);
  if (!requirement) throw new Error(`unknown applicability requirement ${rule.requirementId}`);
  rule.registryApplicabilityDigest = sha256Canonical({
    requirementId: requirement.id,
    targets: requirement.targets,
    applicability: requirement.applicability
  });
}
for (const binding of applicability.scopeSlices) {
  const slice = statement.scope.slices.find((entry) => entry.id === binding.sliceId);
  if (!slice) throw new Error(`unknown applicability scope slice ${binding.sliceId}`);
  binding.evaluationProfile = {
    id: slice.evaluationProfile.id,
    version: slice.evaluationProfile.version,
    digest: slice.evaluationProfile.digest,
    effectiveProfileDigest: slice.evaluationProfile.effectiveProfileDigest
  };
}
signFixtureDocument(applicability);
await writeJson(applicabilityPath, applicability);
for (const row of target.requirementResults) {
  if (row.applicabilityContract.id !== applicability.id
    || row.applicabilityContract.version !== applicability.version) {
    throw new Error(`unexpected applicability binding for ${row.requirementId}`);
  }
  row.applicabilityContract.digest = applicability.digest;
}

target.dependencyManifest.entries = rebuildDependencyEntries(statement, target);
target.dependencyManifest.digest = dependencyManifestDigest(target.dependencyManifest);

const verifierDigest = sha256Bytes(await readFile(verifierPath));
const groundingBytesById = new Map();
for (const slice of statement.scope.slices) {
  const evidenceId = slice.materialRepositoryGrounding.evidenceId;
  const evidencePath = path.join(positiveRoot, `${evidenceId}.json`);
  const evidence = await readJson(evidencePath);
  if (evidence.id !== evidenceId || evidence.scopeSliceId !== slice.id) {
    throw new Error(`grounding evidence identity mismatch for ${slice.id}`);
  }
  refreshGroundingEvidence(evidence, workspaceBySlice.get(slice.id).workspace, verifierDigest);
  evidence.targetSubject = structuredClone(target.targetSubject);
  evidence.dependencyManifestDigest = target.dependencyManifest.digest;
  evidence.workspaceManifest = structuredClone(slice.repositorySnapshot);
  evidence.verifierExecution.inputs = [
    { role: "workspace_manifest", id: slice.repositorySnapshot.id, digest: slice.repositorySnapshot.digest },
    { role: "target_subject", id: target.targetSubject.id, digest: target.targetSubject.digest },
    { role: "dependency_manifest", id: target.dependencyManifest.id, digest: target.dependencyManifest.digest }
  ];
  groundingBytesById.set(evidenceId, await writeJson(evidencePath, evidence));
}

for (const artifact of statement.evidenceManifest) {
  const payloadBytes = groundingBytesById.get(artifact.id);
  if (!payloadBytes) throw new Error(`unexpected conformance evidence ${artifact.id}`);
  artifact.digest = sha256Bytes(payloadBytes);
  artifact.byteLength = payloadBytes.length;
  artifact.schemaMetadata.validatorDigest = verifierDigest;
  signEvidenceArtifact(artifact);
}
signFixtureDocument(statement);
await writeJson(statementPath, statement);

const statementEnvelope = await readJson(statementEnvelopePath);
if (statementEnvelope.envelopeId !== "conformance-statement-validation-envelope-fixture-1") {
  throw new Error("unexpected conformance validation envelope identity");
}
const statementProjection = structuredClone(statement);
delete statementProjection.digest;
delete statementProjection.signature;
statementEnvelope.subject.digest = sha256Canonical(statementProjection);
statementEnvelope.subject.targetSubject = structuredClone(target.targetSubject);
statementEnvelope.subject.dependencyManifest = structuredClone(target.dependencyManifest);
statementEnvelope.evidenceManifest = structuredClone(statement.evidenceManifest);
signFixtureDocument(statementEnvelope);
await writeJson(statementEnvelopePath, statementEnvelope);

const decisionEnvelope = await readJson(decisionEnvelopePath);
if (decisionEnvelope.envelopeId !== "decision-validation-envelope-fixture-1") {
  throw new Error("unexpected decision validation envelope identity");
}
const decisionProjection = structuredClone(decision);
delete decisionProjection.digest;
delete decisionProjection.signature;
decisionEnvelope.subject.digest = sha256Canonical(decisionProjection);
signFixtureDocument(decisionEnvelope);
await writeJson(decisionEnvelopePath, decisionEnvelope);

for (const absolute of [
  ...statement.scope.slices.map((slice) => path.join(positiveRoot, `${slice.materialRepositoryGrounding.evidenceId}.json`)),
  decisionPath,
  applicabilityPath,
  statementPath,
  statementEnvelopePath,
  decisionEnvelopePath
]) {
  process.stdout.write(`${path.relative(root, absolute)}\n`);
}
