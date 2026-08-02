import { createHash, createPrivateKey, sign } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, "$1"));
const seed = Buffer.from("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60", "hex");
const pkcs8Prefix = Buffer.from("302e020100300506032b657004220420", "hex");
const privateKey = createPrivateKey({ key: Buffer.concat([pkcs8Prefix, seed]), format: "der", type: "pkcs8" });

function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
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

function codeUnitCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function readJson(absolute) {
  return JSON.parse(await readFile(absolute, "utf8"));
}

async function writeJson(absolute, value) {
  await writeFile(absolute, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function signFixtureArtifact(document) {
  const digestProjection = clone(document);
  delete digestProjection.digest;
  delete digestProjection.signature;
  document.digest = sha256Canonical(digestProjection);
  const signingProjection = clone(document);
  delete signingProjection.signature.value;
  const message = Buffer.concat([
    Buffer.from(document.schemaVersion, "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalize(signingProjection), "utf8")
  ]);
  document.signature.value = sign(null, message, privateKey).toString("base64url");
}

function attestEvidence(evidence) {
  const projection = clone(evidence);
  delete projection.attestation.value;
  const message = Buffer.concat([
    Buffer.from("agent-evals-evidence-artifact-1", "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalize(projection), "utf8")
  ]);
  evidence.attestation.value = sign(null, message, privateKey).toString("base64url");
}

const setOrders = {
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
const keyed = {
  allowedOutcomeProfiles: "id",
  metrics: "id",
  additionalAssuranceRequirements: "id",
  exclusions: "scope",
  requirementMapping: "requirementId"
};

function sortEffective(effective) {
  for (const [field, order] of Object.entries(setOrders)) {
    effective[field] = [...(effective[field] ?? [])].sort((left, right) => order.indexOf(left) - order.indexOf(right));
  }
  for (const [field, key] of Object.entries(keyed)) {
    effective[field] = [...(effective[field] ?? [])].sort((left, right) => codeUnitCompare(left[key], right[key]));
  }
  return effective;
}

function rootEffective(profile) {
  const effective = clone(profile);
  effective.parentProfile = null;
  for (const field of ["fixtures", "conflictReport", "resolutionEvidence", "effectiveProfileDigest", "digest", "signature"]) {
    delete effective[field];
  }
  return sortEffective(effective);
}

function refreshMappingProvenance(record, profile) {
  record.keyedProvenance = (record.keyedProvenance ?? [])
    .filter((entry) => entry.collection !== "requirementMapping");
  record.keyedProvenance.push({
    collection: "requirementMapping",
    keys: profile.requirementMapping.map((entry) => entry.requirementId).sort(codeUnitCompare),
    sourceProfileId: profile.id,
    sourceProfileVersion: profile.version,
    operation: "leaf_complete"
  });
  record.keyedProvenance.sort((left, right) => codeUnitCompare(left.collection, right.collection));
}

async function refreshEvidence(payloadAbsolute, evidence, updatePayload) {
  const payload = await readJson(payloadAbsolute);
  updatePayload(payload);
  const payloadBytes = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await writeFile(payloadAbsolute, payloadBytes);
  evidence.digest = sha256Bytes(payloadBytes);
  evidence.byteLength = payloadBytes.byteLength;
  if (evidence.uri?.startsWith("artifact:sha256:")) evidence.uri = `artifact:${evidence.digest}`;
  attestEvidence(evidence);
  return evidence;
}

async function refreshRootProfile(directoryRelative, manifestDigest) {
  const directory = path.join(root, directoryRelative);
  const profileAbsolute = path.join(directory, "evaluation-profile.json");
  const recordAbsolute = path.join(directory, "profile-resolution.json");
  const profile = await readJson(profileAbsolute);
  const record = await readJson(recordAbsolute);

  for (const fixture of profile.fixtures ?? []) {
    if (fixture.manifestUri.endsWith("conformance/fixtures/manifest.json")) fixture.manifestDigest = manifestDigest;
  }
  const effectiveDigest = sha256Canonical(rootEffective(profile));

  record.profile = { id: profile.id, version: profile.version };
  record.parentChain = [];
  record.replacementProofs = [];
  refreshMappingProvenance(record, profile);
  record.evidenceManifest = [];
  record.effectiveProfileDigest = effectiveDigest;
  signFixtureArtifact(record);
  await writeJson(recordAbsolute, record);

  const resolutionPointer = {
    id: record.id,
    version: record.version,
    uri: "profile-resolution.json",
    digest: record.digest
  };
  profile.resolutionEvidence = resolutionPointer;
  profile.conflictReport.evidence = clone(resolutionPointer);
  profile.effectiveProfileDigest = effectiveDigest;
  signFixtureArtifact(profile);
  await writeJson(profileAbsolute, profile);
  return { profile, effective: rootEffective(profile) };
}

function childEffective(parentEffective, child) {
  const effective = clone(parentEffective);
  for (const field of ["schemaVersion", "id", "namespace", "owner", "version"]) effective[field] = clone(child[field]);
  for (const field of ["signatureProfile", "claimTrustProfile", "claimTrustUse"]) effective[field] = clone(child[field]);
  effective.parentProfile = null;
  for (const field of Object.keys(setOrders)) effective[field] = clone(child[field]);
  effective.gateRegistry = clone(child.gateRegistry);
  effective.requirementMapping = clone(child.requirementMapping);
  return sortEffective(effective);
}

function declaredValue(profile, pointer, key) {
  const segments = pointer.split("/").filter(Boolean).map((segment) => segment
    .replaceAll("~1", "/").replaceAll("~0", "~"));
  let value = profile;
  for (const segment of segments) value = value?.[segment];
  if (key === undefined) return value;
  if (!Array.isArray(value)) return undefined;
  const field = keyed[segments.at(-1)] ?? "id";
  return value.find((entry) => entry?.[field] === key);
}

async function refreshArchitectureChild(parent, manifestDigest) {
  const directory = path.join(root, "conformance", "fixtures");
  const profileAbsolute = path.join(directory, "architecture-evaluation-profile-child.json");
  const recordAbsolute = path.join(directory, "architecture-profile-child-resolution.json");
  const evidenceAbsolute = path.join(directory, "architecture-profile-resolution-evidence.json");
  const payloadAbsolute = path.join(directory, "architecture-profile-resolution-evidence-payload.json");
  const profile = await readJson(profileAbsolute);
  const record = await readJson(recordAbsolute);
  let evidence = await readJson(evidenceAbsolute);
  const parentDirectory = path.join(root, "profiles", "repo-change-v1");
  const childRelativePointer = (uri) => path.relative(directory, path.join(parentDirectory, uri)).replaceAll("\\", "/");

  profile.parentProfile.digest = parent.profile.digest;
  profile.allowedOutcomeProfiles = parent.profile.allowedOutcomeProfiles.map((entry) => ({
    ...clone(entry),
    uri: childRelativePointer(entry.uri)
  }));
  for (const field of ["workArtifactRegistry", "caseQa", "caseContract"]) {
    profile[field] = {
      ...clone(parent.profile[field]),
      uri: childRelativePointer(parent.profile[field].uri)
    };
  }
  for (const fixture of profile.fixtures ?? []) fixture.manifestDigest = manifestDigest;
  const effective = childEffective(parent.effective, profile);
  const effectiveDigest = sha256Canonical(effective);

  record.profile = { id: profile.id, version: profile.version };
  record.parentChain = [clone(profile.parentProfile)];
  for (const pointer of ["/signatureProfile", "/claimTrustProfile", "/claimTrustUse"]) {
    const provenance = record.fieldProvenance.find((entry) => entry.pointer === pointer);
    if (!provenance) throw new Error(`missing field provenance ${pointer}`);
    provenance.sourceProfileId = profile.id;
    provenance.sourceProfileVersion = profile.version;
    provenance.operation = "leaf_identity";
  }
  record.replacementProofs = (record.replacementProofs ?? [])
    .filter((proof) => proof.pointer !== "/requirementMapping")
    .map((proof) => {
      const normalized = clone(proof);
      delete normalized.verifier;
      const parentDeclaration = declaredValue(parent.profile, proof.pointer, proof.key);
      const childDeclaration = declaredValue(profile, proof.pointer, proof.key);
      if (parentDeclaration === undefined || childDeclaration === undefined) {
        throw new Error(`cannot refresh replacement proof ${proof.pointer}${proof.key === undefined ? "" : `/${proof.key}`}`);
      }
      normalized.parent = clone(parentDeclaration);
      normalized.child = clone(childDeclaration);
      return normalized;
    });
  refreshMappingProvenance(record, profile);

  evidence = await refreshEvidence(payloadAbsolute, evidence, (payload) => {
    payload.profile = { id: profile.id, version: profile.version };
    payload.proofInputs = record.replacementProofs.map((proof) => ({
      target: `${proof.pointer}${proof.key === undefined ? "" : `/${proof.key}`}`,
      parent: clone(proof.parent),
      child: clone(proof.child)
    }));
  });
  await writeJson(evidenceAbsolute, evidence);

  record.evidenceManifest = [clone(evidence)];
  record.effectiveProfileDigest = effectiveDigest;
  signFixtureArtifact(record);
  await writeJson(recordAbsolute, record);

  const resolutionPointer = {
    id: record.id,
    version: record.version,
    uri: "architecture-profile-child-resolution.json",
    digest: record.digest
  };
  profile.resolutionEvidence = resolutionPointer;
  profile.conflictReport.evidence = clone(resolutionPointer);
  profile.effectiveProfileDigest = effectiveDigest;
  signFixtureArtifact(profile);
  await writeJson(profileAbsolute, profile);
}

async function refreshRepoChangeDependencies() {
  const directory = path.join(root, "profiles", "repo-change-v1");
  const outcomeAbsolute = path.join(directory, "outcome-profile.json");
  const caseContractAbsolute = path.join(directory, "case-contract.json");
  const profileAbsolute = path.join(directory, "evaluation-profile.json");
  const scorecardContractAbsolute = path.join(root, "standard", "scorecard-contract.md");
  const workRegistryAbsolute = path.join(root, "standard", "work-artifact-registry.json");
  const caseQaAbsolute = path.join(directory, "case-qa-contract.json");

  const outcome = await readJson(outcomeAbsolute);
  const scorecardContractDigest = sha256Bytes(await readFile(scorecardContractAbsolute));
  const workRegistryDigest = sha256Bytes(await readFile(workRegistryAbsolute));
  outcome.workArtifactRegistry.digest = workRegistryDigest;
  outcome.functionalSuccess.contractDigest = scorecardContractDigest;
  outcome.acceptedOutcome.contractDigest = scorecardContractDigest;
  signFixtureArtifact(outcome);
  await writeJson(outcomeAbsolute, outcome);

  const profile = await readJson(profileAbsolute);
  profile.workArtifactRegistry.digest = workRegistryDigest;
  profile.caseQa.digest = sha256Bytes(await readFile(caseQaAbsolute));
  const outcomeBinding = (profile.allowedOutcomeProfiles ?? []).find((entry) => entry.id === outcome.id);
  if (!outcomeBinding) throw new Error(`repo-change profile does not bind outcome ${outcome.id}`);
  outcomeBinding.digest = outcome.digest;
  profile.caseContract.digest = sha256Bytes(await readFile(caseContractAbsolute));
  await writeJson(profileAbsolute, profile);
}

async function refreshRepositoryReviewDependencies() {
  const directory = path.join(root, "profiles", "repository-review-v1");
  const outcomeAbsolute = path.join(directory, "outcome-profile.json");
  const profileAbsolute = path.join(directory, "evaluation-profile.json");
  const scorecardContractAbsolute = path.join(root, "standard", "scorecard-contract.md");
  const workRegistryAbsolute = path.join(root, "standard", "work-artifact-registry.json");
  const workRegistryDigest = sha256Bytes(await readFile(workRegistryAbsolute));
  const scorecardContractDigest = sha256Bytes(await readFile(scorecardContractAbsolute));

  const outcome = await readJson(outcomeAbsolute);
  outcome.workArtifactRegistry.digest = workRegistryDigest;
  outcome.functionalSuccess.contractDigest = scorecardContractDigest;
  outcome.acceptedOutcome.contractDigest = scorecardContractDigest;
  signFixtureArtifact(outcome);
  await writeJson(outcomeAbsolute, outcome);

  const profile = await readJson(profileAbsolute);
  profile.workArtifactRegistry.digest = workRegistryDigest;
  profile.caseQa.digest = sha256Bytes(await readFile(path.join(directory, "case-qa-contract.json")));
  profile.caseContract.digest = sha256Bytes(await readFile(path.join(directory, "case-contract.json")));
  const outcomeBinding = (profile.allowedOutcomeProfiles ?? []).find((entry) => entry.id === outcome.id);
  if (!outcomeBinding) throw new Error(`repository-review profile does not bind outcome ${outcome.id}`);
  outcomeBinding.digest = outcome.digest;
  await writeJson(profileAbsolute, profile);
}

await refreshRepoChangeDependencies();
await refreshRepositoryReviewDependencies();
const manifestDigest = sha256Bytes(await readFile(path.join(root, "conformance", "fixtures", "manifest.json")));
const repoChange = await refreshRootProfile("profiles/repo-change-v1", manifestDigest);
const reviewVerifierDigest = sha256Bytes(await readFile(path.join(root, "profiles", "repository-review-v1", "verify-profile.mjs")));
await refreshRootProfile("profiles/repository-review-v1", manifestDigest);
{
  const terminalEvidenceAbsolute = path.join(
    root,
    "conformance",
    "fixtures",
    "repository-review-v1",
    "positive",
    "review-decision-evidence.json"
  );
  const terminalPayloadAbsolute = path.join(
    root,
    "conformance",
    "fixtures",
    "repository-review-v1",
    "positive",
    "review-decision-payload.json"
  );
  let terminalEvidence = await readJson(terminalEvidenceAbsolute);
  terminalEvidence.schemaMetadata.validatorDigest = reviewVerifierDigest;
  terminalEvidence = await refreshEvidence(terminalPayloadAbsolute, terminalEvidence, () => {});
  await writeJson(terminalEvidenceAbsolute, terminalEvidence);
}
await refreshArchitectureChild(repoChange, manifestDigest);
process.stdout.write("Refreshed scoped requirement-routing profile artifacts.\n");
