#!/usr/bin/env node

import { createPublicKey, verify as verifySignature } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  canonicalize,
  sha256Bytes,
  verifyEvidencePayload
} from "./verify-material-integrity.mjs";

const CONTROL_PAYLOAD_SCHEMA = "agent-eval-evaluator-control-result-1";
const CONTROL_MEDIA_TYPE = "application/vnd.agent-evals.evaluator-control+json";
const EVIDENCE_SIGNATURE_DOMAIN = "agent-evals-evidence-artifact-1";
const FIXTURE_PROFILE = "fixture-signature-profile";
const FIXTURE_KEY_ID = "rfc8032-test-key-1";
const repositoryRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const modulePath = fileURLToPath(import.meta.url);

function clone(value) {
  return structuredClone(value);
}

function strictBase64(value, label) {
  if (typeof value !== "string"
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error(`${label} is not canonical RFC 4648 base64`);
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) throw new Error(`${label} is not canonical RFC 4648 base64`);
  return bytes;
}

function strictBase64Url(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("signature is not canonical unpadded base64url");
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.toString("base64url") !== value) {
    throw new Error("signature is not canonical unpadded base64url");
  }
  return bytes;
}

function pathIsWithin(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function resolveRecord(pointer, manifestDirectory, root, resolver) {
  if (typeof resolver === "function") {
    const result = await resolver(pointer);
    if (!result || !(Buffer.isBuffer(result.bytes) || result.bytes instanceof Uint8Array)) {
      throw new Error("control resolver did not return bytes");
    }
    return { bytes: Buffer.from(result.bytes), absolute: result.absolute ?? null };
  }
  if (typeof pointer?.uri !== "string" || pointer.uri.length === 0
    || pointer.uri.includes("\0") || pointer.uri.includes("\\") || path.isAbsolute(pointer.uri)) {
    throw new Error("control uri must be a portable repository-relative path");
  }
  const trustedRoot = await realpath(root);
  const unresolved = path.resolve(manifestDirectory, ...pointer.uri.split("/"));
  if (!pathIsWithin(trustedRoot, unresolved)) throw new Error("control uri escapes the trusted repository root");
  const absolute = await realpath(unresolved);
  if (!pathIsWithin(trustedRoot, absolute)) throw new Error("control uri resolves outside the trusted repository root");
  return { bytes: await readFile(absolute), absolute };
}

async function trustedPublicKey(attestation, options) {
  const configured = options.trustedKeys instanceof Map
    ? options.trustedKeys.get(attestation?.keyId)
    : options.trustedKeys?.[attestation?.keyId];
  if (configured) {
    const entry = typeof configured === "string" || Buffer.isBuffer(configured)
      ? { publicKey: configured }
      : configured;
    if (entry.profileId !== undefined && entry.profileId !== attestation.profileId) {
      throw new Error(`signature profile ${attestation.profileId} is not authorized for key ${attestation.keyId}`);
    }
    return entry.publicKey;
  }
  if (attestation?.profileId === FIXTURE_PROFILE && attestation?.keyId === FIXTURE_KEY_ID) {
    return readFile(path.join(repositoryRoot, "conformance", "fixtures", "keys", `${FIXTURE_KEY_ID}.pem`), "utf8");
  }
  throw new Error(`no externally trusted public key for ${String(attestation?.keyId)}`);
}

async function verifyAttestation(artifact, options) {
  const attestation = artifact?.attestation;
  if (!attestation || attestation.algorithm !== "Ed25519") {
    throw new Error("control record requires an Ed25519 attestation");
  }
  const publicKey = await trustedPublicKey(attestation, options);
  const projection = clone(artifact);
  delete projection.attestation.value;
  const message = Buffer.concat([
    Buffer.from(EVIDENCE_SIGNATURE_DOMAIN, "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalize(projection), "utf8")
  ]);
  const signature = strictBase64Url(attestation.value);
  if (signature.length !== 64) throw new Error(`Ed25519 signature has ${signature.length} bytes, expected 64`);
  if (!verifySignature(null, message, createPublicKey(publicKey), signature)) {
    throw new Error("control-record Ed25519 attestation is invalid");
  }
}

function verifyMaterialField(field, label, issues) {
  let bytes;
  try {
    bytes = strictBase64(field?.contentBase64, `${label}.contentBase64`);
  } catch (error) {
    issues.push(error.message);
    return null;
  }
  if (bytes.length === 0) issues.push(`${label} bytes must be non-empty`);
  if (field.byteLength !== bytes.length) issues.push(`${label}.byteLength must be ${bytes.length}`);
  const digest = sha256Bytes(bytes);
  if (field.digest !== digest) issues.push(`${label}.digest must be ${digest}`);
  if (typeof field.mediaType !== "string" || field.mediaType.length === 0) {
    issues.push(`${label}.mediaType must be non-empty`);
  }
  return bytes;
}

function exactKeys(value, required, label, issues) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    issues.push(`${label} must be an object`);
    return false;
  }
  const actual = Object.keys(value).sort();
  const expected = [...required].sort();
  if (canonicalize(actual) !== canonicalize(expected)) {
    issues.push(`${label} keys must equal [${expected.join(", ")}]`);
    return false;
  }
  return true;
}

async function verifyControlPayload(payload, kind, pointer, manifest) {
  const issues = [];
  const rootKeys = [
    "schemaVersion", "id", "version", "controlKind", "evaluator", "detectorComponents",
    "stimulus", "expectedDetection", "observedDetection", "observation", "executedAt"
  ];
  exactKeys(payload, rootKeys, `control ${pointer.id} payload`, issues);
  if (payload?.schemaVersion !== CONTROL_PAYLOAD_SCHEMA) {
    issues.push(`control ${pointer.id} schemaVersion must be ${CONTROL_PAYLOAD_SCHEMA}`);
  }
  if (payload?.id !== pointer.id || payload?.version !== pointer.version) {
    issues.push(`control ${pointer.id} payload identity/version differs from its pointer`);
  }
  if (payload?.controlKind !== kind) issues.push(`control ${pointer.id} controlKind must be ${kind}`);
  const expectedDetection = kind === "positive";
  if (payload?.expectedDetection !== expectedDetection) {
    issues.push(`${kind} control ${pointer.id} expectedDetection must be ${expectedDetection}`);
  }
  if (payload?.observedDetection !== expectedDetection) {
    issues.push(`${kind} control ${pointer.id} observedDetection must be ${expectedDetection}`);
  }

  exactKeys(payload?.evaluator, ["id", "version", "implementationDigest"],
    `control ${pointer.id} evaluator`, issues);
  if (payload?.evaluator?.id !== manifest.id || payload?.evaluator?.version !== manifest.version
    || payload?.evaluator?.implementationDigest !== manifest.implementation?.digest) {
    issues.push(`control ${pointer.id} does not bind the exact evaluator implementation`);
  }

  const components = new Map((manifest.measurementComponents ?? []).map((component) => [component.id, component]));
  const seenComponents = new Set();
  if (!Array.isArray(payload?.detectorComponents) || payload.detectorComponents.length === 0) {
    issues.push(`control ${pointer.id} requires at least one detector component`);
  }
  for (const binding of payload?.detectorComponents ?? []) {
    exactKeys(binding, ["id", "digest", "configurationDigest"],
      `control ${pointer.id} detector component`, issues);
    if (seenComponents.has(binding.id)) issues.push(`control ${pointer.id} repeats detector component ${binding.id}`);
    seenComponents.add(binding.id);
    const component = components.get(binding.id);
    if (!component || component.digest !== binding.digest
      || component.configurationDigest !== binding.configurationDigest) {
      issues.push(`control ${pointer.id} detector component ${binding.id} differs from the evaluator manifest`);
    }
  }

  exactKeys(payload?.stimulus,
    ["id", "classification", "mediaType", "digest", "byteLength", "contentBase64"],
    `control ${pointer.id} stimulus`, issues);
  const requiredClassification = kind === "positive" ? "known_violation" : "known_benign";
  if (payload?.stimulus?.classification !== requiredClassification) {
    issues.push(`${kind} control ${pointer.id} stimulus classification must be ${requiredClassification}`);
  }
  verifyMaterialField(payload?.stimulus, `control ${pointer.id} stimulus`, issues);

  exactKeys(payload?.observation,
    ["mediaType", "digest", "byteLength", "contentBase64"],
    `control ${pointer.id} observation`, issues);
  const observationBytes = verifyMaterialField(payload?.observation, `control ${pointer.id} observation`, issues);
  if (observationBytes) {
    try {
      const observation = JSON.parse(observationBytes.toString("utf8"));
      exactKeys(observation, ["detected", "detectorComponentIds", "findingIds"],
        `control ${pointer.id} observation payload`, issues);
      if (observation.detected !== payload.observedDetection) {
        issues.push(`control ${pointer.id} observation detected result differs from observedDetection`);
      }
      const observedIds = [...(observation.detectorComponentIds ?? [])].sort();
      const boundIds = [...seenComponents].sort();
      if (canonicalize(observedIds) !== canonicalize(boundIds)) {
        issues.push(`control ${pointer.id} observation detectorComponentIds differ from bound detector components`);
      }
      if (!Array.isArray(observation.findingIds)) {
        issues.push(`control ${pointer.id} observation findingIds must be an array`);
      } else if (kind === "positive" && observation.findingIds.length === 0) {
        issues.push(`positive control ${pointer.id} observation requires a material finding`);
      } else if (kind === "negative" && observation.findingIds.length !== 0) {
        issues.push(`negative control ${pointer.id} observation must not contain findings`);
      }
    } catch (error) {
      issues.push(`control ${pointer.id} observation payload is not valid JSON: ${error.message}`);
    }
  }
  if (!Number.isFinite(Date.parse(payload?.executedAt))) {
    issues.push(`control ${pointer.id} executedAt must be an RFC 3339 timestamp`);
  }
  return issues;
}

async function verifyOneControl(pointer, kind, manifest, sourceAbsolute, options, verifierDigest) {
  const issues = [];
  let resolved;
  try {
    resolved = await resolveRecord(
      pointer,
      path.dirname(sourceAbsolute),
      options.root ?? repositoryRoot,
      options.resolveControlRecord
    );
  } catch (error) {
    return [`${kind} control ${pointer?.id ?? "unknown"} cannot resolve: ${error.message}`];
  }
  const recordDigest = sha256Bytes(resolved.bytes);
  if (pointer.digest !== recordDigest) {
    issues.push(`${kind} control ${pointer.id} record digest must be ${recordDigest}`);
  }
  let artifact;
  try {
    artifact = JSON.parse(resolved.bytes.toString("utf8"));
  } catch (error) {
    return [...issues, `${kind} control ${pointer.id} record is not valid JSON: ${error.message}`];
  }
  exactKeys(artifact, [
    "id", "uri", "mediaType", "digest", "byteLength", "payload", "producer",
    "creationPhase", "createdAt", "schemaMetadata", "mediaInterpretation",
    "accessClass", "accessPolicyBinding", "privacyAndIp", "retention", "attestation"
  ], `${kind} control ${pointer.id} signed record`, issues);
  if (artifact?.id !== pointer.id) issues.push(`${kind} control ${pointer.id} resolved record id is ${String(artifact?.id)}`);
  if (artifact?.digest !== pointer.payloadDigest) {
    issues.push(`${kind} control ${pointer.id} payloadDigest differs from the signed record`);
  }
  if (artifact?.mediaType !== CONTROL_MEDIA_TYPE) {
    issues.push(`${kind} control ${pointer.id} mediaType must be ${CONTROL_MEDIA_TYPE}`);
  }
  if (artifact?.uri !== `artifact:${artifact?.digest}`) {
    issues.push(`${kind} control ${pointer.id} record uri must content-address its payload`);
  }
  if (artifact?.mediaInterpretation?.profileId !== "evaluator-control-result-json"
    || artifact?.mediaInterpretation?.profileVersion !== "0.1.0"
    || artifact?.mediaInterpretation?.semanticContract?.id !== "evaluator-control-verifier"
    || artifact?.mediaInterpretation?.semanticContract?.version !== "0.1.0"
    || artifact?.mediaInterpretation?.semanticContract?.digest !== verifierDigest) {
    issues.push(`${kind} control ${pointer.id} does not bind the exact evaluator-control verifier`);
  }
  const payloadIssues = await verifyEvidencePayload(artifact, {
    baseDirectory: resolved.absolute ? path.dirname(resolved.absolute) : path.dirname(sourceAbsolute),
    resolveExternal: options.resolveExternalPayload
  });
  issues.push(...payloadIssues.map((issue) => `${kind} control ${pointer.id} material payload: ${issue}`));
  try {
    await verifyAttestation(artifact, options);
  } catch (error) {
    issues.push(`${kind} control ${pointer.id} attestation: ${error.message}`);
  }
  let payloadBytes;
  try {
    if (artifact?.payload?.kind !== "inline_base64") {
      issues.push(`${kind} control ${pointer.id} fixture requires inline material payload bytes`);
    } else {
      payloadBytes = strictBase64(artifact.payload.contentBase64, `${kind} control ${pointer.id} payload`);
    }
  } catch (error) {
    issues.push(error.message);
  }
  if (payloadBytes) {
    try {
      const payload = JSON.parse(payloadBytes.toString("utf8"));
      issues.push(...await verifyControlPayload(payload, kind, pointer, manifest));
    } catch (error) {
      issues.push(`${kind} control ${pointer.id} payload is not valid JSON: ${error.message}`);
    }
  }
  return issues;
}

export async function verifyEvaluatorControls(manifest, sourceAbsolute, options = {}) {
  const issues = [];
  const positive = manifest?.positiveControlRecords;
  const negative = manifest?.negativeControlRecords;
  if (!Array.isArray(positive) || positive.length === 0) issues.push("at least one positive control record is required");
  if (!Array.isArray(negative) || negative.length === 0) issues.push("at least one negative control record is required");

  const seenIds = new Map();
  const seenUris = new Map();
  for (const [kind, records] of [["positive", positive ?? []], ["negative", negative ?? []]]) {
    for (const pointer of records) {
      const prior = seenIds.get(pointer?.id);
      if (prior) {
        if (prior.digest !== pointer.digest || prior.payloadDigest !== pointer.payloadDigest) {
          issues.push(`control id ${pointer.id} resolves to multiple digests`);
        }
        if (prior.kind !== kind) issues.push(`control ${pointer.id} cannot be both positive and negative`);
      } else {
        seenIds.set(pointer?.id, { ...pointer, kind });
      }
      const priorUri = seenUris.get(pointer?.uri);
      if (priorUri && priorUri !== pointer?.id) {
        issues.push(`control uri ${pointer.uri} resolves more than one control identity`);
      } else {
        seenUris.set(pointer?.uri, pointer?.id);
      }
    }
  }

  const verifierDigest = sha256Bytes(await readFile(modulePath));
  for (const pointer of positive ?? []) {
    issues.push(...await verifyOneControl(pointer, "positive", manifest, sourceAbsolute, options, verifierDigest));
  }
  for (const pointer of negative ?? []) {
    issues.push(...await verifyOneControl(pointer, "negative", manifest, sourceAbsolute, options, verifierDigest));
  }
  return issues;
}

function applyMutation(document, mutation) {
  const parts = mutation.pointer.split("/").slice(1)
    .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
  let cursor = document;
  for (const part of parts.slice(0, -1)) cursor = cursor[Array.isArray(cursor) ? Number(part) : part];
  const last = parts.at(-1);
  if (!Object.hasOwn(mutation, "value")) {
    if (Array.isArray(cursor)) cursor.splice(Number(last), 1);
    else delete cursor[last];
  } else {
    cursor[Array.isArray(cursor) ? Number(last) : last] = mutation.value;
  }
}

export async function runEvaluatorControlVectors(vectorFile) {
  const absoluteVector = path.resolve(vectorFile);
  const vectorSet = JSON.parse(await readFile(absoluteVector, "utf8"));
  const vectorDirectory = path.dirname(absoluteVector);
  const manifestPath = path.resolve(vectorDirectory, vectorSet.manifest);
  const baseManifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const publicKey = await readFile(path.resolve(vectorDirectory, vectorSet.fixturePublicKey), "utf8");
  const options = {
    root: path.resolve(vectorDirectory, vectorSet.repositoryRoot),
    trustedKeys: {
      [FIXTURE_KEY_ID]: { profileId: FIXTURE_PROFILE, publicKey }
    }
  };
  let passed = 0;
  const failures = [];
  for (const vector of vectorSet.vectors ?? []) {
    const manifest = clone(baseManifest);
    for (const mutation of vector.mutations ?? []) applyMutation(manifest, mutation);
    const issues = await verifyEvaluatorControls(manifest, manifestPath, options);
    const actual = issues.length === 0 ? "pass" : "fail";
    if (actual !== vector.expected
      || (vector.expectedIssueIncludes && !issues.some((issue) => issue.includes(vector.expectedIssueIncludes)))) {
      failures.push(`${vector.id}: expected ${vector.expected}${vector.expectedIssueIncludes ? ` containing ${vector.expectedIssueIncludes}` : ""}; got ${actual}: ${issues.join("; ")}`);
    } else {
      passed += 1;
    }
  }
  if (failures.length > 0) throw new Error(failures.join("\n"));
  return { passed, total: vectorSet.vectors.length };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  const vectorFile = process.argv[2]
    ?? path.join(repositoryRoot, "conformance", "fixtures", "evaluator-controls", "vectors.json");
  try {
    const result = await runEvaluatorControlVectors(vectorFile);
    console.log(`Evaluator control vectors passed: ${result.passed}/${result.total}.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
