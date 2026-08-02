# Scorecard Contract

- Status: unpublished working draft
- Version: 0.1.0
- Purpose: machine-interpretable experiment, trial, claim, metric, and
  provenance semantics.

The primary requirements defined here are `GATE-001`, `OUT-001`, and
`CLAIM-001`. This contract also supplies the scorecard projections and
reproduction algorithms explicitly invoked by primary requirements `STAT-001`,
`STAT-002`, and `STAT-003` in the
[Requirements Registry](requirements.md); it does not redefine them. A
scorecard reports measurement; it does not make a release or autonomy decision.

## Scorecard Layout

Machine-readable scorecards use `schemaVersion: agent-eval-scorecard-1`. One
scorecard represents one sealed experiment and contains:

1. experiment identity, `arms[]`, `caseProfiles[]`, cells, and
   `comparativeDesign` when applicable;
2. validity, gate coverage, and blocking governance statuses;
3. one trial result for each resolved cell and every physical attempt lineage;
4. `claims[]` and independently computed `claimResults[]`, both empty only for
   `diagnostic_run`;
5. metrics, costs, diagnostics, provenance, and canonical evidence references.

The immutable scorecard is the semantic-validation subject. It **MUST NOT**
embed its semantic-validation result. A separate signed
`validation-envelope-1` binds the scorecard's canonical digest as defined by
`EVID-002`.

A renderer **MUST** present validity, failed hard gates, open governance
statuses, unsupported claims, and coverage limits before aggregate metrics or a
composite.

## Experiment and Arms

The scorecard's `experiment` object **MUST** reproduce the sealed experiment ID,
manifest digest, suite and case-set identity, assurance level, intended use,
effective-risk range, `runMode`, `claimEligibility`, scheduled-cell commitment,
and start and close times.
Semantic validation **MUST** resolve
`experiment.scheduledSetCommitment` itself to an authenticated signed
`pre-run-manifest-1` and derive the sealed schedule, evaluator, profiles,
policies, and plans from that artifact. A fixture path, database lookup, or
other out-of-band related-record hint **MUST NOT** serve as the trust root. The
experiment, attempt-ledger, attempt-integrity, and provenance commitments
**MUST** identify that same pre-run subject.

Each `arms[]` entry **MUST** contain:

```text
arm.{id,label,treatmentRole,model,agentConfiguration,prompts,policies,
     harness,adapter,tools,permissions,budgets,retrieval,memory,
     agentVisibleProjection,environment,externalServices,identityDigest}
```

Arm IDs **MUST** be unique within the scorecard. Duplicate IDs are invalid even
when the complete arm objects differ.

Every component is an immutable ID/version/digest or an authenticated provider
identity with immutability evidence.

`caseProfiles[]` **MUST** contain exactly one binding for each scheduled case:
the case ID; effective evaluation-profile ID, digest, and
`effectiveProfileDigest`; and one outcome-profile ID, version, and digest. For
A1–A3 the outcome profile **MUST** be compatible with the effective evaluation
profile and the binding use is `claims_eligible`. For A0 the binding use is
`diagnostic_only`; it selects explicit measurement semantics without asserting
profile compatibility. Every cell references exactly one case ID and one arm ID and resolves
its measurement semantics through that case's binding. A case-profile binding
is measurement identity, not an arm component or treatment factor. An A0
binding makes diagnostic grading reproducible but is not evidence of case,
experiment, or suite conformance, and does not assert evaluation- or
outcome-profile compatibility.

For a multi-arm experiment, `comparativeDesign` **MUST** contain comparator arm
IDs, declared treatment bundle and digest, paired case or block IDs,
randomization or ordering, reset and carryover rules, interference controls,
one identical measurement-profile binding for each directly compared case/cell,
shared measurement-stack identity, hypotheses, and statistical-plan reference. Every
observed arm difference **MUST** be either in the treatment bundle or a sealed
design factor. Otherwise the affected direct-comparison claim is
`insufficient_evidence`.

## Gate Registry

Registry architecture: `core-gates-1` plus versioned evaluation-profile, risk, and case
registries.

`GATE-001` — These core gates apply to every completed trial:

| Gate ID | Required evidence | Failure effect |
| --- | --- | --- |
| `evidenceAuthenticity` | canonical evidence references, producer authorization, digests, attestations, and result-channel proof | invalid measurement when indeterminate; unsafe violation when attributed |
| `oracleIsolation` | projection manifest, access controls, network/session audit, and teardown evidence | invalid measurement or attributed unsafe violation |
| `isolatedExecution` | filesystem, process, identity, resource, egress, cache, and external-service enforcement | invalid measurement |
| `trustedMeasurementBoundary` | immutable snapshot, runner-owned graders/adjudication packaging, bounded parsers, and positive attack controls | invalid measurement or attributed unsafe violation |
| `attemptAccounting` | scheduled-cell commitment, complete signed ledger, lineage, and count reconciliation | invalid attempt integrity and affected claims insufficient |
| `permissionPolicy` | declared tool/data permissions, approvals, accesses, and prohibited-action audit | attributed violation is unsafe; missing audit is invalid |
| `dataAndRetentionPolicy` | access class, processor authorization, export, retention, and deletion controls | unsafe or invalid according to attribution |

A selected evaluation profile **MUST** add outcome-appropriate gates. Examples include
workspace build/test/security gates, review finding-quality gates, design
constraint-trace gates, operational rollback gates, and interactive
responsibility gates. An evaluation profile **MUST NOT** apply a code-build gate to a
non-build outcome unless the case requires a buildable artifact.

The sealed manifest **MUST** contain the expected union of core, evaluation-profile, risk,
and case gate IDs; registry versions and digests; applicability rules; and
allowed post-observation additions. Every gate registration **MUST** name a
`failureCauseId` from the bound failure taxonomy. Every gate result **MUST**
include status, applicability, backing evidence, trigger evidence, and that
failure-cause binding. A passing gate **MUST** have `failureCauseId: null`; every
failed or invalid gate **MUST** name exactly one ID that occurs in the same trial
result's authenticated `failureCauses` set and resolves through the bound
failure taxonomy. An unknown, duplicate, missing, or passenger cause binding is
invalid. The outcome profile, not the gate, assigns the one primary
outcome. Missing, unknown, unbacked, or indeterminate required gates fail closed.
A failed security or integrity check is a failure cause; it becomes
`unsafe_policy_violation` only when independent evidence attributes prohibited
behavior. The check result alone does not establish that attribution.

## Blocking Governance Status Registry

Governance statuses are orthogonal to hard gates, outcomes, claims, and decision
verdicts. The base registry includes:

| Status ID | Meaning |
| --- | --- |
| `security_review_required` | a sealed security boundary requires accountable disposition |
| `manual_review_required` | a sealed human-authorization boundary requires accountable disposition |
| `data_owner_review_required` | data access, processing, retention, or export requires owner disposition |
| `risk_acceptance_required` | residual risk exceeds the policy's automatic-acceptance boundary |

The manifest **MUST** seal expected status IDs and trigger rules. Each expected
status is `not_applicable`, `open`, `resolved`, or `waived` and links to trigger
evidence. `not_applicable` requires determinate evidence. `resolved` and
`waived` require disposition, authorized actor, timestamp, policy clause, and
canonical evidence. A waiver is valid only when the policy explicitly permits
that status, tier, scope, grounds, authority, and expiry.

## Validity Status

Trial `validity.status` is `valid` or `invalid`. It answers whether measurement
supports interpretation and attribution, not whether the arm succeeded.

An invalid trial **MUST** retain machine-readable reasons and primary outcome
`infra_failure`; it is excluded from valid-only point estimates but retained in
the ledger, cost coverage, unresolved-cell accounting, and identification
bounds. Attributed manipulation or policy violation is a valid
`unsafe_policy_violation` when evidence independently establishes attribution.
When the failed measurement path is required to establish attribution, the
trial is invalid instead.

Each physical attempt has `measurementValidity`:

- `valid` or `invalid` for a completed attempt;
- `not_assessable` for an interrupted or missing-capture attempt.

An invalid or not-assessable attempt resolves no cell unless a sealed eligible
replacement later supplies a valid trial.

## Claims

`CLAIM-001` — The scorecard contains a closed `claims[]`; each entry has a unique
ID. Each claim **MUST** declare:

```text
claim.{id,type,intendedDecision,construct,estimand,direction,
       successDefinition,analysisUnit,targetPopulation,samplingFrame,
       representedStrata,slice,weights,coverageGaps,assuranceLevel,
       effectiveRiskRange,exposureBoundary,evaluationProfile,outcomeProfiles,
       comparatorArmIds,
       threshold,confidenceLevel,statisticalPlan,decisionRule}
```

Supported types include `capability`, `reliability`, `comparative`, `quality`,
`safety`, `cost`, and `governance_evidence`. Evaluation profiles can add namespaced types.

For every claims-eligible run, the signed pre-run statistical plan **MUST**
contain exactly one `claimContracts[]` entry per primary or exploratory claim.
That entry seals, before observation, at least the claim ID and classification,
type, estimand, direction, success definition, analysis unit, threshold,
confidence level, minimum valid-trial count, case and arm scopes, and the exact
`{id,version,digest}` of its decision rule. The scorecard's corresponding
fields **MUST** match this contract exactly. A post-observation threshold,
scope, success-predicate, estimand, or decision-rule change is not a new result;
it is an unregistered analysis and yields `insufficient_evidence` for the
original claim.

A decision rule is an authenticated typed contract. Version `0.1.0` declares
an input (`estimate`, `lower_bound`, or `upper_bound`), `gte` or `lte`, whether
equality passes, and the fail-closed result for a missing input. The semantic
validator resolves the declared digest and executes that operator. It **MUST
NOT** infer an operator merely from a human-readable direction or rule ID.

For A0, `runMode` **MUST** be `diagnostic_run`, `claimEligibility` **MUST** be
`none`, and `claims[]` and `claimResults[]` **MUST** be empty. For A1–A3,
`runMode` **MUST** be `evaluation`, `claimEligibility` **MUST** be
`claims_eligible`, and `claims[]` **MUST NOT** be empty.
A0 trial and metric diagnostics **MUST NOT** be presented as positive claims or
as suite, case, experiment, evaluation-profile, outcome-profile, or decision
conformance evidence.

Each claim has exactly one `claimResults[]` entry with status `supported`,
`insufficient_evidence`, or `not_applicable`; reasons; eligible cell IDs;
claim-specific success assignments; point estimate; interval; identification
bounds; missingness; coverage; and decision-rule result. Trial results do not
carry claim status. One trial can count differently for distinct claims only
through their sealed success definitions.

Missing plans, unset required thresholds, material coverage gaps, unsupported
strata, expired evidence, exposure-budget breach, failed required auxiliary
evidence, unresolved-cell threshold breach, or unmet assumptions yield
`insufficient_evidence` for the affected claim.

## Primary Outcome Categories

`OUT-001` — Every selected trial has exactly one evaluation-profile-neutral primary
outcome:

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
- `unsafe_policy_violation` — independently attributed prohibited behavior;
- `infra_failure` — measurement cannot fairly interpret or attribute the result.

For an accepted `solved`, `correct_refusal`, or `already_satisfied` result, the
trial's `artifactIds` **MUST** resolve the selected outcome profile's exact
`terminalEvidenceRequirements` in `evidenceManifest`. Each required artifact
**MUST** carry the declared `artifactType`, satisfy its cardinality and URI-binding
rule, resolve to material bytes under `EVID-001`, and have a valid attestation.
A content digest without the required artifact type or without resolvable bytes
does not satisfy terminal evidence. Evidence-kind-specific structure,
applicability, and alternative-terminal rules belong only to the selected
outcome profile's authenticated replay contract.

### Priority Order

When conditions overlap, apply this order:

```text
unsafe_policy_violation > infra_failure > failed > partial >
no_relevant_result > already_satisfied > correct_refusal > solved
```

Outcome-profile-specific failure causes preserve detail such as build failure, hidden
acceptance failure, incorrect review finding, unsafe rollout step, budget
exhaustion, or missing required clarification. Causes are non-exclusive and
**MUST NOT** replace the primary outcome.

In particular, `build_fail`, `public_pass_hidden_fail`, `hidden_fail`,
`noop_irrelevant`, and equivalent profile-specific labels are failure causes or
diagnostic states, never primary outcomes.

### Assignment Rules

`correct_refusal` and `already_satisfied` **MUST** be registered before the
experiment and backed by outcome-profile evidence. Arm-authored prose alone is
untrusted input, not proof. An evaluation profile **MUST** specify how partial, failed, and
no-result categories are distinguished so equivalent evidence receives the same
classification.

The eight primary outcomes are normalized aggregation classes, not a profile's
user-facing vocabulary. Every outcome profile **MUST** register a closed
`nativeOutcomes[]` mapping; every native ID maps to exactly one primary outcome
and declares its closed allowed-substatus vocabulary. A trial **MUST** preserve
`profileOutcome {id, substatus}`. The scorecard validator **MUST** resolve that ID
exactly once in the cell's authenticated outcome profile, reproduce the primary
mapping, require one registered substatus when the native outcome declares any,
and otherwise require `null`. Normalization never
erases a profile-native review, release, incident, or design disposition.

### Scorecard projection for outcome profiles

The primary `OUTPROF-001` selection and compatibility requirement is defined in
the [core standard](standard.md#outcome-profiles). Its machine-readable scorecard
projection binds all classification inputs needed to reproduce a trial outcome
without free-text interpretation and contains:

- the closed `primaryOutcomeTaxonomy` in the order listed above;
- the closed profile-owned `nativeOutcomes` vocabulary, with one or more mappings
  for every primary outcome and an explicit allowed-substatus set for each native
  ID;
- one `outcomeRules` entry per primary outcome, with the interpreted terminal
  state, overlap priority, versioned condition contract, permitted evidence-mode
  IDs, and registered-alternative IDs;
- `validAlternatives` for every permitted `correct_refusal` and
  `already_satisfied` path, each with a versioned applicability contract;
- versioned `evidenceModes` that state the required evidence kinds;
- exact `gateRegistry` and `failureTaxonomy` bindings by ID, version, URI, and
  digest;
- `claimCompatibility`, including allowed claim types, primary outcomes eligible
  for functional and accepted predicates, and the effect of incompatibility;
- the base `functionalSuccess` and `acceptedOutcome` predicate bindings.

Outcome terminal states are interpreted classification states, distinct from an
attempt's execution terminal state. Every native outcome, substatus, evidence
mode, alternative, gate, and failure cause **MUST** resolve in the bound profile
artifacts. Unknown, duplicate, stale, or unbound references fail closed. A
failure taxonomy may map a cause to a default primary outcome, but the final
assignment still applies the sealed outcome rules and priority order. Claim
compatibility is claim-specific: an incompatible outcome is non-success for that
claim; it does not rewrite the trial's normalized or profile-native outcome.

Evidence-kind names are not claimant-defined labels. For every kind-bound
artifact, the distribution-owned replay executor **MUST** execute the semantic
contract authenticated for the selected outcome-profile ID. A kind from one
profile has no authority in another unless that profile independently registers
it. Unknown kinds, unresolved contracts, and wrong schema, subject, cell,
attempt, workspace, authority, or passenger artifacts **MUST** fail replay. The
base scorecard contract does not assign semantics to a bundled profile's
evidence-kind names.

## Successful, Functional, and Accepted Outcomes

This section is the sole normative definition of executable trial predicates.
Let `t` be a valid selected trial.

`functional-outcome-v1(t)` is true exactly when:

- `t.primaryOutcome` is `solved`, `correct_refusal`, or `already_satisfied` under
  its registered outcome profile;
- every applicable core, evaluation-profile, risk, and case hard gate passes;
- every material applicable decision surface passes, or has a sealed declared
  gap that restricts the relevant claims;
- transcript evidence is complete;
- interaction evidence is complete when `interactionModeId` is not
  `noninteractive_repository_task` and `not_applicable` only for that exact
  noninteractive mode;
- deterministic or expert-adjudication evidence required by the outcome profile is
  complete and valid.

A **successful outcome** satisfies `functional-outcome-v1`.

In version 0.1.0, `accepted-outcome-v1(t)` is true exactly when
`functional-outcome-v1(t)` is true and every expected governance status is
`not_applicable`. A `resolved` status remains false for this immutable trial
predicate and may support only a later, independently validated governance
decision through the signed resolution ledger. This version permits no waiver.
A declared gap does not change the trial predicate; it restricts named claims.

The only base executable predicate IDs are `functional-outcome-v1` and
`accepted-outcome-v1`. An evaluation-profile-specific predicate **MUST** use its namespace,
version, schema, verifier, and compatibility declaration. Free text cannot
resolve a cell.

For every resolved cell used by a claim, the scorecard **MUST** carry an
`outcomeReplay` binding to an executor selected from the verifier's installed,
distribution-owned registry. The verifier **MUST** authenticate the executor
bytes and independently execute the profile's outcome rule, evidence-mode
rules, `functional-outcome-v1`, and `accepted-outcome-v1`. Reported
`primaryOutcome`, `terminalState`, `functional`, `accepted`, success
assignments, statistics, outcome counts, and success-conditioned cost metrics
are projections to compare with replay output; none is an input authority.

When the selected outcome profile requires independently graded evaluated work,
replay uses three non-interchangeable roles. The evaluated arm's material work
product is captured and authenticated by the runner during execution; any
self-reported verdict in it is not grading truth. A separate grader assessment
derives structured facts from that product and the other terminal artifacts. A
separately authenticated replay receipt binds both exact digests and supplies
those grader facts to the pinned executor. Grader and receipt authority **MUST**
come from a non-claimant trust root configured outside the scorecard and receipt;
runner-capture authority is configured independently for the evaluated artifact.
A receipt-discovered key, executor, role string, or trust policy is not trust.
The conformance corpus's test receipt is explicitly `conformance_fixture_only`
and **MUST NOT** authorize an operational claim.
When no registered executor or independently authenticated grader-assessment
and receipt chain can reproduce the predicates, the cell and every dependent
result are diagnostic or `insufficient_evidence`; an implementation **MUST NOT**
copy claimant booleans as a fallback.

For `solved`, the replay's `materialArtifacts` keys **MUST** equal the exact
`workArtifactTypes` selected by the authenticated suite case. Every selected
type has nonempty, authenticated, semantically matching terminal evidence;
missing types, extra types, incompatible substitutions, and passenger hashes
fail closed. For `correct_refusal` and `already_satisfied`, ordinary material
mappings **MUST** be empty and the executor instead requires the exact registered
terminal-evidence set and applicability check. One evidence artifact may satisfy
more than one selected work-artifact type only when the profile-owned executor
independently derives every mapping from its bytes. An artifact of one selected
type cannot substitute for a different required type. A grader assessment or
replay receipt cannot substitute for the evaluated work product, and that work
product cannot substitute for either measurement artifact.

Acceptance is a trial predicate. A governance decision additionally evaluates
claim support, assurance, risk, cost, review burden, scope, and policy.

## Metric Families

Metrics are retained as separate families:

- outcome-profile metrics: outcome-profile conditions, terminal state, alternative
  validity, and evidence-mode verdicts;
- quality metrics: maintainability, design fit, review quality, test quality,
  documentation, operational readiness, and namespaced evaluation-profile measures;
- trajectory and decision-surface metrics;
- safety, security, data, and policy metrics;
- interaction, handoff, clarification, and responsibility metrics;
- economics: time, tokens, provider cost, CI or compute, expert review, repair,
  and total attempt cost;
- suite and measurement health.

Every decision-bearing metric **MUST** declare construct, unit, direction,
eligibility, denominator, aggregation, missingness, evidence, and versioned
calculation. Diagnostic metrics remain available for all attempts but influence
tuning or governance only through a sealed objective.

### Resource and Trajectory Telemetry

Raw resource and trajectory telemetry **MUST** be retained for every started
attempt, including failures, unsafe outcomes, and invalid measurement. Missing
values are null with reasons, never zero.

Keep these cost estimands distinct:

- `meanCostConditionalOnSuccess`: cost among valid
  `functional-outcome-v1` trials;
- `totalAttemptCostPerSuccess`: cost of every physical attempt in the declared
  slice divided by valid successful trials.

Each reports numerator, success count, attempt count, coverage, missing-cost
policy, bound, currency, and price-table provenance. Zero successes yield null
value, `insufficient_evidence`, reason `zero_success_denominator`, and retained
observed numerator.

Durations **MUST** use a monotonic clock and declare boundaries. Provider token
and turn fields **MUST** retain native definitions; incompatible definitions
**MUST NOT** be pooled. Tool counts **MUST** specify treatment of failed, denied,
retried, nested, and batched calls. Derived summaries **MUST NOT** replace the
runner-captured pre-transform event stream.

### Attempt-Integrity Fields

Cells have measurement states:

- `resolved`: the first eligible valid lineage member supplies a selected trial;
- `unresolved`: no eligible valid result exists at experiment close.

Success or failure is claim-specific and belongs in `claimResults[]`, not the
cell's measurement state.

Every physical attempt transitions exactly once through:

```text
scheduled -> started -> completed | interrupted | missing_capture
```

The scorecard binds:

```text
attemptIntegrity.{status,scheduledCells,resolvedCells,unresolvedCells,
  physicalAttemptCount,validAttempts,invalidAttempts,interruptedAttempts,
  missingCaptureAttempts,replacementAttempts,unresolvedCellRate,
  ratesByArmAndCase,scheduledSetCommitment,initialLedgerRoot,terminalLedgerRoot,
  externalAttemptCheckpoint}
```

The signed ledger **MUST** reconcile every transition, terminal attempt record,
parent lineage, artifact manifest, telemetry record, count, and root. The first
eligible valid lineage member resolves a cell; a later attempt **MUST NOT**
replace it or select a more favorable result.

For `agent-eval-attempt-ledger-1` version `0.1.0`, roots use
`sha256-jcs-chain-v1` over I-JSON/JCS values:

```text
initialLedgerRoot = SHA-256(JCS({experimentId, scheduledSetCommitment}))
root[0] = initialLedgerRoot
root[i + 1] = SHA-256(JCS({previousRoot: root[i], attempt: attemptRecords[i]}))
terminalLedgerRoot = root[attemptRecords.length]
```

The scorecard's attempt records and both roots **MUST** equal the authenticated
ledger. Its scheduled-set commitment **MUST** bind the signed pre-run manifest.
The pre-run retry policy fixes the maximum attempts per cell, retryable
measurement-validity states, a linear parent chain, first-valid selection, and
whether retry after a valid attempt is allowed. An unresolved pointer or an
unknown contract version fails closed; a validator cannot substitute an opaque
`artifact:` label for contract execution.

#### Independent attempt checkpoint

An internally consistent ledger is not sufficient: an evaluator able to delete
a failed attempt can recompute both roots, the ledger digest, and the scorecard
signature. Every dispatched physical attempt therefore **MUST** have an
`agent-eval-attempt-checkpoint-1` scheduler receipt issued by a trust boundary
authorized independently of the scorecard signer. A receipt binds its sequence,
experiment, scheduled-set digest, attempt and cell IDs, parent attempt, start
time, and predecessor receipt digest.

For `sha256-jcs-receipts-v1`:

```text
receiptDigest = SHA-256(JCS(receipt without receiptDigest and signature))
receiptSigningBytes = ASCII("agent-evals-attempt-receipt-1") || 0x00 ||
  UTF8(JCS(receipt with only signature.value omitted))
```

Sequences **MUST** start at one, be contiguous, and use the preceding receipt's
digest. The scheduler **MUST NOT** dispatch work before it durably appends the
corresponding receipt. After experiment close it **MUST** issue exactly one
terminal checkpoint for the scheduled-set commitment. The checkpoint binds:

- the external log ID, terminal sequence, predecessor checkpoint, and immutable
  publication URI;
- the complete signed receipt chain and its head;
- the exact ledger ID and digest;
- receipt count, ordered-attempt-ID digest, full attempt-record-array digest,
  initial ledger root, terminal ledger root, and close time.

The ordered-attempt-ID digest is `SHA-256(JCS(receipts.map(attemptId)))`; the
attempt-record digest is `SHA-256(JCS(ledger.attemptRecords))`. The checkpoint
digest and signature use:

```text
checkpointDigest = SHA-256(JCS(checkpoint without digest and signature))
checkpointSigningBytes = ASCII("agent-eval-attempt-checkpoint-1") || 0x00 ||
  UTF8(JCS(checkpoint with only signature.value omitted))
```

`attemptIntegrity.externalAttemptCheckpoint` **MUST** resolve this checkpoint.
Verification **MUST** obtain the authorized scheduler key and current terminal
`{logId, checkpointSequence, digest}` from externally configured trust and
append-only-log state, never from the scorecard alone. It **MUST** verify every
receipt and checkpoint signature, scheduler role and trust domain, scorecard
signer separation, contiguous receipt chain, ledger digest and roots, ordered
attempt identities, full records, counts, lineage fields, and time ordering.
Missing external trust or log-head state fails closed.

Deleting a failed attempt and recomputing or re-signing any evaluator-controlled
artifact **MUST** be rejected because it cannot change the independently signed
receipt chain and terminal checkpoint. The machine-readable checkpoint is
[`attempt-checkpoint.schema.json`](../schemas/attempt-checkpoint.schema.json).
The exported reference function `verifyAttemptLedgerCheckpoint` is in
[`verify-material-integrity.mjs`](../tools/verify-material-integrity.mjs); an
integration passes the resolved checkpoint, material ledger, scorecard
`attemptIntegrity`, scorecard signature, externally trusted scheduler keys, and
the externally resolved scorecard signer key and trust domain, plus the
externally observed log head. It treats every returned issue as invalid attempt
integrity. Signer separation compares authorization domains and resolved public
keys, not merely self-asserted key IDs.

### Conservative Bounds

For a binary positive claim, let `S` be scheduled eligible cells, `Y` observed
claim successes among resolved cells, and `U` unresolved cells. Without stronger
sealed assumptions, identification bounds are:

```text
lower = Y / S
upper = (Y + U) / S
```

For difference `A - B`, use
`[lower(A) - upper(B), upper(A) - lower(B)]`. A harm claim reverses favorable
direction. Bounds **MUST** use scheduled cells, never physical-attempt counts.

A different missingness model **MUST** be sealed before results and identify its
assumptions, covariates, estimand, sensitivity analysis, verifier, and failure
conditions. It **MUST** report the no-assumption bounds beside the modeled
estimate. Differential missingness by arm and case **MUST** be reported.

## Statistics Fields

For the scorecard projection of `STAT-001`, one trial of one case is
`descriptive_only` for reliability,
variance, or superiority. One sealed trial per many independently sampled cases
can estimate case-population pass@1 or a paired case-level contrast when the
sampling frame and independence assumptions support that estimand. Repeated
trials of the same case are required for within-case reliability, pass^k, and
other estimands that depend on rerun variation. Repeated-trial statistics
**MUST** report requested `k`, scheduled and valid counts, successes, estimator
ID, state-reset and dependence assumptions, value, interval, and reasons.

pass@k and pass^k/reliability@k **MUST** be computed per case under the sealed
sampling model and then aggregated with declared case weights. If eligible
repetitions are fewer than `k`, assumptions fail, or counts do not reconcile,
status is `insufficient_evidence` and value is null.

The registered `wilson-interval-procedure` version `0.1.0` uses the two-sided
standard-normal quantile `z = Φ⁻¹(1 - (1 - confidenceLevel) / 2)`. For `Y`
successes in `N > 0` valid binary trials, with `p = Y/N`, it returns:

```text
center = (p + z²/(2N)) / (1 + z²/N)
half   = z * sqrt((p(1-p) + z²/(4N))/N) / (1 + z²/N)
interval = [max(0, center-half), min(1, center+half)]
```

For example, `Y=1`, `N=1`, and confidence `0.95` gives approximately
`[0.20654931437723745, 1]`, not an illustrative or hand-selected lower bound.

For the scorecard projection of `STAT-003`, comparative results **MUST** use the
sealed comparative design,
paired case-level contrasts, arm-specific identification bounds, and case-aware
uncertainty. Multiple claims, slices, thresholds, or interim looks **MUST** use
the sealed multiplicity or hierarchical rule. Each result reports target
population, represented strata, weights, coverage gaps, effect size, interval,
minimum-information rule, and assumption checks.

## Composite Score

A scorecard contains either a composite or explicit `not_applicable`. A
composite is diagnostic only.

| Status | Meaning | Value |
| --- | --- | --- |
| `valid` | all sealed inputs are eligible and formula reproduces | number |
| `blocked` | an included trial has a hard-gate failure | null |
| `not_rankable` | no hard-gate failure, but population, comparability, evidence, or formula is inadequate | null |
| `not_applicable` | no composite was declared | null |

Formula, normalization, weights, input claims, population, and version **MUST**
be pinned. A blocked or not-rankable composite **MUST NOT** support ranking,
tuning selection, capability, release, or autonomy.

## Provenance Fields

The scorecard **MUST** bind:

- standard, requirements registry, scorecard, evaluation profile, policy, matrix, schema,
  and semantic-validation contract versions and digests;
- suite `evaluationProfiles[]`, effective-profile resolution and conflict
  reports, experiment `caseProfiles[]`, and outcome-profile versions and
  digests;
- experiment manifest, intended use, validity argument, suite, case set,
  exposure ledger, assurance level, and the exact authenticated
  `risk-assessment-1` identity and `effectiveRiskTier` sealed before execution;
- complete `arms[]` identities and `comparativeDesign`;
- expected and evaluated gate and governance-status registries;
- claims, statistical plans, decision-surface inventories,
  graders, expert-adjudication protocols, and calculation contracts;
- scheduled-set commitment, attempt ledger, raw transcripts, interactive
  ledgers, evidence manifest, and terminal roots;
- current Case QA and shared grader-validation evidence.

Every reference **MUST** resolve through canonical `evidence-artifact-1` records.
The scorecard's `effectiveRiskRange` is a profile eligibility boundary only. It
**MUST** contain the exact `effectiveRiskTier`, but it **MUST NOT** substitute for
the risk assessment or be interpreted as the observed tier. A governance
decision **MUST** bind the same risk-assessment identity and exact tier.
After close, the scorecard remains immutable. Later validation, governance
resolution, decision, renewal, expiry, suspension, and rollback artifacts bind
its digest externally and **MUST NOT** create a circular mutable link.
