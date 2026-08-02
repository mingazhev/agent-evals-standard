export function conformanceScopeBindingPolicy(slice, label = `scope slice ${slice?.id ?? "<unknown>"}`) {
  const diagnostic = slice?.assuranceLevel === "A0";
  const expectedBindingUse = diagnostic ? "diagnostic_only" : "claims_eligible";
  const issues = [];
  if (slice?.bindingUse !== expectedBindingUse) {
    issues.push(`${label}: assurance ${slice?.assuranceLevel ?? "<unknown>"} requires bindingUse ${expectedBindingUse}`);
  }
  return {
    expectedBindingUse,
    requireProfileCompatibility: !diagnostic,
    issues
  };
}
