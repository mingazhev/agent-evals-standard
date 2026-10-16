# Git-backed Repository SDLC Agent Evals Glossary

- Status: unpublished 0.1.0 publication candidate
- Version: 0.1.0
- Purpose: canonical terms used by the normative artifacts.

Terms are defined here once, briefly; the linked primary requirement owns the
complete rule. An evaluation profile can add narrower terms under its namespace
but cannot change these meanings.

## Scope and Design

- **Repository-grounded SDLC agent evaluation** — an evaluation whose
  claim-bearing work passes the four `SCOPE-003` tests against a sealed Git
  workspace manifest. This is the standard's conformance scope.
- **Sealed repository snapshot** — an immutable, content-addressed
  `workspace-manifest-1` selecting one of `tree_snapshot`, `bounded_ancestry`,
  or `full_ancestry` for every repository root
  ([Git boundary contract](standard.md#git-repository-state-boundary-contract-scope-003)).
- **Materially repository-grounded** — all four `SCOPE-003` tests hold, each
  with a rationale confirmed in Case QA. A link, ticket, or copied fragment
  alone does not establish this.
- **Base standard** — the requirements common to every repository-grounded SDLC
  evaluation. **Evaluation profile** — a versioned, standalone narrowing of the base
  ([PROFILE-001](standard.md#evaluation-profile-resolution)). **Outcome
  profile** — the result-shape contract a case binds through its evaluation
  profile ([CASE-002](standard.md#outcome-profiles)). Unqualified `profile` is
  shorthand only when one kind is possible.
- **SDLC capability family** — one of the seven closed `CAP.*` IDs
  ([SCOPE-002](standard.md#sdlc-capability-taxonomy)). **Work-artifact
  registry** — the closed mapping from work-artifact type to exactly one family.
- **Interaction-mode ID** — one of the four closed IDs in `SCOPE-002`;
  `interactive` and `non_interactive` are not aliases.
- **Normalized primary outcome** — one of the seven base aggregation classes in
  the [Scorecard Contract](scorecard-contract.md#primary-outcome-categories);
  every trial also keeps its profile-native outcome and substatus.
- **Universal gate** — a `GATE-001` gate applying to every conforming
  evaluation in this standard's boundary; not a claim about agents generally.
- **Intended use** — the users, decisions, environment, assurance level, and
  risk context for which evidence is designed. **Construct** — what the
  evaluation intends to measure, distinct from a proxy metric. **Validity
  argument** — the versioned claim-to-evidence argument under `VALID-002`.
- **Material** — required by the selected contract, consumed by a named
  predicate, or able to change that predicate when removed. **Claim-bearing**
  and **decision-bearing** — material to a registered claim or to an
  acceptance, gate, risk, authorization, or governance predicate respectively.
  **Incidental** — established non-material; an unresolved item is material.

## Suites and Cases

- **Evaluation suite** — the case collection a run draws from; the run
  manifest pins the selected cases.
- **Case** — one repository-grounded task binding a workspace manifest, sealed
  agent-visible projection, one evaluation profile, one outcome
  profile, one interaction mode, capability families with material work
  artifacts, the four applicability tests, environment, risk, QA evidence,
  owner, and lifecycle ([CASE-001](standard.md#authoring)).
- **Agent-visible projection** — the complete sealed input an arm can see;
  hidden requirements are not part of it.
- **Oracle material** — reference solutions, hidden checks, grader fixtures,
  scoring internals, or derived state unavailable to an evaluated arm.
  **Leakage control** — a validated oracle-domain detector; a missing detection
  is not proof of cleanliness.
- **Held-out slice** — cases reserved for release or autonomy evidence under
  an **exposure budget** ([HOLD-002](standard.md#held-out-exposure-and-reuse)).
- **Lifecycle state** — `candidate`, `active`, `quarantined`, or `retired`
  ([CASE-003](standard.md#lifecycle-states)).
- **Case QA record (`case-qa-1`)** — evidence that a case satisfies activation
  requirements: controls, stability, and an independent review at A1, plus
  stages 3–8 at A2 and above
  ([CASE-004](standard.md#activation-and-maintenance)).
- **Decision surface** — a pre-registered consequential decision not proven by
  the terminal artifact ([CASE-005](standard.md#decision-surface-coverage)).
  **Declared coverage gap** — an applicable surface without adequate
  measurement; it restricts named claims and never becomes pass.

## Experiment and Execution

- **Run / sealed experiment** — one pre-registered experiment, sealed in one
  `run-manifest-1` that declares arms, cases, repetitions, replacement policy,
  claims with decision rules, statistics, and at A2 and above the attached
  references; the manifest is the one pre-registration artifact
  ([EXP-001](standard.md#sealed-experiment-contract)).
- **Arm** — one fully identified system-under-evaluation configuration, its
  identity recorded in the run manifest; it excludes the measurement profile
  ([EXP-002](standard.md#sealed-experiment-contract)).
- **Measurement profile** — the evaluation-profile digest plus the
  outcome-profile identity bound to a case; comparator arms share it.
- **Comparative design** — the sealed comparator, treatment-bundle, pairing,
  and analysis definition ([EXP-003](standard.md#sealed-experiment-contract)).
- **Scheduled cell** — one case, arm, repetition, block, and seed; the
  experimental observation. **Physical attempt** — one execution in a cell's
  retry lineage; an accounting unit, not an observation. **Trial** — the valid
  selected result that resolves a cell.
- **Attempt ledger** — the runner-owned append-only record of every attempt
  ([RUN-002](standard.md#i5-attribution-and-complete-attempt-accounting)).
- **Interactive protocol** — the versioned actor, state, event, and
  responsibility contract ([INT-001](standard.md#interactive-actors-and-simulators)).
- **Agent configuration** — the complete evaluated model-and-harness behavior,
  not a model label. **Evaluation harness** — runner infrastructure.
  **Agent harness** — the evaluated scaffold. **Adapter** — the integration
  boundary between them.

## Evidence and Judgment

- **Evidence artifact** — one `evidence-artifact-1` record
  ([EVID-001](evidence-and-validation-contract.md#canonical-evidence-artifact)).
- **Authenticated** — resolved by exact ID, version, and recomputed SHA-256 from
  a version-controlled source the verifier selects, by a producer an
  evaluator-controlled authority permits. No signature is implied; see the
  [integrity model](evidence-and-validation-contract.md#integrity-model).
- **Sealed** — fixed by content digest and committed before the step that
  depends on it; the first containing commit is the seal point.
- **A1** — the entry assurance level in [Conformance](conformance.md#baseline-a1):
  bounded capability claims at low or medium risk that never support a
  governance decision. **`stat-defaults-v1`** — the
  [base statistical defaults](standard.md#base-statistical-defaults).
- **Validation envelope** — a detached `validation-envelope-1` binding a
  verdict to a subject digest ([EVID-002](evidence-and-validation-contract.md#detached-validation-envelope)).
- **Measurement trust domain** — runner-owned components evaluated output
  cannot modify ([RUN-003](standard.md#i13-trusted-measurement-boundary)).
- **Deterministic verifier**, **expert adjudication**, **model-based grader**
  — the three evidence sources ordered by
  [JUDGE-001 to JUDGE-003](standard.md#evidence-hierarchy); a model grader is
  never sole evidence for a hard gate or deterministic fact.
- **Governance status** — an accountable review condition kept separate from
  gates, outcomes, and verdicts. **Automated hard gate** — a backed, stable,
  fail-closed condition whose failure is non-compensable. **Control proof** —
  recomputable evidence that a verifier distinguishes positive and negative
  controls.

## Independence

This definition governs people and evidence producers. Statistical
independence of analysis units is governed by `STAT-001`.

A reviewer, rater, approver, or evidence producer is **independent** of a
subject when all three conditions hold:

1. **Different person.** They are a different natural person from the subject's
   author, from whoever configured the evaluated arm, and from the claimant
   whose claim depends on the judgment. An automated producer is independent
   only when a different person operates it.
2. **No prior access to results.** Before their judgment was recorded, they had
   no access to trial outcomes, scores, claim results, other raters' judgments,
   or — where blinding applies — arm identities for the subject. A judgment is
   recorded when it is committed to version control; that commit **MUST** be an
   ancestor of the first commit containing those results, or an access log of an
   access-controlled store **MUST** show no read of them before the judgment
   time.
3. **No declared conflict.** They declare no conflict of interest under the
   sealed conflict-of-interest rule. Membership in the same team or reporting
   line is not, by itself, a conflict.

The record of an independent judgment **MUST** name the person or operated
service, role, the commit or time at which the judgment was recorded, and the
commit or time at which the results first became available to anyone in that
role.

**Small-team model.** Independence is about people and information flow, not
organizational distance. Two people satisfy every independence requirement of
[A1](conformance.md#baseline-a1): one authors the
cases and configures the arm; the other reviews, rates, or approves before
seeing results. Two raters required by `JUDGE-003` additionally **MUST NOT** see
each other's judgments before recording their own, so a two-rater requirement
needs two people besides the author. The same person **MAY** author one case and
independently review another. When a team has fewer people than the
independent roles a requirement needs, the requirement is unmet and the
affected claim yields `insufficient_evidence`; it is never satisfied by a
waiver or by one person acting in two roles.

**Stronger separation.** Where a requirement also demands distinct trust
domains — `A3` security approval — the producers **MUST** belong to different
organizational units or external parties in addition to meeting this
definition. Profiles and policies **MAY** strengthen independence and **MUST
NOT** weaken it.

## Outcomes, Claims, and Statistics

- **Primary outcome** — the Scorecard Contract's mutually exclusive trial
  classification. **Successful outcome** — a trial satisfying
  `functional-outcome-v1`. **Accepted outcome** — a successful trial satisfying
  `accepted-outcome-v1`; not a release or autonomy decision.
- **Claim** — one registered proposition with construct, estimand, population,
  scope, predicate, analysis, threshold, and evidence status
  ([CLAIM-001](scorecard-contract.md#claims)). **Claim status** —
  `supported`, `insufficient_evidence`, or `not_applicable`, computed per claim.
- **Validity** — whether measurement supports interpretation and attribution,
  distinct from success or acceptance.
- **Assurance level** — `A0 diagnostic_run`, `A1 capability`,
  `A2 controlled_decision`, or `A3 high_assurance`
  ([ASSURE-001](standard.md#assurance-levels)); evidence depth, not a score.
  **Assurance overlay** — the base-owned cumulative A1–A3 requirements plus
  additive profile deltas. **A0 / `diagnostic_run`** — a run with no claims
  and no conformance role.
- **Production telemetry** — evidence usable only for validity, concordance,
  drift, and post-decision assurance; never task input, trial outcome
  evidence, or a scheduled cell. **Input origin** — `synthetic` or `public`.
  **Evaluation mode** — `controlled_fixture` or `simulation`, both with
  `productionActionAllowed: false`.
- **Inherent task hazard** — potential harm in the task content itself.
  **Effective risk** — the policy-derived tier combining hazard, data,
  autonomy, permissions, environment, blast radius, oversight, likelihood, and
  uncertainty ([RISK-001](standard.md#risk-model)).
- **pass@k** and **pass^k** — pre-declared estimators of at least one, and of
  all, `k` repetitions succeeding ([STAT-001](standard.md#statistics-and-missingness)).
- **Identification bounds** — the range of claim values compatible with
  resolved cells and sealed assumptions about unresolved cells
  ([STAT-002](standard.md#statistics-and-missingness)).
- **Composite score** — a diagnostic summary after gate and eligibility checks;
  not a claim or decision.
