import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const toolPath = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(toolPath), "..");
const fixtureRoot = path.join(root, "conformance", "fixtures", "machine-contracts-v1");
const positive = path.join(fixtureRoot, "positive");
const negative = path.join(fixtureRoot, "negative");
const globalFixtures = path.join(root, "conformance", "fixtures");
const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

// Public deterministic conformance seeds. They are not operational secrets.
const identities = {
  root: {
    seed: "f5e5767cf153319517630f226876b86c8160cc583bc013744c6bf255f5cc0ee5",
    actor: { id: "fixture-evaluation-governance-root", role: "evaluation_governance_root", trustDomain: "external_governance" },
    profileId: "fixture-evaluation-governance-root-profile",
    keyId: "rfc8032-test-key-4-governance-root"
  },
  reviewer: {
    seed: "c5aa8df43f9f837bedb7442f31dcb7b166d38535076f094b85ce3a2e0b4458f7",
    actor: { id: "fixture-independent-validity-reviewer", role: "validity_reviewer", trustDomain: "independent_review" },
    profileId: "fixture-validity-review-profile",
    keyId: "rfc8032-test-key-3-validity-reviewer"
  },
  budget: {
    seed: "0f0e0d0c0b0a09080706050403020100112233445566778899aabbccddeeff00",
    actor: { id: "fixture-held-out-budget-authority", role: "held_out_budget_authority", trustDomain: "evaluation_governance" },
    profileId: "fixture-held-out-budget-profile",
    keyId: "fixture-held-out-budget-key"
  },
  custodian: {
    seed: "4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb",
    actor: { id: "fixture-held-out-ledger-custodian", role: "held_out_ledger_custodian", trustDomain: "independent_scheduler" },
    profileId: "fixture-held-out-ledger-checkpoint-profile",
    keyId: "rfc8032-test-key-2-ledger-custodian"
  },
  claimant: {
    seed: "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
    actor: { id: "suite-owner", role: "evaluation_claimant", trustDomain: "claimant" },
    profileId: "fixture-claimant-profile",
    keyId: "rfc8032-test-key-1-claimant"
  },
  claimantSecondary: {
    seed: "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20",
    actor: { id: "secondary-suite-owner", role: "evaluation_claimant", trustDomain: "secondary_claimant" },
    profileId: "fixture-secondary-claimant-profile",
    keyId: "fixture-secondary-claimant-key"
  }
};

function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
  return "{" + Object.keys(value).sort().map(function (key) {
    return JSON.stringify(key) + ":" + canonicalize(value[key]);
  }).join(",") + "}";
}

function sha256(bytes) {
  return "sha256:" + createHash("sha256").update(bytes).digest("hex");
}

function sha256Canonical(value) {
  return sha256(Buffer.from(canonicalize(value), "utf8"));
}

function privateKey(identity) {
  return createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, Buffer.from(identity.seed, "hex")]),
    format: "der",
    type: "pkcs8"
  });
}

function publicKey(identity) {
  const bytes = createPublicKey(privateKey(identity)).export({ format: "der", type: "spki" });
  return {
    format: "spki_der_base64",
    contentBase64: bytes.toString("base64"),
    digest: sha256(bytes)
  };
}

function keyIdentity(identity) {
  return {
    actor: identity.actor,
    profileId: identity.profileId,
    algorithm: "Ed25519",
    keyId: identity.keyId,
    publicKey: publicKey(identity)
  };
}

function seal(document, identity, signedAt) {
  const result = structuredClone(document);
  const digestProjection = structuredClone(result);
  delete digestProjection.digest;
  delete digestProjection.signature;
  result.digest = sha256Canonical(digestProjection);
  result.signature = {
    profileId: identity.profileId,
    algorithm: "Ed25519",
    keyId: identity.keyId,
    signedAt,
    value: "pending"
  };
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

async function writeFileWithRetry(absolute, bytes) {
  const retryable = new Set(["EBUSY", "EPERM", "UNKNOWN"]);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await writeFile(absolute, bytes);
      return;
    } catch (error) {
      if (!retryable.has(error?.code) || attempt === 7) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * (2 ** attempt)));
    }
  }
}

async function writeJson(absolute, value) {
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + "\n", "utf8");
  await writeFileWithRetry(absolute, bytes);
  return { absolute, bytes, digest: sha256(bytes), byteLength: bytes.length, document: value };
}

async function readJson(absolute) {
  return JSON.parse(await readFile(absolute, "utf8"));
}

async function material(absolute) {
  const bytes = await readFile(absolute);
  return { absolute, bytes, digest: sha256(bytes), byteLength: bytes.length };
}

function locator(ownerDirectory, target) {
  return {
    kind: "repository_relative",
    base: "binding_document",
    path: path.relative(ownerDirectory, target).replaceAll("\\", "/")
  };
}

function componentPointer(ownerDirectory, artifact, fields) {
  return {
    id: fields.id,
    version: "0.1.0",
    uri: "artifact:" + artifact.digest,
    digest: artifact.digest,
    byteLength: artifact.byteLength,
    mediaType: fields.mediaType,
    locator: locator(ownerDirectory, artifact.absolute),
    ...fields.extra
  };
}

function authorityIdentity(policyArtifact) {
  return {
    policyId: policyArtifact.document.id,
    policyVersion: policyArtifact.document.version,
    policyDigest: policyArtifact.digest
  };
}

function contractBinding(ownerDirectory, artifact, contractType, id, schemaId,
  verifierArtifact, resolutionArtifact, policyArtifact) {
  return {
    contractType,
    id,
    version: "0.1.0",
    schemaId,
    uri: "artifact:" + artifact.digest,
    digest: artifact.digest,
    byteLength: artifact.byteLength,
    mediaType: "application/json",
    locator: locator(ownerDirectory, artifact.absolute),
    verifier: componentPointer(ownerDirectory, verifierArtifact, {
      id: "machine-contract-focused-verifier",
      mediaType: "text/javascript",
      extra: { entrypoint: "verify-machine-contract-bindings-v1" }
    }),
    resolutionContract: componentPointer(ownerDirectory, resolutionArtifact, {
      id: "machine-contract-resolution-v1",
      mediaType: "application/json",
      extra: { schemaId: "agent-eval-machine-contract-resolution-1" }
    }),
    componentAuthority: authorityIdentity(policyArtifact)
  };
}

function policyBinding(ownerDirectory, policyArtifact) {
  return {
    contractType: "evaluation_control_authority_policy",
    id: policyArtifact.document.id,
    version: "0.1.0",
    schemaId: "urn:agent-evals-standard:schema:evaluation-control-authority-policy:1",
    uri: "artifact:" + policyArtifact.digest,
    digest: policyArtifact.digest,
    byteLength: policyArtifact.byteLength,
    mediaType: "application/json",
    locator: locator(ownerDirectory, policyArtifact.absolute)
  };
}

function authorityEvidence(base, parent, projection, identity, policyArtifact, issuedAt) {
  const document = structuredClone(base);
  document.subject.digest = sha256Canonical(projection);
  document.actor = identity.actor;
  document.issuedAt = issuedAt;
  document.authorityPolicy = {
    id: policyArtifact.document.id,
    version: "0.1.0",
    digest: policyArtifact.digest
  };
  return seal(document, identity, issuedAt);
}

function suitePrecontrolProjection(document) {
  const projection = structuredClone(document);
  delete projection.digest;
  delete projection.signature;
  delete projection.validityArgument;
  delete projection.evaluationThreatModel;
  delete projection.heldOutExposure;
  return projection;
}

function suiteValiditySubject(document) {
  return {
    id: document.id,
    artifactVersion: "0.1.0",
    schemaId: "urn:agent-evals-standard:schema:suite-manifest:1",
    projection: "suite_precontrol_projection_v1",
    digest: sha256Canonical(suitePrecontrolProjection(document))
  };
}

function stageDocumentPointer(ownerDirectory, artifact) {
  return {
    id: artifact.document.id,
    version: "0.1.0",
    uri: "artifact:" + artifact.digest,
    digest: artifact.digest,
    byteLength: artifact.byteLength,
    mediaType: "application/json",
    locator: locator(ownerDirectory, artifact.absolute),
    selfDigest: artifact.document.digest
  };
}

function materialStageSubject(ownerDirectory, artifact, schemaId) {
  return {
    id: artifact.document.id,
    artifactVersion: "0.1.0",
    schemaId,
    identityProjection: "full_signed_document",
    uri: "artifact:" + artifact.digest,
    digest: artifact.digest,
    byteLength: artifact.byteLength,
    mediaType: "application/json",
    locator: locator(ownerDirectory, artifact.absolute),
    selfDigest: artifact.document.digest
  };
}

function preRunProjection(document) {
  const projection = structuredClone(document);
  delete projection.evaluationControlBindings;
  delete projection.digest;
  delete projection.signature;
  return projection;
}

function preRunStageSubject(document) {
  return {
    id: document.id,
    artifactVersion: "0.1.0",
    schemaId: "urn:agent-evals-standard:schema:pre-run-manifest:1",
    identityProjection: "full_document_without_evaluation_control_bindings_digest_signature",
    digest: sha256Canonical(preRunProjection(document))
  };
}

function withoutEvidence(document, field, nested) {
  const projection = structuredClone(document);
  if (nested) delete projection[field][nested];
  else delete projection[field];
  return projection;
}

const verifierArtifact = await material(path.join(root, "tools", "verify-machine-contract-bindings.mjs"));
const resolutionArtifact = await material(path.join(positive, "resolution-contract.json"));
const claimantVerifierArtifact = await material(path.join(negative, "claimant-verifier.mjs"));
const claimantResolutionArtifact = await material(path.join(negative, "claimant-resolution-contract.json"));

const authorityPolicy = seal({
  schemaVersion: "agent-eval-evaluation-control-authority-policy-1",
  id: "fixture-evaluation-control-authority-policy",
  version: "0.1.0",
  issuer: identities.root.actor,
  validFrom: "2026-08-01T00:00:00Z",
  validUntil: "2027-08-01T00:00:00Z",
  claimantIdentities: {
    actorIds: [identities.claimant.actor.id],
    trustDomains: [identities.claimant.actor.trustDomain],
    keyIds: [identities.claimant.keyId],
    keys: [keyIdentity(identities.claimant)]
  },
  authorizations: [
    { purpose: "validity_review", ...keyIdentity(identities.reviewer) },
    { purpose: "held_out_budget_authorization", ...keyIdentity(identities.budget) },
    { purpose: "held_out_ledger_checkpoint", ...keyIdentity(identities.custodian) }
  ],
  components: [
    {
      componentKind: "verifier",
      id: "machine-contract-focused-verifier",
      version: "0.1.0",
      digest: verifierArtifact.digest,
      mediaType: "text/javascript",
      entrypoint: "verify-machine-contract-bindings-v1"
    },
    {
      componentKind: "resolution_contract",
      id: "machine-contract-resolution-v1",
      version: "0.1.0",
      digest: resolutionArtifact.digest,
      mediaType: "application/json",
      schemaId: "agent-eval-machine-contract-resolution-1"
    }
  ],
  ledgerLog: {
    logId: "fixture-held-out-ledger-log",
    checkpointRule: "externally_observed_monotonic_signed_head",
    rollbackEffect: "insufficient_evidence"
  }
}, identities.root, "2026-08-01T00:00:00Z");
const policyArtifact = await writeJson(path.join(positive, "authority-policy.json"), authorityPolicy);

const caseStageTemplate = await readJson(path.join(globalFixtures, "architecture-case-full.json"));
async function buildCaseStage(id, filename) {
  const document = structuredClone(caseStageTemplate);
  document.id = id;
  document.caseVersion = "0.1.0";
  delete document.evaluationControlBindings;
  delete document.digest;
  delete document.signature;
  return writeJson(path.join(positive, filename),
    seal(document, identities.claimant, "2026-08-01T01:02:00Z"));
}
const caseStageArtifacts = [
  await buildCaseStage("case-fixture-typed-1", "stage-case.json"),
  await buildCaseStage("case-fixture-typed-2", "stage-case-2.json")
];
const caseStageArtifact = caseStageArtifacts[0];
const caseIds = caseStageArtifacts.map(function (artifact) { return artifact.document.id; });

const suiteStageBase = await readJson(path.join(globalFixtures, "positive", "suite-manifest.json"));
suiteStageBase.id = "suite-fixture-typed-1";
suiteStageBase.version = "0.1.0";
delete suiteStageBase.evaluationControlBindings;
delete suiteStageBase.digest;
delete suiteStageBase.signature;
delete suiteStageBase.validityArgument;
delete suiteStageBase.evaluationThreatModel;
delete suiteStageBase.heldOutExposure;
function suiteCaseEntry(ownerDirectory, artifact) {
  const document = artifact.document;
  return {
    ...stageDocumentPointer(ownerDirectory, artifact),
    evaluationProfile: {
      id: document.evaluationProfile.id,
      version: document.evaluationProfile.version,
      digest: document.evaluationProfile.digest
    },
    effectiveProfileDigest: document.evaluationProfile.effectiveProfileDigest,
    outcomeProfile: document.outcomeProfile,
    capabilityFamilyIds: document.capabilityFamilyIds,
    workArtifactTypes: document.workArtifactTypes,
    memberships: document.memberships,
    lifecycle: document.lifecycle.status
  };
}
suiteStageBase.cases = caseStageArtifacts.map(function (artifact) {
  return suiteCaseEntry(positive, artifact);
});
for (const slice of suiteStageBase.slices) slice.caseIds = [...caseIds];
const selectedSuiteSliceId = suiteStageBase.slices[0].id;
const suiteValidityIdentity = suiteValiditySubject(suiteStageBase);

const preRunStageBase = await readJson(path.join(globalFixtures, "positive", "pre-run-manifest.json"));
preRunStageBase.id = "pre-run-fixture-typed-1";
preRunStageBase.version = "0.1.0";
preRunStageBase.evaluator.uri = "../../positive/evaluator-manifest.json";
const baselineArm = structuredClone(preRunStageBase.arms[0]);
baselineArm.id = "baseline-arm";
baselineArm.label = "Pinned repository agent baseline";
baselineArm.treatmentRole = "baseline";
baselineArm.identityDigest = sha256Canonical({ id: baselineArm.id, source: baselineArm.identityDigest });
const treatmentArm = structuredClone(preRunStageBase.arms[0]);
treatmentArm.id = "treatment-arm";
treatmentArm.label = "Pinned repository agent treatment";
treatmentArm.treatmentRole = "treatment";
treatmentArm.identityDigest = sha256Canonical({ id: treatmentArm.id, source: treatmentArm.identityDigest });
preRunStageBase.arms = [baselineArm, treatmentArm];
const pairedUnits = caseIds.map(function (caseId, caseIndex) {
  return {
    caseId,
    blockId: "block-" + (caseIndex + 1),
    repetitions: [1, 2].map(function (repetition) {
      return { repetition, seed: "seed-" + (caseIndex + 1) + "-" + repetition };
    })
  };
});
preRunStageBase.scheduledCells = pairedUnits.flatMap(function (unit) {
  return unit.repetitions.flatMap(function (entry) {
    return preRunStageBase.arms.map(function (arm) {
      return {
        cellId: "cell-" + unit.caseId + "-" + arm.id + "-" + entry.repetition,
        caseId: unit.caseId,
        armId: arm.id,
        repetition: entry.repetition,
        blockId: unit.blockId,
        seed: entry.seed
      };
    });
  });
});
const comparativeDigest = sha256Canonical({ caseIds, armIds: preRunStageBase.arms.map(function (arm) { return arm.id; }) });
const comparativeArtifact = function (id) {
  return { id, uri: "artifact:" + comparativeDigest, digest: comparativeDigest };
};
preRunStageBase.comparativeDesign = {
  id: "focused-paired-comparison",
  comparatorArmIds: preRunStageBase.arms.map(function (arm) { return arm.id; }),
  treatmentBundle: ["repository-agent-treatment"],
  treatmentBundleDigest: comparativeDigest,
  pairedUnits,
  randomizationOrOrdering: comparativeArtifact("focused-pair-randomization"),
  resetAndCarryoverRules: comparativeArtifact("focused-pair-reset-rules"),
  interferenceControls: comparativeArtifact("focused-pair-interference-controls"),
  sharedMeasurementIdentity: comparativeDigest,
  hypotheses: ["claim-repo-change-functional"],
  statisticalPlan: structuredClone(preRunStageBase.statisticalPlan)
};
preRunStageBase.caseProfiles = caseStageArtifacts.map(function (artifact) {
  const document = artifact.document;
  return {
    caseId: document.id,
    bindingUse: "claims_eligible",
    evaluationProfile: {
      id: document.evaluationProfile.id,
      version: document.evaluationProfile.version,
      digest: document.evaluationProfile.digest
    },
    effectiveProfileDigest: document.evaluationProfile.effectiveProfileDigest,
    outcomeProfile: document.outcomeProfile
  };
});

const riskAssessmentBase = await readJson(path.join(globalFixtures, "positive", "risk-assessment.json"));
riskAssessmentBase.scope.caseIds = [...caseIds];
riskAssessmentBase.scope.armIds = preRunStageBase.arms.map(function (arm) { return arm.id; });
riskAssessmentBase.scope.decisionEnvelopeId = preRunStageBase.decisionPlan.id;
delete riskAssessmentBase.digest;
delete riskAssessmentBase.signature;
const riskAssessmentArtifact = await writeJson(path.join(positive, "risk-assessment.json"),
  seal(riskAssessmentBase, identities.claimant, "2026-08-01T01:03:00Z"));

const validity = await readJson(path.join(positive, "validity-argument.json"));
validity.suite = suiteValidityIdentity;
validity.evidencePlan.referenceBaselines = [
  {
    id: "current-workflow-baseline",
    kind: "current_workflow",
    agentInvolvement: "present",
    conditions: "Same sealed cases, repository state, permissions, and stopping rule as the treatment arm.",
    resources: "The declared incumbent workflow budget and staffing envelope.",
    tools: "The incumbent workflow tool set identified by the sealed experiment.",
    scoring: "The same outcome profile, gates, and statistical scoring as the treatment arm."
  },
  {
    id: "deterministic-non-agent-control",
    kind: "deterministic_automation",
    agentInvolvement: "none",
    conditions: "Same sealed case inputs with no model or agent participation.",
    resources: "The deterministic control budget declared before execution.",
    tools: "Pinned deterministic repository checks only.",
    scoring: "The same applicable outcome predicates and gates as the treatment arm."
  }
];
validity.evidencePlan.incumbentDisposition = {
  status: "incumbent_available",
  baselineId: "current-workflow-baseline",
  rationale: "The declared current repository workflow is the operational alternative to the evaluated treatment.",
  evidenceReferences: ["current-workflow-inventory"]
};
validity.review.owner = identities.claimant.actor;
validity.review.independentReviewer = identities.reviewer.actor;
delete validity.review.evidence;
const reviewEvidence = authorityEvidence({
  schemaVersion: "agent-eval-evaluation-control-authority-evidence-1",
  id: "validity-review-evidence-v1",
  version: "0.1.0",
  evidenceKind: "validity_review",
  subject: {
    schemaId: "urn:agent-evals-standard:schema:validity-argument:1",
    id: validity.id,
    version: validity.version,
    projection: "full_document_without_review_evidence"
  },
  decision: "approved_for_declared_use"
}, validity, validity, identities.reviewer, policyArtifact, validity.review.reviewedAt);
const reviewArtifact = await writeJson(path.join(positive, "validity-review-evidence.json"), reviewEvidence);
validity.review.evidence = contractBinding(positive, reviewArtifact,
  "evaluation_control_authority_evidence", reviewEvidence.id,
  "urn:agent-evals-standard:schema:evaluation-control-authority-evidence:1",
  verifierArtifact, resolutionArtifact, policyArtifact);
const validityArtifact = await writeJson(path.join(positive, "validity-argument.json"), validity);

const budget = await readJson(path.join(positive, "held-out-exposure-budget.json"));
budget.suiteId = suiteValidityIdentity.id;
budget.scope.caseIds = [...caseIds];
budget.issuedAt = "2026-08-01T00:10:00Z";
budget.authorization = {
  decisionId: "held-out-budget-authorization-v1",
  authority: identities.budget.actor
};
const budgetEvidence = authorityEvidence({
  schemaVersion: "agent-eval-evaluation-control-authority-evidence-1",
  id: budget.authorization.decisionId,
  version: "0.1.0",
  evidenceKind: "held_out_budget_authorization",
  subject: {
    schemaId: "urn:agent-evals-standard:schema:held-out-exposure-budget:1",
    id: budget.id,
    version: budget.version,
    projection: "full_document_without_authorization_evidence"
  },
  decision: "authorized"
}, budget, budget, identities.budget, policyArtifact, "2026-08-01T00:05:00Z");
const budgetEvidenceArtifact = await writeJson(path.join(positive, "held-out-budget-authorization-evidence.json"), budgetEvidence);
budget.authorization.evidence = contractBinding(positive, budgetEvidenceArtifact,
  "evaluation_control_authority_evidence", budgetEvidence.id,
  "urn:agent-evals-standard:schema:evaluation-control-authority-evidence:1",
  verifierArtifact, resolutionArtifact, policyArtifact);
const budgetArtifact = await writeJson(path.join(positive, "held-out-exposure-budget.json"), budget);

const ledger = await readJson(path.join(positive, "held-out-exposure-ledger.json"));
ledger.budget = contractBinding(positive, budgetArtifact, "held_out_exposure_budget", budget.id,
  "urn:agent-evals-standard:schema:held-out-exposure-budget:1", verifierArtifact, resolutionArtifact, policyArtifact);
const genesisLedger = structuredClone(ledger);
genesisLedger.id = "held-out-exposure-ledger-genesis-v1";
genesisLedger.previousLedger = null;
genesisLedger.sequence = 0;
genesisLedger.events = [];
genesisLedger.totals = {
  agentVisibleCaseExposures: 0,
  unblindedOutcomeLooks: 0,
  oracleAccesses: 0
};
genesisLedger.remaining = structuredClone(budget.limits);
genesisLedger.saturated = false;
genesisLedger.sealedAt = "2026-08-01T00:40:00Z";
genesisLedger.checkpoint = { custodian: identities.custodian.actor };
const genesisCheckpointEvidence = authorityEvidence({
  schemaVersion: "agent-eval-evaluation-control-authority-evidence-1",
  id: "held-out-ledger-genesis-checkpoint-v1",
  version: "0.1.0",
  evidenceKind: "held_out_ledger_checkpoint",
  subject: {
    schemaId: "urn:agent-evals-standard:schema:held-out-exposure-ledger:1",
    id: genesisLedger.id,
    version: genesisLedger.version,
    projection: "full_document_without_checkpoint_evidence"
  },
  decision: "sealed",
  checkpoint: {
    ledgerSequence: 0,
    previousLedgerDigest: null,
    previousCheckpointDigest: null,
    logBinding: { logId: authorityPolicy.ledgerLog.logId, checkpointSequence: 0 }
  }
}, genesisLedger, genesisLedger, identities.custodian, policyArtifact, genesisLedger.sealedAt);
const genesisCheckpointArtifact = await writeJson(
  path.join(positive, "held-out-ledger-genesis-checkpoint-evidence.json"), genesisCheckpointEvidence);
genesisLedger.checkpoint.evidence = contractBinding(positive, genesisCheckpointArtifact,
  "evaluation_control_authority_evidence", genesisCheckpointEvidence.id,
  "urn:agent-evals-standard:schema:evaluation-control-authority-evidence:1",
  verifierArtifact, resolutionArtifact, policyArtifact);
const genesisLedgerArtifact = await writeJson(
  path.join(positive, "held-out-exposure-ledger-genesis.json"), genesisLedger);

ledger.previousLedger = contractBinding(positive, genesisLedgerArtifact,
  "held_out_exposure_ledger", genesisLedger.id,
  "urn:agent-evals-standard:schema:held-out-exposure-ledger:1",
  verifierArtifact, resolutionArtifact, policyArtifact);
ledger.events[0].authorizationId = budget.authorization.decisionId;
ledger.checkpoint = { custodian: identities.custodian.actor };
const checkpointEvidence = authorityEvidence({
  schemaVersion: "agent-eval-evaluation-control-authority-evidence-1",
  id: "held-out-ledger-checkpoint-v1",
  version: "0.1.0",
  evidenceKind: "held_out_ledger_checkpoint",
  subject: {
    schemaId: "urn:agent-evals-standard:schema:held-out-exposure-ledger:1",
    id: ledger.id,
    version: ledger.version,
    projection: "full_document_without_checkpoint_evidence"
  },
  decision: "sealed",
  checkpoint: {
    ledgerSequence: ledger.sequence,
    previousLedgerDigest: genesisLedgerArtifact.digest,
    previousCheckpointDigest: genesisCheckpointEvidence.digest,
    logBinding: { logId: authorityPolicy.ledgerLog.logId, checkpointSequence: 1 }
  }
}, ledger, ledger, identities.custodian, policyArtifact, ledger.sealedAt);
const checkpointArtifact = await writeJson(path.join(positive, "held-out-ledger-checkpoint-evidence.json"), checkpointEvidence);
ledger.checkpoint.evidence = contractBinding(positive, checkpointArtifact,
  "evaluation_control_authority_evidence", checkpointEvidence.id,
  "urn:agent-evals-standard:schema:evaluation-control-authority-evidence:1",
  verifierArtifact, resolutionArtifact, policyArtifact);
const ledgerArtifact = await writeJson(path.join(positive, "held-out-exposure-ledger.json"), ledger);

const threat = await readJson(path.join(positive, "evaluation-threat-model.json"));
threat.scope.suiteId = suiteValidityIdentity.id;
threat.scope.caseIds = [...caseIds];
threat.scope.evaluationProfileIds = [...new Set(caseStageArtifacts.map(function (artifact) {
  return artifact.document.evaluationProfile.id;
}))];
const threatArtifact = await writeJson(path.join(positive, "evaluation-threat-model.json"), threat);
const validityBinding = contractBinding(positive, validityArtifact, "validity_argument", validity.id,
  "urn:agent-evals-standard:schema:validity-argument:1", verifierArtifact, resolutionArtifact, policyArtifact);
const threatBinding = contractBinding(positive, threatArtifact, "evaluation_threat_model",
  "evaluation-threat-model-v1", "urn:agent-evals-standard:schema:evaluation-threat-model:1",
  verifierArtifact, resolutionArtifact, policyArtifact);
const ledgerBinding = contractBinding(positive, ledgerArtifact, "held_out_exposure_ledger", ledger.id,
  "urn:agent-evals-standard:schema:held-out-exposure-ledger:1", verifierArtifact, resolutionArtifact, policyArtifact);
const heldOutBinding = { budget: ledger.budget, ledger: ledgerBinding };

const statisticalPlanBase = await readJson(path.join(globalFixtures, "positive", "statistical-plan.json"));
statisticalPlanBase.id = "statistical-plan-fixture-typed-1";
statisticalPlanBase.version = "0.1.0";
statisticalPlanBase.heldOutExposureAndReuse = heldOutBinding;
for (const claim of statisticalPlanBase.claimContracts || []) {
  claim.caseIds = [...caseIds];
  claim.armIds = preRunStageBase.arms.map(function (arm) { return arm.id; });
  claim.eligibleCells = preRunStageBase.scheduledCells.map(function (cell) {
    return {
      cellId: cell.cellId,
      caseId: cell.caseId,
      armId: cell.armId,
      repetition: cell.repetition,
      blockId: cell.blockId,
      seed: cell.seed
    };
  });
}
delete statisticalPlanBase.digest;
delete statisticalPlanBase.signature;
const statisticalPlanArtifact = await writeJson(path.join(positive, "stage-statistical-plan.json"),
  seal(statisticalPlanBase, identities.claimant, "2026-08-01T01:04:00Z"));

const suiteStageDocument = structuredClone(suiteStageBase);
suiteStageDocument.validityArgument = validityBinding;
suiteStageDocument.evaluationThreatModel = threatBinding;
suiteStageDocument.heldOutExposure = heldOutBinding;
const suiteStageArtifact = await writeJson(path.join(positive, "stage-suite-manifest.json"),
  seal(suiteStageDocument, identities.claimant, "2026-08-01T01:01:00Z"));

delete preRunStageBase.evaluationControlBindings;
delete preRunStageBase.digest;
delete preRunStageBase.signature;
preRunStageBase.sealedAt = "2026-08-01T01:05:00Z";
preRunStageBase.suite = stageDocumentPointer(positive, suiteStageArtifact);
preRunStageBase.caseSet = caseStageArtifacts.map(function (artifact) {
  return stageDocumentPointer(positive, artifact);
});
preRunStageBase.statisticalPlan = {
  id: statisticalPlanArtifact.document.id,
  uri: "artifact:" + statisticalPlanArtifact.digest,
  digest: statisticalPlanArtifact.digest
};
preRunStageBase.comparativeDesign.statisticalPlan = structuredClone(preRunStageBase.statisticalPlan);
preRunStageBase.riskAssessment = {
  id: riskAssessmentArtifact.document.id,
  version: riskAssessmentArtifact.document.version,
  uri: "risk-assessment.json",
  digest: riskAssessmentArtifact.document.digest
};
preRunStageBase.effectiveRiskTier = riskAssessmentArtifact.document.effectiveRiskTier;
const preRunSubject = preRunStageSubject(preRunStageBase);

const controls = await readJson(path.join(positive, "control-bindings.json"));
const suiteMaterialSubject = materialStageSubject(positive, suiteStageArtifact,
  "urn:agent-evals-standard:schema:suite-manifest:1");
const caseMaterialSubjects = caseStageArtifacts.map(function (artifact) {
  return materialStageSubject(positive, artifact,
    "urn:agent-evals-standard:schema:case:1");
});
controls.suite = suiteMaterialSubject;
controls.suiteSliceId = selectedSuiteSliceId;
controls.cases = caseMaterialSubjects;
controls.authorityPolicy = policyBinding(positive, policyArtifact);
controls.validityArgument = validityBinding;
controls.evaluationThreatModel = threatBinding;
controls.heldOutExposure = heldOutBinding;
const scopeDigest = sha256Canonical({
  suiteSliceId: selectedSuiteSliceId,
  suite: {
    id: suiteMaterialSubject.id,
    digest: suiteMaterialSubject.digest,
    selfDigest: suiteMaterialSubject.selfDigest
  },
  cases: caseMaterialSubjects.map(function (subject) {
    return { id: subject.id, digest: subject.digest, selfDigest: subject.selfDigest };
  })
});
const suiteStageBinding = structuredClone(controls.stageBindings.find(function (entry) {
  return entry.stage === "suite";
}));
const caseStageBinding = structuredClone(controls.stageBindings.find(function (entry) {
  return entry.stage === "case";
}));
const preRunStageBinding = structuredClone(controls.stageBindings.find(function (entry) {
  return entry.stage === "pre_run";
}));
suiteStageBinding.subject = suiteMaterialSubject;
const caseStageBindings = caseMaterialSubjects.map(function (subject) {
  const binding = structuredClone(caseStageBinding);
  binding.subject = subject;
  return binding;
});
preRunStageBinding.subject = preRunSubject;
controls.stageBindings = [suiteStageBinding, ...caseStageBindings, preRunStageBinding];
for (const stage of controls.stageBindings) {
  stage.scopeDigest = scopeDigest;
}
const controlsArtifact = await writeJson(path.join(positive, "control-bindings.json"), controls);
const controlBinding = contractBinding(positive, controlsArtifact, "evaluation_control_bindings", controls.id,
  "urn:agent-evals-standard:schema:evaluation-control-bindings:1", verifierArtifact, resolutionArtifact, policyArtifact);
await writeJson(path.join(positive, "control-binding.json"), controlBinding);

const preRunStageDocument = structuredClone(preRunStageBase);
preRunStageDocument.evaluationControlBindings = controlBinding;
const preRunStageArtifact = await writeJson(path.join(positive, "stage-pre-run-manifest.json"),
  seal(preRunStageDocument, identities.claimant, "2026-08-01T01:05:00Z"));

async function buildScopeGraphVariant(name, mutation) {
  // Keep each negative graph at the same directory depth and with the same
  // filenames as the positive graph. Repository-relative bindings therefore
  // retain their signed meaning while every mutated document is re-sealed.
  const directory = path.join(fixtureRoot, "negative-" + name);
  await mkdir(directory, { recursive: true });
  const inheritedArtifacts = [
    "validity-argument.json",
    "evaluation-threat-model.json",
    "held-out-exposure-budget.json",
    "held-out-exposure-ledger.json",
    "held-out-exposure-ledger-genesis.json",
    "validity-review-evidence.json",
    "held-out-budget-authorization-evidence.json",
    "held-out-ledger-checkpoint-evidence.json",
    "held-out-ledger-genesis-checkpoint-evidence.json",
    "resolution-contract.json",
    "stage-suite-manifest.json",
    "stage-case.json",
    "stage-case-2.json"
  ];
  for (const filename of inheritedArtifacts) {
    await writeFileWithRetry(path.join(directory, filename), await readFile(path.join(positive, filename)));
  }
  const preRun = structuredClone(preRunStageBase);
  const statisticalPlan = structuredClone(statisticalPlanArtifact.document);
  const riskAssessment = structuredClone(riskAssessmentArtifact.document);
  const threatModel = structuredClone(threatArtifact.document);
  const suiteDocument = structuredClone(suiteStageArtifact.document);
  mutation({ preRun, statisticalPlan, riskAssessment, threatModel, suiteDocument });

  const localThreat = await writeJson(path.join(directory, "evaluation-threat-model.json"),
    threatModel);
  const localThreatBinding = contractBinding(directory, localThreat, "evaluation_threat_model",
    threatModel.id, "urn:agent-evals-standard:schema:evaluation-threat-model:1",
    verifierArtifact, resolutionArtifact, policyArtifact);
  suiteDocument.evaluationThreatModel = localThreatBinding;
  const localSuite = await writeJson(path.join(directory, "stage-suite-manifest.json"),
    seal(suiteDocument, identities.claimant, "2026-08-01T01:01:00Z"));

  const localStatisticalPlan = await writeJson(path.join(directory, "stage-statistical-plan.json"),
    seal(statisticalPlan, identities.claimant, "2026-08-01T01:04:00Z"));
  const localRiskAssessment = await writeJson(path.join(directory, "risk-assessment.json"),
    seal(riskAssessment, identities.claimant, "2026-08-01T01:03:00Z"));

  preRun.statisticalPlan = {
    id: localStatisticalPlan.document.id,
    uri: "artifact:" + localStatisticalPlan.digest,
    digest: localStatisticalPlan.digest
  };
  preRun.riskAssessment = {
    id: localRiskAssessment.document.id,
    version: localRiskAssessment.document.version,
    uri: "risk-assessment.json",
    digest: localRiskAssessment.document.digest
  };
  if (preRun.comparativeDesign) {
    preRun.comparativeDesign.statisticalPlan = structuredClone(preRun.statisticalPlan);
  }
  preRun.suite = stageDocumentPointer(directory, localSuite);

  const localControls = structuredClone(controls);
  localControls.authorityPolicy.locator.path = path.relative(directory,
    policyArtifact.absolute).replaceAll("\\", "/");
  localControls.evaluationThreatModel = localThreatBinding;
  localControls.suite = materialStageSubject(directory, localSuite,
    "urn:agent-evals-standard:schema:suite-manifest:1");
  localControls.stageBindings.find(function (entry) { return entry.stage === "suite"; }).subject
    = localControls.suite;
  localControls.stageBindings.find(function (entry) { return entry.stage === "pre_run"; }).subject
    = preRunStageSubject(preRun);
  const localScopeDigest = sha256Canonical({
    suiteSliceId: localControls.suiteSliceId,
    suite: {
      id: localControls.suite.id,
      digest: localControls.suite.digest,
      selfDigest: localControls.suite.selfDigest
    },
    cases: localControls.cases.map(function (subject) {
      return { id: subject.id, digest: subject.digest, selfDigest: subject.selfDigest };
    })
  });
  for (const stage of localControls.stageBindings) stage.scopeDigest = localScopeDigest;
  const localControlsArtifact = await writeJson(path.join(directory, "control-bindings.json"), localControls);
  const localControlBinding = contractBinding(directory, localControlsArtifact,
    "evaluation_control_bindings", localControls.id,
    "urn:agent-evals-standard:schema:evaluation-control-bindings:1",
    verifierArtifact, resolutionArtifact, policyArtifact);
  await writeJson(path.join(directory, "control-binding.json"), localControlBinding);

  preRun.evaluationControlBindings = localControlBinding;
  await writeJson(path.join(directory, "stage-pre-run-manifest.json"),
    seal(preRun, identities.claimant, "2026-08-01T01:05:00Z"));

  const relative = function (filename) {
    return path.relative(fixtureRoot, path.join(directory, filename)).replaceAll("\\", "/");
  };
  return {
    controlBinding: relative("control-binding.json"),
    controls: relative("control-bindings.json"),
    validity: relative("validity-argument.json"),
    threat: relative("evaluation-threat-model.json"),
    budget: relative("held-out-exposure-budget.json"),
    ledger: relative("held-out-exposure-ledger.json"),
    reviewEvidence: relative("validity-review-evidence.json"),
    budgetAuthorizationEvidence: relative("held-out-budget-authorization-evidence.json"),
    ledgerCheckpointEvidence: relative("held-out-ledger-checkpoint-evidence.json"),
    genesisLedger: relative("held-out-exposure-ledger-genesis.json"),
    genesisLedgerCheckpointEvidence: relative("held-out-ledger-genesis-checkpoint-evidence.json"),
    suiteStageDocument: relative("stage-suite-manifest.json"),
    caseStageDocuments: [relative("stage-case.json"), relative("stage-case-2.json")],
    statisticalPlan: relative("stage-statistical-plan.json"),
    riskAssessment: relative("risk-assessment.json"),
    preRunStageDocument: relative("stage-pre-run-manifest.json")
  };
}

async function buildPolicyVariant(name, mutation) {
  const policy = structuredClone(authorityPolicy);
  mutation(policy);
  const artifact = await writeJson(path.join(negative, name + ".json"),
    seal(policy, identities.root, authorityPolicy.validFrom));
  return {
    path: path.relative(fixtureRoot, artifact.absolute).replaceAll("\\", "/"),
    digest: artifact.digest,
    byteLength: artifact.byteLength
  };
}

function synchronizeClaimCells(statisticalPlan, preRun) {
  for (const claim of statisticalPlan.claimContracts || []) {
    claim.eligibleCells = preRun.scheduledCells.map(function (cell) {
      return {
        cellId: cell.cellId,
        caseId: cell.caseId,
        armId: cell.armId,
        repetition: cell.repetition,
        blockId: cell.blockId,
        seed: cell.seed
      };
    });
  }
}

const undeclaredArmGraph = await buildScopeGraphVariant("whole-chain-undeclared-arm",
  function ({ preRun, statisticalPlan }) {
    const undeclared = structuredClone(preRun.scheduledCells[0]);
    undeclared.cellId = "undeclared-arm-cell";
    undeclared.armId = "undeclared-arm";
    undeclared.repetition = 3;
    undeclared.seed = "undeclared-arm-seed";
    preRun.scheduledCells.push(undeclared);
    synchronizeClaimCells(statisticalPlan, preRun);
  });
const passengerArmGraph = await buildScopeGraphVariant("whole-chain-passenger-arm",
  function ({ preRun, statisticalPlan, riskAssessment }) {
    const passenger = structuredClone(preRun.arms[1]);
    passenger.id = "passenger-arm";
    passenger.label = "Unscheduled passenger arm";
    passenger.treatmentRole = "treatment";
    preRun.arms.push(passenger);
    preRun.comparativeDesign.comparatorArmIds.push(passenger.id);
    riskAssessment.scope.armIds = preRun.arms.map(function (arm) { return arm.id; });
    for (const claim of statisticalPlan.claimContracts) {
      claim.armIds = preRun.arms.map(function (arm) { return arm.id; });
    }
    synchronizeClaimCells(statisticalPlan, preRun);
  });
const duplicateCellIdGraph = await buildScopeGraphVariant("whole-chain-duplicate-cell-id",
  function ({ preRun, statisticalPlan }) {
    preRun.scheduledCells[1].cellId = preRun.scheduledCells[0].cellId;
    synchronizeClaimCells(statisticalPlan, preRun);
  });
const duplicateCellTupleGraph = await buildScopeGraphVariant("whole-chain-duplicate-cell-tuple",
  function ({ preRun, statisticalPlan }) {
    const source = preRun.scheduledCells[0];
    Object.assign(preRun.scheduledCells[1], {
      caseId: source.caseId,
      armId: source.armId,
      repetition: source.repetition,
      blockId: source.blockId,
      seed: source.seed
    });
    synchronizeClaimCells(statisticalPlan, preRun);
  });
const missingCellBlockGraph = await buildScopeGraphVariant("whole-chain-missing-cell-block",
  function ({ preRun, statisticalPlan }) {
    delete preRun.scheduledCells[0].blockId;
    synchronizeClaimCells(statisticalPlan, preRun);
  });
const missingCellSeedGraph = await buildScopeGraphVariant("whole-chain-missing-cell-seed",
  function ({ preRun, statisticalPlan }) {
    delete preRun.scheduledCells[0].seed;
    synchronizeClaimCells(statisticalPlan, preRun);
  });
const riskScopeGraph = await buildScopeGraphVariant("whole-chain-risk-scope",
  function ({ riskAssessment }) {
    riskAssessment.scope.armIds = ["undeclared-risk-arm"];
  });
const statisticalCaseScopeGraph = await buildScopeGraphVariant("whole-chain-statistical-case-scope",
  function ({ statisticalPlan }) {
    statisticalPlan.claimContracts[0].caseIds = ["undeclared-statistical-case"];
  });
const statisticalArmScopeGraph = await buildScopeGraphVariant("whole-chain-statistical-arm-scope",
  function ({ statisticalPlan }) {
    statisticalPlan.claimContracts[0].armIds = ["undeclared-statistical-arm"];
  });
const missingComparativeDesignGraph = await buildScopeGraphVariant("whole-chain-missing-comparative-design",
  function ({ preRun }) {
    preRun.comparativeDesign = null;
  });

const missingCaseGraph = await buildScopeGraphVariant("whole-chain-missing-case",
  function ({ preRun }) {
    preRun.caseSet.splice(1, 1);
  });
const extraCaseGraph = await buildScopeGraphVariant("whole-chain-extra-case",
  function ({ riskAssessment }) {
    riskAssessment.scope.caseIds.push("extra-case");
  });
const duplicateCaseGraph = await buildScopeGraphVariant("whole-chain-duplicate-case",
  function ({ preRun }) {
    const duplicate = structuredClone(preRun.caseProfiles[1]);
    duplicate.effectiveProfileDigest
      = "sha256:1111111111111111111111111111111111111111111111111111111111111111";
    preRun.caseProfiles.push(duplicate);
  });
const reorderedCaseGraph = await buildScopeGraphVariant("whole-chain-reordered-case",
  function ({ threatModel }) {
    threatModel.scope.caseIds.reverse();
  });
const substitutedCaseGraph = await buildScopeGraphVariant("whole-chain-substituted-case",
  function ({ preRun }) {
    const substituted = structuredClone(preRun.caseSet[0]);
    substituted.id = preRun.caseSet[1].id;
    preRun.caseSet[1] = substituted;
  });
const passengerCaseGraph = await buildScopeGraphVariant("whole-chain-passenger-case",
  function ({ statisticalPlan }) {
    statisticalPlan.claimContracts[0].caseIds.push("passenger-case");
  });
const perCaseProfileMismatchGraph = await buildScopeGraphVariant("whole-chain-per-case-profile-mismatch",
  function ({ preRun }) {
    preRun.caseProfiles[1].effectiveProfileDigest
      = "sha256:2222222222222222222222222222222222222222222222222222222222222222";
  });

const splitArmPairingGraph = await buildScopeGraphVariant("whole-chain-split-arm-pairing",
  function ({ preRun, statisticalPlan }) {
    const firstCaseId = preRun.caseSet[0].id;
    const baselineId = preRun.arms[0].id;
    preRun.scheduledCells = preRun.scheduledCells.filter(function (cell) {
      return cell.caseId === firstCaseId ? cell.armId === baselineId : cell.armId !== baselineId;
    });
    synchronizeClaimCells(statisticalPlan, preRun);
  });
const missingPairedArmGraph = await buildScopeGraphVariant("whole-chain-missing-paired-arm",
  function ({ preRun, statisticalPlan }) {
    preRun.scheduledCells.splice(1, 1);
    synchronizeClaimCells(statisticalPlan, preRun);
  });
const missingPairedRepetitionGraph = await buildScopeGraphVariant("whole-chain-missing-paired-repetition",
  function ({ preRun, statisticalPlan }) {
    const firstCaseId = preRun.caseSet[0].id;
    preRun.scheduledCells = preRun.scheduledCells.filter(function (cell) {
      return !(cell.caseId === firstCaseId && cell.repetition === 2);
    });
    synchronizeClaimCells(statisticalPlan, preRun);
  });
const asymmetricPairSeedGraph = await buildScopeGraphVariant("whole-chain-asymmetric-pair-seed",
  function ({ preRun, statisticalPlan }) {
    preRun.scheduledCells[1].seed = "asymmetric-seed";
    synchronizeClaimCells(statisticalPlan, preRun);
  });
const asymmetricPairBlockGraph = await buildScopeGraphVariant("whole-chain-asymmetric-pair-block",
  function ({ preRun, statisticalPlan }) {
    preRun.scheduledCells[1].blockId = "asymmetric-block";
    synchronizeClaimCells(statisticalPlan, preRun);
  });
const claimCellSubsetGraph = await buildScopeGraphVariant("whole-chain-claim-cell-subset",
  function ({ statisticalPlan }) {
    statisticalPlan.claimContracts[0].eligibleCells.pop();
  });
const claimCellSupersetGraph = await buildScopeGraphVariant("whole-chain-claim-cell-superset",
  function ({ statisticalPlan }) {
    const passenger = structuredClone(statisticalPlan.claimContracts[0].eligibleCells.at(-1));
    passenger.cellId = "passenger-claim-cell";
    statisticalPlan.claimContracts[0].eligibleCells.push(passenger);
  });

const claimantArrayDivergencePolicy = await buildPolicyVariant("policy-claimant-array-divergence",
  function (policy) {
    policy.claimantIdentities.actorIds.push("undeclared-claimant-summary-entry");
    policy.claimantIdentities.actorIds.sort();
  });
const claimantOmittedKeyPolicy = await buildPolicyVariant("policy-claimant-omitted-key",
  function (policy) {
    const secondaryKey = keyIdentity(identities.claimantSecondary);
    secondaryKey.actor = structuredClone(identities.claimant.actor);
    policy.claimantIdentities.keys.push(secondaryKey);
  });
const claimantRoleAuthorizationPolicy = await buildPolicyVariant("policy-claimant-role-authorization",
  function (policy) {
    policy.authorizations[0].actor.role = identities.claimant.actor.role;
  });
const claimantDuplicateKeyAuthorizationPolicy = await buildPolicyVariant("policy-claimant-duplicate-key-authorization",
  function (policy) {
    policy.authorizations[0].keyId = identities.claimant.keyId;
  });

const forgedValidity = structuredClone(validity);
forgedValidity.review.independentReviewer = identities.claimant.actor;
delete forgedValidity.review.evidence;
const forgedReviewEvidence = authorityEvidence({
  schemaVersion: "agent-eval-evaluation-control-authority-evidence-1",
  id: "forged-validity-review-evidence-v1",
  version: "0.1.0",
  evidenceKind: "validity_review",
  subject: {
    schemaId: "urn:agent-evals-standard:schema:validity-argument:1",
    id: forgedValidity.id,
    version: forgedValidity.version,
    projection: "full_document_without_review_evidence"
  },
  decision: "approved_for_declared_use"
}, forgedValidity, forgedValidity, identities.claimant, policyArtifact, validity.review.reviewedAt);
const forgedReviewArtifact = await writeJson(path.join(negative, "forged-validity-review-evidence.json"), forgedReviewEvidence);
const forgedReviewBinding = contractBinding(positive, forgedReviewArtifact,
  "evaluation_control_authority_evidence", forgedReviewEvidence.id,
  "urn:agent-evals-standard:schema:evaluation-control-authority-evidence:1",
  verifierArtifact, resolutionArtifact, policyArtifact);

const forgedBudget = structuredClone(budget);
forgedBudget.authorization.authority = identities.claimant.actor;
delete forgedBudget.authorization.evidence;
const forgedBudgetEvidence = authorityEvidence({
  schemaVersion: "agent-eval-evaluation-control-authority-evidence-1",
  id: "forged-held-out-budget-authorization-v1",
  version: "0.1.0",
  evidenceKind: "held_out_budget_authorization",
  subject: {
    schemaId: "urn:agent-evals-standard:schema:held-out-exposure-budget:1",
    id: forgedBudget.id,
    version: forgedBudget.version,
    projection: "full_document_without_authorization_evidence"
  },
  decision: "authorized"
}, forgedBudget, forgedBudget, identities.claimant, policyArtifact, "2026-08-01T00:05:00Z");
const forgedBudgetArtifact = await writeJson(path.join(negative, "forged-held-out-budget-authorization-evidence.json"), forgedBudgetEvidence);
const forgedBudgetBinding = contractBinding(positive, forgedBudgetArtifact,
  "evaluation_control_authority_evidence", forgedBudgetEvidence.id,
  "urn:agent-evals-standard:schema:evaluation-control-authority-evidence:1",
  verifierArtifact, resolutionArtifact, policyArtifact);

const forgedLedger = structuredClone(ledger);
forgedLedger.checkpoint.custodian = identities.claimant.actor;
delete forgedLedger.checkpoint.evidence;
const forgedCheckpointEvidence = authorityEvidence({
  schemaVersion: "agent-eval-evaluation-control-authority-evidence-1",
  id: "forged-held-out-ledger-checkpoint-v1",
  version: "0.1.0",
  evidenceKind: "held_out_ledger_checkpoint",
  subject: {
    schemaId: "urn:agent-evals-standard:schema:held-out-exposure-ledger:1",
    id: forgedLedger.id,
    version: forgedLedger.version,
    projection: "full_document_without_checkpoint_evidence"
  },
  decision: "sealed",
  checkpoint: checkpointEvidence.checkpoint
}, forgedLedger, forgedLedger, identities.claimant, policyArtifact, ledger.sealedAt);
const forgedCheckpointArtifact = await writeJson(path.join(negative, "forged-held-out-ledger-checkpoint-evidence.json"), forgedCheckpointEvidence);
const forgedCheckpointBinding = contractBinding(positive, forgedCheckpointArtifact,
  "evaluation_control_authority_evidence", forgedCheckpointEvidence.id,
  "urn:agent-evals-standard:schema:evaluation-control-authority-evidence:1",
  verifierArtifact, resolutionArtifact, policyArtifact);

const claimantVerifier = componentPointer(positive, claimantVerifierArtifact, {
  id: "claimant-selected-verifier",
  mediaType: "text/javascript",
  extra: { entrypoint: "claimantSelectedVerifier" }
});
const claimantResolution = componentPointer(positive, claimantResolutionArtifact, {
  id: "claimant-selected-resolution",
  mediaType: "application/json",
  extra: { schemaId: "agent-eval-machine-contract-resolution-1" }
});

const vectors = await readJson(path.join(fixtureRoot, "vectors.json"));
for (const expectation of vectors.expectations) {
  if (expectation.id === "reject-missing-case-stage") {
    expectation.expectedError
      = "stage bindings must contain suite, every canonical case, pre_run in canonical order";
  }
  if (expectation.id === "reject-unavailable-pre-run-ledger-sequence"
    || expectation.id === "reject-pre-run-before-ledger-seal") {
    for (const mutation of expectation.mutations || []) {
      mutation.pointer = mutation.pointer.replace("/stageBindings/2", "/stageBindings/3");
    }
  }
}
vectors.artifacts = {
  ...vectors.artifacts,
  authorityPolicy: "positive/authority-policy.json",
  reviewEvidence: "positive/validity-review-evidence.json",
  budgetAuthorizationEvidence: "positive/held-out-budget-authorization-evidence.json",
  ledgerCheckpointEvidence: "positive/held-out-ledger-checkpoint-evidence.json",
  genesisLedger: "positive/held-out-exposure-ledger-genesis.json",
  genesisLedgerCheckpointEvidence: "positive/held-out-ledger-genesis-checkpoint-evidence.json",
  suiteStageDocument: "positive/stage-suite-manifest.json",
  caseStageDocuments: ["positive/stage-case.json", "positive/stage-case-2.json"],
  statisticalPlan: "positive/stage-statistical-plan.json",
  riskAssessment: "positive/risk-assessment.json",
  preRunStageDocument: "positive/stage-pre-run-manifest.json",
  forgedReviewEvidence: "negative/forged-validity-review-evidence.json",
  forgedBudgetEvidence: "negative/forged-held-out-budget-authorization-evidence.json",
  forgedCheckpointEvidence: "negative/forged-held-out-ledger-checkpoint-evidence.json"
};
delete vectors.artifacts.caseStageDocument;
vectors.trustContext = {
  verificationTime: "2026-08-01T01:10:00Z",
  policy: {
    path: "positive/authority-policy.json",
    digest: policyArtifact.digest,
    byteLength: policyArtifact.byteLength
  },
  policyIssuer: {
    ...identities.root.actor,
    profileId: identities.root.profileId,
    keyId: identities.root.keyId,
    publicKey: publicKey(identities.root)
  },
  expectedLedgerHead: {
    logId: authorityPolicy.ledgerLog.logId,
    checkpointSequence: 1,
    checkpointDigest: checkpointEvidence.digest
  }
};
const additions = [
  {
    id: "reject-validity-no-incumbent-without-no-action",
    valid: false,
    expectedError: "no-incumbent study must include a base-state/no-action baseline",
    mutations: [
      { target: "validity", pointer: "/evidencePlan/incumbentDisposition/status", value: "no_incumbent_exists" },
      { target: "validity", pointer: "/evidencePlan/incumbentDisposition/baselineId", value: null }
    ]
  },
  {
    id: "reject-validity-incumbent-without-distinct-non-agent-control",
    valid: false,
    expectedError: "incumbent study must include a distinct non-agent control baseline",
    mutations: [
      { target: "validity", pointer: "/evidencePlan/referenceBaselines/1/agentInvolvement", value: "present" }
    ]
  },
  {
    id: "reject-whole-chain-undeclared-arm",
    valid: false,
    expectedError: "pre-run scheduled arm IDs must exactly match the sealed scope",
    graphArtifacts: undeclaredArmGraph
  },
  {
    id: "reject-whole-chain-passenger-arm",
    valid: false,
    expectedError: "pre-run scheduled arm IDs must exactly match the sealed scope",
    graphArtifacts: passengerArmGraph
  },
  {
    id: "reject-whole-chain-duplicate-cell-id",
    valid: false,
    expectedError: "pre-run scheduled cell IDs must be unique",
    graphArtifacts: duplicateCellIdGraph
  },
  {
    id: "reject-whole-chain-duplicate-cell-tuple",
    valid: false,
    expectedError: "pre-run scheduled case/arm/repetition tuples must be unique",
    graphArtifacts: duplicateCellTupleGraph
  },
  {
    id: "reject-whole-chain-missing-cell-block",
    valid: false,
    expectedError: "pre-run scheduled cell cell-case-fixture-typed-1-baseline-arm-1 must declare both blockId and seed",
    graphArtifacts: missingCellBlockGraph
  },
  {
    id: "reject-whole-chain-missing-cell-seed",
    valid: false,
    expectedError: "pre-run scheduled cell cell-case-fixture-typed-1-baseline-arm-1 must declare both blockId and seed",
    graphArtifacts: missingCellSeedGraph
  },
  {
    id: "reject-whole-chain-risk-scope",
    valid: false,
    expectedError: "risk-assessment arm IDs must exactly match the sealed scope",
    graphArtifacts: riskScopeGraph
  },
  {
    id: "reject-whole-chain-statistical-case-scope",
    valid: false,
    expectedError: "statistical-plan claim claim-repo-change-functional case IDs must exactly match the canonical ordered case scope",
    graphArtifacts: statisticalCaseScopeGraph
  },
  {
    id: "reject-whole-chain-statistical-arm-scope",
    valid: false,
    expectedError: "statistical-plan claim claim-repo-change-functional arm IDs must exactly match the sealed scope",
    graphArtifacts: statisticalArmScopeGraph
  },
  {
    id: "reject-whole-chain-missing-comparative-design",
    valid: false,
    expectedError: "pre-run without comparativeDesign must contain exactly one single arm",
    graphArtifacts: missingComparativeDesignGraph
  },
  {
    id: "reject-whole-chain-missing-case",
    valid: false,
    expectedError: "pre-run caseSet case IDs must exactly match the canonical ordered case scope",
    graphArtifacts: missingCaseGraph
  },
  {
    id: "reject-whole-chain-extra-case",
    valid: false,
    expectedError: "risk-assessment case IDs must exactly match the canonical ordered case scope",
    graphArtifacts: extraCaseGraph
  },
  {
    id: "reject-whole-chain-duplicate-case",
    valid: false,
    expectedError: "pre-run caseProfiles case IDs must exactly match the canonical ordered case scope",
    graphArtifacts: duplicateCaseGraph
  },
  {
    id: "reject-whole-chain-reordered-case",
    valid: false,
    expectedError: "evaluation threat-model case IDs must exactly match the canonical ordered case scope",
    graphArtifacts: reorderedCaseGraph
  },
  {
    id: "reject-whole-chain-substituted-case",
    valid: false,
    expectedError: "pre-run caseSet contains a substituted material case document",
    graphArtifacts: substitutedCaseGraph
  },
  {
    id: "reject-whole-chain-passenger-case",
    valid: false,
    expectedError: "statistical-plan claim claim-repo-change-functional case IDs must exactly match the canonical ordered case scope",
    graphArtifacts: passengerCaseGraph
  },
  {
    id: "reject-whole-chain-per-case-profile-mismatch",
    valid: false,
    expectedError: "pre-run per-case profile binding differs from its material case",
    graphArtifacts: perCaseProfileMismatchGraph
  },
  {
    id: "reject-whole-chain-split-arm-pairing",
    valid: false,
    expectedError: "comparative paired-cell matrix must contain exactly one canonical cell per comparator arm and paired tuple",
    graphArtifacts: splitArmPairingGraph
  },
  {
    id: "reject-whole-chain-missing-paired-arm",
    valid: false,
    expectedError: "comparative paired-cell matrix must contain exactly one canonical cell per comparator arm and paired tuple",
    graphArtifacts: missingPairedArmGraph
  },
  {
    id: "reject-whole-chain-missing-paired-repetition",
    valid: false,
    expectedError: "comparative paired-cell matrix must contain exactly one canonical cell per comparator arm and paired tuple",
    graphArtifacts: missingPairedRepetitionGraph
  },
  {
    id: "reject-whole-chain-asymmetric-pair-seed",
    valid: false,
    expectedError: "comparative paired-cell matrix must contain exactly one canonical cell per comparator arm and paired tuple",
    graphArtifacts: asymmetricPairSeedGraph
  },
  {
    id: "reject-whole-chain-asymmetric-pair-block",
    valid: false,
    expectedError: "comparative paired-cell matrix must contain exactly one canonical cell per comparator arm and paired tuple",
    graphArtifacts: asymmetricPairBlockGraph
  },
  {
    id: "reject-whole-chain-claim-cell-subset",
    valid: false,
    expectedError: "eligible cells must exactly match the canonical scheduled-cell tuple commitment",
    graphArtifacts: claimCellSubsetGraph
  },
  {
    id: "reject-whole-chain-claim-cell-superset",
    valid: false,
    expectedError: "eligible cells must exactly match the canonical scheduled-cell tuple commitment",
    graphArtifacts: claimCellSupersetGraph
  },
  {
    id: "reject-policy-claimant-array-divergence",
    valid: false,
    expectedError: "authority policy claimant actorIds must be the exact sorted projection",
    authorityPolicy: claimantArrayDivergencePolicy
  },
  {
    id: "reject-policy-claimant-omitted-key",
    valid: false,
    expectedError: "authority policy claimant keyIds must be the exact sorted projection",
    authorityPolicy: claimantOmittedKeyPolicy
  },
  {
    id: "reject-policy-claimant-role-authorization",
    valid: false,
    expectedError: "authority policy authorization validity_review overlaps claimant identity by roles",
    authorityPolicy: claimantRoleAuthorizationPolicy
  },
  {
    id: "reject-policy-claimant-duplicate-key-authorization",
    valid: false,
    expectedError: "authority policy authorization validity_review overlaps claimant identity by keyIds",
    authorityPolicy: claimantDuplicateKeyAuthorizationPolicy
  },
  {
    id: "reject-claimant-selected-verifier-authority",
    valid: false,
    expectedError: "validity verifier is not authorized by the externally rooted evaluation-control authority policy",
    mutations: [{ target: "controls", pointer: "/validityArgument/verifier", value: claimantVerifier }]
  },
  {
    id: "reject-claimant-selected-resolution-authority",
    valid: false,
    expectedError: "validity resolution contract is not authorized by the externally rooted evaluation-control authority policy",
    mutations: [{ target: "controls", pointer: "/validityArgument/resolutionContract", value: claimantResolution }]
  },
  {
    id: "reject-forged-validity-reviewer",
    valid: false,
    expectedError: "validity review evidence is signed by claimant-controlled authority",
    mutations: [
      { target: "validity", pointer: "/review/independentReviewer", value: identities.claimant.actor },
      { target: "validity", pointer: "/review/evidence", value: forgedReviewBinding },
      { target: "reviewEvidence", replaceWithArtifact: "forgedReviewEvidence" }
    ]
  },
  {
    id: "reject-forged-budget-authorization",
    valid: false,
    expectedError: "held-out budget authorization evidence is signed by claimant-controlled authority",
    mutations: [
      { target: "budget", pointer: "/authorization/authority", value: identities.claimant.actor },
      { target: "budget", pointer: "/authorization/evidence", value: forgedBudgetBinding },
      { target: "budgetAuthorizationEvidence", replaceWithArtifact: "forgedBudgetEvidence" }
    ]
  },
  {
    id: "reject-claimant-ledger-checkpoint",
    valid: false,
    expectedError: "held-out ledger checkpoint evidence is signed by claimant-controlled authority",
    mutations: [
      { target: "ledger", pointer: "/checkpoint/custodian", value: identities.claimant.actor },
      { target: "ledger", pointer: "/checkpoint/evidence", value: forgedCheckpointBinding },
      { target: "ledgerCheckpointEvidence", replaceWithArtifact: "forgedCheckpointEvidence" }
    ]
  },
  {
    id: "reject-ledger-checkpoint-rollback",
    valid: false,
    expectedError: "ledger checkpoint does not match the externally observed monotonic log head",
    mutations: [{ target: "ledgerCheckpointEvidence", pointer: "/checkpoint/logBinding/checkpointSequence", value: 0 }]
  },
  {
    id: "reject-stage-subject-self-echo-digest",
    valid: false,
    expectedError: "case stage subject illegally self-echoes a full-document canonical digest",
    mutations: [{
      target: "controls",
      pointer: "/stageBindings/1/subject/digest",
      value: sha256Canonical(caseStageArtifact.document)
    }]
  },
  {
    id: "reject-statistical-plan-held-out-substitution",
    valid: false,
    expectedError: "statistical plan held-out controls differ from the authoritative control bundle",
    mutations: [{
      target: "stageDocuments",
      pointer: "/statisticalPlan/heldOutExposureAndReuse/budget/digest",
      value: "sha256:0000000000000000000000000000000000000000000000000000000000000000"
    }]
  },
  {
    id: "reject-pre-run-statistical-plan-substitution",
    valid: false,
    expectedError: "pre-run statistical-plan pointer does not resolve the material statistical plan",
    mutations: [{
      target: "stageDocuments",
      pointer: "/preRun/statisticalPlan/digest",
      value: "sha256:0000000000000000000000000000000000000000000000000000000000000000"
    }]
  },
  {
    id: "reject-repo-change-assurance-only-stage-case",
    valid: false,
    expectedError: "repo-change stage case case-fixture-typed-1: CAP.VERIFY_ASSURE requires CAP.IMPLEMENT_CHANGE",
    mutations: [
      {
        target: "stageDocuments",
        pointer: "/cases/0/capabilityFamilyIds",
        value: ["CAP.VERIFY_ASSURE"]
      },
      {
        target: "stageDocuments",
        pointer: "/cases/0/workArtifactTypes",
        value: ["assurance_report"]
      }
    ]
  },
  {
    id: "reject-repo-change-assurance-only-selected-slice",
    valid: false,
    expectedError: "selected repo-change suite slice case case-fixture-typed-1: CAP.VERIFY_ASSURE requires CAP.IMPLEMENT_CHANGE",
    mutations: [
      {
        target: "stageDocuments",
        pointer: "/suite/cases/0/capabilityFamilyIds",
        value: ["CAP.VERIFY_ASSURE"]
      },
      {
        target: "stageDocuments",
        pointer: "/suite/cases/0/workArtifactTypes",
        value: ["assurance_report"]
      }
    ]
  }
];
const additionIds = new Set(additions.map(function (entry) { return entry.id; }));
vectors.expectations = vectors.expectations.filter(function (entry) { return !additionIds.has(entry.id); }).concat(additions);
await writeJson(path.join(fixtureRoot, "vectors.json"), vectors);

process.stdout.write("Generated externally rooted machine-contract fixtures.\n");
