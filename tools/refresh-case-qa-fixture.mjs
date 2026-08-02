#!/usr/bin/env node

import { createHash, createPrivateKey, sign } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  caseQaMaterialPathDigest,
  caseQaMaterialPathSetDigest,
  caseQaRepositoryConventionManifestDigest,
  caseQaRepositorySelectorDigest
} from "./verify-case-qa-record.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(root, "conformance", "fixtures", "positive", "case-qa-activated.json");
const classificationFrameTrustAnchorPath = path.join(
  root,
  "conformance",
  "fixtures",
  "positive",
  "case-qa-classification-frame-trust-anchor.json"
);
const registryPath = path.join(root, "standard", "outcome-replay-executor-registry.json");
const ED25519_SEED = Buffer.from(
  "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
  "hex"
);
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}

function sha256Bytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function fixturePrivateKey() {
  return createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, ED25519_SEED]),
    format: "der",
    type: "pkcs8"
  });
}

function signEvidence(artifact) {
  const projection = structuredClone(artifact);
  delete projection.attestation.value;
  const message = Buffer.concat([
    Buffer.from("agent-evals-evidence-artifact-1", "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalize(projection), "utf8")
  ]);
  artifact.attestation.value = sign(null, message, fixturePrivateKey()).toString("base64url");
}

function signRecord(record) {
  const digestProjection = structuredClone(record);
  delete digestProjection.digest;
  delete digestProjection.signature;
  record.digest = sha256Bytes(Buffer.from(canonicalize(digestProjection), "utf8"));
  const signingProjection = structuredClone(record);
  delete signingProjection.signature.value;
  const message = Buffer.concat([
    Buffer.from(record.schemaVersion, "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalize(signingProjection), "utf8")
  ]);
  record.signature.value = sign(null, message, fixturePrivateKey()).toString("base64url");
}

const record = JSON.parse(await readFile(fixturePath, "utf8"));
const classificationFrameTrustAnchor = JSON.parse(await readFile(classificationFrameTrustAnchorPath, "utf8"));
for (const field of ["id", "version", "digest", "activationInputDigest"]) {
  if (classificationFrameTrustAnchor.case?.[field] !== record.case?.[field]) {
    throw new Error(`classification-frame trust anchor case.${field} does not bind the Case QA fixture`);
  }
}
const registryBytes = await readFile(registryPath);
const registry = JSON.parse(registryBytes.toString("utf8"));
const matches = (registry.executors ?? []).filter((entry) => entry.outcomeProfileId === "workspace-change-v1");
if (matches.length !== 1) throw new Error(`workspace-change-v1 resolves ${matches.length} registry entries`);
const binding = matches[0];
const registryPointer = {
  id: registry.id,
  version: registry.version,
  uri: "standard/outcome-replay-executor-registry.json",
  digest: sha256Bytes(registryBytes)
};
const repositoryConventionManifest = structuredClone(
  classificationFrameTrustAnchor.repositoryConventionManifest
);
const materialPaths = structuredClone(classificationFrameTrustAnchor.materialPaths);
for (const repository of repositoryConventionManifest.repositories ?? []) {
  for (const convention of repository.conventions ?? []) {
    if (convention.selectorDigest !== caseQaRepositorySelectorDigest(convention.selector)) {
      throw new Error(`classification-frame trust anchor selector ${convention.id} has a stale digest`);
    }
  }
}
for (const materialPath of materialPaths) {
  if (materialPath.pathDigest !== caseQaMaterialPathDigest(materialPath.path)) {
    throw new Error(`classification-frame trust anchor path ${materialPath.repositoryId}:${materialPath.path} has a stale digest`);
  }
}
const payload = {
  schemaVersion: "case-qa-classification-applicability-evidence-1",
  case: {
    id: record.case.id,
    version: record.case.version,
    digest: record.case.digest,
    activationInputDigest: record.case.activationInputDigest
  },
  outcomeReplayRegistry: registryPointer,
  outcomeProfile: structuredClone(binding.outcomeProfile),
  classificationPolicyContract: structuredClone(binding.semanticContract),
  executor: structuredClone(binding.executor),
  applicabilityRule: structuredClone(binding.classificationApplicabilityRule),
  frameSource: "sealed_activation_input",
  repositoryConventionManifest,
  repositoryConventionManifestDigest: caseQaRepositoryConventionManifestDigest(repositoryConventionManifest),
  materialPathSetDigest: caseQaMaterialPathSetDigest(materialPaths),
  materialPaths,
  classifications: [
    {
      ...materialPaths[0],
      matchedConventionIds: ["fixture-source-prefix"],
      workArtifactType: "code_change"
    }
  ],
  unknownPaths: [],
  collisions: [],
  result: "applicable"
};
const payloadBytes = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, "utf8");
const payloadDigest = sha256Bytes(payloadBytes);
const template = record.evidenceManifest.find((artifact) => artifact.id === "fixture-evidence-1");
if (!template) throw new Error("case QA fixture has no evidence template");
const evidence = {
  ...structuredClone(template),
  id: "classification-policy-applicability-evidence",
  artifactType: "repo-change-v1:classification_policy_applicability",
  uri: `artifact:${payloadDigest}`,
  mediaType: "application/json",
  digest: payloadDigest,
  byteLength: payloadBytes.length,
  producer: {
    id: "fixture-case-qa-verifier",
    role: "classification_applicability_verifier",
    trustDomain: "case_qa"
  },
  creationPhase: "case_qa",
  schemaMetadata: {
    schemaId: "urn:agent-evals-standard:schema:case-qa-record:1#/$defs/classificationPolicyApplicabilityEvidence",
    schemaVersion: "case-qa-classification-applicability-evidence-1",
    validatorDigest: binding.classificationApplicabilityRule.digest
  },
  mediaInterpretation: {
    profileId: "json-rfc8785",
    profileVersion: "0.1.0",
    semanticContract: {
      id: binding.classificationApplicabilityRule.id,
      version: binding.classificationApplicabilityRule.version,
      digest: binding.classificationApplicabilityRule.digest
    }
  },
  attestation: {
    profileId: "fixture-signature-profile",
    algorithm: "Ed25519",
    keyId: "rfc8032-test-key-1",
    signedAt: "2026-08-01T00:00:00Z",
    value: "pending"
  },
  payload: {
    kind: "inline_base64",
    contentBase64: payloadBytes.toString("base64")
  }
};
signEvidence(evidence);
record.evidenceManifest = [
  ...record.evidenceManifest.filter((artifact) => artifact.id !== evidence.id),
  evidence
];
const applicability = record.stages.stage0.classificationPolicyApplicability;
Object.assign(applicability, {
  status: "applicable",
  outcomeReplayRegistry: registryPointer,
  outcomeProfile: structuredClone(binding.outcomeProfile),
  classificationPolicyContract: structuredClone(binding.semanticContract),
  executor: structuredClone(binding.executor),
  applicabilityRule: structuredClone(binding.classificationApplicabilityRule),
  repositoryConventionManifestDigest: payload.repositoryConventionManifestDigest,
  materialPathSetDigest: payload.materialPathSetDigest,
  materialPathCount: materialPaths.length,
  classifiedPathCount: payload.classifications.length,
  unknownPathCount: payload.unknownPaths.length,
  collisionCount: payload.collisions.length,
  applicabilityEvidenceId: evidence.id,
  coverageEvidenceId: evidence.id
});
record.stages.stage0.evidenceIds = [...new Set([
  ...record.stages.stage0.evidenceIds,
  evidence.id
])].sort();
signRecord(record);
await writeFile(fixturePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
process.stdout.write(`${path.relative(root, fixturePath)}\n`);
