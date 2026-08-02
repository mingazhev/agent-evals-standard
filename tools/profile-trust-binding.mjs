const digestPattern = /^sha256:[a-f0-9]{64}$/;
const trustUses = new Set(["conformance_fixture_requires_external_rekey", "deployment_bound"]);
const assuranceOrder = ["A0", "A1", "A2", "A3"];
const riskOrder = ["low", "medium", "high", "critical"];
const operationalContractTypes = {
  keyResolutionContract: {
    contractType: "key_resolution_and_authorization",
    schemaVersion: "agent-eval-key-authorization-contract-1"
  },
  revocationContract: {
    contractType: "revocation_state",
    schemaVersion: "agent-eval-revocation-state-contract-1"
  },
  timeValidationContract: {
    contractType: "trusted_time",
    schemaVersion: "agent-eval-trusted-time-contract-1"
  },
  antiRollbackPolicy: {
    contractType: "anti_rollback",
    schemaVersion: "agent-eval-anti-rollback-policy-1"
  }
};

function expandRange(token, order) {
  if (typeof token !== "string") return [];
  const [first, last = first] = token.split("-");
  const firstIndex = order.indexOf(first);
  const lastIndex = order.indexOf(last);
  if (firstIndex < 0 || lastIndex < firstIndex) return [];
  return order.slice(firstIndex, lastIndex + 1);
}

function scopeCovers(scope, profileId, assurance, risk) {
  if (typeof scope !== "string") return false;
  const parts = scope.split(":");
  if (parts.length !== 3 || parts[0] !== profileId) return false;
  return expandRange(parts[1], assuranceOrder).includes(assurance)
    && expandRange(parts[2], riskOrder).includes(risk);
}

function pointerIssues(pointer, field, owner) {
  const issues = [];
  if (!pointer || typeof pointer !== "object" || Array.isArray(pointer)) {
    return [`${owner}: leaf ${field} is required`];
  }
  if (typeof pointer.id !== "string" || pointer.id.length === 0) {
    issues.push(`${owner}: leaf ${field}.id is required`);
  }
  if (typeof pointer.version !== "string" || pointer.version.length === 0) {
    issues.push(`${owner}: leaf ${field}.version is required`);
  }
  if (typeof pointer.uri !== "string" || pointer.uri.length === 0) {
    issues.push(`${owner}: leaf ${field}.uri is required`);
  }
  if (typeof pointer.digest !== "string" || !digestPattern.test(pointer.digest)) {
    issues.push(`${owner}: leaf ${field}.digest must be a sha256 digest`);
  }
  return issues;
}

export function resolveLeafSignatureBinding(profile, owner = "evaluation profile") {
  const issues = pointerIssues(profile?.signatureProfile, "signatureProfile", owner);
  if (!profile?.signature || typeof profile.signature !== "object") {
    issues.push(`${owner}: leaf profile signature is required`);
  } else if (profile.signature.profileId !== profile?.signatureProfile?.id) {
    issues.push(`${owner}: leaf signature.profileId must equal signatureProfile.id`);
  }
  return {
    binding: issues.length === 0 ? structuredClone(profile.signatureProfile) : null,
    issues
  };
}

export function signatureProfileUseIssues({
  document,
  signatureProfile,
  contracts = {},
  keyResolutionContract = contracts.keyResolutionContract
}, owner = "signature profile binding") {
  const issues = [];
  const signature = document?.signature;
  if (!signatureProfile || typeof signatureProfile !== "object") {
    return [`${owner}: resolved signature profile is required`];
  }
  if (!signature || typeof signature !== "object") {
    return [`${owner}: document signature is required`];
  }
  if (!(signatureProfile.allowedAlgorithms ?? []).includes(signature.algorithm)) {
    issues.push(`${owner}: signature algorithm ${signature.algorithm ?? "<missing>"} is not allowed by the leaf signature profile`);
  }
  if (document.claimTrustUse !== "deployment_bound") return issues;

  if (signatureProfile.operationalReference !== undefined) {
    issues.push(`${owner}: deployment_bound cannot use a repository operational-reference signature profile`);
  }
  if (signatureProfile.id === "fixture-signature-profile"
    || keyResolutionContract?.purpose === "conformance_fixture_only"
    || keyResolutionContract?.operationalUse === "prohibited") {
    issues.push(`${owner}: deployment_bound cannot use conformance-fixture signature trust`);
  }
  for (const [field, expected] of Object.entries(operationalContractTypes)) {
    const pointer = signatureProfile[field];
    if (pointer?.contractType !== expected.contractType
      || pointer?.schemaVersion !== expected.schemaVersion) {
      issues.push(`${owner}: deployment_bound requires typed ${field} ${expected.schemaVersion}`);
    }
    const resolved = field === "keyResolutionContract" ? keyResolutionContract : contracts[field];
    if (resolved?.schemaVersion !== expected.schemaVersion) {
      issues.push(`${owner}: resolved ${field} has the wrong schemaVersion`);
    }
  }
  if (keyResolutionContract?.schemaVersion !== "agent-eval-key-authorization-contract-1") {
    return issues;
  }
  if (keyResolutionContract.purpose !== "operational_key_resolution_and_authorization"
    || keyResolutionContract.operationalUse !== "permitted_after_endpoint_and_owner_verification") {
    issues.push(`${owner}: deployment key-authorization contract is not approved for operational use`);
  }
  const matches = (keyResolutionContract.keys ?? []).filter((entry) => entry.keyId === signature.keyId);
  if (matches.length !== 1) {
    issues.push(`${owner}: deployment signing key ${signature.keyId ?? "<missing>"} resolves ${matches.length} times`);
    return issues;
  }
  const key = matches[0];
  if (key.status !== "active") issues.push(`${owner}: deployment signing key is not active`);
  if (key.reassignment !== "forbidden") issues.push(`${owner}: deployment signing key permits keyId reassignment`);
  const expectedKeyType = { Ed25519: "Ed25519", ES256: "P-256", PS256: "RSA" }[signature.algorithm];
  if (key.algorithm !== signature.algorithm || key.keyType !== expectedKeyType) {
    issues.push(`${owner}: deployment signing key algorithm or type differs from the signature`);
  }
  if (!(key.authorizedArtifactSchemaVersions ?? []).includes(document.schemaVersion)) {
    issues.push(`${owner}: deployment signing key is not authorized for ${document.schemaVersion}`);
  }
  const signedAt = Date.parse(signature.signedAt);
  const validFrom = Date.parse(key.validFrom);
  const validUntil = Date.parse(key.validUntil);
  if (!Number.isFinite(signedAt) || !Number.isFinite(validFrom) || !Number.isFinite(validUntil)
    || signedAt < validFrom || signedAt > validUntil) {
    issues.push(`${owner}: deployment signature is outside the key validity interval`);
  }
  if (document.schemaVersion === "agent-eval-evaluation-profile-1") {
    const requiredRole = document.owner?.role;
    if (typeof requiredRole !== "string" || !(key.authorizedRoles ?? []).includes(requiredRole)) {
      issues.push(`${owner}: deployment signing key is not authorized for the evaluation-profile owner role`);
    }
    for (const assurance of document.supportedAssuranceLevels ?? []) {
      for (const risk of document.effectiveRiskRange ?? []) {
        if (!(key.authorizedScopes ?? []).some((scope) => scopeCovers(scope, document.id, assurance, risk))) {
          issues.push(`${owner}: deployment signing key scope does not cover ${document.id}:${assurance}:${risk}`);
        }
      }
    }
  }
  return issues;
}

export function resolveLeafClaimTrustBinding(profile, owner = "evaluation profile") {
  const issues = pointerIssues(profile?.claimTrustProfile, "claimTrustProfile", owner);
  const pointer = profile?.claimTrustProfile;
  if (!trustUses.has(profile?.claimTrustUse)) {
    issues.push(`${owner}: leaf claimTrustUse is missing or unknown`);
  }
  return {
    binding: issues.length === 0 ? {
      claimTrustProfile: structuredClone(pointer),
      claimTrustUse: profile.claimTrustUse
    } : null,
    issues
  };
}
