import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { createHash, createPublicKey, verify } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const verifierPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(verifierPath), "..");
const fixtureRoot = path.join(repositoryRoot, "conformance", "fixtures", "machine-contracts-v1");
const vectorsPath = path.join(fixtureRoot, "vectors.json");

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

function sha256(bytes) {
  return "sha256:" + createHash("sha256").update(bytes).digest("hex");
}

function sha256Canonical(value) {
  return sha256(Buffer.from(canonicalize(value), "utf8"));
}

async function readJson(absolute) {
  return JSON.parse(await readFile(absolute, "utf8"));
}

const schemaNames = [
  "verified-machine-contract",
  "validity-argument",
  "evaluation-threat-model",
  "held-out-exposure-budget",
  "held-out-exposure-ledger",
  "evaluation-control-bindings",
  "evaluation-control-authority-policy",
  "evaluation-control-authority-evidence",
  "signature-profile",
  "evaluation-profile",
  "work-artifact-registry",
  "outcome-profile",
  "repo-change-case-contract",
  "suite-manifest",
  "case",
  "pre-run-manifest",
  "statistical-plan",
  "risk-assessment"
];
const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: true });
addFormats(ajv);
for (const name of schemaNames) {
  ajv.addSchema(await readJson(path.join(repositoryRoot, "schemas", name + ".schema.json")));
}

const validators = {
  binding: ajv.getSchema("urn:agent-evals-standard:schema:verified-machine-contract:1"),
  policyBinding: ajv.getSchema("urn:agent-evals-standard:schema:verified-machine-contract:1#/$defs/evaluationControlAuthorityPolicyBinding"),
  validity: ajv.getSchema("urn:agent-evals-standard:schema:validity-argument:1"),
  threat: ajv.getSchema("urn:agent-evals-standard:schema:evaluation-threat-model:1"),
  budget: ajv.getSchema("urn:agent-evals-standard:schema:held-out-exposure-budget:1"),
  ledger: ajv.getSchema("urn:agent-evals-standard:schema:held-out-exposure-ledger:1"),
  controls: ajv.getSchema("urn:agent-evals-standard:schema:evaluation-control-bindings:1"),
  policy: ajv.getSchema("urn:agent-evals-standard:schema:evaluation-control-authority-policy:1"),
  evidence: ajv.getSchema("urn:agent-evals-standard:schema:evaluation-control-authority-evidence:1"),
  evaluationProfile: ajv.getSchema("urn:agent-evals-standard:schema:evaluation-profile:1"),
  workArtifactRegistry: ajv.getSchema("urn:agent-evals-standard:schema:work-artifact-registry:1"),
  outcomeProfile: ajv.getSchema("urn:agent-evals-standard:schema:outcome-profile:1"),
  repoChangeCaseContract: ajv.getSchema("urn:agent-evals-standard:schema:repo-change-case-contract:1"),
  suite: ajv.getSchema("urn:agent-evals-standard:schema:suite-manifest:1"),
  case: ajv.getSchema("urn:agent-evals-standard:schema:case:1"),
  preRun: ajv.getSchema("urn:agent-evals-standard:schema:pre-run-manifest:1"),
  statisticalPlan: ajv.getSchema("urn:agent-evals-standard:schema:statistical-plan:1"),
  riskAssessment: ajv.getSchema("urn:agent-evals-standard:schema:risk-assessment:1")
};

const repoChangeCaseContract = await readJson(path.join(
  repositoryRoot, "profiles", "repo-change-v1", "case-contract.json"));
const repoChangeEvaluationProfile = await readJson(path.join(
  repositoryRoot, "profiles", "repo-change-v1", "evaluation-profile.json"));
const repoChangeOutcomeProfile = await readJson(path.join(
  repositoryRoot, "profiles", "repo-change-v1", "outcome-profile.json"));
const repositoryWorkArtifactRegistryPath = path.join(
  repositoryRoot, "standard", "work-artifact-registry.json");
const repositoryWorkArtifactRegistryBytes = await readFile(repositoryWorkArtifactRegistryPath);
const repositoryWorkArtifactRegistry = JSON.parse(repositoryWorkArtifactRegistryBytes.toString("utf8"));
const repositoryWorkArtifactRegistryDigest = sha256(repositoryWorkArtifactRegistryBytes);

export const repoChangeVerificationBinding = "change_bound_verify_requires_implement_change";
export const repoChangeAssuranceReportBinding = "change_bound_verify_requires_assurance_report";
export const repoChangeAssurancePassengerBinding = "assurance_report_requires_verify_assure";
export const repoChangeImplementationWorkArtifactTypes = Object.freeze([
  "code_change",
  "test_change",
  "repository_configuration"
]);

function registryEntry(registry, type) {
  if (registry?.byType instanceof Map) return registry.byType.get(type);
  const entries = registry?.artifact?.artifactTypes ?? registry?.artifactTypes ?? [];
  return entries.find(function (entry) { return entry.id === type; });
}

/**
 * Resolve a repo-change case to the exact authenticated distribution profile,
 * outcome profile, and work-artifact registry. A mutually consistent stale
 * case/suite/pre-run graph is still invalid when it no longer resolves to the
 * current distribution bytes.
 */
export function checkRepoChangeDistributionBindings(caseRecord, context = {}) {
  if (caseRecord?.evaluationProfile?.id !== "repo-change-v1") return [];

  const label = context.label ?? `repo-change case ${caseRecord?.id ?? "<unknown>"}`;
  const evaluationProfile = context.evaluationProfile;
  const outcomeProfile = context.outcomeProfile;
  const workArtifactRegistry = context.workArtifactRegistry;
  const workArtifactRegistryDigest = context.workArtifactRegistryDigest;
  const caseEffectiveProfileDigest = caseRecord.evaluationProfile.effectiveProfileDigest
    ?? caseRecord.effectiveProfileDigest;
  if (caseRecord.evaluationProfile.id !== evaluationProfile?.id
    || caseRecord.evaluationProfile.version !== evaluationProfile?.version
    || caseRecord.evaluationProfile.digest !== evaluationProfile?.digest
    || caseEffectiveProfileDigest !== evaluationProfile?.effectiveProfileDigest) {
    return [`${label}: evaluation profile binding does not resolve the current authenticated distribution profile`];
  }
  if (caseRecord.outcomeProfile?.id !== outcomeProfile?.id
    || caseRecord.outcomeProfile?.version !== outcomeProfile?.version
    || caseRecord.outcomeProfile?.digest !== outcomeProfile?.digest) {
    return [`${label}: outcome profile binding does not resolve the current authenticated distribution profile`];
  }
  if (Object.hasOwn(caseRecord, "workArtifactRegistry")) {
    if (caseRecord.workArtifactRegistry?.id !== workArtifactRegistry?.id
      || caseRecord.workArtifactRegistry?.version !== workArtifactRegistry?.version
      || caseRecord.workArtifactRegistry?.digest !== workArtifactRegistryDigest) {
      return [`${label}: work-artifact registry binding does not resolve the current authenticated distribution registry`];
    }
  }
  return [];
}

/**
 * Enforce the repo-change profile's change-bound meaning of verification.
 * The caller must supply already authenticated contract, outcome-profile, and
 * registry documents. The function deliberately returns after the first
 * failed prerequisite so every failure has one exact, actionable diagnostic.
 */
export function checkRepoChangeBoundVerification(caseRecord, context = {}) {
  if (caseRecord?.evaluationProfile?.id !== "repo-change-v1") return [];

  const label = context.label ?? `repo-change case ${caseRecord?.id ?? "<unknown>"}`;
  const caseContract = context.caseContract;
  if (caseContract?.id !== "repo-change-case-contract"
    || caseContract?.version !== "0.1.0"
    || !(caseContract.requiredProfileBindings ?? []).includes(repoChangeVerificationBinding)) {
    return [`${label}: authenticated case contract lacks required binding ${repoChangeVerificationBinding}`];
  }
  if (!(caseContract.requiredProfileBindings ?? []).includes(repoChangeAssuranceReportBinding)) {
    return [`${label}: authenticated case contract lacks required binding ${repoChangeAssuranceReportBinding}`];
  }
  if (!(caseContract.requiredProfileBindings ?? []).includes(repoChangeAssurancePassengerBinding)) {
    return [`${label}: authenticated case contract lacks required binding ${repoChangeAssurancePassengerBinding}`];
  }

  const solvedRequirements = context.outcomeProfile
    ?.terminalEvidenceRequirements?.solved?.requiredArtifacts ?? [];
  const workspaceDiffRequirements = solvedRequirements.filter(function (requirement) {
    return requirement.artifactType === "workspace_diff";
  });
  const exactMaterialRequirement = workspaceDiffRequirements.length === 1
    && workspaceDiffRequirements[0].cardinality === "exactly_one"
    && workspaceDiffRequirements[0].uriBinding === "artifact_sha256_matches_digest"
    && workspaceDiffRequirements[0].attestation === "required";
  if (!exactMaterialRequirement) {
    return [`${label}: solved terminal evidence requires exactly one authenticated content-addressed workspace_diff`];
  }

  const capabilities = caseRecord.capabilityFamilyIds ?? [];
  const workArtifactTypes = caseRecord.workArtifactTypes ?? [];
  const verificationSelected = capabilities.includes("CAP.VERIFY_ASSURE");
  const assuranceReportSelected = workArtifactTypes.includes("assurance_report");
  if (!verificationSelected) {
    if (assuranceReportSelected) {
      return [`${label}: assurance_report requires CAP.VERIFY_ASSURE`];
    }
    return [];
  }
  if (!capabilities.includes("CAP.IMPLEMENT_CHANGE")) {
    return [`${label}: CAP.VERIFY_ASSURE requires CAP.IMPLEMENT_CHANGE`];
  }

  const selectedImplementationTypes = workArtifactTypes.filter(function (type) {
    return repoChangeImplementationWorkArtifactTypes.includes(type)
      && registryEntry(context.workArtifactRegistry, type)?.capabilityFamilyId === "CAP.IMPLEMENT_CHANGE";
  });
  if (selectedImplementationTypes.length === 0) {
    return [`${label}: CAP.VERIFY_ASSURE requires at least one selected implementation work artifact mapped to CAP.IMPLEMENT_CHANGE`];
  }
  if (!assuranceReportSelected
    || registryEntry(context.workArtifactRegistry, "assurance_report")?.capabilityFamilyId !== "CAP.VERIFY_ASSURE") {
    return [`${label}: CAP.VERIFY_ASSURE requires assurance_report as a selected material work artifact`];
  }

  return [];
}

function schemaIssues(validator, document, label, issues) {
  if (!validator || !validator(document)) {
    issues.push(label + " schema invalid: "
      + (validator ? ajv.errorsText(validator.errors) : "validator unavailable"));
  }
}

function repositoryPath(ownerAbsolute, locator, label, issues) {
  if (!locator || locator.kind !== "repository_relative"
    || locator.base !== "binding_document" || typeof locator.path !== "string") {
    issues.push(label + " has no resolvable repository-relative locator");
    return null;
  }
  const absolute = path.resolve(path.dirname(ownerAbsolute), locator.path);
  const relative = path.relative(repositoryRoot, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    issues.push(label + " locator escapes repository");
    return null;
  }
  return absolute;
}

async function resolveComponent(component, ownerAbsolute, label, issues) {
  if (!component || typeof component !== "object") {
    issues.push(label + " is missing");
    return null;
  }
  const absolute = repositoryPath(ownerAbsolute, component.locator, label, issues);
  if (!absolute) return null;
  let bytes;
  try {
    bytes = await readFile(absolute);
  } catch (error) {
    issues.push(label + " is unavailable: " + error.message);
    return null;
  }
  const digest = sha256(bytes);
  if (component.digest !== digest) issues.push(label + " digest mismatch");
  if (component.uri !== "artifact:" + digest) issues.push(label + " URI must equal stored-byte digest");
  if (component.byteLength !== bytes.length) issues.push(label + " byteLength mismatch");
  return { absolute, bytes, digest };
}

function componentDescriptor(kind, component) {
  return {
    componentKind: kind,
    id: component.id,
    version: component.version,
    digest: component.digest,
    mediaType: component.mediaType,
    ...(kind === "verifier" ? { entrypoint: component.entrypoint } : { schemaId: component.schemaId })
  };
}

function authorizeComponent(component, kind, authorityState, label, issues) {
  if (!component || !authorityState) return;
  const descriptor = componentDescriptor(kind, component);
  const matches = authorityState.policy.components.filter(function (entry) {
    return same(entry, descriptor);
  });
  if (matches.length !== 1) {
    issues.push(label + " is not authorized by the externally rooted evaluation-control authority policy");
  }
}

function checkComponentAuthority(binding, authorityState, label, issues) {
  if (!authorityState) return;
  const expected = {
    policyId: authorityState.policy.id,
    policyVersion: authorityState.policy.version,
    policyDigest: authorityState.rawDigest
  };
  if (!same(binding?.componentAuthority, expected)) {
    issues.push(label + " component authority does not match the externally rooted policy");
  }
}

async function resolveBinding(binding, ownerAbsolute, expectedType, expectedSchema, label, issues, authorityState) {
  if (!binding || typeof binding !== "object") {
    issues.push(label + " binding is missing");
    return null;
  }
  schemaIssues(validators.binding, binding, label + " binding", issues);
  if (!binding.uri || !binding.digest || !Number.isInteger(binding.byteLength)) {
    issues.push(label + " binding URI/digest/byteLength incomplete");
  }
  if (binding.contractType !== expectedType) issues.push(label + " contractType must be " + expectedType);
  if (binding.schemaId !== expectedSchema) issues.push(label + " schemaId must be " + expectedSchema);
  checkComponentAuthority(binding, authorityState, label, issues);

  const resolved = await resolveComponent(binding, ownerAbsolute, label + " artifact", issues);
  const verifier = await resolveComponent(binding.verifier, ownerAbsolute, label + " verifier", issues);
  const resolution = await resolveComponent(binding.resolutionContract, ownerAbsolute,
    label + " resolution contract", issues);
  authorizeComponent(binding.verifier, "verifier", authorityState, label + " verifier", issues);
  authorizeComponent(binding.resolutionContract, "resolution_contract", authorityState,
    label + " resolution contract", issues);

  if (verifier && path.resolve(verifier.absolute) !== path.resolve(verifierPath)) {
    issues.push(label + " verifier implementation is unavailable to this reference runner");
  }
  if (resolution) {
    try {
      const contract = JSON.parse(resolution.bytes.toString("utf8"));
      const expected = {
        schemaVersion: "agent-eval-machine-contract-resolution-1",
        id: "machine-contract-resolution-v1",
        version: "0.1.0",
        locatorBase: "binding_document",
        allowedLocatorKinds: ["repository_relative"],
        digestAlgorithm: "SHA-256",
        uriRule: "artifact_sha256_equals_digest",
        byteLengthRule: "exact_stored_bytes",
        unknownEffect: "insufficient_evidence"
      };
      if (!same(contract, expected)
        || binding.resolutionContract.schemaId !== "agent-eval-machine-contract-resolution-1") {
        issues.push(label + " resolution contract semantics mismatch");
      }
    } catch {
      issues.push(label + " resolution contract is not JSON");
    }
  }
  if (!resolved) return null;
  let payload;
  try {
    payload = JSON.parse(resolved.bytes.toString("utf8"));
  } catch {
    issues.push(label + " artifact is not JSON");
    return null;
  }
  const validator = ajv.getSchema(expectedSchema);
  if (!validator || !validator(payload)) {
    issues.push(label + " resolved payload schema invalid: "
      + (validator ? ajv.errorsText(validator.errors) : "unknown schema"));
  }
  return payload;
}

function signingMessage(document) {
  const projection = clone(document);
  if (projection.signature) delete projection.signature.value;
  return Buffer.concat([
    Buffer.from(document.schemaVersion, "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalize(projection), "utf8")
  ]);
}

function checkSelfDigest(document, label, issues) {
  const projection = clone(document);
  delete projection.digest;
  delete projection.signature;
  const expected = sha256Canonical(projection);
  if (document.digest !== expected) issues.push(label + " self digest mismatch");
}

function publicKey(record, label, issues) {
  try {
    const bytes = Buffer.from(record.publicKey.contentBase64, "base64");
    if (sha256(bytes) !== record.publicKey.digest) {
      issues.push(label + " public-key digest mismatch");
      return null;
    }
    return createPublicKey({ key: bytes, format: "der", type: "spki" });
  } catch (error) {
    issues.push(label + " public key is invalid: " + error.message);
    return null;
  }
}

function checkSignature(document, record, label, issues) {
  const signature = document.signature;
  if (!signature || !record) {
    issues.push(label + " signature authority is unavailable");
    return;
  }
  if (signature.profileId !== record.profileId || signature.algorithm !== record.algorithm
    || signature.keyId !== record.keyId) {
    issues.push(label + " signature identity is not authorized");
    return;
  }
  const key = publicKey(record, label, issues);
  if (!key) return;
  try {
    const bytes = Buffer.from(signature.value, "base64url");
    if (bytes.toString("base64url") !== signature.value || bytes.length !== 64
      || !verify(null, signingMessage(document), key, bytes)) {
      issues.push(label + " signature is invalid");
    }
  } catch (error) {
    issues.push(label + " signature verification failed: " + error.message);
  }
}

function policyRootRecord(trustContext) {
  return {
    profileId: trustContext.policyIssuer.profileId,
    algorithm: "Ed25519",
    keyId: trustContext.policyIssuer.keyId,
    publicKey: trustContext.policyIssuer.publicKey
  };
}

function deterministicValues(values) {
  return [...new Set(values)].sort();
}

function claimantIdentityDimensions(policy) {
  const keys = policy.claimantIdentities?.keys || [];
  return {
    actorIds: deterministicValues(keys.map(function (entry) { return entry.actor?.id; })),
    roles: deterministicValues(keys.map(function (entry) { return entry.actor?.role; })),
    trustDomains: deterministicValues(keys.map(function (entry) { return entry.actor?.trustDomain; })),
    profileIds: deterministicValues(keys.map(function (entry) { return entry.profileId; })),
    keyIds: deterministicValues(keys.map(function (entry) { return entry.keyId; })),
    publicKeyDigests: deterministicValues(keys.map(function (entry) { return entry.publicKey?.digest; }))
  };
}

function validateClaimantRegistry(policy, issues) {
  const claimant = policy.claimantIdentities || {};
  const keys = claimant.keys || [];
  const dimensions = claimantIdentityDimensions(policy);
  for (const field of ["actorIds", "trustDomains", "keyIds"]) {
    if (!same(claimant[field], dimensions[field])) {
      issues.push("authority policy claimant " + field
        + " must be the exact sorted projection of claimantIdentities.keys");
    }
  }

  const tuples = keys.map(function (entry) {
    return canonicalize({
      actorId: entry.actor?.id,
      role: entry.actor?.role,
      trustDomain: entry.actor?.trustDomain,
      profileId: entry.profileId,
      keyId: entry.keyId,
      publicKeyDigest: entry.publicKey?.digest
    });
  });
  if (new Set(tuples).size !== tuples.length) {
    issues.push("authority policy claimant key identities must be unique full tuples");
  }
  for (const entry of keys) {
    publicKey(entry, "authority policy claimant key " + (entry.keyId || "<missing>"), issues);
  }

  const dimensionSets = Object.fromEntries(Object.entries(dimensions).map(function ([field, values]) {
    return [field, new Set(values)];
  }));
  for (const authorization of policy.authorizations || []) {
    publicKey(authorization,
      "authority policy authorization " + (authorization.purpose || "<missing>"), issues);
    const candidates = {
      actorIds: authorization.actor?.id,
      roles: authorization.actor?.role,
      trustDomains: authorization.actor?.trustDomain,
      profileIds: authorization.profileId,
      keyIds: authorization.keyId,
      publicKeyDigests: authorization.publicKey?.digest
    };
    const overlaps = Object.entries(candidates).filter(function ([field, value]) {
      return value !== undefined && dimensionSets[field].has(value);
    }).map(function ([field]) { return field; });
    if (overlaps.length > 0) {
      issues.push("authority policy authorization " + authorization.purpose
        + " overlaps claimant identity by " + overlaps.join(", "));
    }
  }
}

async function authenticateAuthorityPolicy(vectors) {
  const issues = [];
  const trust = vectors.trustContext;
  const absolute = path.resolve(fixtureRoot, trust.policy.path);
  const relative = path.relative(repositoryRoot, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return { issues: ["authority policy path escapes repository"] };
  }
  let bytes;
  try {
    bytes = await readFile(absolute);
  } catch (error) {
    return { issues: ["authority policy is unavailable: " + error.message] };
  }
  const rawDigest = sha256(bytes);
  if (trust.policy.digest !== rawDigest) issues.push("authority policy raw digest mismatch");
  if (trust.policy.byteLength !== bytes.length) issues.push("authority policy byteLength mismatch");
  let policy;
  try {
    policy = JSON.parse(bytes.toString("utf8"));
  } catch {
    return { issues: [...issues, "authority policy is not JSON"] };
  }
  schemaIssues(validators.policy, policy, "authority policy", issues);
  checkSelfDigest(policy, "authority policy", issues);
  if (!same(policy.issuer, {
    id: trust.policyIssuer.id,
    role: trust.policyIssuer.role,
    trustDomain: trust.policyIssuer.trustDomain
  })) issues.push("authority policy issuer is not externally trusted");
  checkSignature(policy, policyRootRecord(trust), "authority policy", issues);
  if (policy.signature?.signedAt !== policy.validFrom) issues.push("authority policy signature time differs from validFrom");
  const verificationTime = Date.parse(trust.verificationTime);
  if (!(Date.parse(policy.validFrom) <= verificationTime && verificationTime <= Date.parse(policy.validUntil))) {
    issues.push("authority policy is outside its validity interval");
  }
  validateClaimantRegistry(policy, issues);
  for (const purpose of ["validity_review", "held_out_budget_authorization", "held_out_ledger_checkpoint"]) {
    const matches = policy.authorizations.filter(function (entry) { return entry.purpose === purpose; });
    if (matches.length !== 1) issues.push("authority policy must authorize exactly one " + purpose + " identity");
  }
  const componentKeys = policy.components.map(function (entry) {
    return entry.componentKind + ":" + entry.id + ":" + entry.version + ":" + entry.digest;
  });
  if (new Set(componentKeys).size !== componentKeys.length) issues.push("authority policy component authorizations are ambiguous");
  return { issues, trust, policy, absolute, bytes, rawDigest };
}

async function resolvePolicyBinding(binding, ownerAbsolute, label, authorityState, issues) {
  schemaIssues(validators.policyBinding, binding, label + " binding", issues);
  const resolved = await resolveComponent(binding, ownerAbsolute, label + " artifact", issues);
  if (!resolved || !authorityState.policy) return null;
  if (binding.contractType !== "evaluation_control_authority_policy"
    || binding.schemaId !== "urn:agent-evals-standard:schema:evaluation-control-authority-policy:1") {
    issues.push(label + " binding type/schema mismatch");
  }
  if (resolved.digest !== authorityState.rawDigest || resolved.absolute !== authorityState.absolute
    || !same(JSON.parse(resolved.bytes.toString("utf8")), authorityState.policy)) {
    issues.push(label + " does not resolve the externally rooted authority policy");
  }
  return authorityState.policy;
}

function uniqueIds(values, label, issues) {
  const ids = values.map(function (entry) { return entry.id; });
  if (new Set(ids).size !== ids.length) issues.push(label + " IDs must be unique");
  return new Set(ids);
}

function exactIdScope(expected, actual, label, issues) {
  const expectedValues = expected || [];
  const actualValues = actual || [];
  const expectedSet = new Set(expectedValues);
  const actualSet = new Set(actualValues);
  const valid = expectedSet.size === expectedValues.length && actualSet.size === actualValues.length
    && expectedSet.size === actualSet.size
    && [...expectedSet].every(function (id) { return actualSet.has(id); });
  if (!valid) {
    issues.push(label + " must exactly match the sealed scope");
  }
  return valid;
}

function orderedUnique(values) {
  const seen = new Set();
  return values.filter(function (value) {
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function exactOrderedScope(expected, actual, label, issues) {
  const expectedValues = expected || [];
  const actualValues = actual || [];
  const valid = new Set(expectedValues).size === expectedValues.length
    && new Set(actualValues).size === actualValues.length
    && same(expectedValues, actualValues);
  if (!valid) {
    issues.push(label + " must exactly match the canonical ordered case scope");
  }
  return valid;
}

function eligibleCell(cell) {
  return {
    cellId: cell.cellId,
    caseId: cell.caseId,
    armId: cell.armId,
    repetition: cell.repetition,
    blockId: cell.blockId,
    seed: cell.seed
  };
}

function pairedCell(cell) {
  return {
    caseId: cell.caseId,
    armId: cell.armId,
    repetition: cell.repetition,
    blockId: cell.blockId,
    seed: cell.seed
  };
}

function aggregateScopeDigest(controls) {
  const materialIdentity = function (subject) {
    return {
      id: subject.id,
      digest: subject.digest,
      selfDigest: subject.selfDigest
    };
  };
  return sha256Canonical({
    suiteSliceId: controls.suiteSliceId,
    suite: materialIdentity(controls.suite),
    cases: (controls.cases || []).map(materialIdentity)
  });
}

function validateScopeClosure(controls, suite, threat, riskAssessment, statisticalPlan,
  preRun, budget, issues) {
  const caseIds = (controls.cases || []).map(function (entry) { return entry.id; });
  const caseProfileIds = (preRun.caseProfiles || []).map(function (entry) { return entry.caseId; });
  const preRunCaseIds = (preRun.caseSet || []).map(function (entry) { return entry.id; });
  const armIds = (preRun.arms || []).map(function (entry) { return entry.id; });
  const scheduledCells = preRun.scheduledCells || [];
  const scheduledCaseIds = orderedUnique(scheduledCells.map(function (entry) { return entry.caseId; }));
  const scheduledArmIds = deterministicValues(scheduledCells.map(function (entry) { return entry.armId; }));
  if (new Set(caseIds).size !== caseIds.length) issues.push("aggregate case IDs must be unique");

  const selectedSlices = (suite.slices || []).filter(function (entry) {
    return entry.id === controls.suiteSliceId;
  });
  if (selectedSlices.length !== 1) {
    issues.push("aggregate suiteSliceId must select exactly one suite slice");
  } else {
    exactOrderedScope(caseIds, selectedSlices[0].caseIds || [],
      "selected suite slice case IDs", issues);
  }
  exactOrderedScope(caseIds, preRunCaseIds, "pre-run caseSet case IDs", issues);
  exactOrderedScope(caseIds, caseProfileIds, "pre-run caseProfiles case IDs", issues);
  exactOrderedScope(caseIds, scheduledCaseIds, "pre-run scheduled case IDs", issues);
  exactOrderedScope(caseIds, riskAssessment?.scope?.caseIds || [],
    "risk-assessment case IDs", issues);
  exactOrderedScope(caseIds, threat?.scope?.caseIds || [],
    "evaluation threat-model case IDs", issues);
  exactOrderedScope(caseIds, budget?.scope?.caseIds || [],
    "held-out budget case IDs", issues);
  const scheduledArmScopeValid = exactIdScope(deterministicValues(armIds), scheduledArmIds,
    "pre-run scheduled arm IDs", issues);
  if (new Set(armIds).size !== armIds.length) issues.push("pre-run arm IDs must be unique");

  const cellIds = scheduledCells.map(function (entry) { return entry.cellId; });
  for (const cell of scheduledCells) {
    if (typeof cell.blockId !== "string" || cell.blockId.length === 0
      || typeof cell.seed !== "string" || cell.seed.length === 0) {
      issues.push(`pre-run scheduled cell ${cell.cellId ?? "<unknown>"} must declare both blockId and seed`);
    }
  }
  const cellIdsUnique = new Set(cellIds).size === cellIds.length;
  if (!cellIdsUnique) issues.push("pre-run scheduled cell IDs must be unique");
  const tuples = scheduledCells.map(function (entry) {
    return canonicalize([entry.caseId, entry.armId, entry.repetition]);
  });
  const cellTuplesUnique = new Set(tuples).size === tuples.length;
  if (!cellTuplesUnique) {
    issues.push("pre-run scheduled case/arm/repetition tuples must be unique");
  }

  const comparative = preRun.comparativeDesign;
  const comparativeArmIds = (preRun.arms || []).filter(function (entry) {
    return entry.treatmentRole !== "single";
  }).map(function (entry) { return entry.id; });
  if (comparative === null) {
    if (armIds.length !== 1 || comparativeArmIds.length !== 0) {
      issues.push("pre-run without comparativeDesign must contain exactly one single arm");
    }
  } else if (comparative && scheduledArmScopeValid && cellTuplesUnique) {
    const comparativeArmsValid = exactIdScope(comparativeArmIds,
      comparative.comparatorArmIds || [],
      "pre-run comparativeDesign arm IDs", issues);
    const pairedUnits = comparative.pairedUnits || [];
    const pairedCaseIds = orderedUnique(pairedUnits.map(function (entry) { return entry.caseId; }));
    const pairedCasesValid = exactOrderedScope(caseIds, pairedCaseIds,
      "pre-run comparativeDesign paired-unit case IDs", issues);
    const unitKeys = pairedUnits.map(function (unit) {
      return canonicalize([unit.caseId, unit.blockId]);
    });
    const repetitionKeys = pairedUnits.flatMap(function (unit) {
      return (unit.repetitions || []).map(function (entry) {
        return canonicalize([unit.caseId, unit.blockId, entry.repetition, entry.seed]);
      });
    });
    const pairedUnitsUnique = new Set(unitKeys).size === unitKeys.length
      && new Set(repetitionKeys).size === repetitionKeys.length;
    if (!pairedUnitsUnique) {
      issues.push("pre-run comparativeDesign paired units must be unique");
    }
    const expectedPairedCells = pairedUnits.flatMap(function (unit) {
      return (unit.repetitions || []).flatMap(function (entry) {
        return (comparative.comparatorArmIds || []).map(function (armId) {
          return {
            caseId: unit.caseId,
            armId,
            repetition: entry.repetition,
            blockId: unit.blockId,
            seed: entry.seed
          };
        });
      });
    });
    const actualPairedCells = scheduledCells.filter(function (cell) {
      return (comparative.comparatorArmIds || []).includes(cell.armId);
    }).map(pairedCell);
    if (comparativeArmsValid && pairedCasesValid && pairedUnitsUnique
      && !same(actualPairedCells, expectedPairedCells)) {
      issues.push("comparative paired-cell matrix must contain exactly one canonical cell per comparator arm and paired tuple");
    }
    if (!same(comparative.statisticalPlan, preRun.statisticalPlan)) {
      issues.push("pre-run comparativeDesign statistical plan differs from the sealed plan");
    }
  }

  exactIdScope(armIds, riskAssessment?.scope?.armIds || [],
    "risk-assessment arm IDs", issues);
  if (riskAssessment?.assessmentKind !== "experiment_decision_envelope") {
    issues.push("pre-run risk assessment must cover the experiment decision envelope");
  }
  if (riskAssessment?.effectiveRiskTier !== preRun.effectiveRiskTier) {
    issues.push("pre-run effective risk tier differs from the sealed risk assessment");
  }
  const decisionEnvelopeId = preRun.decisionPlan?.id || null;
  if (riskAssessment?.scope?.decisionEnvelopeId !== decisionEnvelopeId) {
    issues.push("risk-assessment decision envelope differs from the pre-run decision plan");
  }

  const expectedProfileIds = deterministicValues((preRun.caseProfiles || []).map(function (entry) {
    return entry.evaluationProfile?.id;
  }));
  exactIdScope(expectedProfileIds, threat?.scope?.evaluationProfileIds || [],
    "evaluation threat-model profile IDs", issues);

  if (statisticalPlan.assuranceLevel !== preRun.assuranceLevel
    || statisticalPlan.runMode !== preRun.runMode
    || statisticalPlan.claimEligibility !== preRun.claimEligibility) {
    issues.push("statistical plan run classification differs from the pre-run manifest");
  }
  if (Date.parse(statisticalPlan.sealedAt) > Date.parse(preRun.sealedAt)) {
    issues.push("statistical plan was sealed after the pre-run manifest");
  }
  const primaryClaims = statisticalPlan.primaryClaims || [];
  const exploratoryClaims = statisticalPlan.exploratoryClaims || [];
  const claimContracts = statisticalPlan.claimContracts || [];
  const declaredClaimIds = [...primaryClaims, ...exploratoryClaims];
  const contractClaimIds = claimContracts.map(function (entry) { return entry.claimId; });
  exactIdScope(declaredClaimIds, contractClaimIds, "statistical-plan claim contracts", issues);
  for (const contract of claimContracts) {
    const expectedClassification = primaryClaims.includes(contract.claimId) ? "primary" : "exploratory";
    if (contract.classification !== expectedClassification) {
      issues.push("statistical-plan claim " + contract.claimId + " classification mismatch");
    }
    exactOrderedScope(caseIds, contract.caseIds || [],
      "statistical-plan claim " + contract.claimId + " case IDs", issues);
    exactIdScope(armIds, contract.armIds || [],
      "statistical-plan claim " + contract.claimId + " arm IDs", issues);
    if (!same(contract.eligibleCells || [], scheduledCells.map(eligibleCell))) {
      issues.push("statistical-plan claim " + contract.claimId
        + " eligible cells must exactly match the canonical scheduled-cell tuple commitment");
    }
  }
}

function evidenceKeyRecord(evidence, authorityState) {
  const all = [
    ...authorityState.policy.authorizations,
    ...authorityState.policy.claimantIdentities.keys
  ];
  return all.find(function (entry) {
    return entry.keyId === evidence.signature?.keyId
      && entry.profileId === evidence.signature?.profileId
      && same(entry.actor, evidence.actor);
  });
}

function claimantControlled(evidence, authorityState) {
  const claimant = claimantIdentityDimensions(authorityState.policy);
  return claimant.actorIds.includes(evidence.actor?.id)
    || claimant.roles.includes(evidence.actor?.role)
    || claimant.trustDomains.includes(evidence.actor?.trustDomain)
    || claimant.profileIds.includes(evidence.signature?.profileId)
    || claimant.keyIds.includes(evidence.signature?.keyId);
}

function parentProjection(document, kind) {
  const projection = clone(document);
  if (kind === "validity_review") delete projection.review.evidence;
  if (kind === "held_out_budget_authorization") delete projection.authorization.evidence;
  if (kind === "held_out_ledger_checkpoint") delete projection.checkpoint.evidence;
  return projection;
}

function expectedEvidenceSubject(document, schemaId, projectionName, kind) {
  return {
    schemaId,
    id: document.id,
    version: document.version,
    projection: projectionName,
    digest: sha256Canonical(parentProjection(document, kind))
  };
}

function validateAuthorityEvidence(evidence, parent, kind, schemaId, projectionName,
  parentActor, label, authorityState, issues) {
  schemaIssues(validators.evidence, evidence, label, issues);
  checkSelfDigest(evidence, label, issues);
  if (evidence.evidenceKind !== kind) issues.push(label + " evidenceKind mismatch");
  if (!same(evidence.subject, expectedEvidenceSubject(parent, schemaId, projectionName, kind))) {
    issues.push(label + " does not bind the required subject projection");
  }
  if (!same(evidence.actor, parentActor)) issues.push(label + " actor differs from the parent contract");
  const expectedPolicy = {
    id: authorityState.policy.id,
    version: authorityState.policy.version,
    digest: authorityState.rawDigest
  };
  if (!same(evidence.authorityPolicy, expectedPolicy)) issues.push(label + " authority-policy binding mismatch");

  const keyRecord = evidenceKeyRecord(evidence, authorityState);
  checkSignature(evidence, keyRecord, label, issues);
  const authorization = authorityState.policy.authorizations.find(function (entry) {
    return entry.purpose === kind && entry.keyId === evidence.signature?.keyId
      && entry.profileId === evidence.signature?.profileId && same(entry.actor, evidence.actor);
  });
  if (!authorization) {
    if (claimantControlled(evidence, authorityState)) {
      issues.push(label + " is signed by claimant-controlled authority");
    } else {
      issues.push(label + " signer role/trust domain/key is not authorized for " + kind);
    }
  }
  if (evidence.signature?.signedAt !== evidence.issuedAt) issues.push(label + " signature time differs from issuedAt");
}

async function resolveAuthorityEvidence(binding, ownerAbsolute, supplied, parent, kind,
  schemaId, projectionName, parentActor, label, authorityState, issues) {
  const resolved = await resolveBinding(binding, ownerAbsolute,
    "evaluation_control_authority_evidence",
    "urn:agent-evals-standard:schema:evaluation-control-authority-evidence:1",
    label, issues, authorityState);
  if (resolved && supplied && !same(resolved, supplied)) {
    issues.push(label + " binding does not resolve supplied evidence bytes");
  }
  const evidence = supplied || resolved;
  if (evidence) validateAuthorityEvidence(evidence, parent, kind, schemaId, projectionName,
    parentActor, label, authorityState, issues);
  return evidence;
}

function suitePrecontrolProjection(document) {
  const projection = clone(document);
  delete projection.digest;
  delete projection.signature;
  delete projection.validityArgument;
  delete projection.evaluationThreatModel;
  delete projection.heldOutExposure;
  return projection;
}

function expectedValiditySuite(document) {
  return {
    id: document.id,
    artifactVersion: "0.1.0",
    schemaId: "urn:agent-evals-standard:schema:suite-manifest:1",
    projection: "suite_precontrol_projection_v1",
    digest: sha256Canonical(suitePrecontrolProjection(document))
  };
}

function validateValidity(validity, suiteDocument, issues) {
  schemaIssues(validators.validity, validity, "validity argument", issues);
  if (!same(validity.suite, expectedValiditySuite(suiteDocument))) {
    issues.push("validity argument suite pre-control projection mismatch");
  }
  const constructIds = uniqueIds(validity.constructs || [], "validity construct", issues);
  uniqueIds(validity.claims || [], "validity claim", issues);
  for (const claim of validity.claims || []) {
    for (const id of claim.constructIds || []) {
      if (!constructIds.has(id)) issues.push("validity claim references unknown construct " + id);
    }
  }
  const baselines = validity.evidencePlan?.referenceBaselines || [];
  const baselineIds = uniqueIds(baselines, "validity reference baseline", issues);
  const disposition = validity.evidencePlan?.incumbentDisposition;
  const nonAgentBaselines = baselines.filter(function (baseline) {
    return baseline.agentInvolvement === "none";
  });
  if (nonAgentBaselines.length === 0) {
    issues.push("validity argument must include a non-agent reference baseline");
  }
  if (disposition?.status === "incumbent_available") {
    const incumbent = baselines.find(function (baseline) {
      return baseline.id === disposition.baselineId;
    });
    if (!baselineIds.has(disposition.baselineId) || !incumbent
      || !["current_workflow", "incumbent_system"].includes(incumbent.kind)) {
      issues.push("incumbent disposition must resolve to a current-workflow or incumbent-system baseline");
    }
    if (!nonAgentBaselines.some(function (baseline) { return baseline.id !== disposition.baselineId; })) {
      issues.push("incumbent study must include a distinct non-agent control baseline");
    }
  } else if (disposition?.status === "no_incumbent_exists") {
    const noActionBaselines = baselines.filter(function (baseline) {
      return baseline.kind === "base_state_no_action";
    });
    if (noActionBaselines.length === 0) {
      issues.push("no-incumbent study must include a base-state/no-action baseline");
    }
    const noActionIds = new Set(noActionBaselines.map(function (baseline) { return baseline.id; }));
    if (!nonAgentBaselines.some(function (baseline) { return !noActionIds.has(baseline.id); })) {
      issues.push("no-incumbent study must include a distinct non-agent control baseline");
    }
  }
  if (validity.review?.owner?.id === validity.review?.independentReviewer?.id
    || validity.review?.owner?.trustDomain === validity.review?.independentReviewer?.trustDomain) {
    issues.push("validity reviewer is not independent from validity owner");
  }
}

function validateThreatModel(threat, controls, issues) {
  schemaIssues(validators.threat, threat, "evaluation threat model", issues);
  if (threat.scope.suiteId !== controls.suite.id) issues.push("evaluation threat model suite binding mismatch");
  const assets = uniqueIds(threat.assets || [], "threat asset", issues);
  const actors = uniqueIds(threat.actors || [], "threat actor", issues);
  const boundaries = uniqueIds(threat.trustBoundaries || [], "threat boundary", issues);
  uniqueIds(threat.threats || [], "threat", issues);
  for (const event of threat.threats || []) {
    for (const id of event.assetIds || []) if (!assets.has(id)) issues.push("threat references unknown asset " + id);
    for (const id of event.actorIds || []) if (!actors.has(id)) issues.push("threat references unknown actor " + id);
    for (const id of event.boundaryIds || []) if (!boundaries.has(id)) issues.push("threat references unknown boundary " + id);
  }
}

function validateBudget(budget, controls, issues) {
  schemaIssues(validators.budget, budget, "held-out exposure budget", issues);
  if (budget.suiteId !== controls.suite.id) issues.push("held-out exposure budget suite binding mismatch");
  if (Date.parse(budget.issuedAt) >= Date.parse(budget.effectiveUntil)) {
    issues.push("held-out exposure budget validity interval is empty");
  }
}

const unitKeys = ["agentVisibleCaseExposures", "unblindedOutcomeLooks", "oracleAccesses"];

function sumEvents(events) {
  const totals = Object.fromEntries(unitKeys.map(function (key) { return [key, 0]; }));
  for (const event of events) for (const key of unitKeys) totals[key] += event.units[key];
  return totals;
}

function validateLedger(ledger, budget, controls, checkpointEvidence, authorityState, issues,
  requireExternalHead = true) {
  schemaIssues(validators.ledger, ledger, "held-out exposure ledger", issues);
  const events = ledger.events || [];
  uniqueIds(events, "exposure event", issues);
  const expectedSequences = events.map(function (_, index) { return index + 1; });
  const actualSequences = events.map(function (event) { return event.sequence; });
  if (!same(actualSequences, expectedSequences) || ledger.sequence !== (expectedSequences.at(-1) || 0)) {
    issues.push("held-out exposure ledger sequence is not append-only");
  }
  const totals = sumEvents(events);
  if (!same(ledger.totals, totals)) issues.push("held-out exposure ledger totals mismatch");
  const remaining = {};
  let saturated = false;
  for (const key of unitKeys) {
    remaining[key] = budget.limits[key] - totals[key];
    if (key === "oracleAccesses" ? totals[key] > 0 : remaining[key] <= 0) saturated = true;
    if (remaining[key] < 0) issues.push("held-out exposure budget exceeded for " + key);
  }
  if (!same(ledger.remaining, remaining)) issues.push("held-out exposure ledger remaining budget mismatch");
  if (ledger.saturated !== saturated) issues.push("held-out exposure ledger saturation state mismatch");
  const caseIds = new Set(budget.scope.caseIds);
  for (const event of events) {
    if (!caseIds.has(event.caseId)) issues.push("exposure event is outside budget case scope");
    if (!budget.allowedPurposes.includes(event.purpose)) issues.push("exposure event purpose is outside budget");
    if (event.authorizationId !== budget.authorization.decisionId) {
      issues.push("exposure event does not bind the authorized held-out budget decision");
    }
  }
  for (const caseSubject of controls.cases || []) {
    if (!caseIds.has(caseSubject.id)) issues.push("case stage binding is outside held-out budget scope");
  }

  if (checkpointEvidence) {
    const checkpoint = checkpointEvidence.checkpoint;
    if (checkpoint?.ledgerSequence !== ledger.sequence) issues.push("ledger checkpoint sequence mismatch");
    const expectedPrevious = ledger.previousLedger === null ? null : ledger.previousLedger.digest;
    if (checkpoint?.previousLedgerDigest !== expectedPrevious) issues.push("ledger checkpoint previous-ledger digest mismatch");
    if (ledger.previousLedger === null && checkpoint?.previousCheckpointDigest !== null) {
      issues.push("genesis ledger checkpoint has a previous checkpoint");
    }
    if (ledger.previousLedger !== null && checkpoint?.previousCheckpointDigest === null) {
      issues.push("non-genesis ledger checkpoint omits the previous checkpoint digest");
    }
    if (checkpoint?.logBinding?.logId !== authorityState.policy.ledgerLog.logId) {
      issues.push("ledger checkpoint log is not authorized by policy");
    }
    if (requireExternalHead) {
      const expectedHead = authorityState.trust.expectedLedgerHead;
      if (checkpoint?.logBinding?.logId !== expectedHead.logId
        || checkpoint?.logBinding?.checkpointSequence !== expectedHead.checkpointSequence
        || checkpointEvidence.digest !== expectedHead.checkpointDigest) {
        issues.push("ledger checkpoint does not match the externally observed monotonic log head");
      }
    }
    if (checkpointEvidence.issuedAt !== ledger.sealedAt) issues.push("ledger checkpoint issuance differs from ledger seal");
  }
}

async function validateLedgerHistory(ledger, ledgerPath, budget, controls,
  checkpointEvidence, authorityState, issues, seen = new Set()) {
  if (ledger.previousLedger === null) return;
  const previousBinding = ledger.previousLedger;
  if (seen.has(previousBinding.digest)) {
    issues.push("held-out exposure ledger history contains a cycle");
    return;
  }
  seen.add(previousBinding.digest);
  const previousPath = repositoryPath(ledgerPath, previousBinding.locator,
    "previous held-out exposure ledger artifact", issues);
  const previous = await resolveBinding(previousBinding, ledgerPath,
    "held_out_exposure_ledger", "urn:agent-evals-standard:schema:held-out-exposure-ledger:1",
    "previous held-out exposure ledger", issues, authorityState);
  if (!previous || !previousPath) return;
  const previousBudget = await resolveBinding(previous.budget, previousPath,
    "held_out_exposure_budget", "urn:agent-evals-standard:schema:held-out-exposure-budget:1",
    "previous ledger budget", issues, authorityState);
  if (previousBudget && !same(previousBudget, budget)) {
    issues.push("previous ledger resolves a different held-out exposure budget");
  }
  if (!same(previous.budget, ledger.budget)) {
    issues.push("held-out exposure ledger history changes the budget binding");
  }
  const previousCheckpointEvidence = await resolveAuthorityEvidence(
    previous.checkpoint?.evidence, previousPath, null, previous,
    "held_out_ledger_checkpoint", "urn:agent-evals-standard:schema:held-out-exposure-ledger:1",
    "full_document_without_checkpoint_evidence", previous.checkpoint?.custodian,
    "previous held-out ledger checkpoint evidence", authorityState, issues);
  if (previous.sequence >= ledger.sequence) {
    issues.push("held-out exposure ledger history does not advance sequence");
  }
  if (!same((ledger.events || []).slice(0, (previous.events || []).length), previous.events || [])) {
    issues.push("held-out exposure ledger history is not an append-only event prefix");
  }
  if (checkpointEvidence?.checkpoint?.previousCheckpointDigest !== previousCheckpointEvidence?.digest) {
    issues.push("held-out exposure ledger checkpoint does not bind the previous checkpoint");
  }
  if (checkpointEvidence?.checkpoint?.logBinding?.checkpointSequence
    !== previousCheckpointEvidence?.checkpoint?.logBinding?.checkpointSequence + 1) {
    issues.push("held-out exposure ledger checkpoint log sequence is not monotonic");
  }
  validateLedger(previous, budget, controls, previousCheckpointEvidence, authorityState, issues, false);
  await validateLedgerHistory(previous, previousPath, budget, controls,
    previousCheckpointEvidence, authorityState, issues, seen);
}

function preRunProjection(document) {
  const projection = clone(document);
  delete projection.evaluationControlBindings;
  delete projection.digest;
  delete projection.signature;
  return projection;
}

function expectedPreRunSubject(document) {
  return {
    id: document.id,
    artifactVersion: "0.1.0",
    schemaId: "urn:agent-evals-standard:schema:pre-run-manifest:1",
    identityProjection: "full_document_without_evaluation_control_bindings_digest_signature",
    digest: sha256Canonical(preRunProjection(document))
  };
}

async function storedDocumentPointer(ownerAbsolute, targetAbsolute, document) {
  const bytes = await readFile(targetAbsolute);
  const digest = sha256(bytes);
  return {
    id: document.id,
    version: "0.1.0",
    uri: "artifact:" + digest,
    digest,
    byteLength: bytes.length,
    mediaType: "application/json",
    locator: {
      kind: "repository_relative",
      base: "binding_document",
      path: path.relative(path.dirname(ownerAbsolute), targetAbsolute).replaceAll("\\", "/")
    },
    selfDigest: document.digest
  };
}

async function storedArtifactPointer(targetAbsolute, document) {
  const bytes = await readFile(targetAbsolute);
  const digest = sha256(bytes);
  return {
    id: document.id,
    uri: "artifact:" + digest,
    digest
  };
}

async function resolveRiskAssessment(pointer, ownerAbsolute, expectedAbsolute, supplied,
  claimantKey, issues) {
  if (!pointer || typeof pointer.uri !== "string" || pointer.uri.startsWith("artifact:")) {
    issues.push("pre-run risk-assessment pointer is not repository-relative");
    return null;
  }
  const absolute = path.resolve(path.dirname(ownerAbsolute), pointer.uri);
  const relative = path.relative(repositoryRoot, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    issues.push("pre-run risk-assessment pointer escapes repository");
    return null;
  }
  if (path.resolve(absolute) !== path.resolve(expectedAbsolute)) {
    issues.push("pre-run risk-assessment pointer resolves a substituted artifact");
  }
  let stored;
  try {
    stored = await readJson(absolute);
  } catch (error) {
    issues.push("pre-run risk assessment is unavailable: " + error.message);
    return null;
  }
  if (!same(stored, supplied)) issues.push("pre-run risk assessment differs from stored bytes");
  if (pointer.id !== stored.id || pointer.version !== stored.version || pointer.digest !== stored.digest) {
    issues.push("pre-run risk-assessment identity or digest mismatch");
  }
  schemaIssues(validators.riskAssessment, stored, "risk-assessment stage document", issues);
  checkSelfDigest(stored, "risk-assessment stage document", issues);
  checkSignature(stored, claimantKey, "risk-assessment stage document", issues);
  return stored;
}

async function materialStageSubject(ownerAbsolute, targetAbsolute, document, schemaId) {
  const pointer = await storedDocumentPointer(ownerAbsolute, targetAbsolute, document);
  return {
    id: pointer.id,
    artifactVersion: "0.1.0",
    schemaId,
    identityProjection: "full_signed_document",
    uri: pointer.uri,
    digest: pointer.digest,
    byteLength: pointer.byteLength,
    mediaType: pointer.mediaType,
    locator: pointer.locator,
    selfDigest: pointer.selfDigest
  };
}

async function validateStages(controls, controlBinding, ledger, budget, threat, stageDocuments,
  paths, authorityState, issues) {
  schemaIssues(validators.controls, controls, "evaluation control bindings", issues);
  schemaIssues(validators.evaluationProfile, repoChangeEvaluationProfile,
    "repo-change evaluation profile", issues);
  checkSelfDigest(repoChangeEvaluationProfile, "repo-change evaluation profile", issues);
  schemaIssues(validators.repoChangeCaseContract, repoChangeCaseContract,
    "repo-change case contract", issues);
  schemaIssues(validators.outcomeProfile, repoChangeOutcomeProfile,
    "repo-change outcome profile", issues);
  schemaIssues(validators.workArtifactRegistry, repositoryWorkArtifactRegistry,
    "repository work-artifact registry", issues);
  const caseDocuments = stageDocuments.cases || [];
  const casePaths = paths.caseStageDocuments || [];
  const expectedOrder = ["suite", ...caseDocuments.map(function () { return "case"; }), "pre_run"];
  const actualOrder = (controls.stageBindings || []).map(function (entry) { return entry.stage; });
  if (!same(actualOrder, expectedOrder)) {
    issues.push("stage bindings must contain suite, every canonical case, pre_run in canonical order");
  }
  const suiteStages = (controls.stageBindings || []).filter(function (entry) { return entry.stage === "suite"; });
  const caseStages = (controls.stageBindings || []).filter(function (entry) { return entry.stage === "case"; });
  const preRunStages = (controls.stageBindings || []).filter(function (entry) { return entry.stage === "pre_run"; });
  const suiteStage = suiteStages[0];
  const preRunStage = preRunStages[0];
  if (suiteStage && !same(suiteStage.subject, controls.suite)) issues.push("suite stage subject mismatch");
  if (!same(caseStages.map(function (entry) { return entry.subject; }), controls.cases || [])) {
    issues.push("case stage subjects must exactly match aggregate cases in canonical order");
  }

  const claimantKey = authorityState.policy.claimantIdentities.keys[0];
  const signedDocuments = [
    ["suite stage document", validators.suite, stageDocuments.suite],
    ...caseDocuments.map(function (document, index) {
      return ["case stage document " + (index + 1), validators.case, document];
    }),
    ["pre-run stage document", validators.preRun, stageDocuments.preRun],
    ["statistical-plan stage document", validators.statisticalPlan, stageDocuments.statisticalPlan]
  ];
  for (const [label, validator, document] of signedDocuments) {
    schemaIssues(validator, document, label, issues);
    checkSelfDigest(document, label, issues);
    checkSignature(document, claimantKey, label, issues);
  }
  for (const [index, document] of caseDocuments.entries()) {
    issues.push(...checkRepoChangeDistributionBindings(document, {
      label: `repo-change stage case ${document?.id ?? index}`,
      evaluationProfile: repoChangeEvaluationProfile,
      outcomeProfile: repoChangeOutcomeProfile,
      workArtifactRegistry: repositoryWorkArtifactRegistry,
      workArtifactRegistryDigest: repositoryWorkArtifactRegistryDigest
    }));
    issues.push(...checkRepoChangeBoundVerification(document, {
      label: `repo-change stage case ${document?.id ?? index}`,
      caseContract: repoChangeCaseContract,
      outcomeProfile: repoChangeOutcomeProfile,
      workArtifactRegistry: repositoryWorkArtifactRegistry
    }));
  }
  const resolvedRiskAssessment = await resolveRiskAssessment(
    stageDocuments.preRun.riskAssessment,
    paths.preRunStageDocument,
    paths.riskAssessment,
    stageDocuments.riskAssessment,
    claimantKey,
    issues
  );
  if (!same(stageDocuments.statisticalPlan.heldOutExposureAndReuse, controls.heldOutExposure)) {
    issues.push("statistical plan held-out controls differ from the authoritative control bundle");
  }
  if (Object.hasOwn(stageDocuments.suite, "evaluationControlBindings")) {
    issues.push("suite stage document must not contain the aggregate evaluation-control binding");
  }
  for (const document of caseDocuments) {
    if (Object.hasOwn(document, "evaluationControlBindings")) {
      issues.push("case stage document must not contain the aggregate evaluation-control binding");
    }
  }
  if (!same(stageDocuments.preRun.evaluationControlBindings, controlBinding)) {
    issues.push("pre-run stage document does not contain the authoritative control binding");
  }

  const expectedSuite = await materialStageSubject(paths.controls, paths.suiteStageDocument,
    stageDocuments.suite, "urn:agent-evals-standard:schema:suite-manifest:1");
  const expectedCases = await Promise.all(caseDocuments.map(function (document, index) {
    return materialStageSubject(paths.controls, casePaths[index], document,
      "urn:agent-evals-standard:schema:case:1");
  }));
  if (!same(controls.suite, expectedSuite) || !same(suiteStage?.subject, expectedSuite)) {
    issues.push("suite stage material binding mismatch");
  }
  if (!same(controls.cases || [], expectedCases)) {
    issues.push("aggregate cases must resolve the exact ordered material case documents");
  }
  const expectedPreRun = expectedPreRunSubject(stageDocuments.preRun);
  if (!same(preRunStage?.subject, expectedPreRun)) {
    issues.push("pre-run stage prebinding projection mismatch");
  }
  for (let index = 0; index < caseDocuments.length; index += 1) {
    if (caseStages[index]?.subject?.digest === sha256Canonical(caseDocuments[index])) {
      issues.push("case stage subject illegally self-echoes a full-document canonical digest");
    }
  }
  if (preRunStage?.subject?.digest === sha256Canonical(stageDocuments.preRun)) {
    issues.push("pre-run stage subject illegally self-echoes the bound document");
  }

  if (!same(stageDocuments.suite.validityArgument, controls.validityArgument)
    || !same(stageDocuments.suite.evaluationThreatModel, controls.evaluationThreatModel)
    || !same(stageDocuments.suite.heldOutExposure, controls.heldOutExposure)) {
    issues.push("suite direct evaluation-control bindings differ from the aggregate pre-run binding");
  }
  const expectedSuiteCases = await Promise.all(caseDocuments.map(async function (document, index) {
    const pointer = await storedDocumentPointer(paths.suiteStageDocument, casePaths[index], document);
    return {
      ...pointer,
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
  }));
  const selectedSlice = (stageDocuments.suite.slices || []).find(function (entry) {
    return entry.id === controls.suiteSliceId;
  });
  const suiteCasesById = new Map((stageDocuments.suite.cases || []).map(function (entry) {
    return [entry.id, entry];
  }));
  const materialSuiteCases = (selectedSlice?.caseIds || []).map(function (id) {
    return suiteCasesById.get(id);
  });
  if (!same(materialSuiteCases, expectedSuiteCases)) {
    issues.push("selected suite slice cases must resolve the exact ordered material case documents and metadata");
  }
  for (const [index, caseRecord] of materialSuiteCases.entries()) {
    if (!caseRecord) continue;
    issues.push(...checkRepoChangeDistributionBindings(caseRecord, {
      label: `selected repo-change suite slice case ${caseRecord.id ?? index}`,
      evaluationProfile: repoChangeEvaluationProfile,
      outcomeProfile: repoChangeOutcomeProfile,
      workArtifactRegistry: repositoryWorkArtifactRegistry,
      workArtifactRegistryDigest: repositoryWorkArtifactRegistryDigest
    }));
    issues.push(...checkRepoChangeBoundVerification(caseRecord, {
      label: `selected repo-change suite slice case ${caseRecord.id ?? index}`,
      caseContract: repoChangeCaseContract,
      outcomeProfile: repoChangeOutcomeProfile,
      workArtifactRegistry: repositoryWorkArtifactRegistry
    }));
  }

  const expectedPreRunSuite = await storedDocumentPointer(paths.preRunStageDocument,
    paths.suiteStageDocument, stageDocuments.suite);
  const expectedPreRunCases = await Promise.all(caseDocuments.map(function (document, index) {
    return storedDocumentPointer(paths.preRunStageDocument, casePaths[index], document);
  }));
  if (!same(stageDocuments.preRun.suite, expectedPreRunSuite)) {
    issues.push("pre-run suite pointer does not resolve the material suite stage document");
  }
  const preRunCaseIds = (stageDocuments.preRun.caseSet || []).map(function (entry) { return entry.id; });
  const expectedCaseIds = caseDocuments.map(function (entry) { return entry.id; });
  if (same(preRunCaseIds, expectedCaseIds)
    && !same(stageDocuments.preRun.caseSet, expectedPreRunCases)) {
    issues.push("pre-run caseSet contains a substituted material case document");
  }
  const expectedStatisticalPlan = await storedArtifactPointer(paths.statisticalPlan,
    stageDocuments.statisticalPlan);
  if (!same(stageDocuments.preRun.statisticalPlan, expectedStatisticalPlan)) {
    issues.push("pre-run statistical-plan pointer does not resolve the material statistical plan");
  }
  const expectedCaseProfiles = caseDocuments.map(function (document) {
    return {
      caseId: document.id,
      bindingUse: stageDocuments.preRun.claimEligibility === "claims_eligible"
        ? "claims_eligible" : "diagnostic_only",
      evaluationProfile: {
        id: document.evaluationProfile.id,
        version: document.evaluationProfile.version,
        digest: document.evaluationProfile.digest
      },
      effectiveProfileDigest: document.evaluationProfile.effectiveProfileDigest,
      outcomeProfile: document.outcomeProfile
    };
  });
  const profileCaseIds = (stageDocuments.preRun.caseProfiles || []).map(function (entry) {
    return entry.caseId;
  });
  if (same(profileCaseIds, expectedCaseIds)
    && !same(stageDocuments.preRun.caseProfiles, expectedCaseProfiles)) {
    issues.push("pre-run per-case profile binding differs from its material case");
  }
  if (stageDocuments.preRun.claimTrustUse === "deployment_bound"
    && stageDocuments.preRun.signatureProfile?.id.startsWith("fixture-")) {
    issues.push("deployment_bound cannot use the repository operational reference keys");
  }
  try {
    const evaluatorAbsolute = path.resolve(path.dirname(paths.preRunStageDocument),
      stageDocuments.preRun.evaluator.uri);
    const relativeEvaluator = path.relative(repositoryRoot, evaluatorAbsolute);
    if (relativeEvaluator.startsWith("..") || path.isAbsolute(relativeEvaluator)) {
      throw new Error("evaluator pointer escapes repository");
    }
    const evaluatorDocument = await readJson(evaluatorAbsolute);
    if (stageDocuments.preRun.evaluator.id !== evaluatorDocument.id
      || stageDocuments.preRun.evaluator.digest !== evaluatorDocument.digest) {
      issues.push("claimTrustBinding evaluator: digest must be " + evaluatorDocument.digest);
    }
  } catch (error) {
    issues.push("claimTrustBinding evaluator: cannot resolve evaluator: " + error.message);
  }
  validateScopeClosure(controls, stageDocuments.suite, threat,
    resolvedRiskAssessment || stageDocuments.riskAssessment,
    stageDocuments.statisticalPlan, stageDocuments.preRun, budget, issues);
  const expectedScope = aggregateScopeDigest(controls);
  for (const stage of controls.stageBindings || []) {
    if (stage.scopeDigest !== expectedScope) issues.push("stage binding scope digest mismatch");
    if (stage.minimumLedgerSequence > ledger.sequence) issues.push(stage.stage + " stage requires unavailable ledger sequence");
  }
  if (preRunStage && (Date.parse(preRunStage.sealedAt) < Date.parse(ledger.sealedAt)
    || preRunStage.sealedAt !== stageDocuments.preRun.sealedAt)) {
    issues.push("pre-run binding predates held-out exposure ledger seal");
  }
}

async function validateGraph(graph, paths, authorityState) {
  const issues = [...authorityState.issues];
  const resolvedControls = await resolveBinding(graph.controlBinding, paths.controlBinding,
    "evaluation_control_bindings", "urn:agent-evals-standard:schema:evaluation-control-bindings:1",
    "evaluation control bindings", issues, authorityState);
  if (resolvedControls && !same(resolvedControls, graph.controls)) {
    issues.push("stage binding does not resolve the authoritative control bundle");
  }
  await resolvePolicyBinding(graph.controls.authorityPolicy, paths.controls,
    "evaluation control authority policy", authorityState, issues);
  const resolvedValidity = await resolveBinding(graph.controls.validityArgument, paths.controls,
    "validity_argument", "urn:agent-evals-standard:schema:validity-argument:1",
    "validity", issues, authorityState);
  const resolvedThreat = await resolveBinding(graph.controls.evaluationThreatModel, paths.controls,
    "evaluation_threat_model", "urn:agent-evals-standard:schema:evaluation-threat-model:1",
    "evaluation threat model", issues, authorityState);
  const resolvedBudget = await resolveBinding(graph.controls.heldOutExposure.budget, paths.controls,
    "held_out_exposure_budget", "urn:agent-evals-standard:schema:held-out-exposure-budget:1",
    "held-out exposure budget", issues, authorityState);
  const resolvedLedger = await resolveBinding(graph.controls.heldOutExposure.ledger, paths.controls,
    "held_out_exposure_ledger", "urn:agent-evals-standard:schema:held-out-exposure-ledger:1",
    "held-out exposure ledger", issues, authorityState);
  if (resolvedValidity && !same(resolvedValidity, graph.validity)) issues.push("validity binding does not resolve supplied graph bytes");
  if (resolvedThreat && !same(resolvedThreat, graph.threat)) issues.push("threat-model binding does not resolve supplied graph bytes");
  if (resolvedBudget && !same(resolvedBudget, graph.budget)) issues.push("budget binding does not resolve supplied graph bytes");
  if (resolvedLedger && !same(resolvedLedger, graph.ledger)) issues.push("ledger binding does not resolve supplied graph bytes");
  const ledgerBudget = await resolveBinding(graph.ledger.budget, paths.ledger,
    "held_out_exposure_budget", "urn:agent-evals-standard:schema:held-out-exposure-budget:1",
    "ledger budget", issues, authorityState);
  if (ledgerBudget && !same(ledgerBudget, graph.budget)) issues.push("ledger budget binding does not resolve the authoritative budget");
  if (!same(graph.ledger.budget, graph.controls.heldOutExposure.budget)) {
    issues.push("ledger and control bundle budget bindings differ");
  }

  const reviewEvidence = await resolveAuthorityEvidence(graph.validity.review.evidence, paths.validity,
    graph.reviewEvidence, graph.validity, "validity_review",
    "urn:agent-evals-standard:schema:validity-argument:1", "full_document_without_review_evidence",
    graph.validity.review.independentReviewer, "validity review evidence", authorityState, issues);
  const authorizationEvidence = await resolveAuthorityEvidence(graph.budget.authorization.evidence, paths.budget,
    graph.budgetAuthorizationEvidence, graph.budget, "held_out_budget_authorization",
    "urn:agent-evals-standard:schema:held-out-exposure-budget:1", "full_document_without_authorization_evidence",
    graph.budget.authorization.authority, "held-out budget authorization evidence", authorityState, issues);
  const checkpointEvidence = await resolveAuthorityEvidence(graph.ledger.checkpoint.evidence, paths.ledger,
    graph.ledgerCheckpointEvidence, graph.ledger, "held_out_ledger_checkpoint",
    "urn:agent-evals-standard:schema:held-out-exposure-ledger:1", "full_document_without_checkpoint_evidence",
    graph.ledger.checkpoint.custodian, "held-out ledger checkpoint evidence", authorityState, issues);

  if (reviewEvidence?.decision !== graph.validity.review.verdict
    || reviewEvidence?.issuedAt !== graph.validity.review.reviewedAt) {
    issues.push("validity review evidence decision/time mismatch");
  }
  if (authorizationEvidence?.id !== graph.budget.authorization.decisionId
    || Date.parse(authorizationEvidence?.issuedAt) > Date.parse(graph.budget.issuedAt)) {
    issues.push("held-out budget authorization evidence decision/time mismatch");
  }

  validateValidity(graph.validity, graph.stageDocuments.suite, issues);
  validateThreatModel(graph.threat, graph.controls, issues);
  validateBudget(graph.budget, graph.controls, issues);
  validateLedger(graph.ledger, graph.budget, graph.controls, checkpointEvidence, authorityState, issues);
  await validateLedgerHistory(graph.ledger, paths.ledger, graph.budget, graph.controls,
    checkpointEvidence, authorityState, issues);
  await validateStages(graph.controls, graph.controlBinding, graph.ledger, graph.budget, graph.threat,
    graph.stageDocuments, paths, authorityState, issues);
  return issues;
}

function mutate(target, mutation) {
  const tokens = mutation.pointer.split("/").slice(1).map(function (token) {
    return token.replaceAll("~1", "/").replaceAll("~0", "~");
  });
  let parent = target;
  for (const token of tokens.slice(0, -1)) parent = parent[token];
  const key = tokens.at(-1);
  if (mutation.delete === true) {
    if (Array.isArray(parent)) parent.splice(Number(key), 1);
    else delete parent[key];
  } else {
    parent[key] = clone(mutation.value);
  }
}

let corpusPromise;

async function loadGraphDocuments(artifactPaths) {
  return {
    controlBinding: await readJson(artifactPaths.controlBinding),
    controls: await readJson(artifactPaths.controls),
    validity: await readJson(artifactPaths.validity),
    threat: await readJson(artifactPaths.threat),
    budget: await readJson(artifactPaths.budget),
    ledger: await readJson(artifactPaths.ledger),
    reviewEvidence: await readJson(artifactPaths.reviewEvidence),
    budgetAuthorizationEvidence: await readJson(artifactPaths.budgetAuthorizationEvidence),
    ledgerCheckpointEvidence: await readJson(artifactPaths.ledgerCheckpointEvidence),
    stageDocuments: {
      suite: await readJson(artifactPaths.suiteStageDocument),
      cases: await Promise.all((artifactPaths.caseStageDocuments || []).map(readJson)),
      statisticalPlan: await readJson(artifactPaths.statisticalPlan),
      riskAssessment: await readJson(artifactPaths.riskAssessment),
      preRun: await readJson(artifactPaths.preRunStageDocument)
    }
  };
}

function loadCorpus() {
  corpusPromise ??= (async function () {
    const vectors = await readJson(vectorsPath);
    const artifactPaths = Object.fromEntries(Object.entries(vectors.artifacts).map(function ([key, relative]) {
      return [key, Array.isArray(relative)
        ? relative.map(function (entry) { return path.resolve(fixtureRoot, entry); })
        : path.resolve(fixtureRoot, relative)];
    }));
    const authorityState = await authenticateAuthorityPolicy(vectors);
    const base = await loadGraphDocuments(artifactPaths);
    return { vectors, artifactPaths, authorityState, base };
  }());
  return corpusPromise;
}

function artifactIdentityMatches(left, right) {
  if (left?.schemaVersion || right?.schemaVersion) {
    return left?.schemaVersion === right?.schemaVersion && left?.id === right?.id;
  }
  return left?.contractType === right?.contractType
    && left?.id === right?.id
    && left?.schemaId === right?.schemaId;
}

let positiveGraphIssuesPromise;

export async function verifyMachineContractArtifact(document) {
  const { vectors, artifactPaths, authorityState, base } = await loadCorpus();
  const candidates = [
    { document: base.controlBinding, install: function (graph) { graph.controlBinding = document; } },
    { document: base.controls, install: function (graph) { graph.controls = document; } },
    { document: base.validity, install: function (graph) { graph.validity = document; } },
    { document: base.threat, install: function (graph) { graph.threat = document; } },
    { document: base.budget, install: function (graph) { graph.budget = document; } },
    { document: base.ledger, install: function (graph) { graph.ledger = document; } },
    { document: base.reviewEvidence, install: function (graph) { graph.reviewEvidence = document; } },
    { document: base.budgetAuthorizationEvidence,
      install: function (graph) { graph.budgetAuthorizationEvidence = document; } },
    { document: base.ledgerCheckpointEvidence,
      install: function (graph) { graph.ledgerCheckpointEvidence = document; } },
    { document: base.stageDocuments.suite,
      install: function (graph) { graph.stageDocuments.suite = document; } },
    ...base.stageDocuments.cases.map(function (caseDocument, index) {
      return {
        document: caseDocument,
        install: function (graph) { graph.stageDocuments.cases[index] = document; }
      };
    }),
    { document: base.stageDocuments.statisticalPlan,
      install: function (graph) { graph.stageDocuments.statisticalPlan = document; } },
    { document: base.stageDocuments.riskAssessment,
      install: function (graph) { graph.stageDocuments.riskAssessment = document; } },
    { document: base.stageDocuments.preRun,
      install: function (graph) { graph.stageDocuments.preRun = document; } },
    { document: await readJson(artifactPaths.authorityPolicy) },
    { document: await readJson(artifactPaths.genesisLedger) },
    { document: await readJson(artifactPaths.genesisLedgerCheckpointEvidence) }
  ];
  const candidate = candidates.find(function (entry) {
    return artifactIdentityMatches(entry.document, document);
  });
  if (!candidate) {
    return {
      passed: false,
      issues: ["document is not a member of the externally rooted evaluation-control graph"],
      trustContext: vectors.trustContext
    };
  }
  let issues;
  if (same(candidate.document, document)) {
    positiveGraphIssuesPromise ??= validateGraph(clone(base), artifactPaths, authorityState);
    issues = [...await positiveGraphIssuesPromise];
  } else {
    const graph = clone(base);
    candidate.install?.(graph);
    issues = await validateGraph(graph, artifactPaths, authorityState);
    issues.push("document bytes differ from the authenticated evaluation-control graph artifact");
  }
  return { passed: issues.length === 0, issues, trustContext: vectors.trustContext };
}

export async function verifyMachineContractVectors() {
  const { vectors, artifactPaths, authorityState, base } = await loadCorpus();

  const results = [];
  for (const expectation of vectors.expectations) {
    let issues;
    if (expectation.authorityPolicy) {
      const policyVectors = clone(vectors);
      policyVectors.trustContext.policy = clone(expectation.authorityPolicy);
      issues = (await authenticateAuthorityPolicy(policyVectors)).issues;
    } else {
      let paths = artifactPaths;
      let graph;
      if (expectation.graphArtifacts) {
        paths = { ...artifactPaths };
        for (const [name, relative] of Object.entries(expectation.graphArtifacts)) {
          paths[name] = Array.isArray(relative)
            ? relative.map(function (entry) { return path.resolve(fixtureRoot, entry); })
            : path.resolve(fixtureRoot, relative);
        }
        graph = await loadGraphDocuments(paths);
      } else {
        graph = clone(base);
      }
      for (const mutation of expectation.mutations || []) {
        if (mutation.replaceWithArtifact) {
          graph[mutation.target] = await readJson(paths[mutation.replaceWithArtifact]);
        } else {
          const target = graph[mutation.target];
          if (!target) throw new Error("unknown mutation target " + mutation.target);
          mutate(target, mutation);
        }
      }
      issues = await validateGraph(graph, paths, authorityState);
    }
    const valid = issues.length === 0;
    const expectedError = expectation.valid === false
      && issues.some(function (issue) { return issue.includes(expectation.expectedError); });
    const passed = expectation.valid ? valid : !valid && expectedError;
    results.push({ id: expectation.id, passed, issues });
  }
  const failures = results.filter(function (result) { return !result.passed; });
  return { passed: failures.length === 0, total: results.length, results, failures };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(verifierPath)) {
  const outcome = await verifyMachineContractVectors();
  if (!outcome.passed) {
    for (const failure of outcome.failures) {
      process.stderr.write(failure.id + ":\n");
      for (const issue of failure.issues) process.stderr.write("  - " + issue + "\n");
    }
    process.exitCode = 1;
  } else {
    process.stdout.write("Verified machine-contract vectors passed: "
      + outcome.total + "/" + outcome.total + ".\n");
  }
}
