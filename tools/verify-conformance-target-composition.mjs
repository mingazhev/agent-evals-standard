import { createHash, createPrivateKey, sign, verify } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

export const TARGET_SUBJECT_SCHEMAS = Object.freeze({
  suite: "urn:agent-evals-standard:schema:suite-manifest:1",
  case: "urn:agent-evals-standard:schema:case:1",
  evaluator: "urn:agent-evals-standard:schema:evaluator-manifest:1",
  experiment: "urn:agent-evals-standard:schema:pre-run-manifest:1",
  decision: "urn:agent-evals-standard:schema:governance-decision:1"
});

export async function checkEvaluatorManifest(document, sourceAbsolute, issues) {
  const owner = "evaluatorManifest";
  const components = document?.measurementComponents ?? [];
  const domains = document?.trustDomains ?? [];
  const componentIds = components.map((component) => component.id);
  const domainIds = domains.map((domain) => domain.id);
  const duplicates = (values) => [...new Set(values.filter((value, index) => values.indexOf(value) !== index))];
  for (const id of duplicates(componentIds)) issues.push(`${owner}: duplicate measurement component ${id}`);
  for (const id of duplicates(domainIds)) issues.push(`${owner}: duplicate trust domain ${id}`);
  for (const id of duplicates((document?.dataFlows ?? []).map((flow) => flow.id))) {
    issues.push(`${owner}: duplicate data flow ${id}`);
  }
  for (const id of duplicates((document?.externalDependencies ?? []).map((dependency) => dependency.id))) {
    issues.push(`${owner}: duplicate external dependency ${id}`);
  }

  const componentById = new Map(components.map((component) => [component.id, component]));
  const domainById = new Map(domains.map((domain) => [domain.id, domain]));
  const domainMembership = new Map();
  for (const domain of domains) {
    for (const componentId of domain.componentIds ?? []) {
      if (!componentById.has(componentId)) issues.push(`${owner}: trust domain ${domain.id} names unknown component ${componentId}`);
      const memberships = domainMembership.get(componentId) ?? [];
      memberships.push(domain.id);
      domainMembership.set(componentId, memberships);
    }
  }
  for (const component of components) {
    const memberships = domainMembership.get(component.id) ?? [];
    if (memberships.length !== 1 || memberships[0] !== component.trustDomainId
      || !domainById.has(component.trustDomainId)) {
      issues.push(`${owner}: component ${component.id} must belong exactly once to declared trustDomainId ${component.trustDomainId}`);
    }
    for (const dependencyId of component.dependencyIds ?? []) {
      if (!componentById.has(dependencyId)) issues.push(`${owner}: component ${component.id} has unknown dependency ${dependencyId}`);
      if (dependencyId === component.id) issues.push(`${owner}: component ${component.id} depends on itself`);
    }
  }

  for (const flow of document?.dataFlows ?? []) {
    if (!componentById.has(flow.fromComponentId)) issues.push(`${owner}: data flow ${flow.id} has unknown source ${flow.fromComponentId}`);
    if (!componentById.has(flow.toComponentId)) issues.push(`${owner}: data flow ${flow.id} has unknown destination ${flow.toComponentId}`);
  }
  for (const [contractName, binding] of Object.entries(document?.enforcementContracts ?? {})) {
    for (const componentId of binding.enforcingComponentIds ?? []) {
      const component = componentById.get(componentId);
      if (!component) {
        issues.push(`${owner}: enforcement contract ${contractName} names unknown component ${componentId}`);
        continue;
      }
      const domain = domainById.get(component.trustDomainId);
      if (domain?.kind === "evaluated_arm") {
        issues.push(`${owner}: evaluated-arm component ${componentId} cannot enforce ${contractName}`);
      }
    }
  }

  for (const requiredKind of ["runner", "event_capture", "semantic_validator", "signature_verifier"]) {
    if (!components.some((component) => component.kind === requiredKind)) {
      issues.push(`${owner}: measurement stack requires a ${requiredKind} component`);
    }
  }
  const positiveControls = document?.positiveControlRecords ?? [];
  const negativeControls = document?.negativeControlRecords ?? [];
  const controlsById = new Map();
  for (const [kind, controls] of [["positive", positiveControls], ["negative", negativeControls]]) {
    for (const control of controls) {
      const prior = controlsById.get(control.id);
      if (prior) {
        if (prior.digest !== control.digest || prior.payloadDigest !== control.payloadDigest) {
          issues.push(`${owner}: control id ${control.id} resolves to multiple digests`);
        }
        if (prior.kind !== kind) issues.push(`${owner}: control ${control.id} cannot be both positive and negative`);
      } else {
        controlsById.set(control.id, { ...control, kind });
      }
    }
  }
  const { verifyEvaluatorControls } = await import("./verify-evaluator-controls.mjs");
  const controlIssues = await verifyEvaluatorControls(document, sourceAbsolute);
  issues.push(...controlIssues.map((issue) => `${owner}: ${issue}`));
}

const TARGET_SCHEMA_VERSIONS = Object.freeze({
  suite: "agent-eval-suite-manifest-1",
  case: "agent-eval-case-1",
  evaluator: "agent-eval-evaluator-manifest-1",
  experiment: "agent-eval-pre-run-manifest-1",
  decision: "agent-eval-governance-decision-1"
});

const STATEMENT_SCHEMA = "urn:agent-evals-standard:schema:conformance-statement:1";
const ENVELOPE_SCHEMA = "urn:agent-evals-standard:schema:validation-envelope:1";
const SCORECARD_SCHEMA = "urn:agent-evals-standard:schema:scorecard:1";
const FIXTURE_ED25519_SEED = Buffer.from(
  "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
  "hex"
);
const FIXTURE_ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

function canonicalize(value) {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("non-finite JSON number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}

function sha256Bytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function sha256Canonical(value) {
  return sha256Bytes(Buffer.from(canonicalize(value), "utf8"));
}

function clone(value) {
  return structuredClone(value);
}

function resealFixtureStatement(document) {
  const signature = document?.signature;
  if (signature?.profileId !== "fixture-signature-profile"
    || signature?.algorithm !== "Ed25519"
    || signature?.keyId !== "rfc8032-test-key-1") {
    throw new Error("reseal requested for a non-fixture statement");
  }
  const projection = clone(document);
  delete projection.signature.value;
  const message = Buffer.concat([
    Buffer.from(document.schemaVersion, "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalize(projection), "utf8")
  ]);
  const privateKey = createPrivateKey({
    key: Buffer.concat([FIXTURE_ED25519_PKCS8_PREFIX, FIXTURE_ED25519_SEED]),
    format: "der",
    type: "pkcs8"
  });
  document.signature.value = sign(null, message, privateKey).toString("base64url");
}

function targetDocumentId(document, targetType) {
  const fields = {
    suite: ["id", "suiteId"],
    case: ["id", "caseId"],
    evaluator: ["id", "evaluatorId", "implementationId"],
    experiment: ["id", "experimentId", "runId"],
    decision: ["id", "decisionId"]
  }[targetType] ?? ["id"];
  return fields.map((field) => document?.[field]).find((value) => typeof value === "string") ?? null;
}

function targetDocumentVersion(document, targetType) {
  if (targetType === "case") return document?.caseVersion ?? document?.version ?? null;
  return document?.version ?? null;
}

function normalizedPath(candidate) {
  return path.resolve(candidate).toLowerCase();
}

function resolveWithin(baseDirectory, uri, root) {
  if (typeof uri !== "string" || uri.length === 0 || uri.startsWith("artifact:")) {
    throw new Error(`non-resolvable URI ${String(uri)}`);
  }
  const absolute = path.resolve(baseDirectory, uri);
  if (root) {
    const rootPath = normalizedPath(root);
    const candidate = normalizedPath(absolute);
    if (candidate !== rootPath && !candidate.startsWith(`${rootPath}${path.sep}`)) {
      throw new Error(`path escapes repository root: ${uri}`);
    }
  }
  return absolute;
}

async function resolveJsonPointer(pointer, baseDirectory, root, owner, issues, rawDigestField = "digest") {
  try {
    const absolute = resolveWithin(baseDirectory, pointer?.uri, root);
    const bytes = await readFile(absolute);
    const actualDigest = sha256Bytes(bytes);
    if (pointer?.[rawDigestField] !== actualDigest) {
      issues.push(`${owner}: ${rawDigestField} must be ${actualDigest}`);
    }
    return { absolute, bytes, document: JSON.parse(bytes.toString("utf8")), actualDigest };
  } catch (error) {
    issues.push(`${owner}: cannot resolve ${pointer?.uri ?? "missing URI"}: ${error.message}`);
    return null;
  }
}

async function validateSchema(schemaId, document, absolute, owner, issues, options) {
  if (typeof options.validateSchema !== "function") {
    issues.push(`${owner}: no schema validator was supplied for ${schemaId}`);
    return;
  }
  const result = await options.validateSchema(schemaId, document, absolute);
  if (result === true || result === undefined || result === null) return;
  const detail = typeof result === "string" ? result : canonicalize(result);
  issues.push(`${owner}: schema ${schemaId} rejected subject: ${detail}`);
}

async function verifySigned(document, absolute, owner, issues, options) {
  if (typeof options.verifySignedArtifact === "function") {
    const result = await options.verifySignedArtifact(document, absolute);
    if (result === true || result === undefined || result === null) return;
    issues.push(`${owner}: signature/trust verification failed: ${String(result)}`);
    return;
  }
  if (!options.fixturePublicKey) {
    issues.push(`${owner}: no signature/trust verifier was supplied`);
    return;
  }
  const signature = document?.signature;
  if (signature?.profileId !== "fixture-signature-profile"
    || signature?.algorithm !== "Ed25519"
    || signature?.keyId !== "rfc8032-test-key-1"
    || typeof signature?.value !== "string") {
    issues.push(`${owner}: fixture signature metadata is invalid`);
    return;
  }
  const projection = clone(document);
  delete projection.signature.value;
  const message = Buffer.concat([
    Buffer.from(document.schemaVersion, "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalize(projection), "utf8")
  ]);
  try {
    if (!verify(null, message, options.fixturePublicKey, Buffer.from(signature.value, "base64url"))) {
      issues.push(`${owner}: Ed25519 verification failed`);
    }
  } catch (error) {
    issues.push(`${owner}: signature verifier error: ${error.message}`);
  }
}

async function authenticateTargetSubject(document, absolute, owner, issues, options) {
  if (typeof options.authenticateTargetSubject === "function") {
    const result = await options.authenticateTargetSubject(document, absolute);
    if (result === true || result === undefined || result === null) return;
    issues.push(`${owner}: target-subject authentication failed: ${String(result)}`);
    return;
  }
  await verifySigned(document, absolute, owner, issues, options);
}

function checkCanonicalSelfDigest(document, owner, issues) {
  const projection = clone(document);
  delete projection.digest;
  delete projection.signature;
  const expected = sha256Canonical(projection);
  if (document?.digest !== expected) {
    issues.push(`${owner}: canonical self digest must be ${expected}`);
  }
  return expected;
}

async function validateScorecardSemantics(document, absolute, owner, issues, options) {
  if (typeof options.validateScorecardSemantics !== "function") {
    issues.push(`${owner}: no scorecard semantic validator was supplied`);
    return;
  }
  const nestedIssues = [];
  try {
    const result = await options.validateScorecardSemantics(document, absolute, nestedIssues);
    if (result !== true && result !== undefined && result !== null) {
      nestedIssues.push(typeof result === "string" ? result : canonicalize(result));
    }
  } catch (error) {
    nestedIssues.push(`validator error: ${error.message}`);
  }
  for (const issue of nestedIssues) issues.push(`${owner}: scorecard semantics: ${issue}`);
}

function equalCanonical(left, right) {
  return canonicalize(left) === canonicalize(right);
}

function pointerBinding(pointer) {
  return {
    id: pointer?.id,
    version: pointer?.version,
    uri: pointer?.uri,
    digest: pointer?.digest
  };
}

function scopeCompatibilityProblem(containerScope, dependencyScope) {
  if (!containerScope || !dependencyScope) return null;
  if (containerScope.applicabilityBoundary !== dependencyScope.applicabilityBoundary) {
    return "applicability boundary differs";
  }
  const containerById = new Map((containerScope.slices ?? []).map((slice) => [slice.id, slice]));
  for (const dependencySlice of dependencyScope.slices ?? []) {
    const containerSlice = containerById.get(dependencySlice.id);
    if (!containerSlice || !equalCanonical(containerSlice, dependencySlice)) {
      return `scope slice ${dependencySlice.id} is absent or differs`;
    }
  }
  return null;
}

async function checkConformanceDependency(entry, container, baseDirectory, issues, options) {
  const owner = `targetComposition ${entry.targetType} dependency ${entry.targetSubject?.id ?? "unknown"}`;
  const expectedSchema = TARGET_SUBJECT_SCHEMAS[entry.targetType];
  if (!expectedSchema || entry.subjectSchema !== expectedSchema) {
    issues.push(`${owner}: subjectSchema must be ${expectedSchema ?? "a known target schema"}`);
  }

  const targetResolved = await resolveJsonPointer(entry.targetSubject, baseDirectory, options.root, `${owner} targetSubject`, issues);
  if (targetResolved) {
    if (targetResolved.document.schemaVersion !== TARGET_SCHEMA_VERSIONS[entry.targetType]) {
      issues.push(`${owner}: resolved target schemaVersion must be ${TARGET_SCHEMA_VERSIONS[entry.targetType]}`);
    }
    if (targetDocumentId(targetResolved.document, entry.targetType) !== entry.targetSubject.id) {
      issues.push(`${owner}: targetSubject.id differs from resolved subject identity`);
    }
    const resolvedVersion = targetDocumentVersion(targetResolved.document, entry.targetType);
    if (resolvedVersion !== entry.targetSubject.version) {
      issues.push(`${owner}: targetSubject.version differs from resolved subject version`);
    }
    await validateSchema(expectedSchema, targetResolved.document, targetResolved.absolute, owner, issues, options);
    await authenticateTargetSubject(targetResolved.document, targetResolved.absolute, owner, issues, options);
  }

  if (entry.statement?.subjectSchema !== STATEMENT_SCHEMA) {
    issues.push(`${owner}: statement subjectSchema must be ${STATEMENT_SCHEMA}`);
  }
  const statementResolved = await resolveJsonPointer(entry.statement, baseDirectory, options.root, `${owner} statement`, issues);
  let statement = null;
  if (statementResolved) {
    statement = statementResolved.document;
    if (statement.id !== entry.statement.id) {
      issues.push(`${owner}: statement pointer ID differs from resolved statement ID`);
    }
    await validateSchema(STATEMENT_SCHEMA, statement, statementResolved.absolute, `${owner} statement`, issues, options);
    await verifySigned(statement, statementResolved.absolute, `${owner} statement`, issues, options);
    const result = statement.targetEvidence?.[entry.targetType];
    if (statement.schemaVersion !== "agent-eval-conformance-statement-1"
      || statement.claim !== entry.targetType
      || result?.targetType !== entry.targetType
      || result?.targetId !== entry.targetSubject.id
      || result?.subjectSchema !== entry.subjectSchema
      || result?.verdict !== "conforming"
      || !equalCanonical(pointerBinding(result?.targetSubject), pointerBinding(entry.targetSubject))) {
      issues.push(`${owner}: dependency statement does not make the exact conforming target claim`);
    }
    if (container.standardRelease && !equalCanonical(container.standardRelease, statement.standardRelease)) {
      issues.push(`${owner}: dependency statement standardRelease differs from containing statement`);
    }
    const scopeProblem = scopeCompatibilityProblem(container.scope, statement.scope);
    if (scopeProblem) issues.push(`${owner}: dependency scope is incompatible: ${scopeProblem}`);
    if (container.issuedAt && statement.issuedAt && statement.reviewAt) {
      const containingIssue = Date.parse(container.issuedAt);
      if (!(Date.parse(statement.issuedAt) <= containingIssue && containingIssue < Date.parse(statement.reviewAt))) {
        issues.push(`${owner}: dependency statement is not valid at containing issue time`);
      }
    }
    if (statement.id === container.id) issues.push(`${owner}: conformance dependency cycle references the containing statement`);
  }

  if (entry.validationEnvelope?.subjectSchema !== ENVELOPE_SCHEMA) {
    issues.push(`${owner}: validationEnvelope subjectSchema must be ${ENVELOPE_SCHEMA}`);
  }
  const envelopeResolved = await resolveJsonPointer(entry.validationEnvelope, baseDirectory, options.root, `${owner} validationEnvelope`, issues);
  if (envelopeResolved && statement) {
    const envelope = envelopeResolved.document;
    if (envelope.envelopeId !== entry.validationEnvelope.id) {
      issues.push(`${owner}: validation-envelope pointer ID differs from resolved envelope ID`);
    }
    await validateSchema(ENVELOPE_SCHEMA, envelope, envelopeResolved.absolute, `${owner} validationEnvelope`, issues, options);
    await verifySigned(envelope, envelopeResolved.absolute, `${owner} validationEnvelope`, issues, options);
    const projection = clone(statement);
    delete projection.digest;
    delete projection.signature;
    const expectedDigest = sha256Canonical(projection);
    const statementResult = statement.targetEvidence?.[entry.targetType];
    if (envelope.schemaVersion !== "agent-eval-validation-envelope-1"
      || envelope.subject?.type !== "conformance_statement"
      || envelope.subject?.id !== statement.id
      || envelope.subject?.claimTarget !== entry.targetType
      || envelope.subject?.projection !== "full_document_without_digest_and_signature"
      || envelope.subject?.digest !== expectedDigest
      || envelope.result !== "pass") {
      issues.push(`${owner}: detached envelope does not cryptographically bind a passing validation of the dependency statement`);
    }
    if (envelope.subject?.targetSubject
      && !equalCanonical(pointerBinding(envelope.subject.targetSubject), pointerBinding(entry.targetSubject))) {
      issues.push(`${owner}: detached envelope targetSubject differs from dependency target`);
    }
    if (envelope.subject?.dependencyManifest && statementResult?.dependencyManifest
      && !equalCanonical(envelope.subject.dependencyManifest, statementResult.dependencyManifest)) {
      issues.push(`${owner}: detached envelope dependencyManifest differs from dependency statement`);
    }
  }

  return { targetDocument: targetResolved?.document ?? null, statement };
}

async function checkDecisionScorecards(targetDocument, entries, baseDirectory, issues, options, requireComplete) {
  const expected = new Map((targetDocument?.scorecards ?? []).map((entry) => [entry.id, entry]));
  const actual = new Map();
  for (const entry of entries) {
    const owner = `targetComposition scorecard ${entry.id ?? "unknown"}`;
    if (actual.has(entry.id)) issues.push(`${owner}: duplicate scorecard dependency`);
    actual.set(entry.id, entry);
    if (entry.subjectSchema !== SCORECARD_SCHEMA) issues.push(`${owner}: subjectSchema must be ${SCORECARD_SCHEMA}`);
    const declared = expected.get(entry.id);
    if (!declared || declared.digest !== entry.subjectDigest) {
      issues.push(`${owner}: scorecard is not an exact subject-digest dependency of the decision`);
    }
    const resolved = await resolveJsonPointer(entry, baseDirectory, options.root, owner, issues, "rawDigest");
    if (!resolved) continue;
    if (resolved.document.schemaVersion !== "agent-eval-scorecard-1") {
      issues.push(`${owner}: resolved scorecard schemaVersion is invalid`);
    }
    if (resolved.document.digest !== entry.subjectDigest) {
      issues.push(`${owner}: resolved scorecard canonical digest differs from subjectDigest`);
    }
    await validateSchema(SCORECARD_SCHEMA, resolved.document, resolved.absolute, owner, issues, options);
    checkCanonicalSelfDigest(resolved.document, owner, issues);
    await verifySigned(resolved.document, resolved.absolute, owner, issues, options);
    await validateScorecardSemantics(resolved.document, resolved.absolute, owner, issues, options);
  }
  if (requireComplete) {
    const expectedIds = [...expected.keys()].sort();
    const actualIds = [...actual.keys()].sort();
    if (!equalCanonical(expectedIds, actualIds)) {
      issues.push(`targetComposition decision scorecard dependencies must equal [${expectedIds.join(", ")}]`);
    }
  }
}

export async function checkConformanceTargetComposition(document, sourceAbsolute, issues, options = {}) {
  const claim = document?.claim;
  const target = document?.targetEvidence?.[claim];
  const owner = `targetComposition ${claim ?? "unknown"}`;
  await validateSchema(STATEMENT_SCHEMA, document, sourceAbsolute, `${owner} statement`, issues, options);
  await verifySigned(document, sourceAbsolute, `${owner} statement`, issues, options);
  if (!TARGET_SUBJECT_SCHEMAS[claim] || !target) {
    issues.push(`${owner}: one known claim target is required`);
    return;
  }
  const expectedSchema = TARGET_SUBJECT_SCHEMAS[claim];
  if (target.subjectSchema !== expectedSchema) {
    issues.push(`${owner}: subjectSchema must be ${expectedSchema}`);
  }
  const baseDirectory = path.dirname(sourceAbsolute);
  const targetResolved = await resolveJsonPointer(target.targetSubject, baseDirectory, options.root, `${owner} targetSubject`, issues);
  if (!targetResolved) return;
  if (targetResolved.document.schemaVersion !== TARGET_SCHEMA_VERSIONS[claim]) {
    issues.push(`${owner}: resolved target schemaVersion must be ${TARGET_SCHEMA_VERSIONS[claim]}`);
  }
  if (targetDocumentId(targetResolved.document, claim) !== target.targetId
    || target.targetSubject.id !== target.targetId) {
    issues.push(`${owner}: targetId, targetSubject.id, and resolved subject identity must match`);
  }
  const resolvedVersion = targetDocumentVersion(targetResolved.document, claim);
  if (resolvedVersion !== target.targetSubject.version) {
    issues.push(`${owner}: targetSubject.version differs from resolved subject version`);
  }
  await validateSchema(expectedSchema, targetResolved.document, targetResolved.absolute, owner, issues, options);
  await authenticateTargetSubject(targetResolved.document, targetResolved.absolute, owner, issues, options);

  const dependencyManifest = target.dependencyManifest;
  if (!dependencyManifest || !Array.isArray(dependencyManifest.entries)) {
    issues.push(`${owner}: dependencyManifest is required`);
    return;
  }
  const expectedManifestDigest = sha256Canonical({
    id: dependencyManifest.id,
    version: dependencyManifest.version,
    entries: dependencyManifest.entries
  });
  if (dependencyManifest.digest !== expectedManifestDigest) {
    issues.push(`${owner}: dependencyManifest digest must be ${expectedManifestDigest}`);
  }

  const conformanceEntries = dependencyManifest.entries.filter((entry) => entry.role === "conformance_dependency");
  const scorecardEntries = dependencyManifest.entries.filter((entry) => entry.role === "target_artifact" && entry.artifactType === "scorecard");
  const requireCompletePrerequisites = target.verdict === "conforming";
  const seen = new Set();
  const resolvedDependencies = [];
  for (const entry of conformanceEntries) {
    const key = `${entry.targetType}:${entry.targetSubject?.id}`;
    if (seen.has(key)) issues.push(`${owner}: duplicate conformance dependency ${key}`);
    seen.add(key);
    resolvedDependencies.push({ entry, resolved: await checkConformanceDependency(entry, document, baseDirectory, issues, options) });
  }

  if (["suite", "case", "evaluator"].includes(claim)) {
    if (conformanceEntries.length !== 0 || scorecardEntries.length !== 0) {
      issues.push(`${owner}: base targets must not contain prerequisite conformance or scorecard dependencies`);
    }
  } else if (claim === "experiment") {
    const suiteEntries = conformanceEntries.filter((entry) => entry.targetType === "suite");
    const evaluatorEntries = conformanceEntries.filter((entry) => entry.targetType === "evaluator");
    const caseEntries = conformanceEntries.filter((entry) => entry.targetType === "case");
    const unexpectedEntries = conformanceEntries.filter((entry) => !["suite", "evaluator", "case"].includes(entry.targetType));
    if (unexpectedEntries.length > 0) issues.push(`${owner}: experiment contains an unsupported conformance dependency`);
    if (requireCompletePrerequisites && suiteEntries.length !== 1) {
      issues.push(`${owner}: experiment requires exactly one suite conformance dependency`);
    } else if (!requireCompletePrerequisites && suiteEntries.length > 1) {
      issues.push(`${owner}: experiment may declare at most one suite conformance dependency while not conforming`);
    }
    if (requireCompletePrerequisites && evaluatorEntries.length !== 1) {
      issues.push(`${owner}: experiment requires exactly one evaluator conformance dependency`);
    } else if (!requireCompletePrerequisites && evaluatorEntries.length > 1) {
      issues.push(`${owner}: experiment may declare at most one evaluator conformance dependency while not conforming`);
    }
    const resolvedDependency = (entry) => resolvedDependencies.find((candidate) => candidate.entry === entry)?.resolved;
    const dependencySubjectDigest = (entry) => resolvedDependency(entry)?.targetDocument?.digest
      ?? entry?.targetSubject?.digest;
    const sealedSuite = targetResolved.document.suite;
    if (suiteEntries[0] && (!sealedSuite
      || suiteEntries[0].targetSubject?.id !== sealedSuite.id
      || (sealedSuite.version !== undefined && suiteEntries[0].targetSubject?.version !== sealedSuite.version)
      || dependencySubjectDigest(suiteEntries[0]) !== sealedSuite.digest)) {
      issues.push(`${owner}: suite dependency differs from the sealed experiment suite`);
    }
    const sealedEvaluator = targetResolved.document.evaluator;
    if (!sealedEvaluator) {
      issues.push(`${owner}: sealed experiment evaluator is missing`);
    } else if (evaluatorEntries[0] && (evaluatorEntries[0].targetSubject?.id !== sealedEvaluator.id
      || evaluatorEntries[0].targetSubject?.version !== sealedEvaluator.version
      || dependencySubjectDigest(evaluatorEntries[0]) !== sealedEvaluator.digest)) {
      issues.push(`${owner}: evaluator dependency differs from the sealed experiment evaluator`);
    }
    const expectedCases = new Map();
    for (const sealedCase of targetResolved.document.caseSet ?? []) {
      if (expectedCases.has(sealedCase.id)) issues.push(`${owner}: sealed caseSet contains duplicate case ${sealedCase.id}`);
      expectedCases.set(sealedCase.id, sealedCase);
    }
    const expectedCaseIds = [...expectedCases.keys()].sort();
    const actualCaseIds = caseEntries.map((entry) => entry.targetSubject?.id).sort();
    if (requireCompletePrerequisites && !equalCanonical(expectedCaseIds, actualCaseIds)) {
      issues.push(`${owner}: case dependencies must equal sealed caseSet [${expectedCaseIds.join(", ")}]`);
    } else if (!requireCompletePrerequisites
      && actualCaseIds.some((id) => !expectedCaseIds.includes(id))) {
      issues.push(`${owner}: diagnostic experiment dependency names a case outside the sealed caseSet`);
    }
    for (const entry of caseEntries) {
      const sealedCase = expectedCases.get(entry.targetSubject?.id);
      if (sealedCase && ((sealedCase.version !== undefined && entry.targetSubject?.version !== sealedCase.version)
        || dependencySubjectDigest(entry) !== sealedCase.digest)) {
        issues.push(`${owner}: case dependency ${entry.targetSubject.id} differs from the sealed caseSet`);
      }
    }
    if (scorecardEntries.length !== 0) issues.push(`${owner}: experiment must not contain decision scorecard dependencies`);
  } else if (claim === "decision") {
    const experimentEntries = conformanceEntries.filter((entry) => entry.targetType === "experiment");
    if (requireCompletePrerequisites && (conformanceEntries.length !== 1 || experimentEntries.length !== 1)) {
      issues.push(`${owner}: decision requires exactly one experiment conformance dependency`);
    } else if (!requireCompletePrerequisites
      && (experimentEntries.length > 1 || conformanceEntries.length !== experimentEntries.length)) {
      issues.push(`${owner}: diagnostic decision may declare at most one experiment conformance dependency and no other conformance target`);
    }
    await checkDecisionScorecards(
      targetResolved.document,
      scorecardEntries,
      baseDirectory,
      issues,
      options,
      requireCompletePrerequisites
    );
    const experimentDependency = resolvedDependencies.find(({ entry }) => entry.targetType === "experiment")?.resolved?.targetDocument;
    if (experimentDependency) {
      const manifestDigest = experimentDependency.digest;
      for (const scorecardEntry of scorecardEntries) {
        const scorecardResolved = await resolveJsonPointer(scorecardEntry, baseDirectory, options.root,
          `${owner} scorecard experiment binding`, [], "rawDigest");
        if (manifestDigest && scorecardResolved?.document?.experiment?.manifestDigest !== manifestDigest) {
          issues.push(`${owner}: scorecard ${scorecardEntry.id} does not bind the prerequisite experiment manifest digest`);
        }
      }
    }
  }
}

function applyMutation(document, pointer, value) {
  const parts = pointer.split("/").slice(1).map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
  let cursor = document;
  for (const part of parts.slice(0, -1)) cursor = cursor[Array.isArray(cursor) ? Number(part) : part];
  const last = parts.at(-1);
  if (value === undefined) {
    if (Array.isArray(cursor)) cursor.splice(Number(last), 1);
    else delete cursor[last];
  } else {
    cursor[Array.isArray(cursor) ? Number(last) : last] = value;
  }
}

export async function runConformanceTargetCompositionVectors(vectorPath, options = {}) {
  const absoluteVectorPath = path.resolve(vectorPath);
  const vectorSet = JSON.parse(await readFile(absoluteVectorPath, "utf8"));
  const baseDirectory = path.dirname(absoluteVectorPath);
  const fixturePublicKey = options.fixturePublicKey
    ?? await readFile(path.resolve(baseDirectory, vectorSet.fixturePublicKey), "utf8");
  const failures = [];
  let passed = 0;
  for (const vector of vectorSet.vectors ?? []) {
    const documentPath = path.resolve(baseDirectory, vector.documentPath);
    const document = JSON.parse(await readFile(documentPath, "utf8"));
    for (const mutation of vector.mutations ?? []) applyMutation(document, mutation.pointer, mutation.value);
    if (vector.reseal === true) resealFixtureStatement(document);
    const issues = [];
    const checkerOptions = {
      root: options.root ?? path.resolve(baseDirectory, "../.."),
      fixturePublicKey,
      validateSchema: options.validateSchema ?? (() => true),
      authenticateTargetSubject: options.authenticateTargetSubject ?? (() => true),
      validateScorecardSemantics: options.validateScorecardSemantics ?? ((scorecard, _absolute, semanticIssues) => {
        if (scorecard?.schemaVersion !== "agent-eval-scorecard-1"
          || typeof scorecard?.experiment?.id !== "string"
          || typeof scorecard?.experiment?.manifestDigest !== "string") {
          semanticIssues.push("compact composition scorecard projection is incomplete");
        }
      })
    };
    if (vector.kind === "scorecard_authentication") {
      await validateSchema(SCORECARD_SCHEMA, document, documentPath,
        "targetComposition scorecard authentication", issues, checkerOptions);
      checkCanonicalSelfDigest(document, "targetComposition scorecard authentication", issues);
      await verifySigned(document, documentPath,
        "targetComposition scorecard authentication", issues, checkerOptions);
      await validateScorecardSemantics(document, documentPath,
        "targetComposition scorecard authentication", issues, checkerOptions);
    } else {
      await checkConformanceTargetComposition(document, documentPath, issues, checkerOptions);
    }
    const accepted = vector.valid ? issues.length === 0 : issues.some((issue) => issue.includes(vector.expectedError));
    if (accepted) passed += 1;
    else failures.push(`${vector.id}: ${issues.length ? issues.join(" | ") : "unexpectedly accepted"}`);
  }
  return { passed, total: vectorSet.vectors?.length ?? 0, failures };
}

const isDirect = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isDirect) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const vectorPath = process.argv[2]
    ?? path.resolve(here, "../conformance/fixtures/target-composition-vectors.json");
  const result = await runConformanceTargetCompositionVectors(vectorPath);
  if (result.failures.length) {
    process.stderr.write(`Conformance target composition vectors failed (${result.failures.length}):\n`);
    result.failures.forEach((failure) => process.stderr.write(`- ${failure}\n`));
    process.exit(1);
  }
  process.stdout.write(`Conformance target composition unit vectors passed: ${result.passed}/${result.total}.\n`);
}
