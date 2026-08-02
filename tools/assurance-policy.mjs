export const assuranceOrder = Object.freeze(["A0", "A1", "A2", "A3"]);
export const riskOrder = Object.freeze(["low", "medium", "high", "critical"]);
export const decisionClasses = Object.freeze([
  "capability_claim",
  "release",
  "autonomy",
  "risk_acceptance"
]);

export const baseAssuranceFloors = Object.freeze({
  low: Object.freeze({
    capability_claim: "A1",
    release: "A2",
    autonomy: "A3",
    risk_acceptance: "A3"
  }),
  medium: Object.freeze({
    capability_claim: "A1",
    release: "A2",
    autonomy: "A3",
    risk_acceptance: "A3"
  }),
  high: Object.freeze({
    capability_claim: "A3",
    release: "A3",
    autonomy: "A3",
    risk_acceptance: "A3"
  }),
  critical: Object.freeze({
    capability_claim: "A3",
    release: "A3",
    autonomy: "A3",
    risk_acceptance: "A3"
  })
});

function rank(level) {
  return assuranceOrder.indexOf(level);
}

export function baseRequiredAssuranceLevel(effectiveRiskTier, decisionClass) {
  if (!riskOrder.includes(effectiveRiskTier)) {
    return { level: null, issues: [`unknown effective risk tier ${effectiveRiskTier}`] };
  }
  if (!decisionClasses.includes(decisionClass)) {
    return { level: null, issues: [`unknown decision class ${decisionClass}`] };
  }
  return { level: baseAssuranceFloors[effectiveRiskTier][decisionClass], issues: [] };
}

export function baseAssuranceSelectionIssues({
  assuranceLevel,
  effectiveRiskTier,
  decisionClass,
  claimEligibility
}, owner = "assurance selection") {
  if (assuranceLevel === "A0") {
    const issues = [];
    if (claimEligibility !== "none") issues.push(`${owner}: A0 requires claimEligibility none`);
    if (decisionClass !== "diagnostic") issues.push(`${owner}: A0 requires decisionClass diagnostic`);
    return issues;
  }
  if (decisionClass === "diagnostic") return [`${owner}: A1-A3 cannot use decisionClass diagnostic`];
  if (claimEligibility !== "claims_eligible") {
    return [`${owner}: A1-A3 require claimEligibility claims_eligible`];
  }
  const selected = baseRequiredAssuranceLevel(effectiveRiskTier, decisionClass);
  if (selected.issues.length > 0) return selected.issues.map((issue) => `${owner}: ${issue}`);
  if (rank(assuranceLevel) < rank(selected.level)) {
    return [`${owner}: ${effectiveRiskTier}/${decisionClass} requires base assurance ${selected.level}, found ${assuranceLevel}`];
  }
  return [];
}

export function assurancePolicyIssues(policy, owner = "assurance policy") {
  const issues = [];
  const rules = policy?.rules ?? [];
  const counts = new Map();
  for (const rule of rules) counts.set(rule.riskTier, (counts.get(rule.riskTier) ?? 0) + 1);
  for (const riskTier of riskOrder) {
    if (counts.get(riskTier) !== 1) {
      issues.push(`${owner}: risk tier ${riskTier} must have exactly one rule`);
    }
  }
  for (const riskTier of counts.keys()) {
    if (!riskOrder.includes(riskTier)) issues.push(`${owner}: unknown risk tier ${riskTier}`);
  }

  const byRisk = new Map(rules.map((rule) => [rule.riskTier, rule]));
  for (const riskTier of riskOrder) {
    const minima = byRisk.get(riskTier)?.minimumAssuranceByDecision;
    if (!minima) continue;
    for (const decisionClass of decisionClasses) {
      const actual = minima[decisionClass];
      const floor = baseAssuranceFloors[riskTier][decisionClass];
      if (rank(actual) < rank(floor)) {
        issues.push(`${owner}: ${riskTier}/${decisionClass} minimum ${actual ?? "<missing>"} is below base floor ${floor}`);
      }
    }
  }

  for (const decisionClass of decisionClasses) {
    let previous = -1;
    for (const riskTier of riskOrder) {
      const level = byRisk.get(riskTier)?.minimumAssuranceByDecision?.[decisionClass];
      const current = rank(level);
      if (current < 0) continue;
      if (current < previous) {
        issues.push(`${owner}: ${decisionClass} minimum decreases at risk tier ${riskTier}`);
      }
      previous = current;
    }
  }

  for (const riskTier of riskOrder) {
    const minima = byRisk.get(riskTier)?.minimumAssuranceByDecision;
    if (!minima) continue;
    if (rank(minima.release) < rank(minima.capability_claim)) {
      issues.push(`${owner}: ${riskTier}/release minimum is below capability_claim`);
    }
    for (const decisionClass of ["autonomy", "risk_acceptance"]) {
      if (rank(minima[decisionClass]) < rank(minima.release)) {
        issues.push(`${owner}: ${riskTier}/${decisionClass} minimum is below release`);
      }
    }
  }
  return issues;
}

export function requiredAssuranceLevel(policy, effectiveRiskTier, decisionClass) {
  const issues = assurancePolicyIssues(policy);
  if (issues.length > 0) return { level: null, issues };
  if (!riskOrder.includes(effectiveRiskTier)) {
    return { level: null, issues: [`unknown effective risk tier ${effectiveRiskTier}`] };
  }
  if (!decisionClasses.includes(decisionClass)) {
    return { level: null, issues: [`unknown decision class ${decisionClass}`] };
  }
  const rule = policy.rules.find((entry) => entry.riskTier === effectiveRiskTier);
  return { level: rule.minimumAssuranceByDecision[decisionClass], issues: [] };
}

export function assuranceSelectionIssues({
  policy,
  assuranceLevel,
  effectiveRiskTier,
  decisionClass,
  claimEligibility
}, owner = "assurance selection") {
  const baseIssues = baseAssuranceSelectionIssues({
    assuranceLevel, effectiveRiskTier, decisionClass, claimEligibility
  }, owner);
  if (baseIssues.length > 0 || assuranceLevel === "A0") return baseIssues;
  const selected = requiredAssuranceLevel(policy, effectiveRiskTier, decisionClass);
  if (selected.issues.length > 0) return selected.issues.map((issue) => `${owner}: ${issue}`);
  if (rank(assuranceLevel) < rank(selected.level)) {
    return [`${owner}: ${effectiveRiskTier}/${decisionClass} requires at least ${selected.level}, found ${assuranceLevel}`];
  }
  return [];
}
