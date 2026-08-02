#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import {
  canonicalize,
  dependencyManifestDigest,
  gitObjectGraphDigest,
  gitObjectId,
  repositoryTreeDigest,
  sha256Bytes,
  sha256Canonical,
  verifyRepositoryGroundingEvidence,
  verifyWorkspaceManifest,
  workspaceRootDigest
} from "./verify-repository-grounding.mjs";
import { executeRepositoryPredicate } from "./repository-grounding-predicate-executor.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(root, "conformance", "fixtures", "grounding-hardening-vectors.json");
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
const workspaceSchema = JSON.parse(await readFile(path.join(root, "schemas", "workspace-manifest.schema.json"), "utf8"));
const groundingSchema = JSON.parse(await readFile(path.join(root, "schemas", "repository-grounding-evidence.schema.json"), "utf8"));
const executorRegistryPath = path.join(root, "standard", "repository-grounding-executor-registry.json");
const executorRegistry = JSON.parse(await readFile(executorRegistryPath, "utf8"));

async function authenticateExecutorAuthority(registry, byteOverride = null) {
  const matches = registry.executors.filter((entry) => entry.id === "agent-evals-standard.repository-contract-predicate"
    && entry.version === "0.1.0");
  if (matches.length !== 1) return { executors: [] };
  const entry = matches[0];
  const absolute = path.resolve(path.dirname(executorRegistryPath), entry.uri);
  if (!absolute.startsWith(`${root}${path.sep}`)) return { executors: [] };
  const bytes = byteOverride ?? await readFile(absolute);
  if (sha256Bytes(bytes) !== entry.digest) return { executors: [] };
  return {
    executors: [{
      ...clone(entry),
      authenticated: true,
      execute: executeRepositoryPredicate
    }]
  };
}

const executorAuthority = await authenticateExecutorAuthority(executorRegistry);
const driftedExecutorAuthority = await authenticateExecutorAuthority(
  executorRegistry, Buffer.from("distribution bytes differ from the pinned digest", "utf8"));
const validateWorkspaceSchema = ajv.compile(workspaceSchema);
const validateGroundingSchema = ajv.compile(groundingSchema);

function clone(value) {
  return structuredClone(value);
}

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function treeContent(entries) {
  return Buffer.concat(entries.map((entry) => Buffer.concat([
    Buffer.from(`${entry.mode} ${entry.name}\0`, "utf8"),
    Buffer.from(entry.objectId, "hex")
  ])));
}

function objectRecord(type, content) {
  return {
    objectId: gitObjectId("sha1", type, content),
    type,
    byteLength: content.length,
    contentBase64: content.toString("base64")
  };
}

function buildWorkspace(source) {
  const files = source.files.map((file) => {
    const bytes = Buffer.from(file.content, "utf8");
    return {
      path: file.path,
      mode: file.mode,
      mediaType: file.mediaType,
      byteLength: bytes.length,
      digest: sha256Bytes(bytes),
      contentBase64: bytes.toString("base64")
    };
  }).sort((left, right) => lexicalCompare(left.path, right.path));
  const blobByPath = new Map(files.map((file) => [file.path,
    objectRecord("blob", Buffer.from(file.contentBase64, "base64"))]));
  const configTree = objectRecord("tree", treeContent([{
    mode: "100644",
    name: "acceptance.json",
    objectId: blobByPath.get("config/acceptance.json").objectId
  }]));
  const sourceTree = objectRecord("tree", treeContent([{
    mode: "100644",
    name: "app.js",
    objectId: blobByPath.get("src/app.js").objectId
  }]));
  const rootTree = objectRecord("tree", treeContent([
    { mode: "100644", name: "README.md", objectId: blobByPath.get("README.md").objectId },
    { mode: "40000", name: "config", objectId: configTree.objectId },
    { mode: "40000", name: "src", objectId: sourceTree.objectId }
  ]));
  const commitContent = Buffer.from([
    `tree ${rootTree.objectId}`,
    "author Fixture Builder <fixture@example.invalid> 0 +0000",
    "committer Fixture Builder <fixture@example.invalid> 0 +0000",
    "",
    "sealed grounding fixture",
    ""
  ].join("\n"), "utf8");
  const commit = objectRecord("commit", commitContent);
  const objects = [
    ...blobByPath.values(),
    configTree,
    sourceTree,
    rootTree,
    commit
  ].sort((left, right) => lexicalCompare(left.objectId, right.objectId));
  const repository = {
    id: source.id,
    path: source.path,
    objectFormat: "sha1",
    baseRevision: commit.objectId,
    treeDigest: "",
    gitObjectGraph: {
      baseRef: "refs/heads/eval-base",
      refs: [{ name: "refs/heads/eval-base", target: commit.objectId }],
      objects,
      digest: ""
    },
    historyProjection: {
      mode: "full_ancestry",
      cutoffRevision: commit.objectId,
      baseRef: "refs/heads/eval-base",
      objectGraphDigest: "",
      reachableObjectCount: objects.length,
      verifier: {
        id: "agent-evals-standard.git-repository-state-verifier",
        version: "0.1.0",
        algorithm: "git-repository-state-v1"
      }
    },
    files
  };
  repository.treeDigest = repositoryTreeDigest(repository);
  repository.gitObjectGraph.digest = gitObjectGraphDigest(repository);
  repository.historyProjection.objectGraphDigest = repository.gitObjectGraph.digest;
  const workspace = {
    schemaVersion: "agent-eval-workspace-manifest-1",
    id: "causal-workspace-fixture",
    version: "0.1.0",
    repositories: [repository],
    workspaceRootDigest: ""
  };
  workspace.workspaceRootDigest = workspaceRootDigest(workspace);
  return workspace;
}

function withoutDigest(value) {
  const projection = clone(value);
  delete projection.digest;
  return projection;
}

function applyReplacements(workspace, replacements) {
  const variant = clone(workspace);
  for (const replacement of replacements) {
    const repository = variant.repositories.find((entry) => entry.id === replacement.repositoryId);
    const file = repository.files.find((entry) => entry.path === replacement.path);
    const bytes = Buffer.from(replacement.replacementContentBase64, "base64");
    file.contentBase64 = bytes.toString("base64");
    file.byteLength = bytes.length;
    file.digest = sha256Bytes(bytes);
  }
  return variant;
}

function counterfactualInputDigest(workspace, replacements) {
  return sha256Canonical({
    baselineWorkspaceRootDigest: workspaceRootDigest(workspace),
    replacements: replacements.map(({ repositoryId, path, originalDigest, replacementDigest }) => ({
      repositoryId, path, originalDigest, replacementDigest
    }))
  });
}

function refreshDeclaredEvidence(evidence, workspace, forcedVerdict = "established") {
  evidence.causalContract.digest = sha256Canonical(withoutDigest(evidence.causalContract));
  const subjects = evidence.causalContract.subjectPredicates;
  const replacements = evidence.causalContract.counterfactual.replacements;
  const baselineResults = subjects.map((subject) => executeRepositoryPredicate(workspace, subject));
  const counterfactualResults = subjects.map((subject) => executeRepositoryPredicate(
    applyReplacements(workspace, replacements), subject));
  evidence.causalReplay = {
    algorithm: "registered-semantic-counterfactual-v1",
    contractDigest: evidence.causalContract.digest,
    baseline: {
      workspaceRootDigest: workspaceRootDigest(workspace),
      subjectResults: baselineResults,
      digest: ""
    },
    counterfactual: {
      replacements: clone(replacements),
      inputDigest: counterfactualInputDigest(workspace, replacements),
      subjectResults: counterfactualResults,
      digest: ""
    }
  };
  evidence.causalReplay.baseline.digest = sha256Canonical(withoutDigest(evidence.causalReplay.baseline));
  evidence.causalReplay.counterfactual.digest = sha256Canonical(withoutDigest(evidence.causalReplay.counterfactual));
  const consumed = [...new Set(baselineResults.flatMap((result) => result.consumedObjects.map((entry) => entry.digest)))].sort();
  const necessity = evidence.assertions.find((entry) => entry.type === "repository_necessity");
  necessity.verdict = forcedVerdict;
  necessity.observedObjectDigests = consumed;
  necessity.requiredDependencyRoles = ["repository_snapshot", "target_subject", "causal_contract"];
  const trace = evidence.assertions.find((entry) => entry.type === "claim_invariant_traceability");
  trace.verdict = forcedVerdict;
  trace.bindings = baselineResults.map((result) => ({
    subjectKind: result.subjectKind,
    subjectId: result.subjectId,
    subjectVersion: result.subjectVersion,
    subjectDigest: result.subjectDigest,
    predicateDigest: result.predicateDigest,
    repositoryObjectDigests: result.consumedObjects.map((entry) => entry.digest).sort()
  }));
  const governed = evidence.assertions.find((entry) => entry.type === "repository_governed_outcome");
  governed.verdict = forcedVerdict;
  governed.outcomeBindings = baselineResults.filter((result) => result.subjectKind === "outcome").map((result) => ({
    outcomeId: result.subjectId,
    outcomeVersion: result.subjectVersion,
    outcomeDigest: result.subjectDigest,
    predicateDigest: result.predicateDigest,
    governingRepositoryObjectDigests: result.consumedObjects.map((entry) => entry.digest).sort()
  }));
  const counterfactual = evidence.assertions.find((entry) => entry.type === "removal_counterfactual");
  counterfactual.verdict = forcedVerdict;
  counterfactual.interventions = clone(replacements);
  counterfactual.counterfactualInputDigest = evidence.causalReplay.counterfactual.inputDigest;
  counterfactual.baselineResult = "pass";
  counterfactual.counterfactualResult = "fail";
  counterfactual.affectedSubjectDigests = subjects.map((entry) => entry.subjectDigest);
  for (const assertion of evidence.assertions) {
    const projection = clone(assertion);
    delete projection.resultDigest;
    assertion.resultDigest = sha256Canonical(projection);
  }
  const assertionResults = evidence.assertions.map((assertion) => ({
    type: assertion.type,
    verdict: forcedVerdict,
    resultDigest: assertion.resultDigest
  }));
  const output = evidence.verifierExecution.output;
  output.overallVerdict = forcedVerdict;
  output.causalContractDigest = evidence.causalContract.digest;
  output.baselineReplayDigest = evidence.causalReplay.baseline.digest;
  output.counterfactualReplayDigest = evidence.causalReplay.counterfactual.digest;
  output.assertionResults = assertionResults;
  output.outputDigest = sha256Canonical({
    overallVerdict: output.overallVerdict,
    causalContractDigest: output.causalContractDigest,
    baselineReplayDigest: output.baselineReplayDigest,
    counterfactualReplayDigest: output.counterfactualReplayDigest,
    assertionResults
  });
  const causalInput = evidence.verifierExecution.inputs.find((entry) => entry.role === "causal_contract");
  causalInput.digest = evidence.causalContract.digest;
  evidence.verdict = forcedVerdict;
}

function buildPositive(source) {
  const workspace = buildWorkspace(source);
  const workspaceManifestDigest = sha256Canonical(workspace);
  const targetSubject = {
    id: "greeting-contract-claim",
    version: "0.1.0",
    uri: "greeting-contract-claim.json",
    digest: `sha256:${"44".repeat(32)}`
  };
  const outcome = {
    id: "workspace-change-grounding-fixture",
    version: "0.1.0",
    uri: "workspace-change-grounding-fixture.json",
    digest: `sha256:${"22".repeat(32)}`
  };
  const claim = {
    id: targetSubject.id,
    version: targetSubject.version,
    digest: targetSubject.digest
  };
  const repositorySnapshot = {
    id: workspace.id,
    version: workspace.version,
    uri: "causal-workspace-fixture.json",
    digest: workspaceManifestDigest
  };
  const dependencyManifest = {
    id: "grounding-dependency-manifest",
    version: "0.1.0",
    entries: [
      { role: "target_subject", id: targetSubject.id, version: targetSubject.version, uri: targetSubject.uri, digest: targetSubject.digest },
      { role: "repository_snapshot", scopeSliceId: "causal-slice", id: repositorySnapshot.id, version: repositorySnapshot.version, uri: repositorySnapshot.uri, digest: repositorySnapshot.digest },
      { role: "outcome_profile", scopeSliceId: "causal-slice", id: outcome.id, version: outcome.version, uri: outcome.uri, digest: outcome.digest }
    ],
    digest: ""
  };
  dependencyManifest.digest = dependencyManifestDigest(dependencyManifest);
  const scopeSlice = {
    id: "causal-slice",
    repositorySnapshot,
    outcomeProfiles: [outcome]
  };
  const files = new Map(workspace.repositories[0].files.map((file) => [file.path, file]));
  const registryExecutor = executorRegistry.executors[0];
  const executor = { id: registryExecutor.id, version: registryExecutor.version, digest: registryExecutor.digest };
  const predicateFor = (id) => {
    const predicate = {
      id,
      version: "0.1.0",
      algorithm: "json-field-equals-js-export-v1",
      parameters: {
        configFile: { repositoryId: source.id, path: "config/acceptance.json" },
        configField: "requiredGreeting",
        sourceFile: { repositoryId: source.id, path: "src/app.js" },
        exportName: "greeting"
      },
      digest: ""
    };
    predicate.digest = sha256Canonical(withoutDigest(predicate));
    return predicate;
  };
  const replacementBytes = Buffer.from("export const greeting = \"goodbye\";\n", "utf8");
  const causalContract = {
    id: "grounding-causal-contract",
    version: "0.1.0",
    algorithm: "registered-semantic-counterfactual-v1",
    subjectPredicates: [
      {
        subjectKind: "outcome",
        subjectId: outcome.id,
        subjectVersion: outcome.version,
        subjectDigest: outcome.digest,
        executor: clone(executor),
        predicate: predicateFor("workspace-change-greeting-contract")
      },
      {
        subjectKind: "claim",
        subjectId: claim.id,
        subjectVersion: claim.version,
        subjectDigest: claim.digest,
        executor: clone(executor),
        predicate: predicateFor("claim-greeting-contract")
      }
    ],
    counterfactual: {
      id: "greeting-mismatch-counterfactual",
      version: "0.1.0",
      replacements: [{
        repositoryId: source.id,
        path: "src/app.js",
        originalDigest: files.get("src/app.js").digest,
        replacementContentBase64: replacementBytes.toString("base64"),
        replacementDigest: sha256Bytes(replacementBytes)
      }]
    },
    digest: ""
  };
  causalContract.digest = sha256Canonical(withoutDigest(causalContract));
  const evidence = {
    schemaVersion: "agent-eval-repository-grounding-evidence-1",
    id: "causal-grounding-evidence",
    version: "0.1.0",
    statementId: "causal-grounding-statement",
    scopeSliceId: scopeSlice.id,
    target: "decision",
    targetSubject,
    dependencyManifestDigest: dependencyManifest.digest,
    workspaceManifest: clone(repositorySnapshot),
    subjectCoverage: {
      outcomes: [{ id: outcome.id, version: outcome.version, digest: outcome.digest }],
      claims: [{ id: claim.id, version: claim.version, digest: claim.digest }]
    },
    causalContract: clone(causalContract),
    causalReplay: {},
    verifierExecution: {
      verifier: {
        id: "repository-grounding-verifier",
        version: "0.1.0",
        uri: "../../../tools/verify-repository-grounding.mjs",
        digest: `sha256:${"33".repeat(32)}`
      },
      inputs: [
        { role: "workspace_manifest", id: repositorySnapshot.id, digest: repositorySnapshot.digest },
        { role: "target_subject", id: targetSubject.id, digest: targetSubject.digest },
        { role: "dependency_manifest", id: dependencyManifest.id, digest: dependencyManifest.digest },
        { role: "causal_contract", id: causalContract.id, digest: "" },
        { role: "outcome_subject", id: outcome.id, digest: outcome.digest },
        { role: "claim_subject", id: claim.id, digest: claim.digest },
        { role: "grounding_executor", id: executor.id, digest: executor.digest }
      ],
      output: {
        overallVerdict: "established",
        causalContractDigest: "",
        baselineReplayDigest: "",
        counterfactualReplayDigest: "",
        assertionResults: [],
        outputDigest: ""
      }
    },
    assertions: [
      {
        id: "repository-necessity",
        type: "repository_necessity",
        verdict: "established",
        observedObjectDigests: [],
        requiredDependencyRoles: ["repository_snapshot", "causal_contract"],
        resultDigest: ""
      },
      {
        id: "claim-invariant-traceability",
        type: "claim_invariant_traceability",
        verdict: "established",
        bindings: [],
        resultDigest: ""
      },
      {
        id: "repository-governed-outcome",
        type: "repository_governed_outcome",
        verdict: "established",
        outcomeBindings: [],
        resultDigest: ""
      },
      {
        id: "removal-counterfactual",
        type: "removal_counterfactual",
        verdict: "established",
        interventions: [],
        counterfactualInputDigest: `sha256:${"00".repeat(32)}`,
        baselineResult: "pass",
        counterfactualResult: "fail",
        affectedSubjectDigests: [outcome.digest, claim.digest],
        resultDigest: ""
      }
    ],
    verdict: "established"
  };
  refreshDeclaredEvidence(evidence, workspace);
  return {
    workspace,
    evidence,
    context: {
      statementId: evidence.statementId,
      target: evidence.target,
      targetSubject,
      dependencyManifest,
      scopeSlice,
      workspaceManifest: workspace,
      workspaceManifestDigest,
      verifierDigest: evidence.verifierExecution.verifier.digest,
      targetVerdict: "pass",
      groundingContract: clone(causalContract),
      executorAuthority: {
        executors: executorAuthority.executors.map((entry) => ({ ...entry }))
      }
    }
  };
}

function rebindWorkspace(bundle) {
  const { workspace, evidence, context } = bundle;
  workspace.workspaceRootDigest = workspaceRootDigest(workspace);
  const digest = sha256Canonical(workspace);
  context.workspaceManifest = workspace;
  context.workspaceManifestDigest = digest;
  context.scopeSlice.repositorySnapshot.digest = digest;
  evidence.workspaceManifest.digest = digest;
  evidence.verifierExecution.inputs.find((entry) => entry.role === "workspace_manifest").digest = digest;
  refreshDeclaredEvidence(evidence, workspace);
}

function makeNoContractDiagnostic(bundle) {
  const { evidence, context } = bundle;
  context.targetVerdict = "not_claimed";
  context.groundingContract = null;
  evidence.subjectCoverage = { outcomes: [], claims: [] };
  evidence.causalContract = null;
  evidence.causalReplay = null;
  evidence.verifierExecution.inputs = evidence.verifierExecution.inputs.filter((entry) =>
    ["workspace_manifest", "target_subject", "dependency_manifest"].includes(entry.role));
  evidence.assertions = evidence.assertions.map((assertion) => {
    const diagnostic = {
      id: assertion.id,
      type: assertion.type,
      verdict: "insufficient_evidence",
      reasonCode: "no_executable_subject_contract",
      resultDigest: ""
    };
    const projection = clone(diagnostic);
    delete projection.resultDigest;
    diagnostic.resultDigest = sha256Canonical(projection);
    return diagnostic;
  });
  const assertionResults = evidence.assertions.map((assertion) => ({
    type: assertion.type,
    verdict: "insufficient_evidence",
    resultDigest: assertion.resultDigest
  }));
  const output = {
    overallVerdict: "insufficient_evidence",
    reasonCodes: ["no_executable_subject_contract"],
    assertionResults
  };
  evidence.verifierExecution.output = { ...output, outputDigest: sha256Canonical(output) };
  evidence.verdict = "insufficient_evidence";
}

function rebindAdopterVersions(bundle) {
  const { workspace, evidence, context } = bundle;
  const versions = {
    snapshot: "snapshot-2026.08",
    target: "decision-contract-7",
    outcome: "outcome-profile-3"
  };
  workspace.version = versions.snapshot;
  context.scopeSlice.repositorySnapshot.version = versions.snapshot;
  evidence.workspaceManifest.version = versions.snapshot;

  context.targetSubject.version = versions.target;
  evidence.targetSubject.version = versions.target;
  context.scopeSlice.outcomeProfiles[0].version = versions.outcome;
  evidence.subjectCoverage.outcomes[0].version = versions.outcome;
  evidence.subjectCoverage.claims[0].version = versions.target;
  for (const contract of [context.groundingContract, evidence.causalContract]) {
    contract.subjectPredicates.find((entry) => entry.subjectKind === "outcome").subjectVersion
      = versions.outcome;
    contract.subjectPredicates.find((entry) => entry.subjectKind === "claim").subjectVersion
      = versions.target;
  }
  context.groundingContract.digest = sha256Canonical(withoutDigest(context.groundingContract));

  for (const entry of context.dependencyManifest.entries) {
    if (entry.role === "repository_snapshot") entry.version = versions.snapshot;
    if (entry.role === "target_subject") entry.version = versions.target;
    if (entry.role === "outcome_profile") entry.version = versions.outcome;
  }
  context.dependencyManifest.digest = dependencyManifestDigest(context.dependencyManifest);
  evidence.dependencyManifestDigest = context.dependencyManifest.digest;
  evidence.verifierExecution.inputs.find((entry) => entry.role === "dependency_manifest").digest
    = context.dependencyManifest.digest;
  rebindWorkspace(bundle);
}

function applyMutation(bundle, mutation, source) {
  const { workspace, evidence, context } = bundle;
  if (mutation === "none") return;
  if (mutation === "adopter_versions") {
    rebindAdopterVersions(bundle);
    return;
  }
  if (mutation === "no_contract_diagnostic") {
    makeNoContractDiagnostic(bundle);
    return;
  }
  if (mutation === "readme_passenger") {
    const readme = workspace.repositories[0].files.find((file) => file.path === "README.md");
    const bytes = Buffer.from("Attacker-selected passenger bytes.\n", "utf8");
    const passenger = {
      repositoryId: workspace.repositories[0].id,
      path: readme.path,
      originalDigest: readme.digest,
      replacementContentBase64: bytes.toString("base64"),
      replacementDigest: sha256Bytes(bytes)
    };
    context.groundingContract.counterfactual.replacements.push(passenger);
    evidence.causalContract.counterfactual.replacements.push(clone(passenger));
    refreshDeclaredEvidence(evidence, workspace);
    return;
  }
  if (mutation === "general_claim_bootstrap") {
    const general = clone(evidence.causalContract.subjectPredicates[1]);
    general.subjectId = "general-agent-productivity";
    general.subjectDigest = `sha256:${"55".repeat(32)}`;
    evidence.causalContract.subjectPredicates.push(general);
    evidence.subjectCoverage.claims.push({ id: general.subjectId, version: general.subjectVersion, digest: general.subjectDigest });
    refreshDeclaredEvidence(evidence, workspace);
    return;
  }
  if (mutation === "claim_set_missing") {
    evidence.subjectCoverage.claims = [];
    return;
  }
  if (mutation === "claim_set_extra") {
    evidence.subjectCoverage.claims.push({ id: "general-agent-productivity", version: "0.1.0", digest: `sha256:${"55".repeat(32)}` });
    return;
  }
  if (mutation === "executor_substitution") {
    evidence.causalContract.subjectPredicates[0].executor.digest = `sha256:${"66".repeat(32)}`;
    refreshDeclaredEvidence(evidence, workspace);
    return;
  }
  if (mutation === "executor_code_drift") {
    context.executorAuthority = driftedExecutorAuthority;
    return;
  }
  if (mutation === "duplicate_executor_authority") {
    context.executorAuthority.executors.push({ ...context.executorAuthority.executors[0] });
    return;
  }
  if (mutation === "wrong_selected_outcome") {
    for (const contract of [context.groundingContract, evidence.causalContract]) {
      const subject = contract.subjectPredicates.find((entry) => entry.subjectKind === "outcome");
      subject.subjectId = "unselected-outcome";
      subject.subjectDigest = `sha256:${"77".repeat(32)}`;
    }
    evidence.subjectCoverage.outcomes = [{ id: "unselected-outcome", version: "0.1.0", digest: `sha256:${"77".repeat(32)}` }];
    refreshDeclaredEvidence(evidence, workspace);
    return;
  }
  if (mutation === "omitted_selected_outcome") {
    for (const contract of [context.groundingContract, evidence.causalContract]) {
      const subject = contract.subjectPredicates.find((entry) => entry.subjectKind === "outcome");
      subject.subjectKind = "claim";
      subject.subjectId = "passenger-claim";
      subject.subjectDigest = `sha256:${"88".repeat(32)}`;
    }
    evidence.subjectCoverage.outcomes = [];
    evidence.subjectCoverage.claims.push({ id: "passenger-claim", version: "0.1.0", digest: `sha256:${"88".repeat(32)}` });
    refreshDeclaredEvidence(evidence, workspace);
    return;
  }
  if (mutation === "wrong_target_claim") {
    for (const contract of [context.groundingContract, evidence.causalContract]) {
      const subject = contract.subjectPredicates.find((entry) => entry.subjectKind === "claim");
      subject.subjectId = "different-target-claim";
      subject.subjectDigest = `sha256:${"99".repeat(32)}`;
    }
    evidence.subjectCoverage.claims = [{ id: "different-target-claim", version: "0.1.0", digest: `sha256:${"99".repeat(32)}` }];
    refreshDeclaredEvidence(evidence, workspace);
    return;
  }
  if (mutation === "availability_only") {
    const empty = Buffer.alloc(0);
    for (const contract of [context.groundingContract, evidence.causalContract]) {
      contract.counterfactual.replacements[0].replacementContentBase64 = empty.toString("base64");
      contract.counterfactual.replacements[0].replacementDigest = sha256Bytes(empty);
    }
    refreshDeclaredEvidence(evidence, workspace, "established");
    return;
  }
  if (mutation === "random_base_revision") {
    const repository = workspace.repositories[0];
    const fake = "f".repeat(40);
    repository.baseRevision = fake;
    repository.gitObjectGraph.refs[0].target = fake;
    repository.historyProjection.cutoffRevision = fake;
    repository.gitObjectGraph.digest = gitObjectGraphDigest(repository);
    repository.historyProjection.objectGraphDigest = repository.gitObjectGraph.digest;
    rebindWorkspace(bundle);
    return;
  }
  if (mutation === "unreachable_future_object") {
    const repository = workspace.repositories[0];
    const extra = objectRecord("blob", Buffer.from("future object not reachable from base\n", "utf8"));
    repository.gitObjectGraph.objects.push(extra);
    repository.gitObjectGraph.objects.sort((left, right) => lexicalCompare(left.objectId, right.objectId));
    repository.historyProjection.reachableObjectCount = repository.gitObjectGraph.objects.length;
    repository.gitObjectGraph.digest = gitObjectGraphDigest(repository);
    repository.historyProjection.objectGraphDigest = repository.gitObjectGraph.digest;
    rebindWorkspace(bundle);
    return;
  }
  if (mutation === "same_id_different_bytes") {
    const changedSource = clone(source);
    changedSource.files.find((file) => file.path === "README.md").content += "Changed bytes under the same manifest ID and version.\n";
    const changedWorkspace = buildWorkspace(changedSource);
    context.workspaceManifest = changedWorkspace;
    context.workspaceManifestDigest = sha256Canonical(changedWorkspace);
    context.scopeSlice.repositorySnapshot.digest = context.workspaceManifestDigest;
    return;
  }
  throw new Error(`Unknown mutation ${mutation}`);
}

let failures = 0;
for (const vector of fixture.vectors) {
  const bundle = buildPositive(fixture.repositorySource);
  applyMutation(bundle, vector.mutation, fixture.repositorySource);
  const workspaceSchemaValid = validateWorkspaceSchema(bundle.context.workspaceManifest);
  const groundingSchemaValid = validateGroundingSchema(bundle.evidence);
  const schemaProblems = [
    ...(workspaceSchemaValid ? [] : validateWorkspaceSchema.errors.map((error) => `workspace schema ${error.instancePath} ${error.message}`)),
    ...(groundingSchemaValid ? [] : validateGroundingSchema.errors.map((error) => `grounding schema ${error.instancePath} ${error.message}`))
  ];
  const workspaceProblems = verifyWorkspaceManifest(bundle.context.workspaceManifest);
  const groundingProblems = verifyRepositoryGroundingEvidence(bundle.evidence, bundle.context);
  const problems = [...schemaProblems, ...workspaceProblems, ...groundingProblems];
  const actualValid = problems.length === 0;
  const diagnostic = problems.join("\n");
  const matches = actualValid === vector.valid
    && (vector.valid || diagnostic.includes(vector.expectedError));
  if (!matches) {
    failures += 1;
    console.error(`${vector.id}: expected valid=${vector.valid}, found valid=${actualValid}`);
    problems.forEach((problem) => console.error(`  ${problem}`));
  }
}

if (failures > 0) {
  console.error(`grounding hardening vectors failed: ${failures}`);
  process.exitCode = 1;
} else {
  console.log(`grounding hardening vectors passed: ${fixture.vectors.length}`);
}
