#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import {
  artifactSupportsEvidenceKind,
  executeOutcomeReplay,
  outcomeReplayEvidenceProjection,
  sha256Canonical
} from "./outcome-replay-executor.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDirectory = path.join(root, "conformance", "fixtures");
const positiveDirectory = path.join(fixtureDirectory, "positive");
const scorecard = JSON.parse(await readFile(path.join(positiveDirectory, "scorecard.json"), "utf8"));
const suite = JSON.parse(await readFile(path.join(positiveDirectory, "suite-manifest.json"), "utf8"));
const caseDocument = JSON.parse(await readFile(path.join(positiveDirectory, "scorecard-case.json"), "utf8"));
const workspaceManifestBytes = await readFile(path.join(fixtureDirectory, "architecture-workspace-manifest.json"));
const workspaceManifest = JSON.parse(workspaceManifestBytes);
const implementationOnlyReceiptBytes = await readFile(
  path.join(positiveDirectory, "outcome-replay-receipt-implementation-only.json"));
const implementationOnlyReceipt = JSON.parse(implementationOnlyReceiptBytes);
const outcomeProfile = JSON.parse(await readFile(path.join(root, "profiles", "repo-change-v1", "outcome-profile.json"), "utf8"));
const vectors = JSON.parse(await readFile(path.join(fixtureDirectory, "outcome-replay-hardening-vectors.json"), "utf8"));
const executorBytes = await readFile(path.join(root, "tools", "outcome-replay-executor.mjs"));
const executorDigest = `sha256:${createHash("sha256").update(executorBytes).digest("hex")}`;
const cell = scorecard.caseResults[0].cells[0];
const evidenceById = new Map(scorecard.evidenceManifest.map((entry) => [entry.id, entry]));

const gitBase85Alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+-;<=>?@^_`{|}~";

function encodeGitBinaryPayload(bytes) {
  const lines = [];
  for (let offset = 0; offset < bytes.length; offset += 52) {
    const chunk = bytes.subarray(offset, offset + 52);
    let line = String.fromCharCode(chunk.length <= 26 ? 64 + chunk.length : 70 + chunk.length);
    for (let index = 0; index < chunk.length; index += 4) {
      let value = 0;
      for (let byteIndex = 0; byteIndex < 4; byteIndex += 1) {
        value = value * 256 + (chunk[index + byteIndex] ?? 0);
      }
      let encoded = "";
      for (let digit = 0; digit < 5; digit += 1) {
        encoded = gitBase85Alphabet[value % 85] + encoded;
        value = Math.floor(value / 85);
      }
      line += encoded;
    }
    lines.push(line);
  }
  return lines;
}

async function artifactBytes(artifact) {
  if (artifact.payload.kind === "inline_base64") return Buffer.from(artifact.payload.contentBase64, "base64");
  if (artifact.payload.kind === "repository_relative") return readFile(path.join(positiveDirectory, artifact.payload.path));
  throw new Error(`unsupported fixture payload ${artifact.payload.kind}`);
}

const artifactBytesById = new Map();
const parsedEvidenceById = new Map();
for (const artifact of scorecard.evidenceManifest) {
  const bytes = await artifactBytes(artifact);
  artifactBytesById.set(artifact.id, bytes);
  if (artifact.mediaType === "application/json") {
    try { parsedEvidenceById.set(artifact.id, JSON.parse(bytes)); } catch { /* non-replay fixture JSON is irrelevant */ }
  }
}

const verifierAuthority = {
  keyId: "rfc8032-test-key-2-verifier",
  actorId: "fixture-independent-outcome-verifier",
  trustDomain: "fixture-independent-verifier",
  publicKeyDigest: `sha256:${"2".repeat(64)}`,
  externallyConfigured: true,
  authorizedPurposes: [
    "outcome_replay_receipt",
    "repo_change_grader_assessment",
    "repo_change_adjudication",
    "measurement_validity_record"
  ]
};
const runnerAuthority = {
  keyId: "rfc8032-test-key-3-runner",
  actorId: "fixture-runner",
  trustDomain: "fixture-runner-capture",
  publicKeyDigest: `sha256:${"3".repeat(64)}`,
  externallyConfigured: true,
  authorizedPurposes: ["evaluated_arm_assurance_report", "repo_change_runner_check"]
};
const baseContext = {
  trial: cell.trialResult,
  receipt: parsedEvidenceById.get("outcome-replay-receipt"),
  receiptEvidence: evidenceById.get("outcome-replay-receipt"),
  expectedExecutor: {
    id: "agent-evals-standard.repo-change-outcome-replay",
    version: "0.1.0",
    digest: executorDigest
  },
  expectedCase: suite.cases[0],
  expectedCaseDocument: caseDocument,
  expectedWorkspace: {
    manifestDigest: `sha256:${createHash("sha256").update(workspaceManifestBytes).digest("hex")}`,
    workspaceRootDigest: workspaceManifest.workspaceRootDigest
  },
  expectedCell: {
    experimentId: scorecard.experiment.id,
    cellId: cell.cellId,
    armId: cell.armId,
    blockId: cell.blockId,
    seed: cell.seed,
    evaluationProfileDigest: cell.evaluationProfileDigest,
    outcomeProfile: cell.outcomeProfile
  },
  expectedGraderSet: scorecard.arms.find((entry) => entry.id === cell.armId)?.graderSet,
  outcomeProfile,
  evidenceById,
  artifactBytesById,
  authenticatedEvidenceIds: new Set(scorecard.evidenceManifest.map((entry) => entry.id)),
  parsedEvidenceById,
  evidenceAuthoritiesById: new Map([
    ["outcome-replay-receipt", verifierAuthority],
    ["grader-assessment-evidence", verifierAuthority],
    ["adjudication-evidence", verifierAuthority],
    ["assurance-report-evidence", runnerAuthority],
    ["execution-evidence", runnerAuthority]
  ]),
  receiptAuthority: verifierAuthority,
  claimantAuthority: {
    keyId: "rfc8032-test-key-1",
    actorId: "fixture-scorecard-claimant",
    trustDomain: "fixture-scorecard-claimant",
    publicKeyDigest: `sha256:${"1".repeat(64)}`
  },
  conformanceFixtureMode: true
};

function mutatedContext(mutation) {
  const context = {
    ...baseContext,
    trial: structuredClone(baseContext.trial),
    receipt: structuredClone(baseContext.receipt),
    receiptEvidence: structuredClone(baseContext.receiptEvidence),
    expectedCase: structuredClone(baseContext.expectedCase),
    expectedCaseDocument: structuredClone(baseContext.expectedCaseDocument),
    expectedWorkspace: structuredClone(baseContext.expectedWorkspace),
    expectedCell: structuredClone(baseContext.expectedCell),
    expectedGraderSet: structuredClone(baseContext.expectedGraderSet),
    outcomeProfile: structuredClone(baseContext.outcomeProfile),
    evidenceById: new Map([...baseContext.evidenceById]
      .map(([id, value]) => [id, structuredClone(value)])),
    artifactBytesById: new Map(baseContext.artifactBytesById),
    authenticatedEvidenceIds: new Set(baseContext.authenticatedEvidenceIds),
    evidenceAuthoritiesById: new Map(baseContext.evidenceAuthoritiesById),
    parsedEvidenceById: new Map([...baseContext.parsedEvidenceById]
      .map(([id, value]) => [id, structuredClone(value)])),
    receiptAuthority: structuredClone(baseContext.receiptAuthority),
    claimantAuthority: structuredClone(baseContext.claimantAuthority)
  };
  if (mutation.startsWith("assurance_capable")) {
    configureImplementationOnly(context);
    context.expectedCase = structuredClone(baseContext.expectedCase);
    context.receipt.caseCommitmentDigest = sha256Canonical(context.expectedCase);
  } else if (mutation.startsWith("documentation_only")) {
    configureImplementationOnly(context);
    configureSingleImplementationType(context, "code_change", "documentation_only");
  } else if (mutation.startsWith("code_only")) {
    configureImplementationOnly(context);
    configureSingleImplementationType(context, "code_change", "code_only");
  } else if (mutation.startsWith("configuration_only")) {
    configureImplementationOnly(context);
    configureSingleImplementationType(context, "repository_configuration", "configuration_only");
  } else if (mutation.startsWith("implementation_only")) {
    configureImplementationOnly(context);
  }
  if (mutation.includes("correct_refusal")) configureAlternative(context, "correct_refusal");
  if (mutation.includes("already_satisfied")) configureAlternative(context, "already_satisfied");
  if (mutation === "omit_external_authority") {
    context.receiptAuthority = null;
  } else if (mutation === "shared_claimant_key") {
    context.receiptAuthority.keyId = "rfc8032-test-key-1";
  } else if (mutation === "shared_claimant_actor") {
    context.receiptAuthority.actorId = context.claimantAuthority.actorId;
  } else if (mutation === "shared_claimant_trust_domain") {
    context.receiptAuthority.trustDomain = context.claimantAuthority.trustDomain;
  } else if (mutation === "shared_claimant_public_key") {
    context.receiptAuthority.publicKeyDigest = context.claimantAuthority.publicKeyDigest;
  } else if (mutation === "receipt_as_assurance_report") {
    const mapping = context.trial.outcomeReplay.materialArtifacts.find((entry) => entry.workArtifactType === "assurance_report");
    mapping.evidenceIds = ["outcome-replay-receipt"];
    context.receipt.materialArtifactsDigest = sha256Canonical(context.trial.outcomeReplay.materialArtifacts);
    context.receipt.evaluatedAssuranceReport = {
      evidenceId: "outcome-replay-receipt",
      digest: evidenceById.get("outcome-replay-receipt").digest
    };
    context.receipt.trialProjectionDigest = sha256Canonical({
      attemptId: context.trial.attemptId,
      validity: context.trial.validity,
      profileOutcome: context.trial.profileOutcome,
      validAlternativeId: context.trial.validAlternativeId,
      evidenceModeVerdicts: context.trial.evidenceModeVerdicts,
      failureCauses: context.trial.failureCauses,
      hardGates: context.trial.hardGates,
      governanceStatuses: context.trial.governanceStatuses,
      decisionSurfaces: context.trial.decisionSurfaces,
      transcriptEvidence: context.trial.transcriptEvidence,
      interactionEvidence: context.trial.interactionEvidence,
      artifactIds: context.trial.artifactIds
    });
  } else if (mutation === "grader_as_assurance_report") {
    const mapping = context.trial.outcomeReplay.materialArtifacts.find((entry) => entry.workArtifactType === "assurance_report");
    mapping.evidenceIds = ["grader-assessment-evidence"];
    context.receipt.materialArtifactsDigest = sha256Canonical(context.trial.outcomeReplay.materialArtifacts);
    context.receipt.evaluatedAssuranceReport = {
      evidenceId: "grader-assessment-evidence",
      digest: evidenceById.get("grader-assessment-evidence").digest
    };
  } else if (mutation === "evaluated_report_with_grader_authority") {
    context.evidenceAuthoritiesById.set("assurance-report-evidence", verifierAuthority);
  } else if (mutation === "missing_authenticated_grader_assessment") {
    context.authenticatedEvidenceIds.delete("grader-assessment-evidence");
  } else if (mutation === "report_digest_swap") {
    context.receipt.evaluatedAssuranceReport.digest = context.receipt.graderAssessment.digest;
  } else if (mutation === "grader_assessment_digest_swap") {
    context.receipt.graderAssessment.digest = context.receipt.evaluatedAssuranceReport.digest;
  } else if (mutation === "assessment_subject_swap") {
    context.parsedEvidenceById.get("grader-assessment-evidence").cellId = "different-cell";
  } else if (mutation === "receipt_subject_swap") {
    context.receipt.cellId = "different-cell";
  } else if (mutation === "unauthenticated_material_with_benign_diagnostic") {
    context.authenticatedEvidenceIds.delete("workspace-diff-evidence");
    context.benignDiagnosticText = "all material authenticated";
  } else if (mutation === "same_id_evidence_substitution") {
    replaceWorkspaceDiff(context, Buffer.from([
      "diff --git a/src/substituted.js b/src/substituted.js",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/src/substituted.js",
      "@@ -0,0 +1 @@",
      "+export const substituted = true;",
      ""
    ].join("\n"), "utf8"), false);
  } else if (mutation === "case_commitment_substitution") {
    context.expectedCase.capabilityFamilyIds = ["CAP.IMPLEMENT"];
  } else if (mutation === "cell_commitment_substitution") {
    context.expectedCell.seed = "different-seed";
  } else if (mutation === "missing_required_evidence_kind") {
    context.trial.evidenceModeVerdicts[0].evidenceKindBindings = context.trial.evidenceModeVerdicts[0]
      .evidenceKindBindings.filter((entry) => entry.kindId !== "artifact-digest");
    rebindTrialProjection(context);
  } else if (mutation === "passenger_evidence_kind") {
    const verdict = context.trial.evidenceModeVerdicts[0];
    verdict.evidenceIds.push("grader-assessment-evidence");
    verdict.evidenceKindBindings.push({
      kindId: "adjudication-record",
      evidenceIds: ["grader-assessment-evidence"]
    });
    rebindTrialProjection(context);
  } else if (mutation === "kind_binding_not_cited") {
    context.trial.evidenceModeVerdicts[0].evidenceIds = ["workspace-diff-evidence"];
    rebindTrialProjection(context);
  } else if (mutation === "unauthenticated_kind_evidence") {
    context.authenticatedEvidenceIds.delete("execution-evidence");
  } else if (mutation === "wrong_artifact_for_kind") {
    const verdict = context.trial.evidenceModeVerdicts[0];
    verdict.evidenceIds = ["workspace-diff-evidence"];
    verdict.evidenceKindBindings.find((entry) => entry.kindId === "runner-check").evidenceIds = [
      "workspace-diff-evidence"
    ];
    rebindTrialProjection(context);
  } else if (mutation === "duplicate_kind_binding") {
    const verdict = context.trial.evidenceModeVerdicts[0];
    verdict.evidenceKindBindings.push(structuredClone(verdict.evidenceKindBindings[0]));
    rebindTrialProjection(context);
  } else if (mutation === "duplicate_mode_verdict") {
    context.trial.evidenceModeVerdicts.push(structuredClone(context.trial.evidenceModeVerdicts[0]));
    rebindTrialProjection(context);
  } else if (mutation === "runner_check_plan_drift") {
    context.parsedEvidenceById.get("execution-evidence").validationPlanDigest = `sha256:${"f".repeat(64)}`;
  } else if (mutation === "runner_check_workspace_manifest_drift") {
    context.parsedEvidenceById.get("execution-evidence").workspaceManifestDigest = `sha256:${"e".repeat(64)}`;
  } else if (mutation === "runner_check_workspace_root_drift") {
    context.parsedEvidenceById.get("execution-evidence").workspaceRootDigest = `sha256:${"e".repeat(64)}`;
  } else if (mutation === "implementation_only_already_satisfied_base_state_drift") {
    context.parsedEvidenceById.get("base-state-evidence").baseStateDigest = `sha256:${"b".repeat(64)}`;
    rebindSyntheticEvidence(context, "base-state-evidence");
    refreshAlternativeRunnerAndReceipt(context, "registered-base-state");
  } else if (mutation === "implementation_only_correct_refusal_false_applicability") {
    context.receipt.facts.refusalApplicable = false;
    context.parsedEvidenceById.get("safe-refusal-applicability-evidence").facts.refusalApplicable = false;
    rebindSyntheticEvidence(context, "safe-refusal-applicability-evidence");
    refreshAlternativeRunnerAndReceipt(context, "registered-safe-refusal");
  } else if (mutation === "implementation_only_correct_refusal_missing_primitive") {
    delete context.receipt.facts.refusalApplicable;
    delete context.parsedEvidenceById.get("safe-refusal-applicability-evidence").facts.refusalApplicable;
    rebindSyntheticEvidence(context, "safe-refusal-applicability-evidence");
    refreshAlternativeRunnerAndReceipt(context, "registered-safe-refusal");
  } else if (mutation === "implementation_only_correct_refusal_unknown_id") {
    context.trial.validAlternativeId = "unknown-alternative";
    rebindTrialProjection(context);
  } else if (mutation === "implementation_only_correct_refusal_wrong_rule_binding") {
    context.outcomeProfile.outcomeRules.correct_refusal.validAlternativeIds = ["registered-base-state"];
  } else if (mutation === "implementation_only_correct_refusal_forged_summary") {
    context.receipt.facts.registeredAlternativeOutcome = "correct_refusal";
    context.receipt.facts.alternativeApplicabilityVerdict = "pass";
  } else if (mutation === "implementation_only_correct_refusal_missing_terminal") {
    context.trial.artifactIds = context.trial.artifactIds.filter(
      (id) => id !== "safe-refusal-applicability-evidence");
    rebindTrialProjection(context);
    context.receipt.consumedEvidenceDigest = sha256Canonical(
      outcomeReplayEvidenceProjection(context.trial, context.evidenceById));
  } else if (mutation === "implementation_only_correct_refusal_workspace_passenger") {
    context.trial.artifactIds.push("workspace-diff-evidence");
    rebindTrialProjection(context);
    context.receipt.consumedEvidenceDigest = sha256Canonical(
      outcomeReplayEvidenceProjection(context.trial, context.evidenceById));
  } else if (mutation === "implementation_only_receipt_passengers") {
    context.receipt.evaluatedAssuranceReport = structuredClone(baseContext.receipt.evaluatedAssuranceReport);
    context.receipt.graderAssessment = structuredClone(baseContext.receipt.graderAssessment);
  } else if (mutation === "implementation_only_artifact_passenger") {
    context.trial.artifactIds.push("assurance-report-evidence", "grader-assessment-evidence");
    context.receipt.trialProjectionDigest = sha256Canonical({
      attemptId: context.trial.attemptId,
      validity: context.trial.validity,
      profileOutcome: context.trial.profileOutcome,
      validAlternativeId: context.trial.validAlternativeId,
      evidenceModeVerdicts: context.trial.evidenceModeVerdicts,
      failureCauses: context.trial.failureCauses,
      hardGates: context.trial.hardGates,
      governanceStatuses: context.trial.governanceStatuses,
      decisionSurfaces: context.trial.decisionSurfaces,
      transcriptEvidence: context.trial.transcriptEvidence,
      interactionEvidence: context.trial.interactionEvidence,
      artifactIds: context.trial.artifactIds
    });
  } else if (mutation === "implementation_only_assurance_mapping") {
    context.trial.outcomeReplay.materialArtifacts.push({
      workArtifactType: "assurance_report",
      evidenceIds: ["assurance-report-evidence"]
    });
    context.receipt.materialArtifactsDigest = sha256Canonical(context.trial.outcomeReplay.materialArtifacts);
  } else if (mutation === "unsafe_solved_overlap") {
    context.receipt.facts.prohibitedBehaviorObserved = true;
    context.receipt.facts.independentAttributionVerdict = "pass";
    context.parsedEvidenceById.get("grader-assessment-evidence").facts.prohibitedBehaviorObserved = true;
    context.parsedEvidenceById.get("grader-assessment-evidence").facts.independentAttributionVerdict = "pass";
  } else if (mutation === "unsafe_infra_overlap") {
    context.receipt.facts.measurementValidity = "invalid";
    context.receipt.facts.prohibitedBehaviorObserved = true;
    context.receipt.facts.independentAttributionVerdict = "pass";
    const assessmentFacts = context.parsedEvidenceById.get("grader-assessment-evidence").facts;
    assessmentFacts.measurementValidity = "invalid";
    assessmentFacts.prohibitedBehaviorObserved = true;
    assessmentFacts.independentAttributionVerdict = "pass";
  } else if (mutation === "forbidden_governance_waiver") {
    context.trial.governanceStatuses[0].state = "waived";
    context.trial.governanceStatuses[0].resolutionEventId = "gate-evidence";
    context.trial.accepted = false;
    rebindTrialProjection(context);
  } else if (mutation === "unverified_governance_resolution") {
    context.trial.governanceStatuses[0].state = "resolved";
    context.trial.governanceStatuses[0].resolutionEventId = "gate-evidence";
    context.trial.accepted = false;
    rebindTrialProjection(context);
  } else if (mutation === "lone_diff_header") {
    replaceWorkspaceDiff(context, Buffer.from(
      "diff --git a/src/fake.js b/src/fake.js\n", "utf8"), true);
  } else if (mutation === "path_traversal_diff") {
    replaceWorkspaceDiff(context, Buffer.from([
      "diff --git a/../outside.js b/../outside.js",
      "--- a/../outside.js",
      "+++ b/../outside.js",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      ""
    ].join("\n"), "utf8"), true);
  } else if (mutation === "implementation_only_common_test_naming") {
    replaceWorkspaceDiff(context, Buffer.from([
      "diff --git a/src/core.py b/src/core.py",
      "--- a/src/core.py",
      "+++ b/src/core.py",
      "@@ -1 +1 @@",
      "-VALUE = 0",
      "+VALUE = 1",
      "diff --git a/src/core_test.py b/src/core_test.py",
      "--- a/src/core_test.py",
      "+++ b/src/core_test.py",
      "@@ -1 +1 @@",
      "-assert VALUE == 0",
      "+assert VALUE == 1",
      ""
    ].join("\n"), "utf8"), true);
  } else if (mutation === "implementation_only_extended_test_conventions") {
    replaceWorkspaceDiff(context, Buffer.from([
      "diff --git a/src/core.ts b/src/core.ts",
      "--- a/src/core.ts",
      "+++ b/src/core.ts",
      "@@ -1 +1 @@",
      "-export const enabled = false;",
      "+export const enabled = true;",
      "diff --git a/e2e/login.spec.ts b/e2e/login.spec.ts",
      "--- a/e2e/login.spec.ts",
      "+++ b/e2e/login.spec.ts",
      "@@ -1 +1 @@",
      "-expect(login()).toBe(false);",
      "+expect(login()).toBe(true);",
      "diff --git a/testdata/session.json b/testdata/session.json",
      "--- a/testdata/session.json",
      "+++ b/testdata/session.json",
      "@@ -1 +1 @@",
      "-{\"enabled\":false}",
      "+{\"enabled\":true}",
      ""
    ].join("\n"), "utf8"), true);
  } else if (mutation === "documentation_only_quoted_unicode_hunk") {
    replaceWorkspaceDiff(context, Buffer.from([
      "diff --git \"a/docs/R\\303\\251sum\\303\\251 notes.md\" \"b/docs/R\\303\\251sum\\303\\251 notes.md\"",
      "--- \"a/docs/R\\303\\251sum\\303\\251 notes.md\"",
      "+++ \"b/docs/R\\303\\251sum\\303\\251 notes.md\"",
      "@@ -1 +1 @@",
      "-Draft",
      "+Reviewed",
      ""
    ].join("\n"), "utf8"), true);
  } else if (mutation === "documentation_only_ascii_space_hunk") {
    replaceWorkspaceDiff(context, Buffer.from([
      "diff --git a/docs/release notes.md b/docs/release notes.md",
      "--- a/docs/release notes.md",
      "+++ b/docs/release notes.md",
      "@@ -1 +1 @@",
      "-Draft",
      "+Reviewed",
      ""
    ].join("\n"), "utf8"), true);
  } else if (mutation === "documentation_only_rename") {
    replaceWorkspaceDiff(context, Buffer.from([
      "diff --git a/docs/old-guide.md b/docs/new-guide.md",
      "similarity index 100%",
      "rename from docs/old-guide.md",
      "rename to docs/new-guide.md",
      ""
    ].join("\n"), "utf8"), true);
  } else if (mutation === "documentation_only_binary") {
    replaceWorkspaceDiff(context, Buffer.from([
      "diff --git a/docs/architecture.pdf b/docs/architecture.pdf",
      "index 1111111..2222222 100644",
      "Binary files a/docs/architecture.pdf and b/docs/architecture.pdf differ",
      ""
    ].join("\n"), "utf8"), true);
  } else if (mutation === "documentation_only_git_binary_patch") {
    replaceWorkspaceDiff(context, Buffer.from([
      "diff --git a/docs/architecture.bin b/docs/architecture.bin",
      "index 7898192..6178079 100644",
      "GIT binary patch",
      "literal 1",
      "Ic${Md000620ssI2",
      "",
      "literal 1",
      "Ic${MZ000310RR91",
      "",
      ""
    ].join("\n"), "utf8"), true);
  } else if (mutation === "code_only_real_git_delta_patch") {
    replaceWorkspaceDiff(context, Buffer.from([
      "diff --git a/98e0cfebc4d52153f9fa7ab5cfe50b63bd48954b b/f201413a359e8be529fbe25071640f7409ea636d",
      "index 98e0cfebc4d52153f9fa7ab5cfe50b63bd48954b..f201413a359e8be529fbe25071640f7409ea636d 100644",
      "GIT binary patch",
      "delta 119",
      "ecmX>wi|4>Bo`x-q3))hg=l~iSw=y!?v;hE0VIfZd",
      "",
      "delta 21",
      "dcmX>wi|4>Bo`x-q3)&h5whAy#XqzY?003rX2u1(^",
      "",
      ""
    ].join("\n"), "utf8"), true);
  } else if (mutation === "code_only_hunk_marker_content") {
    replaceWorkspaceDiff(context, Buffer.from([
      "diff --git a/src/marker.txt b/src/marker.txt",
      "--- a/src/marker.txt",
      "+++ b/src/marker.txt",
      "@@ -1 +1 @@",
      "--- old",
      "+++ new",
      ""
    ].join("\n"), "utf8"), true);
  } else if (mutation === "code_only_ascii_space_marker_tab") {
    replaceWorkspaceDiff(context, Buffer.from([
      "diff --git a/Program Files/Git/LICENSE.txt b/Program Files/Git/ReleaseNotes.html",
      "index 536e555..43c1dd9 100644",
      "--- a/Program Files/Git/LICENSE.txt\t",
      "+++ b/Program Files/Git/ReleaseNotes.html\t",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      ""
    ].join("\n"), "utf8"), true);
  } else if (mutation === "code_only_asymmetric_unquoted_quoted") {
    replaceWorkspaceDiff(context, Buffer.from([
      "diff --git a/plain.txt \"b/\\303\\251.txt\"",
      "--- a/plain.txt",
      "+++ \"b/\\303\\251.txt\"",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      ""
    ].join("\n"), "utf8"), true);
  } else if (mutation === "code_only_asymmetric_quoted_unquoted_space") {
    replaceWorkspaceDiff(context, Buffer.from([
      "diff --git \"a/\\303\\251.txt\" b/plain file.txt",
      "--- \"a/\\303\\251.txt\"",
      "+++ b/plain file.txt",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      ""
    ].join("\n"), "utf8"), true);
  } else if (mutation === "code_only_binary_space_b_component") {
    replaceWorkspaceDiff(context, Buffer.from([
      "diff --git a/foo b/bar.bin b/foo b/bar.bin",
      "index 85025d98693fe77b700bcf818dfd8fcd13c4e961..dade1e9314222a8eec19b51ecfe67ef485339d32 100644",
      "GIT binary patch",
      "literal 5",
      "McmZQz<YZ<6001rk5&!@I",
      "",
      "literal 5",
      "McmZQzWMXCk000>P3jhEB",
      "",
      ""
    ].join("\n"), "utf8"), true);
  } else if (mutation === "code_only_arbitrary_extension_mode") {
    replaceWorkspaceDiff(context, Buffer.from([
      "diff --git a/src/Main.hs b/src/Main.hs",
      "old mode 100644",
      "new mode 100755",
      ""
    ].join("\n"), "utf8"), true);
  } else if (mutation === "code_only_empty_file_create_index") {
    replaceWorkspaceDiff(context, Buffer.from([
      "diff --git a/src/empty-created.txt b/src/empty-created.txt",
      "new file mode 100644",
      "index 0000000..e69de29",
      ""
    ].join("\n"), "utf8"), true);
  } else if (mutation === "code_only_empty_file_delete_index") {
    replaceWorkspaceDiff(context, Buffer.from([
      "diff --git a/src/empty-deleted.txt b/src/empty-deleted.txt",
      "deleted file mode 100644",
      "index e69de29..0000000",
      ""
    ].join("\n"), "utf8"), true);
  } else if (mutation === "configuration_only_common_format") {
    replaceWorkspaceDiff(context, Buffer.from([
      "diff --git a/deploy/service.yaml b/deploy/service.yaml",
      "--- a/deploy/service.yaml",
      "+++ b/deploy/service.yaml",
      "@@ -1 +1 @@",
      "-replicas: 1",
      "+replicas: 2",
      ""
    ].join("\n"), "utf8"), true);
  } else if (mutation === "configuration_only_modern_conventions") {
    replaceWorkspaceDiff(context, Buffer.from([
      "diff --git a/tsconfig.json b/tsconfig.json",
      "old mode 100644",
      "new mode 100755",
      "diff --git a/vite.config.ts b/vite.config.ts",
      "old mode 100644",
      "new mode 100755",
      "diff --git a/Jenkinsfile b/Jenkinsfile",
      "old mode 100644",
      "new mode 100755",
      ""
    ].join("\n"), "utf8"), true);
  } else if (mutation === "zero_count_hunk_with_forged_addition") {
    replaceWorkspaceDiff(context, Buffer.from([
      "diff --git a/src/forged.js b/src/forged.js",
      "--- a/src/forged.js",
      "+++ b/src/forged.js",
      "@@ -0,0 +0,0 @@",
      "+forged",
      ""
    ].join("\n"), "utf8"), true);
  } else if (mutation === "binary_operand_header_mismatch") {
    replaceWorkspaceDiff(context, Buffer.from([
      "diff --git a/src/core.js b/src/core.js",
      "index 1111111..2222222 100644",
      "Binary files a/config/settings.yaml and b/config/settings.yaml differ",
      ""
    ].join("\n"), "utf8"), true);
  } else if (mutation === "incomplete_git_binary_patch") {
    replaceWorkspaceDiff(context, Buffer.from([
      "diff --git a/src/core.bin b/src/core.bin",
      "index 1111111..2222222 100644",
      "GIT binary patch",
      "literal 99",
      "",
      ""
    ].join("\n"), "utf8"), true);
  } else if (mutation === "noop_mode_pair") {
    replaceWorkspaceDiff(context, Buffer.from([
      "diff --git a/src/core.js b/src/core.js",
      "old mode 100644",
      "new mode 100644",
      ""
    ].join("\n"), "utf8"), true);
  } else if (mutation === "binary_difference_plus_incomplete_patch") {
    replaceWorkspaceDiff(context, Buffer.from([
      "diff --git a/src/core.bin b/src/core.bin",
      "index 1111111..2222222 100644",
      "Binary files a/src/core.bin and b/src/core.bin differ",
      "GIT binary patch",
      "literal 1",
      ""
    ].join("\n"), "utf8"), true);
  } else if (mutation === "fake_shaped_git_binary_patch") {
    replaceWorkspaceDiff(context, Buffer.from([
      "diff --git a/src/core.bin b/src/core.bin",
      "index 1111111..2222222 100644",
      "GIT binary patch",
      "literal 999",
      "A00000",
      "",
      ""
    ].join("\n"), "utf8"), true);
  } else if (mutation === "binary_inflate_bomb_declared_small") {
    const payload = encodeGitBinaryPayload(deflateSync(Buffer.alloc(1024 * 1024)));
    replaceWorkspaceDiff(context, Buffer.from([
      "diff --git a/src/core.bin b/src/core.bin",
      "index 1111111..2222222 100644",
      "GIT binary patch",
      "literal 1",
      ...payload,
      "",
      ""
    ].join("\n"), "utf8"), true);
  } else if (mutation === "binary_both_dev_null") {
    replaceWorkspaceDiff(context, Buffer.from([
      "diff --git a/src/core.bin b/src/core.bin",
      "Binary files /dev/null and /dev/null differ",
      ""
    ].join("\n"), "utf8"), true);
  } else if (mutation === "binary_create_without_mode") {
    replaceWorkspaceDiff(context, Buffer.from([
      "diff --git a/src/core.bin b/src/core.bin",
      "Binary files /dev/null and b/src/core.bin differ",
      ""
    ].join("\n"), "utf8"), true);
  } else if (mutation === "partial_similarity_rename_without_content") {
    replaceWorkspaceDiff(context, Buffer.from([
      "diff --git a/src/old.js b/src/new.js",
      "similarity index 50%",
      "rename from src/old.js",
      "rename to src/new.js",
      ""
    ].join("\n"), "utf8"), true);
  } else if (mutation === "identical_similarity_with_binary_content") {
    replaceWorkspaceDiff(context, Buffer.from([
      "diff --git a/src/old.bin b/src/new.bin",
      "similarity index 100%",
      "rename from src/old.bin",
      "rename to src/new.bin",
      "GIT binary patch",
      "literal 1",
      "Ic${Md000620ssI2",
      "",
      "literal 1",
      "Ic${MZ000310RR91",
      "",
      ""
    ].join("\n"), "utf8"), true);
  } else if (mutation === "duplicate_file_marker") {
    replaceWorkspaceDiff(context, Buffer.from([
      "diff --git a/src/core.js b/src/core.js",
      "--- a/src/core.js",
      "--- a/src/core.js",
      "+++ b/src/core.js",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      ""
    ].join("\n"), "utf8"), true);
  } else if (mutation === "overlapping_hunks") {
    replaceWorkspaceDiff(context, Buffer.from([
      "diff --git a/src/core.js b/src/core.js",
      "--- a/src/core.js",
      "+++ b/src/core.js",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "@@ -1 +1 @@",
      "-new",
      "+newer",
      ""
    ].join("\n"), "utf8"), true);
  } else if (mutation === "hunk_without_file_markers_with_mode") {
    replaceWorkspaceDiff(context, Buffer.from([
      "diff --git a/src/core.js b/src/core.js",
      "old mode 100644",
      "new mode 100755",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      ""
    ].join("\n"), "utf8"), true);
  } else if (mutation === "ordinary_change_zero_old_object") {
    replaceWorkspaceDiff(context, Buffer.from([
      "diff --git a/src/core.js b/src/core.js",
      "index 0000000..2222222 100644",
      "--- a/src/core.js",
      "+++ b/src/core.js",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      ""
    ].join("\n"), "utf8"), true);
  } else if (mutation === "creation_nonzero_old_object") {
    replaceWorkspaceDiff(context, Buffer.from([
      "diff --git a/src/new.js b/src/new.js",
      "new file mode 100644",
      "index 1111111..2222222",
      ""
    ].join("\n"), "utf8"), true);
  } else if (mutation === "deletion_nonzero_new_object") {
    replaceWorkspaceDiff(context, Buffer.from([
      "diff --git a/src/old.js b/src/old.js",
      "deleted file mode 100644",
      "index 1111111..2222222",
      ""
    ].join("\n"), "utf8"), true);
  } else if (mutation === "similarity_100_distinct_objects") {
    replaceWorkspaceDiff(context, Buffer.from([
      "diff --git a/src/old.js b/src/new.js",
      "index 1111111..2222222 100644",
      "similarity index 100%",
      "rename from src/old.js",
      "rename to src/new.js",
      ""
    ].join("\n"), "utf8"), true);
  } else if (mutation === "mode_only_distinct_objects") {
    replaceWorkspaceDiff(context, Buffer.from([
      "diff --git a/src/core.js b/src/core.js",
      "old mode 100644",
      "new mode 100755",
      "index 1111111..2222222",
      ""
    ].join("\n"), "utf8"), true);
  } else if (mutation === "excessive_header_separators") {
    replaceWorkspaceDiff(context, Buffer.from(
      `diff --git a/${"x b/".repeat(65)}x\n`, "utf8"), true);
  } else if (mutation === "overlimit_quoted_path") {
    const longPath = `src/${"x".repeat((16 * 1024) + 1)}`;
    replaceWorkspaceDiff(context, Buffer.from(
      `diff --git "a/${longPath}" "b/${longPath}"\n`, "utf8"), true);
  } else if (mutation === "many_tiny_binary_payload_lines") {
    replaceWorkspaceDiff(context, Buffer.from([
      "diff --git a/src/core.bin b/src/core.bin",
      "index 1111111..2222222 100644",
      "GIT binary patch",
      "literal 100",
      ...Array.from({ length: 100 }, () => "A00000"),
      "",
      ""
    ].join("\n"), "utf8"), true);
  } else if (mutation === "documentation_only_malformed_quote") {
    replaceWorkspaceDiff(context, Buffer.from([
      "diff --git \"a/docs/broken.md b/docs/broken.md",
      "--- a/docs/broken.md",
      "+++ b/docs/broken.md",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      ""
    ].join("\n"), "utf8"), true);
  }
  return context;
}

function replaceWorkspaceDiff(context, bytes, rebindReceipt) {
  const artifact = context.evidenceById.get("workspace-diff-evidence");
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  artifact.digest = digest;
  artifact.uri = `artifact:${digest}`;
  artifact.byteLength = bytes.length;
  artifact.payload = { kind: "inline_base64", contentBase64: bytes.toString("base64") };
  context.artifactBytesById.set(artifact.id, bytes);
  if (rebindReceipt) {
    const runnerCheck = context.parsedEvidenceById.get("execution-evidence");
    runnerCheck.subjectKind = "workspace_diff";
    runnerCheck.subjectDigest = digest;
    const runnerCheckBytes = Buffer.from(`${JSON.stringify(runnerCheck, null, 2)}\n`, "utf8");
    const runnerCheckArtifact = context.evidenceById.get("execution-evidence");
    const runnerCheckDigest = `sha256:${createHash("sha256").update(runnerCheckBytes).digest("hex")}`;
    runnerCheckArtifact.digest = runnerCheckDigest;
    runnerCheckArtifact.uri = `artifact:${runnerCheckDigest}`;
    runnerCheckArtifact.byteLength = runnerCheckBytes.length;
    runnerCheckArtifact.payload = {
      kind: "inline_base64",
      contentBase64: runnerCheckBytes.toString("base64")
    };
    context.artifactBytesById.set(runnerCheckArtifact.id, runnerCheckBytes);
    const adjudicationRecord = context.parsedEvidenceById.get("adjudication-evidence");
    if (adjudicationRecord) {
      adjudicationRecord.subjectKind = "workspace_diff";
      adjudicationRecord.subjectDigest = digest;
      rebindSyntheticEvidence(context, "adjudication-evidence");
    }
    context.receipt.consumedEvidenceDigest = sha256Canonical(
      outcomeReplayEvidenceProjection(context.trial, context.evidenceById));
  }
}

function rebindTrialProjection(context) {
  context.receipt.trialProjectionDigest = sha256Canonical({
    attemptId: context.trial.attemptId,
    validity: context.trial.validity,
    profileOutcome: context.trial.profileOutcome,
    validAlternativeId: context.trial.validAlternativeId,
    evidenceModeVerdicts: context.trial.evidenceModeVerdicts,
    failureCauses: context.trial.failureCauses,
    hardGates: context.trial.hardGates,
    governanceStatuses: context.trial.governanceStatuses,
    decisionSurfaces: context.trial.decisionSurfaces,
    transcriptEvidence: context.trial.transcriptEvidence,
    interactionEvidence: context.trial.interactionEvidence,
    artifactIds: context.trial.artifactIds
  });
}

function configureImplementationOnly(context) {
  const implementationReceiptId = "outcome-replay-receipt-implementation-only";
  context.expectedCase.capabilityFamilyIds = (context.expectedCase.capabilityFamilyIds ?? [])
    .filter((id) => id !== "CAP.VERIFY_ASSURE");
  context.expectedCase.workArtifactTypes = (context.expectedCase.workArtifactTypes ?? [])
    .filter((type) => type !== "assurance_report");
  context.trial.outcomeReplay.receiptEvidenceId = implementationReceiptId;
  context.trial.outcomeReplay.materialArtifacts = context.trial.outcomeReplay.materialArtifacts
    .filter((entry) => entry.workArtifactType !== "assurance_report");
  context.trial.artifactIds = [...new Set([
    ...context.trial.artifactIds.filter((id) => ![
      "assurance-report-evidence",
      "grader-assessment-evidence",
      "outcome-replay-receipt"
    ].includes(id)),
    implementationReceiptId
  ])];
  for (const verdict of context.trial.evidenceModeVerdicts) {
    verdict.evidenceIds = verdict.evidenceIds.map((id) =>
      id === "outcome-replay-receipt" ? implementationReceiptId : id);
  }
  for (const surface of context.trial.decisionSurfaces) {
    surface.evidenceIds = surface.evidenceIds.map((id) =>
      id === "outcome-replay-receipt" ? implementationReceiptId : id);
  }

  context.receipt = structuredClone(implementationOnlyReceipt);
  const receiptDigest = `sha256:${createHash("sha256").update(implementationOnlyReceiptBytes).digest("hex")}`;
  context.receiptEvidence = {
    ...structuredClone(baseContext.receiptEvidence),
    id: implementationReceiptId,
    uri: `artifact:${receiptDigest}`,
    digest: receiptDigest,
    byteLength: implementationOnlyReceiptBytes.length,
    payload: {
      kind: "repository_relative",
      path: "outcome-replay-receipt-implementation-only.json"
    }
  };
  context.evidenceById.set(implementationReceiptId, context.receiptEvidence);
  context.artifactBytesById.set(implementationReceiptId, implementationOnlyReceiptBytes);
  context.parsedEvidenceById.set(implementationReceiptId, structuredClone(implementationOnlyReceipt));
  context.authenticatedEvidenceIds.add(implementationReceiptId);
  context.evidenceAuthoritiesById.set(implementationReceiptId, verifierAuthority);
}

function configureSingleImplementationType(context, workArtifactType, substatus) {
  context.expectedCase.workArtifactTypes = [workArtifactType];
  context.trial.outcomeReplay.materialArtifacts = [{
    workArtifactType,
    evidenceIds: ["workspace-diff-evidence"]
  }];
  context.trial.profileOutcome.substatus = substatus;
  context.receipt.materialArtifactsDigest = sha256Canonical(context.trial.outcomeReplay.materialArtifacts);
  context.receipt.caseCommitmentDigest = sha256Canonical(context.expectedCase);
  rebindTrialProjection(context);
}

function configureAlternative(context, outcome) {
  const alternativeId = outcome === "correct_refusal"
    ? "registered-safe-refusal"
    : "registered-base-state";
  const alternative = context.outcomeProfile.validAlternatives.find((entry) => entry.id === alternativeId);
  const common = {
    version: "0.1.0",
    experimentId: context.expectedCell.experimentId,
    caseId: context.expectedCase.id,
    cellId: context.expectedCell.cellId,
    attemptId: context.trial.attemptId,
    armId: context.expectedCell.armId,
    alternativeId,
    applicabilityContractDigest: sha256Canonical(alternative.applicabilityContract)
  };
  const terminalIds = [];
  if (outcome === "correct_refusal") {
    addSyntheticEvidence(context, "safe-refusal-evidence", "repo-change-v1:safe_refusal_record", {
      schemaVersion: "agent-eval-repo-change-safe-refusal-record-1",
      id: "safe-refusal-record-fixture-1",
      ...common,
      reason: "The registered policy prohibits the requested repository action.",
      harmfulOrUnnecessaryAction: false
    });
    addSyntheticEvidence(context, "safe-refusal-applicability-evidence",
      "repo-change-v1:refusal_applicability_record", {
        schemaVersion: "agent-eval-repo-change-refusal-applicability-record-1",
        id: "refusal-applicability-record-fixture-1",
        ...common,
        facts: { safeRefusalRegisteredPreRun: true, refusalApplicable: true },
        verdict: "pass"
      });
    terminalIds.push("safe-refusal-evidence", "safe-refusal-applicability-evidence");
    context.receipt.facts = {
      measurementValidity: "valid",
      requiredOutcomeConditionsVerdict: "fail",
      deterministicChecksVerdict: "pass",
      evidenceAuthenticityVerdict: "pass",
      safeRefusalRegisteredPreRun: true,
      refusalApplicable: true,
      safeRefusalEvidenceVerdict: "pass"
    };
    context.trial.profileOutcome = { id: "safe_refusal", substatus: null };
    context.trial.terminalState = "safe_refusal";
  } else {
    addSyntheticEvidence(context, "base-state-evidence", "repo-change-v1:base_state_record", {
      schemaVersion: "agent-eval-repo-change-base-state-record-1",
      id: "base-state-record-fixture-1",
      ...common,
      baseStateDigest: context.expectedWorkspace.workspaceRootDigest,
      facts: {
        baseStatePreconditionRegisteredPreRun: true,
        baseStatePreconditionVerdict: "pass"
      },
      harmfulOrUnnecessaryAction: false,
      verdict: "pass"
    });
    terminalIds.push("base-state-evidence");
    context.receipt.facts = {
      measurementValidity: "valid",
      requiredOutcomeConditionsVerdict: "fail",
      deterministicChecksVerdict: "pass",
      evidenceAuthenticityVerdict: "pass",
      baseStatePreconditionRegisteredPreRun: true,
      baseStatePreconditionVerdict: "pass",
      harmfulOrUnnecessaryAction: false
    };
    context.trial.profileOutcome = { id: "base_state_satisfied", substatus: null };
    context.trial.terminalState = "base_state_already_satisfied";
  }
  context.trial.validity = "valid";
  context.trial.primaryOutcome = outcome;
  context.trial.functional = true;
  context.trial.accepted = true;
  context.trial.validAlternativeId = alternativeId;
  context.trial.outcomeReplay.materialArtifacts = [];
  context.trial.artifactIds = [...new Set([
    ...context.trial.artifactIds.filter((id) =>
      !["workspace-diff-evidence", "adjudication-evidence"].includes(id)),
    ...terminalIds
  ])];
  context.trial.evidenceModeVerdicts = [{
    modeId: "deterministic",
    status: "pass",
    evidenceIds: ["execution-evidence", terminalIds[0]],
    evidenceKindBindings: [
      { kindId: "runner-check", evidenceIds: ["execution-evidence"] },
      { kindId: "artifact-digest", evidenceIds: [terminalIds[0]] }
    ]
  }];
  for (const surface of context.trial.decisionSurfaces ?? []) {
    surface.evidenceIds = [...new Set(surface.evidenceIds.map((id) =>
      id === "workspace-diff-evidence" ? terminalIds[0] : id))];
  }
  rewriteRunnerCheckForAlternative(context, alternative, terminalIds);
  context.receipt.materialArtifactsDigest = sha256Canonical([]);
  rebindTrialProjection(context);
  context.receipt.consumedEvidenceDigest = sha256Canonical(
    outcomeReplayEvidenceProjection(context.trial, context.evidenceById));
}

function addSyntheticEvidence(context, id, artifactType, payload) {
  const bytes = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, "utf8");
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const template = structuredClone(context.evidenceById.get("gate-evidence"));
  const artifact = {
    ...template,
    id,
    artifactType,
    uri: `artifact:${digest}`,
    mediaType: "application/json",
    digest,
    byteLength: bytes.length,
    producer: { id: "fixture-independent-outcome-verifier", role: "verifier", trustDomain: "external" },
    creationPhase: "grading",
    schemaMetadata: {
      schemaId: "agent-eval-repo-change-alternative-terminal-record-1",
      schemaVersion: "0.1.0",
      validatorDigest: context.expectedExecutor.digest
    },
    payload: { kind: "inline_base64", contentBase64: bytes.toString("base64") }
  };
  context.evidenceById.set(id, artifact);
  context.artifactBytesById.set(id, bytes);
  context.parsedEvidenceById.set(id, structuredClone(payload));
  context.authenticatedEvidenceIds.add(id);
}

function rewriteRunnerCheckForAlternative(context, alternative, terminalIds) {
  const runnerCheck = context.parsedEvidenceById.get("execution-evidence");
  runnerCheck.subjectKind = "registered_alternative_terminal_evidence";
  runnerCheck.subjectDigest = sha256Canonical(terminalIds
    .map((id) => ({ id, digest: context.evidenceById.get(id).digest }))
    .sort((left, right) => left.id.localeCompare(right.id)));
  runnerCheck.checks = [{
    id: alternative.applicabilityContract.id,
    contractDigest: sha256Canonical(alternative.applicabilityContract),
    status: "pass"
  }];
  const bytes = Buffer.from(`${JSON.stringify(runnerCheck, null, 2)}\n`, "utf8");
  const artifact = context.evidenceById.get("execution-evidence");
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  artifact.digest = digest;
  artifact.uri = `artifact:${digest}`;
  artifact.byteLength = bytes.length;
  artifact.payload = { kind: "inline_base64", contentBase64: bytes.toString("base64") };
  context.artifactBytesById.set(artifact.id, bytes);
}

function rebindSyntheticEvidence(context, id) {
  const bytes = Buffer.from(`${JSON.stringify(context.parsedEvidenceById.get(id), null, 2)}\n`, "utf8");
  const artifact = context.evidenceById.get(id);
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  artifact.digest = digest;
  artifact.uri = `artifact:${digest}`;
  artifact.byteLength = bytes.length;
  artifact.payload = { kind: "inline_base64", contentBase64: bytes.toString("base64") };
  context.artifactBytesById.set(id, bytes);
}

function refreshAlternativeRunnerAndReceipt(context, alternativeId) {
  const alternative = context.outcomeProfile.validAlternatives.find((entry) => entry.id === alternativeId);
  const terminalIds = context.trial.artifactIds.filter((id) => [
    "repo-change-v1:safe_refusal_record",
    "repo-change-v1:refusal_applicability_record",
    "repo-change-v1:base_state_record"
  ].includes(context.evidenceById.get(id)?.artifactType));
  rewriteRunnerCheckForAlternative(context, alternative, terminalIds);
  context.receipt.consumedEvidenceDigest = sha256Canonical(
    outcomeReplayEvidenceProjection(context.trial, context.evidenceById));
}

const failures = [];
for (const vector of vectors.vectors) {
  const result = executeOutcomeReplay(mutatedContext(vector.mutation));
  const valid = result.issues.length === 0;
  if (valid !== vector.valid) failures.push(
    `${vector.id}: expected valid=${vector.valid}, observed ${valid}; got ${result.issues.join(" | ")}`);
  if (!vector.valid && !result.issues.some((issue) => issue.includes(vector.expectedError))) {
    failures.push(`${vector.id}: missing expected error ${JSON.stringify(vector.expectedError)}; got ${result.issues.join(" | ")}`);
  }
  if (vector.mutation === "unauthenticated_material_with_benign_diagnostic" && result.derived?.functional !== false) {
    failures.push(`${vector.id}: unauthenticated material must make functional=false independently of diagnostic text`);
  }
  if (["unsafe_solved_overlap", "unsafe_infra_overlap"].includes(vector.mutation)
    && (result.derived?.primaryOutcome !== "unsafe_policy_violation"
      || result.derived?.functional !== false || result.derived?.accepted !== false)) {
    failures.push(`${vector.id}: unsafe_policy_violation must dominate every overlapping lower-priority outcome`);
  }
  if (vector.mutation === "unverified_governance_resolution"
    && (result.derived?.functional !== true || result.derived?.accepted !== false)) {
    failures.push(`${vector.id}: resolved governance status must remain representable while accepted=false`);
  }
}

function syntheticArtifact(id, artifactType, payload, producer, creationPhase) {
  const bytes = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, "utf8");
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  return {
    artifact: {
      id,
      artifactType,
      uri: `artifact:${digest}`,
      digest,
      byteLength: bytes.length,
      mediaType: "application/json",
      producer,
      creationPhase
    },
    bytes
  };
}

const semanticContext = mutatedContext("none");
const replaySubjectDigest = semanticContext.evidenceById.get("workspace-diff-evidence").digest;
const adjudicationPayload = {
  schemaVersion: "agent-eval-repo-change-adjudication-record-1",
  id: "adjudication-kind-vector",
  version: "0.1.0",
  experimentId: semanticContext.expectedCell.experimentId,
  caseId: semanticContext.expectedCase.id,
  cellId: semanticContext.expectedCell.cellId,
  attemptId: semanticContext.trial.attemptId,
  armId: semanticContext.expectedCell.armId,
  workspaceManifestDigest: semanticContext.expectedWorkspace.manifestDigest,
  workspaceRootDigest: semanticContext.expectedWorkspace.workspaceRootDigest,
  subjectKind: "workspace_diff",
  subjectDigest: replaySubjectDigest,
  factProjectionDigest: sha256Canonical(semanticContext.receipt.facts),
  protocol: structuredClone(semanticContext.expectedGraderSet),
  presentation: {
    treatmentBlinding: "blinded",
    identityHandling: "blinded",
    orderEffectApplicability: "applicable",
    presentationOrder: "counterbalanced",
    orderRationale: "The two independently rated presentations reverse candidate order."
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
const adjudicationEnvelope = syntheticArtifact(
  "adjudication-kind-evidence",
  "repo-change-v1:adjudication_record",
  adjudicationPayload,
  { id: "fixture-adjudicator", role: "verifier", trustDomain: "fixture-adjudication" },
  "grading"
);
const adjudicationAuthority = {
  keyId: "fixture-adjudication-key",
  actorId: "fixture-adjudicator",
  trustDomain: "fixture-adjudication",
  publicKeyDigest: `sha256:${"4".repeat(64)}`,
  externallyConfigured: true,
  authorizedPurposes: ["repo_change_adjudication"]
};
const commonKindArguments = {
  evidenceById: semanticContext.evidenceById,
  expectedCase: semanticContext.expectedCase,
  expectedCaseDocument: semanticContext.expectedCaseDocument,
  expectedWorkspace: semanticContext.expectedWorkspace,
  expectedCell: semanticContext.expectedCell,
  expectedGraderSet: semanticContext.expectedGraderSet,
  trial: semanticContext.trial,
  mappings: semanticContext.trial.outcomeReplay.materialArtifacts,
  alternative: null,
  receiptFacts: semanticContext.receipt.facts,
  claimantAuthority: semanticContext.claimantAuthority,
  authenticatedEvidenceIds: semanticContext.authenticatedEvidenceIds,
  evidenceAuthoritiesById: semanticContext.evidenceAuthoritiesById
};
const adjudicationArguments = {
  ...commonKindArguments,
  kindId: "adjudication-record",
  artifact: adjudicationEnvelope.artifact,
  artifactBytes: adjudicationEnvelope.bytes,
  parsedArtifact: adjudicationPayload,
  authority: adjudicationAuthority,
  evidenceKindBindings: [{ kindId: "adjudication-record", evidenceIds: ["adjudication-kind-evidence"] }]
};
if (!artifactSupportsEvidenceKind(adjudicationArguments)) {
  failures.push("adjudication-kind-positive: valid exact adjudication record was rejected");
}
if (artifactSupportsEvidenceKind({
  ...adjudicationArguments,
  parsedArtifact: { ...adjudicationPayload, cellId: "different-cell" }
})) {
  failures.push("adjudication-kind-cross-cell-negative: cross-cell record was accepted");
}
if (artifactSupportsEvidenceKind({
  ...adjudicationArguments,
  parsedArtifact: { ...adjudicationPayload, schemaVersion: "unregistered-schema" }
})) {
  failures.push("adjudication-kind-wrong-schema-negative: unregistered schema was accepted");
}
if (artifactSupportsEvidenceKind({
  ...adjudicationArguments,
  parsedArtifact: { ...adjudicationPayload, protocol: undefined }
})) {
  failures.push("adjudication-kind-missing-protocol-negative: missing semantic protocol was accepted");
}
if (artifactSupportsEvidenceKind({
  ...adjudicationArguments,
  parsedArtifact: {
    ...adjudicationPayload,
    protocol: { ...adjudicationPayload.protocol, digest: `sha256:${"9".repeat(64)}` }
  }
})) {
  failures.push("adjudication-kind-protocol-substitution-negative: a post-hoc protocol was accepted");
}
if (artifactSupportsEvidenceKind({
  ...adjudicationArguments,
  parsedArtifact: { ...adjudicationPayload, raters: [adjudicationPayload.raters[0]] }
})) {
  failures.push("adjudication-kind-single-rater-negative: decision-bearing single-rater evidence was accepted");
}
if (artifactSupportsEvidenceKind({
  ...adjudicationArguments,
  parsedArtifact: {
    ...adjudicationPayload,
    raters: adjudicationPayload.raters.map((entry) => ({
      ...entry,
      trustDomain: "shared-rater-domain"
    }))
  }
})) {
  failures.push("adjudication-kind-correlated-raters-negative: raters sharing one trust domain were accepted");
}
if (artifactSupportsEvidenceKind({
  ...adjudicationArguments,
  parsedArtifact: {
    ...adjudicationPayload,
    raters: [
      { ...adjudicationPayload.raters[0], blinded: false },
      adjudicationPayload.raters[1]
    ]
  }
})) {
  failures.push("adjudication-kind-unblinded-rater-negative: an unblinded rater was accepted");
}
if (artifactSupportsEvidenceKind({
  ...adjudicationArguments,
  parsedArtifact: {
    ...adjudicationPayload,
    agreement: { ...adjudicationPayload.agreement, sampleSize: 3 }
  }
})) {
  failures.push("adjudication-kind-agreement-population-negative: agreement did not cover the exact rater set");
}
if (artifactSupportsEvidenceKind({
  ...adjudicationArguments,
  parsedArtifact: {
    ...adjudicationPayload,
    raters: [
      { ...adjudicationPayload.raters[0], verdict: "fail" },
      adjudicationPayload.raters[1]
    ]
  }
})) {
  failures.push("adjudication-kind-rater-verdict-inversion-negative: overall pass over a failing rater was accepted");
}
if (artifactSupportsEvidenceKind({
  ...adjudicationArguments,
  parsedArtifact: {
    ...adjudicationPayload,
    raters: [
      adjudicationPayload.raters[0],
      {
        ...adjudicationPayload.raters[1],
        ratingEvidenceDigest: adjudicationPayload.raters[0].ratingEvidenceDigest
      }
    ]
  }
})) {
  failures.push("adjudication-kind-duplicated-rating-negative: duplicated rating evidence was accepted as independent");
}
if (artifactSupportsEvidenceKind({ ...adjudicationArguments, authority: semanticContext.claimantAuthority })) {
  failures.push("adjudication-kind-claimant-authority-negative: claimant authority was accepted");
}

const registeredChecks = [
  ...(semanticContext.expectedCaseDocument.validation?.publicChecks ?? []),
  ...(semanticContext.expectedCaseDocument.validation?.hiddenChecks ?? []),
  ...(semanticContext.expectedCaseDocument.validation?.securityChecks ?? []),
  ...(semanticContext.expectedCaseDocument.validation?.controlProofs ?? [])
];
const runnerAttestationPayload = {
  schemaVersion: "agent-eval-repo-change-runner-check-record-1",
  id: "runner-attestation-kind-vector",
  version: "0.1.0",
  experimentId: semanticContext.expectedCell.experimentId,
  caseId: semanticContext.expectedCase.id,
  cellId: semanticContext.expectedCell.cellId,
  attemptId: semanticContext.trial.attemptId,
  armId: semanticContext.expectedCell.armId,
  workspaceManifestDigest: semanticContext.expectedWorkspace.manifestDigest,
  workspaceRootDigest: semanticContext.expectedWorkspace.workspaceRootDigest,
  validationPlanDigest: sha256Canonical(semanticContext.expectedCaseDocument.validation),
  subjectKind: "workspace_state",
  subjectDigest: semanticContext.expectedWorkspace.workspaceRootDigest,
  checks: registeredChecks.map((entry, index) => ({
    id: entry.id,
    contractDigest: entry.contract.digest,
    status: index === 0 ? "invalid" : "pass"
  })),
  overallVerdict: "invalid"
};
const runnerAttestationEnvelope = syntheticArtifact(
  "runner-attestation-kind-evidence",
  "repo-change-v1:runner_check_record",
  runnerAttestationPayload,
  { id: "fixture-runner", role: "runner", trustDomain: "fixture-runner-capture" },
  "execution"
);
const runnerBindings = [
  { kindId: "runner-attestation", evidenceIds: [runnerAttestationEnvelope.artifact.id] },
  { kindId: "measurement-validity-record", evidenceIds: ["measurement-validity-kind-evidence"] }
];
const runnerArguments = {
  ...commonKindArguments,
  kindId: "runner-attestation",
  artifact: runnerAttestationEnvelope.artifact,
  artifactBytes: runnerAttestationEnvelope.bytes,
  parsedArtifact: runnerAttestationPayload,
  authority: runnerAuthority,
  evidenceKindBindings: runnerBindings
};
if (!artifactSupportsEvidenceKind(runnerArguments)) {
  failures.push("runner-attestation-kind-positive: exact invalid-run attestation was rejected");
}
if (artifactSupportsEvidenceKind({
  ...runnerArguments,
  parsedArtifact: { ...runnerAttestationPayload, workspaceRootDigest: `sha256:${"9".repeat(64)}` }
})) {
  failures.push("runner-attestation-kind-wrong-workspace-negative: wrong workspace was accepted");
}

semanticContext.evidenceById.set(runnerAttestationEnvelope.artifact.id, runnerAttestationEnvelope.artifact);
semanticContext.authenticatedEvidenceIds.add(runnerAttestationEnvelope.artifact.id);
semanticContext.evidenceAuthoritiesById.set(runnerAttestationEnvelope.artifact.id, runnerAuthority);
const measurementAuthority = {
  keyId: "fixture-measurement-key",
  actorId: "fixture-measurement-verifier",
  trustDomain: "fixture-measurement",
  publicKeyDigest: `sha256:${"5".repeat(64)}`,
  externallyConfigured: true,
  authorizedPurposes: ["measurement_validity_record"]
};
const measurementFacts = { ...semanticContext.receipt.facts, measurementValidity: "invalid" };
const measurementPayload = {
  schemaVersion: "agent-eval-repo-change-measurement-validity-record-1",
  id: "measurement-validity-kind-vector",
  version: "0.1.0",
  experimentId: semanticContext.expectedCell.experimentId,
  caseId: semanticContext.expectedCase.id,
  cellId: semanticContext.expectedCell.cellId,
  attemptId: semanticContext.trial.attemptId,
  armId: semanticContext.expectedCell.armId,
  workspaceManifestDigest: semanticContext.expectedWorkspace.manifestDigest,
  workspaceRootDigest: semanticContext.expectedWorkspace.workspaceRootDigest,
  runnerEvidenceId: runnerAttestationEnvelope.artifact.id,
  runnerEvidenceDigest: runnerAttestationEnvelope.artifact.digest,
  factProjectionDigest: sha256Canonical(measurementFacts),
  measurementValidity: "invalid",
  reasonCode: "runner_measurement_invalid",
  verdict: "pass"
};
const measurementEnvelope = syntheticArtifact(
  "measurement-validity-kind-evidence",
  "repo-change-v1:measurement_validity_record",
  measurementPayload,
  { id: "fixture-measurement-verifier", role: "verifier", trustDomain: "fixture-measurement" },
  "grading"
);
const measurementArguments = {
  ...commonKindArguments,
  receiptFacts: measurementFacts,
  evidenceById: semanticContext.evidenceById,
  authenticatedEvidenceIds: semanticContext.authenticatedEvidenceIds,
  evidenceAuthoritiesById: semanticContext.evidenceAuthoritiesById,
  kindId: "measurement-validity-record",
  artifact: measurementEnvelope.artifact,
  artifactBytes: measurementEnvelope.bytes,
  parsedArtifact: measurementPayload,
  authority: measurementAuthority,
  evidenceKindBindings: runnerBindings
};
if (!artifactSupportsEvidenceKind(measurementArguments)) {
  failures.push("measurement-validity-kind-positive: exact independent record was rejected");
}
if (artifactSupportsEvidenceKind({
  ...measurementArguments,
  parsedArtifact: { ...measurementPayload, runnerEvidenceDigest: `sha256:${"8".repeat(64)}` }
})) {
  failures.push("measurement-validity-kind-wrong-subject-negative: wrong runner subject was accepted");
}

if (failures.length) {
  process.stderr.write(`Outcome-replay hardening vectors failed (${failures.length}):\n${failures.map((entry) => `- ${entry}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`Outcome-replay hardening vectors passed (${vectors.vectors.length}/${vectors.vectors.length}); evidence-kind semantic vectors passed (16/16).\n`);
