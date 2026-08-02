import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify
} from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  distributionRequirementMappingResolver,
  validateRequirementImplementationRouting
} from "../../tools/verify-profile-requirement-mapping.mjs";

const profileDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(profileDirectory, "../..");
const fixtureDirectory = path.join(repositoryRoot, "conformance", "fixtures", "repository-review-v1");
const verifierPath = fileURLToPath(import.meta.url);
const fixtureSeed = Buffer.from(
  "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
  "hex"
);
const fixturePkcs8Prefix = Buffer.from("302e020100300506032b657004220420", "hex");

function clone(value) {
  return structuredClone(value);
}

function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
  return "{" + Object.keys(value).sort().map(function (key) {
    return JSON.stringify(key) + ":" + canonicalize(value[key]);
  }).join(",") + "}";
}

function same(left, right) {
  return canonicalize(left) === canonicalize(right);
}

function sha256(buffer) {
  return "sha256:" + createHash("sha256").update(buffer).digest("hex");
}

function sha256Canonical(value) {
  return sha256(Buffer.from(canonicalize(value), "utf8"));
}

async function readJson(absolute) {
  return JSON.parse(await readFile(absolute, "utf8"));
}

async function rawDigest(absolute) {
  return sha256(await readFile(absolute));
}

function fixturePrivateKey() {
  return createPrivateKey({
    key: Buffer.concat([fixturePkcs8Prefix, fixtureSeed]),
    format: "der",
    type: "pkcs8"
  });
}

const publicKeyPath = path.join(repositoryRoot, "conformance", "fixtures", "keys", "rfc8032-test-key-1.pem");
const publicKey = createPublicKey(await readFile(publicKeyPath, "utf8"));

function signedMessage(document) {
  const projection = clone(document);
  delete projection.signature.value;
  return Buffer.concat([
    Buffer.from(document.schemaVersion, "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalize(projection), "utf8")
  ]);
}

function evidenceMessage(document) {
  const projection = clone(document);
  delete projection.attestation.value;
  return Buffer.concat([
    Buffer.from("agent-evals-evidence-artifact-1", "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalize(projection), "utf8")
  ]);
}

function fixtureSignatureShape(signature) {
  return signature
    && signature.profileId === "fixture-signature-profile"
    && signature.algorithm === "Ed25519"
    && signature.keyId === "rfc8032-test-key-1";
}

function checkSignedArtifact(document, label, issues) {
  const digestProjection = clone(document);
  delete digestProjection.digest;
  delete digestProjection.signature;
  const expectedDigest = sha256Canonical(digestProjection);
  if (document.digest !== expectedDigest) {
    issues.push(label + " self-digest mismatch");
  }
  let valid = false;
  try {
    valid = fixtureSignatureShape(document.signature)
      && verify(null, signedMessage(document), publicKey, Buffer.from(document.signature.value, "base64url"));
  } catch {
    valid = false;
  }
  if (!valid) issues.push(label + " signature invalid");
}

function checkSelfDigest(document, label, issues) {
  const projection = clone(document);
  delete projection.digest;
  if (document.digest !== sha256Canonical(projection)) {
    issues.push(label + " self-digest mismatch");
  }
}

function checkAttestation(document, label, issues) {
  let valid = false;
  try {
    valid = fixtureSignatureShape(document.attestation)
      && verify(null, evidenceMessage(document), publicKey, Buffer.from(document.attestation.value, "base64url"));
  } catch {
    valid = false;
  }
  if (!valid) issues.push(label + " attestation invalid");
}

function attestFixtureEvidence(document) {
  document.attestation.value = sign(null, evidenceMessage(document), fixturePrivateKey()).toString("base64url");
  return document;
}

const schemaPaths = [
  "schemas/signature-profile.schema.json",
  "schemas/work-artifact-registry.schema.json",
  "schemas/evidence-artifact.schema.json",
  "schemas/evaluation-profile.schema.json",
  "schemas/requirement-implementation-contract.schema.json",
  "schemas/outcome-profile.schema.json",
  "schemas/environment-contract.schema.json",
  "schemas/profile-resolution-record.schema.json"
];
const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: true });
addFormats(ajv);
for (const relative of schemaPaths) {
  ajv.addSchema(await readJson(path.join(repositoryRoot, relative)));
}

function checkSchema(schemaId, document, label, issues) {
  const validator = ajv.getSchema(schemaId);
  if (!validator(document)) {
    issues.push(label + " schema invalid: " + ajv.errorsText(validator.errors));
  }
}

const paths = {
  profile: path.join(profileDirectory, "evaluation-profile.json"),
  outcome: path.join(profileDirectory, "outcome-profile.json"),
  resolution: path.join(profileDirectory, "profile-resolution.json"),
  requirementRegistry: path.join(repositoryRoot, "standard", "requirement-registry.json"),
  workRegistry: path.join(repositoryRoot, "standard", "work-artifact-registry.json"),
  signatureProfile: path.join(repositoryRoot, "profiles", "repo-change-v1", "signature-profile.json"),
  claimTrustProfile: path.join(repositoryRoot, "profiles", "repo-change-v1", "operational-signature-profile.json"),
  caseContract: path.join(profileDirectory, "case-contract.json"),
  caseQa: path.join(profileDirectory, "case-qa-contract.json"),
  gateRegistry: path.join(profileDirectory, "gate-registry.json"),
  failureTaxonomy: path.join(profileDirectory, "failure-taxonomy.json"),
  metricRegistry: path.join(profileDirectory, "metric-registry.json"),
  implementationContract: path.join(profileDirectory, "implementation-contract.json"),
  accessPolicy: path.join(profileDirectory, "evidence-access-policy.json"),
  terminalContract: path.join(profileDirectory, "terminal-evidence-contract.json"),
  verifier: verifierPath,
  vectors: path.join(fixtureDirectory, "vectors.json"),
  environment: path.join(fixtureDirectory, "positive", "environment.json"),
  evidence: path.join(fixtureDirectory, "positive", "review-decision-evidence.json"),
  decision: path.join(fixtureDirectory, "positive", "review-decision-payload.json"),
  oracle: path.join(fixtureDirectory, "positive", "review-oracle.json")
};

const documents = {};
for (const [key, absolute] of Object.entries(paths)) {
  if (["caseContract", "caseQa", "gateRegistry", "failureTaxonomy", "metricRegistry",
    "accessPolicy", "terminalContract", "verifier"].includes(key)) continue;
  documents[key] = await readJson(absolute);
}

const digests = {};
for (const [key, absolute] of Object.entries(paths)) {
  digests[key] = await rawDigest(absolute);
}

function pointer(id, version, uri, digest) {
  return { id, version, uri, digest };
}

const expectedPointers = {
  requirementRegistry: pointer(
    documents.requirementRegistry.schemaVersion === "agent-eval-requirement-registry-1"
      ? "agent-evals-standard-requirements" : "",
    "0.1.0",
    "../../standard/requirement-registry.json",
    documents.requirementRegistry.digest
  ),
  workRegistry: pointer(
    documents.workRegistry.id,
    documents.workRegistry.version,
    "../../standard/work-artifact-registry.json",
    digests.workRegistry
  ),
  signatureProfile: pointer(
    documents.signatureProfile.id,
    documents.signatureProfile.version,
    "../repo-change-v1/signature-profile.json",
    documents.signatureProfile.digest
  ),
  claimTrustProfile: pointer(
    documents.claimTrustProfile.id,
    documents.claimTrustProfile.version,
    "../repo-change-v1/operational-signature-profile.json",
    documents.claimTrustProfile.digest
  ),
  outcome: pointer(
    documents.outcome.id,
    documents.outcome.version,
    "outcome-profile.json",
    documents.outcome.digest
  ),
  resolution: pointer(
    documents.resolution.id,
    documents.resolution.version,
    "profile-resolution.json",
    documents.resolution.digest
  ),
  caseContract: pointer("repository-review-case-contract", "0.1.0", "case-contract.json", digests.caseContract),
  caseQa: pointer("repository-review-case-qa-contract", "0.1.0", "case-qa-contract.json", digests.caseQa),
  gateRegistry: pointer("repository-review-gate-registry", "0.1.0", "gate-registry.json", digests.gateRegistry),
  failureTaxonomy: pointer(
    "repository-review-failure-taxonomy", "0.1.0", "failure-taxonomy.json", digests.failureTaxonomy
  ),
  metricRegistry: pointer(
    "repository-review-metric-registry", "0.1.0", "metric-registry.json", digests.metricRegistry
  ),
  implementationContract: pointer(
    "repository-review-v1-requirement-implementation-contract",
    "0.1.0",
    "implementation-contract.json",
    digests.implementationContract
  )
};

function checkPointer(actual, expected, label, issues) {
  if (!same(actual, expected)) issues.push(label + " pointer mismatch");
}

const profileSetOrders = {
  supportedAssuranceLevels: ["A1", "A2", "A3"],
  effectiveRiskRange: ["low", "medium", "high", "critical"],
  capabilityFamilies: [
    "CAP.DISCOVER_SPECIFY",
    "CAP.PLAN_DESIGN",
    "CAP.IMPLEMENT_CHANGE",
    "CAP.VERIFY_ASSURE",
    "CAP.REVIEW_DECIDE",
    "CAP.RELEASE_OPERATE",
    "CAP.REMEDIATE_LEARN"
  ],
  interactionModes: [
    "noninteractive_repository_task",
    "interactive_repository_session",
    "pull_request_workflow",
    "ci_or_release_workflow"
  ]
};

function sortKeyed(values, key) {
  return [...values].sort(function (left, right) {
    return left[key] < right[key] ? -1 : left[key] > right[key] ? 1 : 0;
  });
}

function effectiveProjection(profile) {
  const effective = clone(profile);
  effective.parentProfile = null;
  for (const key of [
    "fixtures",
    "conflictReport",
    "resolutionEvidence",
    "effectiveProfileDigest",
    "digest",
    "signature"
  ]) delete effective[key];
  for (const [field, order] of Object.entries(profileSetOrders)) {
    effective[field] = [...effective[field]].sort(function (left, right) {
      return order.indexOf(left) - order.indexOf(right);
    });
  }
  for (const [field, key] of Object.entries({
    allowedOutcomeProfiles: "id",
    metrics: "id",
    additionalAssuranceRequirements: "id",
    exclusions: "scope",
    requirementMapping: "requirementId"
  })) {
    effective[field] = sortKeyed(effective[field], key);
  }
  return effective;
}

function exactValues(actual, expected) {
  return Array.isArray(actual) && same(actual, expected);
}

const distributionRequirementResolver = await distributionRequirementMappingResolver();

function validateProfile(profile, issues) {
  checkSchema(
    "urn:agent-evals-standard:schema:evaluation-profile:1",
    profile,
    "evaluation profile",
    issues
  );
  checkSignedArtifact(profile, "evaluation profile", issues);
  if (!exactValues(profile.capabilityFamilies, ["CAP.REVIEW_DECIDE"])) {
    issues.push("profile capabilityFamilies must be exactly CAP.REVIEW_DECIDE");
  }
  if (!exactValues(profile.interactionModes, ["noninteractive_repository_task"])) {
    issues.push("profile interactionModes must be exactly noninteractive_repository_task");
  }
  if (!exactValues(profile.supportedAssuranceLevels, ["A1"])) {
    issues.push("profile supportedAssuranceLevels must be exactly A1");
  }
  if (!exactValues(profile.effectiveRiskRange, ["low", "medium"])) {
    issues.push("profile effectiveRiskRange must be exactly low,medium");
  }
  checkPointer(profile.baseCompatibility.requirementRegistry, expectedPointers.requirementRegistry,
    "profile requirement registry", issues);
  checkPointer(profile.signatureProfile, expectedPointers.signatureProfile, "profile signature", issues);
  checkPointer(profile.claimTrustProfile, expectedPointers.claimTrustProfile, "profile claim trust", issues);
  checkPointer(profile.workArtifactRegistry, expectedPointers.workRegistry, "profile work registry", issues);
  checkPointer(profile.caseContract, expectedPointers.caseContract, "profile case contract", issues);
  checkPointer(profile.caseQa, expectedPointers.caseQa, "profile case QA", issues);
  checkPointer(profile.gateRegistry, expectedPointers.gateRegistry, "profile gate registry", issues);
  checkPointer(profile.failureTaxonomy, expectedPointers.failureTaxonomy, "profile failure taxonomy", issues);
  if (!exactValues(profile.allowedOutcomeProfiles, [expectedPointers.outcome])) {
    issues.push("profile must allow exactly repository-review-outcome-v1");
  }
  if (!exactValues(profile.metrics, [expectedPointers.metricRegistry])) {
    issues.push("profile metric registry binding mismatch");
  }
  const excluded = [
    "CAP.DISCOVER_SPECIFY",
    "CAP.IMPLEMENT_CHANGE",
    "CAP.PLAN_DESIGN",
    "CAP.RELEASE_OPERATE",
    "CAP.REMEDIATE_LEARN",
    "CAP.VERIFY_ASSURE"
  ];
  const actualExcluded = (profile.exclusions || []).map(function (entry) { return entry.scope; });
  if (!exactValues(actualExcluded, excluded)) {
    issues.push("profile exclusions must fail closed over every non-review capability");
  }
  checkSchema(
    "urn:agent-evals-standard:schema:requirement-implementation-contract:1",
    documents.implementationContract,
    "profile requirement implementation contract",
    issues
  );
  issues.push(...validateRequirementImplementationRouting({
    profile,
    registry: documents.requirementRegistry,
    canonicalRegistryIdentity: {
      id: "agent-evals-standard-requirements",
      version: documents.requirementRegistry.standardVersion,
      digest: documents.requirementRegistry.digest
    },
    contract: documents.implementationContract,
    contractPointer: expectedPointers.implementationContract,
    distributionResolver: distributionRequirementResolver
  }).map(function (issue) { return "profile " + issue; }));
  const manifestExpectationById = new Map(documents.vectors.expectations.map(function (entry) {
    return [entry.id, entry];
  }));
  for (const fixture of profile.fixtures || []) {
    if (fixture.manifestDigest !== digests.vectors
      || fixture.manifestUri !== "../../conformance/fixtures/repository-review-v1/vectors.json") {
      issues.push("profile fixture manifest binding mismatch");
    }
    const expectation = manifestExpectationById.get(fixture.manifestExpectationId);
    const expectedVerdict = expectation && expectation.valid ? "pass" : "fail";
    if (!expectation || fixture.expectedVerdict !== expectedVerdict) {
      issues.push("profile fixture expectation binding mismatch");
    }
  }
  const actualEffective = sha256Canonical(effectiveProjection(profile));
  if (profile.effectiveProfileDigest !== actualEffective) {
    issues.push("evaluation profile effective digest mismatch");
  }
  checkPointer(profile.resolutionEvidence, expectedPointers.resolution, "profile resolution evidence", issues);
  checkPointer(profile.conflictReport.evidence, expectedPointers.resolution, "profile conflict evidence", issues);
}

function validateOutcome(outcome, issues) {
  checkSchema(
    "urn:agent-evals-standard:schema:outcome-profile:1",
    outcome,
    "outcome profile",
    issues
  );
  checkSignedArtifact(outcome, "outcome profile", issues);
  if (!exactValues(outcome.workArtifactTypes, ["review_decision"])) {
    issues.push("outcome workArtifactTypes must be exactly review_decision");
  }
  checkPointer(outcome.workArtifactRegistry, expectedPointers.workRegistry, "outcome work registry", issues);
  checkPointer(outcome.gateRegistry, expectedPointers.gateRegistry, "outcome gate registry", issues);
  checkPointer(outcome.failureTaxonomy, expectedPointers.failureTaxonomy, "outcome failure taxonomy", issues);
  const solvedArtifacts = outcome.terminalEvidenceRequirements
    && outcome.terminalEvidenceRequirements.solved
    && outcome.terminalEvidenceRequirements.solved.requiredArtifacts;
  if (!exactValues(solvedArtifacts, [{
    artifactType: "repository-review:review-decision",
    cardinality: "exactly_one",
    uriBinding: "artifact_sha256_matches_digest",
    attestation: "required"
  }])) {
    issues.push("solved outcome must require exactly one authenticated review decision");
  }
  const native = new Map((outcome.nativeOutcomes || []).map(function (entry) {
    return [entry.id, entry.baseOutcome];
  }));
  for (const id of ["approved", "changes_requested", "findings_reported"]) {
    if (native.get(id) !== "solved") issues.push("native review outcome " + id + " must map to solved");
  }
  const solvedModes = outcome.outcomeRules && outcome.outcomeRules.solved
    && outcome.outcomeRules.solved.evidenceModeIds;
  if (!Array.isArray(solvedModes)
    || !solvedModes.every(function (id) { return ["deterministic", "hybrid"].includes(id); })
    || solvedModes.length === 0) {
    issues.push("solved review must use substantive deterministic or hybrid evidence");
  }
  const deterministic = (outcome.evidenceModes || []).find(function (entry) {
    return entry.id === "deterministic";
  });
  for (const required of [
    "review-decision-artifact",
    "sealed-review-oracle",
    "substantive-oracle-comparison"
  ]) {
    if (!deterministic || !deterministic.requiredEvidenceKinds.includes(required)) {
      issues.push("deterministic solved evidence lacks " + required);
    }
  }
  if (canonicalize(outcome).includes("CAP.IMPLEMENT_CHANGE")
    || (outcome.workArtifactTypes || []).includes("assurance_report")) {
    issues.push("outcome profile expands beyond accountable review decisions");
  }
}

function environmentDigest(environment) {
  const projection = clone(environment);
  delete projection.digest;
  return sha256Canonical(projection);
}

function validateEnvironment(environment, issues) {
  checkSchema(
    "urn:agent-evals-standard:schema:environment-contract:1",
    environment,
    "environment",
    issues
  );
  if (environment.digest !== environmentDigest(environment)) {
    issues.push("environment self-digest mismatch");
  }
  if (!exactValues(environment.filesystem.agentWritableRoots, [])
    || !exactValues(environment.process.agentWritableRoots, [])) {
    issues.push("environment must grant zero agent-writable roots");
  }
  if (environment.productionActionAllowed !== false
    || environment.network.default !== "deny"
    || environment.filesystem.oracleReadable !== false
    || environment.process.oracleReadable !== false) {
    issues.push("environment violates sealed read-only isolation");
  }
}

async function evidenceBytes(evidence, baseDirectory) {
  if (evidence.payload.kind === "inline_base64") {
    return Buffer.from(evidence.payload.contentBase64, "base64");
  }
  if (evidence.payload.kind === "repository_relative") {
    const absolute = path.resolve(baseDirectory, evidence.payload.path);
    const relative = path.relative(repositoryRoot, absolute);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("repository-relative evidence path escapes repository");
    }
    return readFile(absolute);
  }
  throw new Error("immutable external evidence is unavailable in the focused fixture");
}

async function validateEvidence(evidence, baseDirectory, label, semanticContract, issues) {
  checkSchema(
    "urn:agent-evals-standard:schema:evidence-artifact:1",
    evidence,
    label,
    issues
  );
  let bytes;
  try {
    bytes = await evidenceBytes(evidence, baseDirectory);
  } catch (error) {
    issues.push(label + " payload unavailable: " + error.message);
    return null;
  }
  const actualDigest = sha256(bytes);
  if (evidence.byteLength !== bytes.length) issues.push(label + " byteLength mismatch");
  if (evidence.digest !== actualDigest) issues.push(label + " digest mismatch");
  if (evidence.uri !== "artifact:" + actualDigest) issues.push(label + " URI is not content-addressed");
  if (evidence.schemaMetadata.validatorDigest !== digests.verifier) {
    issues.push(label + " validator digest mismatch");
  }
  if (!same(evidence.mediaInterpretation.semanticContract, semanticContract)) {
    issues.push(label + " semantic contract binding mismatch");
  }
  const expectedAccess = {
    id: "repository-review-evidence-access-policy",
    version: "0.1.0",
    digest: digests.accessPolicy
  };
  if (!same(evidence.accessPolicyBinding, expectedAccess)) {
    issues.push(label + " access policy binding mismatch");
  }
  checkAttestation(evidence, label, issues);
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    issues.push(label + " payload is not JSON");
    return null;
  }
}

function validateSubstantiveDecision(decision, oracle, issues) {
  if (decision.artifactClass !== "review_decision") {
    issues.push("artifactClass must distinguish review_decision from assurance_report");
  }
  if (!decision.decisionAuthority
    || typeof decision.decisionAuthority.id !== "string"
    || typeof decision.decisionAuthority.role !== "string") {
    issues.push("review decision requires an accountable decision authority");
  }
  for (const finding of decision.findings || []) {
    if (typeof finding.disposition !== "string" || finding.disposition.length === 0) {
      issues.push("every review finding requires an accountable disposition");
    }
  }
  const expectedById = new Map(oracle.materialFindings.map(function (finding) {
    return [finding.id, finding];
  }));
  const actualById = new Map((decision.findings || []).map(function (finding) {
    return [finding.id, finding];
  }));
  for (const id of expectedById.keys()) {
    if (!actualById.has(id)) issues.push("material finding omitted: " + id);
  }
  if (oracle.allowAdditionalFindings === false) {
    for (const id of actualById.keys()) {
      if (!expectedById.has(id)) issues.push("unsupported finding reported: " + id);
    }
  }
  if (decision.decision !== oracle.expectedDecision) {
    issues.push("review disposition does not match sealed oracle");
  }
  for (const [id, expected] of expectedById.entries()) {
    const actual = actualById.get(id);
    if (!actual) continue;
    if (actual.repositoryPath !== expected.repositoryPath
      || actual.severity !== expected.severity
      || !expected.acceptableDispositions.includes(actual.disposition)) {
      issues.push("review disposition does not match sealed oracle");
    }
  }
  if (decision.workspaceManifestDigest !== oracle.workspaceManifestDigest
    || decision.baseTreeDigest !== oracle.baseTreeDigest) {
    issues.push("review decision does not bind the sealed repository oracle");
  }
  if (decision.repositoryMutationObserved !== false) {
    issues.push("repository mutation is forbidden");
  }
  if (decision.baseTreeDigest !== decision.terminalTreeDigest) {
    issues.push("base and terminal repository trees must be identical");
  }
}

const fieldPointers = [
  "/baseCompatibility",
  "/capabilityFamilies",
  "/caseContract",
  "/caseQa",
  "/claimTrustProfile",
  "/claimTrustUse",
  "/effectiveRiskRange",
  "/failureTaxonomy",
  "/gateRegistry",
  "/id",
  "/interactionModes",
  "/namespace",
  "/owner",
  "/parentProfile",
  "/schemaVersion",
  "/signatureProfile",
  "/supportedAssuranceLevels",
  "/version",
  "/workArtifactRegistry"
];

function expectedKeyedProvenance(profile) {
  return [
    {
      collection: "allowedOutcomeProfiles",
      keys: profile.allowedOutcomeProfiles.map(function (entry) { return entry.id; }).sort()
    },
    {
      collection: "exclusions",
      keys: profile.exclusions.map(function (entry) { return entry.scope; }).sort()
    },
    {
      collection: "metrics",
      keys: profile.metrics.map(function (entry) { return entry.id; }).sort()
    },
    {
      collection: "requirementMapping",
      keys: profile.requirementMapping.map(function (entry) { return entry.requirementId; }).sort()
    }
  ].map(function (entry) {
    return {
      collection: entry.collection,
      keys: entry.keys,
      sourceProfileId: "repository-review-v1",
      sourceProfileVersion: "0.1.0",
      operation: entry.collection === "requirementMapping" ? "leaf_complete" : "preserves"
    };
  });
}

async function validateResolution(record, profile, issues) {
  checkSchema(
    "urn:agent-evals-standard:schema:profile-resolution-record:1",
    record,
    "profile resolution",
    issues
  );
  checkSignedArtifact(record, "profile resolution", issues);
  if (!same(record.profile, { id: profile.id, version: profile.version })) {
    issues.push("profile resolution identity mismatch");
  }
  if (!exactValues(record.parentChain, []) || !exactValues(record.replacementProofs, [])) {
    issues.push("root profile resolution must have no parent or replacement proofs");
  }
  const expectedFields = fieldPointers.map(function (pointerValue) {
    return {
      pointer: pointerValue,
      sourceProfileId: "repository-review-v1",
      sourceProfileVersion: "0.1.0",
      operation: pointerValue === "/parentProfile" ? "derived" : "leaf_identity"
    };
  });
  if (!exactValues(record.fieldProvenance, expectedFields)) {
    issues.push("profile resolution field provenance mismatch");
  }
  if (!exactValues(record.keyedProvenance, expectedKeyedProvenance(profile))) {
    issues.push("profile resolution keyed provenance mismatch");
  }
  const effectiveDigest = sha256Canonical(effectiveProjection(profile));
  if (record.effectiveProfileDigest !== effectiveDigest
    || profile.effectiveProfileDigest !== effectiveDigest) {
    issues.push("profile resolution effective digest mismatch");
  }
  if (record.conflictStatus !== "no_unresolved_conflicts") {
    issues.push("profile resolution must fail closed on conflicts");
  }
  if (!Array.isArray(record.evidenceManifest) || record.evidenceManifest.length !== 0) {
    issues.push("root profile resolution without replacement proofs must have no evidence inputs");
  }
}

function validateCase(caseRecord, profile, outcome, environment, evidence, issues) {
  const expectedProfileBinding = {
    id: profile.id,
    version: profile.version,
    digest: profile.digest,
    effectiveProfileDigest: profile.effectiveProfileDigest
  };
  if (!same(caseRecord.evaluationProfile, expectedProfileBinding)) {
    issues.push("case evaluation-profile binding mismatch");
  }
  const expectedOutcomeBinding = {
    id: outcome.id,
    version: outcome.version,
    digest: outcome.digest
  };
  if (!same(caseRecord.outcomeProfile, expectedOutcomeBinding)) {
    issues.push("case outcome-profile binding mismatch");
  }
  const expectedWorkBinding = {
    id: documents.workRegistry.id,
    version: documents.workRegistry.version,
    digest: digests.workRegistry
  };
  if (!same(caseRecord.workArtifactRegistry, expectedWorkBinding)) {
    issues.push("case work-artifact-registry binding mismatch");
  }
  const expectedEnvironmentBinding = {
    id: environment.id,
    version: environment.version,
    digest: environment.digest
  };
  if (!same(caseRecord.environment, expectedEnvironmentBinding)) {
    issues.push("case environment binding mismatch");
  }
  if (!exactValues(caseRecord.capabilityFamilyIds, ["CAP.REVIEW_DECIDE"])) {
    issues.push("case capabilityFamilyIds must be exactly CAP.REVIEW_DECIDE");
  }
  if (!profile.interactionModes.includes(caseRecord.interactionModeId)) {
    issues.push("case interactionModeId is outside profile");
  }
  if (!exactValues(caseRecord.workArtifactTypes, ["review_decision"])) {
    issues.push("case workArtifactTypes must be exactly review_decision");
  }
  if (caseRecord.repository.repositoryMutationObserved !== false) {
    issues.push("repository mutation is forbidden");
  }
  if (caseRecord.repository.baseTreeDigest !== caseRecord.repository.terminalTreeDigest) {
    issues.push("base and terminal repository trees must be identical");
  }
  if (caseRecord.resultChannel.owner !== "runner" || caseRecord.resultChannel.authenticated !== true) {
    issues.push("review result channel must be authenticated and runner-owned");
  }
  if (caseRecord.terminalEvidenceId !== evidence.id) {
    issues.push("case terminal evidence binding mismatch");
  }
}

function validateQa(qa, issues) {
  if (qa.profileId !== "repository-review-v1"
    || qa.outcomeProfileId !== "repository-review-outcome-v1"
    || qa.applicableValidationVerdict !== "pass") {
    issues.push("QA profile applicability binding mismatch");
  }
  if (qa.repositoryWriteAttemptCount !== 0) {
    issues.push("QA repositoryWriteAttemptCount must be zero");
  }
  if (qa.baseAndTerminalTreeEqual !== true || qa.workspaceDiffObserved !== false) {
    issues.push("QA read-only repository proof failed");
  }
  if (qa.knownGoodControl.verdict !== "pass" || qa.knownBadControl.verdict !== "fail") {
    issues.push("QA substantive controls are not discriminating");
  }
  const alternative = qa.alternativeValidResult;
  if (alternative.independentOfCaseAuthor !== true) {
    issues.push("alternative valid result must be independently produced");
  }
  if (alternative.referenceAccess !== false) {
    issues.push("alternative valid result must not access reference material");
  }
  if (alternative.materiallyDifferent !== true
    || !Array.isArray(alternative.differenceDimensions)
    || alternative.differenceDimensions.length === 0) {
    issues.push("alternative valid result must differ materially");
  }
  if (alternative.applicableValidationVerdict !== "pass") {
    issues.push("alternative valid result must pass applicable validation");
  }
}

async function materializeDecisionEvidence(baseEvidence, decision) {
  const evidence = clone(baseEvidence);
  const bytes = Buffer.from(JSON.stringify(decision, null, 2) + "\n", "utf8");
  evidence.payload = {
    kind: "inline_base64",
    contentBase64: bytes.toString("base64")
  };
  evidence.byteLength = bytes.length;
  evidence.digest = sha256(bytes);
  evidence.uri = "artifact:" + evidence.digest;
  return attestFixtureEvidence(evidence);
}

function setMutation(target, mutation) {
  const tokens = mutation.pointer.split("/").slice(1).map(function (token) {
    return token.replaceAll("~1", "/").replaceAll("~0", "~");
  });
  let parent = target;
  for (const token of tokens.slice(0, -1)) parent = parent[token];
  const key = tokens[tokens.length - 1];
  if (mutation.delete === true) delete parent[key];
  else parent[key] = clone(mutation.value);
}

async function validateGraph(graph) {
  const issues = [];
  validateProfile(graph.profile, issues);
  validateOutcome(graph.outcome, issues);
  validateEnvironment(graph.environment, issues);
  validateCase(
    graph.caseRecord,
    graph.profile,
    graph.outcome,
    graph.environment,
    graph.evidence,
    issues
  );
  validateQa(graph.qa, issues);
  await validateResolution(graph.resolution, graph.profile, issues);
  const terminalSemanticContract = {
    id: "repository-review-terminal-evidence-contract",
    version: "0.1.0",
    digest: digests.terminalContract
  };
  if (graph.evidence.artifactType !== "repository-review:review-decision") {
    issues.push("terminal evidence artifactType must be repository-review:review-decision");
  }
  const materialDecision = await validateEvidence(
    graph.evidence,
    path.dirname(paths.evidence),
    "terminal evidence",
    terminalSemanticContract,
    issues
  );
  if (materialDecision && !same(materialDecision, graph.decision)) {
    issues.push("terminal evidence payload does not bind review decision");
  }
  validateSubstantiveDecision(graph.decision, documents.oracle, issues);
  return issues;
}

function makeBaseGraph() {
  const profile = clone(documents.profile);
  const outcome = clone(documents.outcome);
  const environment = clone(documents.environment);
  return {
    profile,
    outcome,
    resolution: clone(documents.resolution),
    environment,
    evidence: clone(documents.evidence),
    decision: clone(documents.decision),
    qa: clone(documents.vectors.baseQa),
    caseRecord: {
      evaluationProfile: {
        id: profile.id,
        version: profile.version,
        digest: profile.digest,
        effectiveProfileDigest: profile.effectiveProfileDigest
      },
      outcomeProfile: {
        id: outcome.id,
        version: outcome.version,
        digest: outcome.digest
      },
      workArtifactRegistry: {
        id: documents.workRegistry.id,
        version: documents.workRegistry.version,
        digest: digests.workRegistry
      },
      environment: {
        id: environment.id,
        version: environment.version,
        digest: environment.digest
      },
      ...clone(documents.vectors.baseCase)
    }
  };
}

const bootstrapIssues = [];
checkSelfDigest(documents.requirementRegistry, "requirement registry", bootstrapIssues);
checkSelfDigest(documents.signatureProfile, "fixture signature profile", bootstrapIssues);
checkSelfDigest(documents.claimTrustProfile, "claim trust profile", bootstrapIssues);
checkSchema(
  "urn:agent-evals-standard:schema:work-artifact-registry:1",
  documents.workRegistry,
  "work artifact registry",
  bootstrapIssues
);
const reviewType = documents.workRegistry.artifactTypes.find(function (entry) {
  return entry.id === "review_decision";
});
if (!reviewType
  || reviewType.capabilityFamilyId !== "CAP.REVIEW_DECIDE"
  || !reviewType.definition.toLowerCase().includes("disposition")) {
  bootstrapIssues.push("work registry must define review_decision as an accountable disposition");
}
const assuranceType = documents.workRegistry.artifactTypes.find(function (entry) {
  return entry.id === "assurance_report";
});
if (!assuranceType
  || assuranceType.capabilityFamilyId !== "CAP.VERIFY_ASSURE"
  || !assuranceType.boundary.toLowerCase().includes("fact-finding")) {
  bootstrapIssues.push("work registry must classify bare fact-finding as assurance_report");
}

async function executeExpectation(expectation) {
  const graph = makeBaseGraph();
  let decisionMutated = false;
  for (const mutation of expectation.mutations) {
    const targetMap = {
      profile: graph.profile,
      outcome: graph.outcome,
      case: graph.caseRecord,
      qa: graph.qa,
      environment: graph.environment,
      evidence: graph.evidence,
      decision: graph.decision
    };
    if (!targetMap[mutation.target]) {
      throw new Error("unknown vector mutation target " + mutation.target);
    }
    setMutation(targetMap[mutation.target], mutation);
    if (mutation.target === "decision") decisionMutated = true;
  }
  if (decisionMutated) {
    graph.evidence = await materializeDecisionEvidence(graph.evidence, graph.decision);
  }
  const issues = [...bootstrapIssues, ...await validateGraph(graph)];
  return {
    actualValid: issues.length === 0,
    diagnostics: issues.join("\n"),
    issues
  };
}

export async function executeRepositoryReviewExpectation(expectationId) {
  const matches = documents.vectors.expectations.filter(function (expectation) {
    return expectation.id === expectationId;
  });
  if (matches.length !== 1) {
    return {
      executionError: "repository-review expectation " + expectationId
        + " resolves " + matches.length + " entries"
    };
  }
  try {
    return await executeExpectation(matches[0]);
  } catch (error) {
    return { executionError: "repository-review runner failed: " + error.message };
  }
}

async function runAllExpectations() {
  const results = [];
  for (const expectation of documents.vectors.expectations) {
    const outcome = await executeRepositoryReviewExpectation(expectation.id);
    const actualValid = outcome.actualValid === true;
    const expectedFailureObserved = expectation.valid === false
      && outcome.diagnostics?.includes(expectation.expectedError);
    const passed = expectation.valid
      ? actualValid
      : !actualValid && expectedFailureObserved && outcome.executionError === undefined;
    results.push({ id: expectation.id, passed, issues: outcome.issues ?? [outcome.executionError] });
  }

  const failures = results.filter(function (result) { return !result.passed; });
  if (failures.length > 0) {
    for (const failure of failures) {
      process.stderr.write(failure.id + ":\n");
      for (const issue of failure.issues) process.stderr.write("  - " + issue + "\n");
    }
    process.exitCode = 1;
  } else {
    process.stdout.write(
      "Repository review interoperability vectors passed: "
        + results.length + "/" + results.length + ".\n"
    );
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(verifierPath)) {
  await runAllExpectations();
}
