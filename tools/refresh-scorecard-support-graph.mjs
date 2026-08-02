#!/usr/bin/env node

import { createHash, createPrivateKey, sign } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  attemptCheckpointDigest,
  attemptLedgerDigest,
  attemptLedgerInitialRoot,
  attemptLedgerTerminalRoot,
  attemptReceiptDigest
} from "./verify-material-integrity.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = path.join(root, "conformance", "fixtures");
const positiveRoot = path.join(fixtureRoot, "positive");
const machineRoot = path.join(fixtureRoot, "machine-contracts-v1", "positive");
const fixtureSeed = Buffer.from(
  "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
  "hex"
);
const schedulerSeed = Buffer.from(
  "4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb",
  "hex"
);
const pkcs8Prefix = Buffer.from("302e020100300506032b657004220420", "hex");
const schedulerProfileId = "fixture-independent-scheduler-profile";
const schedulerKeyId = "rfc8032-test-key-2-scheduler";
const receiptDomain = "agent-evals-attempt-receipt-1";
const checkpointDomain = "agent-eval-attempt-checkpoint-1";

function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function sha256Canonical(value) {
  return sha256(Buffer.from(canonicalize(value), "utf8"));
}

function fixturePrivateKey() {
  return createPrivateKey({
    key: Buffer.concat([pkcs8Prefix, fixtureSeed]),
    format: "der",
    type: "pkcs8"
  });
}

function schedulerPrivateKey() {
  return createPrivateKey({
    key: Buffer.concat([pkcs8Prefix, schedulerSeed]),
    format: "der",
    type: "pkcs8"
  });
}

function signatureMessage(domain, document) {
  const projection = structuredClone(document);
  delete projection.signature.value;
  return Buffer.concat([
    Buffer.from(domain, "ascii"),
    Buffer.from([0]),
    Buffer.from(canonicalize(projection), "utf8")
  ]);
}

function signSchedulerObject(document, domain) {
  document.signature.value = sign(
    null,
    signatureMessage(domain, document),
    schedulerPrivateKey()
  ).toString("base64url");
}

function refreshLedger(ledger) {
  ledger.initialLedgerRoot = attemptLedgerInitialRoot(ledger);
  ledger.terminalLedgerRoot = attemptLedgerTerminalRoot(ledger);
  ledger.digest = attemptLedgerDigest(ledger);
}

function makeSchedulerSignature(signedAt) {
  return {
    profileId: schedulerProfileId,
    algorithm: "Ed25519",
    keyId: schedulerKeyId,
    signedAt,
    value: "pending"
  };
}

function makeCanonicalCheckpoint(ledger, closedAt) {
  const receipts = [];
  let previousReceiptDigest = null;
  for (let index = 0; index < ledger.attemptRecords.length; index += 1) {
    const attempt = ledger.attemptRecords[index];
    const receipt = {
      sequence: index + 1,
      experimentId: ledger.experimentId,
      scheduledSetCommitmentDigest: ledger.scheduledSetCommitment.digest,
      attemptId: attempt.attemptId,
      cellId: attempt.cellId,
      parentAttemptId: attempt.parentAttemptId,
      startedAt: attempt.startedAt,
      previousReceiptDigest,
      receiptDigest: "sha256:pending",
      signature: makeSchedulerSignature(attempt.startedAt)
    };
    receipt.receiptDigest = attemptReceiptDigest(receipt);
    signSchedulerObject(receipt, receiptDomain);
    receipts.push(receipt);
    previousReceiptDigest = receipt.receiptDigest;
  }

  const issuedAt = new Date(Date.parse(closedAt) + 1000).toISOString().replace(".000Z", "Z");
  const checkpoint = {
    schemaVersion: "agent-eval-attempt-checkpoint-1",
    id: "attempt-checkpoint-fixture-1",
    version: "0.1.0",
    experimentId: ledger.experimentId,
    scheduledSetCommitment: structuredClone(ledger.scheduledSetCommitment),
    ledger: {
      id: ledger.id,
      uri: "attempt-ledger.json",
      digest: ledger.digest
    },
    issuer: {
      id: "fixture-independent-scheduler",
      role: "independent_scheduler",
      trustDomain: "fixture-scheduler-boundary"
    },
    logBinding: {
      logId: "canonical-fixture-attempt-log",
      checkpointSequence: 1,
      previousCheckpointDigest: null,
      publicationUri: "https://scheduler.example.invalid/logs/canonical-fixture-attempt-log/checkpoints/1"
    },
    checkpointKind: "terminal",
    receiptChainAlgorithm: "sha256-jcs-receipts-v1",
    ledgerRootAlgorithm: ledger.rootAlgorithm,
    receipts,
    terminalBinding: {
      receiptCount: receipts.length,
      terminalReceiptDigest: previousReceiptDigest,
      orderedAttemptIdsDigest: sha256Canonical(receipts.map((receipt) => receipt.attemptId)),
      attemptRecordsDigest: sha256Canonical(ledger.attemptRecords),
      initialLedgerRoot: ledger.initialLedgerRoot,
      terminalLedgerRoot: ledger.terminalLedgerRoot,
      closedAt
    },
    issuedAt,
    digest: "sha256:pending",
    signature: makeSchedulerSignature(issuedAt)
  };
  checkpoint.digest = attemptCheckpointDigest(checkpoint);
  signSchedulerObject(checkpoint, checkpointDomain);
  return checkpoint;
}

function refreshSigned(document) {
  if (document.signature?.profileId !== "fixture-signature-profile"
    || document.signature?.keyId !== "rfc8032-test-key-1"
    || document.signature?.algorithm !== "Ed25519") {
    throw new Error(`refusing to sign non-fixture artifact ${document.id ?? document.schemaVersion}`);
  }
  const digestProjection = structuredClone(document);
  delete digestProjection.digest;
  delete digestProjection.signature;
  document.digest = sha256Canonical(digestProjection);
  const signingProjection = structuredClone(document);
  delete signingProjection.signature.value;
  const message = Buffer.concat([
    Buffer.from(document.schemaVersion, "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalize(signingProjection), "utf8")
  ]);
  document.signature.value = sign(null, message, fixturePrivateKey()).toString("base64url");
}

async function readJson(absolute) {
  return JSON.parse(await readFile(absolute, "utf8"));
}

async function writeJson(absolute, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  await writeFile(absolute, bytes);
  return bytes;
}

function rebaseLocators(value, sourceOwner, targetOwner) {
  if (!value || typeof value !== "object") return;
  if (!Array.isArray(value) && value.locator?.kind === "repository_relative"
    && value.locator?.base === "binding_document") {
    const target = path.resolve(sourceOwner, value.locator.path);
    value.locator.path = path.relative(targetOwner, target).replaceAll("\\", "/");
  }
  for (const nested of Array.isArray(value) ? value : Object.values(value)) {
    rebaseLocators(nested, sourceOwner, targetOwner);
  }
}

function replaceExact(value, from, to) {
  if (value === from) return to;
  if (Array.isArray(value)) return value.map((entry) => replaceExact(entry, from, to));
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) value[key] = replaceExact(entry, from, to);
  }
  return value;
}

async function materialPointer(ownerDirectory, absolute, idOverride) {
  const bytes = await readFile(absolute);
  const document = JSON.parse(bytes.toString("utf8"));
  if (typeof document.digest !== "string") throw new Error(`${absolute} has no self digest`);
  const digest = sha256(bytes);
  return {
    id: idOverride ?? document.id,
    version: document.version ?? document.caseVersion,
    uri: `artifact:${digest}`,
    digest,
    byteLength: bytes.length,
    mediaType: "application/json",
    locator: {
      kind: "repository_relative",
      base: "binding_document",
      path: path.relative(ownerDirectory, absolute).replaceAll("\\", "/")
    },
    selfDigest: document.digest
  };
}

function syncComponents(value, components) {
  if (!value || typeof value !== "object") return;
  if (!Array.isArray(value)) {
    if (value.id === components.profile.id && value.version === components.profile.version) {
      if (Object.hasOwn(value, "digest")) value.digest = components.profile.digest;
      if (Object.hasOwn(value, "effectiveProfileDigest")) {
        value.effectiveProfileDigest = components.profile.effectiveProfileDigest;
      }
    }
    if (value.id === components.outcome.id && value.version === components.outcome.version
      && Object.hasOwn(value, "digest")) value.digest = components.outcome.digest;
    if (value.id === components.workRegistry.id && value.version === components.workRegistry.version
      && Object.hasOwn(value, "digest")) value.digest = components.workRegistryDigest;
    if (value.id === components.claimTrust.id && value.version === components.claimTrust.version
      && Object.hasOwn(value, "digest")) value.digest = components.claimTrust.digest;
  }
  for (const nested of Array.isArray(value) ? value : Object.values(value)) syncComponents(nested, components);
}

const profilePath = path.join(root, "profiles", "repo-change-v1", "evaluation-profile.json");
const outcomePath = path.join(root, "profiles", "repo-change-v1", "outcome-profile.json");
const claimTrustPath = path.join(root, "profiles", "repo-change-v1", "operational-signature-profile.json");
const workRegistryPath = path.join(root, "standard", "work-artifact-registry.json");
const baseValidityPath = path.join(fixtureRoot, "architecture-case-validity-argument.json");
const baseCasePath = path.join(fixtureRoot, "architecture-case-full.json");
const supportValidityPath = path.join(positiveRoot, "scorecard-case-validity-argument.json");
const supportCasePath = path.join(positiveRoot, "scorecard-case.json");
const coveragePath = path.join(positiveRoot, "suite-sdlc-coverage.json");
const suitePath = path.join(positiveRoot, "suite-manifest.json");
const evaluatorPath = path.join(positiveRoot, "evaluator-manifest.json");
const schemaManifestPath = path.join(positiveRoot, "schema-manifest.json");
const preRunPath = path.join(positiveRoot, "pre-run-manifest.json");
const scorecardPath = path.join(positiveRoot, "scorecard.json");
const ledgerPath = path.join(positiveRoot, "attempt-ledger.json");
const checkpointPath = path.join(positiveRoot, "attempt-checkpoint.json");
const materialVectorsPath = path.join(fixtureRoot, "material-integrity", "vectors.json");

const profileBytes = await readFile(profilePath);
const outcomeBytes = await readFile(outcomePath);
const workRegistryBytes = await readFile(workRegistryPath);
const profile = JSON.parse(profileBytes.toString("utf8"));
const outcome = JSON.parse(outcomeBytes.toString("utf8"));
const claimTrust = await readJson(claimTrustPath);
const workRegistry = JSON.parse(workRegistryBytes.toString("utf8"));
const workRegistryDigest = sha256(workRegistryBytes);
const components = { profile, outcome, claimTrust, workRegistry, workRegistryDigest };

const preRun = await readJson(preRunPath);
const supportCaseId = preRun.caseProfiles[0].caseId;
const baseValidity = await readJson(baseValidityPath);
const previousBaseValidityDigest = baseValidity.digest;
baseValidity.effectiveEvaluationProfile.rawDigest = sha256(profileBytes);
baseValidity.effectiveEvaluationProfile.subjectDigest = profile.digest;
baseValidity.effectiveEvaluationProfile.effectiveProfileDigest = profile.effectiveProfileDigest;
baseValidity.effectiveEvaluationProfile.interactionModes = structuredClone(profile.interactionModes);
baseValidity.effectiveEvaluationProfile.workArtifactRegistry = structuredClone(profile.workArtifactRegistry);
baseValidity.effectiveEvaluationProfile.capabilityFamilies = structuredClone(profile.capabilityFamilies);
baseValidity.selectedOutcomeProfile.rawDigest = sha256(outcomeBytes);
baseValidity.selectedOutcomeProfile.subjectDigest = outcome.digest;
baseValidity.selectedOutcomeProfile.workArtifactRegistry = structuredClone(outcome.workArtifactRegistry);
baseValidity.selectedOutcomeProfile.workArtifactTypes = structuredClone(outcome.workArtifactTypes);
const classificationVerifierPath = path.join(root, "tools", "verify-case-classification.mjs");
const previousVerifierDigest = baseValidity.verifier.digest;
baseValidity.verifier.digest = sha256(await readFile(classificationVerifierPath));
refreshSigned(baseValidity);
await writeJson(baseValidityPath, baseValidity);

const supportValidity = structuredClone(baseValidity);
supportValidity.caseIdentity.id = supportCaseId;
refreshSigned(supportValidity);
await writeJson(supportValidityPath, supportValidity);

const baseCase = await readJson(baseCasePath);
replaceExact(baseCase, previousBaseValidityDigest, baseValidity.digest);
replaceExact(baseCase, previousVerifierDigest, baseValidity.verifier.digest);
syncComponents(baseCase, components);
refreshSigned(baseCase);
await writeJson(baseCasePath, baseCase);

const supportCase = structuredClone(baseCase);
supportCase.id = supportCaseId;
replaceExact(supportCase, "architecture-case-validity-argument.json", "scorecard-case-validity-argument.json");
replaceExact(supportCase, baseValidity.digest, supportValidity.digest);
supportCase.repository.workspaceManifest.uri = "../architecture-workspace-manifest.json";
syncComponents(supportCase, components);
refreshSigned(supportCase);
await writeJson(supportCasePath, supportCase);

const machineSuite = await readJson(path.join(machineRoot, "stage-suite-manifest.json"));
const suite = await readJson(suitePath);
syncComponents(suite, components);
for (const field of ["validityArgument", "evaluationThreatModel", "heldOutExposure"]) {
  suite[field] = structuredClone(machineSuite[field]);
  rebaseLocators(suite[field], machineRoot, positiveRoot);
}
const casePointer = await materialPointer(positiveRoot, supportCasePath, supportCaseId);
suite.cases[0] = {
  ...casePointer,
  evaluationProfile: { id: profile.id, version: profile.version, digest: profile.digest },
  effectiveProfileDigest: profile.effectiveProfileDigest,
  outcomeProfile: { id: outcome.id, version: outcome.version, digest: outcome.digest },
  capabilityFamilyIds: structuredClone(supportCase.capabilityFamilyIds),
  workArtifactTypes: structuredClone(supportCase.workArtifactTypes),
  memberships: structuredClone(supportCase.memberships),
  lifecycle: supportCase.lifecycle.status
};
const coverage = await readJson(coveragePath);
suite.sdlcCoverage.digest = coverage.digest;
refreshSigned(suite);
await writeJson(suitePath, suite);

const evaluator = await readJson(evaluatorPath);
const schemaManifestBytes = await readFile(schemaManifestPath);
const schemaManifest = JSON.parse(schemaManifestBytes.toString("utf8"));
evaluator.supportedStandard.schemaManifest = {
  id: schemaManifest.id,
  uri: "schema-manifest.json",
  digest: sha256(schemaManifestBytes)
};
refreshSigned(evaluator);
await writeJson(evaluatorPath, evaluator);
const machinePreRun = await readJson(path.join(machineRoot, "stage-pre-run-manifest.json"));
preRun.suite = await materialPointer(positiveRoot, suitePath);
preRun.evaluator.digest = evaluator.digest;
preRun.claimTrustProfile.digest = claimTrust.digest;
for (const binding of preRun.caseProfiles) {
  binding.evaluationProfile = { id: profile.id, version: profile.version, digest: profile.digest };
  binding.effectiveProfileDigest = profile.effectiveProfileDigest;
  binding.outcomeProfile = { id: outcome.id, version: outcome.version, digest: outcome.digest };
}
preRun.caseSet = [casePointer];
preRun.evaluationControlBindings = structuredClone(machinePreRun.evaluationControlBindings);
rebaseLocators(preRun.evaluationControlBindings, machineRoot, positiveRoot);
for (const [index, cell] of preRun.scheduledCells.entries()) {
  cell.blockId ??= `single-block-${index + 1}`;
  cell.seed ??= `single-seed-${index + 1}`;
}
refreshSigned(preRun);
await writeJson(preRunPath, preRun);

const scorecard = await readJson(scorecardPath);
const ledger = await readJson(ledgerPath);
ledger.scheduledSetCommitment = { id: preRun.id, uri: "pre-run-manifest.json", digest: preRun.digest };
refreshLedger(ledger);
await writeJson(ledgerPath, ledger);
const checkpoint = makeCanonicalCheckpoint(ledger, scorecard.experiment.closedAt);
await writeJson(checkpointPath, checkpoint);

syncComponents(scorecard, components);
const suiteIdentity = { id: suite.id, version: suite.version, uri: "suite-manifest.json", digest: suite.digest };
const preRunIdentity = { id: preRun.id, uri: "pre-run-manifest.json", digest: preRun.digest };
scorecard.experiment.suite = structuredClone(suiteIdentity);
scorecard.experiment.caseProfiles = structuredClone(preRun.caseProfiles);
scorecard.experiment.manifestDigest = preRun.digest;
scorecard.experiment.scheduledSetCommitment = structuredClone(preRunIdentity);
scorecard.provenance.suite = structuredClone(suiteIdentity);
scorecard.provenance.preRunManifest = structuredClone(preRunIdentity);
scorecard.experiment.caseSetDigest = sha256Canonical(preRun.caseSet);
scorecard.provenance.caseSetDigest = scorecard.experiment.caseSetDigest;
scorecard.attemptIntegrity.scheduledSetCommitment = structuredClone(preRunIdentity);
scorecard.attemptIntegrity.ledger.digest = ledger.digest;
scorecard.attemptIntegrity.initialLedgerRoot = ledger.initialLedgerRoot;
scorecard.attemptIntegrity.terminalLedgerRoot = ledger.terminalLedgerRoot;
scorecard.attemptIntegrity.externalAttemptCheckpoint = {
  id: checkpoint.id,
  version: checkpoint.version,
  uri: "attempt-checkpoint.json",
  digest: checkpoint.digest
};
const scheduledCellsById = new Map(preRun.scheduledCells.map((cell) => [cell.cellId, cell]));
for (const result of scorecard.caseResults) {
  if (result.case.id === supportCaseId) result.case.digest = casePointer.digest;
  for (const cell of result.cells ?? []) {
    const scheduledCell = scheduledCellsById.get(cell.cellId);
    if (!scheduledCell) throw new Error(`scorecard cell ${cell.cellId} is absent from the sealed pre-run manifest`);
    cell.blockId = scheduledCell.blockId;
    cell.seed = scheduledCell.seed;
    cell.evaluationProfileDigest = profile.effectiveProfileDigest;
    cell.outcomeProfile = { id: outcome.id, version: outcome.version, digest: outcome.digest };
  }
}
refreshSigned(scorecard);
await writeJson(scorecardPath, scorecard);

const materialVectors = await readJson(materialVectorsPath);
const canonicalVector = materialVectors.vectors.find(
  (entry) => entry.id === "positive-canonical-scorecard-attempt-checkpoint"
);
if (!canonicalVector) throw new Error("canonical material-integrity vector is missing");
canonicalVector.expectedLogHead = {
  logId: checkpoint.logBinding.logId,
  checkpointSequence: checkpoint.logBinding.checkpointSequence,
  digest: checkpoint.digest
};
await writeJson(materialVectorsPath, materialVectors);

for (const absolute of [
  baseValidityPath,
  baseCasePath,
  supportValidityPath,
  supportCasePath,
  suitePath,
  preRunPath,
  ledgerPath,
  checkpointPath,
  scorecardPath,
  materialVectorsPath
]) {
  process.stdout.write(`${path.relative(root, absolute)}\n`);
}
