import { createHash, createPublicKey, verify } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  PRODUCTION_DERIVED_PROOF_KINDS,
  PRODUCTION_DERIVED_VERIFIER_ID,
  PRODUCTION_DERIVED_VERIFIER_VERSION,
  verifyProductionDerivedProof
} from "../profiles/repo-change-v1/verify-production-derived.mjs";

const ROLE_BY_PROOF_KIND = Object.freeze({
  production_input_provenance: "data-provenance",
  data_owner_authorization: "data-owner",
  redaction_verification: "privacy-verifier",
  reidentification_assessment: "privacy-verifier",
  production_path_isolation: "environment-verifier"
});

function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function sha256Canonical(value) {
  return sha256(Buffer.from(canonicalize(value), "utf8"));
}

function clone(value) {
  return structuredClone(value);
}

function resolveInside(root, base, candidate) {
  const absolute = path.resolve(base, candidate);
  const relative = path.relative(root, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`path escapes repository root: ${candidate}`);
  }
  return absolute;
}

async function readJson(absolute) {
  return JSON.parse(await readFile(absolute, "utf8"));
}

function locatorDigest(uri) {
  const match = /^artifact:sha256:([a-f0-9]{64})$/.exec(uri ?? "");
  return match ? `sha256:${match[1]}` : null;
}

function sameJson(left, right) {
  return canonicalize(left) === canonicalize(right);
}

function samePointer(left, right) {
  return left?.id === right?.id && left?.uri === right?.uri && left?.digest === right?.digest;
}

function sameComponent(left, right) {
  return left?.id === right?.id && left?.version === right?.version && left?.digest === right?.digest;
}

function sameAuthorityPointer(left, right) {
  return samePointer(left, right) && left?.version === right?.version
    && left?.schemaId === right?.schemaId && left?.byteLength === right?.byteLength;
}

function instant(value, label, issues) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) issues.push(`productionDerivedInput: ${label} is not a valid instant`);
  return parsed;
}

function exactIds(expected, actual, label, issues) {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  if (expectedSet.size !== expected.length || actualSet.size !== actual.length
    || expectedSet.size !== actualSet.size || [...expectedSet].some((id) => !actualSet.has(id))) {
    issues.push(`productionDerivedInput: ${label} must be exactly ${expected.join(", ")}`);
  }
}

function schemaProblems(validate, value) {
  if (!validate) return ["required schema validator was not supplied"];
  if (validate(value)) return [];
  return (validate.errors ?? []).map((error) => `${error.instancePath || "/"} ${error.message}`);
}

function evidenceSignatureProblem(artifact, authority, publicKey) {
  const signature = artifact.attestation ?? {};
  const authorized = authority.attestation ?? {};
  if (signature.profileId !== authorized.profileId || signature.algorithm !== authorized.algorithm
    || signature.keyId !== authorized.keyId) {
    return "attestation identity is not authorized by the sealed authority contract";
  }
  const projection = clone(artifact);
  delete projection.attestation.value;
  const message = Buffer.concat([
    Buffer.from("agent-evals-evidence-artifact-1", "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalize(projection), "utf8")
  ]);
  try {
    return verify(null, message, publicKey, Buffer.from(signature.value, "base64url"))
      ? null
      : "Ed25519 verification failed for the authorized key";
  } catch (error) {
    return `attestation verifier error: ${error.message}`;
  }
}

async function loadTrustedVerifier(root, registry, issues) {
  if (!Array.isArray(registry)) {
    issues.push("productionDerivedInput: evaluator-controlled productionDerivedVerifierRegistry is required");
    return null;
  }
  const matches = registry.filter((entry) => entry?.id === PRODUCTION_DERIVED_VERIFIER_ID
    && entry?.version === PRODUCTION_DERIVED_VERIFIER_VERSION);
  if (matches.length !== 1) {
    issues.push(`productionDerivedInput: trusted verifier registry must contain exactly one ${PRODUCTION_DERIVED_VERIFIER_ID}@${PRODUCTION_DERIVED_VERIFIER_VERSION}`);
    return null;
  }
  const entry = matches[0];
  try {
    const bytes = await readFile(resolveInside(root, root, entry.path));
    const actualDigest = sha256(bytes);
    if (entry.digest !== actualDigest) {
      issues.push(`productionDerivedInput: trusted verifier registry digest must bind ${actualDigest}`);
      return null;
    }
    return { id: entry.id, version: entry.version, digest: actualDigest };
  } catch (error) {
    issues.push(`productionDerivedInput: cannot authenticate trusted verifier bytes: ${error.message}`);
    return null;
  }
}

async function loadAuthorityContract(document, bundle, bundleAbsolute, context, issues) {
  const pointer = document.productionDerivedInput?.authorityContract;
  const bundled = bundle.authorityContract;
  if (!sameAuthorityPointer(pointer, bundled)) {
    issues.push("productionDerivedInput: authority contract differs from the evidence-bundle pointer");
    return null;
  }
  let bytes;
  let authorityContract;
  try {
    bytes = await readFile(resolveInside(context.root, path.dirname(bundleAbsolute), bundled.payloadPath));
    authorityContract = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    issues.push(`productionDerivedInput: cannot resolve authority-contract bytes: ${error.message}`);
    return null;
  }
  const actualDigest = sha256(bytes);
  if (pointer.digest !== actualDigest || locatorDigest(pointer.uri) !== actualDigest) {
    issues.push(`productionDerivedInput: authority-contract pointer must bind ${actualDigest}`);
  }
  if (pointer.byteLength !== bytes.length) {
    issues.push(`productionDerivedInput: authority-contract byteLength must be ${bytes.length}`);
  }
  if (authorityContract.id !== pointer.id || authorityContract.version !== pointer.version
    || authorityContract.schemaVersion !== "agent-eval-production-derived-authority-contract-1") {
    issues.push("productionDerivedInput: authority-contract identity does not match its sealed pointer");
  }
  const digestProjection = clone(authorityContract);
  delete digestProjection.digest;
  const expectedSelfDigest = sha256Canonical(digestProjection);
  if (authorityContract.digest !== expectedSelfDigest) {
    issues.push(`productionDerivedInput: authority-contract self digest must be ${expectedSelfDigest}`);
  }
  for (const problem of schemaProblems(context.validateProductionDerivedAuthorityContract, authorityContract)) {
    issues.push(`productionDerivedInput: authority contract is schema-invalid: ${problem}`);
  }
  return authorityContract;
}

function validateAuthorityTopology(contract, trustedVerifier, issues) {
  const authorities = contract?.authorities ?? [];
  const policies = contract?.proofPolicies ?? [];
  const authorityIds = authorities.map((authority) => authority.authorityId);
  const policyKinds = policies.map((policy) => policy.proofKind);
  exactIds(authorityIds, [...new Set(authorityIds)], "unique authority IDs", issues);
  exactIds(PRODUCTION_DERIVED_PROOF_KINDS, policyKinds, "proof-policy kinds", issues);

  const authoritiesById = new Map(authorities.map((authority) => [authority.authorityId, authority]));
  const policiesByKind = new Map(policies.map((policy) => [policy.proofKind, policy]));
  const referencedAuthorityIds = policies.map((policy) => policy.authorityId);
  exactIds([...new Set(referencedAuthorityIds)], authorityIds, "referenced authority IDs", issues);

  const publicKeysByAuthority = new Map();
  for (const authority of authorities) {
    const publicKeyRecord = authority.attestation?.publicKey ?? {};
    try {
      const der = Buffer.from(publicKeyRecord.contentBase64 ?? "", "base64");
      const actualDigest = sha256(der);
      if (publicKeyRecord.digest !== actualDigest) {
        issues.push(`productionDerivedInput: authority ${authority.authorityId} public-key digest must be ${actualDigest}`);
      }
      publicKeysByAuthority.set(authority.authorityId, createPublicKey({ key: der, format: "der", type: "spki" }));
    } catch (error) {
      issues.push(`productionDerivedInput: authority ${authority.authorityId} public key is invalid: ${error.message}`);
    }
  }

  for (const policy of policies) {
    const authority = authoritiesById.get(policy.authorityId);
    if (!authority) {
      issues.push(`productionDerivedInput: proof policy ${policy.proofKind} names an unknown authority`);
      continue;
    }
    if (authority.producer?.role !== ROLE_BY_PROOF_KIND[policy.proofKind]) {
      issues.push(`productionDerivedInput: proof policy ${policy.proofKind} requires producer role ${ROLE_BY_PROOF_KIND[policy.proofKind]}`);
    }
    if (!trustedVerifier || !sameComponent(policy.verifier, trustedVerifier)) {
      issues.push(`productionDerivedInput: proof policy ${policy.proofKind} verifier is absent from the evaluator-controlled registry`);
    }
  }

  const privacyPolicy = policiesByKind.get("redaction_verification");
  const reidentificationPolicy = policiesByKind.get("reidentification_assessment");
  if (privacyPolicy?.authorityId !== reidentificationPolicy?.authorityId) {
    issues.push("productionDerivedInput: redaction and re-identification must use the same accountable privacy authority");
  }

  const separatedKinds = contract?.separation?.independentProofKinds ?? [];
  const separatedAuthorities = separatedKinds.map((kind) => authoritiesById.get(policiesByKind.get(kind)?.authorityId));
  if (separatedAuthorities.some((authority) => !authority)) {
    issues.push("productionDerivedInput: separation rules do not resolve to three authorities");
  } else {
    const producerIds = separatedAuthorities.map((authority) => authority.producer.id);
    const trustDomains = separatedAuthorities.map((authority) => authority.producer.trustDomain);
    const keyIds = separatedAuthorities.map((authority) => authority.attestation.keyId);
    if (new Set(producerIds).size !== producerIds.length) {
      issues.push("productionDerivedInput: data owner, privacy, and isolation producer IDs must be distinct");
    }
    if (new Set(trustDomains).size !== trustDomains.length) {
      issues.push("productionDerivedInput: data owner, privacy, and isolation trust domains must be distinct");
    }
    if (new Set(keyIds).size !== keyIds.length) {
      issues.push("productionDerivedInput: data owner, privacy, and isolation attestation key IDs must be distinct");
    }
  }
  return { authoritiesById, policiesByKind, publicKeysByAuthority };
}

export async function checkProductionDerivedInput(document, _sourceAbsolute, issues, fixture, context) {
  if (document.inputOrigin !== "production_derived") {
    if (document.productionDerivedInput !== null) {
      issues.push("productionDerivedInput: non-production input must not carry a production proof bundle");
    }
    return;
  }
  if (!fixture?.relatedPath || !fixture?.evidencePath) {
    issues.push("productionDerivedInput: semantic validation requires pre-run relatedPath and evidencePath");
    return;
  }

  const { root, fixtureDirectory, validateEvidenceArtifact } = context;
  let preRun;
  let bundle;
  let bundleAbsolute;
  try {
    preRun = await readJson(resolveInside(root, fixtureDirectory, fixture.relatedPath));
    bundleAbsolute = resolveInside(root, fixtureDirectory, fixture.evidencePath);
    bundle = await readJson(bundleAbsolute);
  } catch (error) {
    issues.push(`productionDerivedInput: cannot load sealed context or evidence bundle: ${error.message}`);
    return;
  }

  for (const problem of schemaProblems(context.validatePreRunManifest, preRun)) {
    issues.push(`productionDerivedInput: consuming pre-run manifest is schema-invalid: ${problem}`);
  }

  if (typeof context.authenticatePreRun !== "function") {
    issues.push("productionDerivedInput: evaluator-controlled pre-run authenticator is required");
  } else {
    try {
      const authenticationProblem = await context.authenticatePreRun(preRun);
      if (authenticationProblem) {
        issues.push(`productionDerivedInput: consuming pre-run manifest is not authenticated: ${authenticationProblem}`);
      }
    } catch (error) {
      issues.push(`productionDerivedInput: pre-run authentication failed: ${error.message}`);
    }
  }

  const environmentBindings = (preRun.arms ?? []).map((arm) => arm.environment).filter(Boolean);
  if (!environmentBindings.some((binding) => sameComponent(binding, document))) {
    issues.push("productionDerivedInput: consuming pre-run manifest does not seal this environment contract");
  }

  const trustedVerifier = await loadTrustedVerifier(root, context.productionDerivedVerifierRegistry, issues);
  const authorityContract = await loadAuthorityContract(document, bundle, bundleAbsolute, context, issues);
  const topology = validateAuthorityTopology(authorityContract, trustedVerifier, issues);

  const contract = document.productionDerivedInput ?? {};
  const snapshot = contract.inputSnapshot ?? {};
  const sealedAt = instant(preRun.sealedAt, "pre-run sealedAt", issues);
  const sourceCutoff = instant(contract.sourceCutoff, "sourceCutoff", issues);
  const snapshotCreatedAt = instant(snapshot.createdAt, "inputSnapshot.createdAt", issues);
  if (sourceCutoff >= sealedAt) {
    issues.push("productionDerivedInput: sourceCutoff must be strictly earlier than pre-run sealedAt");
  }
  if (sourceCutoff > snapshotCreatedAt) {
    issues.push("productionDerivedInput: sourceCutoff must not be later than inputSnapshot.createdAt");
  }
  if (snapshotCreatedAt > sealedAt) {
    issues.push("productionDerivedInput: inputSnapshot.createdAt must not be later than pre-run sealedAt");
  }

  let snapshotPayload = null;
  if (!samePointer(snapshot, bundle.snapshot) || snapshot.byteLength !== bundle.snapshot?.byteLength) {
    issues.push("productionDerivedInput: inputSnapshot differs from the evidence-bundle snapshot");
  }
  try {
    const snapshotBytes = await readFile(resolveInside(root, path.dirname(bundleAbsolute), bundle.snapshot.payloadPath));
    const actualDigest = sha256(snapshotBytes);
    if (snapshot.digest !== actualDigest || locatorDigest(snapshot.uri) !== actualDigest) {
      issues.push(`productionDerivedInput: inputSnapshot digest and URI must bind ${actualDigest}`);
    }
    if (snapshot.byteLength !== snapshotBytes.length) {
      issues.push(`productionDerivedInput: inputSnapshot byteLength must be ${snapshotBytes.length}`);
    }
    snapshotPayload = JSON.parse(snapshotBytes.toString("utf8"));
    if (snapshotPayload.sourceCutoff !== contract.sourceCutoff) {
      issues.push("productionDerivedInput: snapshot payload sourceCutoff differs from the sealed contract");
    }
    if (typeof snapshotPayload.datasetId !== "string" || snapshotPayload.datasetId.length === 0
      || !Array.isArray(snapshotPayload.records) || snapshotPayload.records.length === 0) {
      issues.push("productionDerivedInput: snapshot payload requires a datasetId and at least one record");
    }
  } catch (error) {
    issues.push(`productionDerivedInput: cannot reproduce inputSnapshot bytes: ${error.message}`);
  }

  const entries = bundle.evidenceArtifacts ?? [];
  const entryIds = entries.map((entry) => entry.artifact?.id);
  const expectedIds = [
    contract.provenance?.evidence?.id,
    contract.dataOwnerAuthorization?.proof?.evidence?.id,
    contract.redactionVerification?.proof?.evidence?.id,
    contract.reidentificationAssessment?.proof?.evidence?.id,
    contract.productionIsolationVerification?.proof?.evidence?.id
  ];
  exactIds(expectedIds, entryIds, "authenticated evidence IDs", issues);
  const entriesById = new Map(entries.map((entry) => [entry.artifact?.id, entry]));

  const authorization = contract.dataOwnerAuthorization ?? {};
  const boundary = contract.productionIsolationVerification ?? {};
  const expectedByKind = {
    production_input_provenance: {
      snapshotDigest: snapshot.digest,
      sourceCutoff: contract.sourceCutoff,
      sourceSystemIds: contract.sourceSystemIds,
      datasetId: snapshotPayload?.datasetId,
      sourceRecordCount: snapshotPayload?.records?.length,
      provenanceControl: contract.provenanceControl
    },
    data_owner_authorization: {
      snapshotDigest: snapshot.digest,
      ownerId: authorization.ownerId,
      purpose: authorization.purpose,
      decision: authorization.decision,
      authorizedAt: authorization.authorizedAt
    },
    redaction_verification: {
      snapshotDigest: snapshot.digest,
      policy: contract.redactionVerification?.policy
    },
    reidentification_assessment: {
      snapshotDigest: snapshot.digest,
      method: contract.reidentificationAssessment?.method,
      maximumResidualRisk: contract.reidentificationAssessment?.maximumResidualRisk,
      decision: contract.reidentificationAssessment?.decision
    },
    production_path_isolation: {
      boundaryProjection: boundary.boundaryProjection,
      boundaryDigest: boundary.boundaryDigest,
      productionReadPathAvailable: boundary.productionReadPathAvailable,
      productionWritePathAvailable: boundary.productionWritePathAvailable,
      liveProductionConnectivityAvailable: boundary.liveProductionConnectivityAvailable,
      productionCredentialsPresent: boundary.productionCredentialsPresent
    }
  };

  async function verifyProof(label, kind, proof, expectedSubject) {
    const entry = entriesById.get(proof?.evidence?.id);
    if (!entry || !samePointer(proof.evidence, entry.artifact)) {
      issues.push(`productionDerivedInput: ${label} evidence pointer does not resolve exactly once`);
      return;
    }
    const policy = topology.policiesByKind.get(kind);
    const authority = topology.authoritiesById.get(policy?.authorityId);
    const publicKey = topology.publicKeysByAuthority.get(policy?.authorityId);
    if (!policy || !authority || !publicKey) {
      issues.push(`productionDerivedInput: ${label} has no authenticated policy, authority, and public key`);
      return;
    }
    if (!sameComponent(proof.verifier, policy.verifier) || !sameComponent(proof.verifier, trustedVerifier)) {
      issues.push(`productionDerivedInput: ${label} verifier does not match the sealed policy and evaluator registry`);
    }

    const artifact = entry.artifact;
    for (const problem of schemaProblems(validateEvidenceArtifact, artifact)) {
      issues.push(`productionDerivedInput: ${label} evidence artifact is schema-invalid: ${problem}`);
    }
    const signatureProblem = evidenceSignatureProblem(artifact, authority, publicKey);
    if (signatureProblem) issues.push(`productionDerivedInput: ${label} evidence ${signatureProblem}`);
    if (!sameJson(artifact.producer, authority.producer) || artifact.creationPhase !== policy.creationPhase) {
      issues.push(`productionDerivedInput: ${label} evidence producer or phase is not authorized by the sealed contract`);
    }
    if (artifact.schemaMetadata?.schemaId !== policy.evidenceSchemaId
      || artifact.schemaMetadata?.schemaVersion !== "0.1.0"
      || artifact.schemaMetadata?.validatorDigest !== policy.verifier.digest) {
      issues.push(`productionDerivedInput: ${label} evidence schema metadata is not bound to the registered verifier`);
    }
    if (!sameComponent(artifact.mediaInterpretation?.semanticContract, policy.verifier)) {
      issues.push(`productionDerivedInput: ${label} semantic contract is not the registered verifier`);
    }
    if (!sameJson(artifact.payload, { kind: "repository_relative", path: entry.payloadPath })) {
      issues.push(`productionDerivedInput: ${label} evidence payload locator differs from the bundle path`);
    }
    if (proof.subjectDigest !== expectedSubject) {
      issues.push(`productionDerivedInput: ${label} subjectDigest must be ${expectedSubject}`);
    }
    const verifiedAt = instant(proof.verifiedAt, `${label}.verifiedAt`, issues);
    const artifactCreatedAt = instant(artifact.createdAt, `${label} artifact.createdAt`, issues);
    const signedAt = instant(artifact.attestation?.signedAt, `${label} attestation.signedAt`, issues);
    if (artifactCreatedAt < snapshotCreatedAt || artifactCreatedAt > signedAt || signedAt > verifiedAt
      || verifiedAt > sealedAt) {
      issues.push(`productionDerivedInput: ${label} evidence chronology is outside snapshot-to-seal bounds`);
    }
    try {
      const payloadBytes = await readFile(resolveInside(root, path.dirname(bundleAbsolute), entry.payloadPath));
      const actualDigest = sha256(payloadBytes);
      if (artifact.digest !== actualDigest || locatorDigest(artifact.uri) !== actualDigest) {
        issues.push(`productionDerivedInput: ${label} evidence bytes must bind ${actualDigest}`);
      }
      if (artifact.byteLength !== payloadBytes.length) {
        issues.push(`productionDerivedInput: ${label} evidence byteLength must be ${payloadBytes.length}`);
      }
      if (artifact.mediaType !== "application/json") {
        issues.push(`productionDerivedInput: ${label} evidence mediaType must be application/json`);
      }
      const payload = JSON.parse(payloadBytes.toString("utf8"));
      for (const problem of verifyProductionDerivedProof(kind, payload, expectedByKind[kind])) {
        issues.push(`productionDerivedInput: ${label} payload ${problem}`);
      }
    } catch (error) {
      issues.push(`productionDerivedInput: cannot reproduce ${label} evidence bytes: ${error.message}`);
    }
  }

  const authorizedAt = instant(authorization.authorizedAt, "dataOwnerAuthorization.authorizedAt", issues);
  if (authorizedAt > sealedAt) {
    issues.push("productionDerivedInput: data-owner authorization must precede the pre-run seal");
  }
  if (authorization.scopeDigest !== snapshot.digest || authorization.proof?.subjectDigest !== snapshot.digest) {
    issues.push("productionDerivedInput: data-owner authorization scope must equal inputSnapshot.digest");
  }
  if (instant(authorization.proof?.verifiedAt, "dataOwnerAuthorization.proof.verifiedAt", issues)
    < Math.max(snapshotCreatedAt, authorizedAt)) {
    issues.push("productionDerivedInput: authorization proof predates its snapshot or authorization decision");
  }

  const expectedBoundaryDigest = sha256Canonical({
    evaluationMode: document.evaluationMode,
    productionActionAllowed: document.productionActionAllowed,
    productionTelemetryPolicy: document.productionTelemetryPolicy,
    network: document.network,
    filesystem: document.filesystem,
    process: document.process
  });
  if (boundary.boundaryDigest !== expectedBoundaryDigest || boundary.proof?.subjectDigest !== expectedBoundaryDigest) {
    issues.push(`productionDerivedInput: isolation boundary digest must be ${expectedBoundaryDigest}`);
  }

  await verifyProof("provenance", "production_input_provenance", contract.provenance, snapshot.digest);
  await verifyProof("data-owner authorization", "data_owner_authorization", authorization.proof, snapshot.digest);
  await verifyProof("redaction", "redaction_verification", contract.redactionVerification?.proof, snapshot.digest);
  await verifyProof("re-identification", "reidentification_assessment",
    contract.reidentificationAssessment?.proof, snapshot.digest);
  await verifyProof("production isolation", "production_path_isolation", boundary.proof, expectedBoundaryDigest);
}
