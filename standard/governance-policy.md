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
`baseline-hard-gates-1` gate; `productionCredentialsProhibited`;
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
- the pinned [Escalation and Stop Matrix](escalation-stop-matrix.md) version and
  hash;
- maximum approval lifetime by risk tier and UTC
  `effectiveAt < reviewAt <= expiresAt` timestamps;
- incompatible-role rules and stable identities for evidence producer,
  operator, status resolver, waiver authority, ordinary approver, security
  approver, risk owner, and rollback verifier;
- incompatible-role rules also covering every decision-affecting interactive
  requester, simulator, human, or helper and the post-decision assurance owner;
- the append-only governance-resolution ledger used after the immutable run
  scorecard closes.
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
  the signed resolution ledger; they do not rewrite the closed scorecard.
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
  to a signed governance-resolution ledger. Decision records reference the
  immutable scorecard and ledger roots rather than mutating or circularly
  linking either artifact.

## Escalation, Enforcement, and Resolution

An escalation trigger **MUST** append one immutable open event before any
resolution is considered. The event binds the matrix row and digest, observed
facts, source evidence, affected claims and scope, trigger time, owner, SLA,
claim effect, governance status, stop action, and rollback or scope action. It
**MUST NOT** contain a terminal disposition and **MUST NOT** be edited, deleted,
or replaced.

The stop and scope actions **MUST** produce a separate enforcement receipt that
binds the event hash, exact affected scope, action IDs, executor identity and
authorization, start and completion times, outcome, and evidence. Failure to
produce a complete receipt within the SLA keeps the event open and emits
`assuranceEvidenceMissing`; asserted intent is not enforcement.
The event's `enforcementRequest.action` **MUST** equal its registered
`stopAction`; a request cannot silently substitute a weaker or different action.

A resolution **MUST** be a later event that binds the original event hash,
triage and corrective evidence, resolver authorization, role-conflict check,
terminal disposition, residual risk, claim effect, expiry, and the required
enforcement receipt. Resolution closes the status; it never rewrites the source
event. Resume **MUST** have its own enforcement receipt proving that every
pre-registered resume condition holds for the same scope. Narrowing,
suspension, revocation, and renewal follow the same event–receipt–resolution
model.

A governance decision's `enforcementReceipts` array is the closed set of every
receipt relevant to that decision. Receipt IDs **MUST** be unique, each pointer
**MUST** resolve exactly once and bind a required action in the same event and
scope chain, and an unrelated, missing, or duplicate receipt invalidates the
decision evidence.

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
the affected approval. Every expected monitoring window is appended as a typed
assurance observation, including the plan hash, scope, signal, sample, estimate,
uncertainty, sequential-look index, threshold, verdict, producer, reviewer, and
canonical evidence references. Monitoring and later evidence **MUST NOT**
rewrite the original run or decision rationale.

Resolution events use
[`schemas/governance-resolution.schema.json`](../schemas/governance-resolution.schema.json)
and monitoring windows use
[`schemas/assurance-observation.schema.json`](../schemas/assurance-observation.schema.json)
inside the authenticated
[`governance-resolution-ledger.schema.json`](../schemas/governance-resolution-ledger.schema.json).
All evidence and validation references follow the
[Evidence and Detached Validation Contract](evidence-and-validation-contract.md),
and signatures, trust state, and external checkpoints follow the
[Signature and Trust Profile](signature-and-trust-profile.md).
