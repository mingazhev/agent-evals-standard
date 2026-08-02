const allowedCheckResults = new Set(["pass", "fail", "insufficient_evidence"]);

export function deriveValidationEnvelopeResult(checks) {
  const results = Array.isArray(checks) ? checks.map((check) => check?.result) : [];
  if (results.includes("fail")) return "fail";
  if (results.length > 0 && results.every((result) => result === "pass")) return "pass";
  return "insufficient_evidence";
}

export function validationEnvelopeAggregateIssues(checks, declaredResult, owner = "validationEnvelope") {
  const normalizedChecks = Array.isArray(checks) ? checks : [];
  const issues = [];

  for (const [index, check] of normalizedChecks.entries()) {
    if (allowedCheckResults.has(check?.result)) continue;
    const label = check?.requirementId ?? `checks/${index}`;
    issues.push(
      `${owner} ${label}: result ${JSON.stringify(check?.result)} is forbidden; `
      + "target-selected coverage permits only pass, fail, or insufficient_evidence"
    );
  }

  const derivedResult = deriveValidationEnvelopeResult(normalizedChecks);
  if (declaredResult !== derivedResult) {
    issues.push(`${owner}: aggregate result must be ${derivedResult}, found ${declaredResult}`);
  }
  return issues;
}
