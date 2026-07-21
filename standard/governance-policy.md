# Governance Policy Contract and Non-Operational Template

- Status: normative contract; bundled policy instance is non-operational
- Version: governance-policy-template-1.0.0
- Owner: adopter-defined; a conforming policy instance requires a resolvable
  team identifier or email before any held-out, release, or autonomy decision.
- Scope: risk classification for every evaluation case and pre-registered
  decision rules for autonomy, release, and risk-acceptance decisions that cite
  `agent-evals` scorecards.

This document defines the required policy shape and a fail-closed template. It
is not an operational policy instance and intentionally defines no approval
thresholds. Any governance decision must cite a versioned adopter-owned policy
instance before the held-out or release run begins. A scorecard contract or
this template cannot substitute for that policy instance.

## Risk-Tier Taxonomy

Assign the risk tier before the trial according to the potential harm. The tier
determines required gates, permitted tools, review, retention, and release
criteria. When multiple criteria apply, use the highest applicable tier. A
downgrade is prohibited by this stub because all four tiers currently produce
the same `insufficient_evidence` decision and define no differentiated gates,
permissions, review, retention, or release effect. A future non-stub version
may permit a documented pre-run exception only after defining those
differences, permitted grounds, original and new tiers, scope, expiry,
supporting evidence, and an independent approver. The tier must never change
after results are observed. The following identifiers are non-waivable: every
`baseline-hard-gates-3` gate; `productionCredentialsProhibited`;
`heldOutLeakage`; `measurementBoundaryCompromise`; and
`irreversibleCriticalOperation`. Unknown identifiers are non-waivable until a
versioned policy classifies them. An operational policy may authorize overrides
only from an explicit allowlist; free-text requirements are never implicitly
overridable.

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
under different taxonomy versions must not be silently combined in risk-tier
slices.

## Required Decision-Rule Schema

For each risk tier, the policy version used for a decision must define:

- an immutable pre-run decision-plan ID, hash, and timestamp;
- pinned versions of the Golden Standard, Scorecard Contract, governance
  policy, and suite;
- the minimum evidence level;
- required case-set membership (`held-out`; `development` and `smoke` are not
  governance-eligible) and, for longitudinal claims, the frozen-slice IDs;
- required pass^k/reliability@k and/or pass@k;
- the confidence-interval method and minimum sample size;
- zero-tolerance hard gates;
- the expected blocking-governance-status set, trigger rules, and hash;
- terminal-state requirements for every expected governance status;
- acceptable review burden and a cost ceiling;
- transcript-review sampling frame, minimum quota, reviewer independence, and
  adjudication rule;
- invalid-rate and differential-invalidity thresholds and the named
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
- the pinned Escalation and Stop Matrix version and hash.
- maximum approval lifetime by risk tier and UTC
  `effectiveAt < reviewAt <= expiresAt` timestamps;
- incompatible-role rules and stable identities for evidence producer,
  operator, status resolver, waiver authority, ordinary approver, security
  approver, risk owner, and rollback verifier;
- the append-only governance-resolution ledger used after the immutable run
  scorecard closes.

## Risk-Tier Table

| Risk tier | Minimum evidence | Required reliability | Zero-tolerance gates | Required reviews | Decision rule |
| --- | --- | --- | --- | --- | --- |
| low | unset | unset | unset | unset | insufficient_evidence |
| medium | unset | unset | unset | unset | insufficient_evidence |
| high | unset | unset | unset | unset | insufficient_evidence |
| critical | unset | unset | unset | unset | insufficient_evidence |

## Eligibility Rules

- Sanity-only scorecards are never governance-eligible.
- Scorecards from the `development` set are not evidence for release or
  autonomy decisions.
- Any unresolved blocking governance status makes acceptance impossible until
  it is explicitly resolved in a decision record.
- A `waived` status counts as closed only when the policy permits a waiver for
  that status and risk tier. Without structured resolution evidence, the status
  remains `open`.
- This version authorizes no waiver for any status or risk tier. Silence is a
  denial, not permission. A future authorization must identify the exact
  status, tier, authority, permitted grounds, evidence, scope, and expiry.
- The approver and any required security approver must be independent of the
  experiment operator, case author, and evidence producer for ordinary
  approvals as well as overrides. For `high` and `critical` decisions, ordinary
  and security approvers are distinct people; neither may be the risk owner,
  waiver authority, status resolver, or rollback verifier. Every resolution,
  waiver, renewal, and rollback verification records a role-conflict check.
- A decision becomes ineffective at its UTC expiry timestamp. Reaching the UTC
  review timestamp blocks new acceptance, renewal, and scope expansion but does
  not revoke already-authorized execution before expiry unless the operational
  policy says so. The required independent review renews, narrows, rejects, or
  lets the decision expire; neither timestamp is informational metadata.
- Rollback and scope-reduction conditions are sealed in the pre-run decision
  plan. A decision record may cite and apply them but may not invent them after
  observing results.
- Thresholds must not be selected or edited after inspecting the run output
  they will judge.
- The run scorecard is immutable at run close. Later status resolutions,
  waivers, expiry, narrowing, renewal, rollback, and supersession are appended
  to a signed governance-resolution ledger. Decision records reference the
  immutable scorecard and ledger roots rather than mutating or circularly
  linking either artifact.

Resolution events use
[`schemas/governance-resolution.schema.json`](../schemas/governance-resolution.schema.json)
inside the authenticated
[`governance-resolution-ledger.schema.json`](../schemas/governance-resolution-ledger.schema.json).

## Changelog

- governance-policy-template-1.0.0 — separated the public normative policy
  contract from adopter-owned operational thresholds and ownership. The bundled
  instance remains fail-closed and authorizes no governance decision.
- governance-policy-0.4.0 — prohibited no-op risk-tier downgrades while the
  table is a stub; made waiver silence deny by default; added expected blocker
  sets, transcript quota, invalidity bounds, matrix pinning, ordinary-decision
  separation of duties, and enforceable expiry/review/rollback rules. Thresholds
  remain unset, so every tier still yields `insufficient_evidence`.
- governance-policy-0.3.0 — added controlled risk-tier exceptions, separation
  of duties, non-waivable boundaries, an exact approval envelope, and a
  structured lifecycle for governance blockers. Thresholds remain a
  conservative stub, and every tier still yields `insufficient_evidence`.
- governance-policy-0.2.0 — added the normative risk-tier taxonomy for all
  cases, the highest-applicable-tier rule, the prohibition on post-hoc
  downgrades, and provenance and migration requirements.
- governance-policy-0.1 — created a conservative decision-policy stub without
  approval thresholds.
