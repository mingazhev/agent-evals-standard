import process from "node:process";

import { conformanceScopeBindingPolicy } from "./conformance-scope-binding.mjs";

const vectors = [
  {
    id: "accept-a0-diagnostic-binding",
    slice: { id: "a0", assuranceLevel: "A0", bindingUse: "diagnostic_only" },
    expectedCompatibility: false,
    expectedIssues: []
  },
  {
    id: "reject-a0-claims-eligible-binding",
    slice: { id: "a0-wrong", assuranceLevel: "A0", bindingUse: "claims_eligible" },
    expectedCompatibility: false,
    expectedDiagnostic: "assurance A0 requires bindingUse diagnostic_only"
  },
  {
    id: "accept-a1-claims-eligible-binding",
    slice: { id: "a1", assuranceLevel: "A1", bindingUse: "claims_eligible" },
    expectedCompatibility: true,
    expectedIssues: []
  },
  {
    id: "reject-a3-diagnostic-binding",
    slice: { id: "a3-wrong", assuranceLevel: "A3", bindingUse: "diagnostic_only" },
    expectedCompatibility: true,
    expectedDiagnostic: "assurance A3 requires bindingUse claims_eligible"
  }
];

let failures = 0;
for (const vector of vectors) {
  const label = `vector ${vector.id}`;
  const result = conformanceScopeBindingPolicy(vector.slice, label);
  const expectedIssues = vector.expectedIssues ?? [`${label}: ${vector.expectedDiagnostic}`];
  if (result.requireProfileCompatibility !== vector.expectedCompatibility
    || JSON.stringify(result.issues) !== JSON.stringify(expectedIssues)) {
    failures += 1;
    process.stderr.write(`${vector.id}: expected compatibility=${vector.expectedCompatibility}, issues=${JSON.stringify(expectedIssues)}; found compatibility=${result.requireProfileCompatibility}, issues=${JSON.stringify(result.issues)}\n`);
  }
}

if (failures > 0) {
  process.exitCode = 1;
} else {
  process.stdout.write(`Conformance scope-binding vectors passed: ${vectors.length}/${vectors.length}.\n`);
}
