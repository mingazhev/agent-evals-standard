# Scorecard Contract

- Status: unpublished 0.1.0 publication candidate
- Version: 0.1.0
- Purpose: machine-interpretable experiment, attempt, claim, and metric
  semantics.

The primary requirements defined here are `GATE-001`, `OUT-001`, and
`CLAIM-001`. This contract also supplies the scorecard projections and
reproduction algorithms explicitly invoked by primary requirements `STAT-001`,
`STAT-002`, and `STAT-003` in the
[Requirements Registry](requirements.md); it does not redefine them. A
scorecard reports measurement; it does not make a release or autonomy decision.

## Scorecard Layout

Machine-readable scorecards use `schemaVersion: agent-eval-scorecard-1`. One
scorecard represents one sealed experiment. Its identity and bindings are
`id`, `version`, `runManifest`, `attemptLedger`, and `caseQaRecords`, each
reference a `{path, commit, digest}` triple, and `statistics`
(`stat-defaults-v1` plus the overrides sealed in the run manifest). Arms,
cases, repetitions, retry policy, claim contracts, and statistics are sealed in
the run manifest and are not echoed here. The measurement fields are:

| Field | Content |
| --- | --- |
| `accounting` | per arm: `scheduledCells`, `physicalAttempts`, `validTrials`, `invalidAttempts`, `replacementAttempts`, `unresolvedCells` |
| `outcomes` | per arm: a count for each of the seven primary outcomes |
| `hardGateFailures` | `{armId, gateId, count}` rows |
| `perCase` | per case and arm: `scheduled`, `resolved`, `successes` |
| `metrics` | estimand, arm, comparator, case count, identification bounds, and interval |
| `claims` | claim `id`, `status`, `metricId`, `population`, `restrictions` |
| `governanceStatuses` | optional; `{id, status, evidence}` rows |
| `validity` | optional; `{status, reasons}` |
| `telemetry` | optional; per arm `tokens`, `costUsd`, `wallClockSeconds` |
| `decisionVerdict` | always `not_applicable`; a scorecard never decides |

Every count, per-case row, point estimate, bound, and interval **MUST** be
reproducible from the attempt ledger and the run manifest. The reproduction is
the semantic check; reported values are projections, never inputs. The
scorecard is immutable and **MUST NOT** embed its semantic-validation result;
any validation is a separate `validation-envelope-1` that binds its canonical
digest.

A renderer **MUST** present validity, failed hard gates, open governance
statuses, unsupported claims, and coverage limits before aggregate metrics.
Hard-gate results, primary outcomes, claim status, and decision verdict are
separate fields and never combine into one value.

## Gate Registry

`GATE-001` — These base gates apply to every completed attempt:

| Gate ID | Required evidence | Failure effect |
| --- | --- | --- |
| `evidenceAuthenticity` | evidence references, producer authorization, digests, and result-channel proof | invalid measurement when indeterminate; unsafe violation when attributed |
| `oracleIsolation` | projection, access controls, network/session audit, and teardown evidence | invalid measurement or attributed unsafe violation |
| `isolatedExecution` | filesystem, process, identity, resource, egress, cache, and external-service enforcement | invalid measurement |
| `trustedMeasurementBoundary` | immutable snapshot, runner-owned graders, bounded parsers, and positive attack controls | invalid measurement or attributed unsafe violation |
| `attemptAccounting` | complete hash-chained ledger, lineage, and count reconciliation | affected claims insufficient |
| `permissionPolicy` | declared tool/data permissions, approvals, accesses, and prohibited-action audit | attributed violation is unsafe; missing audit is invalid |
| `dataAndRetentionPolicy` | access class, processor authorization, export, retention, and deletion controls | unsafe or invalid according to attribution |

A selected evaluation profile **MUST** add outcome-appropriate gates, such as
workspace build/test/security gates, review finding-quality gates, or design
constraint-trace gates; it **MUST NOT** apply a code-build gate to a non-build
outcome unless the case requires a buildable artifact. The case's acceptance
checks add case gates.

`hardGateFailures` counts failed gates per arm. Missing, unknown, unbacked, or
indeterminate required gates fail closed. A failed gate does not itself assign
the primary outcome. A failed security or integrity check is a failure cause;
it becomes `unsafe_policy_violation` only when independent evidence attributes
prohibited behavior. The check result alone does not establish that
attribution.

## Governance Statuses

Governance statuses are orthogonal to hard gates, outcomes, claims, and decision
verdicts. The scorecard's optional `governanceStatuses` rows use these IDs:

| Status ID | Meaning |
| --- | --- |
| `security_review_required` | a security boundary requires accountable disposition |
| `manual_review_required` | a human-authorization boundary requires accountable disposition |
| `data_owner_review_required` | data access, processing, retention, or export requires owner disposition |
| `risk_acceptance_required` | residual risk exceeds the policy's automatic-acceptance boundary |

Each status is `not_applicable`, `open`, `resolved`, or `waived` and links to
evidence. `not_applicable` requires determinate evidence. `resolved` and
`waived` require disposition, authorized actor, timestamp, policy clause, and
evidence; a waiver is valid only when the operational policy explicitly permits
it. A scorecard at A2 or above **MUST** carry the rows its policy expects.

## Validity

`validity.status` is `valid` or `invalid` with machine-readable `reasons`. It
answers whether measurement supports interpretation and attribution, not
whether the arm succeeded.

An attempt whose measurement is invalid is an *invalid attempt* in `accounting`
and has no primary outcome (`RUN-002`, `STAT-002`). It is excluded from
valid-only point estimates but retained in the ledger, cost coverage,
unresolved-cell accounting, and identification bounds. Attributed manipulation
or policy violation is a valid `unsafe_policy_violation` when evidence
independently establishes attribution; when the failed measurement path is
required to establish attribution, the attempt is invalid instead.

Each physical attempt in the ledger is `valid`, `invalid`, or, for an
interrupted or missing-capture attempt, `not_assessable`. An invalid or
not-assessable attempt resolves no cell unless a sealed eligible replacement
later supplies a valid trial.

## Claims

`CLAIM-001` — The scorecard's `claims` is a closed list with unique IDs. Each
claim reports `id`, `status`, `metricId`, `population`, and `restrictions`.
Each claim's sealed contract in the run manifest **MUST** declare, before
observation:

```text
claim.{id,type,construct,estimand,direction,successDefinition,
       analysisUnit,population,threshold,confidenceLevel,armIds,
       comparatorArmIds,decisionRule,restrictions}
```

Supported types include `capability`, `reliability`, `comparative`, `quality`,
`safety`, `cost`, and `governance_evidence`; evaluation profiles can add
namespaced types. The scorecard's fields **MUST** match the sealed contract. A
post-observation threshold, scope, success-predicate, estimand, or
decision-rule change is not a new result; it is an unregistered analysis and
yields `insufficient_evidence` for the original claim.

Status is `supported`, `not_supported`, `insufficient_evidence`, or
`reported_only`. The case scope of every statistical claim is the complete case
set sealed in the run manifest; a subgroup with different case membership needs
its own sealed experiment. Claims may differ in construct, success definition,
or comparator arms.

A decision rule is a typed contract: an input (`estimate`, `lower_bound`, or
`upper_bound`), `gte` or `lte`, whether equality passes, and the fail-closed
result for a missing input. The validator **MUST NOT** infer an operator from a
direction or rule ID, substitute a sampling-interval endpoint, or fall back to
another field when input is missing. Identification bounds address unresolved
observations, not sampling uncertainty; a population-confidence claim still
requires the sealed uncertainty procedure under `STAT-003`.

At A0 the run manifest has no claims and the scorecard `claims` is empty; A0
diagnostics **MUST NOT** be presented as positive claims or as conformance
evidence. At A1 through A3, `claims` **MUST NOT** be empty.

Claim support and numerical computability are separate. A computable estimate
and interval **MUST** remain reported when a threshold fails or another
restriction yields `insufficient_evidence`. Missing plans, unset thresholds,
material coverage gaps, unsupported strata, exposure-budget breach, failed
required auxiliary evidence, unresolved-cell threshold breach, or unmet
assumptions yield `insufficient_evidence` for the affected claim.

## Primary Outcome Categories

`OUT-001` — Every valid selected trial has exactly one primary outcome from
this closed set of seven:

- `solved` — the outcome profile's required terminal evidence and applicable
  gates pass;
- `correct_refusal` — a registered safe refusal satisfies its deterministic or
  adjudicated refusal contract;
- `already_satisfied` — a registered base-state precondition passes and the arm
  introduces no harmful or unnecessary action;
- `partial` — the result advances the task but fails at least one required
  outcome condition;
- `failed` — the arm produces an assessable result that does not satisfy the
  task and is not a more specific category;
- `no_relevant_result` — the task requires action but no relevant result or
  appropriate refusal is produced;
- `unsafe_policy_violation` — independently attributed prohibited behavior.

An attempt whose measurement cannot fairly interpret or attribute the result is
not an eighth outcome: it is an invalid attempt with no primary outcome (see
[Validity](#validity)). `outcomes` counts valid trials only, so for each arm the
seven counts sum to `validTrials`.

Failure causes such as build failure, hidden acceptance failure, incorrect
review finding, unsafe rollout step, budget exhaustion, or missing required
clarification are non-exclusive diagnostics and **MUST NOT** replace the
primary outcome. `build_fail`, `public_pass_hidden_fail`, `hidden_fail`,
`noop_irrelevant`, and equivalent profile labels are never primary outcomes.

`correct_refusal` and `already_satisfied` **MUST** be registered before the
experiment and backed by outcome-profile evidence; arm-authored prose alone is
untrusted input. An evaluation profile **MUST** specify how partial, failed, and
no-result categories are distinguished so equivalent evidence receives the same
classification.

The seven outcomes are normalized aggregation classes, not a profile's
user-facing vocabulary. At A2 and above the outcome profile registers a closed
`nativeOutcomes` mapping to them, and normalization never erases a
profile-native review, release, incident, or design disposition. The primary
`OUTPROF-001` selection and compatibility requirement is defined in the
[standard](standard.md#outcome-profiles); an unknown, duplicate, stale, or
unbound outcome-profile reference fails closed.

## Successful, Functional, and Accepted Outcomes

This section is the sole normative definition of executable trial predicates.
Let `t` be a valid selected trial.

`functional-outcome-v1(t)` is true exactly when:

- `t`'s primary outcome is `solved`, `correct_refusal`, or `already_satisfied`
  under its outcome profile;
- every applicable hard gate passes;
- every material applicable decision surface passes, or has a declared gap that
  restricts the relevant claims;
- transcript evidence is complete;
- interaction evidence is complete when the case's interaction mode is not
  `noninteractive_repository_task`;
- deterministic or expert-adjudication evidence required by the outcome profile
  is complete and valid.

A **successful outcome** satisfies `functional-outcome-v1`.

`accepted-outcome-v1(t)` is true exactly when `functional-outcome-v1(t)` is
true and every expected governance status is `not_applicable`. A `resolved`
status remains false for this immutable trial predicate and may support only a
later, independently validated governance decision. Version 0.1.0 permits no
waiver. A declared gap does not change the trial predicate; it restricts named
claims.

Version 0.1.0 permits only `functional-outcome-v1` and `accepted-outcome-v1`
as executable `successDefinition` IDs. A new predicate requires a coordinated
contract, schema, and verifier revision. Cell resolution depends on measurement
validity and retry lineage, not on whether the trial satisfies a predicate.

The verifier **MUST** independently execute the outcome rules and both
predicates from authenticated evidence. Reported primary outcome, counts,
success assignments, statistics, and success-conditioned cost metrics are
projections to compare with that replay; none is an input authority. When the
outcome profile requires independently graded work, the evaluated arm's work
product (captured by the runner), the grader's assessment, and the replay record
are three non-interchangeable roles, and grader authority comes from a trust
root outside the scorecard. When no executor or authenticated chain can
reproduce the predicates, the cell and every dependent result are diagnostic or
`insufficient_evidence`; an implementation **MUST NOT** copy claimant booleans
as a fallback.

Acceptance is a trial predicate. A governance decision additionally evaluates
claim support, assurance, risk, cost, review burden, scope, and policy.

## Metric Families

Metrics are retained as separate families: outcome metrics, quality metrics,
trajectory and decision-surface metrics, safety and policy metrics,
interaction and handoff metrics, economics (time, tokens, provider cost,
compute, expert review, repair), and measurement health. Every decision-bearing
metric **MUST** declare construct, unit, direction, eligibility, denominator,
aggregation, missingness, evidence, and versioned calculation. Diagnostic
metrics influence tuning or governance only through a sealed objective.

### Resource and Trajectory Telemetry

Raw resource and trajectory telemetry **MUST** be retained for every started
attempt, including failures, unsafe outcomes, and invalid measurement; the
scorecard's optional `telemetry` rows summarize `tokens`, `costUsd`, and
`wallClockSeconds` per arm. Missing values are null with reasons, never zero.
Keep two cost estimands distinct:

- `meanCostConditionalOnSuccess`: cost among valid `functional-outcome-v1`
  trials;
- `totalAttemptCostPerSuccess`: cost of every physical attempt divided by valid
  successful trials.

Zero successes yield a null value, `insufficient_evidence`, reason
`zero_success_denominator`, and the retained observed numerator. Durations
**MUST** use a monotonic clock and declare boundaries; incompatible provider
token or turn definitions **MUST NOT** be pooled.

### Attempt Accounting

Cells are `resolved` (the first eligible valid lineage member supplies the
selected trial) or `unresolved` (no eligible valid result at close). Every
physical attempt transitions exactly once through:

```text
scheduled -> started -> completed | interrupted | missing_capture
```

`started` is scheduler dispatch, before workspace materialization. A captured
setup failure closes as `completed` with invalid measurement; an interrupted or
uncaptured dispatch closes as `interrupted` or `missing_capture` with
`not_assessable` measurement; a never-dispatched cell stays unresolved without
an invented attempt. The `accounting` rows **MUST** reconcile to the attempt
ledger: every transition, lineage link, count, and root. The first eligible
valid lineage member resolves a cell; a later attempt **MUST NOT** replace it
or select a more favorable result.

For `agent-eval-attempt-ledger-1`, roots use `sha256-jcs-chain-v1` over
I-JSON/JCS values:

```text
initialLedgerRoot = SHA-256(JCS({experimentId, scheduledSetCommitment}))
root[0] = initialLedgerRoot
root[i + 1] = SHA-256(JCS({previousRoot: root[i], attempt: attemptRecords[i]}))
terminalLedgerRoot = root[attemptRecords.length]
```

The run manifest's replacement policy fixes the maximum attempts per cell,
retryable measurement-validity states, a linear parent chain, first-valid
selection, and whether retry after a valid attempt is allowed. The ledger is
committed to version control and protected from history rewrites under the
[integrity model](evidence-and-validation-contract.md#integrity-model);
deleting a failed attempt is a visible history rewrite, not a silent
recomputation.

### Conservative Bounds

Identification bounds describe uncertainty from unresolved observations. They
are separate from sampling confidence intervals; reporting one does not satisfy
a requirement to report the other.

Identification bounds **MUST** reproduce the claim's declared statistic and case
weighting. For each case and arm, let `S_c` be scheduled eligible cells, `Y_c`
observed claim successes, and `U_c` unresolved cells. Evaluate the per-case
statistic `f_c` twice, assigning all unresolved cells failure and then success,
and aggregate with the same nonnegative normalized case weights `w_c`:

```text
lower = sum_c w_c * f_c(S_c, Y_c)
upper = sum_c w_c * f_c(S_c, Y_c + U_c)
```

The `metrics` entry reports these as `identificationBounds.failureEndpoint` and
`identificationBounds.successEndpoint`. The endpoint assignments apply to binary
success statistics monotone in successes, including pass@k and reliability@k.
If a case lacks the scheduled repetitions its statistic requires, or the
statistic or weighting cannot be reproduced, the bound is not computable and
the affected claim is `insufficient_evidence`. Pooled `Y / S` and
`(Y + U) / S` are equivalent only for pass@1 with case weights proportional to
scheduled eligible cells; they **MUST NOT** substitute for other weights or for
`k > 1`. For difference `A - B`, compute each arm's bounds first, then use
`[lower(A) - upper(B), upper(A) - lower(B)]`. Bounds **MUST** use scheduled
cells, never physical-attempt counts. A different missingness model **MUST** be
sealed before results, **MUST** report the no-assumption bounds beside the
modeled estimate, and **MUST** report differential missingness by arm and case.

## Statistics Fields

For the scorecard projection of `STAT-001`, one trial of one case is
`descriptive_only` for reliability, variance, or superiority. One sealed trial
per many independently sampled cases can estimate case-population pass@1 or a
paired case-level contrast when the sampling frame and independence assumptions
support that estimand. Repeated trials of the same case are required for
within-case reliability, pass^k, and other estimands that depend on rerun
variation. Repeated-trial statistics **MUST** report requested `k`, scheduled
and valid counts, successes, estimator, state-reset and dependence assumptions,
value, interval, and reasons. The `metrics` `estimand` values are `pass_at_1`,
`pass_hat_k`, and `paired_difference_pass_at_1`; the interval `method` is
`wilson`, `t_over_cases`, or `t_over_paired_differences`.

pass@k and pass^k are computed per case under the sealed sampling model, then
aggregated with declared case weights. If eligible repetitions are fewer than
`k`, assumptions fail, or counts do not reconcile, status is
`insufficient_evidence` and the value is null.

The `wilson` interval at confidence level `L` uses the two-sided standard-normal
quantile `z = Φ⁻¹(1 - (1 - L) / 2)`. For `Y` successes in `N > 0` valid binary
trials, with `p = Y/N`:

```text
center = (p + z²/(2N)) / (1 + z²/N)
half   = z * sqrt((p(1-p) + z²/(4N))/N) / (1 + z²/N)
interval = [max(0, center-half), min(1, center+half)]
```

For example, `Y=1`, `N=1`, and `L=0.95` gives approximately
`[0.20654931437723745, 1]`, not a hand-selected lower bound.

For the scorecard projection of `STAT-003`, comparative results **MUST** use the
sealed comparative design, paired case-level contrasts, arm-specific
identification bounds, and case-aware uncertainty. Multiple claims, thresholds,
or interim looks **MUST** use the sealed multiplicity rule. Each result reports
population, effect size, interval, and assumption checks.

## Composite Score

A composite, if reported, is diagnostic only. A composite whose included trials
have a hard-gate failure, or whose population, comparability, evidence, or
formula is inadequate, is blocked or not rankable and **MUST NOT** support
ranking, tuning selection, capability, release, or autonomy. Formula,
normalization, weights, input claims, population, and version **MUST** be
pinned.

## Provenance

The scorecard's provenance is its run manifest: standard version and commit,
arms, cases, profiles, policies, claim contracts, statistics, and every other
sealed identity are bound there, and the scorecard references that manifest, the
attempt ledger, and the Case QA records by `{path, commit, digest}`. Every
reference **MUST** resolve at its commit to bytes matching its digest. After
close, the scorecard remains immutable; later validation, governance
resolution, decision, renewal, expiry, suspension, and rollback artifacts bind
its digest externally and **MUST NOT** create a circular mutable link.
