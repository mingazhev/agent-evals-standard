import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  profileFixtureAuthorityProblems,
  profileFixtureOutcomeProblems,
  registeredProfileFixtureManifestKind
} from "./profile-fixture-execution-contract.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDirectory = path.join(root, "conformance", "fixtures");

const vectors = [
  {
    id: "reject-unregistered-fake-manifest",
    expected: "not registered",
    problems() {
      const kind = registeredProfileFixtureManifestKind(
        path.join(fixtureDirectory, "claimant", "fake-manifest.json"),
        fixtureDirectory
      );
      return kind === null ? ["manifest is not registered"] : [];
    }
  },
  {
    id: "reject-valid-true-that-actually-fails",
    expected: "observed valid=false differs from manifest valid=true",
    problems: () => profileFixtureOutcomeProblems(
      { id: "lying-pass", valid: true },
      { actualValid: false, diagnostics: "schema rejected the subject" },
      "pass"
    )
  },
  {
    id: "reject-valid-false-that-actually-passes",
    expected: "observed valid=true differs from manifest valid=false",
    problems: () => profileFixtureOutcomeProblems(
      { id: "lying-fail", valid: false, expectedError: "required rejection" },
      { actualValid: true, diagnostics: "" },
      "fail"
    )
  },
  {
    id: "reject-invalid-that-fails-for-wrong-reason",
    expected: "failed for the wrong reason",
    problems: () => profileFixtureOutcomeProblems(
      { id: "wrong-reason", valid: false, expectedError: "required rejection" },
      { actualValid: false, diagnostics: "different rejection" },
      "fail"
    )
  },
  {
    id: "reject-claimant-validator-substitution",
    expected: "must not select or supply validator",
    problems: () => profileFixtureAuthorityProblems(
      { schemaVersion: "test" },
      { id: "substitution", valid: true, validator: "claimant-validator.mjs" },
      "distribution-test-manifest"
    )
  },
  {
    id: "reject-claimant-report-substitution",
    expected: "must not select or supply executionReport",
    problems: () => profileFixtureAuthorityProblems(
      { schemaVersion: "test", executionReport: { verdict: "pass" } },
      { id: "substitution", valid: true },
      "distribution-test-manifest"
    )
  }
];

const failures = [];
for (const vector of vectors) {
  const problems = vector.problems();
  if (!problems.some((problem) => problem.includes(vector.expected))) {
    failures.push(`${vector.id}: expected ${JSON.stringify(vector.expected)}, found ${JSON.stringify(problems)}`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`${failure}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Profile fixture execution contract vectors passed: ${vectors.length}/${vectors.length}.\n`);
}
