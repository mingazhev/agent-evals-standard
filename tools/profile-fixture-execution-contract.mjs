import path from "node:path";

const executionAuthorityKeys = [
  "executionReport",
  "executor",
  "report",
  "runner",
  "validator",
  "verifier"
];

export function registeredProfileFixtureManifestKind(absolute, fixtureDirectory) {
  const registered = new Map([
    [path.resolve(fixtureDirectory, "manifest.json"), "distribution-conformance-manifest"],
    [
      path.resolve(fixtureDirectory, "repository-review-v1", "vectors.json"),
      "distribution-repository-review-vectors"
    ]
  ]);
  return registered.get(path.resolve(absolute)) ?? null;
}

export function profileFixtureAuthorityProblems(manifestDocument, expectation, manifestKind) {
  const problems = [];
  for (const [label, subject] of [["manifest", manifestDocument], ["expectation", expectation]]) {
    for (const key of executionAuthorityKeys) {
      if (subject && Object.hasOwn(subject, key)) {
        problems.push(`${manifestKind} ${label} must not select or supply ${key}; execution authority is distribution-owned`);
      }
    }
  }
  return problems;
}

export function profileFixtureOutcomeProblems(expectation, outcome, descriptorVerdict = null) {
  if (outcome?.executionError) return [outcome.executionError];
  const problems = [];
  const observedValid = outcome?.actualValid === true;
  if (typeof expectation.valid !== "boolean") {
    problems.push("manifest expectation valid must be boolean");
  } else if (observedValid !== expectation.valid) {
    problems.push(`observed valid=${observedValid} differs from manifest valid=${expectation.valid}`);
  }
  if (descriptorVerdict !== null) {
    const descriptorValid = descriptorVerdict === "pass";
    if (expectation.valid !== descriptorValid) {
      problems.push(`${descriptorVerdict} must bind manifest valid=${descriptorValid}`);
    }
    if (observedValid !== descriptorValid) {
      problems.push(`observed valid=${observedValid} differs from descriptor verdict ${descriptorVerdict}`);
    }
  }
  if (expectation.valid === false) {
    if (typeof expectation.expectedError !== "string" || expectation.expectedError.length === 0) {
      problems.push("negative manifest expectation must declare expectedError");
    } else if (!String(outcome?.diagnostics ?? "").includes(expectation.expectedError)) {
      problems.push(`invalid expectation failed for the wrong reason; expected error containing ${expectation.expectedError}`);
    }
  }
  return problems;
}
