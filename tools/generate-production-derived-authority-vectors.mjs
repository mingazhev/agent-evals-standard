import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign
} from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

// Public deterministic conformance seeds. They are never operational secrets.
const FIXTURE_SEEDS = Object.freeze({
  provenance: "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
  data_owner: "0f0e0d0c0b0a09080706050403020100112233445566778899aabbccddeeff00",
  privacy: "c5aa8df43f9f837bedb7442f31dcb7b166d38535076f094b85ce3a2e0b4458f7",
  isolation: "8a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c",
  scheduler: "4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb"
});
const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const OUTPUT_ROOT = path.resolve("conformance/fixtures/production-derived-authority");
const PAYLOAD_ROOT = path.join(OUTPUT_ROOT, "payloads");
const MACHINE_ROOT = path.resolve("conformance/fixtures/machine-contracts-v1/positive");

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

function privateKey(seedHex) {
  return createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, Buffer.from(seedHex, "hex")]),
    format: "der",
    type: "pkcs8"
  });
}

function authority(authorityId, producer, keyId, seedName) {
  const publicDer = createPublicKey(privateKey(FIXTURE_SEEDS[seedName]))
    .export({ format: "der", type: "spki" });
  return {
    authorityId,
    producer,
    attestation: {
      profileId: "production-derived-fixture-authority-profile",
      algorithm: "Ed25519",
      keyId,
      publicKey: {
        format: "spki_der_base64",
        contentBase64: publicDer.toString("base64"),
        digest: sha256(publicDer)
      }
    }
  };
}

function artifact(id, producer, schemaId, verifier, payloadPath, payloadBytes, createdAt, keyId, seedName) {
  const digest = sha256(payloadBytes);
  const result = {
    id,
    uri: `artifact:${digest}`,
    mediaType: "application/json",
    digest,
    byteLength: payloadBytes.length,
    payload: { kind: "repository_relative", path: payloadPath },
    producer,
    creationPhase: seedName === "isolation" ? "pre_run" : "case_qa",
    createdAt,
    schemaMetadata: {
      schemaId,
      schemaVersion: "0.1.0",
      validatorDigest: verifier.digest
    },
    mediaInterpretation: {
      profileId: "json-rfc8259",
      profileVersion: "0.1.0",
      semanticContract: verifier
    },
    accessClass: "internal",
    accessPolicyBinding: {
      id: "production-derived-fixture-access-policy",
      version: "0.1.0",
      digest: sha256(Buffer.from("production-derived-fixture-access-policy-0.1.0", "utf8"))
    },
    privacyAndIp: { classification: "none", restrictions: [] },
    retention: {
      class: "conformance_fixture",
      expiresAt: "2027-08-01T00:00:00Z",
      disposition: "delete",
      legalHold: false
    },
    attestation: {
      profileId: "production-derived-fixture-authority-profile",
      algorithm: "Ed25519",
      keyId,
      signedAt: createdAt,
      value: ""
    }
  };
  const projection = structuredClone(result);
  delete projection.attestation.value;
  const message = Buffer.concat([
    Buffer.from("agent-evals-evidence-artifact-1", "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalize(projection), "utf8")
  ]);
  result.attestation.value = sign(null, message, privateKey(FIXTURE_SEEDS[seedName])).toString("base64url");
  return result;
}

function sealDocument(document, seedName, profileId, keyId, signedAt) {
  const digestProjection = structuredClone(document);
  delete digestProjection.digest;
  delete digestProjection.signature;
  document.digest = sha256Canonical(digestProjection);
  document.signature = { profileId, algorithm: "Ed25519", keyId, signedAt, value: "" };
  const signingProjection = structuredClone(document);
  delete signingProjection.signature.value;
  const message = Buffer.concat([
    Buffer.from(document.schemaVersion, "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalize(signingProjection), "utf8")
  ]);
  document.signature.value = sign(null, message, privateKey(FIXTURE_SEEDS[seedName])).toString("base64url");
}

async function writeJson(target, value, pretty = true) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, pretty ? 2 : 0)}\n`, "utf8");
  await writeFile(target, bytes);
  return bytes;
}

function preRunProjection(preRun) {
  const projection = structuredClone(preRun);
  delete projection.evaluationControlBindings;
  delete projection.digest;
  delete projection.signature;
  return projection;
}

function rebaseLocators(value, sourceOwner, targetOwner) {
  if (!value || typeof value !== "object") return;
  if (!Array.isArray(value) && value.locator?.kind === "repository_relative"
    && value.locator?.base === "binding_document") {
    const target = path.resolve(sourceOwner, value.locator.path);
    value.locator.path = path.relative(targetOwner, target).replaceAll("\\", "/");
  }
  for (const nested of Array.isArray(value) ? value : Object.values(value)) {
    rebaseLocators(nested, sourceOwner, targetOwner);
  }
}

async function rebuildEvaluationControlChain(preRun) {
  const focusedPreRun = JSON.parse(await readFile(path.join(MACHINE_ROOT, "stage-pre-run-manifest.json"), "utf8"));
  const controls = JSON.parse(await readFile(path.join(MACHINE_ROOT, "control-bindings.json"), "utf8"));
  preRun.suite = structuredClone(focusedPreRun.suite);
  preRun.caseSet = structuredClone(focusedPreRun.caseSet);
  rebaseLocators(preRun.suite, MACHINE_ROOT, OUTPUT_ROOT);
  rebaseLocators(preRun.caseSet, MACHINE_ROOT, OUTPUT_ROOT);
  preRun.caseProfiles = focusedPreRun.caseProfiles.map((profile) => ({
    ...structuredClone(profile),
    bindingUse: "diagnostic_only"
  }));
  for (const cell of preRun.scheduledCells) cell.caseId = preRun.caseSet[0].id;

  rebaseLocators(controls, MACHINE_ROOT, OUTPUT_ROOT);
  const preRunStage = controls.stageBindings.find((entry) => entry.stage === "pre_run");
  if (!preRunStage) throw new Error("machine-contract fixture has no pre_run stage binding");
  preRunStage.subject = {
    id: preRun.id,
    artifactVersion: "0.1.0",
    schemaId: "urn:agent-evals-standard:schema:pre-run-manifest:1",
    identityProjection: "full_document_without_evaluation_control_bindings_digest_signature",
    digest: sha256Canonical(preRunProjection(preRun))
  };
  preRunStage.sealedAt = preRun.sealedAt;
  const controlBytes = await writeJson(path.join(OUTPUT_ROOT, "evaluation-control-bindings.json"), controls);

  const binding = structuredClone(focusedPreRun.evaluationControlBindings);
  rebaseLocators(binding, MACHINE_ROOT, OUTPUT_ROOT);
  const controlDigest = sha256(controlBytes);
  binding.uri = `artifact:${controlDigest}`;
  binding.digest = controlDigest;
  binding.byteLength = controlBytes.length;
  binding.locator.path = "evaluation-control-bindings.json";
  preRun.evaluationControlBindings = binding;
}

await mkdir(PAYLOAD_ROOT, { recursive: true });
const verifierPath = path.resolve("profiles/repo-change-v1/verify-production-derived.mjs");
const verifierBytes = await readFile(verifierPath);
const verifier = {
  id: "repo-change-production-derived-verifier",
  version: "0.1.0",
  digest: sha256(verifierBytes)
};

const authorities = [
  authority("production-data-provenance-authority", {
    id: "fixture-data-provenance-custodian",
    role: "data-provenance",
    trustDomain: "external"
  }, "production-provenance-key", "provenance"),
  authority("production-data-owner-authority", {
    id: "fixture-data-owner",
    role: "data-owner",
    trustDomain: "governance"
  }, "production-data-owner-key", "data_owner"),
  authority("production-privacy-authority", {
    id: "fixture-privacy-verifier",
    role: "privacy-verifier",
    trustDomain: "case_qa"
  }, "production-privacy-key", "privacy"),
  authority("production-isolation-authority", {
    id: "fixture-isolation-verifier",
    role: "environment-verifier",
    trustDomain: "runner"
  }, "production-isolation-key", "isolation")
];
const authorityById = new Map(authorities.map((entry) => [entry.authorityId, entry]));

const authorityContract = {
  schemaVersion: "agent-eval-production-derived-authority-contract-1",
  id: "repo-change-production-derived-authorities",
  version: "0.1.0",
  authorities,
  proofPolicies: [
    {
      proofKind: "production_input_provenance",
      authorityId: "production-data-provenance-authority",
      creationPhase: "case_qa",
      evidenceSchemaId: "production-input-provenance-proof-1",
      verifier
    },
    {
      proofKind: "data_owner_authorization",
      authorityId: "production-data-owner-authority",
      creationPhase: "case_qa",
      evidenceSchemaId: "production-input-authorization-proof-1",
      verifier
    },
    {
      proofKind: "redaction_verification",
      authorityId: "production-privacy-authority",
      creationPhase: "case_qa",
      evidenceSchemaId: "production-input-redaction-proof-1",
      verifier
    },
    {
      proofKind: "reidentification_assessment",
      authorityId: "production-privacy-authority",
      creationPhase: "case_qa",
      evidenceSchemaId: "production-input-reidentification-proof-1",
      verifier
    },
    {
      proofKind: "production_path_isolation",
      authorityId: "production-isolation-authority",
      creationPhase: "pre_run",
      evidenceSchemaId: "production-input-isolation-proof-1",
      verifier
    }
  ],
  separation: {
    independentProofKinds: [
      "data_owner_authorization",
      "redaction_verification",
      "production_path_isolation"
    ],
    distinctProducerIds: true,
    distinctTrustDomains: true,
    distinctAttestationKeyIds: true
  },
  digest: ""
};
const authorityDigestProjection = structuredClone(authorityContract);
delete authorityDigestProjection.digest;
authorityContract.digest = sha256Canonical(authorityDigestProjection);
const authorityBytes = await writeJson(path.join(OUTPUT_ROOT, "authority-contract.json"), authorityContract);
const authorityRawDigest = sha256(authorityBytes);

const sourceCutoff = "2026-07-31T22:00:00Z";
const snapshotPayload = {
  datasetId: "production-derived-fixture-snapshot",
  records: [{ repository: "example/service", event: "redacted-build-failure", secret: "[REDACTED]" }],
  sourceCutoff
};
const snapshotBytes = await writeJson(path.join(PAYLOAD_ROOT, "input-snapshot.json"), snapshotPayload, false);
const snapshotDigest = sha256(snapshotBytes);
const policy = {
  id: "production-input-redaction-policy-fixture",
  version: "0.1.0",
  digest: sha256(Buffer.from("production-input-redaction-policy-fixture-0.1.0", "utf8"))
};
const method = {
  id: "production-input-reidentification-method-fixture",
  version: "0.1.0",
  digest: sha256(Buffer.from("production-input-reidentification-method-fixture-0.1.0", "utf8"))
};
const provenanceControl = {
  exportLedgerDigest: sha256(Buffer.from("fixture-production-export-ledger-entry", "utf8")),
  transformation: {
    id: "sealed-redaction-pipeline-v1",
    version: "0.1.0",
    digest: sha256(Buffer.from("sealed-redaction-pipeline-v1-0.1.0", "utf8"))
  }
};

const environmentBase = {
  schemaVersion: "agent-eval-environment-contract-1",
  id: "environment-contract-production-derived-authority-fixture",
  version: "0.1.0",
  evaluationMode: "controlled_fixture",
  productionActionAllowed: false,
  productionTelemetryPolicy: {
    allowedPurposes: ["validity"],
    taskInputAllowed: false,
    trialOutcomeEvidenceAllowed: false,
    scheduledCellAllowed: false
  },
  runtimes: [{
    id: "node-runtime",
    version: "0.1.0",
    digest: sha256(Buffer.from("node-runtime-fixture-0.1.0", "utf8"))
  }],
  dependencyResolution: {
    id: "dependency-resolution-contract",
    version: "0.1.0",
    digest: sha256(Buffer.from("dependency-resolution-contract-0.1.0", "utf8")),
    schemaId: "dependency-resolution-contract-schema",
    verifier
  },
  network: { default: "deny", allowlist: [], auditEvidenceRequired: true },
  filesystem: {
    ephemeral: true,
    agentWritableRoots: ["/workspace"],
    oracleReadable: false,
    controlPlaneAccessible: false,
    contract: {
      id: "filesystem-isolation-contract",
      version: "0.1.0",
      digest: sha256(Buffer.from("filesystem-isolation-contract-0.1.0", "utf8")),
      schemaId: "filesystem-isolation-contract-schema",
      verifier
    }
  },
  process: {
    ephemeral: true,
    agentWritableRoots: ["/workspace"],
    oracleReadable: false,
    controlPlaneAccessible: false,
    contract: {
      id: "process-isolation-contract",
      version: "0.1.0",
      digest: sha256(Buffer.from("process-isolation-contract-0.1.0", "utf8")),
      schemaId: "process-isolation-contract-schema",
      verifier
    }
  },
  resources: { cpu: 2, memoryBytes: 2147483648, diskBytes: 10737418240, wallClockSeconds: 900 },
  cache: { resetPerAttempt: true, sharedState: "none" },
  logging: {
    id: "logging-contract",
    version: "0.1.0",
    digest: sha256(Buffer.from("logging-contract-0.1.0", "utf8")),
    schemaId: "logging-contract-schema",
    verifier
  },
  teardown: {
    id: "teardown-contract",
    version: "0.1.0",
    digest: sha256(Buffer.from("teardown-contract-0.1.0", "utf8")),
    schemaId: "teardown-contract-schema",
    verifier
  }
};
const boundaryDigest = sha256Canonical({
  evaluationMode: environmentBase.evaluationMode,
  productionActionAllowed: environmentBase.productionActionAllowed,
  productionTelemetryPolicy: environmentBase.productionTelemetryPolicy,
  network: environmentBase.network,
  filesystem: environmentBase.filesystem,
  process: environmentBase.process
});

const payloads = {
  production_input_provenance: {
    file: "payloads/provenance-proof.json",
    createdAt: "2026-07-31T22:11:00Z",
    verifiedAt: "2026-07-31T22:12:00Z",
    authorityId: "production-data-provenance-authority",
    seed: "provenance",
    schemaId: "production-input-provenance-proof-1",
    artifactId: "production-input-provenance-evidence-fixture",
    value: {
      kind: "production_input_provenance",
      subjectDigest: snapshotDigest,
      sourceCutoff,
      sourceSystemIds: ["fixture-production-export-ledger"],
      datasetId: snapshotPayload.datasetId,
      sourceRecordCount: snapshotPayload.records.length,
      exportLedgerDigest: provenanceControl.exportLedgerDigest,
      transformationId: provenanceControl.transformation.id,
      transformationVersion: provenanceControl.transformation.version,
      transformationDigest: provenanceControl.transformation.digest,
      result: "pass"
    }
  },
  data_owner_authorization: {
    file: "payloads/authorization-proof.json",
    createdAt: "2026-07-31T22:15:30Z",
    verifiedAt: "2026-07-31T22:16:00Z",
    authorityId: "production-data-owner-authority",
    seed: "data_owner",
    schemaId: "production-input-authorization-proof-1",
    artifactId: "production-input-owner-authorization-evidence-fixture",
    value: {
      kind: "data_owner_authorization",
      ownerId: "fixture-data-owner",
      scopeDigest: snapshotDigest,
      purpose: "evaluation_fixture_use",
      decision: "authorized",
      authorizedAt: "2026-07-31T22:15:00Z",
      result: "pass"
    }
  },
  redaction_verification: {
    file: "payloads/redaction-proof.json",
    createdAt: "2026-07-31T22:19:00Z",
    verifiedAt: "2026-07-31T22:20:00Z",
    authorityId: "production-privacy-authority",
    seed: "privacy",
    schemaId: "production-input-redaction-proof-1",
    artifactId: "production-input-redaction-evidence-fixture",
    value: {
      kind: "redaction_verification",
      subjectDigest: snapshotDigest,
      policyId: policy.id,
      policyVersion: policy.version,
      policyDigest: policy.digest,
      directIdentifiersFound: 0,
      secretsFound: 0,
      unresolvedFindings: 0,
      result: "pass"
    }
  },
  reidentification_assessment: {
    file: "payloads/reidentification-proof.json",
    createdAt: "2026-07-31T22:24:00Z",
    verifiedAt: "2026-07-31T22:25:00Z",
    authorityId: "production-privacy-authority",
    seed: "privacy",
    schemaId: "production-input-reidentification-proof-1",
    artifactId: "production-input-reidentification-evidence-fixture",
    value: {
      kind: "reidentification_assessment",
      subjectDigest: snapshotDigest,
      methodId: method.id,
      methodVersion: method.version,
      methodDigest: method.digest,
      decision: "approved_for_evaluation_use",
      residualRiskScore: 0.05,
      result: "pass"
    }
  },
  production_path_isolation: {
    file: "payloads/isolation-proof.json",
    createdAt: "2026-07-31T22:29:00Z",
    verifiedAt: "2026-07-31T22:30:00Z",
    authorityId: "production-isolation-authority",
    seed: "isolation",
    schemaId: "production-input-isolation-proof-1",
    artifactId: "production-input-isolation-evidence-fixture",
    value: {
      kind: "production_path_isolation",
      subjectDigest: boundaryDigest,
      boundaryProjection: "environment_production_path_boundary_v1",
      boundaryDigest,
      productionReadPathAvailable: false,
      productionWritePathAvailable: false,
      liveProductionConnectivityAvailable: false,
      productionCredentialsPresent: false,
      result: "pass"
    }
  }
};

const evidenceEntries = [];
const proofByKind = {};
for (const [kind, definition] of Object.entries(payloads)) {
  const payloadBytes = await writeJson(path.join(OUTPUT_ROOT, definition.file), definition.value, false);
  const authorityEntry = authorityById.get(definition.authorityId);
  const evidenceArtifact = artifact(
    definition.artifactId,
    authorityEntry.producer,
    definition.schemaId,
    verifier,
    definition.file,
    payloadBytes,
    definition.createdAt,
    authorityEntry.attestation.keyId,
    definition.seed
  );
  evidenceEntries.push({ proofKind: kind, payloadPath: definition.file, artifact: evidenceArtifact });
  proofByKind[kind] = {
    subjectDigest: kind === "production_path_isolation" ? boundaryDigest : snapshotDigest,
    evidence: { id: evidenceArtifact.id, uri: evidenceArtifact.uri, digest: evidenceArtifact.digest },
    verifier,
    verifiedAt: definition.verifiedAt,
    result: "pass"
  };
}

const environment = {
  ...environmentBase,
  inputOrigin: "production_derived",
  productionDerivedInput: {
    authorityContract: {
      id: authorityContract.id,
      version: authorityContract.version,
      schemaId: "urn:agent-evals-standard:schema:production-derived-authority-contract:1",
      uri: `artifact:${authorityRawDigest}`,
      digest: authorityRawDigest,
      byteLength: authorityBytes.length
    },
    sourceCutoff,
    sourceSystemIds: ["fixture-production-export-ledger"],
    inputSnapshot: {
      id: "production-derived-input-snapshot-fixture",
      uri: `artifact:${snapshotDigest}`,
      digest: snapshotDigest,
      mediaType: "application/vnd.agent-evals.input-snapshot+json",
      byteLength: snapshotBytes.length,
      createdAt: "2026-07-31T22:10:00Z"
    },
    provenanceControl,
    provenance: proofByKind.production_input_provenance,
    dataOwnerAuthorization: {
      ownerId: "fixture-data-owner",
      purpose: "evaluation_fixture_use",
      decision: "authorized",
      scopeDigest: snapshotDigest,
      authorizedAt: "2026-07-31T22:15:00Z",
      proof: proofByKind.data_owner_authorization
    },
    redactionVerification: { policy, proof: proofByKind.redaction_verification },
    reidentificationAssessment: {
      method,
      maximumResidualRisk: 0.2,
      decision: "approved_for_evaluation_use",
      proof: proofByKind.reidentification_assessment
    },
    productionIsolationVerification: {
      boundaryProjection: "environment_production_path_boundary_v1",
      boundaryDigest,
      productionReadPathAvailable: false,
      productionWritePathAvailable: false,
      liveProductionConnectivityAvailable: false,
      productionCredentialsPresent: false,
      proof: proofByKind.production_path_isolation
    }
  },
  digest: ""
};
const environmentDigestProjection = structuredClone(environment);
delete environmentDigestProjection.digest;
environment.digest = sha256Canonical(environmentDigestProjection);
await writeJson(path.join(OUTPUT_ROOT, "environment.json"), environment);

const fixtureComponent = (id) => ({
  id,
  version: "0.1.0",
  digest: sha256(Buffer.from(`${id}-0.1.0`, "utf8"))
});
const fixturePointer = (id) => ({
  id,
  uri: `artifact:fixture:${id}`,
  digest: sha256(Buffer.from(`${id}-fixture`, "utf8"))
});
const fixtureVersionedPointer = (id) => ({
  ...fixturePointer(id),
  version: "0.1.0"
});
const caseId = "production-derived-fixture-case";
const armId = "production-derived-fixture-arm";
const riskFactors = {
  inherentHazards: [{
    id: "production-derived-data-misuse",
    description: "A diagnostic can mishandle production-derived fixture inputs.",
    plausibleHarm: "Isolation or evidence-integrity controls can be invalidated.",
    severity: "serious",
    tier: "medium",
    evidence: [fixturePointer("production-derived-risk-hazard-evidence")]
  }],
  dataSensitivityAndAssets: {
    classification: "synthetic production-derived fixture",
    affectedAssets: ["isolated evaluation inputs"],
    tier: "medium",
    evidence: [fixturePointer("production-derived-risk-data-evidence")]
  },
  autonomyPermissionsToolsAndReversibility: {
    autonomy: "diagnostic only",
    permissions: ["isolated fixture read and write"],
    tools: ["fixture harness"],
    reversibility: "fully_reversible",
    tier: "low",
    evidence: [fixturePointer("production-derived-risk-control-evidence")]
  },
  executionAndDeploymentEnvironment: {
    executionEnvironment: "sealed production-derived fixture environment",
    deploymentEnvironment: "none",
    tier: "medium",
    evidence: [fixturePointer("production-derived-risk-environment-evidence")]
  },
  scopeBlastRadiusExposureAndOversight: {
    scope: "one diagnostic case and arm",
    blastRadius: "isolated conformance fixture",
    exposureDurationSeconds: 600,
    humanOversight: "checkpointed",
    tier: "low",
    evidence: [fixturePointer("production-derived-risk-exposure-evidence")]
  },
  likelihoodAndUncertainty: {
    likelihood: "unlikely",
    uncertainty: "crosses_tier_boundary",
    tier: "low",
    upperApplicableTier: "medium",
    evidence: [fixturePointer("production-derived-risk-likelihood-evidence")]
  }
};
const riskAssessment = {
  schemaVersion: "risk-assessment-1",
  id: "production-derived-authority-risk-fixture",
  version: "0.1.0",
  assessmentKind: "experiment_envelope",
  scope: { caseIds: [caseId], armIds: [armId], decisionEnvelopeId: null },
  factors: riskFactors,
  derivation: {
    policy: fixtureVersionedPointer("risk-derivation-policy-v1"),
    algorithm: "maximum_applicable_tier_v1",
    factorInputDigest: sha256Canonical(riskFactors),
    evidence: [fixturePointer("production-derived-risk-derivation-evidence")],
    derivedAt: "2026-08-01T01:00:04Z",
    derivedBy: { id: "fixture-risk-assessor", role: "risk_assessor" }
  },
  effectiveRiskTier: "medium",
  approval: {
    riskOwner: { id: "fixture-risk-owner", role: "risk_owner" },
    approvedAt: "2026-08-01T01:00:05Z",
    evidence: fixturePointer("production-derived-risk-approval-evidence")
  }
};
sealDocument(
  riskAssessment,
  "provenance",
  "fixture-signature-profile",
  "rfc8032-test-key-1",
  "2026-08-01T01:00:05Z"
);
await writeJson(path.join(OUTPUT_ROOT, "risk-assessment.json"), riskAssessment);

const preRun = {
  schemaVersion: "agent-eval-pre-run-manifest-1",
  id: "production-derived-authority-pre-run-fixture",
  version: "0.1.0",
  sealedAt: "2026-08-01T01:00:06Z",
  suite: fixtureVersionedPointer("production-derived-authority-suite"),
  evaluator: fixtureVersionedPointer("production-derived-authority-evaluator"),
  signatureProfile: fixtureVersionedPointer("fixture-independent-scheduler-profile"),
  claimTrustProfile: fixtureVersionedPointer("production-derived-fixture-claim-trust-profile"),
  claimTrustUse: "conformance_fixture_requires_external_rekey",
  assuranceLevel: "A0",
  runMode: "diagnostic_run",
  claimEligibility: "none",
  riskAssessment: {
    id: riskAssessment.id,
    version: riskAssessment.version,
    uri: "risk-assessment.json",
    digest: riskAssessment.digest
  },
  effectiveRiskTier: riskAssessment.effectiveRiskTier,
  caseProfiles: [{
    caseId,
    bindingUse: "diagnostic_only",
    evaluationProfile: fixtureComponent("repo-change-v1"),
    effectiveProfileDigest: sha256(Buffer.from("repo-change-v1-effective-fixture", "utf8")),
    outcomeProfile: fixtureComponent("workspace-change-v1")
  }],
  caseSet: [fixtureVersionedPointer(caseId)],
  arms: [{
    id: armId,
    label: "Production-derived authority fixture arm",
    treatmentRole: "single",
    model: fixtureComponent("fixture-model"),
    agentConfiguration: fixtureComponent("fixture-agent-configuration"),
    prompts: fixtureComponent("fixture-prompts"),
    policies: fixtureComponent("fixture-policies"),
    harness: fixtureComponent("fixture-harness"),
    adapter: fixtureComponent("fixture-adapter"),
    tools: fixtureComponent("fixture-tools"),
    permissions: fixtureComponent("fixture-permissions"),
    budgets: fixtureComponent("fixture-budgets"),
    retrieval: fixtureComponent("fixture-retrieval"),
    memory: fixtureComponent("fixture-memory"),
    agentVisibleProjection: fixtureComponent("fixture-agent-visible-projection"),
    environment: { id: environment.id, version: environment.version, digest: environment.digest },
    externalServices: fixtureComponent("fixture-external-services"),
    graderSet: fixtureComponent("fixture-grader-set"),
    identityDigest: sha256(Buffer.from("production-derived-fixture-arm-identity", "utf8"))
  }],
  comparativeDesign: null,
  scheduledCells: [{
    cellId: "production-derived-fixture-cell",
    caseId,
    armId,
    repetition: 1,
    blockId: "production-derived-fixture-block-1",
    seed: "production-derived-fixture-seed-1"
  }],
  budgets: fixturePointer("production-derived-fixture-run-budgets"),
  retryPolicy: fixturePointer("production-derived-fixture-retry-policy"),
  stopPolicy: fixturePointer("production-derived-fixture-stop-policy"),
  gateRegistry: fixturePointer("production-derived-fixture-gate-registry"),
  governanceRegistry: fixturePointer("production-derived-fixture-governance-registry"),
  statisticalPlan: fixturePointer("production-derived-fixture-statistical-plan"),
  decisionPlan: null,
  extensions: []
};
await rebuildEvaluationControlChain(preRun);
sealDocument(
  preRun,
  "scheduler",
  "fixture-independent-scheduler-profile",
  "rfc8032-test-key-2-scheduler",
  "2026-08-01T01:00:06Z"
);
await writeJson(path.join(OUTPUT_ROOT, "pre-run.json"), preRun);

const bundle = {
  schemaVersion: "fixture-production-derived-evidence-bundle-1",
  version: "0.1.0",
  authorityContract: {
    ...environment.productionDerivedInput.authorityContract,
    payloadPath: "authority-contract.json"
  },
  snapshot: {
    ...environment.productionDerivedInput.inputSnapshot,
    payloadPath: "payloads/input-snapshot.json"
  },
  evidenceArtifacts: evidenceEntries
};
await writeJson(path.join(OUTPUT_ROOT, "evidence-bundle.json"), bundle);

const vectors = {
  schemaVersion: "fixture-production-derived-authority-vectors-1",
  version: "0.1.0",
  environmentPath: "environment.json",
  relatedPath: "pre-run.json",
  evidencePath: "evidence-bundle.json",
  cases: [
    { id: "authenticated-independent-authorities", mutation: "none", valid: true },
    { id: "reject-unregistered-verifier", mutation: "unregistered_verifier", valid: false, expectedError: "absent from the evaluator-controlled registry" },
    { id: "reject-self-named-producer", mutation: "self_named_producer", valid: false, expectedError: "producer or phase is not authorized" },
    { id: "reject-reused-authority-boundaries", mutation: "reused_authority_boundaries", valid: false, expectedError: "producer IDs must be distinct" },
    { id: "reject-provenance-cutoff-mismatch", mutation: "provenance_cutoff_mismatch", valid: false, expectedError: "sourceCutoff must equal the sealed value" },
    { id: "reject-provenance-transformation-mismatch", mutation: "provenance_transformation_mismatch", valid: false, expectedError: "transformationDigest must equal the sealed value" },
    { id: "reject-authorization-owner-mismatch", mutation: "authorization_owner_mismatch", valid: false, expectedError: "ownerId must equal the sealed value" },
    { id: "reject-redaction-secret-finding", mutation: "redaction_secret_finding", valid: false, expectedError: "secretsFound must be zero" },
    { id: "reject-excess-reidentification-risk", mutation: "excess_reidentification_risk", valid: false, expectedError: "sealed maximumResidualRisk" },
    { id: "reject-production-read-path", mutation: "production_read_path", valid: false, expectedError: "productionReadPathAvailable must equal the sealed value" },
    { id: "reject-wrong-authority-key", mutation: "wrong_authority_key", valid: false, expectedError: "attestation identity is not authorized" },
    { id: "reject-authority-contract-byte-substitution", mutation: "authority_contract_tamper", valid: false, expectedError: "authority-contract pointer must bind" },
    { id: "reject-unsealed-environment", mutation: "unsealed_environment", valid: false, expectedError: "does not seal this environment contract" }
  ]
};
await writeJson(path.join(OUTPUT_ROOT, "vectors.json"), vectors);
process.stdout.write(`${path.relative(process.cwd(), OUTPUT_ROOT)}\n`);
