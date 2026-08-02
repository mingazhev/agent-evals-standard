#!/usr/bin/env node

import {
  createHash,
  createPrivateKey,
  sign
} from "node:crypto";
import {
  readFile,
  readdir,
  stat,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  attemptCheckpointDigest,
  attemptLedgerDigest,
  attemptLedgerInitialRoot,
  attemptLedgerTerminalRoot,
  attemptReceiptDigest,
  canonicalize
} from "./verify-material-integrity.mjs";

// RFC 8032 test vectors 1 and 2. These seeds are public conformance material,
// never operational secrets. Separate keys model the scorecard and independent
// scheduler trust boundaries.
const SCORECARD_SEED = Buffer.from(
  "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
  "hex"
);
const SCHEDULER_SEED = Buffer.from(
  "4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb",
  "hex"
);
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const FIXTURE_PROFILE_ID = "fixture-signature-profile";
const FIXTURE_KEY_ID = "rfc8032-test-key-1";
const SCHEDULER_PROFILE_ID = "fixture-independent-scheduler-profile";
const SCHEDULER_KEY_ID = "rfc8032-test-key-2-scheduler";
const EVIDENCE_DOMAIN = "agent-evals-evidence-artifact-1";
const RECEIPT_DOMAIN = "agent-evals-attempt-receipt-1";
const CHECKPOINT_DOMAIN = "agent-eval-attempt-checkpoint-1";

const repositoryRoot = path.resolve(process.cwd());
const fixtureRoot = path.join(repositoryRoot, "conformance", "fixtures");
const independentlyGeneratedFixtureRoots = [
  "material-integrity",
  "noncircular-proof",
  "production-derived-authority",
  "scope-boundary",
  "target-composition"
].map((name) => path.join(fixtureRoot, name));
const positiveRoot = path.join(fixtureRoot, "positive");
const canonicalLedgerPath = path.join(positiveRoot, "attempt-ledger.json");
const canonicalCheckpointPath = path.join(positiveRoot, "attempt-checkpoint.json");
const materialVectorsPath = path.join(fixtureRoot, "material-integrity", "vectors.json");

function privateKey(seed) {
  return createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]),
    format: "der",
    type: "pkcs8"
  });
}

function clone(value) {
  return structuredClone(value);
}

function sha256Bytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function sha256Canonical(value) {
  return sha256Bytes(Buffer.from(canonicalize(value), "utf8"));
}

function signatureMessage(domain, document, signatureProperty = "signature") {
  const projection = clone(document);
  delete projection[signatureProperty].value;
  return Buffer.concat([
    Buffer.from(domain, "ascii"),
    Buffer.from([0]),
    Buffer.from(canonicalize(projection), "utf8")
  ]);
}

function signFixtureDocument(document) {
  if (document.signature?.profileId !== FIXTURE_PROFILE_ID
    || document.signature?.keyId !== FIXTURE_KEY_ID
    || document.signature?.algorithm !== "Ed25519") {
    throw new Error(`refusing to sign non-fixture document ${String(document.id ?? document.schemaVersion)}`);
  }
  if (typeof document.digest === "string") {
    const projection = clone(document);
    delete projection.digest;
    delete projection.signature;
    document.digest = sha256Canonical(projection);
  }
  document.signature.value = sign(
    null,
    signatureMessage(document.schemaVersion, document),
    privateKey(SCORECARD_SEED)
  ).toString("base64url");
}

function signEvidenceArtifact(artifact) {
  if (artifact.attestation?.profileId !== FIXTURE_PROFILE_ID
    || artifact.attestation?.keyId !== FIXTURE_KEY_ID
    || artifact.attestation?.algorithm !== "Ed25519") {
    throw new Error(`refusing to sign non-fixture evidence ${String(artifact.id)}`);
  }
  artifact.attestation.value = sign(
    null,
    signatureMessage(EVIDENCE_DOMAIN, artifact, "attestation"),
    privateKey(SCORECARD_SEED)
  ).toString("base64url");
}

function signSchedulerObject(document, domain) {
  document.signature.value = sign(
    null,
    signatureMessage(domain, document),
    privateKey(SCHEDULER_SEED)
  ).toString("base64url");
}

function isEvidenceArtifact(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && value.attestation && value.producer
    && typeof value.id === "string" && typeof value.uri === "string"
    && typeof value.digest === "string";
}

async function exists(absolute) {
  try {
    return (await stat(absolute)).isFile();
  } catch {
    return false;
  }
}

function syntheticPayload(artifact) {
  if (artifact.artifactType === "workspace_diff") {
    return Buffer.from([
      "diff --git a/src/material-evidence.txt b/src/material-evidence.txt",
      "new file mode 100644",
      "index 0000000..8b13789",
      "--- /dev/null",
      "+++ b/src/material-evidence.txt",
      "@@ -0,0 +1 @@",
      `+${artifact.id}`,
      ""
    ].join("\n"), "utf8");
  }
  return Buffer.from(`${JSON.stringify({
    schemaVersion: "fixture-evidence-payload-1",
    id: `${artifact.id}-payload`,
    version: "0.1.0",
    evidenceId: artifact.id
  })}\n`, "utf8");
}

async function migrateArtifact(artifact, ownerPath, wrapper, jsonPath) {
  // This is the one intentional unavailable-material negative vector.
  if (ownerPath.endsWith(path.join("material-integrity", "negative", "missing-artifact-bytes.json"))) {
    return false;
  }

  const ownerDirectory = path.dirname(ownerPath);
  const evidenceBaseDirectory = ownerPath.includes(`${path.sep}material-integrity${path.sep}`)
    ? path.join(fixtureRoot, "material-integrity")
    : ownerDirectory;
  let bytes;
  let payload;
  const payloadPath = typeof wrapper?.payloadPath === "string" ? wrapper.payloadPath : null;
  const uriCandidate = !artifact.uri.startsWith("artifact:") ? artifact.uri : null;
  const relativeCandidate = payloadPath ?? uriCandidate;
  const candidateAbsolute = relativeCandidate
    ? path.resolve(ownerDirectory, ...relativeCandidate.split("/"))
    : null;

  if (relativeCandidate && candidateAbsolute && await exists(candidateAbsolute)) {
    bytes = await readFile(candidateAbsolute);
    payload = { kind: "repository_relative", path: relativeCandidate.replaceAll("\\", "/") };
  } else if (artifact.payload?.kind === "repository_relative") {
    const currentAbsolute = path.resolve(evidenceBaseDirectory, ...artifact.payload.path.split("/"));
    if (!await exists(currentAbsolute)) {
      throw new Error(`${path.relative(repositoryRoot, ownerPath)} ${jsonPath}: repository payload is unavailable`);
    }
    bytes = await readFile(currentAbsolute);
    payload = clone(artifact.payload);
  } else if (artifact.payload?.kind === "inline_base64") {
    bytes = Buffer.from(artifact.payload.contentBase64, "base64");
    payload = clone(artifact.payload);
  } else {
    bytes = syntheticPayload(artifact);
    payload = { kind: "inline_base64", contentBase64: bytes.toString("base64") };
  }

  const digest = sha256Bytes(bytes);
  artifact.payload = payload;
  artifact.digest = digest;
  if (!ownerPath.endsWith(path.join("negative", "evidence-missing-byte-length.json"))) {
    artifact.byteLength = bytes.length;
  }
  if (artifact.uri.startsWith("artifact:sha256:") || artifact.artifactType === "workspace_diff") {
    artifact.uri = `artifact:${digest}`;
  }
  signEvidenceArtifact(artifact);
  return true;
}

async function visitArtifacts(value, ownerPath, jsonPath = "$", wrapper = null) {
  let changed = false;
  if (!value || typeof value !== "object") return changed;
  if (isEvidenceArtifact(value)) {
    return migrateArtifact(value, ownerPath, wrapper, jsonPath);
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      changed = await visitArtifacts(value[index], ownerPath, `${jsonPath}[${index}]`, value[index]) || changed;
    }
    return changed;
  }
  for (const [key, child] of Object.entries(value)) {
    changed = await visitArtifacts(child, ownerPath, `${jsonPath}.${key}`, value) || changed;
  }
  return changed;
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

function refreshLedger(ledger) {
  ledger.initialLedgerRoot = attemptLedgerInitialRoot(ledger);
  ledger.terminalLedgerRoot = attemptLedgerTerminalRoot(ledger);
  ledger.digest = attemptLedgerDigest(ledger);
}

function makeSchedulerSignature(signedAt) {
  return {
    profileId: SCHEDULER_PROFILE_ID,
    algorithm: "Ed25519",
    keyId: SCHEDULER_KEY_ID,
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
    signSchedulerObject(receipt, RECEIPT_DOMAIN);
    receipts.push(receipt);
    previousReceiptDigest = receipt.receiptDigest;
  }

  const issuedAtDate = new Date(Date.parse(closedAt) + 1000);
  const issuedAt = issuedAtDate.toISOString().replace(".000Z", "Z");
  const checkpoint = {
    schemaVersion: "agent-eval-attempt-checkpoint-1",
    id: "attempt-checkpoint-fixture-1",
    version: "0.1.0",
    experimentId: ledger.experimentId,
    scheduledSetCommitment: clone(ledger.scheduledSetCommitment),
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
  signSchedulerObject(checkpoint, CHECKPOINT_DOMAIN);
  return checkpoint;
}

function updateScorecardCheckpoint(scorecard, sourcePath, ledger, checkpoint) {
  scorecard.attemptIntegrity.ledger.digest = ledger.digest;
  scorecard.attemptIntegrity.scheduledSetCommitment = clone(ledger.scheduledSetCommitment);
  scorecard.attemptIntegrity.initialLedgerRoot = ledger.initialLedgerRoot;
  scorecard.attemptIntegrity.terminalLedgerRoot = ledger.terminalLedgerRoot;
  const checkpointUri = path.dirname(sourcePath) === positiveRoot
    ? "attempt-checkpoint.json"
    : "../positive/attempt-checkpoint.json";
  scorecard.attemptIntegrity.externalAttemptCheckpoint = {
    id: checkpoint.id,
    version: "0.1.0",
    uri: checkpointUri,
    digest: checkpoint.digest
  };
}

function updateCanonicalVector(manifest, checkpoint) {
  const id = "positive-canonical-scorecard-attempt-checkpoint";
  const vector = {
    id,
    kind: "attempt_checkpoint",
    checkpoint: "../positive/attempt-checkpoint.json",
    ledger: "../positive/attempt-ledger.json",
    scorecard: "../positive/scorecard.json",
    scorecardSigner: {
      keyId: FIXTURE_KEY_ID,
      trustDomain: "fixture-scorecard-boundary",
      publicKey: "../keys/rfc8032-test-key-1.pem"
    },
    scheduler: {
      keyId: SCHEDULER_KEY_ID,
      profileId: SCHEDULER_PROFILE_ID,
      issuerId: "fixture-independent-scheduler",
      trustDomain: "fixture-scheduler-boundary",
      publicKey: "../keys/rfc8032-test-key-2-scheduler.pem"
    },
    expectedLogHead: {
      logId: checkpoint.logBinding.logId,
      checkpointSequence: checkpoint.logBinding.checkpointSequence,
      digest: checkpoint.digest
    },
    expected: "pass"
  };
  const index = manifest.vectors.findIndex((entry) => entry.id === id);
  if (index === -1) manifest.vectors.push(vector);
  else manifest.vectors[index] = vector;
}

const ledger = JSON.parse(await readFile(canonicalLedgerPath, "utf8"));
refreshLedger(ledger);
await writeFile(canonicalLedgerPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");

const positiveScorecard = JSON.parse(await readFile(path.join(positiveRoot, "scorecard.json"), "utf8"));
const checkpoint = makeCanonicalCheckpoint(ledger, positiveScorecard.experiment.closedAt);
await writeFile(canonicalCheckpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");

const touched = [];
for (const sourcePath of await jsonFiles(fixtureRoot)) {
  if (sourcePath === materialVectorsPath || sourcePath === canonicalCheckpointPath
    || independentlyGeneratedFixtureRoots.some((directory) => sourcePath.startsWith(`${directory}${path.sep}`))) continue;
  const document = JSON.parse(await readFile(sourcePath, "utf8"));
  let changed = false;
  if (document.schemaVersion === "agent-eval-scorecard-1" && document.attemptIntegrity) {
    updateScorecardCheckpoint(document, sourcePath, ledger, checkpoint);
    changed = true;
  }
  changed = await visitArtifacts(document, sourcePath) || changed;
  if (!changed) continue;

  const skipEnclosingSignature = [
    "agent-eval-conformance-statement-1",
    "agent-eval-validation-envelope-1"
  ].includes(document.schemaVersion);
  if (document.signature && !skipEnclosingSignature) signFixtureDocument(document);
  await writeFile(sourcePath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  touched.push(path.relative(repositoryRoot, sourcePath));
}

const materialVectors = JSON.parse(await readFile(materialVectorsPath, "utf8"));
updateCanonicalVector(materialVectors, checkpoint);
await writeFile(materialVectorsPath, `${JSON.stringify(materialVectors, null, 2)}\n`, "utf8");

process.stdout.write(`migrated ${touched.length} fixture documents\n`);
for (const relative of touched) process.stdout.write(`${relative}\n`);
process.stdout.write(`${path.relative(repositoryRoot, canonicalCheckpointPath)}\n`);
