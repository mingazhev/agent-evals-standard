#!/usr/bin/env node

import { createHash, createPrivateKey, sign } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalize,
  outcomeReplayEvidenceProjection,
  outcomeReplayTrialProjection,
  sha256Canonical
} from "./outcome-replay-executor.mjs";

const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(toolDirectory, "..");
const scorecardPath = path.join(root, "conformance", "fixtures", "positive", "scorecard.json");
const suiteManifestPath = path.join(root, "conformance", "fixtures", "positive", "suite-manifest.json");
const caseDocumentPath = path.join(root, "conformance", "fixtures", "positive", "scorecard-case.json");
const receiptPath = path.join(root, "conformance", "fixtures", "positive", "outcome-replay-receipt.json");
const implementationOnlyReceiptPath = path.join(
  root, "conformance", "fixtures", "positive", "outcome-replay-receipt-implementation-only.json");
const assuranceReportPath = path.join(root, "conformance", "fixtures", "positive", "repo-change-assurance-report.json");
const graderAssessmentPath = path.join(root, "conformance", "fixtures", "positive", "repo-change-grader-assessment.json");
const adjudicationRecordPath = path.join(
  root, "conformance", "fixtures", "positive", "repo-change-adjudication-record.json");
const measurementValidityRecordPath = path.join(
  root, "conformance", "fixtures", "positive", "repo-change-measurement-validity-record.json");
const measurementValidityEvidencePath = path.join(
  root, "conformance", "fixtures", "positive", "repo-change-measurement-validity-evidence.json");
const unauthorizedMeasurementEvidencePath = path.join(
  root, "conformance", "fixtures", "negative", "repo-change-measurement-validity-evidence-unauthorized-schema.json");
const runnerCheckPath = path.join(root, "conformance", "fixtures", "positive", "repo-change-runner-check-record.json");
const executorPath = path.join(root, "tools", "outcome-replay-executor.mjs");
const executorRegistryPath = path.join(root, "standard", "outcome-replay-executor-registry.json");
const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const claimantSeed = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
const independentVerifierSeed = "4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb";
const runnerSeed = "c5aa8df43f9f837bedb7442f31dcb7b166d38535076f094b85ce3a2e0b4458f7";

function privateKey(seed) {
  return createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, Buffer.from(seed, "hex")]),
    format: "der",
    type: "pkcs8"
  });
}

function sha256Bytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function signEvidence(artifact, seed) {
  const projection = structuredClone(artifact);
  delete projection.attestation.value;
  const message = Buffer.concat([
    Buffer.from("agent-evals-evidence-artifact-1", "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalize(projection), "utf8")
  ]);
  artifact.attestation.value = sign(null, message, privateKey(seed)).toString("base64url");
}

function signScorecard(scorecard) {
  const digestProjection = structuredClone(scorecard);
  delete digestProjection.digest;
  delete digestProjection.signature;
  scorecard.digest = sha256Canonical(digestProjection);
  const signingProjection = structuredClone(scorecard);
  delete signingProjection.signature.value;
  const message = Buffer.concat([
    Buffer.from(scorecard.schemaVersion, "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalize(signingProjection), "utf8")
  ]);
  scorecard.signature.value = sign(null, message, privateKey(claimantSeed)).toString("base64url");
}

function signScorecardEvidence(scorecardDocument) {
  for (const artifact of scorecardDocument.evidenceManifest ?? []) {
    signEvidence(
      artifact,
      ["execution-evidence", "assurance-report-evidence"].includes(artifact.id)
        ? runnerSeed
        : ["outcome-replay-receipt", "grader-assessment-evidence", "adjudication-evidence"].includes(artifact.id)
          ? independentVerifierSeed
          : claimantSeed
    );
  }
  signScorecard(scorecardDocument);
}

const scorecard = JSON.parse(await readFile(scorecardPath, "utf8"));
const suiteManifest = JSON.parse(await readFile(suiteManifestPath, "utf8"));
const caseDocument = JSON.parse(await readFile(caseDocumentPath, "utf8"));
const workspaceManifestPath = path.resolve(
  path.dirname(caseDocumentPath), caseDocument.repository.workspaceManifest.uri);
const workspaceManifestBytes = await readFile(workspaceManifestPath);
const workspaceManifest = JSON.parse(workspaceManifestBytes.toString("utf8"));
if (sha256Bytes(workspaceManifestBytes) !== caseDocument.repository.workspaceManifest.digest) {
  throw new Error("case workspace manifest pointer digest is stale");
}
const executorDigest = sha256Bytes(await readFile(executorPath));
const executor = {
  id: "agent-evals-standard.repo-change-outcome-replay",
  version: "0.1.0",
  digest: executorDigest
};
const executorRegistry = JSON.parse(await readFile(executorRegistryPath, "utf8"));
const registeredExecutors = executorRegistry.executors.filter((entry) =>
  entry.outcomeProfileId === "workspace-change-v1"
    && entry.executor?.id === executor.id
    && entry.executor?.version === executor.version);
if (registeredExecutors.length !== 1) {
  throw new Error(`expected exactly one registered ${executor.id}@${executor.version} executor`);
}
registeredExecutors[0].executor.digest = executorDigest;
for (const field of ["outcomeProfile", "semanticContract", "classificationApplicabilityRule"]) {
  const pointerPath = path.resolve(path.dirname(executorRegistryPath), registeredExecutors[0][field].uri);
  registeredExecutors[0][field].digest = sha256Bytes(await readFile(pointerPath));
}
await writeFile(executorRegistryPath, `${JSON.stringify(executorRegistry, null, 2)}\n`, "utf8");
const cell = scorecard.caseResults[0].cells[0];
const trial = cell.trialResult;
const expectedCase = suiteManifest.cases.find((entry) => entry.id === scorecard.caseResults[0].case.id);
if (!expectedCase) throw new Error(`fixture case ${scorecard.caseResults[0].case.id} is absent from suite manifest`);
const expectedCell = {
  experimentId: scorecard.experiment.id,
  cellId: cell.cellId,
  armId: cell.armId,
  blockId: cell.blockId,
  seed: cell.seed,
  evaluationProfileDigest: cell.evaluationProfileDigest,
  outcomeProfile: cell.outcomeProfile
};
const materialArtifacts = [
  { workArtifactType: "code_change", evidenceIds: ["workspace-diff-evidence"] },
  { workArtifactType: "test_change", evidenceIds: ["workspace-diff-evidence"] },
  { workArtifactType: "assurance_report", evidenceIds: ["assurance-report-evidence"] }
];
trial.outcomeReplay = {
  executor,
  receiptEvidenceId: "outcome-replay-receipt",
  materialArtifacts
};
trial.artifactIds = [...new Set([
  ...trial.artifactIds.filter((id) => ![
    "claim-evidence",
    "assurance-report-evidence",
    "grader-assessment-evidence",
    "adjudication-evidence"
  ].includes(id)),
  "assurance-report-evidence",
  "grader-assessment-evidence",
  "adjudication-evidence",
  "outcome-replay-receipt"
])];
trial.evidenceModeVerdicts[0].evidenceIds = ["execution-evidence", "workspace-diff-evidence"];
trial.evidenceModeVerdicts[0].evidenceKindBindings = [
  { kindId: "runner-check", evidenceIds: ["execution-evidence"] },
  { kindId: "artifact-digest", evidenceIds: ["workspace-diff-evidence"] }
];
trial.evidenceModeVerdicts = [
  trial.evidenceModeVerdicts[0],
  {
    modeId: "hybrid",
    status: "pass",
    evidenceIds: ["execution-evidence", "adjudication-evidence", "workspace-diff-evidence"],
    evidenceKindBindings: [
      { kindId: "runner-check", evidenceIds: ["execution-evidence"] },
      { kindId: "adjudication-record", evidenceIds: ["adjudication-evidence"] },
      { kindId: "artifact-digest", evidenceIds: ["workspace-diff-evidence"] }
    ]
  }
];
trial.decisionSurfaces[0].evidenceIds = ["workspace-diff-evidence", "outcome-replay-receipt"];
scorecard.claimResults[0].successAssignments[0].evidenceIds = ["outcome-replay-receipt"];
scorecard.evidenceManifest = scorecard.evidenceManifest.filter((entry) => ![
  "claim-evidence",
  "outcome-replay-receipt",
  "assurance-report-evidence",
  "grader-assessment-evidence",
  "adjudication-evidence"
].includes(entry.id));

const diff = Buffer.from([
  "diff --git a/src/greeting.js b/src/greeting.js",
  "new file mode 100644",
  "index 0000000..1111111",
  "--- /dev/null",
  "+++ b/src/greeting.js",
  "@@ -0,0 +1 @@",
  "+export const greeting = \"hello\";",
  "diff --git a/test/greeting.test.js b/test/greeting.test.js",
  "new file mode 100644",
  "index 0000000..2222222",
  "--- /dev/null",
  "+++ b/test/greeting.test.js",
  "@@ -0,0 +1,2 @@",
  "+import { greeting } from \"../src/greeting.js\";",
  "+test(\"greeting\", () => { if (greeting !== \"hello\") throw new Error(\"unexpected greeting\"); });",
  ""
].join("\n"), "utf8");
const workspaceDiff = scorecard.evidenceManifest.find((entry) => entry.id === "workspace-diff-evidence");
workspaceDiff.digest = sha256Bytes(diff);
workspaceDiff.uri = `artifact:${workspaceDiff.digest}`;
workspaceDiff.byteLength = diff.length;
workspaceDiff.payload = { kind: "inline_base64", contentBase64: diff.toString("base64") };

const registeredChecks = [
  ...(caseDocument.validation?.publicChecks ?? []),
  ...(caseDocument.validation?.hiddenChecks ?? []),
  ...(caseDocument.validation?.securityChecks ?? []),
  ...(caseDocument.validation?.controlProofs ?? [])
];
const runnerCheck = {
  schemaVersion: "agent-eval-repo-change-runner-check-record-1",
  id: "repo-change-runner-check-fixture-1",
  version: "0.1.0",
  experimentId: scorecard.experiment.id,
  caseId: scorecard.caseResults[0].case.id,
  cellId: cell.cellId,
  attemptId: trial.attemptId,
  armId: cell.armId,
  workspaceManifestDigest: sha256Bytes(workspaceManifestBytes),
  workspaceRootDigest: workspaceManifest.workspaceRootDigest,
  validationPlanDigest: sha256Canonical(caseDocument.validation),
  subjectKind: "workspace_diff",
  subjectDigest: workspaceDiff.digest,
  checks: registeredChecks.map((entry) => ({
    id: entry.id,
    contractDigest: entry.contract.digest,
    status: "pass"
  })),
  overallVerdict: "pass"
};
const runnerCheckBytes = Buffer.from(`${JSON.stringify(runnerCheck, null, 2)}\n`, "utf8");
await writeFile(runnerCheckPath, runnerCheckBytes);
const runnerCheckDigest = sha256Bytes(runnerCheckBytes);
const runnerCheckArtifact = scorecard.evidenceManifest.find((entry) => entry.id === "execution-evidence");
runnerCheckArtifact.artifactType = "repo-change-v1:runner_check_record";
runnerCheckArtifact.uri = `artifact:${runnerCheckDigest}`;
runnerCheckArtifact.digest = runnerCheckDigest;
runnerCheckArtifact.byteLength = runnerCheckBytes.length;
runnerCheckArtifact.producer = { id: "fixture-runner", role: "runner", trustDomain: "runner" };
runnerCheckArtifact.creationPhase = "execution";
runnerCheckArtifact.schemaMetadata = {
  schemaId: "agent-eval-repo-change-runner-check-record-1",
  schemaVersion: "0.1.0",
  validatorDigest: executorDigest
};
runnerCheckArtifact.mediaInterpretation = {
  profileId: "json-rfc8785",
  profileVersion: "0.1.0",
  semanticContract: executor
};
runnerCheckArtifact.attestation = {
  profileId: "fixture-runner-capture-profile",
  algorithm: "Ed25519",
  keyId: "rfc8032-test-key-3-runner",
  signedAt: "2026-08-01T01:00:08Z",
  value: "pending"
};
runnerCheckArtifact.payload = {
  kind: "inline_base64",
  contentBase64: runnerCheckBytes.toString("base64")
};

const replayFacts = {
  measurementValidity: "valid",
  requiredOutcomeConditionsVerdict: "pass",
  deterministicChecksVerdict: "pass",
  evidenceAuthenticityVerdict: "pass",
  adjudicationProtocolVerdict: "pass",
  adjudicatorIndependenceVerdict: "pass",
  adjudicationVerdict: "pass"
};

const expectedGraderSet = scorecard.arms.find((entry) => entry.id === cell.armId)?.graderSet;
if (!expectedGraderSet) throw new Error(`fixture arm ${cell.armId} has no sealed graderSet`);
const adjudicationRecord = {
  schemaVersion: "agent-eval-repo-change-adjudication-record-1",
  id: "repo-change-adjudication-fixture-1",
  version: "0.1.0",
  experimentId: scorecard.experiment.id,
  caseId: scorecard.caseResults[0].case.id,
  cellId: cell.cellId,
  attemptId: trial.attemptId,
  armId: cell.armId,
  workspaceManifestDigest: sha256Bytes(workspaceManifestBytes),
  workspaceRootDigest: workspaceManifest.workspaceRootDigest,
  subjectKind: "workspace_diff",
  subjectDigest: workspaceDiff.digest,
  factProjectionDigest: sha256Canonical(replayFacts),
  protocol: structuredClone(expectedGraderSet),
  presentation: {
    treatmentBlinding: "blinded",
    identityHandling: "blinded",
    orderEffectApplicability: "applicable",
    presentationOrder: "counterbalanced",
    orderRationale: "Candidate order was reversed across the two independent ratings."
  },
  raters: [
    {
      raterId: "fixture-rater-alpha",
      raterIdentityDigest: `sha256:${"a".repeat(64)}`,
      trustDomain: "fixture-rater-domain-alpha",
      qualificationRuleDigest: `sha256:${"b".repeat(64)}`,
      qualificationEvidenceDigest: `sha256:${"c".repeat(64)}`,
      qualificationVerdict: "pass",
      conflictCheckEvidenceDigest: `sha256:${"d".repeat(64)}`,
      conflictOfInterestVerdict: "pass",
      ratingEvidenceDigest: `sha256:${"e".repeat(64)}`,
      blinded: true,
      verdict: "pass",
      reason: "The repository change satisfies the sealed construct rubric."
    },
    {
      raterId: "fixture-rater-beta",
      raterIdentityDigest: `sha256:${"f".repeat(64)}`,
      trustDomain: "fixture-rater-domain-beta",
      qualificationRuleDigest: `sha256:${"b".repeat(64)}`,
      qualificationEvidenceDigest: `sha256:${"1".repeat(64)}`,
      qualificationVerdict: "pass",
      conflictCheckEvidenceDigest: `sha256:${"2".repeat(64)}`,
      conflictOfInterestVerdict: "pass",
      ratingEvidenceDigest: `sha256:${"3".repeat(64)}`,
      blinded: true,
      verdict: "pass",
      reason: "The observed diff and checks meet every decision-bearing rubric item."
    }
  ],
  agreement: {
    method: "percent_agreement_with_wilson_interval",
    sampleSize: 2,
    estimate: 1,
    confidenceLevel: 0.95,
    lower: 0.34237195288961925,
    upper: 1
  },
  overallVerdict: "pass"
};
const adjudicationRecordBytes = Buffer.from(
  `${JSON.stringify(adjudicationRecord, null, 2)}\n`, "utf8");
await writeFile(adjudicationRecordPath, adjudicationRecordBytes);
const adjudicationRecordDigest = sha256Bytes(adjudicationRecordBytes);
const assuranceReport = {
  schemaVersion: "agent-eval-repo-change-assurance-report-1",
  id: "repo-change-assurance-report-fixture-1",
  version: "0.1.0",
  experimentId: scorecard.experiment.id,
  caseId: scorecard.caseResults[0].case.id,
  cellId: cell.cellId,
  attemptId: trial.attemptId,
  armId: cell.armId,
  workspaceDiffDigest: workspaceDiff.digest,
  reportVerdict: "pass",
  summary: "The delivered code and test changes satisfy the requested greeting behavior and the reported deterministic check.",
  checks: [
    { id: "implementation-behavior", status: "pass", evidenceRefs: ["src/greeting.js"] },
    { id: "regression-test", status: "pass", evidenceRefs: ["test/greeting.test.js"] }
  ]
};
const assuranceReportBytes = Buffer.from(`${JSON.stringify(assuranceReport, null, 2)}\n`, "utf8");
await writeFile(assuranceReportPath, assuranceReportBytes);
const assuranceReportDigest = sha256Bytes(assuranceReportBytes);

const graderAssessment = {
  schemaVersion: "agent-eval-repo-change-grader-assessment-1",
  id: "repo-change-grader-assessment-fixture-1",
  version: "0.1.0",
  experimentId: scorecard.experiment.id,
  caseId: scorecard.caseResults[0].case.id,
  cellId: cell.cellId,
  attemptId: trial.attemptId,
  armId: cell.armId,
  workspaceDiffDigest: workspaceDiff.digest,
  evaluatedAssuranceReportDigest: assuranceReportDigest,
  checks: [
    { id: "required-outcome-conditions", status: "pass" },
    { id: "deterministic-checks", status: "pass" },
    { id: "evidence-authenticity", status: "pass" }
  ],
  facts: replayFacts
};
const graderAssessmentBytes = Buffer.from(`${JSON.stringify(graderAssessment, null, 2)}\n`, "utf8");
await writeFile(graderAssessmentPath, graderAssessmentBytes);
const graderAssessmentDigest = sha256Bytes(graderAssessmentBytes);

const evidenceProjectionMap = new Map(scorecard.evidenceManifest.map((entry) => [entry.id, entry]));
evidenceProjectionMap.set("assurance-report-evidence", {
  id: "assurance-report-evidence",
  artifactType: "repo-change-v1:assurance_report",
  uri: `artifact:${assuranceReportDigest}`,
  digest: assuranceReportDigest,
  byteLength: assuranceReportBytes.length,
  mediaType: "application/json"
});
evidenceProjectionMap.set("grader-assessment-evidence", {
  id: "grader-assessment-evidence",
  artifactType: "repo-change-v1:grader_assessment",
  uri: `artifact:${graderAssessmentDigest}`,
  digest: graderAssessmentDigest,
  byteLength: graderAssessmentBytes.length,
  mediaType: "application/json"
});
evidenceProjectionMap.set("adjudication-evidence", {
  id: "adjudication-evidence",
  artifactType: "repo-change-v1:adjudication_record",
  uri: `artifact:${adjudicationRecordDigest}`,
  digest: adjudicationRecordDigest,
  byteLength: adjudicationRecordBytes.length,
  mediaType: "application/json"
});

const receipt = {
  schemaVersion: "agent-eval-outcome-replay-receipt-1",
  receiptId: "outcome-replay-receipt-fixture-1",
  version: "0.1.0",
  trustUse: "conformance_fixture_only",
  executor,
  experimentId: scorecard.experiment.id,
  caseId: scorecard.caseResults[0].case.id,
  cellId: cell.cellId,
  attemptId: trial.attemptId,
  armId: cell.armId,
  outcomeProfile: cell.outcomeProfile,
  caseCommitmentDigest: sha256Canonical(expectedCase),
  cellCommitmentDigest: sha256Canonical(expectedCell),
  trialProjectionDigest: sha256Canonical(outcomeReplayTrialProjection(trial)),
  materialArtifactsDigest: sha256Canonical(materialArtifacts),
  consumedEvidenceDigest: sha256Canonical(outcomeReplayEvidenceProjection(trial, evidenceProjectionMap)),
  evaluatedAssuranceReport: {
    evidenceId: "assurance-report-evidence",
    digest: assuranceReportDigest
  },
  graderAssessment: {
    evidenceId: "grader-assessment-evidence",
    digest: graderAssessmentDigest
  },
  facts: replayFacts
};
const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
await writeFile(receiptPath, receiptBytes);
const receiptDigest = sha256Bytes(receiptBytes);

const implementationOnlyMaterialArtifacts = materialArtifacts.filter(
  (entry) => entry.workArtifactType !== "assurance_report");
const implementationOnlyTrial = structuredClone(trial);
implementationOnlyTrial.outcomeReplay = {
  executor,
  receiptEvidenceId: "outcome-replay-receipt-implementation-only",
  materialArtifacts: implementationOnlyMaterialArtifacts
};
implementationOnlyTrial.artifactIds = [...new Set([
  ...implementationOnlyTrial.artifactIds.filter((id) => ![
    "assurance-report-evidence",
    "grader-assessment-evidence",
    "outcome-replay-receipt"
  ].includes(id)),
  "outcome-replay-receipt-implementation-only"
])];
for (const verdict of implementationOnlyTrial.evidenceModeVerdicts) {
  verdict.evidenceIds = verdict.evidenceIds.map((id) =>
    id === "outcome-replay-receipt" ? "outcome-replay-receipt-implementation-only" : id);
}
for (const surface of implementationOnlyTrial.decisionSurfaces) {
  surface.evidenceIds = surface.evidenceIds.map((id) =>
    id === "outcome-replay-receipt" ? "outcome-replay-receipt-implementation-only" : id);
}
const implementationOnlyReceipt = {
  schemaVersion: "agent-eval-outcome-replay-receipt-1",
  receiptId: "outcome-replay-receipt-implementation-only-fixture-1",
  version: "0.1.0",
  trustUse: "conformance_fixture_only",
  executor,
  experimentId: scorecard.experiment.id,
  caseId: scorecard.caseResults[0].case.id,
  cellId: cell.cellId,
  attemptId: implementationOnlyTrial.attemptId,
  armId: cell.armId,
  outcomeProfile: cell.outcomeProfile,
  caseCommitmentDigest: sha256Canonical({
    ...expectedCase,
    capabilityFamilyIds: (expectedCase.capabilityFamilyIds ?? []).filter((id) => id !== "CAP.VERIFY_ASSURE"),
    workArtifactTypes: (expectedCase.workArtifactTypes ?? []).filter((type) => type !== "assurance_report")
  }),
  cellCommitmentDigest: sha256Canonical(expectedCell),
  trialProjectionDigest: sha256Canonical(outcomeReplayTrialProjection(implementationOnlyTrial)),
  materialArtifactsDigest: sha256Canonical(implementationOnlyMaterialArtifacts),
  consumedEvidenceDigest: sha256Canonical(
    outcomeReplayEvidenceProjection(implementationOnlyTrial, evidenceProjectionMap)),
  facts: replayFacts
};
const implementationOnlyReceiptBytes = Buffer.from(
  `${JSON.stringify(implementationOnlyReceipt, null, 2)}\n`, "utf8");
await writeFile(implementationOnlyReceiptPath, implementationOnlyReceiptBytes);
const template = scorecard.evidenceManifest.find((entry) => entry.id === "execution-evidence");
const assuranceReportArtifact = {
  ...structuredClone(template),
  id: "assurance-report-evidence",
  artifactType: "repo-change-v1:assurance_report",
  uri: `artifact:${assuranceReportDigest}`,
  mediaType: "application/json",
  digest: assuranceReportDigest,
  byteLength: assuranceReportBytes.length,
  producer: {
    id: "fixture-runner",
    role: "runner",
    trustDomain: "runner"
  },
  creationPhase: "execution",
  createdAt: "2026-08-01T01:00:09Z",
  schemaMetadata: {
    schemaId: "agent-eval-repo-change-assurance-report-1",
    schemaVersion: "0.1.0",
    validatorDigest: executorDigest
  },
  mediaInterpretation: {
    profileId: "json-rfc8785",
    profileVersion: "0.1.0",
    semanticContract: {
      id: executor.id,
      version: executor.version,
      digest: executor.digest
    }
  },
  attestation: {
    profileId: "fixture-runner-capture-profile",
    algorithm: "Ed25519",
    keyId: "rfc8032-test-key-3-runner",
    signedAt: "2026-08-01T01:00:10Z",
    value: "pending"
  },
  payload: { kind: "repository_relative", path: "repo-change-assurance-report.json" }
};
const graderAssessmentArtifact = {
  ...structuredClone(template),
  id: "grader-assessment-evidence",
  artifactType: "repo-change-v1:grader_assessment",
  uri: `artifact:${graderAssessmentDigest}`,
  mediaType: "application/json",
  digest: graderAssessmentDigest,
  byteLength: graderAssessmentBytes.length,
  producer: {
    id: "fixture-independent-outcome-verifier",
    role: "verifier",
    trustDomain: "external"
  },
  creationPhase: "grading",
  createdAt: "2026-08-01T01:00:17Z",
  schemaMetadata: {
    schemaId: "agent-eval-repo-change-grader-assessment-1",
    schemaVersion: "0.1.0",
    validatorDigest: executorDigest
  },
  mediaInterpretation: {
    profileId: "json-rfc8785",
    profileVersion: "0.1.0",
    semanticContract: {
      id: executor.id,
      version: executor.version,
      digest: executor.digest
    }
  },
  attestation: {
    profileId: "fixture-automated-verifier-profile",
    algorithm: "Ed25519",
    keyId: "rfc8032-test-key-2-verifier",
    signedAt: "2026-08-01T01:00:18Z",
    value: "pending"
  },
  payload: { kind: "repository_relative", path: "repo-change-grader-assessment.json" }
};
const receiptArtifact = {
  ...structuredClone(template),
  id: "outcome-replay-receipt",
  artifactType: "repo-change-v1:outcome_replay_receipt",
  uri: `artifact:${receiptDigest}`,
  mediaType: "application/json",
  digest: receiptDigest,
  byteLength: receiptBytes.length,
  producer: {
    id: "fixture-independent-outcome-verifier",
    role: "verifier",
    trustDomain: "external"
  },
  creationPhase: "grading",
  createdAt: "2026-08-01T01:00:18Z",
  schemaMetadata: {
    schemaId: "agent-eval-outcome-replay-receipt-1",
    schemaVersion: "0.1.0",
    validatorDigest: executorDigest
  },
  mediaInterpretation: {
    profileId: "json-rfc8785",
    profileVersion: "0.1.0",
    semanticContract: {
      id: executor.id,
      version: executor.version,
      digest: executor.digest
    }
  },
  attestation: {
    profileId: "fixture-automated-verifier-profile",
    algorithm: "Ed25519",
    keyId: "rfc8032-test-key-2-verifier",
    signedAt: "2026-08-01T01:00:19Z",
    value: "pending"
  },
  payload: { kind: "repository_relative", path: "outcome-replay-receipt.json" }
};
const adjudicationArtifact = {
  ...structuredClone(template),
  id: "adjudication-evidence",
  artifactType: "repo-change-v1:adjudication_record",
  uri: `artifact:${adjudicationRecordDigest}`,
  mediaType: "application/json",
  digest: adjudicationRecordDigest,
  byteLength: adjudicationRecordBytes.length,
  producer: {
    id: "fixture-independent-outcome-verifier",
    role: "verifier",
    trustDomain: "external"
  },
  creationPhase: "grading",
  createdAt: "2026-08-01T01:00:17Z",
  schemaMetadata: {
    schemaId: "agent-eval-repo-change-adjudication-record-1",
    schemaVersion: "0.1.0",
    validatorDigest: executorDigest
  },
  mediaInterpretation: {
    profileId: "json-rfc8785",
    profileVersion: "0.1.0",
    semanticContract: {
      id: executor.id,
      version: executor.version,
      digest: executor.digest
    }
  },
  attestation: {
    profileId: "fixture-automated-verifier-profile",
    algorithm: "Ed25519",
    keyId: "rfc8032-test-key-2-verifier",
    signedAt: "2026-08-01T01:00:18Z",
    value: "pending"
  },
  payload: { kind: "repository_relative", path: "repo-change-adjudication-record.json" }
};
const measurementValidityRecordBytes = await readFile(measurementValidityRecordPath);
const measurementValidityRecordDigest = sha256Bytes(measurementValidityRecordBytes);
const measurementValidityEvidence = {
  ...structuredClone(template),
  id: "measurement-validity-evidence",
  artifactType: "repo-change-v1:measurement_validity_record",
  uri: `artifact:${measurementValidityRecordDigest}`,
  mediaType: "application/json",
  digest: measurementValidityRecordDigest,
  byteLength: measurementValidityRecordBytes.length,
  producer: {
    id: "fixture-independent-outcome-verifier",
    role: "verifier",
    trustDomain: "external"
  },
  creationPhase: "grading",
  createdAt: "2026-08-01T01:00:18Z",
  schemaMetadata: {
    schemaId: "agent-eval-repo-change-measurement-validity-record-1",
    schemaVersion: "0.1.0",
    validatorDigest: executorDigest
  },
  mediaInterpretation: {
    profileId: "json-rfc8785",
    profileVersion: "0.1.0",
    semanticContract: {
      id: executor.id,
      version: executor.version,
      digest: executor.digest
    }
  },
  attestation: {
    profileId: "fixture-automated-verifier-profile",
    algorithm: "Ed25519",
    keyId: "rfc8032-test-key-2-verifier",
    signedAt: "2026-08-01T01:00:18Z",
    value: "pending"
  },
  payload: {
    kind: "repository_relative",
    path: "repo-change-measurement-validity-record.json"
  }
};
signEvidence(measurementValidityEvidence, independentVerifierSeed);
await writeFile(
  measurementValidityEvidencePath,
  `${JSON.stringify(measurementValidityEvidence, null, 2)}\n`,
  "utf8"
);
const unauthorizedMeasurementEvidence = structuredClone(measurementValidityEvidence);
unauthorizedMeasurementEvidence.id = "measurement-validity-evidence-unauthorized-schema";
unauthorizedMeasurementEvidence.schemaMetadata.schemaId = "agent-eval-repo-change-runner-check-record-1";
unauthorizedMeasurementEvidence.payload = {
  kind: "inline_base64",
  contentBase64: measurementValidityRecordBytes.toString("base64")
};
unauthorizedMeasurementEvidence.attestation.value = "pending";
signEvidence(unauthorizedMeasurementEvidence, independentVerifierSeed);
await writeFile(
  unauthorizedMeasurementEvidencePath,
  `${JSON.stringify(unauthorizedMeasurementEvidence, null, 2)}\n`,
  "utf8"
);
scorecard.evidenceManifest.push(
  assuranceReportArtifact,
  graderAssessmentArtifact,
  adjudicationArtifact,
  receiptArtifact
);

signScorecardEvidence(scorecard);
await writeFile(scorecardPath, `${JSON.stringify(scorecard, null, 2)}\n`, "utf8");
for (const absolute of [
  executorRegistryPath,
  scorecardPath,
  receiptPath,
  implementationOnlyReceiptPath,
  assuranceReportPath,
  graderAssessmentPath,
  adjudicationRecordPath,
  measurementValidityEvidencePath,
  unauthorizedMeasurementEvidencePath,
  runnerCheckPath
]) {
  process.stdout.write(`${path.relative(root, absolute)}\n`);
}
