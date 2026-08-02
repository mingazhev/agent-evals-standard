import process from "node:process";
import {
  resolveLeafClaimTrustBinding,
  resolveLeafSignatureBinding,
  signatureProfileUseIssues
} from "./profile-trust-binding.mjs";

const digest = (character) => `sha256:${character.repeat(64)}`;
const fixtureClaimPointer = {
  id: "fixture-claim-trust",
  version: "0.1.0",
  uri: "fixture-trust.json",
  digest: digest("1")
};
const deploymentClaimPointer = {
  id: "adopter-operational-trust",
  version: "0.1.0",
  uri: "https://trust.example.invalid/profile.json",
  digest: digest("2")
};
const fixtureSignaturePointer = {
  id: "fixture-signature-profile",
  version: "0.1.0",
  uri: "fixture-signature.json",
  digest: digest("3")
};
const deploymentSignaturePointer = {
  id: "adopter-signature-profile",
  version: "0.1.0",
  uri: "external-signature.json",
  digest: digest("4")
};

const typedPointers = {
  keyResolutionContract: {
    contractType: "key_resolution_and_authorization",
    schemaVersion: "agent-eval-key-authorization-contract-1",
    id: "adopter-key-authorization",
    version: "0.1.0",
    uri: "key-authorization.json",
    digest: digest("5")
  },
  revocationContract: {
    contractType: "revocation_state",
    schemaVersion: "agent-eval-revocation-state-contract-1",
    id: "adopter-revocation",
    version: "0.1.0",
    uri: "revocation.json",
    digest: digest("6")
  },
  timeValidationContract: {
    contractType: "trusted_time",
    schemaVersion: "agent-eval-trusted-time-contract-1",
    id: "adopter-trusted-time",
    version: "0.1.0",
    uri: "trusted-time.json",
    digest: digest("7")
  },
  antiRollbackPolicy: {
    contractType: "anti_rollback",
    schemaVersion: "agent-eval-anti-rollback-policy-1",
    id: "adopter-anti-rollback",
    version: "0.1.0",
    uri: "anti-rollback.json",
    digest: digest("8")
  }
};

const deploymentSignatureProfile = {
  id: "adopter-signature-profile",
  allowedAlgorithms: ["Ed25519"],
  ...structuredClone(typedPointers)
};
const deploymentDocument = {
  schemaVersion: "agent-eval-evaluation-profile-1",
  id: "adopter-child-v1",
  owner: { id: "adopter-profile-team", role: "profile_maintainer" },
  claimTrustUse: "deployment_bound",
  supportedAssuranceLevels: ["A1", "A2", "A3"],
  effectiveRiskRange: ["low", "medium", "high", "critical"],
  signatureProfile: structuredClone(deploymentSignaturePointer),
  signature: {
    profileId: "adopter-signature-profile",
    algorithm: "Ed25519",
    keyId: "adopter-profile-key-1",
    signedAt: "2026-08-01T00:00:00Z",
    value: "A".repeat(86)
  }
};
const deploymentContracts = {
  keyResolutionContract: {
    schemaVersion: "agent-eval-key-authorization-contract-1",
    purpose: "operational_key_resolution_and_authorization",
    operationalUse: "permitted_after_endpoint_and_owner_verification",
    keys: [
      {
        keyId: "adopter-profile-key-1",
        algorithm: "Ed25519",
        keyType: "Ed25519",
        authorizedRoles: ["profile_maintainer"],
        authorizedArtifactSchemaVersions: ["agent-eval-evaluation-profile-1"],
        authorizedScopes: ["adopter-child-v1:A1-A3:low-critical"],
        validFrom: "2026-01-01T00:00:00Z",
        validUntil: "2027-01-01T00:00:00Z",
        status: "active",
        reassignment: "forbidden"
      }
    ]
  },
  revocationContract: { schemaVersion: "agent-eval-revocation-state-contract-1" },
  timeValidationContract: { schemaVersion: "agent-eval-trusted-time-contract-1" },
  antiRollbackPolicy: { schemaVersion: "agent-eval-anti-rollback-policy-1" }
};

const failures = [];
function expectResult(id, result, valid, expectedError) {
  if ((result.issues.length === 0) !== valid) {
    failures.push(`${id}: ${result.issues.join("; ") || "unexpected acceptance"}`);
  } else if (!valid && !result.issues.some((issue) => issue.includes(expectedError))) {
    failures.push(`${id}: expected ${expectedError}, found ${result.issues.join("; ")}`);
  }
}

const claimVectors = [
  {
    id: "explicit-fixture-claim-repeat-remains-leaf-binding",
    child: { claimTrustProfile: fixtureClaimPointer, claimTrustUse: "conformance_fixture_requires_external_rekey" },
    valid: true,
    expectedId: "fixture-claim-trust",
    expectedUse: "conformance_fixture_requires_external_rekey"
  },
  {
    id: "deployment-child-rebinds-claim-trust-without-parent-inheritance",
    child: { claimTrustProfile: deploymentClaimPointer, claimTrustUse: "deployment_bound" },
    valid: true,
    expectedId: "adopter-operational-trust",
    expectedUse: "deployment_bound"
  },
  {
    id: "missing-leaf-claim-profile-rejected",
    child: { claimTrustUse: "deployment_bound" },
    valid: false,
    expectedError: "leaf claimTrustProfile is required"
  },
  {
    id: "missing-leaf-claim-use-rejected",
    child: { claimTrustProfile: deploymentClaimPointer },
    valid: false,
    expectedError: "leaf claimTrustUse is missing or unknown"
  },
  {
    id: "malformed-leaf-claim-digest-rejected",
    child: { claimTrustProfile: { ...deploymentClaimPointer, digest: "sha256:bad" }, claimTrustUse: "deployment_bound" },
    valid: false,
    expectedError: "must be a sha256 digest"
  }
];

for (const vector of claimVectors) {
  const result = resolveLeafClaimTrustBinding(vector.child, vector.id);
  expectResult(vector.id, result, vector.valid, vector.expectedError);
  if (vector.valid && (result.binding.claimTrustProfile.id !== vector.expectedId
    || result.binding.claimTrustUse !== vector.expectedUse)) {
    failures.push(`${vector.id}: resolver did not select the explicit leaf claim-trust binding`);
  }
}

const signatureLeafVectors = [
  {
    id: "explicit-fixture-signature-repeat-remains-leaf-binding",
    child: {
      signatureProfile: fixtureSignaturePointer,
      signature: { profileId: "fixture-signature-profile" }
    },
    valid: true,
    expectedId: "fixture-signature-profile"
  },
  {
    id: "deployment-child-rebinds-signature-without-parent-inheritance",
    child: deploymentDocument,
    valid: true,
    expectedId: "adopter-signature-profile"
  },
  {
    id: "missing-leaf-signature-profile-rejected",
    child: { signature: { profileId: "adopter-signature-profile" } },
    valid: false,
    expectedError: "leaf signatureProfile is required"
  },
  {
    id: "missing-leaf-profile-signature-rejected",
    child: { signatureProfile: deploymentSignaturePointer },
    valid: false,
    expectedError: "leaf profile signature is required"
  },
  {
    id: "leaf-signature-profile-id-mismatch-rejected",
    child: {
      signatureProfile: deploymentSignaturePointer,
      signature: { profileId: "parent-signature-profile" }
    },
    valid: false,
    expectedError: "signature.profileId must equal signatureProfile.id"
  },
  {
    id: "malformed-leaf-signature-digest-rejected",
    child: {
      signatureProfile: { ...deploymentSignaturePointer, digest: "sha256:bad" },
      signature: { profileId: "adopter-signature-profile" }
    },
    valid: false,
    expectedError: "must be a sha256 digest"
  }
];

for (const vector of signatureLeafVectors) {
  const result = resolveLeafSignatureBinding(vector.child, vector.id);
  expectResult(vector.id, result, vector.valid, vector.expectedError);
  if (vector.valid && result.binding.id !== vector.expectedId) {
    failures.push(`${vector.id}: resolver did not select the explicit leaf signature binding`);
  }
}

function useVector(id, mutate, valid, expectedError) {
  const document = structuredClone(deploymentDocument);
  const signatureProfile = structuredClone(deploymentSignatureProfile);
  const contracts = structuredClone(deploymentContracts);
  mutate?.({ document, signatureProfile, contracts });
  const issues = signatureProfileUseIssues({ document, signatureProfile, contracts }, id);
  expectResult(id, { issues }, valid, expectedError);
}

useVector("typed-external-deployment-signature-binding-valid", null, true);
useVector("fixture-signature-profile-rejected-for-deployment", ({ signatureProfile }) => {
  signatureProfile.id = "fixture-signature-profile";
}, false, "cannot use conformance-fixture signature trust");
useVector("repository-reference-signature-profile-rejected-for-deployment", ({ signatureProfile }) => {
  signatureProfile.operationalReference = {
    deploymentUse: "prohibited_until_external_rekey_and_owner_verification"
  };
}, false, "cannot use a repository operational-reference signature profile");
useVector("untyped-key-authorization-binding-rejected", ({ signatureProfile }) => {
  delete signatureProfile.keyResolutionContract.contractType;
  delete signatureProfile.keyResolutionContract.schemaVersion;
}, false, "requires typed keyResolutionContract");
useVector("missing-authenticated-revocation-binding-rejected", ({ contracts }) => {
  delete contracts.revocationContract;
}, false, "resolved revocationContract has the wrong schemaVersion");
useVector("wrong-resolved-trusted-time-schema-rejected", ({ contracts }) => {
  contracts.timeValidationContract.schemaVersion = "claimant-time-contract-1";
}, false, "resolved timeValidationContract has the wrong schemaVersion");
useVector("algorithm-downgrade-rejected", ({ document }) => {
  document.signature.algorithm = "ES256";
}, false, "is not allowed by the leaf signature profile");
useVector("duplicate-deployment-key-rejected", ({ contracts }) => {
  contracts.keyResolutionContract.keys.push(structuredClone(contracts.keyResolutionContract.keys[0]));
}, false, "resolves 2 times");
useVector("inactive-deployment-key-rejected", ({ contracts }) => {
  contracts.keyResolutionContract.keys[0].status = "revoked";
}, false, "signing key is not active");
useVector("reassignable-deployment-key-rejected", ({ contracts }) => {
  contracts.keyResolutionContract.keys[0].reassignment = "permitted";
}, false, "permits keyId reassignment");
useVector("unauthorized-evaluation-profile-schema-rejected", ({ contracts }) => {
  contracts.keyResolutionContract.keys[0].authorizedArtifactSchemaVersions = ["agent-eval-scorecard-1"];
}, false, "not authorized for agent-eval-evaluation-profile-1");
useVector("unauthorized-profile-owner-role-rejected", ({ contracts }) => {
  contracts.keyResolutionContract.keys[0].authorizedRoles = ["unrelated_role"];
}, false, "not authorized for the evaluation-profile owner role");
useVector("partial-profile-scope-rejected", ({ contracts }) => {
  contracts.keyResolutionContract.keys[0].authorizedScopes = ["adopter-child-v1:A1-A2:low-critical"];
}, false, "scope does not cover adopter-child-v1:A3:low");
useVector("out-of-interval-deployment-signature-rejected", ({ document }) => {
  document.signature.signedAt = "2028-01-01T00:00:00Z";
}, false, "outside the key validity interval");
useVector("key-algorithm-type-substitution-rejected", ({ contracts }) => {
  contracts.keyResolutionContract.keys[0].keyType = "P-256";
}, false, "algorithm or type differs from the signature");
useVector("nonoperational-key-contract-rejected", ({ contracts }) => {
  contracts.keyResolutionContract.operationalUse = "prohibited";
}, false, "not approved for operational use");

const vectorCount = claimVectors.length + signatureLeafVectors.length + 16;
if (failures.length > 0) {
  process.stderr.write(`Profile trust-binding vectors failed (${failures.length}):\n- ${failures.join("\n- ")}\n`);
  process.exit(1);
}
process.stdout.write(`Profile trust-binding vectors passed: ${vectorCount}/${vectorCount}.\n`);
