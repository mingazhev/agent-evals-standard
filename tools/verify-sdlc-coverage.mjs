import { createHash, verify } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const CAPABILITIES = [
  "CAP.DISCOVER_SPECIFY",
  "CAP.PLAN_DESIGN",
  "CAP.IMPLEMENT_CHANGE",
  "CAP.VERIFY_ASSURE",
  "CAP.REVIEW_DECIDE",
  "CAP.RELEASE_OPERATE",
  "CAP.REMEDIATE_LEARN"
];

function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function selfDigest(document) {
  const projection = structuredClone(document);
  delete projection.digest;
  delete projection.signature;
  return sha256(Buffer.from(canonicalize(projection), "utf8"));
}

function sameSet(left, right) {
  const a = new Set(left ?? []);
  const b = new Set(right ?? []);
  return a.size === (left ?? []).length && b.size === (right ?? []).length
    && a.size === b.size && [...a].every((value) => b.has(value));
}

function resolveInside(root, base, candidate) {
  const absolute = path.resolve(base, candidate);
  const relative = path.relative(root, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`path escapes repository root: ${candidate}`);
  return absolute;
}

function fixtureSignatureProblem(document, fixtureKey) {
  const signature = document.signature;
  if (signature?.profileId !== "fixture-signature-profile" || signature.algorithm !== "Ed25519"
    || signature.keyId !== "rfc8032-test-key-1") return "unrecognized fixture signature identity";
  const projection = structuredClone(document);
  delete projection.signature.value;
  const message = Buffer.concat([
    Buffer.from(document.schemaVersion, "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalize(projection), "utf8")
  ]);
  try {
    return verify(null, message, fixtureKey, Buffer.from(signature.value, "base64url"))
      ? null : "Ed25519 verification failed";
  } catch (error) {
    return `signature verifier error: ${error.message}`;
  }
}

function exact(expected, actual, label, issues) {
  if (!sameSet(expected, actual)) issues.push(`sdlcCoverage: ${label} must be exactly [${expected.join(", ")}]`);
}

export async function checkSdlcCoverage(suite, sourceAbsolute, issues, context) {
  const { root, fixtureKey, validateCoverage, validateWorkArtifactRegistry } = context;
  const pointer = suite.sdlcCoverage;
  if (!pointer) {
    issues.push("sdlcCoverage: suite pointer is required");
    return;
  }

  let coverage;
  let coverageAbsolute;
  try {
    coverageAbsolute = resolveInside(root, path.dirname(sourceAbsolute), pointer.uri);
    const bytes = await readFile(coverageAbsolute);
    if (pointer.digest !== sha256(bytes)) issues.push(`sdlcCoverage: pointer digest must be ${sha256(bytes)}`);
    coverage = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    issues.push(`sdlcCoverage: cannot resolve coverage map: ${error.message}`);
    return;
  }

  if (validateCoverage && !validateCoverage(coverage)) {
    issues.push(`sdlcCoverage: coverage map is schema-invalid: ${(validateCoverage.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ")}`);
    return;
  }
  if (coverage.id !== pointer.id || coverage.version !== pointer.version) {
    issues.push("sdlcCoverage: pointer identity or version differs from the coverage map");
  }
  if (coverage.digest !== selfDigest(coverage)) issues.push(`sdlcCoverage: self digest must be ${selfDigest(coverage)}`);
  const signatureProblem = fixtureSignatureProblem(coverage, fixtureKey);
  if (signatureProblem) issues.push(`sdlcCoverage: ${signatureProblem}`);
  if (coverage.suite?.id !== suite.id || coverage.suite?.version !== suite.version) {
    issues.push("sdlcCoverage: coverage map belongs to a different suite");
  }

  let registry;
  try {
    const registryPointer = coverage.workArtifactRegistry;
    const registryAbsolute = resolveInside(root, path.dirname(coverageAbsolute), registryPointer.uri);
    const bytes = await readFile(registryAbsolute);
    const actualDigest = sha256(bytes);
    if (registryPointer.digest !== actualDigest) issues.push(`sdlcCoverage: work-artifact registry digest must be ${actualDigest}`);
    registry = JSON.parse(bytes.toString("utf8"));
    if (registry.id !== registryPointer.id || registry.version !== registryPointer.version) {
      issues.push("sdlcCoverage: work-artifact registry identity or version differs from its pointer");
    }
    if (validateWorkArtifactRegistry && !validateWorkArtifactRegistry(registry)) {
      issues.push(`sdlcCoverage: work-artifact registry is schema-invalid: ${(validateWorkArtifactRegistry.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ")}`);
      registry = null;
    }
  } catch (error) {
    issues.push(`sdlcCoverage: cannot resolve work-artifact registry: ${error.message}`);
  }
  if (!registry) return;

  const entries = coverage.capabilities ?? [];
  exact(CAPABILITIES, entries.map((entry) => entry.capabilityId), "capability rows", issues);
  const registryByType = new Map((registry.artifactTypes ?? []).map((entry) => [entry.id, entry.capabilityFamilyId]));
  const cases = suite.cases ?? [];
  const suiteProfileIds = new Set((suite.evaluationProfiles ?? []).map((entry) => entry.id));

  for (const caseRecord of cases) {
    if (!suiteProfileIds.has(caseRecord.evaluationProfile?.id)) {
      issues.push(`sdlcCoverage: case ${caseRecord.id} uses an evaluation profile outside suite.evaluationProfiles`);
    }
    const declaredFamilies = caseRecord.capabilityFamilyIds ?? [];
    const mappedFamilies = [...new Set((caseRecord.workArtifactTypes ?? []).map((type) => registryByType.get(type)).filter(Boolean))];
    for (const type of caseRecord.workArtifactTypes ?? []) {
      if (!registryByType.has(type)) issues.push(`sdlcCoverage: case ${caseRecord.id} uses unregistered work artifact ${type}`);
    }
    exact(mappedFamilies, declaredFamilies, `case ${caseRecord.id} material capability projection`, issues);
  }

  for (const capabilityId of CAPABILITIES) {
    const entry = entries.find((candidate) => candidate.capabilityId === capabilityId);
    if (!entry) continue;
    const matchingCases = cases.filter((caseRecord) => (caseRecord.capabilityFamilyIds ?? []).includes(capabilityId));
    const expectedCaseIds = matchingCases.map((caseRecord) => caseRecord.id);
    const expectedProfileIds = [...new Set(matchingCases.map((caseRecord) => caseRecord.evaluationProfile?.id).filter(Boolean))];
    const expectedOutcomeIds = [...new Set(matchingCases.map((caseRecord) => caseRecord.outcomeProfile?.id).filter(Boolean))];
    const expectedWorkTypes = [...new Set(matchingCases.flatMap((caseRecord) => (caseRecord.workArtifactTypes ?? [])
      .filter((type) => registryByType.get(type) === capabilityId)))];

    if (matchingCases.length === 0) {
      if (entry.status !== "gap" || entry.claimEffect !== "forbidden_until_covered") {
        issues.push(`sdlcCoverage: ${capabilityId} has no material case and must be a claim-forbidden gap`);
      }
      exact([], entry.caseIds, `${capabilityId} gap caseIds`, issues);
      exact([], entry.evaluationProfileIds, `${capabilityId} gap evaluationProfileIds`, issues);
      exact([], entry.outcomeProfileIds, `${capabilityId} gap outcomeProfileIds`, issues);
      exact([], entry.workArtifactTypes, `${capabilityId} gap workArtifactTypes`, issues);
    } else {
      if (entry.status !== "covered" || entry.claimEffect !== "claimable_only_for_listed_cases") {
        issues.push(`sdlcCoverage: ${capabilityId} has material cases and must be bounded to exactly those cases`);
      }
      exact(expectedCaseIds, entry.caseIds, `${capabilityId} covered caseIds`, issues);
      exact(expectedProfileIds, entry.evaluationProfileIds, `${capabilityId} covered evaluationProfileIds`, issues);
      exact(expectedOutcomeIds, entry.outcomeProfileIds, `${capabilityId} covered outcomeProfileIds`, issues);
      exact(expectedWorkTypes, entry.workArtifactTypes, `${capabilityId} covered workArtifactTypes`, issues);
    }
  }
}
