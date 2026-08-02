import { createHash, verify } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  dependencyManifestDigest,
  verifyRepositoryGroundingEvidence,
  verifyWorkspaceManifest
} from "./verify-repository-grounding.mjs";
import { checkProductionDerivedInput } from "./validate-production-derived-input.mjs";
import { checkSdlcCoverage } from "./verify-sdlc-coverage.mjs";
import { checkSuiteProfileBindings } from "./verify-suite-profile-bindings.mjs";
import { verifyCaseValidityArgument } from "./verify-case-classification.mjs";
import {
  verifyAttemptLedgerCheckpoint,
  verifyEvidencePayload,
  resolveEvidencePayloadBytes
} from "./verify-material-integrity.mjs";
import { changedPathType, executeOutcomeReplay } from "./outcome-replay-executor.mjs";
import { executeRepositoryPredicate } from "./repository-grounding-predicate-executor.mjs";
import {
  checkConformanceTargetComposition,
  checkEvaluatorManifest
} from "./verify-conformance-target-composition.mjs";
import { verifyConformanceProofPayload } from "./verify-noncircular-conformance-proofs.mjs";
import {
  checkCaseValidationStrategy,
  referenceFixtureApplicabilityRegistry
} from "./verify-case-validation-strategy.mjs";
import { validationEnvelopeAggregateIssues } from "./validation-envelope-aggregate.mjs";
import {
  distributionRequirementMappingResolver,
  validateRequirementImplementationRouting
} from "./verify-profile-requirement-mapping.mjs";
import {
  checkRepoChangeBoundVerification,
  verifyMachineContractArtifact,
  verifyMachineContractVectors
} from "./verify-machine-contract-bindings.mjs";
import { executeRepositoryReviewExpectation } from "../profiles/repository-review-v1/verify-profile.mjs";
import {
  profileFixtureAuthorityProblems,
  profileFixtureOutcomeProblems,
  registeredProfileFixtureManifestKind
} from "./profile-fixture-execution-contract.mjs";
import { conformanceScopeBindingPolicy } from "./conformance-scope-binding.mjs";
import { checkCaseQaRecord } from "./verify-case-qa-record.mjs";
import {
  assurancePolicyIssues,
  baseAssuranceSelectionIssues
} from "./assurance-policy.mjs";
import {
  resolveLeafClaimTrustBinding,
  resolveLeafSignatureBinding,
  signatureProfileUseIssues
} from "./profile-trust-binding.mjs";

function parseIJson(text, label = "JSON input") {
  let index = 0;
  const fail = (message) => { throw new Error(`${label}: ${message} at byte/character ${index}`); };
  const skipWhitespace = () => {
    while (index < text.length && [" ", "\t", "\r", "\n"].includes(text[index])) index += 1;
  };
  const validateScalarString = (value) => {
    for (let offset = 0; offset < value.length; offset += 1) {
      const unit = value.charCodeAt(offset);
      if (unit >= 0xd800 && unit <= 0xdbff) {
        const next = value.charCodeAt(offset + 1);
        if (!(next >= 0xdc00 && next <= 0xdfff)) fail("lone high surrogate is not I-JSON");
        offset += 1;
      } else if (unit >= 0xdc00 && unit <= 0xdfff) {
        fail("lone low surrogate is not I-JSON");
      }
    }
  };
  const parseString = () => {
    const start = index;
    if (text[index] !== "\"") fail("expected string");
    index += 1;
    let escaped = false;
    while (index < text.length) {
      const character = text[index];
      if (!escaped && character === "\"") {
        index += 1;
        let value;
        try {
          value = JSON.parse(text.slice(start, index));
        } catch (error) {
          fail(`invalid JSON string (${error.message})`);
        }
        validateScalarString(value);
        return value;
      }
      if (!escaped && character.charCodeAt(0) < 0x20) fail("unescaped control character");
      if (!escaped && character === "\\") escaped = true;
      else escaped = false;
      index += 1;
    }
    fail("unterminated string");
  };
  const parseNumber = () => {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(index));
    if (!match) fail("invalid number");
    const token = match[0];
    index += token.length;
    const value = Number(token);
    if (!Number.isFinite(value)) fail("number is outside the finite binary64 JCS domain");
    if (!/[.eE]/.test(token) && !Number.isSafeInteger(value)) {
      fail("integer is outside the interoperable I-JSON range");
    }
  };
  const parseValue = () => {
    skipWhitespace();
    const character = text[index];
    if (character === "{") return parseObject();
    if (character === "[") return parseArray();
    if (character === "\"") { parseString(); return; }
    if (character === "-" || (character >= "0" && character <= "9")) { parseNumber(); return; }
    for (const literal of ["true", "false", "null"]) {
      if (text.startsWith(literal, index)) { index += literal.length; return; }
    }
    fail("invalid JSON value");
  };
  const parseObject = () => {
    index += 1;
    skipWhitespace();
    const keys = new Set();
    if (text[index] === "}") { index += 1; return; }
    while (index < text.length) {
      const key = parseString();
      if (keys.has(key)) fail(`duplicate member name ${JSON.stringify(key)}`);
      keys.add(key);
      skipWhitespace();
      if (text[index] !== ":") fail("expected colon");
      index += 1;
      parseValue();
      skipWhitespace();
      if (text[index] === "}") { index += 1; return; }
      if (text[index] !== ",") fail("expected comma or object end");
      index += 1;
      skipWhitespace();
    }
    fail("unterminated object");
  };
  const parseArray = () => {
    index += 1;
    skipWhitespace();
    if (text[index] === "]") { index += 1; return; }
    while (index < text.length) {
      parseValue();
      skipWhitespace();
      if (text[index] === "]") { index += 1; return; }
      if (text[index] !== ",") fail("expected comma or array end");
      index += 1;
    }
    fail("unterminated array");
  };
  parseValue();
  skipWhitespace();
  if (index !== text.length) fail("trailing non-whitespace data");
  return JSON.parse(text);
}

async function readJsonStrict(absolute) {
  return parseIJson(await readFile(absolute, "utf8"), absolute);
}

const root = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, "$1"));
const schemaDirectory = path.join(root, "schemas");
const fixtureDirectory = path.join(root, "conformance", "fixtures");
const fixtureKey = await readFile(path.join(fixtureDirectory, "keys", "rfc8032-test-key-1.pem"), "utf8");
const schedulerFixtureKey = await readFile(path.join(fixtureDirectory, "material-integrity", "keys", "rfc8032-test-key-2-scheduler.pem"), "utf8");
const proofRegistryFixtureKey = await readFile(path.join(fixtureDirectory, "noncircular-proof", "keys", "registry.pem"), "utf8");
const proofAutomatedFixtureKey = await readFile(path.join(fixtureDirectory, "noncircular-proof", "keys", "automated.pem"), "utf8");
const proofReviewerFixtureKey = await readFile(path.join(fixtureDirectory, "noncircular-proof", "keys", "reviewer.pem"), "utf8");
const outcomeRunnerFixtureKey = await readFile(path.join(fixtureDirectory, "keys", "rfc8032-test-key-3-runner.pem"), "utf8");
const manifest = await readJsonStrict(path.join(fixtureDirectory, "manifest.json"));
const groundingExecutorRegistryPath = path.join(root, "standard", "repository-grounding-executor-registry.json");
const groundingExecutorRegistry = await readJsonStrict(groundingExecutorRegistryPath);
const groundingExecutorMatches = (groundingExecutorRegistry.executors ?? []).filter((entry) =>
  entry.id === "agent-evals-standard.repository-contract-predicate" && entry.version === "0.1.0");
let groundingExecutorAuthority = { executors: [] };
if (groundingExecutorMatches.length === 1) {
  const entry = groundingExecutorMatches[0];
  const executableAbsolute = path.resolve(path.dirname(groundingExecutorRegistryPath), entry.uri);
  const distributionRoot = `${root}${path.sep}`;
  if (executableAbsolute.startsWith(distributionRoot)) {
    const executableBytes = await readFile(executableAbsolute);
    if (sha256Bytes(executableBytes) === entry.digest) {
      groundingExecutorAuthority = {
        executors: [{ ...entry, authenticated: true, execute: executeRepositoryPredicate }]
      };
    }
  }
}
const verifierOwnedOutcomeReplayTrustProfiles = new Map([
  ["conformance-outcome-replay-v1", {
    id: "conformance-outcome-replay-v1",
    claimantKeyIds: new Set(["rfc8032-test-key-1"]),
    claimantAuthorities: new Map([
      ["rfc8032-test-key-1", {
        keyId: "rfc8032-test-key-1",
        actorId: "fixture-scorecard-claimant",
        trustDomain: "fixture-scorecard-claimant",
        publicKey: fixtureKey
      }]
    ]),
    authorities: new Map([
      ["rfc8032-test-key-2-verifier", {
        keyId: "rfc8032-test-key-2-verifier",
        profileId: "fixture-automated-verifier-profile",
        actorId: "fixture-independent-outcome-verifier",
        trustDomain: "fixture-independent-verifier",
        externallyConfigured: true,
        authorizedPurposes: [
          "outcome_replay_receipt",
          "repo_change_grader_assessment",
          "repo_change_adjudication",
          "measurement_validity_record"
        ],
        authorizedSchemaIds: [
          "agent-eval-outcome-replay-receipt-1",
          "agent-eval-repo-change-grader-assessment-1",
          "agent-eval-repo-change-adjudication-record-1",
          "agent-eval-repo-change-measurement-validity-record-1"
        ],
        publicKey: proofAutomatedFixtureKey
      }],
      ["rfc8032-test-key-3-runner", {
        keyId: "rfc8032-test-key-3-runner",
        profileId: "fixture-runner-capture-profile",
        actorId: "fixture-runner",
        trustDomain: "fixture-runner-capture",
        externallyConfigured: true,
        authorizedPurposes: ["evaluated_arm_assurance_report", "repo_change_runner_check"],
        authorizedSchemaIds: [
          "agent-eval-repo-change-assurance-report-1",
          "agent-eval-repo-change-runner-check-record-1"
        ],
        publicKey: outcomeRunnerFixtureKey
      }]
    ])
  }]
]);
const groupFlagIndex = process.argv.indexOf("--group");
const selectedGroup = groupFlagIndex >= 0 ? process.argv[groupFlagIndex + 1] : null;
if (groupFlagIndex >= 0 && (!selectedGroup || selectedGroup.startsWith("--"))) {
  throw new Error("--group requires a fixture group name");
}
const materialIntegrityVectorSet = await readJsonStrict(
  path.join(fixtureDirectory, "material-integrity", "vectors.json")
);
const canonicalAttemptIntegrityVector = materialIntegrityVectorSet.vectors.find(
  (entry) => entry.id === "positive-canonical-scorecard-attempt-checkpoint"
);
if (!canonicalAttemptIntegrityVector) {
  throw new Error("material-integrity corpus lacks the canonical external attempt-log context");
}

const knownSemanticChecks = new Set([
  "assurancePolicy",
  "artifactPointers",
  "caseClassification",
  "caseCapabilityClassification",
  "caseCapabilityClassificationBoundary",
  "caseProfileBindings",
  "caseQaRecord",
  "caseValidationStrategy",
  "caseWorkArtifactBindings",
  "claimTrustBinding",
  "conformanceGraph",
  "conformanceTargetComposition",
  "contractDigest",
  "effectiveProfileDigest",
  "embeddedEvidence",
  "evidencePayload",
  "escalationRequestBinding",
  "evaluationControlGraph",
  "evaluatorManifest",
  "outcomeGraph",
  "profileFixtureBindings",
  "profileInheritance",
  "profileResolutionProvenance",
  "profileResolutionRecord",
  "productionDerivedInput",
  "repositoryGroundingEvidence",
  "requirementCoverage",
  "scorecardGraph",
  "sdlcCoverage",
  "selfDigest",
  "signature",
  "signatureProfileBinding",
  "sourceEvidenceGraph",
  "sourceEvidenceTriangulation",
  "sourceEventBinding",
  "suiteProfileBindings",
  "validationEnvelope",
  "workspaceManifestBinding",
  "workspaceManifest"
]);

const closedCapabilityIds = new Set([
  "CAP.DISCOVER_SPECIFY",
  "CAP.PLAN_DESIGN",
  "CAP.IMPLEMENT_CHANGE",
  "CAP.VERIFY_ASSURE",
  "CAP.REVIEW_DECIDE",
  "CAP.RELEASE_OPERATE",
  "CAP.REMEDIATE_LEARN"
]);

const primaryEmpiricalEvidenceClasses = new Set([
  "primary_benchmark_artifact",
  "primary_research_preprint",
  "peer_reviewed_research",
  "primary_empirical_report"
]);

function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
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

function resolveRepositoryPath(baseDirectory, candidate) {
  const absolute = path.resolve(baseDirectory, candidate);
  const relative = path.relative(root, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`path escapes repository root: ${candidate}`);
  }
  return absolute;
}

function applyMutations(document, mutations) {
  for (const mutation of mutations ?? []) {
    if (typeof mutation.pointer !== "string" || !mutation.pointer.startsWith("/") || mutation.pointer === "/") {
      throw new Error(`invalid mutation pointer: ${mutation.pointer}`);
    }
    const tokens = mutation.pointer.slice(1).split("/").map((token) => token.replaceAll("~1", "/").replaceAll("~0", "~"));
    let target = document;
    for (const token of tokens.slice(0, -1)) {
      if (target === null || typeof target !== "object" || !(token in target)) {
        throw new Error(`mutation pointer does not exist: ${mutation.pointer}`);
      }
      target = target[token];
    }
    const leaf = tokens.at(-1);
    if (target === null || typeof target !== "object" || (!(leaf in target) && mutation.add !== true)) {
      throw new Error(`mutation pointer does not exist: ${mutation.pointer}`);
    }
    if (mutation.remove === true) delete target[leaf];
    else target[leaf] = mutation.value;
  }
}

function visit(value, callback, pointer = "#") {
  callback(value, pointer);
  if (Array.isArray(value)) {
    value.forEach((item, index) => visit(item, callback, `${pointer}/${index}`));
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      visit(item, callback, `${pointer}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`);
    }
  }
}

const manifestProblems = [];
if (manifest.schemaVersion !== "conformance-fixture-manifest-1") manifestProblems.push("unexpected manifest schemaVersion");
if (!Array.isArray(manifest.fixtures) || manifest.fixtures.length === 0) manifestProblems.push("manifest.fixtures must be non-empty");
for (const [index, fixture] of (manifest.fixtures ?? []).entries()) {
  const label = `fixtures/${index}`;
  if ((fixture.path === undefined) === (fixture.basePath === undefined)) manifestProblems.push(`${label} must declare exactly one of path or basePath`);
  if (typeof fixture.schema !== "string" || fixture.schema.length === 0) manifestProblems.push(`${label} has no schema`);
  if (typeof fixture.valid !== "boolean") manifestProblems.push(`${label}.valid must be boolean`);
  if (fixture.valid === false && !fixture.expectedError) manifestProblems.push(`${label} must declare expectedError for a negative expectation`);
  if (fixture.expectParseFailure === true && (fixture.valid !== false || fixture.basePath !== undefined)) {
    manifestProblems.push(`${label} parse-failure vector must be an invalid path fixture`);
  }
  for (const check of fixture.semanticChecks ?? []) {
    if (!knownSemanticChecks.has(check)) manifestProblems.push(`${label} uses unknown semantic check ${check}`);
  }
}
const outcomeReplayTrustSourcePaths = new Set();
for (const [index, binding] of (manifest.outcomeReplayTrustBindings ?? []).entries()) {
  if (typeof binding.sourcePath !== "string" || binding.sourcePath.length === 0) {
    manifestProblems.push(`outcomeReplayTrustBindings/${index} has no sourcePath`);
  } else if (outcomeReplayTrustSourcePaths.has(binding.sourcePath)) {
    manifestProblems.push(`outcomeReplayTrustBindings sourcePath ${binding.sourcePath} occurs more than once`);
  }
  outcomeReplayTrustSourcePaths.add(binding.sourcePath);
  if (!verifierOwnedOutcomeReplayTrustProfiles.has(binding.profileId)) {
    manifestProblems.push(`outcomeReplayTrustBindings/${index} names uninstalled verifier trust profile ${binding.profileId}`);
  }
}
if (!manifest.fixtures?.some((fixture) => fixture.valid === true)) manifestProblems.push("manifest needs a positive expectation");
if (!manifest.fixtures?.some((fixture) => fixture.valid === false)) manifestProblems.push("manifest needs a negative expectation");
if (manifestProblems.length) {
  console.error(`Fixture manifest is invalid (${manifestProblems.length}):`);
  manifestProblems.forEach((problem) => console.error(`- ${problem}`));
  process.exit(1);
}

const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: true });
addFormats(ajv);

const schemaIds = [];
for (const name of await readdir(schemaDirectory)) {
  if (!name.endsWith(".schema.json")) continue;
  const schema = await readJsonStrict(path.join(schemaDirectory, name));
  ajv.addSchema(schema);
  schemaIds.push(schema.$id);
}

// addSchema can compile lazily. Resolving every root makes strict-mode warnings
// and unresolved references fatal even when no fixture selects that schema.
for (const schemaId of schemaIds) ajv.getSchema(schemaId);

const positiveRootSchemaIds = new Set(
  manifest.fixtures
    .filter((fixture) => fixture.valid === true && !fixture.schema.includes("#"))
    .map((fixture) => fixture.schema)
);
const uncoveredRootSchemas = schemaIds.filter((schemaId) => !positiveRootSchemaIds.has(schemaId));
if (!selectedGroup && uncoveredRootSchemas.length) {
  console.error("Every registered schema needs a valid full-root fixture:");
  uncoveredRootSchemas.forEach((schemaId) => console.error(`- ${schemaId}`));
  process.exit(1);
}

function selfDigestProjection(document) {
  const projection = clone(document);
  delete projection.digest;
  delete projection.signature;
  if (document.schemaVersion === "agent-eval-revocation-state-contract-1") {
    for (const signature of projection.authorizationSignatures ?? []) delete signature.value;
  }
  return projection;
}

async function checkSelfDigest(document, _sourceAbsolute, issues) {
  const projection = selfDigestProjection(document);
  const actual = sha256Canonical(projection);
  if (document.digest !== actual) issues.push(`selfDigest: expected ${actual}, found ${document.digest}`);
}

function fixtureSignatureProblem(document) {
  const signature = document.signature ?? document.attestation;
  if (signature?.profileId !== "fixture-signature-profile"
    || signature?.algorithm !== "Ed25519" || signature?.keyId !== "rfc8032-test-key-1") {
    return "fixture verifier accepts only profile fixture-signature-profile with Ed25519 key rfc8032-test-key-1";
  }
  const projection = clone(document);
  const evidenceArtifact = document.schemaVersion === undefined && document.attestation !== undefined;
  if (evidenceArtifact) delete projection.attestation.value;
  else delete projection.signature.value;
  const payload = Buffer.concat([
    Buffer.from(evidenceArtifact ? "agent-evals-evidence-artifact-1" : document.schemaVersion, "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalize(projection), "utf8")
  ]);
  let valid = false;
  try {
    valid = verify(null, payload, fixtureKey, Buffer.from(signature.value, "base64url"));
  } catch (error) {
    return `verifier error: ${error.message}`;
  }
  return valid ? null : "Ed25519 verification failed";
}

const operationalRoleBySchemaVersion = {
  "agent-eval-key-authorization-contract-1": "trust_contract_signer",
  "agent-eval-revocation-state-contract-1": "trust_contract_signer",
  "agent-eval-trusted-time-contract-1": "trust_contract_signer",
  "agent-eval-trust-threat-assessment-1": "trust_contract_signer",
  "agent-eval-anti-rollback-policy-1": "trust_contract_signer",
  "agent-eval-trusted-time-attestation-1": "trusted_time_authority",
  "agent-eval-anti-rollback-receipt-1": "anti_rollback_receipt_signer"
};

async function operationalSignatureProblem(document) {
  const signature = document.signature;
  if (signature?.profileId !== "repo-change-operational-signature-profile" || signature.algorithm !== "Ed25519") {
    return "unknown operational signature profile or algorithm";
  }
  try {
    const contractAbsolute = path.join(root, "profiles", "repo-change-v1", "operational-key-authorization-contract.json");
    const contract = await readJsonStrict(contractAbsolute);
    const matches = (contract.keys ?? []).filter((entry) => entry.keyId === signature.keyId);
    if (matches.length !== 1) return `operational key ${signature.keyId} resolves ${matches.length} times`;
    const key = matches[0];
    const expectedRole = operationalRoleBySchemaVersion[document.schemaVersion];
    if (!expectedRole || !(key.authorizedRoles ?? []).includes(expectedRole)
      || !(key.authorizedArtifactSchemaVersions ?? []).includes(document.schemaVersion)) {
      return `operational key ${signature.keyId} is not authorized for ${document.schemaVersion}/${expectedRole}`;
    }
    if (key.status !== "active" || Date.parse(signature.signedAt) < Date.parse(key.validFrom)
      || Date.parse(signature.signedAt) > Date.parse(key.validUntil)) {
      return `operational key ${signature.keyId} is inactive or outside its validity interval`;
    }
    const revocation = await readJsonStrict(path.join(root, "profiles", "repo-change-v1", "operational-revocation-state-contract.json"));
    const states = (revocation.keyStatuses ?? []).filter((entry) => entry.keyId === signature.keyId);
    if (states.length !== 1 || states[0].status !== "active"
      || Date.parse(signature.signedAt) < Date.parse(revocation.publishedAt)
      || Date.parse(signature.signedAt) > Date.parse(revocation.nextUpdate)) {
      return `operational revocation state does not authorize ${signature.keyId} at signedAt`;
    }
    const keyAbsolute = resolveRepositoryPath(path.dirname(contractAbsolute), key.publicKey.uri);
    const keyBytes = await readFile(keyAbsolute);
    if (sha256Bytes(keyBytes) !== key.publicKey.digest) return `operational public-key digest mismatch for ${signature.keyId}`;
    const projection = clone(document);
    delete projection.signature.value;
    if (document.schemaVersion === "agent-eval-anti-rollback-receipt-1") delete projection.witnessSignature;
    const payload = Buffer.concat([
      Buffer.from(document.schemaVersion, "utf8"),
      Buffer.from([0]),
      Buffer.from(canonicalize(projection), "utf8")
    ]);
    return verify(null, payload, keyBytes, Buffer.from(signature.value, "base64url"))
      ? null
      : "operational Ed25519 verification failed";
  } catch (error) {
    return `operational verifier error: ${error.message}`;
  }
}

async function artifactSignatureProblem(document) {
  if ((document.signature ?? document.attestation)?.profileId === "fixture-signature-profile") {
    return fixtureSignatureProblem(document);
  }
  if (document.attestation?.profileId === "fixture-automated-verifier-profile"
    && document.attestation?.algorithm === "Ed25519"
    && document.attestation?.keyId === "rfc8032-test-key-2-verifier"
    && [
      "agent-eval-outcome-replay-receipt-1",
      "agent-eval-repo-change-grader-assessment-1",
      "agent-eval-repo-change-adjudication-record-1",
      "agent-eval-repo-change-measurement-validity-record-1"
    ]
      .includes(document.schemaMetadata?.schemaId)
    && document.producer?.id === "fixture-independent-outcome-verifier"
    && document.producer?.role === "verifier"
    && document.producer?.trustDomain === "external") {
    const projection = clone(document);
    delete projection.attestation.value;
    const payload = Buffer.concat([
      Buffer.from("agent-evals-evidence-artifact-1", "utf8"),
      Buffer.from([0]),
      Buffer.from(canonicalize(projection), "utf8")
    ]);
    try {
      return verify(null, payload, proofAutomatedFixtureKey, Buffer.from(document.attestation.value, "base64url"))
        ? null : "independent outcome-verifier Ed25519 verification failed";
    } catch (error) {
      return `independent outcome-verifier verifier error: ${error.message}`;
    }
  }
  if (document.attestation?.profileId === "fixture-runner-capture-profile"
    && document.attestation?.algorithm === "Ed25519"
    && document.attestation?.keyId === "rfc8032-test-key-3-runner"
    && [
      "agent-eval-repo-change-assurance-report-1",
      "agent-eval-repo-change-runner-check-record-1"
    ].includes(document.schemaMetadata?.schemaId)
    && document.producer?.id === "fixture-runner"
    && document.producer?.role === "runner"
    && document.producer?.trustDomain === "runner"
    && document.creationPhase === "execution") {
    const projection = clone(document);
    delete projection.attestation.value;
    const payload = Buffer.concat([
      Buffer.from("agent-evals-evidence-artifact-1", "utf8"),
      Buffer.from([0]),
      Buffer.from(canonicalize(projection), "utf8")
    ]);
    try {
      return verify(null, payload, outcomeRunnerFixtureKey, Buffer.from(document.attestation.value, "base64url"))
        ? null : "runner-capture Ed25519 verification failed";
    } catch (error) {
      return `runner-capture verifier error: ${error.message}`;
    }
  }
  if (document.signature?.profileId === "fixture-independent-scheduler-profile"
    && document.signature?.algorithm === "Ed25519"
    && document.signature?.keyId === "rfc8032-test-key-2-scheduler") {
    const projection = clone(document);
    delete projection.signature.value;
    const payload = Buffer.concat([
      Buffer.from(document.schemaVersion, "utf8"),
      Buffer.from([0]),
      Buffer.from(canonicalize(projection), "utf8")
    ]);
    try {
      return verify(null, payload, schedulerFixtureKey, Buffer.from(document.signature.value, "base64url"))
        ? null : "independent scheduler Ed25519 verification failed";
    } catch (error) {
      return `independent scheduler verifier error: ${error.message}`;
    }
  }
  return operationalSignatureProblem(document);
}

async function checkSignature(document, _sourceAbsolute, issues) {
  const problem = await artifactSignatureProblem(document);
  if (problem) issues.push(`signature: ${problem}`);
}

async function checkEvidencePayload(document, sourceAbsolute, issues) {
  const payloadIssues = await verifyEvidencePayload(document, {
    baseDirectory: path.dirname(sourceAbsolute)
  });
  issues.push(...payloadIssues.map((issue) => `evidencePayload: ${issue}`));
}

async function checkEmbeddedEvidence(document, sourceAbsolute, issues) {
  for (const evidence of document.evidenceManifest ?? []) {
    const signatureProblem = await artifactSignatureProblem(evidence);
    if (signatureProblem) issues.push(`embeddedEvidence ${evidence.id}: ${signatureProblem}`);
    const payloadIssues = [];
    await checkEvidencePayload(evidence, sourceAbsolute, payloadIssues);
    for (const issue of payloadIssues) issues.push(`embeddedEvidence ${evidence.id}: ${issue}`);
  }
}

async function checkSignatureProfileBinding(document, sourceAbsolute, issues) {
  const binding = document.signatureProfile ?? document.provenance?.signatureProfile;
  if (!binding) {
    issues.push("signatureProfileBinding: no pinned signature profile");
    return;
  }
  if (document.signature?.profileId !== binding.id) {
    issues.push(`signatureProfileBinding: signature profileId must be ${binding.id}`);
  }
  try {
    const absolute = resolveRepositoryPath(path.dirname(sourceAbsolute), binding.uri);
    const resolved = await digestForPointer(absolute);
    if (binding.digest !== resolved.digest) {
      issues.push(`signatureProfileBinding: profile digest must be ${resolved.digest}`);
    }
    if (resolved.referenced?.id !== binding.id) {
      issues.push(`signatureProfileBinding: profile id must be ${resolved.referenced?.id}`);
    }
    if (binding.version !== undefined && resolved.referenced?.version !== binding.version) {
      issues.push(`signatureProfileBinding: profile version must be ${resolved.referenced?.version}`);
    }
    const validate = ajv.getSchema("urn:agent-evals-standard:schema:signature-profile:1");
    if (!resolved.referenced || !validate || !validate(resolved.referenced)) {
      issues.push(`signatureProfileBinding: referenced profile is invalid: ${ajv.errorsText(validate?.errors ?? [])}`);
      return;
    }

    const signatureProfile = resolved.referenced;
    const signatureContractSchemas = {
      keyResolutionContract: "urn:agent-evals-standard:schema:key-authorization-contract:1",
      revocationContract: "urn:agent-evals-standard:schema:revocation-state-contract:1",
      timeValidationContract: "urn:agent-evals-standard:schema:trusted-time-contract:1",
      antiRollbackPolicy: "urn:agent-evals-standard:schema:anti-rollback-policy:1"
    };
    const contracts = {};
    for (const [field, schemaId] of Object.entries(signatureContractSchemas)) {
      const pointer = signatureProfile[field];
      if (!pointer) {
        issues.push(`signatureProfileBinding: signature profile has no ${field}`);
        continue;
      }
      try {
        const contractAbsolute = resolveRepositoryPath(path.dirname(absolute), pointer.uri);
        const contractResolved = await digestForPointer(contractAbsolute);
        const contract = contractResolved.referenced;
        contracts[field] = contract;
        if (pointer.digest !== contractResolved.digest) {
          issues.push(`signatureProfileBinding: ${field} digest must be ${contractResolved.digest}`);
        }
        if (contract?.id !== pointer.id) {
          issues.push(`signatureProfileBinding: ${field} id must be ${contract?.id}`);
        }
        if (pointer.version !== undefined && contract?.version !== pointer.version) {
          issues.push(`signatureProfileBinding: ${field} version must be ${contract?.version}`);
        }
        if (document.claimTrustUse === "deployment_bound") {
          const validateContract = ajv.getSchema(schemaId);
          if (!validateContract || !validateContract(contract)) {
            issues.push(`signatureProfileBinding: deployment ${field} is invalid: ${ajv.errorsText(validateContract?.errors ?? [])}`);
          }
        }
      } catch (error) {
        issues.push(`signatureProfileBinding: cannot authenticate ${field}: ${error.message}`);
      }
    }
    issues.push(...signatureProfileUseIssues({
      document,
      signatureProfile,
      contracts
    }, "signatureProfileBinding"));
  } catch (error) {
    issues.push(`signatureProfileBinding: ${error.message}`);
  }
}

const claimTrustContractSchemas = {
  keyResolutionContract: "urn:agent-evals-standard:schema:key-authorization-contract:1",
  revocationContract: "urn:agent-evals-standard:schema:revocation-state-contract:1",
  timeValidationContract: "urn:agent-evals-standard:schema:trusted-time-contract:1",
  antiRollbackPolicy: "urn:agent-evals-standard:schema:anti-rollback-policy:1"
};

async function resolvePinnedArtifact(pointer, baseDirectory, schemaId, owner, issues) {
  try {
    const absolute = resolveRepositoryPath(baseDirectory, pointer.uri);
    const resolved = await digestForPointer(absolute);
    const artifact = resolved.referenced;
    if (pointer.digest !== resolved.digest) issues.push(`${owner}: digest must be ${resolved.digest}`);
    if (artifact?.id !== pointer.id) issues.push(`${owner}: id must be ${artifact?.id}`);
    if (pointer.version !== undefined && artifact?.version !== pointer.version) {
      issues.push(`${owner}: version must be ${artifact?.version}`);
    }
    const validate = ajv.getSchema(schemaId);
    if (!artifact || !validate(artifact)) {
      issues.push(`${owner}: referenced artifact is invalid: ${ajv.errorsText(validate?.errors ?? [])}`);
    }
    return { artifact, absolute };
  } catch (error) {
    issues.push(`${owner}: ${error.message}`);
    return null;
  }
}

const workArtifactRegistrySchemaId = "urn:agent-evals-standard:schema:work-artifact-registry:1";

function sameWorkArtifactRegistryBinding(left, right) {
  return left?.id === right?.id && left?.version === right?.version && left?.digest === right?.digest;
}

async function resolveWorkArtifactRegistry(pointer, baseDirectory, owner, issues) {
  if (!pointer || typeof pointer !== "object") {
    issues.push(`${owner}: workArtifactRegistry is required`);
    return null;
  }
  const resolved = await resolvePinnedArtifact(pointer, baseDirectory, workArtifactRegistrySchemaId,
    `${owner} workArtifactRegistry`, issues);
  if (!resolved?.artifact) return null;
  const entries = resolved.artifact.artifactTypes ?? [];
  reportDuplicateIds(entries.map((entry) => entry.id), `${owner} work-artifact registry IDs`, issues);
  return {
    ...resolved,
    binding: pointer,
    byType: new Map(entries.map((entry) => [entry.id, entry]))
  };
}

function reportClaimTrustCoverage(policy, assuranceLevels, riskTiers, owner, issues) {
  const coveredAssurance = new Set(policy?.applicability?.assuranceLevels ?? []);
  const coveredRisk = new Set(policy?.applicability?.effectiveRiskTiers ?? []);
  for (const assurance of assuranceLevels) {
    if (!coveredAssurance.has(assurance)) issues.push(`${owner}: anti-rollback policy does not cover assurance ${assurance}`);
  }
  for (const risk of riskTiers) {
    if (!coveredRisk.has(risk)) issues.push(`${owner}: anti-rollback policy does not cover effective risk ${risk}`);
  }
}

const claimTrustAssuranceOrder = ["A0", "A1", "A2", "A3"];
const claimTrustRiskOrder = ["low", "medium", "high", "critical"];
const claimTrustRoleSchemas = {
  trust_contract_signer: [
    "agent-eval-key-authorization-contract-1",
    "agent-eval-revocation-state-contract-1",
    "agent-eval-trusted-time-contract-1",
    "agent-eval-anti-rollback-policy-1"
  ],
  trusted_time_authority: ["agent-eval-trusted-time-attestation-1"],
  anti_rollback_receipt_signer: ["agent-eval-anti-rollback-receipt-1"],
  anti_rollback_witness: ["agent-eval-anti-rollback-receipt-1"]
};

function expandClaimTrustRange(token, order) {
  const [first, last = first] = token.split("-");
  const firstIndex = order.indexOf(first);
  const lastIndex = order.indexOf(last);
  if (firstIndex < 0 || lastIndex < firstIndex) return [];
  return order.slice(firstIndex, lastIndex + 1);
}

function claimTrustScopeCovers(scope, profileId, assurance, risk) {
  const parts = scope.split(":");
  if (parts.length !== 3 || parts[0] !== profileId) return false;
  return expandClaimTrustRange(parts[1], claimTrustAssuranceOrder).includes(assurance)
    && expandClaimTrustRange(parts[2], claimTrustRiskOrder).includes(risk);
}

function claimTrustKeyIsActiveAt(key, referenceTime) {
  const validFrom = Date.parse(key.validFrom);
  const validUntil = Date.parse(key.validUntil);
  return key.status === "active" && Number.isFinite(validFrom) && Number.isFinite(validUntil)
    && validFrom <= referenceTime && referenceTime <= validUntil;
}

function sameAuthenticatedContractPointer(left, right) {
  return left?.id === right?.id && left?.digest === right?.digest
    && (left?.version === undefined || right?.version === undefined || left.version === right.version);
}

function claimTrustKeyCoversContexts(key, contexts) {
  return contexts.every((context) => (context.assuranceLevels ?? []).every((assurance) =>
    (context.riskTiers ?? []).every((risk) => (key.authorizedScopes ?? [])
      .some((scope) => claimTrustScopeCovers(scope, context.profileId, assurance, risk)))));
}

async function validateOperationalClaimTrustGraph(profile, contracts, contexts, owner, issues) {
  const referenceTime = Date.parse(profile.operationalReference?.referenceVerificationTime);
  if (!Number.isFinite(referenceTime)) {
    issues.push(`${owner}: operationalReference.referenceVerificationTime is invalid`);
    return;
  }
  const keyContractResolved = contracts.keyResolutionContract;
  const revocationResolved = contracts.revocationContract;
  const trustedTimeResolved = contracts.timeValidationContract;
  const antiRollbackResolved = contracts.antiRollbackPolicy;
  if (!keyContractResolved?.artifact || !revocationResolved?.artifact
    || !trustedTimeResolved?.artifact || !antiRollbackResolved?.artifact) return;
  const keyContract = keyContractResolved.artifact;
  const revocation = revocationResolved.artifact;
  const trustedTime = trustedTimeResolved.artifact;
  const antiRollback = antiRollbackResolved.artifact;

  for (const [field, pointer] of [
    ["revocationContract.keyAuthorizationContract", revocation.keyAuthorizationContract],
    ["timeValidationContract.keyAuthorizationContract", trustedTime.keyAuthorizationContract],
    ["antiRollbackPolicy.mechanism.serviceIdentity", antiRollback.mechanism?.serviceIdentity],
    ["antiRollbackPolicy.mechanism.witnessPolicy.witnessRegistry", antiRollback.mechanism?.witnessPolicy?.witnessRegistry]
  ]) {
    if (!sameAuthenticatedContractPointer(pointer, profile.keyResolutionContract)) {
      issues.push(`${owner}: ${field} must bind the same authenticated key-authorization contract`);
    }
  }

  const keysById = new Map();
  for (const key of keyContract.keys ?? []) {
    if (keysById.has(key.keyId)) issues.push(`${owner}: key ${key.keyId} occurs more than once`);
    keysById.set(key.keyId, key);
  }
  const requiredKeyIds = new Set();
  for (const [role, schemaVersions] of Object.entries(claimTrustRoleSchemas)) {
    for (const schemaVersion of schemaVersions) {
      for (const context of contexts) {
        for (const assurance of context.assuranceLevels ?? []) {
          for (const risk of context.riskTiers ?? []) {
            const matches = (keyContract.keys ?? []).filter((key) => claimTrustKeyIsActiveAt(key, referenceTime)
              && (key.authorizedRoles ?? []).includes(role)
              && (key.authorizedArtifactSchemaVersions ?? []).includes(schemaVersion)
              && (key.authorizedScopes ?? []).some((scope) =>
                claimTrustScopeCovers(scope, context.profileId, assurance, risk)));
            if (matches.length === 0) {
              issues.push(`${owner}: no active ${role} key authorizes ${schemaVersion} for ${context.profileId}:${assurance}:${risk}`);
            }
            for (const key of matches) requiredKeyIds.add(key.keyId);
          }
        }
      }
    }
  }

  for (const keyId of requiredKeyIds) {
    const key = keysById.get(keyId);
    try {
      const keyAbsolute = resolveRepositoryPath(path.dirname(keyContractResolved.absolute), key.publicKey.uri);
      const actualDigest = sha256Bytes(await readFile(keyAbsolute));
      if (key.publicKey.digest !== actualDigest) {
        issues.push(`${owner}: public key ${keyId} digest must be ${actualDigest}`);
      }
    } catch (error) {
      issues.push(`${owner}: cannot authenticate public key ${keyId}: ${error.message}`);
    }
  }

  if (!(Date.parse(revocation.publishedAt) <= referenceTime && referenceTime <= Date.parse(revocation.nextUpdate))) {
    issues.push(`${owner}: revocation state is stale at operationalReference.referenceVerificationTime`);
  }
  const statusesByKey = new Map();
  for (const status of revocation.keyStatuses ?? []) {
    if (!statusesByKey.has(status.keyId)) statusesByKey.set(status.keyId, []);
    statusesByKey.get(status.keyId).push(status);
  }
  for (const keyId of requiredKeyIds) {
    const statuses = statusesByKey.get(keyId) ?? [];
    if (statuses.length !== 1 || statuses[0].status !== "active"
      || Date.parse(statuses[0].effectiveAt) > referenceTime || statuses[0].compromiseTime !== null) {
      issues.push(`${owner}: revocation state must contain one effective active status for ${keyId}`);
    }
  }

  const sourceIds = new Set();
  const sourceKeyIds = new Set();
  const sourceOwnerIds = new Set();
  const sourceTrustDomains = new Set();
  let usableTimeSources = 0;
  for (const source of trustedTime.sources ?? []) {
    const identitySets = [
      [sourceIds, source.sourceId, "sourceId"],
      [sourceKeyIds, source.keyId, "keyId"],
      [sourceOwnerIds, source.ownerId, "ownerId"],
      [sourceTrustDomains, source.trustDomain, "trustDomain"]
    ];
    let distinct = true;
    for (const [set, value, label] of identitySets) {
      if (set.has(value)) {
        issues.push(`${owner}: trusted-time sources must have distinct ${label}; duplicate ${value}`);
        distinct = false;
      }
      set.add(value);
    }
    const key = keysById.get(source.keyId);
    const revocationStatus = (statusesByKey.get(source.keyId) ?? [])[0];
    const usable = distinct && key !== undefined && key.ownerId === source.ownerId
      && claimTrustKeyIsActiveAt(key, referenceTime)
      && (key.authorizedRoles ?? []).includes("trusted_time_authority")
      && (key.authorizedArtifactSchemaVersions ?? []).includes("agent-eval-trusted-time-attestation-1")
      && claimTrustKeyCoversContexts(key, contexts)
      && (statusesByKey.get(source.keyId) ?? []).length === 1
      && revocationStatus?.status === "active" && Date.parse(revocationStatus?.effectiveAt) <= referenceTime
      && revocationStatus?.compromiseTime === null;
    if (!usable) issues.push(`${owner}: trusted-time source ${source.sourceId} lacks an active, correctly scoped independent authority key`);
    else usableTimeSources += 1;
  }
  if (usableTimeSources < trustedTime.minimumIndependentSources) {
    issues.push(`${owner}: trusted-time contract has ${usableTimeSources} usable independent sources; ${trustedTime.minimumIndependentSources} required`);
  }

  if (antiRollback.mechanism?.type !== "independent_notary") {
    issues.push(`${owner}: anti-rollback mechanism must be independent_notary`);
  }
  if (antiRollback.mechanism?.witnessPolicy?.mode !== "independent_witness"
    || antiRollback.mechanism?.witnessPolicy?.minimumIndependentWitnesses < 1) {
    issues.push(`${owner}: anti-rollback policy must require at least one independent witness`);
  }
  const notaryKeys = (keyContract.keys ?? []).filter((key) => claimTrustKeyIsActiveAt(key, referenceTime)
    && (key.authorizedRoles ?? []).includes("anti_rollback_receipt_signer")
    && (key.authorizedArtifactSchemaVersions ?? []).includes("agent-eval-anti-rollback-receipt-1")
    && claimTrustKeyCoversContexts(key, contexts));
  const witnessKeys = (keyContract.keys ?? []).filter((key) => claimTrustKeyIsActiveAt(key, referenceTime)
    && (key.authorizedRoles ?? []).includes("anti_rollback_witness")
    && (key.authorizedArtifactSchemaVersions ?? []).includes("agent-eval-anti-rollback-receipt-1")
    && claimTrustKeyCoversContexts(key, contexts));
  if (notaryKeys.length === 0 || witnessKeys.length === 0
    || !notaryKeys.some((notary) => witnessKeys.some((witness) => witness.ownerId !== notary.ownerId))) {
    issues.push(`${owner}: anti-rollback notary and witness require distinct active owners with exact profile/assurance/risk scope`);
  }
}

async function resolveBoundEvaluationProfile(binding, declaredEffectiveDigest, issues) {
  const candidates = [];
  const conventional = path.join(root, "profiles", binding.id, "evaluation-profile.json");
  try {
    const resolved = await digestForPointer(conventional);
    candidates.push({ document: resolved.referenced, digest: resolved.digest, absolute: conventional });
  } catch {
    // An implementation normally resolves this identity through its profile registry.
    // The conformance runner falls back to positive profile fixtures registered below.
  }
  for (const fixture of manifest.fixtures ?? []) {
    if (fixture.valid !== true || fixture.schema !== "urn:agent-evals-standard:schema:evaluation-profile:1"
      || fixture.path === undefined) continue;
    try {
      const absolute = resolveRepositoryPath(fixtureDirectory, fixture.path);
      if (path.resolve(absolute) === path.resolve(conventional)) continue;
      const resolved = await digestForPointer(absolute);
      candidates.push({ document: resolved.referenced, digest: resolved.digest, absolute });
    } catch {
      // The fixture's own validation reports an unreadable registered profile.
    }
  }
  const matches = candidates.filter(({ document }) => document.id === binding.id && document.version === binding.version);
  if (matches.length !== 1) {
    issues.push(`claimTrustBinding: evaluation profile ${binding.id}@${binding.version} resolves ${matches.length} times`);
    return null;
  }
  const selected = matches[0];
  const validate = ajv.getSchema("urn:agent-evals-standard:schema:evaluation-profile:1");
  if (!validate || !validate(selected.document)) {
    issues.push(`claimTrustBinding: evaluation profile ${binding.id}@${binding.version} is schema invalid: ${ajv.errorsText(validate?.errors ?? [])}`);
    return null;
  }
  if (selected.digest !== binding.digest || selected.document.digest !== binding.digest) {
    issues.push(`claimTrustBinding: evaluation profile ${binding.id}@${binding.version} digest differs from the pre-run binding`);
  }
  const effectiveIssues = [];
  const effectiveProfile = await resolveEffectiveProfile(selected.document, selected.absolute, effectiveIssues);
  issues.push(...effectiveIssues.map((issue) => `claimTrustBinding: ${binding.id}@${binding.version}: ${issue}`));
  const actualEffectiveDigest = effectiveProfile ? sha256Canonical(effectiveProfile) : null;
  if (declaredEffectiveDigest !== actualEffectiveDigest
    || selected.document.effectiveProfileDigest !== actualEffectiveDigest) {
    issues.push(`claimTrustBinding: evaluation profile ${binding.id}@${binding.version} effectiveProfileDigest must be ${actualEffectiveDigest}`);
  }
  return { ...selected, effectiveProfile, effectiveProfileDigest: actualEffectiveDigest };
}

async function checkClaimTrustBinding(document, sourceAbsolute, issues) {
  const owner = "claimTrustBinding";
  const pointer = document.claimTrustProfile;
  if (!pointer || !document.claimTrustUse) {
    issues.push(`${owner}: claimTrustProfile and claimTrustUse are required`);
    return;
  }
  const resolved = await resolvePinnedArtifact(pointer, path.dirname(sourceAbsolute),
    "urn:agent-evals-standard:schema:signature-profile:1", `${owner} profile`, issues);
  if (!resolved?.artifact) return;
  const profile = resolved.artifact;
  const reference = profile.operationalReference;
  if (!reference) {
    issues.push(`${owner}: operational claim-trust profile must declare operationalReference`);
  }
  if (document.claimTrustUse === "conformance_fixture_requires_external_rekey") {
    if (sameProfileValue(document.signatureProfile, document.claimTrustProfile)) {
      issues.push(`${owner}: conformance fixture artifact signatures must be separate from operational claim trust`);
    }
    if (reference?.deploymentUse !== "prohibited_until_external_rekey_and_owner_verification"
      || reference?.externalRekeyRequired !== true) {
      issues.push(`${owner}: conformance fixture claim trust must prohibit deployment until external re-key and owner verification`);
    }
    if (document.schemaVersion === "agent-eval-conformance-statement-1"
      && !(document.claimRestrictions ?? []).some((restriction) => restriction.claim === "deployment_trust")) {
      issues.push(`${owner}: conformance fixture must explicitly restrict deployment_trust`);
    }
  } else if (document.claimTrustUse === "deployment_bound"
    && (reference?.deploymentUse === "prohibited_until_external_rekey_and_owner_verification"
      || reference?.externalRekeyRequired === true)) {
    issues.push(`${owner}: deployment_bound cannot use the repository operational reference keys`);
  }

  const contracts = {};
  for (const [field, schemaId] of Object.entries(claimTrustContractSchemas)) {
    const contractPointer = profile[field];
    if (!contractPointer) {
      issues.push(`${owner}: operational profile has no ${field}`);
      continue;
    }
    const contract = await resolvePinnedArtifact(contractPointer, path.dirname(resolved.absolute), schemaId,
      `${owner} ${field}`, issues);
    if (contract?.artifact) contracts[field] = contract;
  }

  let assuranceLevels = [];
  let riskTiers = [];
  const evaluationContexts = [];
  if (document.schemaVersion === "agent-eval-evaluation-profile-1") {
    assuranceLevels = document.supportedAssuranceLevels ?? [];
    riskTiers = document.effectiveRiskRange ?? [];
    evaluationContexts.push({ profileId: document.id, assuranceLevels, riskTiers });
  } else if (document.schemaVersion === "agent-eval-pre-run-manifest-1") {
    const suite = await resolvePinnedArtifact(document.suite, path.dirname(sourceAbsolute),
      "urn:agent-evals-standard:schema:suite-manifest:1", `${owner} suite`, issues);
    const evaluator = await resolvePinnedArtifact(document.evaluator, path.dirname(sourceAbsolute),
      "urn:agent-evals-standard:schema:evaluator-manifest:1", `${owner} evaluator`, issues);
    if (evaluator?.artifact) checkEvaluatorManifest(evaluator.artifact, evaluator.absolute, issues);
    const sealedCases = document.caseSet ?? [];
    const caseBindings = document.caseProfiles ?? [];
    const scheduledCaseIds = [...new Set((document.scheduledCells ?? []).map((cell) => cell.caseId))];
    reportDuplicateIds(sealedCases.map((entry) => entry.id), `${owner} sealed caseSet`, issues);
    reportDuplicateIds(caseBindings.map((entry) => entry.caseId), `${owner} case profile bindings`, issues);
    reportExactIds(sealedCases.map((entry) => entry.id), caseBindings.map((entry) => entry.caseId),
      `${owner} caseSet/profile bindings`, issues);
    reportExactIds(sealedCases.map((entry) => entry.id), scheduledCaseIds,
      `${owner} caseSet/scheduled cases`, issues);
    const suiteCases = new Map((suite?.artifact?.cases ?? []).map((entry) => [entry.id, entry]));
    for (const sealedCase of sealedCases) {
      const suiteCase = suiteCases.get(sealedCase.id);
      if (!suiteCase || suiteCase.digest !== sealedCase.digest) {
        issues.push(`${owner}: sealed case ${sealedCase.id} is not an exact member of the authenticated suite`);
      }
    }
    const boundProfiles = [];
    for (const binding of caseBindings) {
      const resolvedProfile = await resolveBoundEvaluationProfile(
        binding.evaluationProfile ?? {}, binding.effectiveProfileDigest, issues
      );
      if (!resolvedProfile) continue;
      const evaluationProfile = resolvedProfile.document;
      boundProfiles.push(resolvedProfile.effectiveProfile ?? evaluationProfile);
      const suiteCase = suiteCases.get(binding.caseId);
      if (suiteCase && (!sameComponent(suiteCase.evaluationProfile, binding.evaluationProfile)
        || suiteCase.effectiveProfileDigest !== binding.effectiveProfileDigest
        || !sameComponent(suiteCase.outcomeProfile, binding.outcomeProfile))) {
        issues.push(`${owner}: case ${binding.caseId} profile bindings differ from the authenticated suite`);
      }
      if (!sameProfileValue(document.claimTrustProfile, evaluationProfile.claimTrustProfile)) {
        issues.push(`${owner}: pre-run claimTrustProfile differs from ${evaluationProfile.id}@${evaluationProfile.version}`);
      }
      if (document.claimTrustUse !== evaluationProfile.claimTrustUse) {
        issues.push(`${owner}: pre-run claimTrustUse differs from ${evaluationProfile.id}@${evaluationProfile.version}`);
      }
      if (document.signatureProfile && !sameProfileValue(document.signatureProfile, evaluationProfile.signatureProfile)) {
        issues.push(`${owner}: pre-run signatureProfile differs from ${evaluationProfile.id}@${evaluationProfile.version}`);
      }
      if (document.assuranceLevel !== "A0"
        && !(resolvedProfile.effectiveProfile?.supportedAssuranceLevels ?? []).includes(document.assuranceLevel)) {
        issues.push(`${owner}: ${evaluationProfile.id} does not support assurance ${document.assuranceLevel}`);
      }
      const allowedOutcome = (resolvedProfile.effectiveProfile?.allowedOutcomeProfiles ?? []).find((entry) =>
        entry.id === binding.outcomeProfile?.id && entry.version === binding.outcomeProfile?.version
        && entry.digest === binding.outcomeProfile?.digest);
      if (!allowedOutcome && binding.bindingUse === "claims_eligible") {
        issues.push(`${owner}: case ${binding.caseId} outcome profile is not an exact allowed outcome of ${evaluationProfile.id}`);
      }
      let outcomeArtifact = null;
      if (allowedOutcome) {
        const resolvedOutcome = await resolvePinnedArtifact(allowedOutcome, path.dirname(resolvedProfile.absolute),
          "urn:agent-evals-standard:schema:outcome-profile:1",
          `${owner} case ${binding.caseId} outcome`, issues);
        outcomeArtifact = resolvedOutcome?.artifact ?? null;
      } else {
        outcomeArtifact = await resolveBoundOutcomeProfile(binding.outcomeProfile ?? {}, issues, owner);
      }
      if (outcomeArtifact && binding.bindingUse === "claims_eligible"
        && !sameWorkArtifactRegistryBinding(outcomeArtifact.workArtifactRegistry,
          resolvedProfile.effectiveProfile?.workArtifactRegistry)) {
        issues.push(`${owner}: case ${binding.caseId} outcome and evaluation profile use different work-artifact registries`);
      }
      evaluationContexts.push({
        profileId: evaluationProfile.id,
        assuranceLevels: document.claimEligibility === "claims_eligible" ? [document.assuranceLevel] : [],
        riskTiers: resolvedProfile.effectiveProfile?.effectiveRiskRange ?? []
      });
    }
    if (document.claimEligibility === "claims_eligible") assuranceLevels = [document.assuranceLevel];
    riskTiers = [...new Set(boundProfiles.flatMap((entry) => entry.effectiveRiskRange ?? []))];
  } else if (document.schemaVersion === "agent-eval-conformance-statement-1") {
    for (const slice of document.scope?.slices ?? []) {
      const binding = slice.evaluationProfile ?? {};
      try {
        const absolute = resolveRepositoryPath(path.dirname(sourceAbsolute), binding.uri);
        const resolvedProfile = await digestForPointer(absolute);
        const evaluationProfile = resolvedProfile.referenced;
        if (resolvedProfile.digest !== binding.digest || evaluationProfile?.id !== binding.id
          || evaluationProfile?.version !== binding.version) {
          throw new Error("evaluation-profile identity or digest mismatch");
        }
        if (!sameProfileValue(document.claimTrustProfile, evaluationProfile.claimTrustProfile)) {
          issues.push(`${owner}: conformance claimTrustProfile differs from ${slice.id}/${evaluationProfile.id}@${evaluationProfile.version}`);
        }
        if (document.claimTrustUse !== evaluationProfile.claimTrustUse) {
          issues.push(`${owner}: conformance claimTrustUse differs from ${slice.id}/${evaluationProfile.id}@${evaluationProfile.version}`);
        }
        if (document.signatureProfile && !sameProfileValue(document.signatureProfile, evaluationProfile.signatureProfile)) {
          issues.push(`${owner}: conformance signatureProfile differs from ${slice.id}/${evaluationProfile.id}@${evaluationProfile.version}`);
        }
        evaluationContexts.push({
          profileId: evaluationProfile.id,
          assuranceLevels: slice.assuranceLevel === "A0" ? [] : [slice.assuranceLevel],
          riskTiers: slice.riskTiers ?? []
        });
      } catch (error) {
        issues.push(`${owner}: cannot authenticate ${slice.id ?? "unknown-slice"} evaluation profile: ${error.message}`);
      }
    }
    assuranceLevels = [...new Set((document.scope?.slices ?? [])
      .map((slice) => slice.assuranceLevel).filter((level) => level && level !== "A0"))];
    riskTiers = [...new Set((document.scope?.slices ?? []).flatMap((slice) => slice.riskTiers ?? []))];
  }
  reportClaimTrustCoverage(contracts.antiRollbackPolicy?.artifact, assuranceLevels, riskTiers, owner, issues);
  await validateOperationalClaimTrustGraph(profile, contracts, evaluationContexts, owner, issues);
}

const profileSetOrders = {
  supportedAssuranceLevels: ["A1", "A2", "A3"],
  effectiveRiskRange: ["low", "medium", "high", "critical"],
  capabilityFamilies: [...closedCapabilityIds],
  interactionModes: [
    "noninteractive_repository_task",
    "interactive_repository_session",
    "pull_request_workflow",
    "ci_or_release_workflow"
  ]
};

const profileKeyedCollections = {
  // allowedOutcomeProfiles is a complete subset declaration, not a keyed delta.
  metrics: "id",
  additionalAssuranceRequirements: "id",
  exclusions: "scope",
  fixtures: "id"
};

const profileRootKeyedCollections = {
  allowedOutcomeProfiles: "id",
  requirementMapping: "requirementId",
  ...profileKeyedCollections
};

function sortByDeclaredOrder(values, order) {
  return [...values].sort((left, right) => order.indexOf(left) - order.indexOf(right));
}

function sortKeyed(values, key) {
  return [...values].sort((left, right) => left[key] < right[key] ? -1 : left[key] > right[key] ? 1 : 0);
}

function profileSemanticIdentity(value) {
  if (Array.isArray(value)) return value.map(profileSemanticIdentity);
  if (!value || typeof value !== "object") return value;
  const normalized = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, profileSemanticIdentity(item)]));
  if (typeof value.id === "string" && typeof value.version === "string"
    && typeof value.uri === "string" && typeof value.digest === "string") {
    delete normalized.uri;
  }
  return normalized;
}

function sameProfileValue(left, right) {
  return canonicalize(profileSemanticIdentity(left)) === canonicalize(profileSemanticIdentity(right));
}

function exactProfileDeclaration(left, right) {
  return canonicalize(left) === canonicalize(right);
}

function provenance(sourceProfileId, sourceProfileVersion, operation) {
  return { sourceProfileId, sourceProfileVersion, operation };
}

function arrayContainsCanonical(superset, subset) {
  const values = new Set((superset ?? []).map(canonicalize));
  return (subset ?? []).every((value) => values.has(canonicalize(value)));
}

function keyedContainsCanonical(parentValues, childValues, key) {
  const childByKey = new Map((childValues ?? []).map((value) => [value?.[key], value]));
  return (parentValues ?? []).every((parentValue) => {
    const childValue = childByKey.get(parentValue?.[key]);
    return childValue !== undefined && canonicalize(childValue) === canonicalize(parentValue);
  });
}

function obligationRelation(pointer, parentContract, childContract) {
  if (pointer === "/requirementMapping") {
    return {
      preserved: false,
      stronger: false,
      reason: "requirementMapping is a complete neutral leaf routing table and has no replacement relation"
    };
  }
  if (pointer === "/gateRegistry") {
    const parentGates = parentContract?.profileGates;
    const childGates = childContract?.profileGates;
    if (!Array.isArray(parentContract?.coreGates) || !Array.isArray(childContract?.coreGates)
      || !Array.isArray(parentGates) || !Array.isArray(childGates)
      || parentGates.some((entry) => !entry || typeof entry !== "object" || typeof entry.id !== "string")
      || childGates.some((entry) => !entry || typeof entry !== "object" || typeof entry.id !== "string")) {
      return { preserved: false, stronger: false, reason: "gate contracts do not expose typed obligation sets" };
    }
    const corePreserved = arrayContainsCanonical(childContract.coreGates, parentContract.coreGates);
    const gatesPreserved = keyedContainsCanonical(parentGates, childGates, "id");
    const unknownPreserved = canonicalize(parentContract.unknownOrIndeterminate)
      === canonicalize(childContract.unknownOrIndeterminate);
    const preserved = corePreserved && gatesPreserved && unknownPreserved;
    const stronger = preserved && (childContract.coreGates.length > parentContract.coreGates.length
      || childGates.length > parentGates.length);
    return { preserved, stronger, reason: "gate obligation containment" };
  }
  if (pointer === "/caseQa") {
    const typed = Array.isArray(parentContract?.requiredStages) && Array.isArray(childContract?.requiredStages)
      && Array.isArray(parentContract?.requiredControls) && Array.isArray(childContract?.requiredControls);
    if (!typed) return { preserved: false, stronger: false, reason: "case-QA contracts do not expose typed obligation sets" };
    const stages = arrayContainsCanonical(childContract.requiredStages, parentContract.requiredStages);
    const controls = arrayContainsCanonical(childContract.requiredControls, parentContract.requiredControls);
    const rules = parentContract.activationRule === childContract.activationRule
      && parentContract.materialChangeRule === childContract.materialChangeRule;
    const preserved = stages && controls && rules;
    const stronger = preserved && (childContract.requiredStages.length > parentContract.requiredStages.length
      || childContract.requiredControls.length > parentContract.requiredControls.length);
    return { preserved, stronger, reason: "case-QA obligation containment" };
  }
  if (pointer === "/failureTaxonomy") {
    if (!Array.isArray(parentContract?.mappings) || !Array.isArray(childContract?.mappings)) {
      return { preserved: false, stronger: false, reason: "failure taxonomies do not expose typed mappings" };
    }
    const preserved = keyedContainsCanonical(parentContract.mappings, childContract.mappings, "id");
    return {
      preserved,
      stronger: preserved && childContract.mappings.length > parentContract.mappings.length,
      reason: "failure-taxonomy mapping containment"
    };
  }
  const parentSet = Array.isArray(parentContract) ? parentContract : parentContract?.values;
  const childSet = Array.isArray(childContract) ? childContract : childContract?.values;
  if (Array.isArray(parentSet) && Array.isArray(childSet)) {
    const childIsSubset = arrayContainsCanonical(parentSet, childSet);
    return {
      preserved: childIsSubset,
      stronger: childIsSubset && childSet.length < parentSet.length,
      reason: "explicit set-valued contract containment"
    };
  }
  return { preserved: false, stronger: false, reason: `no closed obligation relation is defined for ${pointer}` };
}

async function loadProfileResolutionContext(document, sourceAbsolute, issues) {
  const pointer = document.resolutionEvidence;
  if (!pointer) {
    issues.push("effectiveProfileDigest: child profile has no resolutionEvidence");
    return null;
  }
  try {
    const absolute = resolveRepositoryPath(path.dirname(sourceAbsolute), pointer.uri);
    const resolved = await digestForPointer(absolute);
    if (pointer.digest !== resolved.digest) throw new Error(`resolution record digest must be ${resolved.digest}`);
    if (pointer.id !== resolved.referenced?.id || pointer.version !== resolved.referenced?.version) {
      throw new Error(`resolution record identity must be ${resolved.referenced?.id}@${resolved.referenced?.version}`);
    }
    const validate = ajv.getSchema("urn:agent-evals-standard:schema:profile-resolution-record:1");
    if (!resolved.referenced || !validate(resolved.referenced)) {
      throw new Error(`resolution record schema invalid: ${ajv.errorsText(validate?.errors ?? [])}`);
    }
    if (resolved.referenced.profile?.id !== document.id || resolved.referenced.profile?.version !== document.version) {
      throw new Error(`resolution record does not bind ${document.id}@${document.version}`);
    }
    return { record: resolved.referenced, absolute };
  } catch (error) {
    issues.push(`effectiveProfileDigest: cannot authenticate resolution record: ${error.message}`);
    return null;
  }
}

const profileResolutionProofInputsSchemaId = "urn:agent-evals-standard:schema:profile-resolution-proof-inputs:1";

async function loadProfileResolutionProofInputs(evidence, recordAbsolute, owner, issues) {
  const start = issues.length;
  const signatureProblem = fixtureSignatureProblem(evidence);
  if (signatureProblem) issues.push(`${owner}: ${signatureProblem}`);
  const evidenceIssues = [];
  await checkEvidencePayload(evidence, recordAbsolute, evidenceIssues);
  issues.push(...evidenceIssues.map((issue) => `${owner}: ${issue}`));

  let payload;
  try {
    if (evidence.payload?.kind === "repository_relative") {
      const payloadAbsolute = resolveRepositoryPath(path.dirname(recordAbsolute), evidence.payload.path);
      payload = await readJsonStrict(payloadAbsolute);
    } else if (evidence.payload?.kind === "inline_base64") {
      payload = parseIJson(Buffer.from(evidence.payload.contentBase64, "base64").toString("utf8"), owner);
    } else {
      throw new Error("proof-input evidence must use repository_relative or inline_base64 JSON bytes");
    }
    const validate = ajv.getSchema(profileResolutionProofInputsSchemaId);
    if (!validate(payload)) {
      issues.push(`${owner}: proof-input payload schema invalid: ${ajv.errorsText(validate.errors)}`);
    }
  } catch (error) {
    issues.push(`${owner}: ${error.message}`);
  }
  return issues.length === start ? payload : null;
}

async function authenticateReplacementInputs(proof, context, issues) {
  const target = proofTarget(proof);
  for (const evidenceId of proof.evidenceIds ?? []) {
    const matches = (context.record.evidenceManifest ?? []).filter((entry) => entry.id === evidenceId);
    if (matches.length !== 1) {
      issues.push(`effectiveProfileDigest: proof ${target} evidence ${evidenceId} resolves ${matches.length} entries`);
      continue;
    }
    const payload = await loadProfileResolutionProofInputs(
      matches[0],
      context.absolute,
      `effectiveProfileDigest: proof evidence ${evidenceId}`,
      issues
    );
    if (!payload) continue;
    if (!exactProfileDeclaration(payload.profile, context.record.profile)) {
      issues.push(`effectiveProfileDigest: proof evidence ${evidenceId} does not bind the resolution profile`);
    }
    const inputMatches = (payload.proofInputs ?? []).filter((entry) => entry.target === target);
    if (inputMatches.length !== 1) {
      issues.push(`effectiveProfileDigest: proof evidence ${evidenceId} target ${target} resolves ${inputMatches.length} inputs`);
      continue;
    }
    if (!exactProfileDeclaration(inputMatches[0].parent, proof.parent)
      || !exactProfileDeclaration(inputMatches[0].child, proof.child)) {
      issues.push(`effectiveProfileDigest: proof evidence ${evidenceId} does not reproduce ${target} parent and child inputs`);
    }
  }
}

async function resolveProofPointer(pointer, baseAbsolute, label, issues) {
  try {
    const absolute = resolveRepositoryPath(path.dirname(baseAbsolute), pointer.uri);
    const resolved = await digestForPointer(absolute);
    if (pointer.digest !== resolved.digest) throw new Error(`declared digest must be ${resolved.digest}`);
    if (resolved.referenced?.id !== undefined && pointer.id !== resolved.referenced.id) {
      throw new Error(`declared id must be ${resolved.referenced.id}`);
    }
    if (resolved.referenced?.version !== undefined && pointer.version !== resolved.referenced.version) {
      throw new Error(`declared version must be ${resolved.referenced.version}`);
    }
    return resolved;
  } catch (error) {
    issues.push(`effectiveProfileDigest: ${label}: ${error.message}`);
    return null;
  }
}

async function validateReplacementProof(expected, context, parentAbsolute, childAbsolute, issues) {
  if (!context) return null;
  const target = `${expected.pointer}${expected.key === undefined ? "" : `/${expected.key}`}`;
  const matches = (context.record.replacementProofs ?? []).filter((proof) => proofTarget(proof) === target);
  if (matches.length !== 1) {
    issues.push(`effectiveProfileDigest: ${target} requires exactly one replacement proof, found ${matches.length}`);
    return null;
  }
  const proof = matches[0];
  const start = issues.length;
  if (proof.targetKind !== expected.targetKind || proof.pointer !== expected.pointer || proof.key !== expected.key) {
    issues.push(`effectiveProfileDigest: malformed proof target ${target}`);
  }
  if (!exactProfileDeclaration(proof.parent, expected.parent)) {
    issues.push(`effectiveProfileDigest: proof ${target} does not bind the parent declaration`);
  }
  if (!exactProfileDeclaration(proof.child, expected.child)) {
    issues.push(`effectiveProfileDigest: proof ${target} does not bind the child declaration`);
  }
  await authenticateReplacementInputs(proof, context, issues);
  const parentResolved = await resolveProofPointer(proof.parent, parentAbsolute, `${target} parent proof`, issues);
  const childResolved = await resolveProofPointer(proof.child, childAbsolute, `${target} child proof`, issues);
  if (!parentResolved || !childResolved || issues.length !== start) return null;

  const equalContent = parentResolved.digest === childResolved.digest;
  const relation = obligationRelation(expected.pointer, parentResolved.referenced, childResolved.referenced);
  let valid = false;
  if (proof.relation === "content_equal") valid = equalContent;
  else if (proof.relation === "subset") valid = relation.preserved;
  else if (proof.relation === "preserves") valid = relation.preserved;
  else if (proof.relation === "strengthens") valid = relation.preserved && relation.stronger;
  if (!valid) {
    issues.push(`effectiveProfileDigest: proof ${target} falsely claims ${proof.relation} (${relation.reason})`);
    return null;
  }
  return proof.relation;
}

async function mergeProfileCollection(field, parentValues, childValues, document, parentAbsolute, childAbsolute, context, parentSources, issues) {
  const key = profileKeyedCollections[field];
  const merged = new Map((parentValues ?? []).map((entry) => [entry[key], clone(entry)]));
  const sources = new Map((parentValues ?? []).map((entry) => {
    const identity = entry[key];
    const inherited = parentSources.get(profileResolutionPair(field, identity));
    return [identity, provenance(inherited?.sourceProfileId ?? document.parentProfile.id,
      inherited?.sourceProfileVersion ?? document.parentProfile.version, "inherited")];
  }));
  reportDuplicateIds((childValues ?? []).map((entry) => entry[key]), `effectiveProfileDigest child ${field}`, issues);
  for (const childValue of childValues ?? []) {
    const identity = childValue[key];
    if (typeof childValue.uri === "string" && childValue.uri.startsWith("tombstone:")) {
      issues.push(`effectiveProfileDigest: deletion attempt at /${field}/${identity}; PROFILE-001 defines no deletion or tombstone operation`);
      continue;
    }
    if (!merged.has(identity)) {
      merged.set(identity, clone(childValue));
      sources.set(identity, provenance(document.id, document.version, "strengthens"));
      continue;
    }
    const parentValue = merged.get(identity);
    if (exactProfileDeclaration(parentValue, childValue)) continue;

    if (field === "exclusions") {
      const strength = { not_applicable: 0, insufficient_evidence: 1, forbidden: 2 };
      const monotonic = childValue.reason === parentValue.reason
        && strength[childValue.claimEffect] >= strength[parentValue.claimEffect];
      if (!monotonic) {
        issues.push(`effectiveProfileDigest: exclusions key ${identity} is not a monotonic restriction`);
        continue;
      }
      merged.set(identity, clone(childValue));
      sources.set(identity, provenance(document.id, document.version,
        childValue.claimEffect === parentValue.claimEffect ? "preserves" : "strengthens"));
      continue;
    }

    const parentPointer = artifactPointerForProfileValue(field, parentValue);
    const childPointer = artifactPointerForProfileValue(field, childValue);
    if (!parentPointer || !childPointer) {
      issues.push(`effectiveProfileDigest: ${field} key ${identity} has no closed proof contract`);
      continue;
    }
    const relation = await validateReplacementProof({
      targetKind: "keyed", pointer: `/${field}`, key: identity, parent: parentPointer, child: childPointer
    }, context, parentAbsolute, childAbsolute, issues);
    if (!relation) continue;
    if (relation === "content_equal" && sameProfileValue(parentValue, childValue)) {
      sources.set(identity, provenance(sources.get(identity).sourceProfileId,
        sources.get(identity).sourceProfileVersion, "content_equal"));
      continue;
    }
    merged.set(identity, clone(childValue));
    sources.set(identity, provenance(document.id, document.version, relation));
  }
  return { values: sortKeyed([...merged.values()], key), sources };
}

function resolveAllowedOutcomeProfileIdSubset(parentIds, childIds) {
  const parent = new Set(parentIds);
  const childCounts = occurrenceCounts(childIds);
  return {
    nonempty: childIds.length > 0,
    effectiveIds: [...new Set(childIds.filter((id) => parent.has(id)))].sort(),
    addedIds: [...new Set(childIds.filter((id) => !parent.has(id)))].sort(),
    duplicateIds: [...childCounts.entries()].filter(([, count]) => count > 1).map(([id]) => id).sort()
  };
}

function runAllowedOutcomeProfileResolverVectors() {
  const vectors = [
    {
      id: "nonempty-2-to-1-narrowing",
      parentIds: ["outcome-a", "outcome-b"],
      childIds: ["outcome-b"],
      expected: { nonempty: true, effectiveIds: ["outcome-b"], addedIds: [], duplicateIds: [] }
    },
    {
      id: "unrelated-id-expansion",
      parentIds: ["outcome-a", "outcome-b"],
      childIds: ["outcome-b", "outcome-c"],
      expected: { nonempty: true, effectiveIds: ["outcome-b"], addedIds: ["outcome-c"], duplicateIds: [] }
    }
  ];
  for (const vector of vectors) {
    const actual = resolveAllowedOutcomeProfileIdSubset(vector.parentIds, vector.childIds);
    if (canonicalize(actual) !== canonicalize(vector.expected)) {
      throw new Error(`allowedOutcomeProfiles pure resolver vector ${vector.id} failed`);
    }
  }
}

runAllowedOutcomeProfileResolverVectors();

async function resolveAllowedOutcomeProfiles(parentValues, childValues, document, parentAbsolute, childAbsolute, context, parentSources, issues) {
  const parentById = new Map((parentValues ?? []).map((entry) => [entry.id, entry]));
  const childEntries = childValues ?? [];
  const childIds = childEntries.map((entry) => entry.id);
  const subset = resolveAllowedOutcomeProfileIdSubset([...parentById.keys()], childIds);
  if (!subset.nonempty) {
    issues.push("effectiveProfileDigest: child allowedOutcomeProfiles must be a nonempty complete declaration");
  }
  reportDuplicateIds(childIds, "effectiveProfileDigest child allowedOutcomeProfiles IDs", issues);
  for (const id of subset.addedIds) {
    issues.push(`effectiveProfileDigest: child allowedOutcomeProfiles adds ${id}, which is absent from authenticated parent ${document.parentProfile.id}`);
  }

  const addedIds = new Set(subset.addedIds);
  const seen = new Set();
  const values = [];
  const sources = new Map();
  for (const childValue of childEntries) {
    const identity = childValue.id;
    if (seen.has(identity)) continue;
    seen.add(identity);
    if (addedIds.has(identity)) continue;
    if (typeof childValue.uri === "string" && childValue.uri.startsWith("tombstone:")) {
      issues.push(`effectiveProfileDigest: allowedOutcomeProfiles ${identity} uses a forbidden tombstone URI; omit the parent ID to narrow instead`);
      continue;
    }

    const parentValue = parentById.get(identity);
    const inherited = parentSources.get(profileResolutionPair("allowedOutcomeProfiles", identity));
    if (exactProfileDeclaration(parentValue, childValue)) {
      const parentResolved = await resolveProofPointer(parentValue, parentAbsolute,
        `allowedOutcomeProfiles/${identity} parent binding`, issues);
      const childResolved = await resolveProofPointer(childValue, childAbsolute,
        `allowedOutcomeProfiles/${identity} child binding`, issues);
      if (!parentResolved || !childResolved || parentResolved.digest !== childResolved.digest) continue;
      values.push(clone(parentValue));
      sources.set(identity, provenance(inherited?.sourceProfileId ?? document.parentProfile.id,
        inherited?.sourceProfileVersion ?? document.parentProfile.version, "inherited"));
      continue;
    }

    const relation = await validateReplacementProof({
      targetKind: "keyed",
      pointer: "/allowedOutcomeProfiles",
      key: identity,
      parent: parentValue,
      child: childValue
    }, context, parentAbsolute, childAbsolute, issues);
    if (!relation) continue;
    if (!["content_equal", "preserves", "strengthens"].includes(relation)) {
      issues.push(`effectiveProfileDigest: /allowedOutcomeProfiles/${identity} proof relation ${relation} is not permitted`);
      continue;
    }
    if (relation === "content_equal" && sameProfileValue(parentValue, childValue)) {
      values.push(clone(parentValue));
      sources.set(identity, provenance(inherited?.sourceProfileId ?? document.parentProfile.id,
        inherited?.sourceProfileVersion ?? document.parentProfile.version, "content_equal"));
    } else {
      values.push(clone(childValue));
      sources.set(identity, provenance(document.id, document.version, relation));
    }
  }
  return { values: sortKeyed(values, "id"), sources };
}

function artifactIdentity(value) {
  return value && { id: value.id, version: value.version, digest: value.digest };
}

async function authenticateCanonicalRequirementRegistry(document, sourceAbsolute, owner, issues) {
  const registry = await loadRequirementRegistry(owner, issues);
  if (!registry) return null;
  const canonicalIdentity = {
    id: "agent-evals-standard-requirements",
    version: registry.standardVersion,
    digest: registry.digest
  };
  const declared = document.baseCompatibility?.requirementRegistry;
  if (canonicalize(artifactIdentity(declared)) !== canonicalize(canonicalIdentity)) {
    issues.push(`${owner}: baseCompatibility must bind the canonical distributed requirement registry`);
    return null;
  }
  try {
    const absolute = resolveRepositoryPath(path.dirname(sourceAbsolute), declared.uri);
    const resolved = await digestForPointer(absolute);
    if (resolved.digest !== canonicalIdentity.digest || resolved.digest !== declared.digest) {
      throw new Error(`registry digest must be ${canonicalIdentity.digest}`);
    }
    if (resolved.referenced?.schemaVersion !== "agent-eval-requirement-registry-1"
      || resolved.referenced?.standardVersion !== canonicalIdentity.version) {
      throw new Error(`registry identity must be ${canonicalIdentity.id}@${canonicalIdentity.version}`);
    }
    const validate = ajv.getSchema("urn:agent-evals-standard:schema:requirement-registry:1");
    if (!validate || !validate(resolved.referenced)) {
      throw new Error(`registry schema invalid: ${ajv.errorsText(validate?.errors ?? [])}`);
    }
  } catch (error) {
    issues.push(`${owner}: cannot authenticate canonical requirement registry: ${error.message}`);
    return null;
  }
  return { registry, canonicalIdentity };
}

async function validateLeafRequirementMapping(document, sourceAbsolute, owner, issues) {
  const canonical = await authenticateCanonicalRequirementRegistry(document, sourceAbsolute, owner, issues);
  if (!canonical) return false;
  const rows = document.requirementMapping ?? [];
  const pointer = rows[0]?.implementation;
  if (!pointer) {
    issues.push(`${owner}: requirementMapping has no implementation contract`);
    return false;
  }

  let contract;
  try {
    const absolute = resolveRepositoryPath(path.dirname(sourceAbsolute), pointer.uri);
    const resolved = await digestForPointer(absolute);
    if (resolved.digest !== pointer.digest) throw new Error(`contract digest must be ${resolved.digest}`);
    if (resolved.referenced?.id !== pointer.id || resolved.referenced?.version !== pointer.version) {
      throw new Error(`contract identity must be ${resolved.referenced?.id}@${resolved.referenced?.version}`);
    }
    const validate = ajv.getSchema("urn:agent-evals-standard:schema:requirement-implementation-contract:1");
    if (!resolved.referenced || !validate || !validate(resolved.referenced)) {
      throw new Error(`contract schema invalid: ${ajv.errorsText(validate?.errors ?? [])}`);
    }
    contract = resolved.referenced;
  } catch (error) {
    issues.push(`${owner}: cannot authenticate requirement implementation contract: ${error.message}`);
    return false;
  }

  const distributionResolver = await distributionRequirementMappingResolver();
  const routingIssues = validateRequirementImplementationRouting({
    profile: document,
    registry: canonical.registry,
    canonicalRegistryIdentity: canonical.canonicalIdentity,
    contract,
    contractPointer: pointer,
    distributionResolver
  });
  issues.push(...routingIssues.map((issue) => `${owner}: ${issue}`));
  return routingIssues.length === 0;
}

function makeRootEffectiveProfile(document, issues) {
  const effective = clone(document);
  effective.parentProfile = null;
  for (const key of ["fixtures", "conflictReport", "resolutionEvidence", "effectiveProfileDigest", "digest", "signature"]) delete effective[key];
  for (const [field, order] of Object.entries(profileSetOrders)) {
    effective[field] = sortByDeclaredOrder(effective[field] ?? [], order);
  }
  for (const [field, key] of Object.entries(profileRootKeyedCollections)) {
    if (field === "fixtures") continue;
    reportDuplicateIds((effective[field] ?? []).map((entry) => entry[key]), `effectiveProfileDigest root ${field}`, issues);
    effective[field] = sortKeyed(effective[field] ?? [], key);
  }
  for (const row of effective.requirementMapping ?? []) {
    if (row.sourceProfileId !== document.id) {
      issues.push(`effectiveProfileDigest: root requirement ${row.requirementId} sourceProfileId must be ${document.id}`);
    }
  }
  return effective;
}

async function makeRootEffectiveProfileDetailed(document, sourceAbsolute, issues) {
  const effective = makeRootEffectiveProfile(document, issues);
  const fixtureBindings = await mergeProfileFixtureBindings(document, sourceAbsolute, [], issues);
  const fieldSources = new Map(profileResolutionFieldPointers.map((pointer) => [
    pointer,
    provenance(document.id, document.version, pointer === "/parentProfile" ? "derived" : "leaf_identity")
  ]));
  const keyedSources = new Map();
  for (const [field, key] of Object.entries(profileResolutionKeyedCollections)) {
    for (const value of effective[field] ?? []) {
      keyedSources.set(profileResolutionPair(field, value[key]), provenance(
        document.id,
        document.version,
        field === "requirementMapping" ? "leaf_complete" : "preserves"
      ));
    }
  }
  return { effective, fieldSources, keyedSources, fixtureBindings };
}

async function resolveEffectiveProfileDetailed(document, sourceAbsolute, issues, stack = [], resolutionContextOverride = null) {
  const resolvedSource = path.resolve(sourceAbsolute);
  if (stack.includes(resolvedSource)) {
    issues.push(`effectiveProfileDigest: inheritance cycle at ${path.relative(root, resolvedSource)}`);
    return null;
  }
  const sourceBindingIssues = [];
  await checkSignatureProfileBinding(document, sourceAbsolute, sourceBindingIssues);
  issues.push(...sourceBindingIssues.map((issue) => `effectiveProfileDigest source authentication: ${issue}`));
  const sourceSignatureProblem = await artifactSignatureProblem(document);
  if (sourceSignatureProblem) {
    issues.push(`effectiveProfileDigest source authentication: signature: ${sourceSignatureProblem}`);
  }
  await resolveWorkArtifactRegistry(document.workArtifactRegistry, path.dirname(sourceAbsolute),
    "effectiveProfileDigest", issues);
  await validateLeafRequirementMapping(document, sourceAbsolute, "effectiveProfileDigest", issues);
  const leafSignature = resolveLeafSignatureBinding(document, "effectiveProfileDigest");
  issues.push(...leafSignature.issues);
  const leafTrust = resolveLeafClaimTrustBinding(document, "effectiveProfileDigest");
  issues.push(...leafTrust.issues);
  if (document.parentProfile === null) return makeRootEffectiveProfileDetailed(document, sourceAbsolute, issues);

  let parentAbsolute;
  let parentDocument;
  try {
    parentAbsolute = resolveRepositoryPath(path.dirname(sourceAbsolute), document.parentProfile.uri);
    if ([...stack, resolvedSource].includes(parentAbsolute)) {
      issues.push(`effectiveProfileDigest: inheritance cycle at ${path.relative(root, parentAbsolute)}`);
      return null;
    }
    const resolved = await digestForPointer(parentAbsolute);
    parentDocument = resolved.referenced;
    if (!parentDocument) throw new Error("parent profile is not a self-digested JSON artifact");
    if (document.parentProfile.digest !== resolved.digest) throw new Error(`parent digest must be ${resolved.digest}`);
    if (document.parentProfile.id !== parentDocument.id) throw new Error(`parent id must be ${parentDocument.id}`);
    if (document.parentProfile.version !== parentDocument.version) throw new Error(`parent version must be ${parentDocument.version}`);
    const validate = ajv.getSchema("urn:agent-evals-standard:schema:evaluation-profile:1");
    if (!validate(parentDocument)) throw new Error(`parent schema invalid: ${ajv.errorsText(validate.errors)}`);
  } catch (error) {
    issues.push(`effectiveProfileDigest: cannot authenticate parent: ${error.message}`);
    return null;
  }

  const parentDetail = await resolveEffectiveProfileDetailed(parentDocument, parentAbsolute, issues, [...stack, resolvedSource]);
  if (!parentDetail) return null;
  const parentEffective = parentDetail.effective;
  if (!sameProfileValue(document.baseCompatibility, parentEffective.baseCompatibility)) {
    issues.push("effectiveProfileDigest: child baseCompatibility differs from parent");
  }
  if (!sameProfileValue(document.caseContract, parentEffective.caseContract)) {
    issues.push("effectiveProfileDigest: child caseContract differs from parent");
  }
  if (!sameProfileValue(document.workArtifactRegistry, parentEffective.workArtifactRegistry)) {
    issues.push("effectiveProfileDigest: child workArtifactRegistry differs from parent");
  }

  const effective = clone(parentEffective);
  const fieldSources = new Map();
  const keyedSources = new Map();
  for (const field of ["schemaVersion", "id", "namespace", "owner", "version"]) effective[field] = clone(document[field]);
  if (leafSignature.binding) effective.signatureProfile = leafSignature.binding;
  if (leafTrust.binding) {
    effective.claimTrustProfile = leafTrust.binding.claimTrustProfile;
    effective.claimTrustUse = leafTrust.binding.claimTrustUse;
  }
  effective.parentProfile = null;
  for (const field of ["schemaVersion", "id", "namespace", "owner", "version"]) {
    fieldSources.set(`/${field}`, provenance(document.id, document.version, "leaf_identity"));
  }
  fieldSources.set("/parentProfile", provenance(document.id, document.version, "derived"));
  for (const field of ["baseCompatibility", "caseContract", "workArtifactRegistry"]) {
    const parentSource = parentDetail.fieldSources.get(`/${field}`);
    fieldSources.set(`/${field}`, provenance(parentSource.sourceProfileId, parentSource.sourceProfileVersion, "exact_match"));
  }
  for (const field of ["signatureProfile", "claimTrustProfile", "claimTrustUse"]) {
    fieldSources.set(`/${field}`, provenance(document.id, document.version, "leaf_identity"));
  }

  for (const [field, order] of Object.entries(profileSetOrders)) {
    const parentSet = parentEffective[field] ?? [];
    const childSet = document[field] ?? [];
    if (childSet.some((value) => !parentSet.includes(value))) {
      issues.push(`effectiveProfileDigest: child ${field} expands the parent set`);
    }
    effective[field] = sortByDeclaredOrder(childSet, order);
    fieldSources.set(`/${field}`, provenance(document.id, document.version, "subset_replace"));
  }

  const resolutionContext = resolutionContextOverride
    ?? await loadProfileResolutionContext(document, sourceAbsolute, issues);
  const outcomes = await resolveAllowedOutcomeProfiles(
    parentEffective.allowedOutcomeProfiles,
    document.allowedOutcomeProfiles,
    document,
    parentAbsolute,
    sourceAbsolute,
    resolutionContext,
    parentDetail.keyedSources,
    issues
  );
  effective.allowedOutcomeProfiles = outcomes.values;
  for (const [key, source] of outcomes.sources) {
    keyedSources.set(profileResolutionPair("allowedOutcomeProfiles", key), source);
  }
  for (const field of ["gateRegistry", "caseQa", "failureTaxonomy"]) {
    const parentSource = parentDetail.fieldSources.get(`/${field}`);
    if (exactProfileDeclaration(document[field], parentEffective[field])) {
      effective[field] = clone(parentEffective[field]);
      fieldSources.set(`/${field}`, provenance(parentSource.sourceProfileId, parentSource.sourceProfileVersion, "inherited"));
      continue;
    }
    const relation = await validateReplacementProof({
      targetKind: "singleton", pointer: `/${field}`, key: undefined,
      parent: parentEffective[field], child: document[field]
    }, resolutionContext, parentAbsolute, sourceAbsolute, issues);
    if (!relation) continue;
    if (relation === "content_equal") {
      effective[field] = clone(parentEffective[field]);
      fieldSources.set(`/${field}`, provenance(parentSource.sourceProfileId, parentSource.sourceProfileVersion, "content_equal"));
    } else {
      effective[field] = clone(document[field]);
      fieldSources.set(`/${field}`, provenance(document.id, document.version, relation));
    }
  }

  for (const field of Object.keys(profileKeyedCollections)) {
    if (field === "fixtures") continue;
    const merged = await mergeProfileCollection(field, parentEffective[field], document[field], document,
      parentAbsolute, sourceAbsolute, resolutionContext, parentDetail.keyedSources, issues);
    effective[field] = merged.values;
    for (const [key, source] of merged.sources) keyedSources.set(profileResolutionPair(field, key), source);
  }
  effective.requirementMapping = sortKeyed(clone(document.requirementMapping ?? []), "requirementId");
  for (const row of effective.requirementMapping) {
    keyedSources.set(
      profileResolutionPair("requirementMapping", row.requirementId),
      provenance(document.id, document.version, "leaf_complete")
    );
  }
  const fixtureBindings = await mergeProfileFixtureBindings(
    document,
    sourceAbsolute,
    parentDetail.fixtureBindings,
    issues
  );
  return { effective, fieldSources, keyedSources, fixtureBindings };
}

async function resolveEffectiveProfile(document, sourceAbsolute, issues, stack = []) {
  const detail = await resolveEffectiveProfileDetailed(document, sourceAbsolute, issues, stack);
  return detail?.effective ?? null;
}

async function checkEffectiveProfileDigest(document, sourceAbsolute, issues) {
  if (document.caseContract?.id === "repo-change-case-contract") {
    await resolvePinnedArtifact(
      document.caseContract,
      path.dirname(sourceAbsolute),
      "urn:agent-evals-standard:schema:repo-change-case-contract:1",
      "effectiveProfileDigest caseContract",
      issues
    );
  }
  const effective = await resolveEffectiveProfile(document, sourceAbsolute, issues);
  if (!effective) return;
  const registry = await loadRequirementRegistry("effectiveProfileDigest", issues);
  if (registry) {
    reportExactIds(
      (registry.requirements ?? []).map((entry) => entry.id),
      (effective.requirementMapping ?? []).map((entry) => entry.requirementId),
      "effectiveProfileDigest requirement coverage",
      issues
    );
  }
  const actual = sha256Canonical(effective);
  if (document.effectiveProfileDigest !== actual) {
    issues.push(`effectiveProfileDigest: expected ${actual}, found ${document.effectiveProfileDigest}`);
  }
}

const profileResolutionFieldPointers = [
  "/baseCompatibility",
  "/capabilityFamilies",
  "/caseContract",
  "/caseQa",
  "/claimTrustProfile",
  "/claimTrustUse",
  "/effectiveRiskRange",
  "/failureTaxonomy",
  "/gateRegistry",
  "/id",
  "/interactionModes",
  "/namespace",
  "/owner",
  "/parentProfile",
  "/schemaVersion",
  "/signatureProfile",
  "/supportedAssuranceLevels",
  "/version",
  "/workArtifactRegistry"
];

const profileResolutionKeyedCollections = {
  allowedOutcomeProfiles: "id",
  requirementMapping: "requirementId",
  ...Object.fromEntries(Object.entries(profileKeyedCollections).filter(([field]) => field !== "fixtures"))
};

function profileResolutionPair(collection, key) {
  return `${collection}/${key}`;
}

function proofTarget(proof) {
  return `${proof.pointer}${proof.key === undefined ? "" : `/${proof.key}`}`;
}

function artifactPointerForProfileValue(field, value) {
  if (value && typeof value === "object"
    && typeof value.id === "string" && typeof value.version === "string"
    && typeof value.uri === "string" && typeof value.digest === "string") return value;
  return null;
}

async function collectAuthenticatedParentChain(document, sourceAbsolute, issues) {
  const leafAbsolute = path.resolve(sourceAbsolute);
  const seenPaths = new Set([leafAbsolute]);
  const seenIdentities = new Set([`${document.id}@${document.version}`]);
  const reverseChain = [];
  let current = document;
  let currentAbsolute = leafAbsolute;

  while (current.parentProfile !== null) {
    const pointer = current.parentProfile;
    let parentAbsolute;
    try {
      parentAbsolute = resolveRepositoryPath(path.dirname(currentAbsolute), pointer.uri);
      const identity = `${pointer.id}@${pointer.version}`;
      if (seenPaths.has(parentAbsolute) || seenIdentities.has(identity)) {
        issues.push(`profileInheritance: inheritance cycle at ${identity}`);
        return null;
      }
      const resolved = await digestForPointer(parentAbsolute);
      const parent = resolved.referenced;
      if (!parent) throw new Error("parent is not a self-digested JSON profile");
      if (pointer.digest !== resolved.digest) {
        throw new Error(`parent digest mismatch for ${identity}: declared ${pointer.digest}, resolved ${resolved.digest}`);
      }
      if (pointer.id !== parent.id || pointer.version !== parent.version) {
        throw new Error(`parent identity mismatch for ${identity}: resolved ${parent.id}@${parent.version}`);
      }
      const validate = ajv.getSchema("urn:agent-evals-standard:schema:evaluation-profile:1");
      if (!validate(parent)) throw new Error(`parent schema invalid: ${ajv.errorsText(validate.errors)}`);
      reverseChain.push({ pointer: clone(pointer), document: parent, absolute: parentAbsolute });
      seenPaths.add(parentAbsolute);
      seenIdentities.add(identity);
      current = parent;
      currentAbsolute = parentAbsolute;
    } catch (error) {
      issues.push(`profileInheritance: cannot authenticate parent: ${error.message}`);
      return null;
    }
  }
  return reverseChain.reverse();
}

function reportCanonicalArray(actual, expected, owner, issues) {
  if (canonicalize(actual) !== canonicalize(expected)) {
    issues.push(`${owner}: expected ${canonicalize(expected)}, found ${canonicalize(actual)}`);
  }
}

async function validateResolutionEvidence(record, sourceAbsolute, issues) {
  const evidenceIds = (record.evidenceManifest ?? []).map((entry) => entry.id);
  reportDuplicateIds(evidenceIds, "profileResolutionRecord evidenceManifest", issues);
  reportCanonicalArray(evidenceIds, [...evidenceIds].sort(), "profileResolutionRecord evidenceManifest ordering", issues);
  const counts = occurrenceCounts(evidenceIds);
  const proofByTarget = new Map((record.replacementProofs ?? []).map((proof) => [proofTarget(proof), proof]));
  for (const proof of record.replacementProofs ?? []) {
    for (const evidenceId of proof.evidenceIds ?? []) {
      if (counts.get(evidenceId) !== 1) {
        issues.push(`profileResolutionRecord: proof ${proofTarget(proof)} evidence ID ${evidenceId} resolves ${counts.get(evidenceId) ?? 0} times`);
      }
    }
  }
  for (const evidence of record.evidenceManifest ?? []) {
    const payload = await loadProfileResolutionProofInputs(
      evidence,
      sourceAbsolute,
      `profileResolutionRecord evidence ${evidence.id}`,
      issues
    );
    if (!payload) continue;
    if (!exactProfileDeclaration(payload.profile, record.profile)) {
      issues.push(`profileResolutionRecord evidence ${evidence.id}: profile binding differs from the resolution record`);
    }
    const targets = (payload.proofInputs ?? []).map((entry) => entry.target);
    reportDuplicateIds(targets, `profileResolutionRecord evidence ${evidence.id} proof-input targets`, issues);
    reportCanonicalArray(targets, [...targets].sort(), `profileResolutionRecord evidence ${evidence.id} proof-input ordering`, issues);
    for (const input of payload.proofInputs ?? []) {
      const proof = proofByTarget.get(input.target);
      if (!proof || !(proof.evidenceIds ?? []).includes(evidence.id)) {
        issues.push(`profileResolutionRecord evidence ${evidence.id}: unpaired proof input ${input.target}`);
        continue;
      }
      if (!exactProfileDeclaration(input.parent, proof.parent)
        || !exactProfileDeclaration(input.child, proof.child)) {
        issues.push(`profileResolutionRecord evidence ${evidence.id}: ${input.target} does not reproduce proof inputs`);
      }
    }
  }
}

async function validateProfileResolutionRecord(record, recordAbsolute, profile, profileAbsolute, issues) {
  if (record.profile?.id !== profile.id || record.profile?.version !== profile.version) {
    issues.push(`profileResolutionRecord: record binds ${record.profile?.id}@${record.profile?.version}, expected ${profile.id}@${profile.version}`);
  }
  if (record.conflictStatus !== "no_unresolved_conflicts") {
    issues.push("profileResolutionRecord: unresolved conflict status");
  }

  const chainIssues = [];
  const chain = await collectAuthenticatedParentChain(profile, profileAbsolute, chainIssues);
  issues.push(...chainIssues.map((issue) => `profileResolutionRecord: ${issue}`));
  if (!chain) return;
  reportCanonicalArray(
    record.parentChain ?? [],
    chain.map((entry) => entry.pointer),
    "profileResolutionRecord parentChain",
    issues
  );

  const effectiveIssues = [];
  const effectiveDetail = await resolveEffectiveProfileDetailed(
    profile,
    profileAbsolute,
    effectiveIssues,
    [],
    { record, absolute: recordAbsolute }
  );
  issues.push(...effectiveIssues.map((issue) => `profileResolutionRecord: ${issue}`));
  if (!effectiveDetail) return;
  const { effective, fieldSources: expectedFieldSources, keyedSources: expectedKeyedSources } = effectiveDetail;
  const effectiveDigest = sha256Canonical(effective);
  if (profile.effectiveProfileDigest !== effectiveDigest) {
    issues.push(`profileResolutionRecord: profile effective digest must be ${effectiveDigest}`);
  }
  if (record.effectiveProfileDigest !== effectiveDigest) {
    issues.push(`profileResolutionRecord: record effective digest must be ${effectiveDigest}`);
  }

  const fieldPointers = (record.fieldProvenance ?? []).map((entry) => entry.pointer);
  reportExactIds(profileResolutionFieldPointers, fieldPointers, "profileResolutionRecord field provenance", issues);
  reportCanonicalArray(fieldPointers, profileResolutionFieldPointers, "profileResolutionRecord field provenance ordering", issues);

  for (const provenance of record.fieldProvenance ?? []) {
    const expected = expectedFieldSources.get(provenance.pointer);
    if (!expected || provenance.sourceProfileId !== expected.sourceProfileId
      || provenance.sourceProfileVersion !== expected.sourceProfileVersion
      || provenance.operation !== expected.operation) {
      issues.push(`profileResolutionRecord: ${provenance.pointer} provenance must be ${expected?.sourceProfileId}@${expected?.sourceProfileVersion}/${expected?.operation}`);
    }
  }

  const expectedPairs = [];
  for (const [collection, keyField] of Object.entries(profileResolutionKeyedCollections)) {
    for (const value of effective[collection] ?? []) expectedPairs.push(profileResolutionPair(collection, value[keyField]));
  }
  expectedPairs.sort();
  const actualPairs = [];
  for (const provenance of record.keyedProvenance ?? []) {
    const sortedKeys = [...(provenance.keys ?? [])].sort();
    reportCanonicalArray(provenance.keys ?? [], sortedKeys, `profileResolutionRecord ${provenance.collection} key ordering`, issues);
    for (const key of provenance.keys ?? []) {
      const pair = profileResolutionPair(provenance.collection, key);
      actualPairs.push(pair);
      const expected = expectedKeyedSources.get(pair);
      if (!expected || provenance.sourceProfileId !== expected.sourceProfileId
        || provenance.sourceProfileVersion !== expected.sourceProfileVersion
        || provenance.operation !== expected.operation) {
        issues.push(`profileResolutionRecord: ${pair} provenance must be ${expected?.sourceProfileId}@${expected?.sourceProfileVersion}/${expected?.operation}`);
      }
    }
  }
  reportExactIds(expectedPairs, actualPairs, "profileResolutionRecord keyed provenance", issues);
  reportCanonicalArray(actualPairs, [...actualPairs].sort(), "profileResolutionRecord keyed provenance ordering", issues);

  const expectedProofs = [];
  const parentEntry = chain.at(-1);
  if (parentEntry) {
    const parentEffectiveIssues = [];
    const parentEffective = await resolveEffectiveProfile(parentEntry.document, parentEntry.absolute, parentEffectiveIssues);
    issues.push(...parentEffectiveIssues.map((issue) => `profileResolutionRecord parent: ${issue}`));
    if (parentEffective) {
      for (const field of ["caseQa", "failureTaxonomy", "gateRegistry"]) {
        if (canonicalize(profile[field]) !== canonicalize(parentEffective[field])) {
          expectedProofs.push({
            target: `/${field}`,
            targetKind: "singleton",
            pointer: `/${field}`,
            key: undefined,
            parent: parentEffective[field],
            child: profile[field]
          });
        }
      }
      for (const [field, keyField] of Object.entries(profileResolutionKeyedCollections)) {
        if (field === "requirementMapping") continue;
        const parentByKey = new Map((parentEffective[field] ?? []).map((value) => [value[keyField], value]));
        for (const childValue of profile[field] ?? []) {
          const key = childValue[keyField];
          const parentValue = parentByKey.get(key);
          if (parentValue !== undefined && canonicalize(childValue) !== canonicalize(parentValue)) {
            const parentPointer = artifactPointerForProfileValue(field, parentValue);
            const childPointer = artifactPointerForProfileValue(field, childValue);
            if (parentPointer && childPointer) {
              expectedProofs.push({
                target: `/${field}/${key}`,
                targetKind: "keyed",
                pointer: `/${field}`,
                key,
                parent: parentPointer,
                child: childPointer
              });
            }
          }
        }
      }
    }
  }
  expectedProofs.sort((left, right) => left.target.localeCompare(right.target));
  const actualProofTargets = (record.replacementProofs ?? []).map(proofTarget);
  reportExactIds(expectedProofs.map((proof) => proof.target), actualProofTargets, "profileResolutionRecord replacement proofs", issues);
  reportCanonicalArray(actualProofTargets, [...actualProofTargets].sort(), "profileResolutionRecord replacement-proof ordering", issues);
  const proofByTarget = new Map((record.replacementProofs ?? []).map((proof) => [proofTarget(proof), proof]));
  for (const expected of expectedProofs) {
    const proof = proofByTarget.get(expected.target);
    if (!proof) continue;
    if (proof.targetKind !== expected.targetKind || proof.pointer !== expected.pointer || proof.key !== expected.key) {
      issues.push(`profileResolutionRecord: malformed proof target ${expected.target}`);
    }
    if (canonicalize(proof.parent) !== canonicalize(expected.parent)) {
      issues.push(`profileResolutionRecord: proof ${expected.target} does not bind the parent declaration`);
    }
    if (canonicalize(proof.child) !== canonicalize(expected.child)) {
      issues.push(`profileResolutionRecord: proof ${expected.target} does not bind the child declaration`);
    }
  }
  await validateResolutionEvidence(record, recordAbsolute, issues);
}

async function checkProfileResolutionProvenance(document, sourceAbsolute, issues) {
  const pointer = document.resolutionEvidence;
  if (!pointer) {
    issues.push("profileResolutionProvenance: resolutionEvidence is required");
    return;
  }
  if (canonicalize(document.conflictReport?.evidence) !== canonicalize(pointer)) {
    issues.push("profileResolutionProvenance: conflictReport.evidence must equal resolutionEvidence");
  }
  try {
    const absolute = resolveRepositoryPath(path.dirname(sourceAbsolute), pointer.uri);
    const resolved = await digestForPointer(absolute);
    if (pointer.digest !== resolved.digest) throw new Error(`resolution record digest must be ${resolved.digest}`);
    if (pointer.id !== resolved.referenced?.id || pointer.version !== resolved.referenced?.version) {
      throw new Error(`resolution record identity must be ${resolved.referenced?.id}@${resolved.referenced?.version}`);
    }
    const validate = ajv.getSchema("urn:agent-evals-standard:schema:profile-resolution-record:1");
    if (!resolved.referenced || !validate(resolved.referenced)) {
      throw new Error(`resolution record schema invalid: ${ajv.errorsText(validate?.errors ?? [])}`);
    }
    const nestedIssues = [];
    await validateProfileResolutionRecord(resolved.referenced, absolute, document, sourceAbsolute, nestedIssues);
    issues.push(...nestedIssues.map((issue) => `profileResolutionProvenance: ${issue}`));
  } catch (error) {
    issues.push(`profileResolutionProvenance: ${error.message}`);
  }
}

async function checkProfileResolutionRecord(document, sourceAbsolute, issues, fixture) {
  if (!fixture.relatedPath) {
    issues.push("profileResolutionRecord: relatedPath is required");
    return;
  }
  try {
    const profileAbsolute = resolveRepositoryPath(fixtureDirectory, fixture.relatedPath);
    const profile = await readJsonStrict(profileAbsolute);
    await validateProfileResolutionRecord(document, sourceAbsolute, profile, profileAbsolute, issues);
  } catch (error) {
    issues.push(`profileResolutionRecord: ${error.message}`);
  }
}

async function digestForPointer(absolute) {
  const bytes = await readFile(absolute);
  if (path.extname(absolute).toLowerCase() === ".json") {
    const referenced = parseIJson(bytes.toString("utf8"), absolute);
    if (typeof referenced.digest === "string" && /^sha256:[a-f0-9]{64}$/.test(referenced.digest)) {
      if (referenced.schemaVersion === "agent-eval-evidence-artifact-1") {
        throw new Error("an evidence-artifact digest identifies subject bytes, not the JSON record");
      }
      const projection = selfDigestProjection(referenced);
      const actual = sha256Canonical(projection);
      if (referenced.digest !== actual) {
        throw new Error(`referenced self-digest must be ${actual}, found ${referenced.digest}`);
      }
      if (referenced.signature !== undefined) {
        const problem = await artifactSignatureProblem(referenced);
        if (problem) throw new Error(`referenced signature: ${problem}`);
      }
      return { digest: referenced.digest, referenced };
    }
    return { digest: sha256Bytes(bytes), referenced };
  }
  return { digest: sha256Bytes(bytes), referenced: null };
}

async function checkArtifactPointers(document, sourceAbsolute, issues) {
  const pointers = [];
  visit(document, (value, pointer) => {
    if (value && typeof value === "object" && !Array.isArray(value)
      && typeof value.id === "string" && typeof value.uri === "string"
      && typeof value.digest === "string") {
      pointers.push({ value, pointer });
    }
  });

  const cache = new Map();
  for (const { value, pointer } of pointers) {
    const contentAddressed = /^artifact:sha256:([a-f0-9]{64})$/.exec(value.uri);
    if (contentAddressed) {
      const locatorDigest = `sha256:${contentAddressed[1]}`;
      if (value.digest !== locatorDigest) {
        issues.push(`artifactPointers ${pointer}: content-addressed URI binds ${locatorDigest}, found ${value.digest}`);
      }
      continue;
    }
    let absolute;
    try {
      absolute = resolveRepositoryPath(path.dirname(sourceAbsolute), value.uri);
      if (!cache.has(absolute)) cache.set(absolute, await digestForPointer(absolute));
    } catch (error) {
      issues.push(`artifactPointers ${pointer}: ${error.message}`);
      continue;
    }
    const { digest, referenced } = cache.get(absolute);
    if (value.digest !== digest) issues.push(`artifactPointers ${pointer}: expected digest ${digest}, found ${value.digest}`);
    if (value.version !== undefined && referenced?.id !== undefined && referenced.id !== value.id) {
      issues.push(`artifactPointers ${pointer}: referenced id is ${referenced.id}`);
    }
    if (value.version !== undefined && referenced?.version !== undefined && referenced.version !== value.version) {
      issues.push(`artifactPointers ${pointer}: referenced version is ${referenced.version}`);
    }
  }

  for (const [index, fixture] of (document.fixtures ?? []).entries()) {
    try {
      const absolute = resolveRepositoryPath(path.dirname(sourceAbsolute), fixture.manifestUri);
      const actual = sha256Bytes(await readFile(absolute));
      if (fixture.manifestDigest !== actual) issues.push(`artifactPointers #/fixtures/${index}: expected manifest digest ${actual}, found ${fixture.manifestDigest}`);
    } catch (error) {
      issues.push(`artifactPointers #/fixtures/${index}: ${error.message}`);
    }
  }
}

const profileFixtureExecutionStack = new Set();

function profileFixtureManifestAdapter(absolute) {
  const kind = registeredProfileFixtureManifestKind(absolute, fixtureDirectory);
  if (kind === "distribution-conformance-manifest") {
    return {
      collection: "fixtures",
      execute: executeCentralFixtureExpectation,
      kind
    };
  }
  if (kind === "distribution-repository-review-vectors") {
    return {
      collection: "expectations",
      execute: async (expectation) => executeRepositoryReviewExpectation(expectation.id),
      kind
    };
  }
  return null;
}

async function validateProfileFixtureDeclaration(document, sourceAbsolute, issues, ownerPrefix) {
  const descriptors = document.fixtures ?? [];
  reportDuplicateIds(descriptors.map((descriptor) => descriptor.id), `${ownerPrefix} fixture IDs`, issues);
  const cache = new Map();
  for (const [index, descriptor] of descriptors.entries()) {
    const owner = `${ownerPrefix} #/fixtures/${index}`;
    if (typeof descriptor.manifestExpectationId !== "string" || descriptor.manifestExpectationId.length === 0) {
      issues.push(`${owner}: manifestExpectationId is required`);
      continue;
    }
    let absolute;
    try {
      absolute = resolveRepositoryPath(path.dirname(sourceAbsolute), descriptor.manifestUri);
      const adapter = profileFixtureManifestAdapter(absolute);
      if (!adapter) {
        issues.push(`${owner}: manifest is not registered with the distribution-owned fixture executor`);
        continue;
      }
      if (!cache.has(absolute)) {
        const bytes = await readFile(absolute);
        const referencedManifest = parseIJson(bytes.toString("utf8"), absolute);
        const expectations = referencedManifest[adapter.collection];
        if (!Array.isArray(expectations) || expectations.length === 0) {
          throw new Error(`registered manifest has no nonempty ${adapter.collection} array`);
        }
        const expectationIds = expectations
          .map((fixture) => fixture.id)
          .filter((id) => id !== undefined);
        const counts = occurrenceCounts(expectationIds);
        cache.set(absolute, {
          adapter,
          expectations,
          referencedManifest,
          counts,
          digest: sha256Bytes(bytes)
        });
        for (const [id, count] of counts) {
          if (typeof id !== "string" || id.length === 0) {
            issues.push(`${owner}: referenced manifest contains an invalid expectationId`);
          } else if (count !== 1) {
            issues.push(`${owner}: manifest expectation ${id} occurs ${count} times`);
          }
        }
      }
    } catch (error) {
      issues.push(`${owner}: ${error.message}`);
      continue;
    }
    const { adapter, expectations, referencedManifest, counts, digest } = cache.get(absolute);
    if (descriptor.manifestDigest !== digest) {
      issues.push(`${owner}: manifestDigest must be ${digest}, found ${descriptor.manifestDigest}`);
    }
    const matches = expectations
      .filter((fixture) => fixture.id === descriptor.manifestExpectationId);
    if (counts.get(descriptor.manifestExpectationId) !== 1 || matches.length !== 1) {
      issues.push(`${owner}: manifest expectation ${descriptor.manifestExpectationId} resolves ${matches.length} entries`);
      continue;
    }
    const expectation = matches[0];
    const authorityProblems = profileFixtureAuthorityProblems(referencedManifest, expectation, adapter.kind);
    if (authorityProblems.length > 0) {
      issues.push(...authorityProblems.map((problem) => `${owner}: ${problem}`));
      continue;
    }
    const executionKey = `${path.resolve(absolute)}\u0000${descriptor.manifestExpectationId}`;
    if (profileFixtureExecutionStack.has(executionKey)) {
      issues.push(`${owner}: fixture execution cycle at ${descriptor.manifestExpectationId}`);
      continue;
    }
    profileFixtureExecutionStack.add(executionKey);
    let outcome;
    try {
      outcome = await adapter.execute(expectation);
    } catch (error) {
      outcome = { executionError: `distribution-owned fixture executor failed: ${error.message}` };
    } finally {
      profileFixtureExecutionStack.delete(executionKey);
    }
    const outcomeProblems = profileFixtureOutcomeProblems(expectation, outcome, descriptor.expectedVerdict);
    issues.push(...outcomeProblems.map((problem) => `${owner}: ${problem}`));
  }
  return descriptors.map((descriptor) => ({
    id: descriptor.id,
    descriptor: clone(descriptor),
    sourceAbsolute: path.resolve(sourceAbsolute)
  }));
}

async function mergeProfileFixtureBindings(document, sourceAbsolute, parentBindings, issues) {
  const owner = `effectiveProfileDigest ${document.id}@${document.version} fixtures`;
  const childBindings = await validateProfileFixtureDeclaration(document, sourceAbsolute, issues, owner);
  const parentIds = new Set((parentBindings ?? []).map((binding) => binding.id));
  const merged = new Map((parentBindings ?? []).map((binding) => [binding.id, binding]));
  for (const binding of childBindings) {
    if (parentIds.has(binding.id)) {
      issues.push(`${owner}: fixture ID ${binding.id} collides with an inherited fixture; replacement and shadowing are forbidden`);
      continue;
    }
    if (!merged.has(binding.id)) merged.set(binding.id, binding);
  }
  return [...merged.values()].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

async function checkProfileFixtureBindings(document, sourceAbsolute, issues) {
  await validateProfileFixtureDeclaration(document, sourceAbsolute, issues, "profileFixtureBindings");
}

async function checkRequirementCoverage(document, sourceAbsolute, issues) {
  const canonical = await authenticateCanonicalRequirementRegistry(
    document,
    sourceAbsolute,
    "requirementCoverage",
    issues
  );
  if (!canonical) return;
  const expected = (canonical.registry.requirements ?? []).map((entry) => entry.id);
  if (expected.length === 0) issues.push("requirementCoverage: registry contains no requirement IDs");
  const actual = (document.requirementMapping ?? []).map((entry) => entry.requirementId);
  const counts = new Map(actual.map((id) => [id, actual.filter((candidate) => candidate === id).length]));
  for (const id of expected) {
    if (counts.get(id) !== 1) issues.push(`requirementCoverage: ${id} occurs ${counts.get(id) ?? 0} times`);
  }
  for (const id of counts.keys()) {
    if (!expected.includes(id)) issues.push(`requirementCoverage: unknown requirement ${id}`);
  }
}

async function checkContractDigest(document, _sourceAbsolute, issues) {
  const actual = sha256Bytes(await readFile(path.join(root, "standard", "scorecard-contract.md")));
  for (const field of ["functionalSuccess", "acceptedOutcome"]) {
    if (document[field]?.contractDigest !== actual) issues.push(`contractDigest: ${field} must bind ${actual}`);
  }
}

function occurrenceCounts(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function sameStringSet(left, right) {
  return left.length === right.length
    && left.every((value) => right.includes(value))
    && right.every((value) => left.includes(value));
}

function reportDuplicateIds(values, owner, issues) {
  for (const [id, count] of occurrenceCounts(values)) {
    if (count !== 1) issues.push(`${owner}: ${id} occurs ${count} times`);
  }
}

function reportExactIds(expected, actual, owner, issues) {
  const expectedCounts = occurrenceCounts(expected);
  const actualCounts = occurrenceCounts(actual);
  for (const [id, count] of expectedCounts) {
    if (count !== 1) issues.push(`${owner}: expected registry ID ${id} occurs ${count} times`);
    if (actualCounts.get(id) !== 1) issues.push(`${owner}: required ID ${id} occurs ${actualCounts.get(id) ?? 0} times`);
  }
  for (const [id, count] of actualCounts) {
    if (!expectedCounts.has(id)) issues.push(`${owner}: unknown ID ${id}`);
    else if (count !== 1) issues.push(`${owner}: ID ${id} occurs ${count} times`);
  }
}

function evidenceIdsFrom(document, owner, issues) {
  const ids = (document.evidenceManifest ?? []).map((entry) => entry.id);
  reportDuplicateIds(ids, `${owner} evidenceManifest`, issues);
  return new Set(ids);
}

function requireEvidenceIds(ids, available, owner, issues) {
  for (const id of ids ?? []) {
    if (!available.has(id)) issues.push(`${owner}: evidence ID ${id} does not resolve exactly once`);
  }
}

async function loadRequirementRegistry(owner, issues) {
  try {
    const registry = await readJsonStrict(path.join(root, "standard", "requirement-registry.json"));
    const projection = clone(registry);
    delete projection.digest;
    const actualDigest = sha256Canonical(projection);
    if (registry.digest !== actualDigest) {
      issues.push(`${owner}: requirement registry self-digest must be ${actualDigest}`);
    }
    reportDuplicateIds((registry.requirements ?? []).map((entry) => entry.id), `${owner} requirement registry`, issues);
    return registry;
  } catch (error) {
    issues.push(`${owner}: cannot load requirement registry: ${error.message}`);
    return null;
  }
}

function applicableRequirementIds(registry, target) {
  return (registry.requirements ?? [])
    .filter((requirement) => requirement.targets?.includes(target))
    .map((requirement) => requirement.id);
}

async function checkValidationEnvelope(document, _sourceAbsolute, issues, fixture) {
  const owner = "validationEnvelope";
  const registry = await loadRequirementRegistry(owner, issues);
  if (!registry) return;
  const availableEvidence = evidenceIdsFrom(document, owner, issues);
  const checks = document.checks ?? [];
  const expected = applicableRequirementIds(registry, document.subject?.claimTarget);
  reportExactIds(expected, checks.map((entry) => entry.requirementId), `${owner} requirement coverage`, issues);

  for (const check of checks) {
    requireEvidenceIds(check.evidenceIds, availableEvidence, `${owner} ${check.requirementId}`, issues);
  }

  issues.push(...validationEnvelopeAggregateIssues(checks, document.result, owner));

  if (fixture?.relatedPath && document.subject?.projection === "full_document_without_digest_and_signature") {
    try {
      const absolute = resolveRepositoryPath(fixtureDirectory, fixture.relatedPath);
      const subject = await readJsonStrict(absolute);
      const projection = clone(subject);
      delete projection.digest;
      delete projection.signature;
      const actual = sha256Canonical(projection);
      if (document.subject.digest !== actual) {
        issues.push(`${owner}: subject digest must be ${actual}`);
      }
      const subjectId = subject.id ?? subject.caseId ?? subject.envelopeId;
      if (subjectId !== undefined && document.subject.id !== subjectId) {
        issues.push(`${owner}: subject id ${document.subject.id} does not match ${subjectId}`);
      }
    } catch (error) {
      issues.push(`${owner}: cannot resolve related subject: ${error.message}`);
    }
  }
}

async function checkWorkspaceManifest(document, _sourceAbsolute, issues) {
  issues.push(...verifyWorkspaceManifest(document).map((problem) => `workspaceManifest: ${problem}`));
}

async function checkRepositoryGroundingEvidence(document, sourceAbsolute, issues, fixture) {
  const owner = "repositoryGroundingEvidence";
  if (!fixture?.relatedPath) {
    issues.push(`${owner}: fixture must identify its related conformance statement`);
    return;
  }
  try {
    const statementAbsolute = resolveRepositoryPath(fixtureDirectory, fixture.relatedPath);
    const statement = await readJsonStrict(statementAbsolute);
    const target = statement.targetEvidence?.[statement.claim];
    const slice = (statement.scope?.slices ?? []).find((entry) => entry.id === document.scopeSliceId);
    if (!target || !slice) throw new Error("target or scope slice does not resolve");
    if (target.dependencyManifest?.digest !== dependencyManifestDigest(target.dependencyManifest)) {
      issues.push(`${owner}: related dependency manifest digest is not reproducible`);
    }
    const workspaceAbsolute = resolveRepositoryPath(path.dirname(statementAbsolute), slice.repositorySnapshot.uri);
    const workspaceBytes = await readFile(workspaceAbsolute);
    const workspaceManifest = parseIJson(workspaceBytes.toString("utf8"), workspaceAbsolute);
    issues.push(...verifyWorkspaceManifest(workspaceManifest).map((problem) => `${owner}: workspace ${problem}`));
    const verifierAbsolute = resolveRepositoryPath(path.dirname(sourceAbsolute), document.verifierExecution.verifier.uri);
    const groundingProblems = verifyRepositoryGroundingEvidence(document, {
      statementId: statement.id,
      target: statement.claim,
      targetSubject: target.targetSubject,
      dependencyManifest: target.dependencyManifest,
      scopeSlice: slice,
      workspaceManifest,
      workspaceManifestDigest: sha256Bytes(workspaceBytes),
      verifierDigest: sha256Bytes(await readFile(verifierAbsolute))
    });
    issues.push(...groundingProblems.map((problem) => `${owner}: ${problem}`));
  } catch (error) {
    issues.push(`${owner}: ${error.message}`);
  }
}

function registryApplicabilityDigest(requirement) {
  return sha256Canonical({
    requirementId: requirement.id,
    targets: requirement.targets,
    applicability: requirement.applicability
  });
}

function applicabilityPredicate(rule, requirement, target, owner, issues) {
  if (rule.predicate !== "target_membership" || !requirement) return null;
  const expectedDigest = registryApplicabilityDigest(requirement);
  if (rule.registryApplicabilityDigest !== expectedDigest) {
    issues.push(`${owner}: registryApplicabilityDigest must be ${expectedDigest}`);
  }
  return (requirement.targets ?? []).includes(target);
}

function conformanceProfileContractBinding(binding) {
  return {
    id: binding?.id,
    version: binding?.version,
    digest: binding?.digest,
    effectiveProfileDigest: binding?.effectiveProfileDigest
  };
}

function conformancePointerBinding(binding) {
  return {
    id: binding?.id,
    version: binding?.version,
    uri: binding?.uri,
    digest: binding?.digest
  };
}

function conformanceSubjectDocumentId(document, targetType) {
  const fields = {
    suite: ["id", "suiteId"],
    case: ["id", "caseId"],
    evaluator: ["id", "evaluatorId", "implementationId"],
    experiment: ["id", "experimentId", "runId"],
    decision: ["id", "decisionId"]
  };
  for (const field of fields[targetType] ?? ["id"]) {
    if (typeof document?.[field] === "string") return document[field];
  }
  return null;
}

function expectedConformanceDependencyEntries(document, target) {
  const entries = [{ role: "target_subject", ...conformancePointerBinding(target.targetSubject) }];
  for (const slice of document.scope?.slices ?? []) {
    entries.push({ role: "repository_snapshot", scopeSliceId: slice.id, ...conformancePointerBinding(slice.repositorySnapshot) });
    entries.push({ role: "evaluation_profile", scopeSliceId: slice.id, ...conformancePointerBinding(slice.evaluationProfile) });
    entries.push({ role: "work_artifact_registry", scopeSliceId: slice.id, ...conformancePointerBinding(slice.workArtifactRegistry) });
    for (const outcome of slice.outcomeProfiles ?? []) {
      entries.push({ role: "outcome_profile", scopeSliceId: slice.id, ...conformancePointerBinding(outcome) });
    }
  }
  const applicabilityPointers = new Map();
  for (const row of target.requirementResults ?? []) {
    const pointer = conformancePointerBinding(row.applicabilityContract);
    applicabilityPointers.set(canonicalize(pointer), pointer);
  }
  for (const pointer of applicabilityPointers.values()) entries.push({ role: "applicability_contract", ...pointer });
  // Target-composition entries have richer, role-specific shapes and are
  // validated independently by checkConformanceTargetComposition. Preserve
  // them here so the generic exact-graph check still rejects missing or extra
  // base bindings without flattening compound dependencies into weak pointers.
  for (const entry of target.dependencyManifest?.entries ?? []) {
    if (entry.role === "conformance_dependency"
      || (entry.role === "target_artifact" && entry.artifactType === "scorecard")) {
      entries.push(entry);
    }
  }
  return entries;
}

async function resolveConformanceTargetBinding(document, target, sourceAbsolute, issues) {
  const owner = "conformanceGraph target subject";
  const pointer = target.targetSubject;
  let subject = null;
  try {
    const absolute = resolveRepositoryPath(path.dirname(sourceAbsolute), pointer.uri);
    const bytes = await readFile(absolute);
    const actualDigest = sha256Bytes(bytes);
    if (pointer.digest !== actualDigest) issues.push(`${owner}: digest must be ${actualDigest}`);
    subject = parseIJson(bytes.toString("utf8"), absolute);
    const subjectId = conformanceSubjectDocumentId(subject, document.claim);
    if (pointer.id !== target.targetId || subjectId !== pointer.id) {
      issues.push(`${owner}: ${document.claim} targetId, targetSubject.id, and resolved subject identity must all equal ${target.targetId}`);
    }
    if (typeof subject.version === "string" && subject.version !== pointer.version) {
      issues.push(`${owner}: resolved subject version ${subject.version} differs from ${pointer.version}`);
    }
  } catch (error) {
    issues.push(`${owner}: cannot resolve immutable targetSubject: ${error.message}`);
  }

  const dependencyManifest = target.dependencyManifest;
  if (dependencyManifest?.digest !== dependencyManifestDigest(dependencyManifest ?? {})) {
    issues.push(`${owner}: dependencyManifest digest must be ${dependencyManifestDigest(dependencyManifest ?? {})}`);
  }
  reportDuplicateIds((dependencyManifest?.entries ?? []).map((entry) => canonicalize({
    role: entry.role,
    scopeSliceId: entry.scopeSliceId ?? null,
    id: entry.id,
    version: entry.version,
    digest: entry.digest
  })), `${owner} dependency entries`, issues);
  const expectedEntries = expectedConformanceDependencyEntries(document, target).map(canonicalize).sort();
  const actualEntries = (dependencyManifest?.entries ?? []).map(canonicalize).sort();
  if (canonicalize(expectedEntries) !== canonicalize(actualEntries)) {
    issues.push(`${owner}: dependencyManifest entries differ from the exact conformance dependency graph`);
  }
  return { subject, pointer, dependencyManifest };
}

function expectedPayloadSliceBinding(slice) {
  return {
    scopeSliceId: slice.id,
    repositorySnapshotDigest: slice.repositorySnapshot?.digest,
    evaluationProfile: conformanceProfileContractBinding(slice.evaluationProfile),
    workArtifactRegistry: {
      id: slice.workArtifactRegistry?.id,
      version: slice.workArtifactRegistry?.version,
      digest: slice.workArtifactRegistry?.digest
    },
    outcomeProfiles: (slice.outcomeProfiles ?? []).map((outcome) => ({
      id: outcome.id,
      version: outcome.version,
      digest: outcome.digest
    })),
    materialRepositoryGrounding: slice.materialRepositoryGrounding
  };
}

function validateConformancePayloadSlices(payload, slices, owner, issues) {
  const payloadSlices = payload?.scopeSlices ?? [];
  reportExactIds(slices.map((slice) => slice.id), payloadSlices.map((slice) => slice.scopeSliceId),
    `${owner} payload scope-slice coverage`, issues);
  for (const slice of slices) {
    const matches = payloadSlices.filter((entry) => entry.scopeSliceId === slice.id);
    if (matches.length === 1
      && canonicalize(matches[0]) !== canonicalize(expectedPayloadSliceBinding(slice))) {
      issues.push(`${owner}: payload binding for scope slice ${slice.id} does not match repository/profile/work-artifact-registry/outcomes/grounding`);
    }
  }
}

async function resolveConformanceScope(document, target, targetBinding, sourceAbsolute, evidencePayloads, issues) {
  const owner = "conformanceGraph scope";
  const scope = document.scope;
  if (scope?.applicabilityBoundary !== "repository_grounded_sdlc_agent_evaluation") {
    issues.push(`${owner}: target is outside the repository-grounded SDLC applicability boundary`);
    return [];
  }
  const slices = scope.slices ?? [];
  reportDuplicateIds(slices.map((slice) => slice.id), `${owner} slice IDs`, issues);
  const resolvedSlices = [];
  for (const slice of slices) {
    const sliceOwner = `${owner} ${slice.id ?? "unknown-slice"}`;
    const bindingPolicy = conformanceScopeBindingPolicy(slice, sliceOwner);
    issues.push(...bindingPolicy.issues);
    const requireProfileCompatibility = bindingPolicy.requireProfileCompatibility;
    if (requireProfileCompatibility) {
      const decisionClass = document.claim === "decision"
        && targetBinding.subject?.verdict === "approve"
        ? targetBinding.subject.decisionType
        : "capability_claim";
      for (const riskTier of slice.riskTiers ?? []) {
        issues.push(...baseAssuranceSelectionIssues({
          assuranceLevel: slice.assuranceLevel,
          effectiveRiskTier: riskTier,
          decisionClass,
          claimEligibility: "claims_eligible"
        }, `${sliceOwner}: ASSURE-001`));
      }
    }
    let workspaceManifest;
    let workspaceManifestDigest;
    try {
      const absolute = resolveRepositoryPath(path.dirname(sourceAbsolute), slice.repositorySnapshot?.uri);
      const bytes = await readFile(absolute);
      workspaceManifestDigest = sha256Bytes(bytes);
      workspaceManifest = parseIJson(bytes.toString("utf8"), absolute);
      if (slice.repositorySnapshot?.digest !== workspaceManifestDigest
        || slice.repositorySnapshot?.id !== workspaceManifest?.id
        || slice.repositorySnapshot?.version !== workspaceManifest?.version) {
        throw new Error("workspace-manifest identity, version, or raw-byte digest mismatch");
      }
      const validateWorkspace = ajv.getSchema("urn:agent-evals-standard:schema:workspace-manifest:1");
      if (!validateWorkspace(workspaceManifest)) {
        throw new Error(`workspace-manifest schema invalid: ${ajv.errorsText(validateWorkspace.errors)}`);
      }
      for (const problem of verifyWorkspaceManifest(workspaceManifest)) issues.push(`${sliceOwner}: workspace manifest ${problem}`);
    } catch (error) {
      issues.push(`${sliceOwner}: cannot resolve content-addressed workspace bytes: ${error.message}`);
    }

    const groundingBinding = slice.materialRepositoryGrounding;
    const evidenceId = groundingBinding?.evidenceId;
    const evidence = evidencePayloads.get(evidenceId);
    if (!evidence?.authenticated) {
      issues.push(`${sliceOwner}: material repository grounding evidence ${evidenceId} must resolve to signed authenticated evidence`);
    } else if (workspaceManifest && targetBinding) {
      const validateGrounding = ajv.getSchema("urn:agent-evals-standard:schema:repository-grounding-evidence:1");
      if (!validateGrounding(evidence.payload)) {
        issues.push(`${sliceOwner}: repository grounding evidence schema invalid: ${ajv.errorsText(validateGrounding.errors)}`);
      } else {
        const expectedAssertionIds = {
          repositoryNecessity: evidence.payload.assertions[0]?.id,
          claimInvariantTraceability: evidence.payload.assertions[1]?.id,
          repositoryGovernedOutcome: evidence.payload.assertions[2]?.id,
          removalCounterfactual: evidence.payload.assertions[3]?.id
        };
        if (canonicalize(groundingBinding.assertionIds) !== canonicalize(expectedAssertionIds)) {
          issues.push(`${sliceOwner}: exactly four typed assertion IDs must bind the grounding payload`);
        }
        let verifierDigest = null;
        try {
          const verifierAbsolute = resolveRepositoryPath(path.dirname(evidence.absolute), evidence.payload.verifierExecution.verifier.uri);
          verifierDigest = sha256Bytes(await readFile(verifierAbsolute));
        } catch (error) {
          issues.push(`${sliceOwner}: cannot resolve grounding verifier executable: ${error.message}`);
        }
        if (verifierDigest) {
          const groundingProblems = verifyRepositoryGroundingEvidence(evidence.payload, {
            statementId: document.id,
            target: document.claim,
            targetSubject: target.targetSubject,
            dependencyManifest: target.dependencyManifest,
            scopeSlice: slice,
            workspaceManifest,
             workspaceManifestDigest,
             verifierDigest,
             targetVerdict: target.verdict,
             groundingContract: null,
             executorAuthority: groundingExecutorAuthority
           });
          issues.push(...groundingProblems.map((problem) => `${sliceOwner}: grounding proof ${problem}`));
        }
      }
    }

    const binding = slice.evaluationProfile;
    let profile;
    let profileAbsolute;
    let effectiveProfile;
    try {
      profileAbsolute = resolveRepositoryPath(path.dirname(sourceAbsolute), binding.uri);
      const resolved = await digestForPointer(profileAbsolute);
      profile = resolved.referenced;
      if (binding.digest !== resolved.digest || binding.id !== profile?.id || binding.version !== profile?.version) {
        throw new Error("evaluation-profile identity or digest mismatch");
      }
      const validate = ajv.getSchema("urn:agent-evals-standard:schema:evaluation-profile:1");
      if (!profile || !validate(profile)) throw new Error(`evaluation profile schema invalid: ${ajv.errorsText(validate?.errors ?? [])}`);
      const effectiveIssues = [];
      effectiveProfile = await resolveEffectiveProfile(profile, profileAbsolute, effectiveIssues);
      issues.push(...effectiveIssues.map((issue) => `${sliceOwner}: ${issue}`));
      const actualEffectiveDigest = effectiveProfile ? sha256Canonical(effectiveProfile) : null;
      if (binding.effectiveProfileDigest !== actualEffectiveDigest || profile.effectiveProfileDigest !== actualEffectiveDigest) {
        issues.push(`${sliceOwner}: effective evaluation-profile digest must be ${actualEffectiveDigest}`);
      }
    } catch (error) {
      issues.push(`${sliceOwner}: cannot authenticate evaluation profile: ${error.message}`);
      continue;
    }
    if (requireProfileCompatibility && !(effectiveProfile.supportedAssuranceLevels ?? []).includes(slice.assuranceLevel)) {
      issues.push(`${sliceOwner}: assurance ${slice.assuranceLevel} is not supported by ${profile.id}`);
    }
    if (requireProfileCompatibility) {
      for (const risk of slice.riskTiers ?? []) {
        if (!(effectiveProfile.effectiveRiskRange ?? []).includes(risk)) issues.push(`${sliceOwner}: risk tier ${risk} is outside ${profile.id}`);
      }
      for (const capability of slice.capabilityFamilyIds ?? []) {
        if (!(effectiveProfile.capabilityFamilies ?? []).includes(capability)) issues.push(`${sliceOwner}: capability ${capability} is outside ${profile.id}`);
      }
      for (const interactionMode of slice.interactionModes ?? []) {
        if (!(effectiveProfile.interactionModes ?? []).includes(interactionMode)) {
          issues.push(`${sliceOwner}: interaction mode ${interactionMode} is outside effective profile ${profile.id}`);
        }
      }
    }
    const workArtifactRegistry = await resolveWorkArtifactRegistry(
      slice.workArtifactRegistry,
      path.dirname(sourceAbsolute),
      sliceOwner,
      issues
    );
    if (requireProfileCompatibility
      && !sameWorkArtifactRegistryBinding(slice.workArtifactRegistry, effectiveProfile.workArtifactRegistry)) {
      issues.push(`${sliceOwner}: workArtifactRegistry differs from the effective evaluation profile`);
    }
    const allowedOutcomes = new Map((effectiveProfile.allowedOutcomeProfiles ?? []).map((entry) => [entry.id, entry]));
    const selectedOutcomeProfiles = [];
    for (const outcome of slice.outcomeProfiles ?? []) {
      const allowed = allowedOutcomes.get(outcome.id);
      if (requireProfileCompatibility
        && (!allowed || allowed.version !== outcome.version || allowed.digest !== outcome.digest)) {
        issues.push(`${sliceOwner}: outcome ${outcome.id}@${outcome.version} is not allowed by ${profile.id}`);
        continue;
      }
      try {
        const absolute = resolveRepositoryPath(path.dirname(sourceAbsolute), outcome.uri);
        const resolved = await digestForPointer(absolute);
        if (resolved.digest !== outcome.digest || resolved.referenced?.id !== outcome.id
          || resolved.referenced?.version !== outcome.version) throw new Error("identity or digest mismatch");
        const validate = ajv.getSchema("urn:agent-evals-standard:schema:outcome-profile:1");
        if (!validate(resolved.referenced)) throw new Error(`schema invalid: ${ajv.errorsText(validate.errors)}`);
        if (requireProfileCompatibility
          && !sameWorkArtifactRegistryBinding(slice.workArtifactRegistry, resolved.referenced.workArtifactRegistry)) {
          issues.push(`${sliceOwner}: workArtifactRegistry differs from outcome ${outcome.id}`);
        }
        selectedOutcomeProfiles.push(resolved.referenced);
      } catch (error) {
        issues.push(`${sliceOwner}: cannot authenticate outcome ${outcome.id}: ${error.message}`);
      }
    }
    if (requireProfileCompatibility) {
      for (const workArtifactType of slice.workArtifactTypes ?? []) {
        if (!selectedOutcomeProfiles.some((outcome) => (outcome.workArtifactTypes ?? []).includes(workArtifactType))) {
          issues.push(`${sliceOwner}: work artifact ${workArtifactType} is not supported by any authenticated selected outcome profile`);
        }
        const mappedFamily = workArtifactRegistry?.byType.get(workArtifactType)?.capabilityFamilyId;
        if (!mappedFamily) {
          issues.push(`${sliceOwner}: work artifact ${workArtifactType} is outside the authenticated work-artifact registry`);
        } else if (!(slice.capabilityFamilyIds ?? []).includes(mappedFamily)) {
          issues.push(`${sliceOwner}: work artifact ${workArtifactType} does not map to a selected capability family`);
        }
      }
      for (const capabilityFamilyId of slice.capabilityFamilyIds ?? []) {
        const covered = (slice.workArtifactTypes ?? []).some((workArtifactType) =>
          workArtifactRegistry?.byType.get(workArtifactType)?.capabilityFamilyId === capabilityFamilyId);
        if (!covered) {
          issues.push(`${sliceOwner}: capability ${capabilityFamilyId} has no selected material work artifact`);
        }
      }
    }
    if (requireProfileCompatibility && profile.id === "repo-change-v1") {
      let caseContract;
      try {
        const caseContractBinding = profile.caseContract;
        const caseContractAbsolute = resolveRepositoryPath(path.dirname(profileAbsolute), caseContractBinding?.uri);
        const resolved = await digestForPointer(caseContractAbsolute);
        caseContract = resolved.referenced;
        if (caseContractBinding?.digest !== resolved.digest
          || caseContractBinding?.id !== caseContract?.id
          || caseContractBinding?.version !== caseContract?.version) {
          throw new Error("case-contract identity, version, or raw-byte digest mismatch");
        }
        const validate = ajv.getSchema("urn:agent-evals-standard:schema:repo-change-case-contract:1");
        if (!caseContract || !validate(caseContract)) {
          throw new Error(`case-contract schema invalid: ${ajv.errorsText(validate?.errors ?? [])}`);
        }
      } catch (error) {
        issues.push(`${sliceOwner}: cannot authenticate repo-change case contract: ${error.message}`);
      }
      if ((slice.outcomeProfiles ?? []).length !== 1 || selectedOutcomeProfiles.length !== 1) {
        issues.push(`${sliceOwner}: repo-change-v1 requires exactly one authenticated selected outcome profile`);
      } else if (caseContract && workArtifactRegistry) {
        issues.push(...checkRepoChangeBoundVerification(slice, {
          label: sliceOwner,
          caseContract,
          outcomeProfile: selectedOutcomeProfiles[0],
          workArtifactRegistry
        }));
      }
    }
    resolvedSlices.push({
      slice,
      profile: effectiveProfile,
      outcomeProfiles: selectedOutcomeProfiles,
      workArtifactRegistry: workArtifactRegistry?.artifact,
      workspaceManifest
    });
  }
  return resolvedSlices;
}

async function loadApplicabilityContract(pointer, sourceAbsolute, issues, cache) {
  const cacheKey = canonicalize({ id: pointer.id, version: pointer.version, uri: pointer.uri, digest: pointer.digest });
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  try {
    const absolute = resolveRepositoryPath(path.dirname(sourceAbsolute), pointer.uri);
    const resolved = await digestForPointer(absolute);
    const contract = resolved.referenced;
    if (pointer.digest !== resolved.digest || pointer.id !== contract?.id || pointer.version !== contract?.version) {
      throw new Error("identity or digest mismatch");
    }
    const validate = ajv.getSchema("urn:agent-evals-standard:schema:conformance-applicability-contract:1");
    if (!contract || !validate(contract)) throw new Error(`schema invalid: ${ajv.errorsText(validate?.errors ?? [])}`);
    const value = { contract, absolute };
    cache.set(cacheKey, value);
    return value;
  } catch (error) {
    issues.push(`conformanceGraph: cannot authenticate applicability contract ${pointer.id}: ${error.message}`);
    cache.set(cacheKey, null);
    return null;
  }
}

async function loadConformanceEvidencePayloads(document, sourceAbsolute, issues) {
  const payloads = new Map();
  for (const evidence of document.evidenceManifest ?? []) {
    if (payloads.has(evidence.id)) {
      issues.push(`conformanceGraph: evidence ${evidence.id} occurs more than once`);
      continue;
    }
    let authenticated = true;
    try {
      const absolute = resolveRepositoryPath(path.dirname(sourceAbsolute), evidence.uri);
      const bytes = await readFile(absolute);
      const payload = parseIJson(bytes.toString("utf8"), absolute);
      let isRequirementProof = false;
      if (payload.schemaVersion === "agent-eval-conformance-requirement-proof-set-1") {
        isRequirementProof = true;
        const validateProofPayload = ajv.getSchema("urn:agent-evals-standard:schema:conformance-statement:1#/$defs/conformanceProofPayload");
        if (!validateProofPayload(payload)) {
          authenticated = false;
          issues.push(`conformanceGraph: evidence ${evidence.id} typed proof schema invalid: ${ajv.errorsText(validateProofPayload.errors)}`);
        }
      }
      const signatureProblem = await artifactSignatureProblem(evidence);
      if (signatureProblem) {
        authenticated = false;
        issues.push(`conformanceGraph: evidence ${evidence.id} attestation: ${signatureProblem}`);
      }
      const actualDigest = sha256Bytes(bytes);
      if (evidence.digest !== actualDigest) {
        authenticated = false;
        issues.push(`conformanceGraph: evidence ${evidence.id} digest must be ${actualDigest}`);
      }
      if (evidence.byteLength !== bytes.length) {
        authenticated = false;
        issues.push(`conformanceGraph: evidence ${evidence.id} byteLength must be ${bytes.length}`);
      }
      if (Date.parse(evidence.createdAt) > Date.parse(document.issuedAt)
        || Date.parse(evidence.retention?.expiresAt) < Date.parse(document.reviewAt)) {
        authenticated = false;
        issues.push(`conformanceGraph: evidence ${evidence.id} is not valid for the statement interval`);
      }
      reportDuplicateIds((payload.proofAssertions ?? []).map((assertion) => assertion.id),
        `conformanceGraph evidence ${evidence.id} proof assertions`, issues);
      let proofVerification = null;
      if (isRequirementProof && authenticated) {
        proofVerification = await verifyConformanceProofPayload(payload, absolute, {
          allowedRoot: root,
          validationTime: document.issuedAt,
          proofAuthenticated: true,
          claimantKeyIds: [document.signature?.keyId].filter(Boolean),
          claimantPublicKeys: [fixtureKey],
          trustedRegistryAuthorities: {
            "rfc8032-test-key-4-registry": {
              publicKey: proofRegistryFixtureKey,
              profileId: "fixture-proof-registry-profile",
              issuerId: "fixture-verifier-registry-authority",
              trustDomain: "fixture-registry-authority"
            }
          },
          trustedActors: {
            "rfc8032-test-key-2-verifier": {
              publicKey: proofAutomatedFixtureKey,
              profileId: "fixture-automated-verifier-profile",
              actorId: "fixture-replay-verifier",
              trustDomain: "fixture-replay-verifier"
            },
            "rfc8032-test-key-3-reviewer": {
              publicKey: proofReviewerFixtureKey,
              profileId: "fixture-accountable-reviewer-profile",
              actorId: "fixture-independent-reviewer",
              trustDomain: "fixture-independent-review"
            }
          }
        });
        if (!proofVerification.valid) {
          authenticated = false;
          for (const problem of proofVerification.issues) {
            issues.push(`conformanceGraph: evidence ${evidence.id} non-circular proof verification: ${problem}`);
          }
        }
      }
      payloads.set(evidence.id, { payload, authenticated, absolute, proofVerification });
    } catch (error) {
      issues.push(`conformanceGraph: cannot resolve evidence ${evidence.id}: ${error.message}`);
    }
  }
  return payloads;
}

async function validateDetachedConformanceEnvelope(document, sourceAbsolute, issues, fixture) {
  if (!fixture?.validationEnvelopePath) {
    issues.push("conformanceGraph: conforming claim requires a detached validation envelope");
    return;
  }
  try {
    const absolute = resolveRepositoryPath(fixtureDirectory, fixture.validationEnvelopePath);
    const envelope = await readJsonStrict(absolute);
    const validate = ajv.getSchema("urn:agent-evals-standard:schema:validation-envelope:1");
    if (!validate(envelope)) throw new Error(`schema invalid: ${ajv.errorsText(validate.errors)}`);
    const signatureProblem = fixtureSignatureProblem(envelope);
    if (signatureProblem) throw new Error(signatureProblem);
    const projection = clone(document);
    delete projection.digest;
    delete projection.signature;
    const expectedDigest = sha256Canonical(projection);
    if (envelope.subject?.type !== "conformance_statement" || envelope.subject?.id !== document.id
      || envelope.subject?.claimTarget !== document.claim
      || envelope.subject?.projection !== "full_document_without_digest_and_signature"
      || envelope.subject?.digest !== expectedDigest) {
      issues.push(`conformanceGraph: detached envelope must bind ${document.id}/${document.claim}/${expectedDigest}`);
    }
    const target = document.targetEvidence?.[document.claim];
    if (canonicalize(envelope.subject?.targetSubject) !== canonicalize(target?.targetSubject)) {
      issues.push("conformanceGraph: detached envelope targetSubject differs from the immutable claimed target");
    }
    if (canonicalize(envelope.subject?.dependencyManifest) !== canonicalize(target?.dependencyManifest)) {
      issues.push("conformanceGraph: detached envelope dependencyManifest differs from the claimed target graph");
    }
    if (canonicalize(envelope.evidenceManifest) !== canonicalize(document.evidenceManifest)) {
      issues.push("conformanceGraph: detached envelope evidenceManifest differs from the signed statement evidence graph");
    }
    if (envelope.result !== "pass") issues.push("conformanceGraph: detached envelope result must be pass");
    const expectedChecks = (target?.requirementResults ?? []).map((row) => row.requirementId);
    reportExactIds(expectedChecks, (envelope.checks ?? []).map((check) => check.requirementId),
      "conformanceGraph detached-envelope coverage", issues);
    const rowById = new Map((target?.requirementResults ?? []).map((row) => [row.requirementId, row]));
    for (const check of envelope.checks ?? []) {
      const row = rowById.get(check.requirementId);
      const expected = row?.status === "pass" ? "pass"
        : row?.status === "fail" ? "fail" : "insufficient_evidence";
      if (check.result !== expected) issues.push(`conformanceGraph: envelope ${check.requirementId} result must be ${expected}`);
    }
    if (Date.parse(envelope.validatedAt) < Date.parse(document.issuedAt)
      || Date.parse(envelope.validatedAt) > Date.parse(document.reviewAt)) {
      issues.push("conformanceGraph: detached envelope validation time is outside the statement interval");
    }
  } catch (error) {
    issues.push(`conformanceGraph: cannot authenticate detached validation envelope: ${error.message}`);
  }
}

function validateApplicabilityContractSlices(contract, slices, owner, issues) {
  const bindings = contract.scopeSlices ?? [];
  reportExactIds(slices.map((slice) => slice.id), bindings.map((binding) => binding.sliceId),
    `${owner} applicability-contract slice coverage`, issues);
  for (const slice of slices) {
    const matches = bindings.filter((binding) => binding.sliceId === slice.id);
    if (matches.length === 1
      && canonicalize(matches[0].evaluationProfile) !== canonicalize(conformanceProfileContractBinding(slice.evaluationProfile))) {
      issues.push(`${owner}: applicability contract profile binding differs for scope slice ${slice.id}`);
    }
  }
}

function validateTypedProofCoverage(document, target, row, rule, evidencePayloads, slices, owner, issues) {
  const counts = new Map(slices.map((slice) => [slice.id, 0]));
  for (const evidenceId of row.evidenceIds ?? []) {
    const evidence = evidencePayloads.get(evidenceId);
    if (!evidence?.authenticated) continue;
    const payload = evidence.payload;
    if (!payload?.id || !(rule.evidenceAssertionIds ?? []).includes(payload.id)
      || payload.statementId !== document.id || payload.target !== document.claim
      || payload.targetId !== target.targetId) continue;
    if (canonicalize(payload.targetSubject) !== canonicalize(target.targetSubject)) {
      issues.push(`${owner}: ${row.requirementId} typed proof targetSubject differs from the immutable claimed target`);
      continue;
    }
    if (canonicalize(payload.dependencyManifest) !== canonicalize(target.dependencyManifest)) {
      issues.push(`${owner}: ${row.requirementId} typed proof dependencyManifest differs from the claimed target graph`);
      continue;
    }
    if (payload.applicabilityContract?.id !== row.applicabilityContract.id
      || payload.applicabilityContract?.version !== row.applicabilityContract.version
      || payload.applicabilityContract?.digest !== row.applicabilityContract.digest) {
      issues.push(`${owner}: ${row.requirementId} proof payload applicability contract differs from the result binding`);
      continue;
    }
    validateConformancePayloadSlices(payload, slices, `${owner} ${row.requirementId}/${evidenceId}`, issues);
    for (const slice of slices) {
      const matches = (payload.proofAssertions ?? []).filter((assertion) =>
        assertion.type === "requirement_verification"
        && assertion.evidenceId === evidenceId
        && assertion.scopeSliceId === slice.id
        && assertion.target === document.claim
        && assertion.targetId === target.targetId
        && assertion.targetSubjectDigest === target.targetSubject.digest
        && assertion.dependencyManifestDigest === target.dependencyManifest.digest
        && assertion.requirementId === row.requirementId);
      if (matches.length > 1) {
        issues.push(`${owner}: ${row.requirementId} has ${matches.length} typed proofs for scope slice ${slice.id}`);
      }
      for (const assertion of matches) {
        const verified = evidence.proofVerification?.results?.find((result) => result.assertionId === assertion.id);
        if (!verified?.valid) {
          issues.push(`${owner}: ${row.requirementId}/${slice.id} proof was not independently verified`);
          continue;
        }
        if (verified.derivedStatus !== row.status) {
          issues.push(`${owner}: ${row.requirementId}/${slice.id} derived proof status ${verified.derivedStatus} differs from row ${row.status}`);
          continue;
        }
        const expectedMethod = row.verifierOrReviewer?.role === "accountable_reviewer"
          ? "accountable_review" : "automated_replay";
        if (verified.method !== expectedMethod || verified.actorId !== row.verifierOrReviewer?.id) {
          issues.push(`${owner}: ${row.requirementId}/${slice.id} proof actor/method differs from verifierOrReviewer`);
          continue;
        }
        counts.set(slice.id, counts.get(slice.id) + 1);
      }
    }
  }
  for (const [sliceId, count] of counts) {
    if (row.status === "insufficient_evidence" && count > 1) {
      issues.push(`${owner}: ${row.requirementId} has ambiguous proof multiplicity for scope slice ${sliceId}; found ${count}`);
    } else if (row.status !== "insufficient_evidence" && count !== 1) {
      issues.push(`${owner}: ${row.requirementId} requires exactly one independently verified proof for scope slice ${sliceId}; found ${count}`);
    }
  }
}

async function distributionFiles(directory, extensions) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await distributionFiles(absolute, extensions));
    else if (entry.isFile() && extensions.some((extension) => entry.name.endsWith(extension))) {
      files.push(absolute);
    }
  }
  return files;
}

async function expectedDistributionEntries(kind) {
  const files = kind === "schemas"
    ? await distributionFiles(schemaDirectory, [".json"])
    : [
        ...await distributionFiles(path.join(root, "standard"), [".json", ".md"]),
        ...await distributionFiles(path.join(root, "profiles"), [".json", "-contract.md"])
      ];
  const entries = [];
  for (const absolute of files) {
    const bytes = await readFile(absolute);
    const relativeUri = path.relative(root, absolute).split(path.sep).join("/");
    const isJson = absolute.endsWith(".json");
    const parsed = isJson ? parseIJson(bytes.toString("utf8"), absolute) : null;
    entries.push({
      id: isJson
        ? (kind === "schemas" ? parsed.$id : (parsed.id ?? parsed.schemaVersion))
        : `normative-prose:${relativeUri}`,
      version: parsed?.version ?? parsed?.standardVersion ?? "0.1.0",
      uri: relativeUri,
      digest: sha256Bytes(bytes)
    });
  }
  return entries.sort((left, right) => left.uri.localeCompare(right.uri, "en"));
}

async function validateDistributionManifestPointer(pointer, kind, sourceAbsolute, owner, issues) {
  try {
    const absolute = resolveRepositoryPath(path.dirname(sourceAbsolute), pointer.uri);
    const bytes = await readFile(absolute);
    if (pointer.digest !== sha256Bytes(bytes)) throw new Error("raw-byte digest mismatch");
    const manifestDocument = parseIJson(bytes.toString("utf8"), absolute);
    const validate = ajv.getSchema("urn:agent-evals-standard:schema:distribution-manifest:1");
    if (!validate || !validate(manifestDocument)) {
      throw new Error(`schema invalid: ${ajv.errorsText(validate?.errors ?? [])}`);
    }
    if (manifestDocument.id !== pointer.id || manifestDocument.version !== pointer.version
      || manifestDocument.kind !== kind) throw new Error("identity, version, or kind mismatch");
    if (manifestDocument.entriesDigest !== sha256Canonical(manifestDocument.entries)
      || pointer.entriesDigest !== manifestDocument.entriesDigest) {
      throw new Error("entriesDigest is not reproducible");
    }
    const entryKeys = manifestDocument.entries.map((entry) => `${entry.id}\0${entry.version}\0${entry.uri}`);
    if (entryKeys.length !== new Set(entryKeys).size) throw new Error("duplicate manifest entry identity");
    const expected = await expectedDistributionEntries(kind);
    if (canonicalize(manifestDocument.entries) !== canonicalize(expected)) {
      throw new Error("entries differ from the exact pinned distribution set");
    }
  } catch (error) {
    issues.push(`${owner}: ${kind} distribution manifest invalid: ${error.message}`);
  }
}

async function checkConformanceGraph(document, sourceAbsolute, issues, fixture) {
  const owner = "conformanceGraph";
  const registry = await loadRequirementRegistry(owner, issues);
  if (!registry) return;
  await validateDistributionManifestPointer(document.schemas, "schemas", sourceAbsolute, owner, issues);
  await validateDistributionManifestPointer(document.contracts, "contracts", sourceAbsolute, owner, issues);
  const targetKeys = Object.keys(document.targetEvidence ?? {});
  if (targetKeys.length !== 1 || targetKeys[0] !== document.claim) {
    issues.push(`${owner}: targetEvidence must contain only the claimed target ${document.claim}`);
    return;
  }
  const target = document.targetEvidence[document.claim];
  if (target.targetType !== document.claim) {
    issues.push(`${owner}: targetType ${target.targetType} differs from claim ${document.claim}`);
  }
  const availableEvidence = evidenceIdsFrom(document, owner, issues);
  const evidencePayloads = await loadConformanceEvidencePayloads(document, sourceAbsolute, issues);
  const targetBinding = await resolveConformanceTargetBinding(document, target, sourceAbsolute, issues);
  const selectedSlices = await resolveConformanceScope(document, target, targetBinding, sourceAbsolute, evidencePayloads, issues);
  const declaredSlices = document.scope?.slices ?? [];
  requireEvidenceIds(target.evidenceIds, availableEvidence, `${owner} target`, issues);
  const expected = applicableRequirementIds(registry, document.claim);
  const rows = target.requirementResults ?? [];
  reportExactIds(expected, rows.map((entry) => entry.requirementId), `${owner} requirement coverage`, issues);
  const requirementsById = new Map((registry.requirements ?? []).map((entry) => [entry.id, entry]));
  const claimEffects = {
    pass: "none",
    fail: "nonconforming",
    insufficient_evidence: "insufficient_evidence"
  };
  const applicabilityCache = new Map();
  const checkedApplicabilityBindings = new Set();
  for (const row of rows) {
    const requirement = requirementsById.get(row.requirementId);
    if (row.target !== document.claim) {
      issues.push(`${owner}: ${row.requirementId} target ${row.target} differs from ${document.claim}`);
    }
    if (row.claimEffect !== claimEffects[row.status]) {
      issues.push(`${owner}: ${row.requirementId} claimEffect must be ${claimEffects[row.status]}`);
    }
    requireEvidenceIds(row.evidenceIds, availableEvidence, `${owner} ${row.requirementId}`, issues);
    const resolvedContract = await loadApplicabilityContract(row.applicabilityContract, sourceAbsolute, issues, applicabilityCache);
    if (resolvedContract) {
      const { contract } = resolvedContract;
      if (contract.target !== document.claim) {
        issues.push(`${owner}: ${row.requirementId} applicability contract target differs from ${document.claim}`);
      }
      const contractKey = canonicalize(row.applicabilityContract);
      if (!checkedApplicabilityBindings.has(contractKey)) {
        validateApplicabilityContractSlices(contract, declaredSlices, owner, issues);
        checkedApplicabilityBindings.add(contractKey);
      }
      const matchingRules = (contract.rules ?? []).filter((rule) => rule.id === row.applicabilityContract.ruleId
        && rule.requirementId === row.requirementId && rule.target === document.claim);
      if (matchingRules.length !== 1) {
        issues.push(`${owner}: ${row.requirementId} applicability rule resolves ${matchingRules.length} times`);
      } else {
        const rule = matchingRules[0];
        const applicable = applicabilityPredicate(rule, requirement, document.claim,
          `${owner} ${row.requirementId}`, issues);
        if (applicable === null) {
          if (row.status !== "insufficient_evidence") issues.push(`${owner}: ${row.requirementId} indeterminate applicability must be insufficient_evidence`);
        } else if (!applicable) {
          issues.push(`${owner}: ${row.requirementId} is not a registry member of target ${document.claim} and must be absent from coverage`);
        }
        reportCanonicalArray(row.evaluationProfileRuleIds ?? [], rule.evaluationProfileRuleIds ?? [],
          `${owner} ${row.requirementId} evaluation-profile rules`, issues);
        validateTypedProofCoverage(document, target, row, rule, evidencePayloads, declaredSlices, owner, issues);
      }
    }
    if (requirement) {
      const expectedRole = requirement.verificationKind === "manual_governance" ? "accountable_reviewer" : "verifier";
      const expectedId = expectedRole === "accountable_reviewer"
        ? requirement.accountableReviewer
        : requirement.verificationOwner;
      if (row.verifierOrReviewer?.role !== expectedRole || row.verifierOrReviewer?.id !== expectedId) {
        issues.push(`${owner}: ${row.requirementId} must be attested by ${expectedRole} ${expectedId}`);
      }
    }
  }
  const statuses = rows.map((entry) => entry.status);
  const derivedVerdict = statuses.includes("fail")
    ? "nonconforming"
    : statuses.includes("insufficient_evidence") || !statuses.includes("pass")
      ? "not_claimed"
      : "conforming";
  if (target.verdict !== derivedVerdict) {
    issues.push(`${owner}: target verdict must be ${derivedVerdict}, found ${target.verdict}`);
  }
  if (selectedSlices.length === declaredSlices.length && target.verdict === "conforming") {
    await validateDetachedConformanceEnvelope(document, sourceAbsolute, issues, fixture);
  }
}

function sameComponent(left, right) {
  return canonicalize(left) === canonicalize(right);
}

function sameComponentIdentity(left, right) {
  return left?.id === right?.id && left?.version === right?.version && left?.digest === right?.digest;
}

const scorecardNumericEpsilon = 1e-12;
const scorecardWilsonProcedure = {
  id: "wilson-interval-procedure",
  version: "0.1.0",
  digest: "sha256:a7a0e5d7bfbf39bcc30cea489459ee96fa104d13bd589629979b1b53189f4439"
};

function scorecardNumbersEqual(left, right) {
  return Number.isFinite(left) && Number.isFinite(right)
    && Math.abs(left - right) <= scorecardNumericEpsilon * Math.max(1, Math.abs(left), Math.abs(right));
}

function scorecardPolynomial(value, coefficients) {
  let result = coefficients.at(-1);
  for (let index = coefficients.length - 2; index >= 0; index -= 1) {
    result = result * value + coefficients[index];
  }
  return result;
}

// Wichura AS 241. This is deterministic over the binary64 JCS domain and
// avoids treating a human-written interval endpoint as an oracle.
function scorecardInverseNormalCdf(probability) {
  if (!(probability > 0 && probability < 1)) return null;
  const q = probability - 0.5;
  if (Math.abs(q) <= 0.425) {
    const r = 0.180625 - q * q;
    const numerator = [3.387132872796366608, 133.14166789178437745, 1971.5909503065514427,
      13731.693765509461, 45921.953931549871, 67265.7709270087, 33430.575583588128,
      2509.0809287301227];
    const denominator = [1, 42.313330701600911252, 687.1870074920579083, 5394.1960214247511,
      21213.794301586596, 39307.89580009271, 28729.085735721943, 5226.4952788528544];
    return q * scorecardPolynomial(r, numerator) / scorecardPolynomial(r, denominator);
  }
  let r = q < 0 ? probability : 1 - probability;
  r = Math.sqrt(-Math.log(r));
  let result;
  if (r <= 5) {
    r -= 1.6;
    const numerator = [1.42343711074968357734, 4.6303378461565452959, 5.7694972214606914055,
      3.64784832476320460504, 1.27045825245236838258, 0.24178072517745061177,
      0.0227238449892691845833, 0.00077454501427834140764];
    const denominator = [1, 2.05319162663775882187, 1.6763848301838038494,
      0.68976733498510000455, 0.14810397642748007459, 0.0151986665636164571966,
      0.0005475938084995344946, 1.05075007164441684324e-9];
    result = scorecardPolynomial(r, numerator) / scorecardPolynomial(r, denominator);
  } else {
    r -= 5;
    const numerator = [6.6579046435011037772, 5.4637849111641143699, 1.7848265399172913358,
      0.29656057182850489123, 0.026532189526576123093, 0.0012426609473880784386,
      0.0000271155556874348757815, 2.01033439929228813265e-7];
    const denominator = [1, 0.59983220655588793769, 0.13692988092273580531,
      0.0148753612908506148525, 0.0007868691311456132591, 0.000018463183175100546818,
      1.4215117583164458887e-7, 2.04426310338993978564e-15];
    result = scorecardPolynomial(r, numerator) / scorecardPolynomial(r, denominator);
  }
  return q < 0 ? -result : result;
}

function scorecardWilsonInterval(successes, total, confidenceLevel) {
  if (!Number.isInteger(successes) || !Number.isInteger(total) || total <= 0
    || successes < 0 || successes > total || !(confidenceLevel > 0 && confidenceLevel < 1)) return null;
  const z = scorecardInverseNormalCdf(1 - (1 - confidenceLevel) / 2);
  if (!Number.isFinite(z)) return null;
  const proportion = successes / total;
  const zSquared = z * z;
  const denominator = 1 + zSquared / total;
  const center = (proportion + zSquared / (2 * total)) / denominator;
  const halfWidth = z * Math.sqrt((proportion * (1 - proportion) + zSquared / (4 * total)) / total)
    / denominator;
  return { lower: Math.max(0, center - halfWidth), upper: Math.min(1, center + halfWidth) };
}

function checkScorecardWilsonInterval(interval, successes, total, label, issues) {
  if (!interval || interval.method !== "wilson") return;
  if (interval.version !== "0.1.0") {
    issues.push(`${label}: registered wilson interval version must be 0.1.0`);
    return;
  }
  const expected = scorecardWilsonInterval(successes, total, interval.confidenceLevel);
  if (!expected) {
    issues.push(`${label}: wilson interval inputs are not computable`);
    return;
  }
  if (!scorecardNumbersEqual(interval.lower, expected.lower)
    || !scorecardNumbersEqual(interval.upper, expected.upper)) {
    issues.push(`${label}: wilson interval must be [${expected.lower},${expected.upper}]`);
  }
}

function scorecardClaimRange(claim) {
  if (claim?.direction === "difference" || claim?.type === "comparative") return [-1, 1];
  if (claim?.type === "cost" || claim?.type?.includes(":")) return null;
  return [0, 1];
}

function checkScorecardInterval(interval, claim, point, label, issues) {
  if (!interval) return;
  if (interval.lower > interval.upper) issues.push(`${label}: interval lower exceeds upper`);
  if (claim?.confidenceLevel !== null && claim?.confidenceLevel !== undefined
    && !scorecardNumbersEqual(interval.confidenceLevel, claim.confidenceLevel)) {
    issues.push(`${label}: interval confidenceLevel differs from the sealed claim`);
  }
  const range = scorecardClaimRange(claim);
  if (range && (interval.lower < range[0] || interval.upper > range[1])) {
    issues.push(`${label}: interval must stay within [${range[0]},${range[1]}]`);
  }
  if (Number.isFinite(point) && (point < interval.lower - scorecardNumericEpsilon
    || point > interval.upper + scorecardNumericEpsilon)) {
    issues.push(`${label}: point estimate ${point} is outside its interval`);
  }
}

function checkScorecardBound(bound, claim, point, label, issues) {
  if (!bound) return;
  if (bound.lower > bound.upper) issues.push(`${label}: bound lower exceeds upper`);
  if (claim?.direction !== undefined && bound.direction !== claim.direction) {
    issues.push(`${label}: bound direction ${bound.direction} differs from claim direction ${claim.direction}`);
  }
  const range = scorecardClaimRange(claim);
  if (range && (bound.lower < range[0] || bound.upper > range[1])) {
    issues.push(`${label}: bounds must stay within [${range[0]},${range[1]}]`);
  }
  if (Number.isFinite(point) && (point < bound.lower - scorecardNumericEpsilon
    || point > bound.upper + scorecardNumericEpsilon)) {
    issues.push(`${label}: point estimate ${point} is outside its identification bounds`);
  }
}

async function loadScorecardTypedContract(pointer, sourceAbsolute, schemaId, label, issues) {
  if (!pointer) {
    issues.push(`${label}: contract pointer is missing`);
    return null;
  }
  try {
    const absolute = resolveRepositoryPath(path.dirname(sourceAbsolute), pointer.uri);
    const resolved = await digestForPointer(absolute);
    if (pointer.digest !== resolved.digest || pointer.id !== resolved.referenced?.id
      || (pointer.version !== undefined && pointer.version !== resolved.referenced?.version)) {
      throw new Error("pointer identity, version, or digest mismatch");
    }
    const validate = ajv.getSchema(schemaId);
    if (!validate || !validate(resolved.referenced)) {
      throw new Error(`schema invalid: ${ajv.errorsText(validate?.errors ?? [])}`);
    }
    return { contract: resolved.referenced, absolute };
  } catch (error) {
    issues.push(`${label}: cannot authenticate contract: ${error.message}`);
    return null;
  }
}

async function loadScorecardSuiteRegistry(pointer, sourceAbsolute, label, issues) {
  if (!pointer) {
    issues.push(`${label}: suite pointer is missing`);
    return null;
  }
  try {
    const absolute = resolveRepositoryPath(path.dirname(sourceAbsolute), pointer.uri);
    const resolved = await digestForPointer(absolute);
    if (pointer.digest !== resolved.digest || pointer.id !== resolved.referenced?.id
      || pointer.version !== resolved.referenced?.version) {
      throw new Error("pointer identity, version, or digest mismatch");
    }
    if (resolved.referenced?.schemaVersion !== "agent-eval-suite-manifest-1"
      || !Array.isArray(resolved.referenced?.cases)) {
      throw new Error("suite does not expose the required authenticated case registry");
    }
    return { contract: resolved.referenced, absolute };
  } catch (error) {
    issues.push(`${label}: cannot authenticate suite registry: ${error.message}`);
    return null;
  }
}

async function loadScorecardSuiteCaseDocuments(suiteResult, label, issues) {
  const documents = new Map();
  if (!suiteResult) return documents;
  for (const entry of suiteResult.contract.cases ?? []) {
    try {
      if (entry.locator?.kind !== "repository_relative" || entry.locator?.base !== "binding_document") {
        throw new Error("case locator must be repository_relative to the suite binding document");
      }
      const absolute = resolveRepositoryPath(path.dirname(suiteResult.absolute), entry.locator.path);
      const bytes = await readFile(absolute);
      if (sha256Bytes(bytes) !== entry.digest || bytes.length !== entry.byteLength) {
        throw new Error("case raw bytes do not match suite digest or byteLength");
      }
      const document = parseIJson(bytes.toString("utf8"), absolute);
      const documentVersion = document.version ?? document.caseVersion;
      if (document.id !== entry.id || documentVersion !== entry.version || document.digest !== entry.selfDigest) {
        throw new Error("case identity, version, or selfDigest differs from suite entry");
      }
      const validateCase = ajv.getSchema("urn:agent-evals-standard:schema:case:1");
      if (!validateCase || !validateCase(document)) {
        throw new Error(`case schema invalid: ${ajv.errorsText(validateCase?.errors ?? [])}`);
      }
      const workspacePointer = document.repository?.workspaceManifest;
      if (!workspacePointer) throw new Error("case workspace manifest pointer is missing");
      const workspaceAbsolute = resolveRepositoryPath(path.dirname(absolute), workspacePointer.uri);
      const workspaceBytes = await readFile(workspaceAbsolute);
      const workspaceManifestDigest = sha256Bytes(workspaceBytes);
      if (workspaceManifestDigest !== workspacePointer.digest) {
        throw new Error("case workspace manifest raw digest differs from its pointer");
      }
      const workspaceManifest = parseIJson(workspaceBytes.toString("utf8"), workspaceAbsolute);
      const validateWorkspace = ajv.getSchema("urn:agent-evals-standard:schema:workspace-manifest:1");
      if (!validateWorkspace || !validateWorkspace(workspaceManifest)) {
        throw new Error(`workspace manifest schema invalid: ${ajv.errorsText(validateWorkspace?.errors ?? [])}`);
      }
      if (workspaceManifest.id !== workspacePointer.id
        || workspaceManifest.version !== workspacePointer.version) {
        throw new Error("workspace manifest identity or version differs from case pointer");
      }
      const workspaceProblems = verifyWorkspaceManifest(workspaceManifest);
      if (workspaceProblems.length > 0) {
        throw new Error(`workspace manifest semantic validation failed: ${workspaceProblems.join("; ")}`);
      }
      documents.set(entry.id, {
        document,
        workspaceBinding: {
          manifestDigest: workspaceManifestDigest,
          workspaceRootDigest: workspaceManifest.workspaceRootDigest
        }
      });
    } catch (error) {
      issues.push(`${label}: case ${entry.id} cannot be authenticated: ${error.message}`);
    }
  }
  return documents;
}

function executeScorecardDecisionRule(rule, claim, result) {
  if (result.status === "not_applicable") return "not_applicable";
  const input = rule.input === "estimate" ? result.estimate
    : rule.input === "lower_bound" ? result.identificationBounds?.lower
      : result.identificationBounds?.upper;
  if (!Number.isFinite(input) || !Number.isFinite(claim.threshold)) return rule.missingInputResult;
  if (rule.operator === "gte") return (rule.inclusive ? input >= claim.threshold : input > claim.threshold) ? "pass" : "fail";
  return (rule.inclusive ? input <= claim.threshold : input < claim.threshold) ? "pass" : "fail";
}

function scorecardLedgerRoots(ledger) {
  const initialLedgerRoot = sha256Canonical({
    experimentId: ledger.experimentId,
    scheduledSetCommitment: ledger.scheduledSetCommitment
  });
  let terminalLedgerRoot = initialLedgerRoot;
  for (const attempt of ledger.attemptRecords ?? []) {
    terminalLedgerRoot = sha256Canonical({ previousRoot: terminalLedgerRoot, attempt });
  }
  return { initialLedgerRoot, terminalLedgerRoot };
}

function scorecardTrialSuccess(trial, claim, replayDerived = null) {
  if (!trial) return false;
  const predicates = replayDerived ?? trial;
  return claim?.successDefinition?.id === "accepted-outcome-v1"
    ? predicates.accepted === true
    : predicates.functional === true;
}

function scorecardStatisticValue(estimand, validN, validSuccesses, k) {
  if (!Number.isInteger(validN) || !Number.isInteger(validSuccesses) || !Number.isInteger(k)
    || validN <= 0 || k <= 0 || k > validN || validSuccesses < 0 || validSuccesses > validN) return null;
  if (estimand === "reliability_at_k") return (validSuccesses / validN) ** k;
  if (estimand !== "pass_at_k") return null;
  let allFailures = 1;
  for (let index = 0; index < k; index += 1) {
    const remainingFailures = validN - validSuccesses - index;
    if (remainingFailures <= 0) return 1;
    allFailures *= remainingFailures / (validN - index);
  }
  return 1 - allFailures;
}

function collectDirectTrialEvidenceIds(trial) {
  const ids = [];
  for (const entry of trial?.evidenceModeVerdicts ?? []) ids.push(...(entry.evidenceIds ?? []));
  for (const entry of trial?.failureCauses ?? []) ids.push(...(entry.evidenceIds ?? []));
  for (const entry of trial?.hardGates ?? []) {
    ids.push(...(entry.backingEvidenceIds ?? []), entry.assignmentEvidenceId, entry.triggerEvidenceId);
  }
  for (const entry of trial?.governanceStatuses ?? []) {
    ids.push(entry.triggerEvidenceId, entry.findingEvidenceId, entry.resolutionEventId);
  }
  for (const entry of trial?.decisionSurfaces ?? []) ids.push(...(entry.evidenceIds ?? []));
  ids.push(...(trial?.transcriptEvidence?.artifactIds ?? []));
  ids.push(...(trial?.interactionEvidence?.artifactIds ?? []));
  ids.push(trial?.outcomeReplay?.receiptEvidenceId);
  for (const entry of trial?.outcomeReplay?.materialArtifacts ?? []) ids.push(...(entry.evidenceIds ?? []));
  return ids.filter((id) => id !== undefined);
}

function collectTrialEvidenceIds(trial) {
  const ids = collectDirectTrialEvidenceIds(trial);
  ids.push(...(trial?.artifactIds ?? []));
  return ids.filter((id) => id !== undefined);
}

async function resolveBoundOutcomeProfile(binding, issues, owner = "scorecardGraph") {
  const candidates = new Map();
  for (const fixture of manifest.fixtures ?? []) {
    if (fixture.valid !== true || fixture.schema !== "urn:agent-evals-standard:schema:outcome-profile:1"
      || fixture.path === undefined) continue;
    try {
      const absolute = resolveRepositoryPath(fixtureDirectory, fixture.path);
      candidates.set(path.resolve(absolute), absolute);
    } catch {
      // The fixture's own validation reports an unreadable registered outcome profile.
    }
  }
  const matches = [];
  for (const absolute of candidates.values()) {
    try {
      const resolved = await digestForPointer(absolute);
      if (resolved.referenced?.id === binding.id && resolved.referenced?.version === binding.version
        && resolved.digest === binding.digest) matches.push(resolved.referenced);
    } catch {
      // A stale or invalid candidate cannot authenticate this binding.
    }
  }
  if (matches.length !== 1) {
    issues.push(`${owner}: outcome profile ${binding.id}@${binding.version}/${binding.digest} resolves ${matches.length} authenticated artifacts`);
    return null;
  }
  const validate = ajv.getSchema("urn:agent-evals-standard:schema:outcome-profile:1");
  if (!validate(matches[0])) {
    issues.push(`${owner}: outcome profile ${binding.id} is schema invalid: ${ajv.errorsText(validate.errors)}`);
    return null;
  }
  return matches[0];
}

let distributionOutcomeReplayRegistryPromise;

async function resolveDistributionOutcomeReplayBinding(outcomeProfileId) {
  distributionOutcomeReplayRegistryPromise ??= (async () => {
    const registryAbsolute = path.join(root, "standard", "outcome-replay-executor-registry.json");
    const registryBytes = await readFile(registryAbsolute);
    const registry = await readJsonStrict(registryAbsolute);
    const validate = ajv.getSchema("urn:agent-evals-standard:schema:outcome-replay-executor-registry:1");
    if (!validate || !validate(registry)) {
      throw new Error(`distribution outcome-replay registry is schema invalid: ${ajv.errorsText(validate?.errors ?? [])}`);
    }
    return { registry, registryAbsolute, registryDigest: sha256Bytes(registryBytes) };
  })();
  const { registry, registryAbsolute, registryDigest } = await distributionOutcomeReplayRegistryPromise;
  const matches = (registry.executors ?? []).filter((entry) => entry.outcomeProfileId === outcomeProfileId);
  if (matches.length !== 1) throw new Error(`${outcomeProfileId} resolves ${matches.length} registered executors`);
  const entry = matches[0];
  if (entry.outcomeProfile?.id !== entry.outcomeProfileId) {
    throw new Error(`${outcomeProfileId} registry entry has a mismatched outcomeProfile pointer`);
  }
  async function verifyPointer(pointer, label) {
    const absolute = resolveRepositoryPath(path.dirname(registryAbsolute), pointer.uri);
    const actualDigest = sha256Bytes(await readFile(absolute));
    if (pointer.digest !== actualDigest) throw new Error(`${pointer.id} ${label} digest must be ${actualDigest}`);
    return absolute;
  }
  const outcomeProfileAbsolute = await verifyPointer(entry.outcomeProfile, "outcome-profile");
  await verifyPointer(entry.semanticContract, "semantic-contract");
  await verifyPointer(entry.executor, "executable");
  await verifyPointer(entry.classificationApplicabilityRule, "classification-applicability-rule");
  const outcomeProfile = await readJsonStrict(outcomeProfileAbsolute);
  const validateOutcomeProfile = ajv.getSchema("urn:agent-evals-standard:schema:outcome-profile:1");
  if (!validateOutcomeProfile || !validateOutcomeProfile(outcomeProfile)
    || outcomeProfile.id !== entry.outcomeProfile.id || outcomeProfile.version !== entry.outcomeProfile.version) {
    throw new Error(`${entry.outcomeProfile.id} outcome profile is schema invalid or identity mismatched`);
  }
  return {
    registry: {
      id: registry.id,
      version: registry.version,
      uri: "standard/outcome-replay-executor-registry.json",
      digest: registryDigest
    },
    outcomeProfile: structuredClone(entry.outcomeProfile),
    semanticContract: structuredClone(entry.semanticContract),
    executor: structuredClone(entry.executor),
    applicabilityRule: structuredClone(entry.classificationApplicabilityRule),
    classifyMaterialPath: changedPathType
  };
}

let fixtureCaseQaClassificationFramePromise;

async function resolveFixtureCaseQaClassificationFrame(caseBinding) {
  fixtureCaseQaClassificationFramePromise ??= (async () => {
    const anchor = await readJsonStrict(path.join(
      fixtureDirectory,
      "positive",
      "case-qa-classification-frame-trust-anchor.json"
    ));
    return {
      case: structuredClone(anchor.case),
      activationInputDigest: anchor.case.activationInputDigest,
      repositoryConventionManifest: structuredClone(anchor.repositoryConventionManifest),
      materialPaths: structuredClone(anchor.materialPaths)
    };
  })();
  const trusted = await fixtureCaseQaClassificationFramePromise;
  if (["id", "version", "digest", "activationInputDigest"]
    .some((field) => caseBinding?.[field] !== trusted.case?.[field])) return null;
  return {
    activationInputDigest: trusted.activationInputDigest,
    repositoryConventionManifest: structuredClone(trusted.repositoryConventionManifest),
    materialPaths: structuredClone(trusted.materialPaths)
  };
}

async function loadDistributionOutcomeReplayExecutor(outcomeProfileId, issues, owner = "scorecardGraph") {
  try {
    const binding = await resolveDistributionOutcomeReplayBinding(outcomeProfileId);
    return { id: binding.executor.id, version: binding.executor.version, digest: binding.executor.digest };
  } catch (error) {
    issues.push(`${owner}: cannot resolve distribution outcome-replay executor: ${error.message}`);
    return null;
  }
}

function outcomeReplayTrustProfileFor(sourceAbsolute, issues, owner = "scorecardGraph") {
  const sourcePath = path.relative(fixtureDirectory, sourceAbsolute).split(path.sep).join("/");
  const matches = (manifest.outcomeReplayTrustBindings ?? []).filter((entry) => entry.sourcePath === sourcePath);
  if (matches.length !== 1) {
    issues.push(`${owner}: scorecard ${sourcePath} resolves ${matches.length} verifier-owned outcome-replay trust bindings`);
    return null;
  }
  const profile = verifierOwnedOutcomeReplayTrustProfiles.get(matches[0].profileId);
  if (!profile) {
    issues.push(`${owner}: verifier-owned outcome-replay trust profile ${matches[0].profileId} is not installed`);
    return null;
  }
  return profile;
}

async function authenticateScorecardReplayEvidence(artifact, sourceAbsolute, issues, label, trustProfile) {
  if (!artifact) return { authenticated: false, bytes: null };
  const materialProblems = await verifyEvidencePayload(artifact, { baseDirectory: path.dirname(sourceAbsolute) });
  for (const problem of materialProblems) issues.push(`${label}: evidence ${artifact.id} payload: ${problem}`);
  const signatureProblem = await artifactSignatureProblem(artifact);
  if (signatureProblem) issues.push(`${label}: evidence ${artifact.id} attestation: ${signatureProblem}`);
  let bytes = null;
  try {
    bytes = Buffer.from((await resolveEvidencePayloadBytes(artifact.payload, {
      baseDirectory: path.dirname(sourceAbsolute)
    })).bytes);
  } catch (error) {
    issues.push(`${label}: evidence ${artifact.id} bytes unavailable: ${error.message}`);
  }
  const configuredAuthority = trustProfile?.authorities?.get(artifact.attestation?.keyId);
  const authority = configuredAuthority
    && artifact.attestation?.profileId === configuredAuthority.profileId
    && artifact.producer?.id === configuredAuthority.actorId
    && (configuredAuthority.authorizedSchemaIds ?? []).includes(artifact.schemaMetadata?.schemaId)
      ? {
          keyId: configuredAuthority.keyId,
          actorId: configuredAuthority.actorId,
          trustDomain: configuredAuthority.trustDomain,
          publicKeyDigest: sha256Bytes(Buffer.from(configuredAuthority.publicKey, "utf8")),
          externallyConfigured: true,
        authorizedPurposes: configuredAuthority.authorizedPurposes
      }
    : null;
  return {
    authenticated: materialProblems.length === 0 && !signatureProblem && bytes !== null,
    bytes,
    authority
  };
}

async function checkTrialTerminalEvidence(
  trial,
  outcomeProfile,
  evidenceById,
  evidenceBaseDirectory,
  label,
  issues,
  accepted = trial?.accepted === true
) {
  if (!accepted || !outcomeProfile) return;
  const requirements = outcomeProfile.terminalEvidenceRequirements?.[trial.primaryOutcome]?.requiredArtifacts ?? [];
  for (const requirement of requirements) {
    const artifacts = (trial.artifactIds ?? []).map((id) => evidenceById.get(id))
      .filter((artifact) => artifact?.artifactType === requirement.artifactType);
    const cardinalityPass = requirement.cardinality === "exactly_one" ? artifacts.length === 1 : artifacts.length >= 1;
    if (!cardinalityPass) {
      issues.push(`${label}: accepted ${trial.primaryOutcome} terminal evidence ${requirement.artifactType} requires ${requirement.cardinality}, found ${artifacts.length}`);
      continue;
    }
    for (const artifact of artifacts) {
      const materialProblems = await verifyEvidencePayload(artifact, {
        baseDirectory: evidenceBaseDirectory
      });
      for (const problem of materialProblems) {
        issues.push(`${label}: terminal evidence ${artifact.id} material payload: ${problem}`);
      }
      if (requirement.attestation === "required") {
        const signatureProblem = await artifactSignatureProblem(artifact);
        if (signatureProblem) issues.push(`${label}: terminal evidence ${artifact.id} attestation: ${signatureProblem}`);
      }
      if (requirement.uriBinding === "artifact_sha256_matches_digest") {
        const locator = /^artifact:sha256:([a-f0-9]{64})$/.exec(artifact.uri ?? "");
        if (!locator || artifact.digest !== `sha256:${locator[1]}`) {
          issues.push(`${label}: terminal evidence ${artifact.id} must use an artifact:sha256 URI matching its digest`);
        }
      }
    }
  }
}

async function checkScorecardGraph(document, sourceAbsolute, issues, fixture) {
  issues.push(...baseAssuranceSelectionIssues({
    assuranceLevel: document.experiment?.assuranceLevel,
    effectiveRiskTier: document.experiment?.effectiveRiskTier,
    decisionClass: document.experiment?.assuranceLevel === "A0" ? "diagnostic" : "capability_claim",
    claimEligibility: document.experiment?.claimEligibility
  }, "scorecardGraph ASSURE-001"));
  const owner = "scorecardGraph";
  const availableEvidence = evidenceIdsFrom(document, owner, issues);
  const evidenceById = new Map((document.evidenceManifest ?? []).map((artifact) => [artifact.id, artifact]));
  const outcomeReplayTrustProfile = document.experiment?.claimEligibility === "claims_eligible"
    ? outcomeReplayTrustProfileFor(sourceAbsolute, issues)
    : null;
  const suiteResult = await loadScorecardSuiteRegistry(
    document.experiment?.suite,
    sourceAbsolute,
    `${owner} suite`,
    issues
  );
  const suiteCasesById = new Map((suiteResult?.contract?.cases ?? []).map((entry) => [entry.id, entry]));
  const suiteCaseDocumentsById = await loadScorecardSuiteCaseDocuments(
    suiteResult, `${owner} suite`, issues);
  const replayByCellId = new Map();
  const decisionRules = new Map();
  const arms = document.arms ?? [];
  const armIds = arms.map((entry) => entry.id);
  reportDuplicateIds(armIds, `${owner} arms`, issues);
  const armIdSet = new Set(armIds);
  const claims = document.claims ?? [];
  const results = document.claimResults ?? [];
  reportDuplicateIds(claims.map((entry) => entry.id), `${owner} claims`, issues);
  reportExactIds(claims.map((entry) => entry.id), results.map((entry) => entry.claimId), `${owner} claim results`, issues);
  const claimsById = new Map(claims.map((entry) => [entry.id, entry]));
  for (const claim of claims) {
    reportDuplicateIds((claim.outcomeProfiles ?? []).map((entry) => entry.id), `${owner} ${claim.id} outcome-profile IDs`, issues);
    reportDuplicateIds((claim.outcomeProfiles ?? []).map((entry) => entry.digest), `${owner} ${claim.id} outcome-profile digests`, issues);
    for (const armId of claim.comparatorArmIds ?? []) {
      if (!armIdSet.has(armId)) issues.push(`${owner}: claim ${claim.id} references unknown comparator arm ${armId}`);
    }
    const resolvedRule = await loadScorecardTypedContract(claim.decisionRule, sourceAbsolute,
      "urn:agent-evals-standard:schema:scorecard:1#/$defs/decisionRuleContract",
      `${owner} claim ${claim.id} decisionRule`, issues);
    if (resolvedRule) decisionRules.set(claim.id, resolvedRule.contract);
  }
  if (document.comparativeDesign) {
    reportExactIds(document.comparativeDesign.comparatorArmIds ?? [],
      arms.filter((entry) => entry.treatmentRole !== "single").map((entry) => entry.id),
      `${owner} comparative arms`, issues);
  }

  const caseProfiles = document.experiment?.caseProfiles ?? [];
  reportDuplicateIds(caseProfiles.map((entry) => entry.caseId), `${owner} caseProfiles`, issues);
  const profilesByCase = new Map(caseProfiles.map((entry) => [entry.caseId, entry]));
  const outcomeProfilesByCase = new Map();
  for (const profile of caseProfiles) {
    const outcomeProfile = await resolveBoundOutcomeProfile(profile.outcomeProfile ?? {}, issues);
    if (outcomeProfile) outcomeProfilesByCase.set(profile.caseId, outcomeProfile);
  }
  const caseResults = document.caseResults ?? [];
  reportExactIds(caseProfiles.map((entry) => entry.caseId), caseResults.map((entry) => entry.case?.id), `${owner} case results`, issues);

  const allCells = [];
  const cellsById = new Map();
  const cellContextById = new Map();
  const blockedCellIds = new Set();
  for (const caseResult of caseResults) {
    const caseId = caseResult.case?.id;
    const profile = profilesByCase.get(caseId);
    for (const coverageName of ["gateCoverage", "governanceCoverage"]) {
      const coverage = caseResult[coverageName];
      if (coverage && (!sameStringSet(coverage.expectedIds ?? [], coverage.evaluatedIds ?? [])
        || coverage.expectedDigest !== coverage.evaluatedDigest)) {
        issues.push(`${owner}: ${caseId} ${coverageName} is not exact`);
      }
    }
    for (const cell of caseResult.cells ?? []) {
      allCells.push(cell);
      if (cellsById.has(cell.cellId)) issues.push(`${owner}: cell ${cell.cellId} occurs more than once`);
      cellsById.set(cell.cellId, cell);
      cellContextById.set(cell.cellId, { caseId, profile, caseResult });
      if (!armIdSet.has(cell.armId)) issues.push(`${owner}: cell ${cell.cellId} references unknown arm ${cell.armId}`);
      if (profile && cell.evaluationProfileDigest !== profile.effectiveProfileDigest) {
        issues.push(`${owner}: cell ${cell.cellId} evaluation profile digest differs from its sealed case binding`);
      }
      if (profile && !sameComponent(cell.outcomeProfile, profile.outcomeProfile)) {
        issues.push(`${owner}: cell ${cell.cellId} outcome profile differs from its sealed case binding`);
      }
      const trial = cell.trialResult;
      requireEvidenceIds(collectTrialEvidenceIds(trial), availableEvidence, `${owner} cell ${cell.cellId}`, issues);
      if (!trial) continue;
      const boundOutcomeProfile = outcomeProfilesByCase.get(caseId);
      const nativeOutcomeMatches = (boundOutcomeProfile?.nativeOutcomes ?? [])
        .filter((entry) => entry.id === trial.profileOutcome?.id);
      if (nativeOutcomeMatches.length !== 1) {
        issues.push(`${owner}: cell ${cell.cellId} profile outcome ${trial.profileOutcome?.id ?? "<missing>"} resolves ${nativeOutcomeMatches.length} times in its authenticated outcome profile`);
      } else {
        const nativeOutcome = nativeOutcomeMatches[0];
        if (nativeOutcome.baseOutcome !== trial.primaryOutcome) {
          issues.push(`${owner}: cell ${cell.cellId} native outcome ${nativeOutcome.id} normalizes to ${nativeOutcome.baseOutcome}, not ${trial.primaryOutcome}`);
        }
        const allowedSubstatuses = nativeOutcome.allowedSubstatuses ?? [];
        const recordedSubstatus = trial.profileOutcome?.substatus;
        if (allowedSubstatuses.length > 0 && recordedSubstatus === null) {
          issues.push(`${owner}: cell ${cell.cellId} native outcome ${nativeOutcome.id} requires one of its registered substatuses`);
        } else if (recordedSubstatus !== null && !allowedSubstatuses.includes(recordedSubstatus)) {
          issues.push(`${owner}: cell ${cell.cellId} native outcome ${nativeOutcome.id} does not register substatus ${recordedSubstatus}`);
        }
      }
      let replayResult = null;
      if (document.experiment?.claimEligibility === "claims_eligible") {
        const expectedCase = suiteCasesById.get(caseId);
        if (!expectedCase) {
          issues.push(`${owner}: cell ${cell.cellId} case does not resolve in the authenticated suite`);
        } else {
          const expectedExecutor = await loadDistributionOutcomeReplayExecutor(cell.outcomeProfile?.id, issues);
          const replay = trial.outcomeReplay;
          const receiptArtifact = evidenceById.get(replay?.receiptEvidenceId);
          const materialIds = [...new Set([
            replay?.receiptEvidenceId,
            ...(trial?.artifactIds ?? []),
            ...(replay?.materialArtifacts ?? []).flatMap((entry) => entry.evidenceIds ?? [])
          ].filter(Boolean))];
          const artifactBytesById = new Map();
          const authenticatedEvidenceIds = new Set();
          const evidenceAuthoritiesById = new Map();
          const parsedEvidenceById = new Map();
          for (const evidenceId of materialIds) {
            const artifact = evidenceById.get(evidenceId);
            const authentication = await authenticateScorecardReplayEvidence(
              artifact,
              sourceAbsolute,
              issues,
              `${owner} cell ${cell.cellId} outcome replay`,
              outcomeReplayTrustProfile
            );
            if (authentication.bytes) artifactBytesById.set(evidenceId, authentication.bytes);
            if (authentication.authenticated) authenticatedEvidenceIds.add(evidenceId);
            if (authentication.authority) evidenceAuthoritiesById.set(evidenceId, authentication.authority);
            if (authentication.bytes && evidenceById.get(evidenceId)?.mediaType === "application/json") {
              try {
                parsedEvidenceById.set(
                  evidenceId,
                  parseIJson(authentication.bytes.toString("utf8"), evidenceId)
                );
              } catch (error) {
                issues.push(`${owner} cell ${cell.cellId}: replay evidence ${evidenceId} is not strict JSON: ${error.message}`);
              }
            }
          }
          const replaySchemaByArtifactType = new Map([
            ["repo-change-v1:runner_check_record", "urn:agent-evals-standard:schema:repo-change-runner-check-record:1"],
            ["repo-change-v1:adjudication_record", "urn:agent-evals-standard:schema:repo-change-adjudication-record:1"],
            ["repo-change-v1:measurement_validity_record", "urn:agent-evals-standard:schema:repo-change-measurement-validity-record:1"],
            ["repo-change-v1:safe_refusal_record", "urn:agent-evals-standard:schema:repo-change-alternative-terminal-record:1"],
            ["repo-change-v1:refusal_applicability_record", "urn:agent-evals-standard:schema:repo-change-alternative-terminal-record:1"],
            ["repo-change-v1:base_state_record", "urn:agent-evals-standard:schema:repo-change-alternative-terminal-record:1"]
          ]);
          for (const evidenceId of materialIds) {
            const artifact = evidenceById.get(evidenceId);
            const schemaId = replaySchemaByArtifactType.get(artifact?.artifactType);
            if (!schemaId) continue;
            const parsedArtifact = parsedEvidenceById.get(evidenceId);
            const validateArtifact = ajv.getSchema(schemaId);
            if (!parsedArtifact || !validateArtifact || !validateArtifact(parsedArtifact)) {
              issues.push(`${owner} cell ${cell.cellId}: replay evidence ${evidenceId} schema invalid for ${artifact.artifactType}: ${ajv.errorsText(validateArtifact?.errors ?? [])}`);
            }
          }
          let receipt = parsedEvidenceById.get(receiptArtifact?.id) ?? null;
          if (receipt) {
            const validateReceipt = ajv.getSchema("urn:agent-evals-standard:schema:outcome-replay-receipt:1");
            if (!validateReceipt || !validateReceipt(receipt)) {
              issues.push(`${owner} cell ${cell.cellId}: outcome replay receipt schema invalid: ${ajv.errorsText(validateReceipt?.errors ?? [])}`);
              receipt = null;
            }
            if (receipt && Object.hasOwn(receipt, "graderAssessment")) {
              const assessmentId = receipt.graderAssessment?.evidenceId;
              const assessment = parsedEvidenceById.get(assessmentId);
              const validateAssessment = ajv.getSchema("urn:agent-evals-standard:schema:repo-change-grader-assessment:1");
              if (!assessment || !validateAssessment || !validateAssessment(assessment)) {
                issues.push(`${owner} cell ${cell.cellId}: grader assessment ${assessmentId ?? "<missing>"} schema invalid: ${ajv.errorsText(validateAssessment?.errors ?? [])}`);
              }
            }
          }
          for (const mapping of replay?.materialArtifacts ?? []) {
            if (mapping.workArtifactType !== "assurance_report") continue;
            for (const evidenceId of mapping.evidenceIds ?? []) {
              const report = parsedEvidenceById.get(evidenceId);
              const validateReport = ajv.getSchema("urn:agent-evals-standard:schema:repo-change-assurance-report:1");
              if (!report || !validateReport || !validateReport(report)) {
                issues.push(`${owner} cell ${cell.cellId}: assurance report ${evidenceId} schema invalid: ${ajv.errorsText(validateReport?.errors ?? [])}`);
              }
            }
          }
          if (expectedExecutor && receipt) {
            replayResult = executeOutcomeReplay({
              trial,
              receipt,
              receiptEvidence: receiptArtifact,
              expectedExecutor,
              expectedCase,
              expectedCaseDocument: suiteCaseDocumentsById.get(caseId)?.document,
              expectedWorkspace: suiteCaseDocumentsById.get(caseId)?.workspaceBinding,
              expectedCell: {
                experimentId: document.experiment.id,
                cellId: cell.cellId,
                armId: cell.armId,
                blockId: cell.blockId,
                seed: cell.seed,
                evaluationProfileDigest: cell.evaluationProfileDigest,
                outcomeProfile: cell.outcomeProfile
              },
              expectedGraderSet: (document.arms ?? [])
                .find((entry) => entry.id === cell.armId)?.graderSet ?? null,
              outcomeProfile: boundOutcomeProfile,
              evidenceById,
              artifactBytesById,
              authenticatedEvidenceIds,
              parsedEvidenceById,
              evidenceAuthoritiesById,
              receiptAuthority: evidenceAuthoritiesById.get(replay.receiptEvidenceId),
              claimantAuthority: (() => {
                const authority = outcomeReplayTrustProfile?.claimantAuthorities?.get(document.signature?.keyId);
                return authority ? {
                  keyId: authority.keyId,
                  actorId: authority.actorId,
                  trustDomain: authority.trustDomain,
                  publicKeyDigest: sha256Bytes(Buffer.from(authority.publicKey, "utf8"))
                } : null;
              })(),
              conformanceFixtureMode: true
            });
            issues.push(...replayResult.issues.map((problem) => `${owner}: ${problem}`));
            if (replayResult.derived) replayByCellId.set(cell.cellId, replayResult.derived);
          }
        }
      }
      await checkTrialTerminalEvidence(
        trial,
        boundOutcomeProfile,
        evidenceById,
        path.dirname(sourceAbsolute),
        `${owner} cell ${cell.cellId}`,
        issues,
        replayResult?.derived?.accepted === true
      );
      reportDuplicateIds((trial.evidenceModeVerdicts ?? []).map((entry) => entry.modeId), `${owner} cell ${cell.cellId} evidence modes`, issues);
      reportDuplicateIds((trial.failureCauses ?? []).map((entry) => entry.id), `${owner} cell ${cell.cellId} failure causes`, issues);
      reportDuplicateIds((trial.hardGates ?? []).map((entry) => entry.id), `${owner} cell ${cell.cellId} hard gates`, issues);
      reportDuplicateIds((trial.governanceStatuses ?? []).map((entry) => entry.id), `${owner} cell ${cell.cellId} governance statuses`, issues);
      reportDuplicateIds((trial.decisionSurfaces ?? []).map((entry) => entry.surfaceId), `${owner} cell ${cell.cellId} decision surfaces`, issues);
      reportExactIds(caseResult.gateCoverage?.evaluatedIds ?? [], (trial.hardGates ?? []).map((entry) => entry.id), `${owner} cell ${cell.cellId} gate coverage`, issues);
      reportExactIds(caseResult.governanceCoverage?.evaluatedIds ?? [], (trial.governanceStatuses ?? []).map((entry) => entry.id), `${owner} cell ${cell.cellId} governance coverage`, issues);
      const declaredArtifacts = new Set(trial.artifactIds ?? []);
      for (const evidenceId of collectDirectTrialEvidenceIds(trial)) {
        if (!declaredArtifacts.has(evidenceId)) {
          issues.push(`${owner}: cell ${cell.cellId} evidence ${evidenceId} is absent from trial artifactIds`);
        }
      }
      const failureCauseCounts = occurrenceCounts((trial.failureCauses ?? []).map((entry) => entry.id));
      for (const gate of trial.hardGates ?? []) {
        if (gate.failureCauseId !== null && failureCauseCounts.get(gate.failureCauseId) !== 1) {
          issues.push(`${owner}: cell ${cell.cellId} gate ${gate.id} failureCauseId ${gate.failureCauseId} resolves ${failureCauseCounts.get(gate.failureCauseId) ?? 0} times`);
        }
        if (gate.status !== "pass") blockedCellIds.add(cell.cellId);
      }
      for (const surface of trial.decisionSurfaces ?? []) {
        if (["outcome", "risk"].includes(surface.materiality)
          && !["pass", "not_applicable"].includes(surface.status)) blockedCellIds.add(cell.cellId);
      }
      if (trial.validity === "valid" && trial.transcriptEvidence?.status !== "complete") {
        issues.push(`${owner}: valid trial ${trial.attemptId} must have complete transcript evidence`);
      }
    }
  }

  const integrity = document.attemptIntegrity ?? {};
  const attempts = integrity.attemptRecords ?? [];
  const attemptIds = attempts.map((entry) => entry.attemptId);
  reportDuplicateIds(attemptIds, `${owner} attempt records`, issues);
  const attemptsById = new Map(attempts.map((entry) => [entry.attemptId, entry]));
  const attemptsByCell = new Map();
  const runStartedAt = Date.parse(document.experiment?.startedAt);
  const runClosedAt = Date.parse(document.experiment?.closedAt);
  for (const attempt of attempts) {
    if (!attemptsByCell.has(attempt.cellId)) attemptsByCell.set(attempt.cellId, []);
    attemptsByCell.get(attempt.cellId).push(attempt);
    if (!cellsById.has(attempt.cellId)) issues.push(`${owner}: attempt ${attempt.attemptId} references unknown cell ${attempt.cellId}`);
    requireEvidenceIds(attempt.artifactIds, availableEvidence, `${owner} attempt ${attempt.attemptId}`, issues);
    if ((attempt.artifactIds ?? []).length === 0) issues.push(`${owner}: attempt ${attempt.attemptId} has no evidence artifacts`);
    const startedAt = Date.parse(attempt.startedAt);
    const finishedAt = Date.parse(attempt.finishedAt);
    if (finishedAt < startedAt) issues.push(`${owner}: attempt ${attempt.attemptId} finishes before it starts`);
    if (startedAt < runStartedAt || finishedAt > runClosedAt) {
      issues.push(`${owner}: attempt ${attempt.attemptId} falls outside experiment time bounds`);
    }
    if (attempt.parentAttemptId === null && attempt.retryReason !== null) {
      issues.push(`${owner}: root attempt ${attempt.attemptId} must not have a retryReason`);
    }
    if (attempt.parentAttemptId !== null && (typeof attempt.retryReason !== "string" || attempt.retryReason.length === 0)) {
      issues.push(`${owner}: retry attempt ${attempt.attemptId} must declare retryReason`);
    }
    if (attempt.terminalState === "completed" && !["valid", "invalid"].includes(attempt.measurementValidity)) {
      issues.push(`${owner}: completed attempt ${attempt.attemptId} must be valid or invalid`);
    }
    if (attempt.terminalState !== "completed" && attempt.measurementValidity !== "not_assessable") {
      issues.push(`${owner}: ${attempt.terminalState} attempt ${attempt.attemptId} must be not_assessable`);
    }
  }

  const resolvedCellCount = allCells.filter((entry) => entry.state === "resolved").length;
  const unresolvedCellCount = allCells.length - resolvedCellCount;
  if (integrity.scheduledCells !== allCells.length) {
    issues.push(`${owner}: attemptIntegrity.scheduledCells must be ${allCells.length}, found ${integrity.scheduledCells}`);
  }
  if (integrity.resolvedCells !== resolvedCellCount) {
    issues.push(`${owner}: attemptIntegrity.resolvedCells must be ${resolvedCellCount}, found ${integrity.resolvedCells}`);
  }
  if (integrity.unresolvedCells !== unresolvedCellCount) {
    issues.push(`${owner}: attemptIntegrity.unresolvedCells must be ${unresolvedCellCount}, found ${integrity.unresolvedCells}`);
  }
  if (integrity.physicalAttemptCount !== attempts.length) {
    issues.push(`${owner}: attemptIntegrity.physicalAttemptCount must be ${attempts.length}, found ${integrity.physicalAttemptCount}`);
  }
  const derivedAttemptCounts = {
    validAttempts: attempts.filter((entry) => entry.measurementValidity === "valid").length,
    invalidAttempts: attempts.filter((entry) => entry.measurementValidity === "invalid").length,
    interruptedAttempts: attempts.filter((entry) => entry.terminalState === "interrupted").length,
    missingCaptureAttempts: attempts.filter((entry) => entry.terminalState === "missing_capture").length,
    replacementAttempts: attempts.filter((entry) => entry.parentAttemptId !== null).length
  };
  for (const [field, expected] of Object.entries(derivedAttemptCounts)) {
    if (integrity[field] !== expected) {
      issues.push(`${owner}: attemptIntegrity.${field} must be ${expected}, found ${integrity[field]}`);
    }
  }
  if (integrity.resolvedCells + integrity.unresolvedCells !== integrity.scheduledCells) {
    issues.push(`${owner}: resolvedCells + unresolvedCells must equal scheduledCells`);
  }
  if (integrity.validAttempts + integrity.invalidAttempts + integrity.interruptedAttempts
    + integrity.missingCaptureAttempts !== integrity.physicalAttemptCount) {
    issues.push(`${owner}: terminal attempt-state counts must equal physicalAttemptCount`);
  }
  const expectedUnresolvedRate = allCells.length === 0 ? 0 : unresolvedCellCount / allCells.length;
  if (!scorecardNumbersEqual(integrity.unresolvedCellRate, expectedUnresolvedRate)) {
    issues.push(`${owner}: unresolvedCellRate must be ${expectedUnresolvedRate}, found ${integrity.unresolvedCellRate}`);
  }
  if (integrity.status === "valid" && integrity.unresolvedCellRate > integrity.unresolvedCellRateThreshold + scorecardNumericEpsilon) {
    issues.push(`${owner}: valid attempt integrity exceeds unresolvedCellRateThreshold`);
  }
  if (!sameComponent(integrity.scheduledSetCommitment, document.experiment?.scheduledSetCommitment)) {
    issues.push(`${owner}: attempt-integrity scheduledSetCommitment differs from experiment`);
  }

  const rateGroups = new Map();
  for (const cell of allCells) {
    const context = cellContextById.get(cell.cellId);
    const key = canonicalize([context?.caseId, cell.armId]);
    if (!rateGroups.has(key)) rateGroups.set(key, { caseId: context?.caseId, armId: cell.armId, cells: [], attempts: [] });
    rateGroups.get(key).cells.push(cell);
    rateGroups.get(key).attempts.push(...(attemptsByCell.get(cell.cellId) ?? []));
  }
  const rateRows = integrity.ratesByArmAndCase ?? [];
  reportExactIds([...rateGroups.keys()], rateRows.map((entry) => canonicalize([entry.caseId, entry.armId])),
    `${owner} ratesByArmAndCase`, issues);
  for (const row of rateRows) {
    const key = canonicalize([row.caseId, row.armId]);
    const group = rateGroups.get(key);
    if (!group) continue;
    const expected = {
      scheduledCells: group.cells.length,
      resolvedCells: group.cells.filter((entry) => entry.state === "resolved").length,
      unresolvedCells: group.cells.filter((entry) => entry.state === "unresolved").length,
      physicalAttemptCount: group.attempts.length,
      validAttempts: group.attempts.filter((entry) => entry.measurementValidity === "valid").length,
      invalidAttempts: group.attempts.filter((entry) => entry.measurementValidity === "invalid").length,
      interruptedAttempts: group.attempts.filter((entry) => entry.terminalState === "interrupted").length,
      missingCaptureAttempts: group.attempts.filter((entry) => entry.terminalState === "missing_capture").length,
      replacementAttempts: group.attempts.filter((entry) => entry.parentAttemptId !== null).length
    };
    expected.unresolvedCellRate = expected.unresolvedCells / expected.scheduledCells;
    for (const [field, value] of Object.entries(expected)) {
      const equal = field === "unresolvedCellRate" ? scorecardNumbersEqual(row[field], value) : row[field] === value;
      if (!equal) issues.push(`${owner}: ratesByArmAndCase ${row.caseId}/${row.armId} ${field} must be ${value}`);
    }
  }
  const resolvedLedger = await loadScorecardTypedContract(integrity.ledger, sourceAbsolute,
    "urn:agent-evals-standard:schema:scorecard:1#/$defs/attemptLedger",
    `${owner} attempt ledger`, issues);
  if (resolvedLedger) {
    const ledger = resolvedLedger.contract;
    if (ledger.experimentId !== document.experiment?.id) {
      issues.push(`${owner}: attempt ledger belongs to experiment ${ledger.experimentId}`);
    }
    if (!sameComponent(ledger.scheduledSetCommitment, integrity.scheduledSetCommitment)) {
      issues.push(`${owner}: attempt ledger uses a different scheduled-set commitment`);
    }
    if (!sameComponent(ledger.attemptRecords, attempts)) {
      issues.push(`${owner}: scorecard attempt records differ from the authenticated ledger`);
    }
    const expectedRoots = scorecardLedgerRoots(ledger);
    if (ledger.initialLedgerRoot !== expectedRoots.initialLedgerRoot
      || integrity.initialLedgerRoot !== expectedRoots.initialLedgerRoot) {
      issues.push(`${owner}: initialLedgerRoot must be ${expectedRoots.initialLedgerRoot}`);
    }
    if (ledger.terminalLedgerRoot !== expectedRoots.terminalLedgerRoot
      || integrity.terminalLedgerRoot !== expectedRoots.terminalLedgerRoot) {
      issues.push(`${owner}: terminalLedgerRoot must be ${expectedRoots.terminalLedgerRoot}`);
    }

    const resolvedCheckpoint = await loadScorecardTypedContract(
      integrity.externalAttemptCheckpoint,
      sourceAbsolute,
      "urn:agent-evals-standard:schema:attempt-checkpoint:1",
      `${owner} external attempt checkpoint`,
      issues
    );
    if (resolvedCheckpoint) {
      const checkpointProblems = verifyAttemptLedgerCheckpoint(
        resolvedCheckpoint.contract,
        ledger,
        {
          attemptIntegrity: integrity,
          scorecardSignature: document.signature,
          scorecardSigner: {
            keyId: "rfc8032-test-key-1",
            trustDomain: "fixture-scorecard-boundary",
            publicKey: fixtureKey
          },
          trustedSchedulerKeys: {
            "rfc8032-test-key-2-scheduler": {
              issuerId: canonicalAttemptIntegrityVector.scheduler.issuerId,
              trustDomain: canonicalAttemptIntegrityVector.scheduler.trustDomain,
              profileId: canonicalAttemptIntegrityVector.scheduler.profileId,
              publicKey: schedulerFixtureKey
            }
          },
          expectedLogHead: canonicalAttemptIntegrityVector.expectedLogHead
        }
      );
      for (const problem of checkpointProblems) {
        issues.push(`${owner} attempt checkpoint: ${problem}`);
      }
    }
  }

  for (const cell of allCells) {
    const cellAttempts = attemptsByCell.get(cell.cellId) ?? [];
    reportExactIds(cell.lineage ?? [], cellAttempts.map((entry) => entry.attemptId), `${owner} cell ${cell.cellId} attempt lineage`, issues);
    const lineageRecords = [];
    for (const [index, attemptId] of (cell.lineage ?? []).entries()) {
      const attempt = attemptsById.get(attemptId);
      if (!attempt) continue;
      lineageRecords.push(attempt);
      if (attempt.cellId !== cell.cellId) issues.push(`${owner}: lineage attempt ${attemptId} belongs to ${attempt.cellId}, not ${cell.cellId}`);
      const expectedParent = index === 0 ? null : cell.lineage[index - 1];
      if (attempt.parentAttemptId !== expectedParent) {
        issues.push(`${owner}: lineage attempt ${attemptId} parent must be ${expectedParent}`);
      }
      if (index > 0) {
        const predecessor = attemptsById.get(expectedParent);
        if (predecessor && Date.parse(attempt.startedAt) < Date.parse(predecessor.finishedAt)) {
          issues.push(`${owner}: retry attempt ${attemptId} starts before predecessor ${expectedParent} finishes`);
        }
        if (predecessor?.terminalState === "completed" && predecessor.measurementValidity === "valid") {
          issues.push(`${owner}: retry attempt ${attemptId} follows already-valid attempt ${expectedParent}`);
        }
      }
    }
    const firstEligible = lineageRecords.find((entry) => entry.terminalState === "completed" && entry.measurementValidity === "valid");
    if (cell.state === "unresolved") {
      if (firstEligible) issues.push(`${owner}: unresolved cell ${cell.cellId} has eligible valid attempt ${firstEligible.attemptId}`);
      continue;
    }
    if (!firstEligible) {
      issues.push(`${owner}: resolved cell ${cell.cellId} has no eligible valid attempt`);
      continue;
    }
    if (cell.selectedAttemptId !== firstEligible.attemptId) {
      issues.push(`${owner}: cell ${cell.cellId} must select first eligible attempt ${firstEligible.attemptId}`);
    }
    if (cell.trialResult?.attemptId !== cell.selectedAttemptId) {
      issues.push(`${owner}: cell ${cell.cellId} trial attempt differs from selectedAttemptId`);
    }
    if (cell.trialResult?.validity !== "valid") {
      issues.push(`${owner}: resolved cell ${cell.cellId} selected trial must be valid`);
    }
    if (cell.trialResult?.metrics?.costUsd !== undefined
      && !scorecardNumbersEqual(cell.trialResult.metrics.costUsd, firstEligible.metrics?.costUsd)) {
      issues.push(`${owner}: cell ${cell.cellId} selected-trial cost differs from attempt ledger`);
    }
  }

  for (const result of results) {
    const claim = claimsById.get(result.claimId);
    if (!claim) continue;
    const expectedEligibleCellIds = [];
    for (const caseResult of caseResults) {
      if (!(claim.slice ?? []).includes(caseResult.case?.id)) continue;
      for (const cell of caseResult.cells ?? []) {
        if ((claim.comparatorArmIds ?? []).length === 0 || claim.comparatorArmIds.includes(cell.armId)) {
          expectedEligibleCellIds.push(cell.cellId);
        }
      }
    }
    reportExactIds(expectedEligibleCellIds, result.eligibleCellIds ?? [], `${owner} ${result.claimId} eligible cells`, issues);
    const expectedAssignmentCellIds = expectedEligibleCellIds.filter((cellId) => cellsById.get(cellId)?.state !== "unresolved");
    reportExactIds(expectedAssignmentCellIds, (result.successAssignments ?? []).map((entry) => entry.cellId), `${owner} ${result.claimId} success assignments`, issues);
    if (result.status === "supported" && (result.eligibleCellIds ?? []).length === 0) {
      issues.push(`${owner}: supported claim ${result.claimId} has no eligible cells`);
    }
    if (result.status === "supported" && (claim.coverageGaps ?? []).length > 0) {
      issues.push(`${owner}: supported claim ${result.claimId} has declared coverage gaps`);
    }
    if (result.status === "supported" && (result.reasonIds ?? []).length > 0) {
      issues.push(`${owner}: supported claim ${result.claimId} must not carry failure reasons`);
    }
    if (claim.assuranceLevel !== document.experiment?.assuranceLevel) {
      issues.push(`${owner}: claim ${result.claimId} assuranceLevel differs from experiment`);
    }
    if (!(claim.effectiveRiskRange ?? []).every((tier) => (document.experiment?.effectiveRiskRange ?? []).includes(tier))) {
      issues.push(`${owner}: claim ${result.claimId} risk range exceeds experiment scope`);
    }
    for (const cellId of result.eligibleCellIds ?? []) {
      const cell = cellsById.get(cellId);
      const context = cellContextById.get(cellId);
      if (!cell) {
        issues.push(`${owner}: claim ${result.claimId} references unknown cell ${cellId}`);
        continue;
      }
      if (!(claim.slice ?? []).includes(context.caseId)) {
        issues.push(`${owner}: cell ${cellId} is outside claim ${result.claimId} slice`);
      }
      if (!sameComponent(context.profile?.evaluationProfile, claim.evaluationProfile)) {
        issues.push(`${owner}: cell ${cellId} evaluation profile is outside claim ${result.claimId}`);
      }
      if (!(claim.outcomeProfiles ?? []).some((binding) => sameComponent(binding, cell.outcomeProfile))) {
        issues.push(`${owner}: cell ${cellId} outcome profile is outside claim ${result.claimId}`);
      }
      if (result.status === "supported" && blockedCellIds.has(cellId)) {
        issues.push(`${owner}: supported claim ${result.claimId} includes materially blocked cell ${cellId}`);
      }
      if (result.status === "supported" && !replayByCellId.has(cellId)) {
        issues.push(`${owner}: supported claim ${result.claimId} includes cell ${cellId} without a successful independent outcome replay`);
      }
    }
    const assignmentsByCell = new Map((result.successAssignments ?? []).map((entry) => [entry.cellId, entry]));
    for (const assignment of result.successAssignments ?? []) {
      const cell = cellsById.get(assignment.cellId);
      if (cell?.trialResult) {
        const expected = scorecardTrialSuccess(cell.trialResult, claim, replayByCellId.get(assignment.cellId));
        if (assignment.success !== expected) {
          issues.push(`${owner}: ${result.claimId} assignment ${assignment.cellId} must be success=${expected}`);
        }
        const replayEvidenceId = cell.trialResult.outcomeReplay?.receiptEvidenceId;
        if (replayEvidenceId && !(assignment.evidenceIds ?? []).includes(replayEvidenceId)) {
          issues.push(`${owner}: ${result.claimId} assignment ${assignment.cellId} does not cite its independent outcome replay receipt`);
        }
      } else if (assignment.success === true) {
        issues.push(`${owner}: unresolved cell ${assignment.cellId} cannot be assigned success`);
      }
      requireEvidenceIds(assignment.evidenceIds, availableEvidence, `${owner} ${result.claimId} assignment ${assignment.cellId}`, issues);
    }
    checkScorecardInterval(result.interval, claim, result.estimate, `${owner} ${result.claimId}`, issues);
    const resultSuccesses = expectedAssignmentCellIds
      .filter((cellId) => assignmentsByCell.get(cellId)?.success === true).length;
    checkScorecardWilsonInterval(result.interval, resultSuccesses, expectedAssignmentCellIds.length,
      `${owner} ${result.claimId}`, issues);
    checkScorecardBound(result.identificationBounds, claim, result.estimate, `${owner} ${result.claimId}`, issues);
    const decisionRule = decisionRules.get(result.claimId);
    const expectedDecision = decisionRule ? executeScorecardDecisionRule(decisionRule, claim, result) : null;
    if (result.status === "supported" && expectedDecision !== "pass") {
      issues.push(`${owner}: supported claim ${result.claimId} does not meet threshold ${claim.threshold} with estimate ${result.estimate}`);
    }
    if (expectedDecision !== null && result.decisionRuleResult !== expectedDecision) {
      issues.push(`${owner}: claim ${result.claimId} decisionRuleResult must be ${expectedDecision}`);
    }
    if (claim.direction === "positive" && claim.analysisUnit === "scheduled_cell"
      && result.identificationBounds?.method === "complete-case" && expectedEligibleCellIds.length > 0) {
      const unresolved = expectedEligibleCellIds.filter((id) => cellsById.get(id)?.state === "unresolved").length;
      const successes = expectedEligibleCellIds.filter((id) => cellsById.get(id)?.state !== "unresolved"
        && assignmentsByCell.get(id)?.success === true).length;
      const expectedLower = successes / expectedEligibleCellIds.length;
      const expectedUpper = (successes + unresolved) / expectedEligibleCellIds.length;
      if (!scorecardNumbersEqual(result.identificationBounds.lower, expectedLower)
        || !scorecardNumbersEqual(result.identificationBounds.upper, expectedUpper)) {
        issues.push(`${owner}: claim ${result.claimId} complete-case bounds must be [${expectedLower},${expectedUpper}]`);
      }
    }
    if (result.status === "supported" && Number.isFinite(claim.threshold)) {
      if (claim.direction === "harm" && result.identificationBounds?.upper > claim.threshold + scorecardNumericEpsilon) {
        issues.push(`${owner}: supported harm claim ${result.claimId} has an upper bound above threshold`);
      }
      if (claim.direction !== "harm" && result.identificationBounds?.lower < claim.threshold - scorecardNumericEpsilon) {
        issues.push(`${owner}: supported claim ${result.claimId} has a lower bound below threshold`);
      }
    }
  }

  for (const caseResult of caseResults) {
    for (const statistic of caseResult.statistics ?? []) {
      const claim = claimsById.get(statistic.claimId);
      if (!claim) {
        issues.push(`${owner}: statistic references unknown claim ${statistic.claimId}`);
        continue;
      }
      const relevantCells = (caseResult.cells ?? []).filter((cell) => (claim.comparatorArmIds ?? []).length === 0
        || claim.comparatorArmIds.includes(cell.armId));
      const validCells = relevantCells.filter((cell) => cell.trialResult
        && replayByCellId.get(cell.cellId)?.validity === "valid");
      const validSuccesses = validCells.filter((cell) => scorecardTrialSuccess(
        cell.trialResult,
        claim,
        replayByCellId.get(cell.cellId)
      )).length;
      if (statistic.scheduledN !== relevantCells.length) {
        issues.push(`${owner}: statistic ${statistic.claimId} scheduledN must be ${relevantCells.length}`);
      }
      if (statistic.validN !== validCells.length) {
        issues.push(`${owner}: statistic ${statistic.claimId} validN must be ${validCells.length}`);
      }
      if (statistic.validSuccesses !== validSuccesses) {
        issues.push(`${owner}: statistic ${statistic.claimId} validSuccesses must be ${validSuccesses}`);
      }
      const expectedValue = scorecardStatisticValue(statistic.estimand, validCells.length, validSuccesses, statistic.k);
      if (expectedValue === null) {
        if (statistic.status !== "insufficient_evidence" || statistic.value !== null) {
          issues.push(`${owner}: statistic ${statistic.claimId} must be insufficient_evidence with null value`);
        }
      } else if (statistic.status === "supported" && !scorecardNumbersEqual(statistic.value, expectedValue)) {
        issues.push(`${owner}: statistic ${statistic.claimId} value must be ${expectedValue}`);
      }
      checkScorecardInterval(statistic.interval, claim, statistic.value, `${owner} statistic ${statistic.claimId}`, issues);
      checkScorecardWilsonInterval(statistic.interval, validSuccesses, validCells.length,
        `${owner} statistic ${statistic.claimId}`, issues);
    }
  }

  const selectedTrials = allCells.filter((cell) => cell.trialResult).map((cell) => ({
    cell,
    trial: cell.trialResult,
    replay: replayByCellId.get(cell.cellId)
  }));
  const outcomeCounts = new Map();
  const outcomeDenominators = new Map();
  for (const { cell, replay } of selectedTrials) {
    const key = `${cell.armId}:${replay?.primaryOutcome ?? "infra_failure"}`;
    outcomeCounts.set(key, (outcomeCounts.get(key) ?? 0) + 1);
    outcomeDenominators.set(cell.armId, (outcomeDenominators.get(cell.armId) ?? 0) + 1);
  }
  const outcomeRows = document.metrics?.outcomes ?? [];
  reportExactIds([...outcomeCounts.keys()], outcomeRows.map((entry) => `${entry.armId}:${entry.category}`), `${owner} outcome metrics`, issues);
  for (const row of outcomeRows) {
    const key = `${row.armId}:${row.category}`;
    if (!armIdSet.has(row.armId)) issues.push(`${owner}: outcome metric references unknown arm ${row.armId}`);
    if (outcomeCounts.has(key) && row.count !== outcomeCounts.get(key)) {
      issues.push(`${owner}: outcome metric ${key} count must be ${outcomeCounts.get(key)}`);
    }
    if (outcomeDenominators.has(row.armId) && row.denominator !== outcomeDenominators.get(row.armId)) {
      issues.push(`${owner}: outcome metric ${key} denominator must be ${outcomeDenominators.get(row.armId)}`);
    }
  }

  const costByAttemptId = new Map();
  for (const attempt of attempts) {
    if (Number.isFinite(attempt.metrics?.costUsd) && attempt.metrics.costUsd >= 0) {
      costByAttemptId.set(attempt.attemptId, attempt.metrics.costUsd);
    }
  }
  const successfulAttemptIds = new Set(selectedTrials
    .filter(({ replay }) => replay?.validity === "valid" && replay.functional === true)
    .map(({ cell }) => cell.selectedAttemptId));
  const totalObservedCost = [...costByAttemptId.values()].reduce((sum, value) => sum + value, 0);
  const successfulObservedCost = [...successfulAttemptIds]
    .filter((attemptId) => costByAttemptId.has(attemptId))
    .reduce((sum, attemptId) => sum + costByAttemptId.get(attemptId), 0);
  const costEntries = document.metrics?.cost ?? {};
  const costDefinitions = [
    ["meanConditionalOnFunctionalSuccess", successfulObservedCost],
    ["totalAttemptCostPerFunctionalSuccess", totalObservedCost]
  ];
  for (const [costName, expectedNumerator] of costDefinitions) {
    const estimate = costEntries[costName];
    if (!estimate) continue;
    if (estimate.successCount !== successfulAttemptIds.size) {
      issues.push(`${owner}: ${costName}.successCount must be ${successfulAttemptIds.size}`);
    }
    if (estimate.physicalAttemptCount !== attempts.length) {
      issues.push(`${owner}: ${costName}.physicalAttemptCount must be ${attempts.length}`);
    }
    if (estimate.reportedCostCount !== costByAttemptId.size) {
      issues.push(`${owner}: ${costName}.reportedCostCount must be ${costByAttemptId.size}`);
    }
    if (estimate.requiredCostCount !== attempts.length) {
      issues.push(`${owner}: ${costName}.requiredCostCount must be ${attempts.length}`);
    }
    requireEvidenceIds(estimate.evidenceIds, availableEvidence, `${owner} ${costName}`, issues);
    if (Date.parse(estimate.priceTableTimestamp) > runStartedAt) {
      issues.push(`${owner}: ${costName}.priceTableTimestamp must not be after run start`);
    }
    if (!scorecardNumbersEqual(estimate.numeratorCostUsd, expectedNumerator)) {
      issues.push(`${owner}: ${costName}.numeratorCostUsd must be ${expectedNumerator}`);
    }
    const missingCost = costByAttemptId.size !== attempts.length;
    if (successfulAttemptIds.size === 0 || (missingCost && estimate.missingCostPolicy === "fail_closed")) {
      if (estimate.status !== "insufficient_evidence" || estimate.valueUsd !== null) {
        issues.push(`${owner}: ${costName} must be insufficient_evidence with null value`);
      }
      if (successfulAttemptIds.size === 0 && !(estimate.reasonIds ?? []).includes("zero_success_denominator")) {
        issues.push(`${owner}: ${costName} must report zero_success_denominator`);
      }
    } else if (!missingCost) {
      const expectedValue = expectedNumerator / successfulAttemptIds.size;
      if (estimate.status !== "supported" || !scorecardNumbersEqual(estimate.valueUsd, expectedValue)) {
        issues.push(`${owner}: ${costName}.valueUsd must be ${expectedValue}`);
      }
    } else if (estimate.missingCostPolicy === "pre_registered_bound" && !estimate.bound) {
      issues.push(`${owner}: ${costName} pre_registered_bound policy requires a bound`);
    }
    if (estimate.bound && estimate.bound.lower > estimate.bound.upper) {
      issues.push(`${owner}: ${costName} bound lower exceeds upper`);
    }
    if (estimate.status === "supported" && (estimate.reasonIds ?? []).length > 0) {
      issues.push(`${owner}: supported ${costName} must not carry failure reasons`);
    }
  }
  if (costEntries.meanConditionalOnFunctionalSuccess?.priceTable
    && costEntries.totalAttemptCostPerFunctionalSuccess?.priceTable
    && !sameComponent(costEntries.meanConditionalOnFunctionalSuccess.priceTable,
      costEntries.totalAttemptCostPerFunctionalSuccess.priceTable)) {
    issues.push(`${owner}: cost estimands use different price tables`);
  }
  if (costEntries.meanConditionalOnFunctionalSuccess && costEntries.totalAttemptCostPerFunctionalSuccess
    && (costEntries.meanConditionalOnFunctionalSuccess.currency !== costEntries.totalAttemptCostPerFunctionalSuccess.currency
      || costEntries.meanConditionalOnFunctionalSuccess.priceTableTimestamp
        !== costEntries.totalAttemptCostPerFunctionalSuccess.priceTableTimestamp)) {
    issues.push(`${owner}: cost estimands use different currency or price-table timestamp`);
  }
  if (blockedCellIds.size > 0 && document.metrics?.composite?.status === "valid") {
    issues.push(`${owner}: composite must be blocked when a selected trial has a material gate or decision-surface failure`);
  }

  const resolvedPreRun = await loadScorecardTypedContract(document.experiment?.scheduledSetCommitment,
    sourceAbsolute, "urn:agent-evals-standard:schema:pre-run-manifest:1",
    `${owner} scheduled pre-run`, issues);
  if (resolvedPreRun) {
      const { contract: preRun, absolute } = resolvedPreRun;
      if (preRun.schemaVersion === "agent-eval-pre-run-manifest-1") {
        if (!sameComponent(preRun.caseProfiles ?? [], caseProfiles)) {
          issues.push(`${owner}: caseProfiles differ from the sealed pre-run manifest`);
        }
        if (!sameComponent(preRun.arms ?? [], arms)) issues.push(`${owner}: arms differ from the sealed pre-run manifest`);
        if (!sameComponent(preRun.comparativeDesign, document.comparativeDesign)) {
          issues.push(`${owner}: comparativeDesign differs from the sealed pre-run manifest`);
        }
        if (preRun.assuranceLevel !== document.experiment?.assuranceLevel
          || preRun.runMode !== document.experiment?.runMode
          || preRun.claimEligibility !== document.experiment?.claimEligibility) {
          issues.push(`${owner}: experiment eligibility differs from the sealed pre-run manifest`);
        }
        if (preRun.suite?.id !== document.experiment?.suite?.id
          || preRun.suite?.version !== document.experiment?.suite?.version
          || preRun.suite?.selfDigest !== document.experiment?.suite?.digest) {
          issues.push(`${owner}: suite identity differs from the sealed pre-run manifest`);
        }
        if (!sameComponent(preRun.gateRegistry, document.gateRegistry)) issues.push(`${owner}: gateRegistry differs from the sealed pre-run manifest`);
        if (!sameComponent(preRun.governanceRegistry, document.governanceStatusRegistry)) {
          issues.push(`${owner}: governance registry differs from the sealed pre-run manifest`);
        }
        const sealedScheduledCells = preRun.scheduledCells ?? [];
        reportDuplicateIds(sealedScheduledCells.map((entry) => entry.cellId), `${owner} sealed scheduled cell IDs`, issues);
        reportDuplicateIds(sealedScheduledCells.map((entry) => `${entry.caseId}:${entry.armId}:${entry.repetition}`),
          `${owner} sealed scheduled case/arm/repetition tuples`, issues);
        const scheduledById = new Map(sealedScheduledCells.map((entry) => [entry.cellId, entry]));
        reportExactIds(sealedScheduledCells.map((entry) => entry.cellId), allCells.map((entry) => entry.cellId), `${owner} sealed scheduled cells`, issues);
        if (integrity.scheduledCells !== sealedScheduledCells.length) {
          issues.push(`${owner}: attemptIntegrity.scheduledCells differs from sealed schedule length ${sealedScheduledCells.length}`);
        }
        for (const cell of allCells) {
          const context = cellContextById.get(cell.cellId);
          const scheduled = scheduledById.get(cell.cellId);
          if (scheduled && (scheduled.caseId !== context?.caseId || scheduled.armId !== cell.armId
            || scheduled.repetition !== cell.repetition)) {
            issues.push(`${owner}: cell ${cell.cellId} differs from its sealed schedule`);
          }
        }
        const preRunDigest = sha256Canonical(Object.fromEntries(Object.entries(preRun).filter(([key]) => !["digest", "signature"].includes(key))));
        if (integrity.scheduledSetCommitment?.id !== preRun.id
          || (integrity.scheduledSetCommitment?.digest !== preRun.digest
            && integrity.scheduledSetCommitment?.digest !== preRunDigest)) {
          issues.push(`${owner}: scheduledSetCommitment does not bind the sealed pre-run schedule`);
        }
        if (document.experiment?.manifestDigest !== preRun.digest && document.experiment?.manifestDigest !== preRunDigest) {
          issues.push(`${owner}: manifestDigest does not bind the sealed pre-run manifest`);
        }
        if (document.provenance?.preRunManifest?.id !== preRun.id
          || (document.provenance?.preRunManifest?.digest !== preRun.digest
            && document.provenance?.preRunManifest?.digest !== preRunDigest)) {
          issues.push(`${owner}: provenance.preRunManifest does not bind the sealed pre-run manifest`);
        }
        if (!sameComponent(preRun.statisticalPlan, document.provenance?.statisticalPlan)) {
          issues.push(`${owner}: statisticalPlan differs from scorecard provenance`);
        }
        for (const claim of claims) {
          if (!sameComponent(claim.statisticalPlan, preRun.statisticalPlan)) {
            issues.push(`${owner}: claim ${claim.id} uses a different statistical plan`);
          }
        }
        const resolvedRetryPolicy = await loadScorecardTypedContract(preRun.retryPolicy, absolute,
          "urn:agent-evals-standard:schema:scorecard:1#/$defs/retryPolicyContract",
          `${owner} retryPolicy`, issues);
        if (resolvedRetryPolicy) {
          const retryPolicy = resolvedRetryPolicy.contract;
          for (const cell of allCells) {
            const lineage = cell.lineage ?? [];
            if (lineage.length > retryPolicy.maxAttemptsPerCell) {
              issues.push(`${owner}: cell ${cell.cellId} exceeds retry-policy maximum ${retryPolicy.maxAttemptsPerCell}`);
            }
            for (const attemptId of lineage.slice(1)) {
              const attempt = attemptsById.get(attemptId);
              const predecessor = attemptsById.get(attempt?.parentAttemptId);
              if (predecessor && !retryPolicy.retryableMeasurementValidity.includes(predecessor.measurementValidity)) {
                issues.push(`${owner}: retry ${attemptId} follows non-retryable ${predecessor.measurementValidity} attempt`);
              }
            }
          }
        }
        try {
          const planAbsolute = resolveRepositoryPath(path.dirname(absolute), preRun.statisticalPlan.uri);
          const resolvedPlan = await digestForPointer(planAbsolute);
          const plan = resolvedPlan.referenced;
          if (preRun.statisticalPlan.digest !== resolvedPlan.digest) {
            issues.push(`${owner}: sealed statistical-plan digest must be ${resolvedPlan.digest}`);
          }
          if (plan) {
            const plannedClaimIds = [...(plan.primaryClaims ?? []), ...(plan.exploratoryClaims ?? [])];
            const claimContracts = plan.claimContracts ?? [];
            reportExactIds(plannedClaimIds, claims.map((entry) => entry.id), `${owner} statistical-plan claims`, issues);
            reportExactIds(plannedClaimIds, claimContracts.map((entry) => entry.claimId),
              `${owner} sealed claim contracts`, issues);
            const claimContractsById = new Map(claimContracts.map((entry) => [entry.claimId, entry]));
            for (const contract of claimContracts) {
              const expectedClassification = (plan.primaryClaims ?? []).includes(contract.claimId) ? "primary" : "exploratory";
              if (contract.classification !== expectedClassification) {
                issues.push(`${owner}: claim ${contract.claimId} classification must be ${expectedClassification}`);
              }
            }
            for (const claim of claims) {
              const contract = claimContractsById.get(claim.id);
              if (!contract) continue;
              const exactFields = ["type", "estimand", "direction", "successDefinition", "analysisUnit", "threshold", "confidenceLevel"];
              for (const field of exactFields) {
                if (!sameComponent(claim[field], contract[field])) {
                  issues.push(`${owner}: claim ${claim.id} ${field} differs from sealed claim contract`);
                }
              }
              if (!sameStringSet(claim.slice ?? [], contract.caseIds ?? [])) {
                issues.push(`${owner}: claim ${claim.id} case scope differs from sealed claim contract`);
              }
              const expectedArmScope = (claim.comparatorArmIds ?? []).length > 0 ? claim.comparatorArmIds : armIds;
              if (!sameStringSet(expectedArmScope, contract.armIds ?? [])) {
                issues.push(`${owner}: claim ${claim.id} arm scope differs from sealed claim contract`);
              }
              if (!sameComponentIdentity(claim.decisionRule, contract.decisionRule)) {
                issues.push(`${owner}: claim ${claim.id} decisionRule differs from sealed claim contract`);
              }
              if (claim.targetPopulation !== plan.targetPopulation || claim.analysisUnit !== plan.samplingUnit) {
                issues.push(`${owner}: claim ${claim.id} population or sampling unit differs from statistical plan`);
              }
              const result = results.find((entry) => entry.claimId === claim.id);
              const validEligibleTrials = (result?.eligibleCellIds ?? [])
                .filter((cellId) => cellsById.get(cellId)?.trialResult?.validity === "valid").length;
              if (result?.status === "supported" && validEligibleTrials < contract.minimumValidTrials) {
                issues.push(`${owner}: supported claim ${claim.id} needs at least ${contract.minimumValidTrials} valid trials`);
              }
            }
            if (!scorecardNumbersEqual(plan.unresolvedCellPolicy?.maximumRate, integrity.unresolvedCellRateThreshold)) {
              issues.push(`${owner}: unresolvedCellRateThreshold differs from the sealed statistical plan`);
            }
            const usesWilson = results.some((entry) => entry.interval?.method === "wilson")
              || caseResults.some((entry) => (entry.statistics ?? []).some((statistic) => statistic.interval?.method === "wilson"));
            if (usesWilson && !sameComponentIdentity(plan.intervalProcedure, scorecardWilsonProcedure)) {
              issues.push(`${owner}: wilson intervals are not bound to the registered 0.1.0 procedure`);
            }
            const estimators = new Map((plan.estimators ?? []).map((entry) => [entry.id, entry]));
            for (const caseResult of caseResults) {
              for (const statistic of caseResult.statistics ?? []) {
                if (!sameComponentIdentity(statistic.estimator, estimators.get(statistic.estimator?.id))) {
                  issues.push(`${owner}: statistic ${statistic.claimId} uses an unsealed estimator`);
                }
              }
            }
          }
        } catch (error) {
          issues.push(`${owner}: cannot resolve sealed statistical plan: ${error.message}`);
        }
      }
  }
}

function materialSubjectKey(subject) {
  return `${subject.subjectType}:${subject.subjectId}`;
}

async function checkCaseClassification(document, _sourceAbsolute, issues, fixture) {
  const owner = "caseClassification";
  const caseFamilies = document.capabilityFamilyIds ?? [];
  const classifications = document.capabilityClassification ?? [];
  reportExactIds(caseFamilies, classifications.map((entry) => entry.capabilityFamilyId), `${owner} family classification`, issues);

  const expectedSubjects = [
    `outcome_profile:${document.outcomeProfile?.id}`,
    ...Object.keys(document.claimRegistry ?? {}).map((id) => `claim:${id}`)
  ];
  const dependencies = document.applicability?.materialSubjectDependencies ?? [];
  reportExactIds(expectedSubjects, dependencies.map(materialSubjectKey), `${owner} material subject dependencies`, issues);
  const expectedFamiliesBySubject = new Map(expectedSubjects.map((key) => [key, new Set()]));

  for (const classification of classifications) {
    reportDuplicateIds(classification.evaluatedConstructIds ?? [], `${owner} ${classification.capabilityFamilyId} constructs`, issues);
    reportDuplicateIds((classification.materialSubjects ?? []).map(materialSubjectKey), `${owner} ${classification.capabilityFamilyId} subjects`, issues);
    for (const subject of classification.materialSubjects ?? []) {
      const key = materialSubjectKey(subject);
      if (!expectedFamiliesBySubject.has(key)) {
        issues.push(`${owner}: ${classification.capabilityFamilyId} references unknown material subject ${key}`);
      } else {
        expectedFamiliesBySubject.get(key).add(classification.capabilityFamilyId);
      }
    }
  }

  for (const dependency of dependencies) {
    const key = materialSubjectKey(dependency);
    const labels = dependency.capabilityFamilyIds ?? [];
    for (const label of labels) {
      if (!caseFamilies.includes(label)) issues.push(`${owner}: subject ${key} uses family ${label} outside the case`);
    }
    const expectedLabels = [...(expectedFamiliesBySubject.get(key) ?? new Set())];
    if (!sameStringSet(labels, expectedLabels)) {
      issues.push(`${owner}: subject ${key} capability labels must equal its material classifications`);
    }
  }

  for (const [key, labels] of expectedFamiliesBySubject) {
    if (labels.size === 0) issues.push(`${owner}: material subject ${key} has no classified capability family`);
  }

  if (fixture?.relatedPath) {
    try {
      const absolute = resolveRepositoryPath(fixtureDirectory, fixture.relatedPath);
      const profile = await readJsonStrict(absolute);
      if (profile.schemaVersion === "agent-eval-evaluation-profile-1") {
        if (document.evaluationProfile?.id !== profile.id || document.evaluationProfile?.version !== profile.version) {
          issues.push(`${owner}: case evaluation-profile identity differs from the related profile`);
        }
        if (document.evaluationProfile?.digest !== profile.digest
          || document.evaluationProfile?.effectiveProfileDigest !== profile.effectiveProfileDigest) {
          issues.push(`${owner}: case evaluation-profile digests differ from the related profile`);
        }
        for (const family of caseFamilies) {
          if (!(profile.capabilityFamilies ?? []).includes(family)) {
            issues.push(`${owner}: family ${family} is outside the effective evaluation profile`);
          }
        }
        if (!(profile.allowedOutcomeProfiles ?? []).some((binding) => binding.id === document.outcomeProfile?.id
          && binding.version === document.outcomeProfile?.version && binding.digest === document.outcomeProfile?.digest)) {
          issues.push(`${owner}: outcome profile is not allowed by the evaluation profile`);
        }
      }
    } catch (error) {
      issues.push(`${owner}: cannot resolve related evaluation profile: ${error.message}`);
    }
  }
}

async function checkCaseProfileBindings(document, sourceAbsolute, issues, fixture) {
  const validity = await loadCaseValidityArgument(fixture, issues, "caseProfileBindings");
  if (!validity) return;
  const profile = validity.effectiveEvaluationProfile ?? {};
  if (document.evaluationProfile?.id !== profile.id || document.evaluationProfile?.version !== profile.version
    || document.evaluationProfile?.digest !== profile.subjectDigest
    || document.evaluationProfile?.effectiveProfileDigest !== profile.effectiveProfileDigest) {
    issues.push("CASE-001 case evaluation profile differs from the effective evaluation profile");
  }
  if (!(profile.interactionModes ?? []).includes(document.interactionModeId)) {
    issues.push(`CASE-001 interactionModeId ${document.interactionModeId} is outside the effective evaluation profile`);
  }
  if (document.interactionModeId !== validity.fullCaseExpectation?.interactionModeId) {
    issues.push("CASE-001 interactionModeId differs from the signed validity argument");
  }
  if (!sameWorkArtifactRegistryBinding(document.workArtifactRegistry, profile.workArtifactRegistry)) {
    issues.push("CASE-001 workArtifactRegistry differs from the effective evaluation profile");
  }

  const selectedOutcome = validity.selectedOutcomeProfile ?? {};
  if (document.outcomeProfile?.id !== selectedOutcome.id || document.outcomeProfile?.version !== selectedOutcome.version
    || document.outcomeProfile?.digest !== selectedOutcome.subjectDigest) {
    issues.push("CASE-001 selected outcome profile differs from the signed validity argument");
  }
  if (!sameWorkArtifactRegistryBinding(document.workArtifactRegistry, selectedOutcome.workArtifactRegistry)) {
    issues.push("CASE-001 workArtifactRegistry differs from the selected outcome profile");
  }
  await resolveWorkArtifactRegistry(document.workArtifactRegistry, path.dirname(sourceAbsolute), "CASE-001", issues);
}

async function checkCaseWorkArtifactBindings(document, sourceAbsolute, issues, fixture) {
  const validity = await loadCaseValidityArgument(fixture, issues, "caseWorkArtifactBindings");
  if (!validity) return;
  const registry = await resolveWorkArtifactRegistry(document.workArtifactRegistry, path.dirname(sourceAbsolute),
    "CASE-001", issues);
  if (!registry) return;

  const caseTypes = document.workArtifactTypes ?? [];
  const outcomeTypes = validity.selectedOutcomeProfile?.workArtifactTypes ?? [];
  if (!sameStringSet(caseTypes, validity.fullCaseExpectation?.workArtifactTypes ?? [])) {
    issues.push("CASE-001 workArtifactTypes differ from the signed validity argument");
  }
  for (const type of caseTypes) {
    if (!registry.byType.has(type)) issues.push(`CASE-001 work artifact ${type} is outside the authenticated registry`);
    if (!outcomeTypes.includes(type)) issues.push(`CASE-001 work artifact ${type} is not supported by the selected outcome profile`);
  }

  const classifiedTypes = [];
  for (const classification of document.capabilityClassification ?? []) {
    for (const type of classification.materialWorkArtifactTypes ?? []) {
      classifiedTypes.push(type);
      const mappedFamily = registry.byType.get(type)?.capabilityFamilyId;
      if (mappedFamily !== classification.capabilityFamilyId) {
        issues.push(`CASE-001 work artifact ${type} maps to ${mappedFamily ?? "no registered family"}, not ${classification.capabilityFamilyId}`);
      }
    }
  }
  reportExactIds(caseTypes, classifiedTypes, "CASE-001 classified material work artifacts", issues);

  for (const family of document.capabilityFamilyIds ?? []) {
    const coversFamily = caseTypes.some((type) => registry.byType.get(type)?.capabilityFamilyId === family);
    if (!coversFamily) issues.push(`CASE-001 capability ${family} has no material mapped work artifact`);
  }
}

async function checkWorkspaceManifestBinding(document, sourceAbsolute, issues) {
  const pointer = document.repository?.workspaceManifest;
  if (!pointer) {
    issues.push("CASE-001 workspace manifest pointer is required");
    return;
  }
  try {
    const absolute = resolveRepositoryPath(path.dirname(sourceAbsolute), pointer.uri);
    const bytes = await readFile(absolute);
    const actualDigest = sha256Bytes(bytes);
    if (pointer.digest !== actualDigest) {
      issues.push("CASE-001 workspace manifest byte digest does not match its content-addressed pointer");
    }
    const workspaceManifest = parseIJson(bytes.toString("utf8"), absolute);
    if (pointer.id !== workspaceManifest.id || pointer.version !== workspaceManifest.version) {
      issues.push("CASE-001 workspace manifest identity or version differs from its content-addressed pointer");
    }
    const validate = ajv.getSchema("urn:agent-evals-standard:schema:workspace-manifest:1");
    if (!validate(workspaceManifest)) {
      issues.push(`CASE-001 workspace manifest schema invalid: ${ajv.errorsText(validate.errors)}`);
      return;
    }
    issues.push(...verifyWorkspaceManifest(workspaceManifest).map((problem) => `CASE-001 workspace manifest ${problem}`));
  } catch (error) {
    issues.push(`CASE-001 cannot resolve workspace manifest: ${error.message}`);
  }
}

async function loadCaseValidityArgument(fixture, issues, owner) {
  if (!fixture?.relatedPath) {
    issues.push(`${owner}: relatedPath to the classification validity argument is required`);
    return null;
  }
  try {
    const absolute = resolveRepositoryPath(fixtureDirectory, fixture.relatedPath);
    const validity = await readJsonStrict(absolute);
    await verifyCaseValidityArgument(validity, absolute, issues, {
      root,
      fixtureKey,
      validateValidity: ajv.getSchema("urn:agent-evals-standard:schema:case-classification-validity-argument:1"),
      validateProfile: ajv.getSchema("urn:agent-evals-standard:schema:evaluation-profile:1"),
      validateOutcome: ajv.getSchema("urn:agent-evals-standard:schema:outcome-profile:1"),
      validateWorkArtifactRegistry: ajv.getSchema("urn:agent-evals-standard:schema:work-artifact-registry:1")
    });
    return validity;
  } catch (error) {
    issues.push(`${owner}: cannot resolve validity argument: ${error.message}`);
    return null;
  }
}

function classificationBoundaryProblems(classification, validity, issues) {
  const registry = new Map((validity.constructRegistry ?? []).map((entry) => [entry.id, entry]));
  const verifier = validity.verifier ?? {};
  const declared = classification.capabilityFamilyId;
  let materialJustification = false;
  for (const constructId of classification.evaluatedConstructIds ?? []) {
    const construct = registry.get(constructId);
    if (!construct) {
      issues.push(`CASE-001 unknown evaluated construct ${constructId}`);
      continue;
    }
    if (construct.materiality === "ancillary") {
      if ((classification.evaluatedConstructIds ?? []).length === 1) {
        issues.push(`CASE-001 ancillary construct ${constructId} cannot justify capability ${declared}`);
      }
      continue;
    }
    if (!(construct.capabilityFamilyIds ?? []).includes(declared)) {
      issues.push(`CASE-001 capability classification mismatch for ${constructId}: declared [${declared}], expected [${(construct.capabilityFamilyIds ?? []).join(", ")}]`);
    } else {
      materialJustification = true;
    }
    for (const kind of classification.materialWorkArtifactTypes ?? []) {
      if (!(construct.workArtifactTypes ?? []).includes(kind)) {
        issues.push(`CASE-001 work product ${kind} is not registered for ${constructId}`);
      }
    }
  }
  if (!materialJustification && !(classification.evaluatedConstructIds ?? []).some((id) => registry.get(id)?.materiality === "ancillary")) {
    issues.push(`CASE-001 capability ${declared} has no material construct`);
  }
  const contract = classification.classificationVerifier ?? {};
  if (contract.id !== verifier.id || contract.version !== verifier.version || contract.digest !== verifier.digest
    || contract.verifierDigest !== verifier.digest || contract.schemaId !== validity.schemaVersion) {
    issues.push(`CASE-001 classification verifier does not match ${validity.id}`);
  }
}

async function checkCaseCapabilityClassificationBoundary(document, _sourceAbsolute, issues, fixture) {
  const validity = await loadCaseValidityArgument(fixture, issues, "caseCapabilityClassificationBoundary");
  if (validity) classificationBoundaryProblems(document, validity, issues);
}

async function checkCaseCapabilityClassification(document, sourceAbsolute, issues, fixture) {
  await checkCaseClassification(document, sourceAbsolute, issues, fixture);
  const validity = await loadCaseValidityArgument(fixture, issues, "caseCapabilityClassification");
  if (!validity) return;
  if (validity.caseIdentity?.id !== document.id || validity.caseIdentity?.version !== document.caseVersion) {
    issues.push("CASE-001 full case identity differs from the authenticated validity argument");
  }
  const expected = validity.fullCaseExpectation ?? {};
  if (!sameStringSet(document.capabilityFamilyIds ?? [], expected.capabilityFamilyIds ?? [])) {
    issues.push("CASE-001 full case capabilityFamilyIds differ from the signed validity argument");
  }
  const profile = validity.effectiveEvaluationProfile ?? {};
  if (document.evaluationProfile?.id !== profile.id || document.evaluationProfile?.version !== profile.version
    || document.evaluationProfile?.digest !== profile.subjectDigest
    || document.evaluationProfile?.effectiveProfileDigest !== profile.effectiveProfileDigest) {
    issues.push("CASE-001 full case evaluation profile differs from the signed validity argument");
  }
  for (const family of document.capabilityFamilyIds ?? []) {
    if (!(profile.capabilityFamilies ?? []).includes(family)) {
      issues.push(`CASE-001 full case family ${family} is outside the effective profile`);
    }
  }
  for (const classification of document.capabilityClassification ?? []) {
    classificationBoundaryProblems(classification, validity, issues);
  }
  const expectedSubjects = expected.subjectCapabilityFamilyIds ?? {};
  for (const dependency of document.applicability?.materialSubjectDependencies ?? []) {
    const key = materialSubjectKey(dependency);
    if (expectedSubjects[key] && !sameStringSet(dependency.capabilityFamilyIds ?? [], expectedSubjects[key])) {
      issues.push(`CASE-001 material subject ${key} differs from the signed validity argument`);
    }
  }
}

function pairwiseSharedValues(valueSets) {
  const shared = new Set();
  for (let left = 0; left < valueSets.length; left += 1) {
    for (let right = left + 1; right < valueSets.length; right += 1) {
      for (const value of valueSets[left]) {
        if (valueSets[right].has(value)) shared.add(value);
      }
    }
  }
  return [...shared];
}

function repeatedExactStatements(values) {
  return [...occurrenceCounts(values)].filter(([, count]) => count > 1).map(([value]) => value);
}

function checkDuplicateSourceArtifacts(owner, sources, issues) {
  const identities = new Map();
  const immutableLocators = new Map();
  const archiveDigests = new Map();
  const add = (map, key, sourceId) => {
    if (key === null || key === undefined) return;
    map.set(key, [...(map.get(key) ?? []), sourceId]);
  };
  for (const source of sources) {
    const locator = source.archive?.immutableLocator ?? source.mutableLocator;
    if (locator) add(identities, `${locator}\n${canonicalize(source.versionIdentity)}`, source.id);
    if (source.archive?.immutableLocator) add(immutableLocators, source.archive.immutableLocator, source.id);
    if (source.archive?.status === "verified" && source.archive?.digest) {
      add(archiveDigests, source.archive.digest, source.id);
    }
  }
  for (const [identity, ids] of identities) {
    if (ids.length > 1) {
      issues.push(`sourceEvidenceGraph: ${owner} duplicate locator/version identity is declared by ${ids.join(", ")}: ${identity.replace("\n", " | ")}`);
    }
  }
  for (const [locator, ids] of immutableLocators) {
    if (ids.length > 1) {
      issues.push(`sourceEvidenceGraph: ${owner} duplicate immutable locator ${locator} is declared by ${ids.join(", ")}`);
    }
  }
  for (const [digest, ids] of archiveDigests) {
    if (ids.length > 1) {
      issues.push(`sourceEvidenceGraph: ${owner} duplicate archived artifact digest ${digest} is declared by ${ids.join(", ")}`);
    }
  }
}

function checkEmpiricalObservationSupport(
  owner,
  sourceIds,
  observationIds,
  sourcesById,
  observationsById,
  issues,
  minimum
) {
  const citedSourceIdSet = new Set(sourceIds);
  if (new Set(observationIds).size < minimum) {
    issues.push(`sourceEvidenceGraph: ${owner} requires at least ${minimum} primary empirical observation${minimum === 1 ? "" : "s"}`);
  }
  const selected = [];
  for (const observationId of observationIds) {
    const observation = observationsById.get(observationId);
    if (!observation) {
      issues.push(`sourceEvidenceGraph: ${owner} observation ${observationId} is undeclared`);
      continue;
    }
    selected.push(observation);
    if (observation.role !== "primary_empirical_observation") {
      issues.push(`sourceEvidenceGraph: ${owner} observation ${observationId} has incompatible role ${observation.role}`);
    }
    if (!citedSourceIdSet.has(observation.sourceId)) {
      issues.push(`sourceEvidenceGraph: ${owner} observation ${observationId} belongs to source ${observation.sourceId} outside its cited source set`);
    }
    const source = sourcesById.get(observation.sourceId);
    if (!source) {
      issues.push(`sourceEvidenceGraph: ${owner} observation ${observationId} references undeclared source ${observation.sourceId}`);
    } else {
      if (source.empiricalRole !== "primary_empirical_source") {
        issues.push(`sourceEvidenceGraph: ${owner} observation ${observationId} source ${source.id} is not classified as a primary empirical source`);
      }
      if (!primaryEmpiricalEvidenceClasses.has(source.evidenceClass)) {
        issues.push(`sourceEvidenceGraph: ${owner} observation ${observationId} source ${source.id} has incompatible evidence class ${source.evidenceClass}`);
      }
    }
  }
  const selectedSourceIds = [...new Set(selected.map((observation) => observation.sourceId))];
  if (!sameStringSet(selectedSourceIds, sourceIds)) {
    issues.push(`sourceEvidenceGraph: ${owner} cited source IDs differ from the exact source set of its empirical observations`);
  }
  return selected;
}

function checkTriangulation(
  owner,
  sourceIds,
  declaredObservationIds,
  assessment,
  sourcesById,
  observationsById,
  issues
) {
  if (!assessment || typeof assessment !== "object") {
    issues.push(`sourceEvidenceGraph: ${owner} is triangulated empirical evidence without an independence assessment`);
    return;
  }
  const observations = checkEmpiricalObservationSupport(
    owner, sourceIds, declaredObservationIds, sourcesById, observationsById, issues, 2
  );
  if (!sameStringSet(assessment.observationIds ?? [], declaredObservationIds)) {
    issues.push(`sourceEvidenceGraph: ${owner} observations differ from its independence assessment`);
  }

  const selectedSources = observations
    .map((observation) => sourcesById.get(observation.sourceId))
    .filter(Boolean);
  const selectedSourceIds = new Set(selectedSources.map((source) => source.id));
  if (selectedSourceIds.size < 2) {
    issues.push(`sourceEvidenceGraph: ${owner} has fewer than two independently produced primary empirical artifacts`);
  }

  for (const sourceId of new Set(sourceIds)) {
    const source = sourcesById.get(sourceId);
    if (!source) {
      issues.push(`sourceEvidenceGraph: ${owner} triangulated source ${sourceId} is undeclared`);
      continue;
    }
    if (source.archive?.status !== "verified" || !source.archive?.digest) {
      issues.push(`sourceEvidenceGraph: ${owner} triangulated source ${sourceId} lacks a verified archived source digest`);
    }
    const funding = source.fundingDisclosure;
    if (funding?.status !== "verified_from_archived_source" || !funding.evidence) {
      issues.push(`sourceEvidenceGraph: ${owner} triangulated source ${sourceId} lacks verified funding disclosure`);
    } else if (funding.evidence.archiveDigest !== source.archive?.digest) {
      issues.push(`sourceEvidenceGraph: ${owner} triangulated source ${sourceId} funding evidence is not bound to its archived source digest`);
    }
  }

  const producerSets = selectedSources.map((source) => new Set(source.producerIds ?? []));
  const derivedProducerIds = [...new Set(producerSets.flatMap((set) => [...set]))];
  if (!sameStringSet(assessment.producerIds ?? [], derivedProducerIds)) {
    issues.push(`sourceEvidenceGraph: ${owner} producer IDs differ from the cited observation sources`);
  }
  if (new Set(derivedProducerIds).size < 2) {
    issues.push(`sourceEvidenceGraph: ${owner} has fewer than two producer organizations`);
  }
  const sharedProducerIds = pairwiseSharedValues(producerSets);
  if (sharedProducerIds.length > 0) {
    issues.push(`sourceEvidenceGraph: ${owner} observations share producer IDs ${sharedProducerIds.join(", ")}`);
  }

  const derivedSharedAuthorNames = pairwiseSharedValues(
    selectedSources.map((source) => new Set(source.authorsOrOrganization ?? []))
  );
  if (!sameStringSet(assessment.sharedAuthorNames ?? [], derivedSharedAuthorNames)) {
    issues.push(`sourceEvidenceGraph: ${owner} shared author names differ from the cited observation sources`);
  }

  const derivedSharedLineageIds = pairwiseSharedValues(
    observations.map((observation) => new Set(observation.dataOrBenchmarkLineageIds ?? []))
  );
  if (!sameStringSet(assessment.sharedDataOrBenchmarkLineageIds ?? [], derivedSharedLineageIds)) {
    issues.push(`sourceEvidenceGraph: ${owner} shared data or benchmark lineage differs from the cited observations`);
  }
  if (derivedSharedLineageIds.length > 0) {
    issues.push(`sourceEvidenceGraph: ${owner} observations share data or benchmark lineage ${derivedSharedLineageIds.join(", ")}`);
  }

  const derivedSharedSponsorIds = pairwiseSharedValues(
    selectedSources.map((source) => new Set(source.fundingDisclosure?.sponsorIds ?? []))
  );
  if (!sameStringSet(assessment.sharedSponsorIds ?? [], derivedSharedSponsorIds)) {
    issues.push(`sourceEvidenceGraph: ${owner} shared sponsor IDs differ from the cited observation sources`);
  }
  if (derivedSharedSponsorIds.length > 0) {
    issues.push(`sourceEvidenceGraph: ${owner} observations share sponsor IDs ${derivedSharedSponsorIds.join(", ")}`);
  }

  const identicalPopulationStatements = repeatedExactStatements(observations.map((observation) => observation.population));
  if (!sameStringSet(assessment.identicalPopulationStatements ?? [], identicalPopulationStatements)) {
    issues.push(`sourceEvidenceGraph: ${owner} identical population statements differ from the cited observations`);
  }
  const identicalMethodStatements = repeatedExactStatements(observations.map((observation) => observation.method));
  if (!sameStringSet(assessment.identicalMethodStatements ?? [], identicalMethodStatements)) {
    issues.push(`sourceEvidenceGraph: ${owner} identical method statements differ from the cited observations`);
  }
  if (assessment.conclusion !== "sufficiently_independent_for_the_bounded_claim") {
    issues.push(`sourceEvidenceGraph: ${owner} does not establish bounded-claim independence`);
  }
}

async function checkSourceEvidenceTriangulation(document, _sourceAbsolute, issues) {
  const sources = document.sources ?? [];
  const observations = document.observations ?? [];
  const sourcesById = new Map(sources.map((source) => [source.id, source]));
  const observationsById = new Map(observations.map((observation) => [observation.id, observation]));
  for (const [id, count] of occurrenceCounts(sources.map((source) => source.id))) {
    if (count !== 1) issues.push(`sourceEvidenceGraph: triangulation fixture source ${id} occurs ${count} times`);
  }
  for (const [id, count] of occurrenceCounts(observations.map((observation) => observation.id))) {
    if (count !== 1) issues.push(`sourceEvidenceGraph: triangulation fixture observation ${id} occurs ${count} times`);
  }
  checkDuplicateSourceArtifacts("triangulation fixture", sources, issues);
  for (const observation of observations) {
    const source = sourcesById.get(observation.sourceId);
    if (!source) {
      issues.push(`sourceEvidenceGraph: triangulation fixture observation ${observation.id} references undeclared source ${observation.sourceId}`);
    } else if (source.empiricalRole !== "primary_empirical_source") {
      issues.push(`sourceEvidenceGraph: triangulation fixture observation ${observation.id} source ${source.id} is not classified as a primary empirical source`);
    }
  }
  const claim = document.claim ?? {};
  for (const sourceId of claim.sourceIds ?? []) {
    if (!sourcesById.has(sourceId)) {
      issues.push(`sourceEvidenceGraph: triangulation fixture claim references undeclared source ${sourceId}`);
    }
  }
  checkTriangulation(
    "triangulation fixture claim",
    claim.sourceIds ?? [],
    claim.observationIds ?? [],
    claim.independenceAssessment,
    sourcesById,
    observationsById,
    issues
  );
}

async function checkSourceEvidenceGraph(document, _sourceAbsolute, issues) {
  let registry;
  try {
    registry = await readJsonStrict(path.join(root, "standard", "requirement-registry.json"));
  } catch (error) {
    issues.push(`sourceEvidenceGraph: cannot load requirement registry: ${error.message}`);
    return;
  }

  if (registry.standardVersion !== document.standardVersion) {
    issues.push(`sourceEvidenceGraph: standardVersion differs from the requirement registry`);
  }

  const sources = document.sources ?? [];
  const sourceCounts = occurrenceCounts(sources.map((source) => source.id));
  const sourcesById = new Map(sources.map((source) => [source.id, source]));
  for (const [id, count] of sourceCounts) {
    if (count !== 1) issues.push(`sourceEvidenceGraph: source ${id} occurs ${count} times`);
  }
  checkDuplicateSourceArtifacts("source catalog", sources, issues);
  for (const source of sources) {
    if (source.archive?.status === "verified") {
      issues.push(`sourceEvidenceGraph: source ${source.id} claims verified archive status, which is unsupported in 0.1.0 without the deferred authenticated archive-verification contract and out-of-manifest independent signer`);
    }
    for (const contraryId of source.contraryEvidence ?? []) {
      if (!sourcesById.has(contraryId)) {
        issues.push(`sourceEvidenceGraph: source ${source.id} cites undeclared contrary evidence ${contraryId}`);
      }
    }
  }

  const observations = document.observations ?? [];
  const observationCounts = occurrenceCounts(observations.map((observation) => observation.id));
  const observationsById = new Map(observations.map((observation) => [observation.id, observation]));
  for (const [id, count] of observationCounts) {
    if (count !== 1) issues.push(`sourceEvidenceGraph: observation ${id} occurs ${count} times`);
  }
  for (const observation of observations) {
    const source = sourcesById.get(observation.sourceId);
    if (!source) {
      issues.push(`sourceEvidenceGraph: observation ${observation.id} references undeclared source ${observation.sourceId}`);
      continue;
    }
    if (observation.role !== "primary_empirical_observation") {
      issues.push(`sourceEvidenceGraph: observation ${observation.id} has incompatible role ${observation.role}`);
    }
    if (source.empiricalRole !== "primary_empirical_source") {
      issues.push(`sourceEvidenceGraph: observation ${observation.id} source ${source.id} is not classified as a primary empirical source`);
    }
    if (!primaryEmpiricalEvidenceClasses.has(source.evidenceClass)) {
      issues.push(`sourceEvidenceGraph: observation ${observation.id} source ${source.id} has incompatible evidence class ${source.evidenceClass}`);
    }
  }

  const requirements = registry.requirements ?? [];
  const requirementCounts = occurrenceCounts(requirements.map((requirement) => requirement.id));
  const mappings = document.mappings ?? [];
  const mappingCounts = occurrenceCounts(mappings.map((mapping) => mapping.requirementId));
  const mappingsById = new Map(mappings.map((mapping) => [mapping.requirementId, mapping]));
  for (const [id, count] of requirementCounts) {
    if (count !== 1) issues.push(`sourceEvidenceGraph: registry requirement ${id} occurs ${count} times`);
  }
  for (const id of requirementCounts.keys()) {
    if (mappingCounts.get(id) !== 1) {
      issues.push(`sourceEvidenceGraph: requirement ${id} occurs ${mappingCounts.get(id) ?? 0} times in evidence mappings`);
    }
  }
  for (const id of mappingCounts.keys()) {
    if (!requirementCounts.has(id)) issues.push(`sourceEvidenceGraph: unknown mapped requirement ${id}`);
  }

  for (const requirement of requirements) {
    if (mappingCounts.get(requirement.id) !== 1) continue;
    const mapping = mappingsById.get(requirement.id);
    const basis = requirement.evidenceBasis;
    if (mapping.kind !== basis?.kind) {
      issues.push(`sourceEvidenceGraph: ${requirement.id} mapping kind ${mapping.kind} differs from evidence basis ${basis?.kind}`);
      continue;
    }
    if (basis.kind === "source_evidence") {
      if (!sameStringSet(mapping.sourceIds ?? [], basis.sourceIds ?? [])) {
        issues.push(`sourceEvidenceGraph: ${requirement.id} sourceIds differ from its evidence basis`);
      }
      for (const id of basis.sourceIds ?? []) {
        if (!sourcesById.has(id)) issues.push(`sourceEvidenceGraph: ${requirement.id} evidence basis references undeclared source ${id}`);
      }
    } else {
      if (mapping.rationale !== basis.threatRationale) {
        issues.push(`sourceEvidenceGraph: ${requirement.id} rationale differs from its design-invariant evidence basis`);
      }
      for (const id of mapping.rationaleEvidence?.sourceIds ?? []) {
        if (!sourcesById.has(id)) {
          issues.push(`sourceEvidenceGraph: ${requirement.id} rationale evidence references undeclared source ${id}`);
        }
      }
    }
  }

  for (const mapping of mappings) {
    if (mapping.kind !== "source_evidence") continue;
    const sourceIds = mapping.sourceIds ?? [];
    const observationIds = mapping.observationIds ?? [];
    for (const id of sourceIds) {
      if (!sourcesById.has(id)) issues.push(`sourceEvidenceGraph: ${mapping.requirementId} references undeclared source ${id}`);
    }
    if (mapping.support === "empirical_observation") {
      checkEmpiricalObservationSupport(
        mapping.requirementId, sourceIds, observationIds, sourcesById, observationsById, issues, 1
      );
    } else if (mapping.support === "triangulated_empirical") {
      checkTriangulation(
        mapping.requirementId, sourceIds, observationIds, mapping.independenceAssessment,
        sourcesById, observationsById, issues
      );
    } else if (observationIds.length !== 0) {
      issues.push(`sourceEvidenceGraph: ${mapping.requirementId} declares empirical observations with ${mapping.support} support`);
    }
    if (mapping.support !== "triangulated_empirical" && mapping.independenceAssessment !== undefined) {
      issues.push(`sourceEvidenceGraph: ${mapping.requirementId} has an independence assessment without triangulated_empirical support`);
    }
  }

  const capabilities = document.capabilityCoverage ?? [];
  const capabilityCounts = occurrenceCounts(capabilities.map((capability) => capability.capabilityId));
  for (const id of closedCapabilityIds) {
    if (capabilityCounts.get(id) !== 1) {
      issues.push(`sourceEvidenceGraph: capability ${id} occurs ${capabilityCounts.get(id) ?? 0} times`);
    }
  }
  for (const id of capabilityCounts.keys()) {
    if (!closedCapabilityIds.has(id)) issues.push(`sourceEvidenceGraph: unknown capability ${id}`);
  }
  for (const capability of capabilities) {
    const owner = `capability ${capability.capabilityId}`;
    const sourceIds = capability.sourceIds ?? [];
    const observationIds = capability.observationIds ?? [];
    for (const id of sourceIds) {
      if (!sourcesById.has(id)) issues.push(`sourceEvidenceGraph: ${owner} references undeclared source ${id}`);
    }
    if (capability.support === "empirical_observation") {
      checkEmpiricalObservationSupport(
        owner, sourceIds, observationIds, sourcesById, observationsById, issues, 1
      );
    } else if (capability.support === "triangulated_empirical") {
      checkTriangulation(
        owner, sourceIds, observationIds, capability.independenceAssessment,
        sourcesById, observationsById, issues
      );
    } else if (observationIds.length !== 0) {
      issues.push(`sourceEvidenceGraph: ${owner} declares empirical observations with ${capability.support} support`);
    }
    if (capability.support !== "triangulated_empirical" && capability.independenceAssessment !== undefined) {
      issues.push(`sourceEvidenceGraph: ${owner} has an independence assessment without triangulated_empirical support`);
    }
    const targetValidation = capability.targetPopulationValidation ?? {};
    const targetBasisIds = targetValidation.basisObservationIds ?? [];
    const populationRelations = targetValidation.observationPopulationRelations ?? [];
    reportExactIds(
      targetBasisIds,
      populationRelations.map((relation) => relation.observationId),
      `sourceEvidenceGraph ${owner} observation-population relations`,
      issues
    );
    for (const id of targetBasisIds) {
      if (!observationsById.has(id)) {
        issues.push(`sourceEvidenceGraph: ${owner} target-population validation references undeclared observation ${id}`);
      }
      if (!observationIds.includes(id)) {
        issues.push(`sourceEvidenceGraph: ${owner} target-population validation observation ${id} is outside the capability observation set`);
      }
    }
    for (const relation of populationRelations) {
      if (!targetBasisIds.includes(relation.observationId)) {
        issues.push(`sourceEvidenceGraph: ${owner} population relation references observation ${relation.observationId} outside its target-validation basis`);
      }
      if (relation.relationToTarget === "transport_requires_independent_validation"
        && (relation.transferAssumptions ?? []).length === 0) {
        issues.push(`sourceEvidenceGraph: ${owner} transported observation ${relation.observationId} has no explicit transfer assumptions`);
      }
    }
    if (targetValidation.status === "single_producer_indication" && targetBasisIds.length < 1) {
      issues.push(`sourceEvidenceGraph: ${owner} single-producer target indication has no basis observation`);
    }
    if (targetValidation.status === "independently_validated") {
      issues.push(`sourceEvidenceGraph: ${owner} independently_validated is unsupported in 0.1.0 until a detached target-validation assessment is bound to the exact manifest, capability, target population, observation set, and population relations and authenticated by an independent release authority rooted outside the claimant manifest`);
    }
  }

  const blockers = document.evidenceBlockers ?? {};
  const expectedUnverifiedSources = sources.map((source) => source.id);
  const expectedRequirementGaps = mappings
    .filter((mapping) => mapping.kind === "source_evidence" && mapping.support === "evidence_gap")
    .map((mapping) => mapping.requirementId);
  const expectedCapabilityGaps = capabilities.map((capability) => capability.capabilityId);
  reportExactIds(expectedUnverifiedSources, blockers.unverifiedSourceIds ?? [],
    "sourceEvidenceGraph evidence blockers unverified sources", issues);
  reportExactIds(expectedRequirementGaps, blockers.requirementEvidenceGapIds ?? [],
    "sourceEvidenceGraph evidence blockers requirement gaps", issues);
  reportExactIds(expectedCapabilityGaps, blockers.capabilityTargetValidationGapIds ?? [],
    "sourceEvidenceGraph evidence blockers capability target-validation gaps", issues);
  const hasBlocker = expectedUnverifiedSources.length > 0
    || expectedRequirementGaps.length > 0 || expectedCapabilityGaps.length > 0;
  if (document.evidenceReadiness === "ready" && hasBlocker) {
    issues.push("sourceEvidenceGraph: evidenceReadiness ready is unsupported in 0.1.0 and has unresolved blockers");
  }
  if (document.evidenceReadiness === "blocked" && !hasBlocker) {
    issues.push("sourceEvidenceGraph: evidenceReadiness blocked has no unresolved blocker");
  }
}

async function loadBoundJson(binding, label, sourceAbsolute, schemaId, issues) {
  let absolute;
  let resolved;
  try {
    absolute = resolveRepositoryPath(path.dirname(sourceAbsolute), binding.uri);
    resolved = await digestForPointer(absolute);
  } catch (error) {
    issues.push(`outcomeGraph: ${label} cannot be resolved: ${error.message}`);
    return null;
  }
  if (binding.digest !== resolved.digest) {
    issues.push(`outcomeGraph: ${label} digest must be ${resolved.digest}`);
  }
  if (resolved.referenced?.id !== binding.id) {
    issues.push(`outcomeGraph: ${label} id ${binding.id} does not match linked id ${resolved.referenced?.id}`);
  }
  if (resolved.referenced?.version !== binding.version) {
    issues.push(`outcomeGraph: ${label} version ${binding.version} does not match linked version ${resolved.referenced?.version}`);
  }
  const validate = ajv.getSchema(schemaId);
  if (!resolved.referenced || !validate(resolved.referenced)) {
    issues.push(`outcomeGraph: ${label} does not conform to ${schemaId}: ${ajv.errorsText(validate?.errors ?? [])}`);
    return null;
  }
  return resolved.referenced;
}

async function checkOutcomeGraph(document, sourceAbsolute, issues) {
  const workArtifactRegistry = await loadBoundJson(
    document.workArtifactRegistry,
    "workArtifactRegistry",
    sourceAbsolute,
    workArtifactRegistrySchemaId,
    issues
  );
  if (workArtifactRegistry) {
    const registeredTypes = new Set((workArtifactRegistry.artifactTypes ?? []).map((entry) => entry.id));
    for (const workArtifactType of document.workArtifactTypes ?? []) {
      if (!registeredTypes.has(workArtifactType)) {
        issues.push(`outcomeGraph: work artifact ${workArtifactType} is outside the authenticated registry`);
      }
    }
  }
  const terminalRequirements = document.terminalEvidenceRequirements ?? {};
  for (const primaryOutcome of ["solved", "correct_refusal", "already_satisfied"]) {
    const artifactTypes = (terminalRequirements[primaryOutcome]?.requiredArtifacts ?? [])
      .map((requirement) => requirement.artifactType);
    reportDuplicateIds(artifactTypes, `outcomeGraph ${primaryOutcome} terminal evidence artifact types`, issues);
  }
  if (document.id === "workspace-change-v1") {
    const requireTerminalArtifact = (primaryOutcome, artifactType, description) => {
      const matches = (terminalRequirements[primaryOutcome]?.requiredArtifacts ?? [])
        .filter((requirement) => requirement.artifactType === artifactType
          && requirement.cardinality === "exactly_one"
          && requirement.attestation === "required");
      if (matches.length !== 1) {
        issues.push(`outcomeGraph: workspace-change-v1 ${primaryOutcome} accepted outcome requires exactly one signed ${description} evidence artifact`);
      }
      return matches;
    };
    const workspaceDiffs = requireTerminalArtifact("solved", "workspace_diff", "content-addressed workspace_diff");
    if (workspaceDiffs.length === 1 && workspaceDiffs[0].uriBinding !== "artifact_sha256_matches_digest") {
      issues.push("outcomeGraph: workspace-change-v1 solved accepted outcome requires exactly one signed content-addressed workspace_diff evidence artifact");
    }
    requireTerminalArtifact("correct_refusal", "repo-change-v1:safe_refusal_record", "safe-refusal");
    requireTerminalArtifact("correct_refusal", "repo-change-v1:refusal_applicability_record", "refusal-applicability");
    requireTerminalArtifact("already_satisfied", "repo-change-v1:base_state_record", "base-state");
  }

  const taxonomy = document.primaryOutcomeTaxonomy ?? [];
  const taxonomyCounts = occurrenceCounts(taxonomy);
  const rules = document.outcomeRules ?? {};
  for (const id of taxonomy) {
    if (taxonomyCounts.get(id) !== 1) issues.push(`outcomeGraph: primary outcome ${id} occurs ${taxonomyCounts.get(id)} times`);
    if (!Object.hasOwn(rules, id)) issues.push(`outcomeGraph: primary outcome ${id} has no outcome rule`);
  }
  for (const id of Object.keys(rules)) {
    if (!taxonomyCounts.has(id)) issues.push(`outcomeGraph: outcome rule ${id} is outside the primary taxonomy`);
  }
  const nativeOutcomes = document.nativeOutcomes ?? [];
  const nativeOutcomeCounts = occurrenceCounts(nativeOutcomes.map((entry) => entry.id));
  for (const [id, count] of nativeOutcomeCounts) {
    if (count !== 1) issues.push(`outcomeGraph: native outcome ${id} occurs ${count} times`);
  }
  for (const entry of nativeOutcomes) {
    if (!taxonomyCounts.has(entry.baseOutcome)) {
      issues.push(`outcomeGraph: native outcome ${entry.id} maps to unknown normalized outcome ${entry.baseOutcome}`);
    }
    reportDuplicateIds(entry.allowedSubstatuses ?? [], `outcomeGraph native outcome ${entry.id} substatuses`, issues);
  }
  for (const id of taxonomy) {
    const mappings = nativeOutcomes.filter((entry) => entry.baseOutcome === id).length;
    if (mappings === 0) issues.push(`outcomeGraph: normalized outcome ${id} has no profile-native mapping`);
  }

  const evidenceModes = document.evidenceModes ?? [];
  const evidenceModeCounts = occurrenceCounts(evidenceModes.map((mode) => mode.id));
  for (const [id, count] of evidenceModeCounts) {
    if (count !== 1) issues.push(`outcomeGraph: evidence mode ${id} occurs ${count} times`);
  }
  const alternatives = document.validAlternatives ?? [];
  const alternativeCounts = occurrenceCounts(alternatives.map((alternative) => alternative.id));
  const alternativesById = new Map(alternatives.map((alternative) => [alternative.id, alternative]));
  for (const [id, count] of alternativeCounts) {
    if (count !== 1) issues.push(`outcomeGraph: valid alternative ${id} occurs ${count} times`);
  }

  const checkEvidenceModeReferences = (owner, ids) => {
    for (const id of ids ?? []) {
      if (evidenceModeCounts.get(id) !== 1) {
        issues.push(`outcomeGraph: ${owner} references evidence mode ${id}, declared ${evidenceModeCounts.get(id) ?? 0} times`);
      }
    }
  };
  for (const [outcomeId, rule] of Object.entries(rules)) {
    checkEvidenceModeReferences(`outcome rule ${outcomeId}`, rule.evidenceModeIds);
    for (const alternativeId of rule.validAlternativeIds ?? []) {
      const alternative = alternativesById.get(alternativeId);
      if (alternativeCounts.get(alternativeId) !== 1) {
        issues.push(`outcomeGraph: outcome rule ${outcomeId} references valid alternative ${alternativeId}, declared ${alternativeCounts.get(alternativeId) ?? 0} times`);
      } else if (alternative.primaryOutcome !== outcomeId) {
        issues.push(`outcomeGraph: outcome rule ${outcomeId} references alternative ${alternativeId} for ${alternative.primaryOutcome}`);
      }
    }
  }
  for (const alternative of alternatives) {
    checkEvidenceModeReferences(`valid alternative ${alternative.id}`, alternative.evidenceModeIds);
    const references = rules[alternative.primaryOutcome]?.validAlternativeIds?.filter((id) => id === alternative.id).length ?? 0;
    if (references !== 1) {
      issues.push(`outcomeGraph: valid alternative ${alternative.id} is referenced ${references} times by its primary outcome ${alternative.primaryOutcome}`);
    }
  }

  const functionalOutcomes = document.claimCompatibility?.functionalPrimaryOutcomes ?? [];
  const acceptedOutcomes = document.claimCompatibility?.acceptedPrimaryOutcomes ?? [];
  for (const id of [...functionalOutcomes, ...acceptedOutcomes]) {
    if (!taxonomyCounts.has(id)) issues.push(`outcomeGraph: claim compatibility references unknown primary outcome ${id}`);
  }
  for (const id of acceptedOutcomes) {
    if (!functionalOutcomes.includes(id)) issues.push(`outcomeGraph: accepted outcome ${id} is not a functional outcome`);
  }
  if (document.claimCompatibility?.governanceEvidenceRequiresAcceptedOutcome
    && !document.claimCompatibility?.allowedClaimTypes?.includes("governance_evidence")) {
    issues.push("outcomeGraph: governance evidence acceptance is required but governance_evidence is not an allowed claim type");
  }

  const contractDigest = sha256Bytes(await readFile(path.join(root, "standard", "scorecard-contract.md")));
  for (const field of ["functionalSuccess", "acceptedOutcome"]) {
    if (document[field]?.contractDigest !== contractDigest) {
      issues.push(`outcomeGraph: ${field} contractDigest must bind ${contractDigest}`);
    }
  }

  const gateRegistry = await loadBoundJson(
    document.gateRegistry,
    "gateRegistry",
    sourceAbsolute,
    "urn:agent-evals-standard:schema:repo-change-gate-registry:1",
    issues
  );
  const failureTaxonomy = await loadBoundJson(
    document.failureTaxonomy,
    "failureTaxonomy",
    sourceAbsolute,
    "urn:agent-evals-standard:schema:repo-change-failure-taxonomy:1",
    issues
  );
  if (!gateRegistry || !failureTaxonomy) return;

  const failureMappings = failureTaxonomy.mappings ?? [];
  const failureCounts = occurrenceCounts(failureMappings.map((mapping) => mapping.id));
  for (const [id, count] of failureCounts) {
    if (count !== 1) issues.push(`outcomeGraph: failure cause ${id} occurs ${count} times`);
  }
  for (const mapping of failureMappings) {
    if (!taxonomyCounts.has(mapping.defaultPrimaryOutcome)) {
      issues.push(`outcomeGraph: failure cause ${mapping.id} maps to unknown outcome ${mapping.defaultPrimaryOutcome}`);
    }
  }
  const gateCauseOwners = [
    ...(gateRegistry.profileGates ?? []).map((gate) => [`gate ${gate.id}`, gate.failureCauseId]),
    ["unknownOrIndeterminate", gateRegistry.unknownOrIndeterminate?.failureCauseId]
  ];
  for (const [owner, failureCauseId] of gateCauseOwners) {
    if (failureCounts.get(failureCauseId) !== 1) {
      issues.push(`outcomeGraph: ${owner} references failure cause ${failureCauseId}, declared ${failureCounts.get(failureCauseId) ?? 0} times`);
    }
  }
}

async function checkEscalationRequestBinding(document, _sourceAbsolute, issues) {
  if (document.enforcementRequest?.action !== document.stopAction) {
    issues.push("escalationRequestBinding: enforcementRequest.action must equal stopAction");
  }
  if (Date.parse(document.enforcementRequest?.requestedAt) < Date.parse(document.triggeredAt)) {
    issues.push("escalationRequestBinding: requestedAt precedes triggeredAt");
  }
}

async function checkSourceEventBinding(document, sourceAbsolute, issues, fixture) {
  if (!fixture.relatedPath) {
    issues.push("sourceEventBinding: relatedPath is required");
    return;
  }
  let event;
  try {
    const absolute = resolveRepositoryPath(fixtureDirectory, fixture.relatedPath);
    event = await readJsonStrict(absolute);
  } catch (error) {
    issues.push(`sourceEventBinding: ${error.message}`);
    return;
  }
  const eventDigest = sha256Canonical(event);
  if (document.sourceEventId !== event.id) issues.push("sourceEventBinding: sourceEventId does not match event id");
  if (document.sourceEventDigest !== eventDigest) issues.push(`sourceEventBinding: sourceEventDigest must be ${eventDigest}`);
  if (canonicalize(document.affectedScope) !== canonicalize(event.affectedScope)) issues.push("sourceEventBinding: affectedScope differs from source event");
  if (document.stopAction !== event.stopAction) issues.push("sourceEventBinding: stopAction differs from source event");
  if (document.scopeAction !== event.scopeAction) issues.push("sourceEventBinding: scopeAction differs from source event");
  if (document.requestedAt !== event.enforcementRequest?.requestedAt) issues.push("sourceEventBinding: requestedAt differs from source event");
  const timeline = [event.triggeredAt, document.requestedAt, document.startedAt, document.completedAt].map(Date.parse);
  if (timeline.some(Number.isNaN) || timeline.some((time, index) => index > 0 && time < timeline[index - 1])) {
    issues.push("sourceEventBinding: event, request, start, and completion times are not ordered");
  }
}

let evaluationControlVectorsPromise;

async function checkEvaluationControlGraph(document, _sourceAbsolute, issues) {
  evaluationControlVectorsPromise ??= verifyMachineContractVectors();
  const vectorOutcome = await evaluationControlVectorsPromise;
  if (!vectorOutcome.passed) {
    for (const failure of vectorOutcome.failures) {
      for (const issue of failure.issues) {
        issues.push(`evaluationControlGraph: ${failure.id}: ${issue}`);
      }
    }
    return;
  }
  const artifactOutcome = await verifyMachineContractArtifact(document);
  for (const issue of artifactOutcome.issues) {
    issues.push(`evaluationControlGraph: ${issue}`);
  }
}

const semanticCheckers = {
  assurancePolicy: (document, _sourceAbsolute, issues) => {
    issues.push(...assurancePolicyIssues(document));
  },
  artifactPointers: checkArtifactPointers,
  caseClassification: checkCaseClassification,
  caseCapabilityClassification: checkCaseCapabilityClassification,
  caseCapabilityClassificationBoundary: checkCaseCapabilityClassificationBoundary,
  caseProfileBindings: checkCaseProfileBindings,
  caseQaRecord: (document, sourceAbsolute, issues) => checkCaseQaRecord(document, issues, {
    authenticateEvidence: (artifact) => fixtureSignatureProblem(artifact),
    resolveEvidencePayload: async (artifact) => (await resolveEvidencePayloadBytes(artifact.payload, {
      baseDirectory: path.dirname(sourceAbsolute)
    })).bytes,
    resolveOutcomeReplayBinding: (outcomeProfileId) => resolveDistributionOutcomeReplayBinding(outcomeProfileId),
    resolveClassificationFrame: (caseBinding) => resolveFixtureCaseQaClassificationFrame(caseBinding),
    validateClassificationEvidence: (payload) => {
      const validate = ajv.getSchema(
        "urn:agent-evals-standard:schema:case-qa-record:1#/$defs/classificationPolicyApplicabilityEvidence"
      );
      if (!validate) return "classification applicability evidence schema is unavailable";
      return validate(payload) ? null : ajv.errorsText(validate.errors);
    }
  }),
  caseValidationStrategy: (document, _sourceAbsolute, issues) => checkCaseValidationStrategy(
    document,
    issues,
    { applicabilityRegistry: referenceFixtureApplicabilityRegistry }
  ),
  caseWorkArtifactBindings: checkCaseWorkArtifactBindings,
  claimTrustBinding: checkClaimTrustBinding,
  conformanceGraph: checkConformanceGraph,
  conformanceTargetComposition: (
    document,
    sourceAbsolute,
    issues
  ) => checkConformanceTargetComposition(
    document,
    sourceAbsolute,
    issues,
    {
      root,
      fixturePublicKey: fixtureKey,
      validateSchema: (schemaId, subject) => {
        const validate = ajv.getSchema(schemaId);
        if (!validate) return `unknown schema ${schemaId}`;
        return validate(subject) ? true : ajv.errorsText(validate.errors);
      },
      verifySignedArtifact: (subject) => fixtureSignatureProblem(subject),
      authenticateTargetSubject: (subject) => fixtureSignatureProblem(subject),
      validateScorecardSemantics: (subject, absolute, nestedIssues) => checkScorecardGraph(
        subject,
        absolute,
        nestedIssues,
        null
      )
    }
  ),
  contractDigest: checkContractDigest,
  effectiveProfileDigest: checkEffectiveProfileDigest,
  embeddedEvidence: checkEmbeddedEvidence,
  evidencePayload: checkEvidencePayload,
  escalationRequestBinding: checkEscalationRequestBinding,
  evaluationControlGraph: checkEvaluationControlGraph,
  evaluatorManifest: checkEvaluatorManifest,
  outcomeGraph: checkOutcomeGraph,
  profileFixtureBindings: checkProfileFixtureBindings,
  profileInheritance: checkEffectiveProfileDigest,
  profileResolutionProvenance: checkProfileResolutionProvenance,
  profileResolutionRecord: checkProfileResolutionRecord,
  productionDerivedInput: (document, sourceAbsolute, issues, fixture) => checkProductionDerivedInput(
    document,
    sourceAbsolute,
    issues,
    fixture,
    {
      root,
      fixtureDirectory,
      fixtureKey,
      validateEvidenceArtifact: ajv.getSchema("urn:agent-evals-standard:schema:evidence-artifact:1"),
      validateProductionDerivedAuthorityContract: ajv.getSchema(
        "urn:agent-evals-standard:schema:production-derived-authority-contract:1"
      ),
      validatePreRunManifest: ajv.getSchema("urn:agent-evals-standard:schema:pre-run-manifest:1"),
      authenticatePreRun: async (preRun) => artifactSignatureProblem(preRun),
      productionDerivedVerifierRegistry: [
        {
          id: "repo-change-production-derived-verifier",
          version: "0.1.0",
          path: "profiles/repo-change-v1/verify-production-derived.mjs",
          digest: "sha256:d8c1ea13cfa6fed680dfbce6f20f4cde8ea3144dc5ce295764f068d781b8a3fa"
        }
      ]
    }
  ),
  repositoryGroundingEvidence: checkRepositoryGroundingEvidence,
  requirementCoverage: checkRequirementCoverage,
  scorecardGraph: checkScorecardGraph,
  sdlcCoverage: (document, sourceAbsolute, issues) => checkSdlcCoverage(
    document,
    sourceAbsolute,
    issues,
    {
      root,
      fixtureKey,
      validateCoverage: ajv.getSchema("urn:agent-evals-standard:schema:sdlc-coverage:1"),
      validateWorkArtifactRegistry: ajv.getSchema("urn:agent-evals-standard:schema:work-artifact-registry:1")
    }
  ),
  selfDigest: checkSelfDigest,
  signature: checkSignature,
  signatureProfileBinding: checkSignatureProfileBinding,
  sourceEvidenceGraph: checkSourceEvidenceGraph,
  sourceEvidenceTriangulation: checkSourceEvidenceTriangulation,
  sourceEventBinding: checkSourceEventBinding,
  suiteProfileBindings: (document, sourceAbsolute, issues) => checkSuiteProfileBindings(
    document,
    sourceAbsolute,
    issues,
    {
      resolvePinnedArtifact,
      resolveEffectiveProfile,
      resolveWorkArtifactRegistry,
      digestEffectiveProfile: sha256Canonical
    }
  ),
  validationEnvelope: checkValidationEnvelope,
  workspaceManifestBinding: checkWorkspaceManifestBinding,
  workspaceManifest: checkWorkspaceManifest
};

async function executeCentralFixtureExpectation(fixture) {
  const sourcePath = fixture.path ?? fixture.basePath;
  let sourceAbsolute;
  let document;
  try {
    sourceAbsolute = resolveRepositoryPath(fixtureDirectory, sourcePath);
    document = await readJsonStrict(sourceAbsolute);
    applyMutations(document, fixture.mutations);
    if (fixture.recomputeSelfDigest === true) {
      document.digest = sha256Canonical(selfDigestProjection(document));
    }
  } catch (error) {
    if (fixture.expectParseFailure === true) {
      return {
        actualValid: false,
        diagnostics: error.message,
        schemaErrors: [],
        semanticIssues: []
      };
    }
    return { executionError: `${sourcePath}: could not materialize fixture: ${error.message}` };
  }
  if (fixture.expectParseFailure === true) {
    return { executionError: `${sourcePath}: expected strict I-JSON parse failure, but parsing succeeded` };
  }

  const validate = ajv.getSchema(fixture.schema);
  if (!validate) return { executionError: `Unknown fixture schema: ${fixture.schema}` };
  const schemaValid = validate(document);
  const schemaErrors = clone(validate.errors ?? []);
  const semanticIssues = [];
  if (schemaValid) {
    const checks = new Set(fixture.semanticChecks ?? []);
    if (fixture.valid === true
      && document?.schemaVersion === "agent-eval-operational-governance-policy-1") {
      checks.add("assurancePolicy");
    }
    if (fixture.valid === true
      && document?.schemaVersion === "agent-eval-evaluation-profile-1") {
      checks.add("signatureProfileBinding");
    }
    // The externally rooted graph verifier authenticates its own policy, authority evidence,
    // claimant stage documents, and statistical plan under their authorized key profiles.
    if (fixture.valid === true && document?.schemaVersion && document?.signature
      && !checks.has("evaluationControlGraph")) checks.add("signature");
    if (fixture.valid === true && document?.digest && document?.signature) checks.add("selfDigest");
    if (fixture.valid === true && document?.attestation) checks.add("signature");
    if (fixture.valid === true && Array.isArray(document?.evidenceManifest)) checks.add("embeddedEvidence");
    for (const check of checks) {
      const checker = semanticCheckers[check];
      if (!checker) return { executionError: `Unknown semantic check: ${check}` };
      await checker(document, sourceAbsolute, semanticIssues, fixture);
    }
  }
  return {
    actualValid: schemaValid && semanticIssues.length === 0,
    diagnostics: [JSON.stringify(schemaErrors), ...semanticIssues].join("\n"),
    document,
    schemaErrors,
    schemaValid,
    semanticIssues,
    sourceAbsolute
  };
}

let failed = 0;
const selectedFixtures = selectedGroup
  ? manifest.fixtures.filter((fixture) => fixture.group === selectedGroup)
  : manifest.fixtures;
if (selectedGroup && selectedFixtures.length === 0) {
  throw new Error(`fixture group ${selectedGroup} has no expectations`);
}
for (const fixture of selectedFixtures) {
  const sourcePath = fixture.path ?? fixture.basePath;
  const fixtureLabel = fixture.id ? `${fixture.id} (${sourcePath})` : sourcePath;
  const outcome = await executeCentralFixtureExpectation(fixture);
  if (outcome.executionError) {
    failed += 1;
    console.error(outcome.executionError);
    continue;
  }
  const outcomeProblems = profileFixtureOutcomeProblems(fixture, outcome);
  if (outcomeProblems.length > 0) {
    failed += 1;
    for (const problem of outcomeProblems) console.error(`${fixtureLabel}: ${problem}`);
    if (!outcome.schemaValid && outcome.schemaErrors.length > 0) {
      console.error(ajv.errorsText(outcome.schemaErrors, { separator: "\n  " }));
    }
    outcome.semanticIssues.forEach((issue) => console.error(`  ${issue}`));
  }
}

if (failed) process.exit(1);
console.log(`Schema and fixture checks passed: ${schemaIds.length} schemas, ${selectedFixtures.length} expectations${selectedGroup ? ` in group ${selectedGroup}` : ""}.`);
