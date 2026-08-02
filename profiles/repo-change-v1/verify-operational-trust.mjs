import { createHash, verify as verifyCrypto } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const profileDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(profileDirectory, "../..");
const schemaDirectory = path.join(repositoryRoot, "schemas");

class TrustError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.code = code;
  }
}

function requireTrust(condition, code, message) {
  if (!condition) throw new TrustError(code, message);
}

function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}

function sha256Bytes(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function sha256Canonical(value) {
  return sha256Bytes(Buffer.from(canonicalize(value), "utf8"));
}

function clone(value) {
  return structuredClone(value);
}

function signingMessage(schemaVersion, projection) {
  return Buffer.concat([
    Buffer.from(schemaVersion, "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalize(projection), "utf8")
  ]);
}

function instant(value, code = "INVALID_TIME") {
  const result = Date.parse(value);
  requireTrust(Number.isFinite(result), code, `invalid UTC instant ${value}`);
  return result;
}

function resolveRepositoryPath(baseDirectory, candidate) {
  const absolute = path.resolve(baseDirectory, candidate);
  const relative = path.relative(repositoryRoot, absolute);
  requireTrust(!relative.startsWith("..") && !path.isAbsolute(relative), "PATH_ESCAPE", candidate);
  return absolute;
}

async function readJson(absolute) {
  return JSON.parse(await readFile(absolute, "utf8"));
}

async function loadSchemas() {
  const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: true });
  addFormats(ajv);
  const byVersion = new Map();
  for (const name of (await readdir(schemaDirectory)).filter((item) => item.endsWith(".schema.json"))) {
    const schema = await readJson(path.join(schemaDirectory, name));
    ajv.addSchema(schema);
    const schemaVersion = schema.properties?.schemaVersion?.const;
    if (schemaVersion) byVersion.set(schemaVersion, schema.$id);
  }
  return { ajv, byVersion };
}

function validateSchema(document, label, schemas) {
  const schemaId = schemas.byVersion.get(document.schemaVersion);
  requireTrust(schemaId, "UNKNOWN_SCHEMA", `${label}: ${document.schemaVersion}`);
  const validator = schemas.ajv.getSchema(schemaId);
  requireTrust(validator?.(document), "SCHEMA_INVALID", `${label}: ${schemas.ajv.errorsText(validator?.errors)}`);
}

function ordinarySelfDigest(document, label) {
  const projection = clone(document);
  delete projection.digest;
  delete projection.signature;
  requireTrust(sha256Canonical(projection) === document.digest, "DIGEST_MISMATCH", label);
}

function profileSelfDigest(profile) {
  const projection = clone(profile);
  delete projection.digest;
  requireTrust(sha256Canonical(projection) === profile.digest, "DIGEST_MISMATCH", profile.id);
}

function revocationSelfDigest(document) {
  const projection = clone(document);
  delete projection.digest;
  delete projection.signature;
  projection.authorizationSignatures.forEach((signature) => delete signature.value);
  requireTrust(sha256Canonical(projection) === document.digest, "DIGEST_MISMATCH", document.id);
}

function parseScope(scope) {
  const [profileId, assuranceExpression, riskExpression, ...extra] = scope.split(":");
  requireTrust(!extra.length && profileId && assuranceExpression && riskExpression, "INVALID_SCOPE", scope);
  const expand = (expression, ordered) => {
    const parts = expression.split("-");
    if (parts.length === 1) return parts;
    requireTrust(parts.length === 2, "INVALID_SCOPE", scope);
    const first = ordered.indexOf(parts[0]);
    const last = ordered.indexOf(parts[1]);
    requireTrust(first >= 0 && last >= first, "INVALID_SCOPE", scope);
    return ordered.slice(first, last + 1);
  };
  return {
    profileId,
    assuranceLevels: expand(assuranceExpression, ["A0", "A1", "A2", "A3"]),
    riskTiers: expand(riskExpression, ["low", "medium", "high", "critical"])
  };
}

function scopeAuthorizes(key, profileId, assuranceLevel, riskTier) {
  return key.authorizedScopes.some((scope) => {
    const parsed = parseScope(scope);
    return parsed.profileId === profileId
      && parsed.assuranceLevels.includes(assuranceLevel)
      && parsed.riskTiers.includes(riskTier);
  });
}

function statusMap(revocation) {
  const result = new Map();
  for (const status of revocation.keyStatuses) {
    requireTrust(!result.has(status.keyId), "DUPLICATE_REVOCATION_STATUS", status.keyId);
    result.set(status.keyId, status);
  }
  return result;
}

function authorizeSignature({
  document,
  signature,
  requiredRole,
  trustedAt,
  keyById,
  revocationByKey,
  profile,
  assuranceLevel = "A3",
  riskTier = "critical"
}) {
  requireTrust(signature.profileId === profile.id, "PROFILE_MISMATCH", signature.profileId);
  requireTrust(profile.allowedAlgorithms.includes(signature.algorithm), "ALGORITHM_NOT_ALLOWED", signature.algorithm);
  const key = keyById.get(signature.keyId);
  requireTrust(key, "UNKNOWN_KEY", signature.keyId);
  requireTrust(key.algorithm === signature.algorithm, "ALGORITHM_KEY_MISMATCH", signature.keyId);
  const expectedType = { Ed25519: "Ed25519", ES256: "P-256", PS256: "RSA" }[signature.algorithm];
  requireTrust(key.keyType === expectedType, "KEY_TYPE_MISMATCH", signature.keyId);
  requireTrust(key.authorizedRoles.includes(requiredRole), "UNAUTHORIZED_ROLE", `${signature.keyId} lacks ${requiredRole}`);
  requireTrust(key.authorizedArtifactSchemaVersions.includes(document.schemaVersion), "UNAUTHORIZED_ARTIFACT", `${signature.keyId} cannot sign ${document.schemaVersion}`);
  requireTrust(scopeAuthorizes(key, "repo-change-v1", assuranceLevel, riskTier), "UNAUTHORIZED_SCOPE", signature.keyId);
  requireTrust(key.status === "active", "INACTIVE_KEY", signature.keyId);
  const status = revocationByKey?.get(signature.keyId);
  if (revocationByKey) {
    requireTrust(status, "MISSING_REVOCATION_STATUS", signature.keyId);
    requireTrust(status.status === "active", "REVOKED_KEY", signature.keyId);
    requireTrust(instant(status.effectiveAt) <= instant(trustedAt), "FUTURE_REVOCATION_STATUS", signature.keyId);
  }
  const verifiedAt = instant(trustedAt);
  requireTrust(instant(key.validFrom) <= verifiedAt && verifiedAt < instant(key.validUntil), "KEY_OUTSIDE_INTERVAL", signature.keyId);
  requireTrust(instant(key.validFrom) <= instant(signature.signedAt) && instant(signature.signedAt) < instant(key.validUntil), "SIGNED_AT_OUTSIDE_INTERVAL", signature.keyId);
  return key;
}

function verifyEd25519(document, projection, signature, publicKeyPem, label) {
  requireTrust(signature.algorithm === "Ed25519", "UNSUPPORTED_OPERATIONAL_ALGORITHM", signature.algorithm);
  requireTrust(
    verifyCrypto(null, signingMessage(document.schemaVersion, projection), publicKeyPem, Buffer.from(signature.value, "base64url")),
    "SIGNATURE_INVALID",
    label
  );
}

async function verifyPublicKeys(keyContract) {
  const keyById = new Map();
  for (const key of keyContract.keys) {
    requireTrust(!keyById.has(key.keyId), "DUPLICATE_KEY", key.keyId);
    const absolute = resolveRepositoryPath(profileDirectory, key.publicKey.uri);
    const bytes = await readFile(absolute);
    requireTrust(sha256Bytes(bytes) === key.publicKey.digest, "PUBLIC_KEY_DIGEST_MISMATCH", key.keyId);
    keyById.set(key.keyId, { ...key, publicKeyPem: bytes });
  }
  return keyById;
}

function verifyOrdinarySignature(document, requiredRole, trustedAt, graph) {
  ordinarySelfDigest(document, document.id);
  authorizeSignature({
    document,
    signature: document.signature,
    requiredRole,
    trustedAt,
    keyById: graph.keyById,
    revocationByKey: graph.revocationByKey,
    profile: graph.profile
  });
  const projection = clone(document);
  delete projection.signature.value;
  verifyEd25519(document, projection, document.signature, graph.keyById.get(document.signature.keyId).publicKeyPem, document.id);
}

function checkRevocationFreshness(revocation, trustedAt) {
  const verifiedAt = instant(trustedAt);
  requireTrust(instant(revocation.publishedAt) <= verifiedAt, "FUTURE_REVOCATION_STATE", revocation.id);
  requireTrust(verifiedAt <= instant(revocation.nextUpdate), "STALE_REVOCATION_STATE", revocation.id);
  requireTrust(instant(revocation.publishedAt) < instant(revocation.nextUpdate), "INVALID_REVOCATION_WINDOW", revocation.id);
}

function verifyRevocation(revocation, trustedAt, graph) {
  revocationSelfDigest(revocation);
  checkRevocationFreshness(revocation, trustedAt);
  requireTrust(revocationByKeyComplete(graph.keyById, graph.revocationByKey), "INCOMPLETE_REVOCATION_STATE", revocation.id);

  const approvalProjection = clone(revocation);
  delete approvalProjection.signature;
  approvalProjection.authorizationSignatures.forEach((signature) => delete signature.value);
  const ownerIds = new Set();
  const keyIds = new Set();
  for (const signature of revocation.authorizationSignatures) {
    const key = authorizeSignature({
      document: revocation,
      signature,
      requiredRole: "revocation_authority",
      trustedAt,
      keyById: graph.keyById,
      revocationByKey: graph.revocationByKey,
      profile: graph.profile
    });
    requireTrust(!keyIds.has(key.keyId) && !ownerIds.has(key.ownerId), "REVOCATION_QUORUM_NOT_INDEPENDENT", key.keyId);
    keyIds.add(key.keyId);
    ownerIds.add(key.ownerId);
    verifyEd25519(revocation, approvalProjection, signature, key.publicKeyPem, `revocation approval ${key.keyId}`);
  }
  requireTrust(keyIds.size >= revocation.authorityThreshold, "REVOCATION_QUORUM_NOT_MET", revocation.id);

  authorizeSignature({
    document: revocation,
    signature: revocation.signature,
    requiredRole: "trust_contract_signer",
    trustedAt,
    keyById: graph.keyById,
    revocationByKey: graph.revocationByKey,
    profile: graph.profile
  });
  const rootProjection = clone(revocation);
  delete rootProjection.signature.value;
  verifyEd25519(revocation, rootProjection, revocation.signature, graph.keyById.get(revocation.signature.keyId).publicKeyPem, revocation.id);
}

function revocationByKeyComplete(keyById, revocationByKey) {
  return keyById.size === revocationByKey.size && [...keyById.keys()].every((keyId) => revocationByKey.has(keyId));
}

function checkTimeQuorumSemantics(timeContract, attestations, trustedAt) {
  const sourceById = new Map(timeContract.sources.map((source) => [source.sourceId, source]));
  const usable = [];
  const sourceIds = new Set();
  const keyIds = new Set();
  const ownerIds = new Set();
  const trustDomains = new Set();
  let nonce;
  let subject;
  for (const attestation of attestations) {
    const source = sourceById.get(attestation.sourceId);
    requireTrust(source, "UNKNOWN_TIME_SOURCE", attestation.sourceId);
    requireTrust(source.keyId === attestation.keyId, "TIME_SOURCE_KEY_MISMATCH", attestation.sourceId);
    requireTrust(attestation.sequence > 0 || attestation.previousAttestationDigest === null, "BROKEN_TIME_CHAIN", attestation.id);
    requireTrust(instant(attestation.attestedAt) < instant(attestation.expiresAt), "INVALID_TIME_WINDOW", attestation.id);
    requireTrust(instant(trustedAt) <= instant(attestation.expiresAt), "STALE_TIME", attestation.id);
    const age = instant(trustedAt) - instant(attestation.attestedAt);
    requireTrust(age >= -timeContract.maximumClockSkewSeconds * 1000, "TIME_FROM_FUTURE", attestation.id);
    requireTrust(age <= timeContract.maximumAttestationAgeSeconds * 1000, "STALE_TIME", attestation.id);
    nonce ??= attestation.requestNonce;
    subject ??= attestation.subjectDigest;
    requireTrust(attestation.requestNonce === nonce && attestation.subjectDigest === subject, "TIME_QUORUM_BINDING_MISMATCH", attestation.id);
    requireTrust(!sourceIds.has(source.sourceId) && !keyIds.has(source.keyId) && !ownerIds.has(source.ownerId) && !trustDomains.has(source.trustDomain), "TIME_QUORUM_NOT_INDEPENDENT", source.sourceId);
    sourceIds.add(source.sourceId);
    keyIds.add(source.keyId);
    ownerIds.add(source.ownerId);
    trustDomains.add(source.trustDomain);
    usable.push(attestation);
  }
  requireTrust(usable.length >= timeContract.minimumIndependentSources, "TIME_QUORUM_NOT_MET", timeContract.id);
  const observed = usable.map((item) => instant(item.attestedAt));
  requireTrust(Math.max(...observed) - Math.min(...observed) <= timeContract.maximumClockSkewSeconds * 1000, "TIME_QUORUM_SKEW", timeContract.id);
  return { nonce, subject };
}

function verifyTimeQuorum(timeContract, attestations, trustedAt, graph) {
  const binding = checkTimeQuorumSemantics(timeContract, attestations, trustedAt);
  const sourceById = new Map(timeContract.sources.map((source) => [source.sourceId, source]));
  for (const attestation of attestations) {
    ordinarySelfDigest(attestation, attestation.id);
    const source = sourceById.get(attestation.sourceId);
    authorizeSignature({
      document: attestation,
      signature: attestation.signature,
      requiredRole: "trusted_time_authority",
      trustedAt: attestation.attestedAt,
      keyById: graph.keyById,
      revocationByKey: graph.revocationByKey,
      profile: graph.profile
    });
    requireTrust(attestation.signature.keyId === source.keyId, "TIME_SOURCE_KEY_MISMATCH", attestation.id);
    const projection = clone(attestation);
    delete projection.signature.value;
    verifyEd25519(attestation, projection, attestation.signature, graph.keyById.get(source.keyId).publicKeyPem, attestation.id);
  }
  return binding;
}

function checkReceiptChain(receipts) {
  requireTrust(receipts.length >= 2, "RECEIPT_CHAIN_TOO_SHORT", "need a continuity edge");
  for (let index = 0; index < receipts.length; index += 1) {
    const receipt = receipts[index];
    if (index === 0) {
      requireTrust(receipt.sequence === 0 && receipt.previousReceiptDigest === null, "BROKEN_RECEIPT_CHAIN", receipt.id);
      continue;
    }
    const previous = receipts[index - 1];
    requireTrust(receipt.ledgerId === previous.ledgerId, "BROKEN_RECEIPT_CHAIN", receipt.id);
    requireTrust(receipt.sequence === previous.sequence + 1, "BROKEN_RECEIPT_CHAIN", receipt.id);
    requireTrust(receipt.previousReceiptDigest === sha256Canonical(previous), "BROKEN_RECEIPT_CHAIN", receipt.id);
    requireTrust(instant(receipt.observedAt) >= instant(previous.observedAt), "BROKEN_RECEIPT_CHAIN", receipt.id);
  }
}

function verifyReceipts(receipts, trustedAt, graph) {
  checkReceiptChain(receipts);
  const maximumSkewMs = graph.timeContract.maximumClockSkewSeconds * 1000;
  const maximumAgeMs = graph.timeContract.maximumAttestationAgeSeconds * 1000;
  for (const receipt of receipts) {
    const age = instant(trustedAt) - instant(receipt.observedAt);
    requireTrust(age >= -maximumSkewMs && age <= maximumAgeMs, "STALE_RECEIPT", receipt.id);
    requireTrust(receipt.serviceIdentity === receipt.signature.keyId, "NOTARY_IDENTITY_MISMATCH", receipt.id);
    const notary = authorizeSignature({
      document: receipt,
      signature: receipt.signature,
      requiredRole: "anti_rollback_receipt_signer",
      trustedAt,
      keyById: graph.keyById,
      revocationByKey: graph.revocationByKey,
      profile: graph.profile
    });
    const notaryProjection = clone(receipt);
    delete notaryProjection.signature.value;
    delete notaryProjection.witnessSignature;
    verifyEd25519(receipt, notaryProjection, receipt.signature, notary.publicKeyPem, `${receipt.id} notary`);

    const witness = authorizeSignature({
      document: receipt,
      signature: receipt.witnessSignature,
      requiredRole: "anti_rollback_witness",
      trustedAt,
      keyById: graph.keyById,
      revocationByKey: graph.revocationByKey,
      profile: graph.profile
    });
    requireTrust(witness.ownerId !== notary.ownerId, "NOTARY_WITNESS_NOT_INDEPENDENT", receipt.id);
    const witnessProjection = clone(receipt);
    delete witnessProjection.witnessSignature.value;
    verifyEd25519(receipt, witnessProjection, receipt.witnessSignature, witness.publicKeyPem, `${receipt.id} witness`);
  }
}

function checkApplicability(graph) {
  const assurance = ["A1", "A2", "A3"];
  const risks = ["low", "medium", "high", "critical"];
  for (const level of assurance) {
    requireTrust(graph.antiRollback.applicability.assuranceLevels.includes(level), "INCOMPLETE_APPLICABILITY", level);
    requireTrust(graph.threatAssessment.assuranceLevels.includes(level), "INCOMPLETE_THREAT_SCOPE", level);
  }
  for (const risk of risks) {
    requireTrust(graph.antiRollback.applicability.effectiveRiskTiers.includes(risk), "INCOMPLETE_APPLICABILITY", risk);
    requireTrust(graph.threatAssessment.effectiveRiskTiers.includes(risk), "INCOMPLETE_THREAT_SCOPE", risk);
  }
  for (const key of graph.keyById.values()) {
    for (const level of assurance) {
      for (const risk of risks) {
        requireTrust(scopeAuthorizes(key, "repo-change-v1", level, risk), "INCOMPLETE_KEY_SCOPE", `${key.keyId}:${level}:${risk}`);
      }
    }
  }
  requireTrust(graph.antiRollback.mechanism.type === "independent_notary", "INACTIVE_ANTI_ROLLBACK", graph.antiRollback.mechanism.type);
  requireTrust(graph.antiRollback.mechanism.witnessPolicy.minimumIndependentWitnesses >= 1, "MISSING_WITNESS_POLICY", graph.antiRollback.id);
  requireTrust(graph.antiRollback.failureSemantics.unavailableEvidence === "stop_governance_use", "FAIL_OPEN_POLICY", graph.antiRollback.id);
}

async function verifyDocumentPointer(pointer, document, label, requireVersion = false) {
  requireTrust(pointer.id === document.id, "POINTER_IDENTITY_MISMATCH", label);
  if (requireVersion) requireTrust(pointer.version === document.version, "POINTER_VERSION_MISMATCH", label);
  requireTrust(pointer.digest === document.digest, "POINTER_DIGEST_MISMATCH", label);
  const absolute = resolveRepositoryPath(profileDirectory, pointer.uri);
  requireTrust(path.resolve(absolute) === path.resolve(document.__path), "POINTER_PATH_MISMATCH", label);
}

async function verifyRawSchemaPointer(pointer, expectedSchemaId, label) {
  const absolute = resolveRepositoryPath(profileDirectory, pointer.uri);
  const bytes = await readFile(absolute);
  requireTrust(sha256Bytes(bytes) === pointer.digest, "POINTER_DIGEST_MISMATCH", label);
  const schema = JSON.parse(bytes.toString("utf8"));
  requireTrust(schema.$id === expectedSchemaId, "POINTER_SCHEMA_MISMATCH", label);
}

async function verifyInternalPointers(graph) {
  await verifyDocumentPointer(graph.revocation.keyAuthorizationContract, graph.keyContract, "revocation key authorization", true);
  await verifyDocumentPointer(graph.timeContract.keyAuthorizationContract, graph.keyContract, "trusted-time key authorization", true);
  await verifyRawSchemaPointer(graph.timeContract.attestationSchema, "urn:agent-evals-standard:schema:trusted-time-attestation:1", "trusted-time attestation schema");

  const bindings = new Map(graph.threatAssessment.contractBindings.map((pointer) => [pointer.id, pointer]));
  await verifyDocumentPointer(bindings.get(graph.keyContract.id), graph.keyContract, "threat key authorization", true);
  await verifyDocumentPointer(bindings.get(graph.revocation.id), graph.revocation, "threat revocation", true);
  await verifyDocumentPointer(bindings.get(graph.timeContract.id), graph.timeContract, "threat trusted time", true);

  await verifyDocumentPointer(graph.antiRollback.applicability.threatAssessment, graph.threatAssessment, "anti-rollback threat assessment");
  await verifyDocumentPointer(graph.antiRollback.mechanism.serviceIdentity, graph.keyContract, "notary registry");
  await verifyDocumentPointer(graph.antiRollback.mechanism.witnessPolicy.witnessRegistry, graph.keyContract, "witness registry");
  await verifyRawSchemaPointer(graph.antiRollback.mechanism.receiptSchema, "urn:agent-evals-standard:schema:anti-rollback-receipt:1", "anti-rollback receipt schema");
}

async function verifyPointer(pointer, document, expectedType, expectedSchemaVersion) {
  requireTrust(pointer.contractType === expectedType, "POINTER_TYPE_MISMATCH", pointer.id);
  requireTrust(pointer.schemaVersion === expectedSchemaVersion, "POINTER_SCHEMA_MISMATCH", pointer.id);
  requireTrust(pointer.id === document.id && pointer.version === document.version, "POINTER_IDENTITY_MISMATCH", pointer.id);
  requireTrust(pointer.digest === document.digest, "POINTER_DIGEST_MISMATCH", pointer.id);
  const absolute = resolveRepositoryPath(profileDirectory, pointer.uri);
  requireTrust(path.resolve(absolute) === path.resolve(document.__path), "POINTER_PATH_MISMATCH", pointer.id);
}

async function verifyAlgorithmVectors(profile) {
  const absolute = resolveRepositoryPath(profileDirectory, profile.algorithmConformanceVectors.uri);
  const vectors = await readJson(absolute);
  const projection = clone(vectors);
  delete projection.digest;
  delete projection.signature;
  requireTrust(sha256Canonical(projection) === vectors.digest, "DIGEST_MISMATCH", vectors.id);
  requireTrust(profile.algorithmConformanceVectors.id === vectors.id && profile.algorithmConformanceVectors.digest === vectors.digest, "VECTOR_POINTER_MISMATCH", vectors.id);
  for (const algorithm of profile.allowedAlgorithms) {
    const selected = vectors.vectors.filter((item) => item.algorithm === algorithm);
    requireTrust(selected.some((item) => item.kind === "positive" && item.expectedProfileVerdict === "accept"), "MISSING_POSITIVE_VECTOR", algorithm);
    requireTrust(selected.some((item) => item.kind === "cryptographic_negative"), "MISSING_CRYPTO_NEGATIVE_VECTOR", algorithm);
    requireTrust(selected.some((item) => item.kind === "profile_negative"), "MISSING_PROFILE_NEGATIVE_VECTOR", algorithm);
    if (algorithm === "Ed25519") {
      for (const vector of selected.filter((item) => item.kind !== "profile_negative")) {
        let valid = false;
        try {
          valid = verifyCrypto(
            null,
            Buffer.from(vector.messageBase64url, "base64url"),
            vector.publicKeyPem,
            Buffer.from(vector.signatureBase64url, "base64url")
          );
        } catch {
          valid = false;
        }
        requireTrust(valid === vector.expectedCryptographicValidity, "VECTOR_RESULT_MISMATCH", vector.id);
      }
    }
  }
}

function checkOperationalReference(profile) {
  const marker = profile.operationalReference;
  requireTrust(marker?.classification === "operational_reference", "MISSING_OPERATIONAL_REFERENCE_MARKER", profile.id);
  requireTrust(marker.externalRekeyRequired === true, "EXTERNAL_REKEY_PRECONDITION_MISSING", profile.id);
  requireTrust(marker.deploymentUse === "prohibited_until_external_rekey_and_owner_verification", "EXTERNAL_REKEY_PRECONDITION_MISSING", profile.id);
  const required = ["external_key_custody", "operator_identity_verification", "endpoint_ownership_verification", "role_separation_verification"];
  requireTrust(required.every((item) => marker.requiredDeploymentEvidence.includes(item)), "DEPLOYMENT_EVIDENCE_INCOMPLETE", profile.id);
}

function requireDeploymentReady(graph, deploymentEvidence = []) {
  const marker = graph.profile.operationalReference;
  const evidence = new Set(deploymentEvidence);
  const required = marker.requiredDeploymentEvidence;
  const usesBundledKeys = [...graph.keyById.values()].some((key) => key.publicKey.uri.startsWith("operational-keys/"));
  const usesBundledRoot = graph.profile.trustAnchors.some((anchor) => anchor.uri.startsWith("operational-keys/"));
  requireTrust(!marker.externalRekeyRequired && !usesBundledKeys && !usesBundledRoot, "EXTERNAL_REKEY_REQUIRED", "bundled reference keys are not deployment trust");
  requireTrust(required.every((item) => evidence.has(item)), "DEPLOYMENT_EVIDENCE_INCOMPLETE", graph.profile.id);
}

async function loadGraph(schemas) {
  const loadProfileDocument = async (name) => {
    const absolute = path.join(profileDirectory, name);
    const document = await readJson(absolute);
    Object.defineProperty(document, "__path", { value: absolute, enumerable: false });
    validateSchema(document, name, schemas);
    return document;
  };
  const profile = await loadProfileDocument("operational-signature-profile.json");
  const keyContract = await loadProfileDocument(profile.keyResolutionContract.uri);
  const revocation = await loadProfileDocument(profile.revocationContract.uri);
  const timeContract = await loadProfileDocument(profile.timeValidationContract.uri);
  const antiRollback = await loadProfileDocument(profile.antiRollbackPolicy.uri);
  const threatAssessment = await loadProfileDocument(antiRollback.applicability.threatAssessment.uri);
  const attestations = await Promise.all([
    loadProfileDocument("operational-trusted-time-attestation-a.json"),
    loadProfileDocument("operational-trusted-time-attestation-b.json")
  ]);
  const receipts = await Promise.all([
    loadProfileDocument("operational-anti-rollback-receipt-0.json"),
    loadProfileDocument("operational-anti-rollback-receipt-1.json")
  ]);
  return { profile, keyContract, revocation, timeContract, antiRollback, threatAssessment, attestations, receipts };
}

async function verifyGraph() {
  const schemas = await loadSchemas();
  const graph = await loadGraph(schemas);
  profileSelfDigest(graph.profile);
  checkOperationalReference(graph.profile);
  await verifyAlgorithmVectors(graph.profile);

  await verifyPointer(graph.profile.keyResolutionContract, graph.keyContract, "key_resolution_and_authorization", "agent-eval-key-authorization-contract-1");
  await verifyPointer(graph.profile.revocationContract, graph.revocation, "revocation_state", "agent-eval-revocation-state-contract-1");
  await verifyPointer(graph.profile.timeValidationContract, graph.timeContract, "trusted_time", "agent-eval-trusted-time-contract-1");
  await verifyPointer(graph.profile.antiRollbackPolicy, graph.antiRollback, "anti_rollback", "agent-eval-anti-rollback-policy-1");
  await verifyInternalPointers(graph);

  graph.keyById = await verifyPublicKeys(graph.keyContract);
  graph.revocationByKey = statusMap(graph.revocation);
  const trustedAt = graph.profile.operationalReference.referenceVerificationTime;

  const rootAnchor = graph.profile.trustAnchors[0];
  const rootKey = graph.keyById.get(rootAnchor.id);
  requireTrust(rootKey, "TRUST_ANCHOR_NOT_AUTHORIZED", rootAnchor.id);
  requireTrust(rootKey.publicKey.digest === rootAnchor.digest, "TRUST_ANCHOR_DIGEST_MISMATCH", rootAnchor.id);
  requireTrust(!rootAnchor.uri.includes("conformance/fixtures"), "CONFORMANCE_KEY_AS_OPERATIONAL_ANCHOR", rootAnchor.uri);

  verifyOrdinarySignature(graph.keyContract, "trust_contract_signer", trustedAt, graph);
  verifyRevocation(graph.revocation, trustedAt, graph);
  verifyOrdinarySignature(graph.timeContract, "trust_contract_signer", trustedAt, graph);
  verifyOrdinarySignature(graph.threatAssessment, "trust_contract_signer", trustedAt, graph);
  verifyOrdinarySignature(graph.antiRollback, "trust_contract_signer", trustedAt, graph);

  const timeBinding = verifyTimeQuorum(graph.timeContract, graph.attestations, trustedAt, graph);
  requireTrust(timeBinding.subject === graph.antiRollback.digest, "TIME_SUBJECT_MISMATCH", timeBinding.subject);
  verifyReceipts(graph.receipts, trustedAt, graph);
  checkApplicability(graph);
  return graph;
}

function expectReject(results, name, expectedCode, operation) {
  try {
    operation();
  } catch (error) {
    requireTrust(error instanceof TrustError && error.code === expectedCode, "NEGATIVE_TEST_WRONG_FAILURE", `${name}: ${error.message}`);
    results.push(name);
    return;
  }
  throw new TrustError("NEGATIVE_TEST_ACCEPTED", name);
}

function runNegativeMutations(graph) {
  const results = [];
  const trustedAt = graph.profile.operationalReference.referenceVerificationTime;
  const baseArguments = {
    trustedAt,
    keyById: graph.keyById,
    revocationByKey: graph.revocationByKey,
    profile: graph.profile
  };

  expectReject(results, "unauthorized artifact", "UNAUTHORIZED_ARTIFACT", () => authorizeSignature({
    ...baseArguments,
    document: graph.antiRollback,
    signature: { ...graph.attestations[0].signature },
    requiredRole: "trusted_time_authority"
  }));

  expectReject(results, "unauthorized role", "UNAUTHORIZED_ROLE", () => authorizeSignature({
    ...baseArguments,
    document: graph.attestations[0],
    signature: { ...graph.attestations[0].signature },
    requiredRole: "revocation_authority"
  }));

  const revokedStatuses = new Map([...graph.revocationByKey].map(([keyId, status]) => [keyId, clone(status)]));
  revokedStatuses.get(graph.attestations[0].signature.keyId).status = "revoked";
  expectReject(results, "revoked key", "REVOKED_KEY", () => authorizeSignature({
    ...baseArguments,
    revocationByKey: revokedStatuses,
    document: graph.attestations[0],
    signature: graph.attestations[0].signature,
    requiredRole: "trusted_time_authority"
  }));

  const staleAttestations = clone(graph.attestations);
  staleAttestations.forEach((item) => {
    item.attestedAt = "2026-07-31T23:50:00Z";
    item.expiresAt = "2026-07-31T23:55:00Z";
  });
  expectReject(results, "stale trusted time", "STALE_TIME", () => checkTimeQuorumSemantics(graph.timeContract, staleAttestations, trustedAt));

  const staleRevocation = clone(graph.revocation);
  staleRevocation.nextUpdate = "2026-08-01T00:00:06Z";
  expectReject(results, "stale revocation state", "STALE_REVOCATION_STATE", () => checkRevocationFreshness(staleRevocation, trustedAt));

  const brokenReceipts = clone(graph.receipts);
  brokenReceipts[1].previousReceiptDigest = `sha256:${"0".repeat(64)}`;
  expectReject(results, "broken receipt chain", "BROKEN_RECEIPT_CHAIN", () => checkReceiptChain(brokenReceipts));

  expectReject(results, "bundled keys rejected for deployment", "EXTERNAL_REKEY_REQUIRED", () => requireDeploymentReady(graph, []));
  return results;
}

try {
  const graph = await verifyGraph();
  const negatives = runNegativeMutations(graph);
  console.log("Operational trust reference verification passed.");
  console.log(`Profile digest: ${graph.profile.digest}`);
  console.log("Coverage: A1, A2, A3 × low, medium, high, critical.");
  console.log(`Negative mutations rejected: ${negatives.length} (${negatives.join(", ")}).`);
  console.log("Deployment status: prohibited until external re-keying and required ownership/separation evidence are verified.");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
