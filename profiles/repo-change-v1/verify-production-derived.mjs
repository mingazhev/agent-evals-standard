const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;

const PROOF_FIELDS = Object.freeze({
  production_input_provenance: [
    "kind", "subjectDigest", "sourceCutoff", "sourceSystemIds", "datasetId",
    "sourceRecordCount", "exportLedgerDigest", "transformationId",
    "transformationVersion", "transformationDigest", "result"
  ],
  data_owner_authorization: [
    "kind", "ownerId", "scopeDigest", "purpose", "decision", "authorizedAt", "result"
  ],
  redaction_verification: [
    "kind", "subjectDigest", "policyId", "policyVersion", "policyDigest",
    "directIdentifiersFound", "secretsFound", "unresolvedFindings", "result"
  ],
  reidentification_assessment: [
    "kind", "subjectDigest", "methodId", "methodVersion", "methodDigest",
    "decision", "residualRiskScore", "result"
  ],
  production_path_isolation: [
    "kind", "subjectDigest", "boundaryProjection", "boundaryDigest",
    "productionReadPathAvailable", "productionWritePathAvailable",
    "liveProductionConnectivityAvailable", "productionCredentialsPresent", "result"
  ]
});

export const PRODUCTION_DERIVED_PROOF_KINDS = Object.freeze(Object.keys(PROOF_FIELDS));
export const PRODUCTION_DERIVED_VERIFIER_ID = "repo-change-production-derived-verifier";
export const PRODUCTION_DERIVED_VERIFIER_VERSION = "0.1.0";

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function requireExactFields(payload, kind, issues) {
  const expected = [...PROOF_FIELDS[kind]].sort();
  const actual = Object.keys(payload ?? {}).sort();
  if (!sameJson(expected, actual)) {
    issues.push(`${kind}: payload fields must be exactly ${expected.join(", ")}`);
  }
}

function requireDigest(value, label, issues) {
  if (!DIGEST_PATTERN.test(value ?? "")) issues.push(`${label} must be a sha256 digest`);
}

function requireEqual(actual, expected, label, issues) {
  if (!sameJson(actual, expected)) issues.push(`${label} must equal the sealed value`);
}

/**
 * Deterministically rechecks the complete semantic payload for one production-
 * derived proof. Signature, authority, material-byte, and chronology checks are
 * performed by the caller before this function is reached.
 */
export function verifyProductionDerivedProof(kind, payload, expected) {
  const issues = [];
  if (!PROOF_FIELDS[kind] || payload?.kind !== kind) {
    return [`production-derived proof kind must be ${kind}`];
  }
  requireExactFields(payload, kind, issues);
  if (payload.result !== "pass") issues.push(`${kind}: result must be pass`);

  switch (kind) {
    case "production_input_provenance": {
      requireEqual(payload.subjectDigest, expected.snapshotDigest, `${kind}.subjectDigest`, issues);
      requireEqual(payload.sourceCutoff, expected.sourceCutoff, `${kind}.sourceCutoff`, issues);
      requireEqual(payload.sourceSystemIds, expected.sourceSystemIds, `${kind}.sourceSystemIds`, issues);
      requireEqual(payload.datasetId, expected.datasetId, `${kind}.datasetId`, issues);
      requireEqual(payload.sourceRecordCount, expected.sourceRecordCount, `${kind}.sourceRecordCount`, issues);
      if (!Number.isInteger(payload.sourceRecordCount) || payload.sourceRecordCount < 1) {
        issues.push(`${kind}.sourceRecordCount must be a positive integer`);
      }
      requireDigest(payload.exportLedgerDigest, `${kind}.exportLedgerDigest`, issues);
      requireEqual(payload.exportLedgerDigest, expected.provenanceControl.exportLedgerDigest,
        `${kind}.exportLedgerDigest`, issues);
      requireEqual(payload.transformationId, expected.provenanceControl.transformation.id,
        `${kind}.transformationId`, issues);
      requireEqual(payload.transformationVersion, expected.provenanceControl.transformation.version,
        `${kind}.transformationVersion`, issues);
      requireEqual(payload.transformationDigest, expected.provenanceControl.transformation.digest,
        `${kind}.transformationDigest`, issues);
      break;
    }
    case "data_owner_authorization":
      requireEqual(payload.ownerId, expected.ownerId, `${kind}.ownerId`, issues);
      requireEqual(payload.scopeDigest, expected.snapshotDigest, `${kind}.scopeDigest`, issues);
      requireEqual(payload.purpose, expected.purpose, `${kind}.purpose`, issues);
      requireEqual(payload.decision, expected.decision, `${kind}.decision`, issues);
      requireEqual(payload.authorizedAt, expected.authorizedAt, `${kind}.authorizedAt`, issues);
      break;
    case "redaction_verification":
      requireEqual(payload.subjectDigest, expected.snapshotDigest, `${kind}.subjectDigest`, issues);
      requireEqual(payload.policyId, expected.policy.id, `${kind}.policyId`, issues);
      requireEqual(payload.policyVersion, expected.policy.version, `${kind}.policyVersion`, issues);
      requireEqual(payload.policyDigest, expected.policy.digest, `${kind}.policyDigest`, issues);
      for (const field of ["directIdentifiersFound", "secretsFound", "unresolvedFindings"]) {
        if (payload[field] !== 0) issues.push(`${kind}.${field} must be zero`);
      }
      break;
    case "reidentification_assessment":
      requireEqual(payload.subjectDigest, expected.snapshotDigest, `${kind}.subjectDigest`, issues);
      requireEqual(payload.methodId, expected.method.id, `${kind}.methodId`, issues);
      requireEqual(payload.methodVersion, expected.method.version, `${kind}.methodVersion`, issues);
      requireEqual(payload.methodDigest, expected.method.digest, `${kind}.methodDigest`, issues);
      requireEqual(payload.decision, expected.decision, `${kind}.decision`, issues);
      if (typeof payload.residualRiskScore !== "number" || !Number.isFinite(payload.residualRiskScore)
        || payload.residualRiskScore < 0 || payload.residualRiskScore > expected.maximumResidualRisk) {
        issues.push(`${kind}.residualRiskScore must be between zero and the sealed maximumResidualRisk`);
      }
      break;
    case "production_path_isolation":
      requireEqual(payload.subjectDigest, expected.boundaryDigest, `${kind}.subjectDigest`, issues);
      requireEqual(payload.boundaryProjection, expected.boundaryProjection, `${kind}.boundaryProjection`, issues);
      requireEqual(payload.boundaryDigest, expected.boundaryDigest, `${kind}.boundaryDigest`, issues);
      for (const field of [
        "productionReadPathAvailable", "productionWritePathAvailable",
        "liveProductionConnectivityAvailable", "productionCredentialsPresent"
      ]) {
        requireEqual(payload[field], expected[field], `${kind}.${field}`, issues);
        if (payload[field] !== false) issues.push(`${kind}.${field} must be false`);
      }
      break;
    default:
      issues.push(`unsupported production-derived proof kind: ${kind}`);
  }
  return issues;
}
