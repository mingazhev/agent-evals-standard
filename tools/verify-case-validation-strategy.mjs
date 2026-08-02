import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const VALIDATION_CLASSES = ["publicChecks", "hiddenChecks", "securityChecks", "controlProofs"];

function ruleKey(rule) {
  return [rule?.id, rule?.version, rule?.digest, rule?.schemaId, rule?.verifierDigest].join("|");
}

function registryMap(registry) {
  return registry instanceof Map ? registry : new Map((registry ?? []).map((entry) => [ruleKey(entry.rule), entry]));
}

export const referenceFixtureApplicabilityRegistry = [
  {
    validationClass: "publicChecks",
    determination: "not_applicable",
    rule: {
      id: "architecture-public-check-applicability",
      version: "0.1.0",
      digest: "sha256:a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1",
      schemaId: "agent-eval-validation-class-applicability-rule-1",
      verifierDigest: "sha256:a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2"
    }
  },
  {
    validationClass: "hiddenChecks",
    determination: "applicable",
    rule: {
      id: "architecture-hidden-check-applicability",
      version: "0.1.0",
      digest: "sha256:a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3",
      schemaId: "agent-eval-validation-class-applicability-rule-1",
      verifierDigest: "sha256:a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4"
    }
  },
  {
    validationClass: "securityChecks",
    determination: "applicable",
    rule: {
      id: "architecture-security-check-applicability",
      version: "0.1.0",
      digest: "sha256:a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5",
      schemaId: "agent-eval-validation-class-applicability-rule-1",
      verifierDigest: "sha256:a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6"
    }
  },
  {
    validationClass: "controlProofs",
    determination: "applicable",
    rule: {
      id: "architecture-control-proof-applicability",
      version: "0.1.0",
      digest: "sha256:a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7",
      schemaId: "agent-eval-validation-class-applicability-rule-1",
      verifierDigest: "sha256:a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8"
    }
  }
];

export function checkCaseValidationStrategy(document, issues, context = {}) {
  const strategy = document?.validation?.strategy;
  const trusted = registryMap(context.applicabilityRegistry);
  if (!strategy || typeof strategy !== "object") {
    issues.push("caseValidationStrategy: complete validation.strategy is required");
    return;
  }
  const declaredClasses = Object.keys(strategy);
  for (const validationClass of VALIDATION_CLASSES) {
    if (!Object.hasOwn(strategy, validationClass)) {
      issues.push(`caseValidationStrategy: missing ${validationClass} disposition`);
      continue;
    }
    const disposition = strategy[validationClass];
    const trustedResult = trusted.get(ruleKey(disposition.applicabilityRule));
    if (!trustedResult) {
      issues.push(`caseValidationStrategy: ${validationClass} applicability rule is not evaluator-trusted`);
      continue;
    }
    if (trustedResult.validationClass !== validationClass) {
      issues.push(`caseValidationStrategy: ${validationClass} uses a rule authorized for ${trustedResult.validationClass}`);
      continue;
    }
    const expectedCoverage = trustedResult.determination === "applicable" ? "checked" : "not_applicable";
    if (disposition.coverage !== expectedCoverage) {
      issues.push(`caseValidationStrategy: ${validationClass} trusted result is ${trustedResult.determination}; coverage must be ${expectedCoverage}`);
    }
    if (disposition.unknownApplicabilityResult !== "invalid") {
      issues.push(`caseValidationStrategy: ${validationClass} unknown applicability must be invalid`);
    }
    if (!Array.isArray(disposition.applicabilityEvidence) || disposition.applicabilityEvidence.length === 0) {
      issues.push(`caseValidationStrategy: ${validationClass} has no material applicability evidence`);
    }
    const checks = document.validation?.[validationClass] ?? [];
    if (expectedCoverage === "checked" && checks.length === 0) {
      issues.push(`caseValidationStrategy: ${validationClass} is applicable but has no checks`);
    }
    if (expectedCoverage === "not_applicable" && checks.length !== 0) {
      issues.push(`caseValidationStrategy: ${validationClass} is not applicable but contains checks`);
    }
  }
  for (const validationClass of declaredClasses) {
    if (!VALIDATION_CLASSES.includes(validationClass)) {
      issues.push(`caseValidationStrategy: unknown validation class ${validationClass}`);
    }
  }
}

function decodePointerToken(token) {
  return token.replaceAll("~1", "/").replaceAll("~0", "~");
}

function applyMutation(document, mutation) {
  const tokens = mutation.pointer.slice(1).split("/").map(decodePointerToken);
  const leaf = tokens.pop();
  let target = document;
  for (const token of tokens) target = target[token];
  if (mutation.operation === "remove") delete target[leaf];
  else target[leaf] = structuredClone(mutation.value);
}

async function runVectors(vectorPath) {
  const vectors = JSON.parse(await readFile(vectorPath, "utf8"));
  let passed = 0;
  for (const vector of vectors.vectors ?? []) {
    const document = structuredClone(vectors.baseDocument);
    for (const mutation of vector.mutations ?? []) applyMutation(document, mutation);
    const issues = [];
    checkCaseValidationStrategy(document, issues, { applicabilityRegistry: vectors.trustedApplicabilityRegistry });
    const valid = issues.length === 0;
    const expectedErrorFound = !vector.expectedError
      || issues.some((issue) => issue.includes(vector.expectedError));
    if (valid !== vector.valid || !expectedErrorFound) {
      throw new Error(`${vector.id}: expected valid=${vector.valid}${vector.expectedError ? ` and ${vector.expectedError}` : ""}; got ${issues.join("; ") || "pass"}`);
    }
    passed += 1;
  }
  process.stdout.write(`Case validation-strategy vectors passed: ${passed}/${vectors.vectors.length}.\n`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const vectorPath = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../conformance/fixtures/scope-boundary/case-validation-strategy-vectors.json");
  await runVectors(vectorPath);
}
