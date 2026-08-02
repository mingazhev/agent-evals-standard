import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalize } from "./verify-noncircular-conformance-proofs.mjs";

const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(toolDirectory, "..");
const fixtureDirectory = path.join(root, "conformance", "fixtures", "noncircular-proof");
const keyDirectory = path.join(fixtureDirectory, "keys");
const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

const identities = {
  registry: {
    seed: "f5e5767cf153319517630f226876b86c8160cc583bc013744c6bf255f5cc0ee5",
    keyId: "rfc8032-test-key-4-registry",
    profileId: "fixture-proof-registry-profile",
    actorId: "fixture-verifier-registry-authority",
    trustDomain: "fixture-registry-authority"
  },
  automated: {
    seed: "4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb",
    keyId: "rfc8032-test-key-2-verifier",
    profileId: "fixture-automated-verifier-profile",
    actorId: "fixture-replay-verifier",
    trustDomain: "fixture-replay-verifier"
  },
  reviewer: {
    seed: "c5aa8df43f9f837bedb7442f31dcb7b166d38535076f094b85ce3a2e0b4458f7",
    keyId: "rfc8032-test-key-3-reviewer",
    profileId: "fixture-accountable-reviewer-profile",
    actorId: "fixture-independent-reviewer",
    trustDomain: "fixture-independent-review"
  },
  claimant: {
    seed: "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
    keyId: "rfc8032-test-key-1-claimant",
    profileId: "fixture-claimant-profile",
    actorId: "fixture-claimant",
    trustDomain: "fixture-claimant"
  }
};

function privateKey(identity) {
  return createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, Buffer.from(identity.seed, "hex")]),
    format: "der",
    type: "pkcs8"
  });
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function sha256Canonical(value) {
  return sha256(Buffer.from(canonicalize(value), "utf8"));
}

function signed(document, identity, signedAt) {
  const result = structuredClone(document);
  result.signature = {
    profileId: identity.profileId,
    algorithm: "Ed25519",
    keyId: identity.keyId,
    signedAt,
    value: "pending"
  };
  const digestProjection = structuredClone(result);
  delete digestProjection.digest;
  delete digestProjection.signature;
  result.digest = sha256Canonical(digestProjection);
  const signingProjection = structuredClone(result);
  delete signingProjection.signature.value;
  const message = Buffer.concat([
    Buffer.from(result.schemaVersion, "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalize(signingProjection), "utf8")
  ]);
  result.signature.value = sign(null, message, privateKey(identity)).toString("base64url");
  return result;
}

async function writeJson(name, document) {
  const bytes = Buffer.from(`${JSON.stringify(document, null, 2)}\n`, "utf8");
  await writeFile(path.join(fixtureDirectory, name), bytes);
  return { name, bytes, document };
}

function pointer(id, artifact, version = "0.1.0") {
  return {
    id,
    version,
    uri: artifact.name,
    digest: sha256(artifact.bytes),
    byteLength: artifact.bytes.length
  };
}

function input(role, id, artifact, version = "0.1.0", digestOverride) {
  return { role, ...pointer(id, artifact, version), ...(digestOverride ? { digest: digestOverride } : {}) };
}

function dependencyManifest(targetPointer) {
  const manifest = {
    id: "fixture-proof-target-dependencies",
    version: "0.1.0",
    entries: [{
      role: "target_subject",
      id: targetPointer.id,
      version: targetPointer.version,
      uri: targetPointer.uri,
      digest: targetPointer.digest
    }]
  };
  return { ...manifest, digest: sha256Canonical(manifest) };
}

function scopeSlice() {
  return {
    scopeSliceId: "fixture-slice",
    repositorySnapshotDigest: `sha256:${"1".repeat(64)}`,
    evaluationProfile: {
      id: "fixture-profile",
      version: "0.1.0",
      digest: `sha256:${"2".repeat(64)}`,
      effectiveProfileDigest: `sha256:${"3".repeat(64)}`
    },
    workArtifactRegistry: {
      id: "fixture-work-artifact-registry",
      version: "0.1.0",
      digest: `sha256:${"4".repeat(64)}`
    },
    outcomeProfiles: [{
      id: "fixture-outcome-profile",
      version: "0.1.0",
      digest: `sha256:${"5".repeat(64)}`
    }],
    materialRepositoryGrounding: {
      evidenceId: "fixture-grounding-evidence",
      assertionIds: {
        repositoryNecessity: "fixture-repository-necessity",
        claimInvariantTraceability: "fixture-claim-traceability",
        repositoryGovernedOutcome: "fixture-governed-outcome",
        removalCounterfactual: "fixture-removal-counterfactual"
      }
    }
  };
}

function makeRecord({
  id,
  assertionId,
  requirementId,
  targetPointer,
  dependency,
  registryPointer,
  entryId,
  method,
  inputBindings,
  result,
  findingIds,
  actor,
  criteria,
  executedAt = "2026-08-01T00:05:00Z"
}) {
  const record = {
    schemaVersion: "agent-eval-conformance-verification-record-1",
    id,
    version: "0.1.0",
    proofAssertionId: assertionId,
    scopeSliceId: "fixture-slice",
    target: "case",
    targetId: targetPointer.id,
    targetSubjectDigest: targetPointer.digest,
    dependencyManifestDigest: dependency.digest,
    requirementId,
    method,
    registry: {
      id: registryPointer.id,
      version: registryPointer.version,
      digest: registryPointer.digest
    },
    entryId,
    inputBindings,
    result,
    findingIds,
    actor: { id: actor.actorId, trustDomain: actor.trustDomain },
    executedAt
  };
  if (criteria) record.criteria = criteria;
  return signed(record, actor, executedAt);
}

function makeProof({ id, requirementId, targetPointer, registryPointer, recordPointer, applicabilityPointer, extraAssertion }) {
  const dependency = dependencyManifest(targetPointer);
  return {
    schemaVersion: "agent-eval-conformance-requirement-proof-set-1",
    id,
    version: "0.1.0",
    statementId: "fixture-conformance-statement",
    target: "case",
    targetId: targetPointer.id,
    targetSubject: {
      id: targetPointer.id,
      version: targetPointer.version,
      uri: targetPointer.uri,
      digest: targetPointer.digest
    },
    dependencyManifest: dependency,
    scopeSlices: [scopeSlice()],
    applicabilityContract: {
      id: applicabilityPointer.id,
      version: applicabilityPointer.version,
      digest: applicabilityPointer.digest
    },
    verifierRegistry: registryPointer,
    proofAssertions: [{
      id: recordPointer.id.replace("record", "assertion"),
      type: "requirement_verification",
      evidenceId: "fixture-proof-evidence",
      scopeSliceId: "fixture-slice",
      target: "case",
      targetId: targetPointer.id,
      targetSubjectDigest: targetPointer.digest,
      dependencyManifestDigest: dependency.digest,
      requirementId,
      verificationRecord: recordPointer,
      ...extraAssertion
    }]
  };
}

await mkdir(keyDirectory, { recursive: true });
for (const [name, identity] of Object.entries(identities)) {
  const pem = createPublicKey(privateKey(identity)).export({ format: "pem", type: "spki" });
  await writeFile(path.join(keyDirectory, `${name}.pem`), pem);
}

function fixtureVerificationContract(requirement) {
  const permittedMethods = requirement.verificationKind === "manual_governance"
    ? ["accountable_review"]
    : ["automated_replay"];
  return {
    criterionId: `${requirement.id}.complete`,
    strength: "complete_primary_definition",
    normativeReference: requirement.normativeReference,
    question: `Does the target satisfy every applicable REQUIRED obligation of ${requirement.id} at ${requirement.normativeReference} and every named semantic contract invoked there, and either satisfy or record an approved, scoped deviation for every applicable RECOMMENDED obligation?`,
    permittedMethods
  };
}

function fixtureRequirement(id, targets, verificationKind = "semantic", normativeReference = `fixture#${id.toLowerCase()}`) {
  const requirement = {
    id,
    targets,
    normativeReference,
    verificationKind
  };
  return { ...requirement, verificationContract: fixtureVerificationContract(requirement) };
}

function projectedCriterion(requirement) {
  const contract = requirement.verificationContract;
  return {
    id: contract.criterionId,
    requirementId: requirement.id,
    strength: contract.strength,
    normativeReference: contract.normativeReference,
    question: contract.question
  };
}

const automatedRequirement = fixtureRequirement("FIX-AUTO-001", ["case"]);
const manualRequirement = fixtureRequirement("FIX-MANUAL-001", ["case"], "manual_governance");
const outcomeRequirement = fixtureRequirement(
  "OUT-001",
  ["case", "evaluator", "experiment"],
  "semantic",
  "scorecard-contract.md#successful-functional-and-accepted-outcomes"
);
const evidenceRequirement = fixtureRequirement(
  "EVID-001",
  ["suite", "case", "evaluator", "experiment", "decision"],
  "semantic",
  "evidence-and-validation-contract.md#canonical-evidence-artifact"
);

const requirements = await writeJson("requirements.json", {
  schemaVersion: "fixture-requirement-registry-1",
  id: "fixture-requirements",
  version: "0.1.0",
  requirements: [
    automatedRequirement,
    manualRequirement,
    outcomeRequirement,
    evidenceRequirement
  ]
});
const requirementsMutated = await writeJson("requirements-mutated.json", {
  schemaVersion: "fixture-requirement-registry-1",
  id: "fixture-requirements-mutated",
  version: "0.1.0",
  requirements: [
    { ...automatedRequirement, targets: ["experiment"] },
    manualRequirement,
    outcomeRequirement,
    evidenceRequirement
  ]
});
const targetTrue = await writeJson("target-true.json", {
  schemaVersion: "fixture-case-target-1",
  id: "fixture-case-true",
  version: "0.1.0",
  checks: { "FIX-AUTO-001": true }
});
const targetFalse = await writeJson("target-false.json", {
  schemaVersion: "fixture-case-target-1",
  id: "fixture-case-false",
  version: "0.1.0",
  checks: { "FIX-AUTO-001": false }
});
const applicability = await writeJson("applicability.json", {
  schemaVersion: "fixture-applicability-contract-1",
  id: "fixture-applicability",
  version: "0.1.0",
  rules: [
    { requirementId: "FIX-AUTO-001", target: "case", applicable: true },
    { requirementId: "FIX-MANUAL-001", target: "case", applicable: true },
    { requirementId: "OUT-001", target: "case", applicable: true },
    { requirementId: "EVID-001", target: "case", applicable: true }
  ]
});
const manualEvidence = await writeJson("manual-evidence.json", {
  schemaVersion: "fixture-manual-evidence-1",
  id: "fixture-manual-evidence",
  version: "0.1.0",
  scopeDocumented: true,
  approvalRecorded: true
});

const adapterBytes = await readFile(path.join(toolDirectory, "conformance-proof-adapters.mjs"));
const implementation = {
  id: "reference-conformance-proof-adapters",
  version: "0.1.0",
  uri: "../../../tools/conformance-proof-adapters.mjs",
  digest: sha256(adapterBytes),
  byteLength: adapterBytes.length,
  runtime: "node-esm",
  exportedFunction: "fixtureBooleanRequirementV1"
};
function requirementBinding(requirementId) {
  const matches = requirements.document.requirements.filter((entry) => entry.id === requirementId);
  if (matches.length !== 1) throw new Error(`fixture requirement ${requirementId} resolves ${matches.length} times`);
  return { requirementId, entryDigest: sha256Canonical(matches[0]) };
}
const automatedEntry = {
  id: "fixture-automated-entry",
  version: "0.1.0",
  method: "automated_replay",
  adapterId: "fixture-json-boolean-v1",
  implementation,
  allowedRequirementIds: ["FIX-AUTO-001"],
  requirementBindings: [requirementBinding("FIX-AUTO-001")],
  criteria: [projectedCriterion(automatedRequirement)],
  requiredInputRoles: ["requirement_registry", "target_subject", "applicability_contract"],
  authorizedActors: [{
    actorId: identities.automated.actorId,
    keyId: identities.automated.keyId,
    trustDomain: identities.automated.trustDomain
  }]
};
function accountableReviewEntry(id, requirement) {
  return {
    id,
    version: "0.1.0",
    method: "accountable_review",
    allowedRequirementIds: [requirement.id],
    requirementBindings: [requirementBinding(requirement.id)],
    requiredInputRoles: ["requirement_registry", "target_subject", "manual_evidence"],
    criteria: [projectedCriterion(requirement)],
    authorizedActors: [{
      actorId: identities.reviewer.actorId,
      keyId: identities.reviewer.keyId,
      trustDomain: identities.reviewer.trustDomain
    }]
  };
}
const reviewEntry = accountableReviewEntry("fixture-review-entry", manualRequirement);
const outcomeReviewEntry = accountableReviewEntry("fixture-outcome-review-entry", outcomeRequirement);
const evidenceReviewEntry = accountableReviewEntry("fixture-evidence-review-entry", evidenceRequirement);
/*
 * These semantic-review entries are deliberately registry-authenticated. Their
 * proof vectors must still fail because method authorization comes from the
 * requirement-owned verification contract, not from the verifier registry.
 */
const registeredEntries = [automatedEntry, reviewEntry, outcomeReviewEntry, evidenceReviewEntry];
function registry(entries = registeredEntries) {
  return signed({
    schemaVersion: "agent-eval-conformance-verifier-registry-1",
    id: "fixture-conformance-verifier-registry",
    version: "0.1.0",
    validFrom: "2026-08-01T00:00:00Z",
    expiresAt: "2026-08-02T00:00:00Z",
    entries,
    issuer: {
      id: identities.registry.actorId,
      role: "verification_registry_authority",
      trustDomain: identities.registry.trustDomain
    }
  }, identities.registry, "2026-08-01T00:01:00Z");
}

const registryValid = await writeJson("registry.json", registry());
const registryValidPointer = pointer("fixture-conformance-verifier-registry", registryValid);
const registryBadImplementation = await writeJson("registry-bad-implementation.json", registry([
  { ...automatedEntry, implementation: { ...implementation, digest: `sha256:${"0".repeat(64)}` } },
  reviewEntry
]));
const registryBadImplementationPointer = pointer("fixture-conformance-verifier-registry", registryBadImplementation);
const registryUnknownAdapter = await writeJson("registry-unknown-adapter.json", registry([
  { ...automatedEntry, adapterId: "claimant-supplied-adapter" },
  reviewEntry
]));
const registryUnknownAdapterPointer = pointer("fixture-conformance-verifier-registry", registryUnknownAdapter);
const registryWeakenedCriterion = await writeJson("registry-weakened-criterion.json", registry([
  automatedEntry,
  {
    ...reviewEntry,
    criteria: [{
      ...projectedCriterion(manualRequirement),
      question: "Is any review note present?"
    }]
  }
]));
const registryWeakenedCriterionPointer = pointer(
  "fixture-conformance-verifier-registry",
  registryWeakenedCriterion
);
const tamperedDocument = structuredClone(registryValid.document);
tamperedDocument.issuer.id = "claimant-registry-authority";
const registryTampered = await writeJson("registry-tampered.json", tamperedDocument);
const registryTamperedPointer = pointer("fixture-conformance-verifier-registry", registryTampered);

const requirementPointer = pointer("fixture-requirements", requirements);
const truePointer = pointer("fixture-case-true", targetTrue);
const falsePointer = pointer("fixture-case-false", targetFalse);
const applicabilityPointer = pointer("fixture-applicability", applicability);
const manualEvidencePointer = pointer("fixture-manual-evidence", manualEvidence);

async function recordArtifact(name, parameters) {
  return writeJson(name, makeRecord(parameters));
}

function automatedInputs(targetArtifact, digestOverride, requirementArtifact = requirements) {
  return [
    input("requirement_registry", requirementArtifact.document.id, requirementArtifact),
    input("target_subject", targetArtifact.document.id, targetArtifact, "0.1.0", digestOverride),
    input("applicability_contract", applicabilityPointer.id, applicability)
  ];
}
function reviewInputs() {
  return [
    input("requirement_registry", requirementPointer.id, requirements),
    input("target_subject", targetTrue.document.id, targetTrue),
    input("manual_evidence", manualEvidencePointer.id, manualEvidence)
  ];
}

async function automatedRecord(name, targetArtifact, registryPointer, result = "pass", findingIds = [], inputs = automatedInputs(targetArtifact)) {
  const assertionId = name.replace("record", "assertion").replace(".json", "");
  const targetPointer = pointer(targetArtifact.document.id, targetArtifact);
  return recordArtifact(name, {
    id: name.replace(".json", ""),
    assertionId,
    requirementId: "FIX-AUTO-001",
    targetPointer,
    dependency: dependencyManifest(targetPointer),
    registryPointer,
    entryId: "fixture-automated-entry",
    method: "automated_replay",
    inputBindings: inputs,
    result,
    findingIds,
    actor: identities.automated
  });
}

const autoPass = await automatedRecord("auto-pass-record.json", targetTrue, registryValidPointer);
const autoFalsePass = await automatedRecord("auto-false-self-report-record.json", targetFalse, registryValidPointer);
const autoBadInput = await automatedRecord("auto-bad-input-digest-record.json", targetTrue, registryValidPointer,
  "pass", [], automatedInputs(targetTrue, `sha256:${"9".repeat(64)}`));
const autoRequirementDrift = await automatedRecord("auto-requirement-drift-record.json", targetTrue,
  registryValidPointer, "pass", [], automatedInputs(targetTrue, undefined, requirementsMutated));
const autoBadImplementation = await automatedRecord("auto-bad-implementation-record.json", targetTrue,
  registryBadImplementationPointer);
const autoUnknownAdapter = await automatedRecord("auto-unknown-adapter-record.json", targetTrue,
  registryUnknownAdapterPointer);
const autoTamperedRegistry = await automatedRecord("auto-tampered-registry-record.json", targetTrue,
  registryTamperedPointer);

const manualAssertionId = "review-pass-assertion";
const reviewPass = await writeJson("review-pass-record.json", makeRecord({
  id: "review-pass-record",
  assertionId: manualAssertionId,
  requirementId: "FIX-MANUAL-001",
  targetPointer: truePointer,
  dependency: dependencyManifest(truePointer),
  registryPointer: registryValidPointer,
  entryId: "fixture-review-entry",
  method: "accountable_review",
  inputBindings: reviewInputs(),
  result: "pass",
  findingIds: [],
  actor: identities.reviewer,
  criteria: [
    { criterionId: "FIX-MANUAL-001.complete", result: "pass", evidenceInputIds: [manualEvidencePointer.id], rationale: "The bound evidence addresses the complete primary definition: scope is explicit and accountable approval is recorded." }
  ]
}));
const reviewMissingCriterion = await writeJson("review-missing-criterion-record.json", makeRecord({
  id: "review-missing-criterion-record",
  assertionId: "review-missing-criterion-assertion",
  requirementId: "FIX-MANUAL-001",
  targetPointer: truePointer,
  dependency: dependencyManifest(truePointer),
  registryPointer: registryValidPointer,
  entryId: "fixture-review-entry",
  method: "accountable_review",
  inputBindings: reviewInputs(),
  result: "pass",
  findingIds: [],
  actor: identities.reviewer,
  criteria: []
}));
const reviewClaimantSigned = await writeJson("review-claimant-signed-record.json", makeRecord({
  id: "review-claimant-signed-record",
  assertionId: "review-claimant-signed-assertion",
  requirementId: "FIX-MANUAL-001",
  targetPointer: truePointer,
  dependency: dependencyManifest(truePointer),
  registryPointer: registryValidPointer,
  entryId: "fixture-review-entry",
  method: "accountable_review",
  inputBindings: reviewInputs(),
  result: "pass",
  findingIds: [],
  actor: identities.claimant,
  criteria: [
    { criterionId: "FIX-MANUAL-001.complete", result: "pass", evidenceInputIds: [manualEvidencePointer.id], rationale: "Claimant-authored review of the complete criterion." }
  ]
}));
const reviewWeakenedCriterion = await writeJson("review-weakened-criterion-record.json", makeRecord({
  id: "review-weakened-criterion-record",
  assertionId: "review-weakened-criterion-assertion",
  requirementId: "FIX-MANUAL-001",
  targetPointer: truePointer,
  dependency: dependencyManifest(truePointer),
  registryPointer: registryWeakenedCriterionPointer,
  entryId: "fixture-review-entry",
  method: "accountable_review",
  inputBindings: reviewInputs(),
  result: "pass",
  findingIds: [],
  actor: identities.reviewer,
  criteria: [
    { criterionId: "FIX-MANUAL-001.complete", result: "pass", evidenceInputIds: [manualEvidencePointer.id], rationale: "A review note exists." }
  ]
}));
function semanticReviewRecord(name, requirement, entryId) {
  const assertionId = name.replace("record", "assertion").replace(".json", "");
  return writeJson(name, makeRecord({
    id: name.replace(".json", ""),
    assertionId,
    requirementId: requirement.id,
    targetPointer: truePointer,
    dependency: dependencyManifest(truePointer),
    registryPointer: registryValidPointer,
    entryId,
    method: "accountable_review",
    inputBindings: reviewInputs(),
    result: "pass",
    findingIds: [],
    actor: identities.reviewer,
    criteria: [{
      criterionId: requirement.verificationContract.criterionId,
      result: "pass",
      evidenceInputIds: [manualEvidencePointer.id],
      rationale: "An authorized reviewer reports that the complete semantic criterion passes."
    }]
  }));
}
const reviewOutcomeOnly = await semanticReviewRecord(
  "review-outcome-only-record.json",
  outcomeRequirement,
  outcomeReviewEntry.id
);
const reviewEvidenceOnly = await semanticReviewRecord(
  "review-evidence-only-record.json",
  evidenceRequirement,
  evidenceReviewEntry.id
);

async function proofArtifact(name, requirementId, targetPointer, registryPointer, record, extraAssertion) {
  const recordPointer = pointer(record.document.id, record);
  return writeJson(name, makeProof({
    id: name.replace(".json", ""),
    requirementId,
    targetPointer,
    registryPointer,
    recordPointer,
    applicabilityPointer,
    extraAssertion
  }));
}

await proofArtifact("proof-auto-pass.json", "FIX-AUTO-001", truePointer, registryValidPointer, autoPass);
await proofArtifact("proof-auto-false-self-report.json", "FIX-AUTO-001", falsePointer, registryValidPointer, autoFalsePass);
await proofArtifact("proof-auto-bad-input-digest.json", "FIX-AUTO-001", truePointer, registryValidPointer, autoBadInput);
await proofArtifact("proof-auto-requirement-drift.json", "FIX-AUTO-001", truePointer, registryValidPointer, autoRequirementDrift);
await proofArtifact("proof-auto-bad-implementation.json", "FIX-AUTO-001", truePointer, registryBadImplementationPointer, autoBadImplementation);
await proofArtifact("proof-auto-unknown-adapter.json", "FIX-AUTO-001", truePointer, registryUnknownAdapterPointer, autoUnknownAdapter);
await proofArtifact("proof-auto-tampered-registry.json", "FIX-AUTO-001", truePointer, registryTamperedPointer, autoTamperedRegistry);
await proofArtifact("proof-review-pass.json", "FIX-MANUAL-001", truePointer, registryValidPointer, reviewPass);
await proofArtifact("proof-review-missing-criterion.json", "FIX-MANUAL-001", truePointer, registryValidPointer, reviewMissingCriterion);
await proofArtifact("proof-review-claimant-signed.json", "FIX-MANUAL-001", truePointer, registryValidPointer, reviewClaimantSigned);
await proofArtifact("proof-review-weakened-criterion.json", "FIX-MANUAL-001", truePointer,
  registryWeakenedCriterionPointer, reviewWeakenedCriterion);
await proofArtifact("proof-review-outcome-only.json", "OUT-001", truePointer,
  registryValidPointer, reviewOutcomeOnly);
await proofArtifact("proof-review-evidence-only.json", "EVID-001", truePointer,
  registryValidPointer, reviewEvidenceOnly);
await proofArtifact("proof-legacy-self-status.json", "FIX-AUTO-001", truePointer, registryValidPointer, autoPass, { status: "pass" });

const sharedRegistryTrust = [{
  keyId: identities.registry.keyId,
  profileId: identities.registry.profileId,
  issuerId: identities.registry.actorId,
  trustDomain: identities.registry.trustDomain,
  publicKey: "noncircular-proof/keys/registry.pem"
}];
const sharedActorTrust = [
  {
    keyId: identities.automated.keyId,
    profileId: identities.automated.profileId,
    actorId: identities.automated.actorId,
    trustDomain: identities.automated.trustDomain,
    publicKey: "noncircular-proof/keys/automated.pem"
  },
  {
    keyId: identities.reviewer.keyId,
    profileId: identities.reviewer.profileId,
    actorId: identities.reviewer.actorId,
    trustDomain: identities.reviewer.trustDomain,
    publicKey: "noncircular-proof/keys/reviewer.pem"
  },
  {
    keyId: identities.claimant.keyId,
    profileId: identities.claimant.profileId,
    actorId: identities.claimant.actorId,
    trustDomain: identities.claimant.trustDomain,
    publicKey: "noncircular-proof/keys/claimant.pem"
  }
];
const common = {
  validationTime: "2026-08-01T00:10:00Z",
  proofAuthenticated: true,
  claimantKeyIds: [identities.claimant.keyId],
  claimantTrustDomains: [identities.claimant.trustDomain],
  claimantPublicKeys: ["noncircular-proof/keys/claimant.pem"],
  trust: { registryAuthorities: sharedRegistryTrust, actors: sharedActorTrust }
};
const vectors = {
  schemaVersion: "conformance-fixture-vector-set-1",
  id: "noncircular-conformance-proof-vectors",
  version: "0.1.0",
  purpose: "Schema and semantic proof results require authenticated automated replay; independent accountable review is accepted only for manual-governance requirements.",
  vectors: [
    { id: "automated-replay-positive", proof: "noncircular-proof/proof-auto-pass.json", expectedValid: true, ...common },
    { id: "accountable-review-positive", proof: "noncircular-proof/proof-review-pass.json", expectedValid: true, ...common },
    { id: "self-reported-pass-rejected", proof: "noncircular-proof/proof-auto-false-self-report.json", expectedValid: false, expectedError: "replayed result fail differs from recorded result pass", ...common },
    { id: "input-digest-mismatch-rejected", proof: "noncircular-proof/proof-auto-bad-input-digest.json", expectedValid: false, expectedError: "raw digest must be", ...common },
    { id: "requirement-semantics-drift-rejected", proof: "noncircular-proof/proof-auto-requirement-drift.json", expectedValid: false, expectedError: "registered requirement-entry digest must be", ...common },
    { id: "implementation-digest-mismatch-rejected", proof: "noncircular-proof/proof-auto-bad-implementation.json", expectedValid: false, expectedError: "verifier implementation: raw digest must be", ...common },
    { id: "uninstalled-adapter-rejected", proof: "noncircular-proof/proof-auto-unknown-adapter.json", expectedValid: false, expectedError: "is not installed in the validator allow-list", ...common },
    { id: "tampered-registry-rejected", proof: "noncircular-proof/proof-auto-tampered-registry.json", expectedValid: false, expectedError: "verifier registry: self digest must be", ...common },
    { id: "incomplete-review-rejected", proof: "noncircular-proof/proof-review-missing-criterion.json", expectedValid: false, expectedError: "criterion coverage", ...common },
    { id: "claimant-review-rejected", proof: "noncircular-proof/proof-review-claimant-signed.json", expectedValid: false, expectedError: "actor/key/trust-domain tuple is not uniquely authorized", ...common },
    { id: "weakened-review-criterion-rejected", proof: "noncircular-proof/proof-review-weakened-criterion.json", expectedValid: false, expectedError: "differs from the requirement-owned complete criterion", ...common },
    { id: "outcome-accountable-review-only-rejected", proof: "noncircular-proof/proof-review-outcome-only.json", expectedValid: false, expectedError: "method accountable_review is not permitted for OUT-001", ...common },
    { id: "evidence-accountable-review-only-rejected", proof: "noncircular-proof/proof-review-evidence-only.json", expectedValid: false, expectedError: "method accountable_review is not permitted for EVID-001", ...common },
    { id: "unauthenticated-proof-set-rejected", proof: "noncircular-proof/proof-auto-pass.json", expectedValid: false, expectedError: "proof-set bytes were not authenticated", ...common, proofAuthenticated: false },
    { id: "legacy-declared-status-rejected", proof: "noncircular-proof/proof-legacy-self-status.json", expectedValid: false, expectedError: "schema invalid", ...common }
  ]
};
await writeFile(path.join(root, "conformance", "fixtures", "noncircular-proof-vectors.json"),
  `${JSON.stringify(vectors, null, 2)}\n`);

process.stdout.write("Generated non-circular conformance-proof fixtures.\n");
