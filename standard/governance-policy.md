# Governance Policy Contract and Non-Operational Template

- Status: unpublished 0.1.0 publication candidate; bundled policy instance is non-operational
- Version: 0.1.0
- Owner: adopter-defined; a conforming policy instance requires a resolvable
  team identifier or email before any held-out, release, or autonomy decision.
- Scope: risk classification for every evaluation case and pre-registered
  decision rules for autonomy, release, and risk-acceptance decisions that cite
  `agent-evals` scorecards.

This document defines the required policy shape and a fail-closed template. It
is not an operational policy instance and intentionally defines no approval
thresholds. It does reproduce the non-weakenable `ASSURE-001` assurance floors;
those are standard invariants, not adopter approval thresholds. Any governance
decision **MUST** cite a versioned adopter-owned policy instance before the
held-out or release run begins. A scorecard contract or this template cannot
substitute for that policy instance.

## Risk-Tier Taxonomy

Before the trial, execute the authenticated derivation policy over every
`risk-assessment-1` factor and seal exactly one `effectiveRiskTier` for the
experiment and decision envelope. Potential harm is one input, not the whole
classification. The tier determines required gates, permitted tools, review,
retention, and release criteria. When multiple criteria or an uncertainty
boundary apply, use the highest applicable tier. The profile
`effectiveRiskRange` is only an eligibility boundary and cannot supply this
tier. A
downgrade is prohibited by this stub because all four tiers currently produce
the same `insufficient_evidence` decision and define no differentiated gates,
permissions, review, retention, or release effect. A future non-stub version
**MAY** permit a documented pre-run exception only after defining those
differences, permitted grounds, original and new tiers, scope, expiry,
supporting evidence, and an independent approver. The tier **MUST NOT** change
after results are observed. The following identifiers are non-waivable: every
`core-gates-1` gate; `productionCredentialsProhibited`;
`heldOutLeakage`; `measurementBoundaryCompromise`;
`irreversibleCriticalOperation`; `approvedConfigurationChanged`;
`assuranceEvidenceMissing`. Unknown identifiers are non-waivable until a
versioned policy classifies them. An operational policy **MAY** authorize overrides
only from an explicit allowlist; free-text requirements are never implicitly
overridable.

Baseline hard gates are non-compensable and non-waivable for every tier. A
failed or unevaluated baseline hard gate **MUST** block acceptance, ranking,
autonomy expansion, and every positive governance claim. An independent Case
QA invalidation **MAY** quarantine a defective case or evaluator, but it **MUST
NOT** convert the original failed run into a pass; a new sealed run is REQUIRED.

- `low` — a local, readily verifiable change with no sensitive data,
  authentication boundary, deployment, or security impact;
- `medium` — user-visible behavior, a public API or contract, a dependency
  upgrade, or a change that can create material review or rollback cost;
- `high` — sensitive data, an authentication, payment, or security boundary,
  migrations, cross-component behavior, or substantial blast radius;
- `critical` — production secrets, irreversible or destructive operations,
  regulatory exposure, privilege escalation, broad data exposure, or a change
  that cannot be accepted safely without explicit governance.

Case metadata and scorecard provenance record the policy version. A taxonomy
change requires a new version and a documented migration. Results produced
under different taxonomy versions **MUST NOT** be silently combined in risk-tier
slices.

## Required Decision-Rule Schema

For each risk tier, the policy version used for a decision **MUST** define:

- an immutable pre-run decision-plan ID, hash, and timestamp;
- pinned versions of the base standard, Scorecard Contract, governance
  policy, and suite;
- the closed `minimumAssuranceByDecision` values for `capability_claim`,
  `release`, `autonomy`, and `risk_acceptance`, each no lower than the
  `ASSURE-001` base floor;
- required case-set membership (`held-out`; `development` and `smoke` are not
  governance-eligible) and, for longitudinal claims, the frozen-slice IDs;
- required pass^k/reliability@k and/or pass@k;
- the confidence-interval method and minimum sample size;
- the pre-registered statistical-plan digest, target population, sampling frame
  and unit, primary and exploratory claims, power or minimum-sample rule,
  multiplicity control, sequential-look schedule and stopping rule, and held-out
  exposure and reuse budget;
- zero-tolerance hard gates;
- the expected blocking-governance-status set, trigger rules, and hash;
- terminal-state requirements for every expected governance status;
- acceptable review burden and a cost ceiling;
- transcript-review sampling frame, minimum quota, reviewer independence, and
  adjudication rule;
- a measurement-maintenance schedule: baseline reconstruction cadence and
  event triggers; suite-health cadence and event triggers; transcript-audit
  cadence; and risk-tier Case QA review SLAs;
- unresolved-cell-rate and differential-unresolved-cell-rate thresholds and the named
  conservative-bound method;
- approve, reject, and insufficient-evidence conditions;
- the required approver and security approver, where applicable;
- rollback or scope-reduction conditions;
- the exact approval envelope: configuration hash; task, risk, repository, and
  environment scope; target population and represented strata; exclusions and
  coverage gaps; permitted tools and autonomy; effective date; and expiry;
- exception and waiver authority, separation of duties, and non-waivable
  boundaries;
- the required lifecycle for blocking statuses: original finding,
  `not_applicable/open/resolved/waived` state, disposition, resolver, evidence,
  and timestamp;
- the pinned [escalation-event registry](#escalation-and-stop-matrix) version and
  hash;
- maximum approval lifetime by risk tier and UTC
  `effectiveAt < reviewAt <= expiresAt` timestamps;
- incompatible-role rules and stable identities for evidence producer,
  operator, status resolver, waiver authority, ordinary approver, security
  approver, risk owner, and rollback verifier;
- incompatible-role rules also covering every decision-affecting interactive
  requester, simulator, human, or helper and the post-decision assurance owner;
- the version-controlled governance record in which post-run status
  resolutions, waivers, expiry, and revocations are appended.
- an immutable post-decision assurance-plan ID, version, hash, and approval;
- material-change triggers covering model, agent configuration, prompt,
  harness, adapter, tool schema and implementation, permissions, environment,
  profile, grader, retrieval, and application scope;
- production monitoring signals with schema-bound, versioned, digest-pinned
  signal, calculation, threshold, sequential-look, and action contracts;
- when offline-to-production concordance is claimed, its estimand, matched
  population and linkage, unit, lag, censoring, missingness, selection treatment,
  estimator, uncertainty, calibration or drift rule, and validation window;
- a typed sampling schedule with a schema-bound, versioned, digest-pinned
  contract and verifier;
- for each sampling schedule: target population, frame, cadence, window, UTC
  anchor, first half-open window, alignment rule, lateness, missingness, and
  minimum sample;
- for each sampling schedule: accountable owner, SLA, lawful collection basis,
  access class, privacy/IP restrictions, evidence retention, deletion or legal
  hold, and the claim effect of evidence expiry;
- an explicit claim-effect mapping for review, narrowing, suspension, and
  revocation, including `suspend` when required assurance evidence is missing;
- rollback, stop, revalidation, and resume conditions for every assurance
  trigger.

## Risk-Tier Table

The assurance column is fixed by the base standard. Every other unset value
keeps this bundled template non-operational and every governance result at
`insufficient_evidence`.

| Risk tier | Minimum assurance by decision (`capability/release/autonomy/risk acceptance`) | Required reliability | Zero-tolerance gates | Required reviews | Decision rule |
| --- | --- | --- | --- | --- | --- |
| low | A1 / A2 / A3 / A3 | unset | unset | unset | insufficient_evidence |
| medium | A1 / A2 / A3 / A3 | unset | unset | unset | insufficient_evidence |
| high | A3 / A3 / A3 / A3 | unset | unset | unset | insufficient_evidence |
| critical | A3 / A3 / A3 / A3 | unset | unset | unset | insufficient_evidence |

The operational policy schema rejects a lower base value. Semantic validation
also rejects duplicate or missing tier rules, a minimum that decreases as risk
rises, `release` below `capability_claim`, or `autonomy`/`risk_acceptance` below
`release`. Unknown policy or decision-class values fail closed.

## Eligibility Rules

- Smoke-set scorecards are never governance-eligible.
- Scorecards from the `development` set are not evidence for release or
  autonomy decisions.
- Any blocking governance status makes the immutable 0.1.0 trial predicate
  `accepted-outcome-v1` false. An authorized resolution and its required
  enforcement receipt may make a later governance decision eligible through
  the hash-chained resolution ledger; they do not rewrite the closed scorecard.
- A `waived` trial status never counts as closed in version 0.1.0. Without
  structured resolution evidence, a purported resolution remains `open` for
  every governance decision.
- This version authorizes no waiver for any status or risk tier. Silence is a
  denial, not permission. A future authorization **MUST** identify the exact
  status, tier, authority, permitted grounds, evidence, scope, and expiry.
- The approver and any required security approver **MUST** be independent of the
  experiment operator, case author, and evidence producer for ordinary
  approvals as well as overrides. For `high` and `critical` decisions, ordinary
  and security approvers are distinct people; neither **MAY** be the risk owner,
  waiver authority, status resolver, or rollback verifier. Every resolution,
  waiver, renewal, and rollback verification records a role-conflict check.
- No ordinary or security approver, risk owner, waiver authority, status
  resolver, or rollback verifier **MAY** also be a decision-affecting interactive
  actor or assurance-evidence producer for that decision. Stable IDs are
  cross-checked across the case protocol, evidence manifest, assurance plan,
  and decision record.
- A decision becomes ineffective at its UTC expiry timestamp. Reaching the UTC
  review timestamp blocks new acceptance, renewal, and scope expansion but does
  not revoke already-authorized execution before expiry unless the operational
  policy says so. The required independent review renews, narrows, rejects, or
  lets the decision expire; neither timestamp is informational metadata.
- Rollback and scope-reduction conditions are sealed in the pre-run decision
  plan. A decision record **MAY** cite and apply them but **MUST NOT** invent them after
  observing results.
- Thresholds **MUST NOT** be selected or edited after inspecting the run output
  they will judge.
- The run scorecard is immutable at run close. Later status resolutions,
  waivers, expiry, narrowing, renewal, rollback, and supersession are appended
  to the adopter's version-controlled governance record under the
  [integrity model](evidence-and-validation-contract.md#integrity-model).
  Decision records reference the immutable scorecard rather than mutating it.

## Escalation, Enforcement, and Resolution

Every escalation trigger is one of the closed events in the
[escalation-event registry](#escalation-and-stop-matrix). Its claim effect,
governance status, stop action, scope action, and waivability are fixed by the
registry; an operational policy assigns owner and SLA and **MUST NOT** change
the tuple. A trigger **MUST** be recorded as an open event, committed before
any resolution, with its observed facts, evidence, affected scope, and owner.
The stop and scope actions **MUST** be executed and their execution recorded
with executor, time, and outcome before the event may be resolved; asserted
intent is not enforcement. A resolution is a later committed record that cites
the open event, the corrective evidence, the authorized resolver, and the
terminal disposition; it never rewrites the event. Events the registry marks
non-waivable **MUST NOT** resolve as `waived`. Version 0.1.0 fixes these
semantics but publishes no event, receipt, or ledger schema; the adopter's
governance record is a version-controlled directory of such records.

## Post-Decision Assurance

Approval is conditional on the continued applicability of the evidence, not a
permanent property of an agent label. The decision record binds the sealed
assurance plan and its exact approved envelope. A material change triggers
revalidation or revocation for the affected scope; nominal version equality is
not evidence that behavior is unchanged.

The operational policy **MUST** define production monitoring that is observable
without treating user harm as an experiment. Monitoring signals detect a
breach or distribution change; by themselves they **MUST NOT** be described as
offline-to-production concordance or as proof that the offline evaluation
predicts production outcomes. Sampling, uncertainty, multiplicity, sequential
looks, thresholds, and actions **MUST** be pre-registered.

A measured offline-to-production concordance claim additionally **MUST** define
its estimand; offline and production units; target and matched populations;
linkage; observation lag; censoring, missingness, selection, and intervention
treatment; estimator; uncertainty; calibration or drift rule; and validity
window. Unmatched telemetry or a threshold alert cannot satisfy that claim.

Missing, delayed, unauthenticated, expired, unlawfully collected, or materially
incomplete required evidence triggers `assuranceEvidenceMissing` and suspends
the affected approval. Every expected monitoring window is recorded as an
observation in the governance record, including the plan hash, scope, signal,
sample, estimate, uncertainty, sequential-look index, threshold, verdict,
producer, reviewer, and canonical evidence references. Monitoring and later
evidence **MUST NOT** rewrite the original run or decision rationale.

All evidence and validation references follow the
[Evidence and Detached Validation Contract](evidence-and-validation-contract.md),
including its [integrity model](evidence-and-validation-contract.md#integrity-model).

## Escalation and Stop Matrix

- Status: unpublished 0.1.0 publication candidate; bundled matrix instance is non-operational
- Version: 0.1.0
- Owner: adopter-defined; a conforming matrix instance requires a resolvable
  team identifier or email before any held-out, release, or autonomy decision.
- Storage: the adopter policy instance **MUST** name the version-controlled
  governance record in which events and their resolutions are committed.

The canonical closed event registry is
[`escalation-event-registry.json`](escalation-event-registry.json). Its 22
records bind each event ID to exactly one claim effect, governance status, stop
action, scope action, and waivability value. The table below is the readable
rendering of that registry; an operational matrix or event with a different
tuple is invalid. The registry `digest` is SHA-256 over its RFC 8785 canonical
JSON projection with `digest` omitted.

Every operational instance uses the following typed columns. `Event ID`, claim
effect, governance status, stop action, and scope action are separate
namespaces; no cell **MAY** substitute one for another. The instance binds the
registry tuple and fills owner, SLA, trigger contract, evidence, terminal
disposition, and resume conditions.

| Event ID | Trigger | Claim effect | Governance status | Stop action | Rollback/scope action | Waivable | Owner | SLA | Required evidence | Terminal disposition | Resume condition |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `hardGateRegression` | a baseline or declared hard gate fails | `insufficient_evidence` for positive governance claim | `manual_review_required` | `close_run` | `reject_or_reduce` | `false` | unset | unset | failing scorecard, diff, gate evidence | not applicable while open | preserve the agent regression; quarantine only after independent Case QA invalidation proves a case/evaluator defect, then use a new sealed run |
| `untriagedCriticalScannerFinding` | untriaged high/critical finding | `insufficient_evidence` | `security_review_required` | `block_acceptance` | `reject_or_reduce` | `true` | unset | unset | scanner report and triage artifact | not applicable while open | independent security disposition in the resolution ledger |
| `heldOutLeakage` | any held-out oracle exposure | `insufficient_evidence` | `security_review_required` | `stop_governance_use` | `revoke_affected_scope` | `false` | unset | unset | incident, exposure-path inventory, access/session revocation, root cause, historical-claim analysis | not applicable while open | containment and state reset across caches, sessions, indexes, and providers; case rotation; new conforming held-out run |
| `escapedCriticalDefect` | escaped high/critical production defect | `insufficient_evidence` | `manual_review_required` | `freeze_scope` | `rollback_or_reduce` | `true` | unset | unset | incident and new/updated case | not applicable while open | mitigation verified on a new sealed held-out run |
| `repeatedReviewRejection` | sealed rejection threshold breached | `insufficient_evidence` | `manual_review_required` | `block_scope_expansion` | `retain_or_reduce` | `true` | unset | unset | sampled reviews and reasons | not applicable while open | approved rubric/profile/case update and new sealed run |
| `staleMeasurement` | suite or Case QA expiry/staleness | `insufficient_evidence` | `manual_review_required` | `block_acceptance` | `retain_valid_only` | `true` | unset | unset | staleness and affected-case report | not applicable while open | revalidation or retirement recorded |
| `measurementErrorThreshold` | FP/FN threshold breached | `insufficient_evidence` | `manual_review_required` | `block_metric` | `reduce_affected` | `true` | unset | unset | audit sample, interval, threshold, adjudication | not applicable while open | recalibration, Case QA, and new evidence |
| `suiteHealthDegradation` | sealed suite-health threshold breached | `insufficient_evidence` | `manual_review_required` | `block_suite` | `reduce_affected` | `true` | unset | unset | versioned report and affected-case list | not applicable while open | breach closed; invalid QA records quarantined atomically; re-QA complete |
| `decisionExpired` | UTC expiry reached | `not_applicable` to new use | `manual_review_required` | `revoke_approval` | `revoke_expired` | `false` | unset | unset | decision and expiry evidence | not applicable while open | new decision under a new pre-run plan |
| `reviewDue` | UTC review timestamp reached | `insufficient_evidence` for renewal/expansion | `manual_review_required` | `block_renewal_expansion` | `continue_until_expiry` | `false` | unset | unset | review-due event | not applicable while open | independent renewal, narrowing, rejection, or expiry |
| `measurementBoundaryCompromise` | authenticated measurement boundary is compromised | `insufficient_evidence` | `security_review_required` | `stop_governance_use` | `revoke_affected_scope` | `false` | unset | unset | incident, trust-domain evidence, affected-run analysis | not applicable while open | root cause closed, credentials/keys rotated, boundary revalidated, new sealed run |
| `irreversibleCriticalOperation` | critical irreversible operation is proposed or observed | `insufficient_evidence` | `security_review_required` | `block_acceptance` | `reject_or_reduce` | `false` | unset | unset | operation plan, blast-radius evidence, explicit authority | not applicable while open | only a new policy-compliant decision is permitted to proceed; the trigger itself is never waived |
| `productionCredentialsProhibited` | production credential use or exposure is observed | `insufficient_evidence` | `security_review_required` | `stop_governance_use` | `revoke_affected_scope` | `false` | unset | unset | credential incident and revocation evidence | not applicable while open | revoke/rotate credentials, contain exposure, review historical results, new sealed run |
| `approvedConfigurationChanged` | a material change crosses the sealed approval envelope | `insufficient_evidence` for changed scope | `manual_review_required` | `block_changed_scope` | `revalidate_or_revoke` | `false` | unset | unset | old and new component digests, change classification, affected-scope analysis | not applicable while open | equivalence evidence or a new conforming run and decision for the changed scope |
| `productionMonitoringBreach` | a sealed production monitoring threshold or sequential rule is breached | `insufficient_evidence` for affected scope | `manual_review_required` | `suspend_approval` | `narrow_suspend_or_revoke` | `false` | unset | unset | canonical sampled evidence, estimate, uncertainty, look index, threshold/rule, affected-scope analysis | not applicable while open | breach disposition, verified mitigation, and policy-required revalidation or new run |
| `productionConcordanceDegraded` | the pre-registered measured offline-to-production concordance estimand breaches its calibration or drift rule | `insufficient_evidence` for the concordance claim and affected scope | `manual_review_required` | `suspend_approval` | `narrow_suspend_or_revoke` | `false` | unset | unset | matched population/linkage evidence, lag/censoring/missingness treatment, estimate, uncertainty, sequential rule, affected-scope analysis | not applicable while open | valid new concordance evidence, verified mitigation, and policy-required revalidation |
| `assuranceEvidenceMissing` | required assurance evidence is missing, late, unauthenticated, or materially incomplete | `insufficient_evidence` for affected scope | `manual_review_required` | `suspend_approval` | `narrow_suspend_or_revoke` | `false` | unset | unset | missing-evidence inventory, collection audit, affected-scope analysis | not applicable while open | authenticated complete evidence and independent review; otherwise revalidation or revocation |
| `suspectedContamination` | a pre-registered probe detects anomalous reference-only or exposure evidence without authenticated proof | `insufficient_evidence` for affected clean-slice claims | `security_review_required` | `stop_governance_use` | `quarantine_affected` | `false` | unset | unset | probe contract, controls, repetitions, statistic, threshold, exposure/reuse ledger, affected-scope analysis | not applicable while open | independent disposition on fresh evidence; unresolved suspicion remains quarantined |
| `confirmedContamination` | authenticated canary, access record, provider evidence, or equivalent provenance proves protected-oracle access | `insufficient_evidence` for affected clean-slice and historical claims | `security_review_required` | `stop_governance_use` | `revoke_affected_scope` | `false` | unset | unset | exposure path, authenticated provenance, state-reset evidence, historical-claim analysis | not applicable while open | containment, case rotation, state reset, and a new conforming held-out run |
| `privacyIpRetentionBreach` | evidence violates authority, purpose, access, privacy, IP, residency, retention, deletion, or legal-hold policy | `insufficient_evidence` for dependent claims | `security_review_required` | `stop_governance_use` | `quarantine_or_delete_affected` | `false` | unset | unset | incident, affected-artifact manifest, authority and disposition evidence, claim-dependency analysis | not applicable while open | lawful disposition, containment, independent review, and replacement evidence or claim revocation |
| `dataOwnerReviewRequired` | a sealed data-access, processing, retention, or export rule requires owner disposition | `insufficient_evidence` for affected governance use | `data_owner_review_required` | `block_acceptance` | `reject_or_reduce` | `false` | unset | unset | original data request, authority, purpose, scope, and data-owner disposition | not applicable while open | policy-authorized data-owner resolution for the exact request and scope; no waiver |
| `riskAcceptanceRequired` | residual risk exceeds the sealed automatic-acceptance boundary | `insufficient_evidence` for affected governance use | `risk_acceptance_required` | `block_acceptance` | `reject_or_reduce` | `false` | unset | unset | residual-risk assessment and independent risk-acceptance authorization | not applicable while open | policy-authorized risk-acceptance resolution for the exact risk and scope; no waiver |

All `unset` owner or SLA values are deliberate blockers, including the expiry,
review, and assurance rows. Every registry action remains normative; the
adopter **MUST** assign a concrete owner and SLA before an operational decision
can cite this matrix.

### Event lifecycle

Open event, enforced action, then resolution, each a separately committed
record that cites its predecessor and never rewrites it. The complete rules are
in the [Governance Policy](#escalation-enforcement-and-resolution).

Baseline hard-gate events and every identifier declared non-waivable by the
Governance Policy **MUST NOT** resolve as `waived`. Case or evaluator defects
**MAY** be quarantined only through independent Case QA invalidation; the failed
run remains immutable and a new sealed run is REQUIRED.

Version 0.1.0 publishes no event or resolution schema; the registry fixes the
tuples and the governance record holds the instances.
Evidence and ledger ordering follow the
[Evidence and Detached Validation Contract](evidence-and-validation-contract.md#integrity-model).
