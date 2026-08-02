import { createHash, verify } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

function signatureProblem(document, fixtureKey) {
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

function samePointer(left, right) {
  return left?.id === right?.id && left?.version === right?.version
    && left?.digest === right?.digest;
}

async function resolveBound(pointer, base, root, fixtureKey, validate, label, issues, requireSigned = true) {
  try {
    const absolute = resolveInside(root, base, pointer.uri);
    const bytes = await readFile(absolute);
    const actualDigest = sha256(bytes);
    const declaredRawDigest = requireSigned ? pointer.rawDigest : pointer.digest;
    if (declaredRawDigest !== actualDigest) issues.push(`caseValidity: ${label} raw digest must be ${actualDigest}`);
    const document = JSON.parse(bytes.toString("utf8"));
    if (document.id !== pointer.id || document.version !== pointer.version) {
      issues.push(`caseValidity: ${label} identity or version differs from its pointer`);
    }
    if (validate && !validate(document)) {
      issues.push(`caseValidity: ${label} is schema-invalid: ${(validate.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ")}`);
      return null;
    }
    if (requireSigned) {
      const actualSubjectDigest = selfDigest(document);
      if (document.digest !== actualSubjectDigest) issues.push(`caseValidity: ${label} self digest must be ${actualSubjectDigest}`);
      if (pointer.subjectDigest !== document.digest) {
        issues.push(`caseValidity: ${label} subjectDigest differs from the authenticated document digest`);
      }
      const problem = signatureProblem(document, fixtureKey);
      if (problem) issues.push(`caseValidity: ${label} ${problem}`);
    }
    return { document, absolute };
  } catch (error) {
    issues.push(`caseValidity: cannot resolve ${label}: ${error.message}`);
    return null;
  }
}

export async function verifyCaseValidityArgument(validity, validityAbsolute, issues, context) {
  const { root, fixtureKey, validateValidity, validateProfile, validateOutcome, validateWorkArtifactRegistry } = context;
  if (validateValidity && !validateValidity(validity)) {
    issues.push(`caseValidity: validity argument is schema-invalid: ${(validateValidity.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ")}`);
    return false;
  }
  if (validity.digest !== selfDigest(validity)) issues.push(`caseValidity: self digest must be ${selfDigest(validity)}`);
  const validitySignatureProblem = signatureProblem(validity, fixtureKey);
  if (validitySignatureProblem) issues.push(`caseValidity: ${validitySignatureProblem}`);

  try {
    const verifierAbsolute = resolveInside(root, path.dirname(validityAbsolute), validity.verifier.uri);
    const verifierBytes = await readFile(verifierAbsolute);
    const actualVerifierDigest = sha256(verifierBytes);
    if (validity.verifier.digest !== actualVerifierDigest) {
      issues.push(`caseValidity: verifier digest must be ${actualVerifierDigest}`);
    }
    if (path.resolve(verifierAbsolute) !== path.resolve(fileURLToPath(import.meta.url))) {
      issues.push("caseValidity: verifier URI does not resolve to the executing verifier module");
    }
  } catch (error) {
    issues.push(`caseValidity: cannot reproduce verifier bytes: ${error.message}`);
  }

  const profilePointer = validity.effectiveEvaluationProfile ?? {};
  const profileResolved = await resolveBound(profilePointer, path.dirname(validityAbsolute), root, fixtureKey,
    validateProfile, "effective evaluation profile", issues);
  const outcomePointer = validity.selectedOutcomeProfile ?? {};
  const outcomeResolved = await resolveBound(outcomePointer, path.dirname(validityAbsolute), root, fixtureKey,
    validateOutcome, "selected outcome profile", issues);
  if (!profileResolved || !outcomeResolved) return false;
  const profile = profileResolved.document;
  const outcome = outcomeResolved.document;

  if (profile.effectiveProfileDigest !== profilePointer.effectiveProfileDigest
    || !sameSet(profile.interactionModes, profilePointer.interactionModes)
    || !sameSet(profile.capabilityFamilies, profilePointer.capabilityFamilies)
    || !samePointer(profile.workArtifactRegistry, profilePointer.workArtifactRegistry)) {
    issues.push("caseValidity: signed effective-profile projection differs from the resolved profile");
  }
  if (!sameSet(outcome.workArtifactTypes, outcomePointer.workArtifactTypes)
    || !samePointer(outcome.workArtifactRegistry, outcomePointer.workArtifactRegistry)) {
    issues.push("caseValidity: signed outcome-profile projection differs from the resolved outcome profile");
  }
  if (!(profile.allowedOutcomeProfiles ?? []).some((entry) => entry.id === outcomePointer.id
    && entry.version === outcomePointer.version && entry.digest === outcomePointer.subjectDigest)) {
    issues.push("caseValidity: selected outcome profile is not allowed by the effective evaluation profile");
  }
  if (!samePointer(profile.workArtifactRegistry, outcome.workArtifactRegistry)) {
    issues.push("caseValidity: profile and outcome use different work-artifact registries");
  }

  const registryResolved = await resolveBound(profile.workArtifactRegistry, path.dirname(profileResolved.absolute), root,
    fixtureKey, validateWorkArtifactRegistry, "work-artifact registry", issues, false);
  if (!registryResolved) return false;
  const registryByType = new Map((registryResolved.document.artifactTypes ?? [])
    .map((entry) => [entry.id, entry.capabilityFamilyId]));

  const constructIds = (validity.constructRegistry ?? []).map((entry) => entry.id);
  if (new Set(constructIds).size !== constructIds.length) issues.push("caseValidity: construct IDs must be unique");
  for (const construct of validity.constructRegistry ?? []) {
    const mappedFamilies = [];
    for (const type of construct.workArtifactTypes ?? []) {
      const family = registryByType.get(type);
      if (!family) issues.push(`caseValidity: construct ${construct.id} uses unregistered work artifact ${type}`);
      else mappedFamilies.push(family);
    }
    if (construct.materiality === "material" && !sameSet([...new Set(mappedFamilies)], construct.capabilityFamilyIds)) {
      issues.push(`caseValidity: construct ${construct.id} capability mapping differs from the standard work-artifact registry`);
    }
    if (construct.materiality === "ancillary" && (construct.capabilityFamilyIds ?? []).length !== 0) {
      issues.push(`caseValidity: ancillary construct ${construct.id} cannot authorize a capability family`);
    }
  }

  const expected = validity.fullCaseExpectation ?? {};
  for (const family of expected.capabilityFamilyIds ?? []) {
    if (!(profile.capabilityFamilies ?? []).includes(family)) {
      issues.push(`caseValidity: full-case capability ${family} is outside the authenticated evaluation profile`);
    }
  }
  for (const type of expected.workArtifactTypes ?? []) {
    if (!(outcome.workArtifactTypes ?? []).includes(type)) {
      issues.push(`caseValidity: full-case work artifact ${type} is outside the authenticated outcome profile`);
    }
    const family = registryByType.get(type);
    if (family && !(expected.capabilityFamilyIds ?? []).includes(family)) {
      issues.push(`caseValidity: full-case work artifact ${type} introduces passenger capability ${family}`);
    }
  }
  if (!(profile.interactionModes ?? []).includes(expected.interactionModeId)) {
    issues.push("caseValidity: full-case interaction mode is outside the authenticated evaluation profile");
  }

  return issues.length === 0;
}
