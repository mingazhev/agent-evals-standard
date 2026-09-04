const close = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-9;

// The caller supplies the already selected statistic, not an artifact-provided executable.
export function caseWeightedIdentificationBounds(cases, statistic) {
  if (!cases.length) return null;
  let weightTotal = 0;
  let lower = 0;
  let upper = 0;
  for (const row of cases) {
    const { scheduled, successes, unresolved, weight } = row;
    if (![scheduled, successes, unresolved].every(Number.isSafeInteger)
      || scheduled <= 0 || successes < 0 || unresolved < 0 || successes + unresolved > scheduled
      || !Number.isFinite(weight) || weight <= 0) return null;
    const low = statistic(scheduled, successes);
    const high = statistic(scheduled, successes + unresolved);
    if (!Number.isFinite(low) || !Number.isFinite(high) || low < 0 || high > 1 || low > high) return null;
    weightTotal += weight;
    lower += weight * low;
    upper += weight * high;
  }
  if (!Number.isFinite(weightTotal) || !Number.isFinite(lower) || !Number.isFinite(upper)) return null;
  return { lower: lower / weightTotal, upper: upper / weightTotal };
}

export function differenceIdentificationBounds(a, b) {
  return a && b ? { lower: a.lower - b.upper, upper: a.upper - b.lower } : null;
}

export function binaryStatisticValue(estimand, total, successes, k) {
  if (!Number.isSafeInteger(total) || !Number.isSafeInteger(successes) || !Number.isSafeInteger(k)
    || total <= 0 || k <= 0 || k > total || successes < 0 || successes > total) return null;
  if (estimand === "reliability_at_k") return (successes / total) ** k;
  if (estimand !== "pass_at_k") return null;
  let allFailures = 1;
  for (let index = 0; index < k; index += 1) {
    const remainingFailures = total - successes - index;
    if (remainingFailures <= 0) return 1;
    allFailures *= remainingFailures / (total - index);
  }
  return 1 - allFailures;
}

// This fixture verifier has one executable aggregate contract. Other statistical
// contracts require their own pinned implementation; range checks are not replay.
export function completeCaseClaimStatisticsIssues(claim, result, caseResults, armIds) {
  const issues = [];
  const bound = result.identificationBounds;
  const selected = caseResults.filter((row) => claim.slice?.includes(row.case?.id));
  const scopeArms = claim.comparatorArmIds?.length ? claim.comparatorArmIds : armIds;
  if (bound?.method !== "complete-case" || bound.version !== "0.1.0"
    || claim.analysisUnit !== "scheduled_cell" || scopeArms.length !== 1
    || claim.direction !== "positive" || claim.estimand !== "functional success probability"
    || selected.length === 0
    || selected.some((row) => {
      const statistics = (row.statistics ?? []).filter((entry) => entry.claimId === claim.id);
      return statistics.length !== 1 || statistics[0].estimand !== "pass_at_k" || statistics[0].k !== 1;
    })) {
    return result.status === "supported"
      ? ["identification-bound contract is outside the executable single-arm scheduled-cell pass@1 complete-case scope"]
      : [];
  }
  const assignments = new Map((result.successAssignments ?? []).map((entry) => [entry.cellId, entry.success]));
  const rows = selected.map((row) => {
    const cells = (row.cells ?? []).filter((cell) => cell.armId === scopeArms[0]);
    return {
      scheduled: cells.length,
      unresolved: cells.filter((cell) => cell.state === "unresolved").length,
      successes: cells.filter((cell) => cell.state === "resolved" && assignments.get(cell.cellId) === true).length,
      weight: row.weight
    };
  });
  const totalScheduled = rows.reduce((sum, row) => sum + row.scheduled, 0);
  const totalWeight = rows.reduce((sum, row) => sum + row.weight, 0);
  if (rows.some((row) => !close(row.weight / totalWeight, row.scheduled / totalScheduled))) {
    issues.push("complete-case scheduled-cell pass@1 requires case weights proportional to scheduled eligible cells");
  }
  const expectedBound = caseWeightedIdentificationBounds(rows, (total, successes) => successes / total);
  if (!expectedBound) issues.push("identification bounds are not computable from the scheduled case counts and weights");
  else if (!close(bound.lower, expectedBound.lower) || !close(bound.upper, expectedBound.upper)) {
    issues.push(`complete-case bounds must be [${expectedBound.lower},${expectedBound.upper}]`);
  }
  const valid = rows.reduce((sum, row) => sum + row.scheduled - row.unresolved, 0);
  const successes = rows.reduce((sum, row) => sum + row.successes, 0);
  if (valid === 0) {
    if (result.estimate !== null || result.interval !== null || result.status !== "insufficient_evidence") {
      issues.push("zero valid observations require insufficient_evidence and null estimate and interval");
    }
  } else if (Number.isFinite(result.estimate) && !close(result.estimate, successes / valid)) {
    issues.push(`reported estimate must be ${successes / valid}`);
  } else if (result.status === "supported" || (result.decisionRuleResult === "fail"
    && selected.every((row) => row.statistics.some((entry) => entry.claimId === claim.id
      && entry.status === "supported" && Number.isFinite(entry.value))))) {
    if (!Number.isFinite(result.estimate) || result.interval === null) {
      issues.push("a threshold failure cannot erase the estimate and interval of supported component statistics");
    }
  }
  if (result.status === "supported" && result.decisionRuleResult !== "pass") {
    issues.push("a supported claim requires a passing decision rule");
  }
  return issues;
}
