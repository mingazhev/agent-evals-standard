#!/usr/bin/env node

import { createHash, createPublicKey, verify as verifyCryptographicSignature } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const RECEIPT_SIGNATURE_DOMAIN = "agent-evals-attempt-receipt-1";
const CHECKPOINT_SIGNATURE_DOMAIN = "agent-eval-attempt-checkpoint-1";

export function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}

export function sha256Bytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function sha256Canonical(value) {
  return sha256Bytes(Buffer.from(canonicalize(value), "utf8"));
}

function clone(value) {
  return structuredClone(value);
}

function sameCanonical(left, right) {
  return canonicalize(left) === canonicalize(right);
}

function strictBase64(value) {
  if (typeof value !== "string"
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error("contentBase64 is not canonical RFC 4648 base64");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) throw new Error("contentBase64 is not canonical RFC 4648 base64");
  return bytes;
}

function strictBase64Url(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("signature is not unpadded base64url");
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.toString("base64url") !== value) throw new Error("signature is not canonical unpadded base64url");
  return bytes;
}

function pathIsWithin(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function repositoryRelativeBytes(locator, baseDirectory) {
  if (!baseDirectory) throw new Error("repository_relative payload requires an explicit baseDirectory");
  if (typeof locator.path !== "string" || locator.path.length === 0
    || locator.path.includes("\\") || locator.path.includes("\0") || path.isAbsolute(locator.path)) {
    throw new Error("repository_relative payload path must be a non-empty portable relative path");
  }
  const segments = locator.path.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error("repository_relative payload path contains an empty or dot segment");
  }
  const root = await realpath(path.resolve(baseDirectory));
  const unresolvedTarget = path.resolve(root, ...segments);
  if (!pathIsWithin(root, unresolvedTarget)) throw new Error("repository_relative payload escapes baseDirectory");
  const target = await realpath(unresolvedTarget);
  if (!pathIsWithin(root, target)) throw new Error("repository_relative payload resolves through a symlink outside baseDirectory");
  return { bytes: await readFile(target) };
}

export async function resolveEvidencePayloadBytes(payload, options = {}) {
  if (!payload || typeof payload !== "object") throw new Error("payload locator is missing");
  if (payload.kind === "inline_base64") return { bytes: strictBase64(payload.contentBase64) };
  if (payload.kind === "repository_relative") {
    return repositoryRelativeBytes(payload, options.baseDirectory);
  }
  if (payload.kind === "immutable_external") {
    if (typeof options.resolveExternal !== "function") {
      throw new Error("immutable_external payload requires an explicitly configured resolver");
    }
    const resolved = await options.resolveExternal(payload.uri);
    const result = Buffer.isBuffer(resolved) || resolved instanceof Uint8Array
      ? { bytes: resolved }
      : resolved;
    if (!result || !(Buffer.isBuffer(result.bytes) || result.bytes instanceof Uint8Array)) {
      throw new Error("external resolver did not return bytes");
    }
    return { ...result, bytes: Buffer.from(result.bytes) };
  }
  throw new Error(`unknown payload locator kind ${String(payload.kind)}`);
}

/**
 * Resolve a canonical evidence artifact to material bytes and verify its signed
 * metadata against those exact bytes. Returns an array of fail-closed issues.
 */
export async function verifyEvidencePayload(artifact, options = {}) {
  const issues = [];
  let resolved;
  try {
    resolved = await resolveEvidencePayloadBytes(artifact?.payload, options);
  } catch (error) {
    issues.push(`payload bytes unavailable: ${error.message}`);
    return issues;
  }

  const bytes = Buffer.from(resolved.bytes);
  const actualDigest = sha256Bytes(bytes);
  if (artifact.byteLength !== bytes.length) {
    issues.push(`byteLength must be ${bytes.length}, found ${String(artifact.byteLength)}`);
  }
  if (artifact.digest !== actualDigest) {
    issues.push(`digest must be ${actualDigest}, found ${String(artifact.digest)}`);
  }
  if (typeof artifact.mediaType !== "string" || artifact.mediaType.length === 0) {
    issues.push("mediaType must be a non-empty authenticated value");
  }
  if (resolved.mediaType !== undefined && resolved.mediaType !== artifact.mediaType) {
    issues.push(`resolver mediaType ${resolved.mediaType} differs from authenticated mediaType ${artifact.mediaType}`);
  }

  if (typeof artifact.uri === "string" && artifact.uri.startsWith("artifact:sha256:")) {
    const expectedUri = `artifact:${actualDigest}`;
    if (artifact.uri !== expectedUri) issues.push(`content-addressed uri must be ${expectedUri}`);
  }
  if (artifact.artifactType === "workspace_diff") {
    if (bytes.length === 0) issues.push("workspace_diff terminal payload must not be empty");
    const expectedUri = `artifact:${actualDigest}`;
    if (artifact.uri !== expectedUri) issues.push(`workspace_diff uri must be ${expectedUri}`);
  }
  return issues;
}

export async function verifyTerminalWorkspaceDiff(artifact, options = {}) {
  if (artifact?.artifactType !== "workspace_diff") return ["terminal artifactType must be workspace_diff"];
  return verifyEvidencePayload(artifact, options);
}

export function attemptLedgerInitialRoot(ledger) {
  return sha256Canonical({
    experimentId: ledger.experimentId,
    scheduledSetCommitment: ledger.scheduledSetCommitment
  });
}

export function attemptLedgerTerminalRoot(ledger) {
  let root = attemptLedgerInitialRoot(ledger);
  for (const attempt of ledger.attemptRecords ?? []) {
    root = sha256Canonical({ previousRoot: root, attempt });
  }
  return root;
}

export function attemptLedgerDigest(ledger) {
  const projection = clone(ledger);
  delete projection.digest;
  delete projection.signature;
  return sha256Canonical(projection);
}

export function attemptReceiptDigest(receipt) {
  const projection = clone(receipt);
  delete projection.receiptDigest;
  delete projection.signature;
  return sha256Canonical(projection);
}

export function attemptCheckpointDigest(checkpoint) {
  const projection = clone(checkpoint);
  delete projection.digest;
  delete projection.signature;
  return sha256Canonical(projection);
}

function signatureMessage(domain, signedObject) {
  const projection = clone(signedObject);
  delete projection.signature.value;
  return Buffer.concat([
    Buffer.from(domain, "ascii"),
    Buffer.from([0]),
    Buffer.from(canonicalize(projection), "utf8")
  ]);
}

function trustedSchedulerKey(signature, checkpoint, options, label, issues) {
  const collection = options.trustedSchedulerKeys;
  const trusted = collection instanceof Map
    ? collection.get(signature?.keyId)
    : collection?.[signature?.keyId];
  if (!trusted) {
    issues.push(`${label}: key ${String(signature?.keyId)} is not authorized by external scheduler trust configuration`);
    return null;
  }
  if (trusted.issuerId !== undefined && trusted.issuerId !== checkpoint.issuer?.id) {
    issues.push(`${label}: trusted issuer ${trusted.issuerId} differs from checkpoint issuer ${String(checkpoint.issuer?.id)}`);
  }
  if (trusted.trustDomain !== undefined && trusted.trustDomain !== checkpoint.issuer?.trustDomain) {
    issues.push(`${label}: trusted domain ${trusted.trustDomain} differs from checkpoint domain ${String(checkpoint.issuer?.trustDomain)}`);
  }
  if (trusted.profileId !== undefined && trusted.profileId !== signature?.profileId) {
    issues.push(`${label}: signature profile ${String(signature?.profileId)} is not trusted profile ${trusted.profileId}`);
  }
  const scorecardSigner = options.scorecardSigner;
  if (scorecardSigner?.trustDomain !== undefined && trusted.trustDomain === scorecardSigner.trustDomain) {
    issues.push(`${label}: scheduler and scorecard signer share trust domain ${trusted.trustDomain}`);
  }
  if (trusted.publicKey && scorecardSigner?.publicKey) {
    try {
      const schedulerSpki = createPublicKey(trusted.publicKey).export({ format: "der", type: "spki" });
      const scorecardSpki = createPublicKey(scorecardSigner.publicKey).export({ format: "der", type: "spki" });
      if (schedulerSpki.equals(scorecardSpki)) issues.push(`${label}: scheduler and scorecard signer resolve to the same public key`);
    } catch (error) {
      issues.push(`${label}: signer-separation key resolution failed: ${error.message}`);
    }
  }
  return trusted;
}

function verifySchedulerSignature(signedObject, domain, checkpoint, options, label, issues) {
  const signature = signedObject?.signature;
  if (!signature) {
    issues.push(`${label}: signature is missing`);
    return;
  }
  const trusted = trustedSchedulerKey(signature, checkpoint, options, label, issues);
  if (!trusted) return;
  if (signature.algorithm !== "Ed25519") {
    issues.push(`${label}: reference verifier supports only Ed25519, found ${String(signature.algorithm)}`);
    return;
  }
  if (!trusted.publicKey) {
    issues.push(`${label}: externally configured public key is missing`);
    return;
  }
  let valid = false;
  try {
    const signatureBytes = strictBase64Url(signature.value);
    if (signatureBytes.length !== 64) throw new Error(`Ed25519 signature has ${signatureBytes.length} bytes, expected 64`);
    valid = verifyCryptographicSignature(
      null,
      signatureMessage(domain, signedObject),
      trusted.publicKey,
      signatureBytes
    );
  } catch (error) {
    issues.push(`${label}: signature verification error: ${error.message}`);
    return;
  }
  if (!valid) issues.push(`${label}: Ed25519 signature is invalid`);
}

function comparePointer(actual, expected, label, issues) {
  if (!sameCanonical(actual, expected)) issues.push(`${label} differs from the independently bound value`);
}

/**
 * Verify an attempt ledger against independently signed scheduler receipts and
 * an externally observed append-only log head. A scorecard that rewrites its
 * own roots cannot satisfy this function without a matching scheduler signature.
 */
export function verifyAttemptLedgerCheckpoint(checkpoint, ledger, options = {}) {
  const issues = [];
  const attemptIntegrity = options.attemptIntegrity;
  const scorecardSignature = options.scorecardSignature;
  const scorecardSigner = options.scorecardSigner;
  const expectedLogHead = options.expectedLogHead;

  if (!options.trustedSchedulerKeys
    || (options.trustedSchedulerKeys instanceof Map
      ? options.trustedSchedulerKeys.size === 0
      : Object.keys(options.trustedSchedulerKeys).length === 0)) {
    issues.push("external scheduler trust configuration is required");
  }
  if (!expectedLogHead) {
    issues.push("externally observed append-only log head is required");
  } else {
    if (checkpoint.logBinding?.logId !== expectedLogHead.logId) issues.push("checkpoint logId differs from external log head");
    if (checkpoint.logBinding?.checkpointSequence !== expectedLogHead.checkpointSequence) {
      issues.push("checkpoint sequence differs from external log head");
    }
    if (checkpoint.digest !== expectedLogHead.digest) issues.push("checkpoint digest differs from external log head");
  }

  if (!scorecardSignature?.keyId) {
    issues.push("scorecard signature keyId is required to establish scheduler-signing independence");
  }
  if (!scorecardSigner?.keyId || !scorecardSigner?.publicKey || !scorecardSigner?.trustDomain) {
    issues.push("externally resolved scorecard signer key and trust domain are required");
  } else if (scorecardSigner.keyId !== scorecardSignature?.keyId) {
    issues.push("resolved scorecard signer differs from scorecard signature keyId");
  }

  const computedCheckpointDigest = attemptCheckpointDigest(checkpoint);
  if (checkpoint.digest !== computedCheckpointDigest) {
    issues.push(`checkpoint digest must be ${computedCheckpointDigest}`);
  }
  verifySchedulerSignature(checkpoint, CHECKPOINT_SIGNATURE_DOMAIN, checkpoint, options, "checkpoint", issues);
  if (checkpoint.signature?.keyId === scorecardSignature?.keyId) {
    issues.push("checkpoint signer must be independent from the scorecard signer");
  }

  if (checkpoint.checkpointKind !== "terminal") issues.push("checkpointKind must be terminal");
  if (checkpoint.issuer?.role !== "independent_scheduler") issues.push("checkpoint issuer role must be independent_scheduler");
  if (checkpoint.experimentId !== ledger.experimentId) issues.push("checkpoint experimentId differs from ledger");
  comparePointer(checkpoint.scheduledSetCommitment, ledger.scheduledSetCommitment, "scheduled-set commitment", issues);
  if (checkpoint.ledger?.id !== ledger.id) issues.push("checkpoint ledger id differs from ledger");
  const computedLedgerDigest = attemptLedgerDigest(ledger);
  if (ledger.digest !== computedLedgerDigest) issues.push(`ledger digest must be ${computedLedgerDigest}`);
  if (checkpoint.ledger?.digest !== computedLedgerDigest) issues.push("checkpoint ledger digest differs from material ledger");
  if (checkpoint.ledgerRootAlgorithm !== ledger.rootAlgorithm) issues.push("checkpoint ledger root algorithm differs from ledger");

  const computedInitialRoot = attemptLedgerInitialRoot(ledger);
  const computedTerminalRoot = attemptLedgerTerminalRoot(ledger);
  if (ledger.initialLedgerRoot !== computedInitialRoot) issues.push(`ledger initialLedgerRoot must be ${computedInitialRoot}`);
  if (ledger.terminalLedgerRoot !== computedTerminalRoot) issues.push(`ledger terminalLedgerRoot must be ${computedTerminalRoot}`);

  const receipts = checkpoint.receipts ?? [];
  const attempts = ledger.attemptRecords ?? [];
  const seenAttemptIds = new Set();
  let previousReceiptDigest = null;
  let previousReceiptStartedAt = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < receipts.length; index += 1) {
    const receipt = receipts[index];
    const label = `receipt[${index}]`;
    if (receipt.sequence !== index + 1) issues.push(`${label}: sequence must be ${index + 1}`);
    if (receipt.previousReceiptDigest !== previousReceiptDigest) {
      issues.push(`${label}: previousReceiptDigest differs from the append-only predecessor`);
    }
    if (receipt.experimentId !== checkpoint.experimentId) issues.push(`${label}: experimentId differs from checkpoint`);
    if (receipt.scheduledSetCommitmentDigest !== checkpoint.scheduledSetCommitment?.digest) {
      issues.push(`${label}: scheduled-set digest differs from checkpoint`);
    }
    if (seenAttemptIds.has(receipt.attemptId)) issues.push(`${label}: duplicate attemptId ${receipt.attemptId}`);
    seenAttemptIds.add(receipt.attemptId);
    const computedReceiptDigest = attemptReceiptDigest(receipt);
    if (receipt.receiptDigest !== computedReceiptDigest) issues.push(`${label}: receiptDigest must be ${computedReceiptDigest}`);
    verifySchedulerSignature(receipt, RECEIPT_SIGNATURE_DOMAIN, checkpoint, options, label, issues);
    if (receipt.signature?.keyId === scorecardSignature?.keyId) {
      issues.push(`${label}: signer must be independent from the scorecard signer`);
    }
    const receiptStartedAt = Date.parse(receipt.startedAt);
    const receiptSignedAt = Date.parse(receipt.signature?.signedAt);
    if (!Number.isFinite(receiptStartedAt) || !Number.isFinite(receiptSignedAt)
      || receiptSignedAt > receiptStartedAt) {
      issues.push(`${label}: scheduler receipt must be signed no later than attempt start`);
    }
    if (receiptStartedAt < previousReceiptStartedAt) {
      issues.push(`${label}: startedAt precedes the prior append-only receipt`);
    }
    previousReceiptStartedAt = receiptStartedAt;
    const attempt = attempts[index];
    if (!attempt) {
      issues.push(`${label}: no corresponding ledger attempt exists`);
    } else {
      for (const field of ["attemptId", "cellId", "parentAttemptId", "startedAt"]) {
        if (receipt[field] !== attempt[field]) issues.push(`${label}: ${field} differs from ledger attempt`);
      }
    }
    previousReceiptDigest = receipt.receiptDigest;
  }
  if (attempts.length > receipts.length) {
    for (let index = receipts.length; index < attempts.length; index += 1) {
      issues.push(`attempt[${index}]: no independently signed scheduler receipt exists`);
    }
  }

  const terminal = checkpoint.terminalBinding ?? {};
  if (terminal.receiptCount !== receipts.length) issues.push(`terminal receiptCount must be ${receipts.length}`);
  if (terminal.terminalReceiptDigest !== previousReceiptDigest) issues.push("terminalReceiptDigest differs from receipt chain head");
  const orderedAttemptIdsDigest = sha256Canonical(receipts.map((receipt) => receipt.attemptId));
  if (terminal.orderedAttemptIdsDigest !== orderedAttemptIdsDigest) {
    issues.push(`orderedAttemptIdsDigest must be ${orderedAttemptIdsDigest}`);
  }
  const attemptRecordsDigest = sha256Canonical(attempts);
  if (terminal.attemptRecordsDigest !== attemptRecordsDigest) {
    issues.push(`attemptRecordsDigest must be ${attemptRecordsDigest}`);
  }
  if (terminal.initialLedgerRoot !== computedInitialRoot) issues.push("checkpoint initialLedgerRoot differs from material ledger");
  if (terminal.terminalLedgerRoot !== computedTerminalRoot) issues.push("checkpoint terminalLedgerRoot differs from material ledger");

  const issuedAt = Date.parse(checkpoint.issuedAt);
  const closedAt = Date.parse(terminal.closedAt);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(closedAt) || issuedAt < closedAt) {
    issues.push("checkpoint issuedAt must be at or after terminal closedAt");
  }
  const checkpointSignedAt = Date.parse(checkpoint.signature?.signedAt);
  if (!Number.isFinite(checkpointSignedAt) || !Number.isFinite(issuedAt) || checkpointSignedAt < issuedAt) {
    issues.push("checkpoint signature must be created at or after checkpoint issuance");
  }
  for (let index = 0; index < attempts.length; index += 1) {
    const finishedAt = Date.parse(attempts[index].finishedAt);
    if (!Number.isFinite(finishedAt) || !Number.isFinite(closedAt) || finishedAt > closedAt) {
      issues.push(`attempt[${index}]: finishedAt must be at or before checkpoint close`);
    }
  }

  if (attemptIntegrity) {
    if (attemptIntegrity.ledger?.id !== ledger.id || attemptIntegrity.ledger?.digest !== computedLedgerDigest) {
      issues.push("scorecard ledger pointer differs from material ledger");
    }
    const expectedCheckpointPointer = {
      id: checkpoint.id,
      version: checkpoint.version,
      uri: attemptIntegrity.externalAttemptCheckpoint?.uri,
      digest: checkpoint.digest
    };
    if (!sameCanonical(attemptIntegrity.externalAttemptCheckpoint, expectedCheckpointPointer)) {
      issues.push("scorecard externalAttemptCheckpoint pointer differs from verified checkpoint");
    }
    comparePointer(attemptIntegrity.scheduledSetCommitment, ledger.scheduledSetCommitment, "scorecard scheduled-set commitment", issues);
    if (attemptIntegrity.initialLedgerRoot !== computedInitialRoot) issues.push("scorecard initialLedgerRoot differs from material ledger");
    if (attemptIntegrity.terminalLedgerRoot !== computedTerminalRoot) issues.push("scorecard terminalLedgerRoot differs from material ledger");
    if (attemptIntegrity.physicalAttemptCount !== attempts.length) issues.push(`scorecard physicalAttemptCount must be ${attempts.length}`);
    if (!sameCanonical(attemptIntegrity.attemptRecords, attempts)) issues.push("scorecard attemptRecords differ from material ledger");
  }

  return issues;
}

async function readJson(absolute) {
  return JSON.parse(await readFile(absolute, "utf8"));
}

function resolveFrom(base, relativePath) {
  return path.resolve(base, relativePath);
}

export async function runMaterialIntegrityVectors(vectorFile) {
  const absoluteVectorFile = path.resolve(vectorFile);
  const base = path.dirname(absoluteVectorFile);
  const manifest = await readJson(absoluteVectorFile);
  const results = [];
  for (const vector of manifest.vectors ?? []) {
    let issues;
    const setupIssues = [];
    if (vector.kind === "evidence_payload") {
      const artifact = await readJson(resolveFrom(base, vector.artifact));
      issues = await verifyEvidencePayload(artifact, {
        baseDirectory: resolveFrom(base, vector.baseDirectory ?? ".")
      });
    } else if (vector.kind === "attempt_checkpoint") {
      const checkpoint = await readJson(resolveFrom(base, vector.checkpoint));
      const ledger = await readJson(resolveFrom(base, vector.ledger));
      const scorecard = vector.scorecard
        ? await readJson(resolveFrom(base, vector.scorecard))
        : null;
      const attemptIntegrity = scorecard?.attemptIntegrity
        ?? await readJson(resolveFrom(base, vector.attemptIntegrity));
      if (vector.attack) {
        if (ledger.initialLedgerRoot !== attemptLedgerInitialRoot(ledger)) setupIssues.push("forged ledger initial root was not recomputed");
        if (ledger.terminalLedgerRoot !== attemptLedgerTerminalRoot(ledger)) setupIssues.push("forged ledger terminal root was not recomputed");
        if (ledger.digest !== attemptLedgerDigest(ledger)) setupIssues.push("forged ledger digest was not recomputed");
        if ((ledger.attemptRecords ?? []).some((attempt) => attempt.attemptId === vector.attack.deletedAttemptId)) {
          setupIssues.push("declared deleted attempt is still present in forged ledger");
        }
        if (attemptIntegrity.ledger?.digest !== ledger.digest
          || attemptIntegrity.initialLedgerRoot !== ledger.initialLedgerRoot
          || attemptIntegrity.terminalLedgerRoot !== ledger.terminalLedgerRoot
          || attemptIntegrity.physicalAttemptCount !== (ledger.attemptRecords ?? []).length
          || !sameCanonical(attemptIntegrity.attemptRecords, ledger.attemptRecords)) {
          setupIssues.push("forged scorecard attempt accounting is not internally consistent with forged ledger");
        }
        if (vector.attack.scorecardReSignedWithKeyId !== vector.scorecardSigner.keyId) {
          setupIssues.push("forged scorecard signer does not match the declared re-sign action");
        }
      }
      const publicKey = await readFile(resolveFrom(base, vector.scheduler.publicKey), "utf8");
      const scorecardPublicKey = await readFile(resolveFrom(base, vector.scorecardSigner.publicKey), "utf8");
      issues = verifyAttemptLedgerCheckpoint(checkpoint, ledger, {
        attemptIntegrity,
        scorecardSignature: scorecard?.signature ?? { keyId: vector.scorecardSigner.keyId },
        scorecardSigner: {
          keyId: vector.scorecardSigner.keyId,
          publicKey: scorecardPublicKey,
          trustDomain: vector.scorecardSigner.trustDomain
        },
        expectedLogHead: vector.expectedLogHead,
        trustedSchedulerKeys: {
          [vector.scheduler.keyId]: {
            publicKey,
            issuerId: vector.scheduler.issuerId,
            trustDomain: vector.scheduler.trustDomain,
            profileId: vector.scheduler.profileId
          }
        }
      });
    } else {
      issues = [`unknown vector kind ${String(vector.kind)}`];
    }
    const expectedFailure = vector.expected === "fail";
    const expectedIssueFound = vector.expectedIssueIncludes === undefined
      || issues.some((issue) => issue.includes(vector.expectedIssueIncludes));
    const passed = setupIssues.length === 0
      && (expectedFailure ? issues.length > 0 && expectedIssueFound : issues.length === 0);
    results.push({ id: vector.id, expected: vector.expected, passed, issues: [...setupIssues.map((issue) => `vector setup: ${issue}`), ...issues] });
  }
  return results;
}

async function main() {
  const vectorFile = process.argv[2];
  if (!vectorFile || process.argv.length !== 3) {
    console.error("usage: node tools/verify-material-integrity.mjs <vector-set.json>");
    process.exitCode = 2;
    return;
  }
  const results = await runMaterialIntegrityVectors(vectorFile);
  for (const result of results) {
    console.log(`${result.passed ? "PASS" : "FAIL"} ${result.id} (expected ${result.expected})`);
    if (!result.passed || result.expected === "fail") {
      for (const issue of result.issues) console.log(`  - ${issue}`);
    }
  }
  if (results.some((result) => !result.passed)) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
