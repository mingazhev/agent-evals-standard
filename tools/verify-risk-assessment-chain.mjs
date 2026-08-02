import { createHash, verify } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultVectorsPath = path.join(repositoryRoot, "conformance", "fixtures", "risk-assessment", "vectors.json");
const tierOrder = ["low", "medium", "high", "critical"];

export function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}

export function sha256Canonical(value) {
  return `sha256:${createHash("sha256").update(Buffer.from(canonicalize(value), "utf8")).digest("hex")}`;
}

function clone(value) {
  return structuredClone(value);
}

function pointerIdentity(pointer) {
  return pointer && `${pointer.id}\0${pointer.version}\0${pointer.digest}`;
}

function exactSet(values) {
  return [...new Set(values ?? [])].sort().join("\0");
}

function add(issues, condition, message) {
  if (!condition) issues.push(message);
}

export function deriveEffectiveRiskTier(assessment) {
  const factors = assessment?.factors;
  if (!factors) return null;
  const candidates = [
    ...(factors.inherentHazards ?? []).map((hazard) => hazard.tier),
    factors.dataSensitivityAndAssets?.tier,
    factors.autonomyPermissionsToolsAndReversibility?.tier,
    factors.executionAndDeploymentEnvironment?.tier,
    factors.scopeBlastRadiusExposureAndOversight?.tier,
    factors.likelihoodAndUncertainty?.tier
  ];
  if (factors.likelihoodAndUncertainty?.uncertainty === "crosses_tier_boundary") {
    candidates.push(factors.likelihoodAndUncertainty.upperApplicableTier);
  }
  const ranks = candidates.map((tier) => tierOrder.indexOf(tier));
  if (ranks.length === 0 || ranks.some((rank) => rank < 0)) return null;
  return tierOrder[Math.max(...ranks)];
}

function signedArtifactIssues(document, publicKey, owner) {
  const issues = [];
  const signature = document?.signature;
  if (!signature) return [`${owner}: missing signature`];
  if (typeof document.digest === "string") {
    const projection = clone(document);
    delete projection.digest;
    delete projection.signature;
    add(issues, document.digest === sha256Canonical(projection), `${owner}: self digest mismatch`);
  }
  add(issues,
    signature.profileId === "fixture-signature-profile"
      && signature.algorithm === "Ed25519"
      && signature.keyId === "rfc8032-test-key-1",
    `${owner}: unrecognized fixture signature identity`);
  if (issues.length === 0) {
    const projection = clone(document);
    delete projection.signature.value;
    const message = Buffer.concat([
      Buffer.from(document.schemaVersion, "utf8"),
      Buffer.from([0]),
      Buffer.from(canonicalize(projection), "utf8")
    ]);
    add(issues,
      verify(null, message, publicKey, Buffer.from(signature.value, "base64url")),
      `${owner}: signature verification failed`);
  }
  return issues;
}

export function riskAssessmentIssues(assessment, validateSchema, publicKey, owner = "risk assessment") {
  const issues = [];
  if (!validateSchema(assessment)) {
    issues.push(`${owner}: schema invalid: ${validateSchema.errors.map((entry) => `${entry.instancePath || "/"} ${entry.message}`).join("; ")}`);
    return issues;
  }
  add(issues,
    assessment.derivation.factorInputDigest === sha256Canonical(assessment.factors),
    `${owner}: factorInputDigest does not authenticate the complete factors object`);

  const uncertainty = assessment.factors.likelihoodAndUncertainty;
  const lower = tierOrder.indexOf(uncertainty.tier);
  const upper = tierOrder.indexOf(uncertainty.upperApplicableTier);
  add(issues, upper >= lower, `${owner}: uncertainty upperApplicableTier is below its factor tier`);
  if (uncertainty.uncertainty === "bounded_within_tier") {
    add(issues, upper === lower, `${owner}: bounded uncertainty must remain within one tier`);
  } else {
    add(issues, upper > lower, `${owner}: boundary-crossing uncertainty must name a higher applicable tier`);
  }

  const derived = deriveEffectiveRiskTier(assessment);
  add(issues, derived !== null, `${owner}: cannot derive an effective risk tier`);
  add(issues,
    assessment.effectiveRiskTier === derived,
    `${owner}: effectiveRiskTier must be ${derived}, found ${assessment.effectiveRiskTier}`);
  issues.push(...signedArtifactIssues(assessment, publicKey, owner));
  return issues;
}

export function riskChainIssues({
  caseRiskAssessment,
  caseDocument,
  experimentRiskAssessment,
  preRun,
  scorecard,
  governanceDecision,
  eligibleRiskRanges = new Map(),
  validateRiskSchema,
  publicKey
}) {
  const issues = [
    ...riskAssessmentIssues(caseRiskAssessment, validateRiskSchema, publicKey, "case risk assessment"),
    ...riskAssessmentIssues(experimentRiskAssessment, validateRiskSchema, publicKey, "experiment risk assessment")
  ];

  add(issues, caseRiskAssessment.assessmentKind === "case_inherent_hazard",
    "case risk assessment: assessmentKind must be case_inherent_hazard");
  add(issues, pointerIdentity(caseDocument.inherentRiskAssessment) === pointerIdentity(caseRiskAssessment),
    "case: inherentRiskAssessment identity differs from the authenticated risk record");
  add(issues, caseDocument.inherentRiskTier === caseRiskAssessment.effectiveRiskTier,
    "case: inherentRiskTier differs from the authenticated risk record");
  add(issues, exactSet(caseRiskAssessment.scope.caseIds) === exactSet([caseDocument.id]),
    "case risk assessment: case scope differs from the bound case");

  add(issues, experimentRiskAssessment.assessmentKind === "experiment_decision_envelope",
    "experiment risk assessment: assessmentKind must be experiment_decision_envelope");
  add(issues, pointerIdentity(preRun.riskAssessment) === pointerIdentity(experimentRiskAssessment),
    "pre-run: riskAssessment identity differs from the authenticated experiment risk record");
  add(issues, preRun.effectiveRiskTier === experimentRiskAssessment.effectiveRiskTier,
    "pre-run: effectiveRiskTier differs from the authenticated experiment risk record");
  add(issues,
    exactSet(experimentRiskAssessment.scope.caseIds) === exactSet((preRun.caseSet ?? []).map((entry) => entry.id)),
    "experiment risk assessment: case scope differs from the sealed case set");
  add(issues,
    exactSet(experimentRiskAssessment.scope.armIds) === exactSet((preRun.arms ?? []).map((entry) => entry.id)),
    "experiment risk assessment: arm scope differs from the sealed arms");
  add(issues,
    experimentRiskAssessment.scope.decisionEnvelopeId === preRun.decisionPlan?.id,
    "experiment risk assessment: decision envelope differs from the sealed decision plan");
  for (const binding of preRun.caseProfiles ?? []) {
    const eligible = eligibleRiskRanges.get(binding.evaluationProfile?.id);
    add(issues, Array.isArray(eligible) && eligible.includes(preRun.effectiveRiskTier),
      `pre-run: effectiveRiskTier ${preRun.effectiveRiskTier} is outside profile ${binding.evaluationProfile?.id ?? "unknown"} eligibility`);
  }

  add(issues, scorecard.experiment.manifestDigest === preRun.digest,
    "scorecard: manifestDigest differs from the sealed pre-run manifest");
  add(issues, pointerIdentity(scorecard.experiment.riskAssessment) === pointerIdentity(preRun.riskAssessment),
    "scorecard: riskAssessment identity differs from the sealed pre-run manifest");
  add(issues, scorecard.experiment.effectiveRiskTier === preRun.effectiveRiskTier,
    "scorecard: effectiveRiskTier differs from the sealed pre-run manifest");
  add(issues, (scorecard.experiment.effectiveRiskRange ?? []).includes(scorecard.experiment.effectiveRiskTier),
    "scorecard: actual effectiveRiskTier is outside the declared profile eligibility range");

  add(issues, pointerIdentity(governanceDecision.riskAssessment) === pointerIdentity(preRun.riskAssessment),
    "governance decision: riskAssessment identity differs from the sealed pre-run manifest");
  add(issues, governanceDecision.effectiveRiskTier === preRun.effectiveRiskTier,
    "governance decision: effectiveRiskTier differs from the sealed pre-run manifest");
  add(issues, (governanceDecision.scorecards ?? []).some((entry) => entry.digest === scorecard.digest),
    "governance decision: no bound scorecard authenticates the evaluated scorecard digest");

  issues.push(...signedArtifactIssues(caseDocument, publicKey, "case"));
  issues.push(...signedArtifactIssues(preRun, publicKey, "pre-run"));
  issues.push(...signedArtifactIssues(scorecard, publicKey, "scorecard"));
  issues.push(...signedArtifactIssues(governanceDecision, publicKey, "governance decision"));
  return issues;
}

function setPointer(document, pointer, value) {
  const segments = pointer.split("/").slice(1).map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
  let cursor = document;
  for (const segment of segments.slice(0, -1)) cursor = cursor[segment];
  cursor[segments.at(-1)] = value;
}

async function loadJson(absolute) {
  return JSON.parse(await readFile(absolute, "utf8"));
}

async function main() {
  const vectorsPath = path.resolve(process.argv[2] ?? defaultVectorsPath);
  const vectors = await loadJson(vectorsPath);
  const baseDirectory = path.dirname(vectorsPath);
  const signatureSchema = await loadJson(path.join(repositoryRoot, "schemas", "signature-profile.schema.json"));
  const riskSchema = await loadJson(path.join(repositoryRoot, "schemas", "risk-assessment.schema.json"));
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  ajv.addSchema(signatureSchema);
  const validateRiskSchema = ajv.compile(riskSchema);
  const publicKey = await readFile(path.join(repositoryRoot, "conformance", "fixtures", "keys", "rfc8032-test-key-1.pem"), "utf8");

  const documents = {};
  for (const [name, relative] of Object.entries(vectors.documents)) {
    documents[name] = await loadJson(path.resolve(baseDirectory, relative));
  }
  const eligibleRiskRanges = new Map(vectors.profileEligibility.map((entry) => [entry.profileId, entry.effectiveRiskRange]));
  const context = { ...documents, eligibleRiskRanges, validateRiskSchema, publicKey };
  const positiveIssues = riskChainIssues(context);
  if (positiveIssues.length > 0) {
    throw new Error(`positive risk chain failed:\n${positiveIssues.map((issue) => `- ${issue}`).join("\n")}`);
  }

  let passed = 1;
  for (const vector of vectors.negativeVectors) {
    const mutated = clone(documents);
    setPointer(mutated[vector.target], vector.pointer, vector.value);
    const issues = riskChainIssues({ ...mutated, eligibleRiskRanges, validateRiskSchema, publicKey });
    if (!issues.some((issue) => issue.includes(vector.expectedError))) {
      throw new Error(`${vector.id}: expected ${JSON.stringify(vector.expectedError)}, found:\n${issues.map((issue) => `- ${issue}`).join("\n")}`);
    }
    passed += 1;
  }
  process.stdout.write(`risk-assessment chain: ${passed}/${vectors.negativeVectors.length + 1} vectors passed\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
