# Git-backed Repository SDLC Agent Evals Glossary

- Status: unpublished 0.1.0 publication candidate
- Version: 0.1.0
- Purpose: canonical terms used by the normative artifacts.

Terms are defined here once, briefly; the linked primary requirement owns the
complete rule. An evaluation profile can add narrower terms under its namespace
but cannot change these meanings.

## Scope and Design

- **Repository-grounded SDLC agent evaluation** — claim-bearing work that
  passes the four `SCOPE-003` tests ([SCOPE-003](standard.md#applicability-boundary-and-profiles)).
- **Sealed repository snapshot** — an immutable `workspace-manifest-1`; see the
  [Git boundary contract](git-repository-state-contract.md).
- **Evaluation profile**, **outcome profile** — see
  [PROFILE-001](standard.md#evaluation-profile-resolution) and
  [CASE-002](standard.md#outcome-profiles).
- **SDLC capability family**, **interaction-mode ID** — closed IDs under
  [SCOPE-002](standard.md#sdlc-capability-taxonomy).
- **Normalized primary outcome** —
  [Scorecard Contract](scorecard-contract.md#primary-outcome-categories).
- **Universal gate** — a `GATE-001` gate applying to every conforming
  evaluation; not a claim about agents generally.
- **Intended use**, **construct**, **validity argument** —
  [VALID-002](standard.md#intended-use-and-validity-argument).
- **Material** — required by the selected contract, consumed by a named
  predicate, or able to change that predicate when removed. **Claim-bearing**
  and **decision-bearing** — material to a registered claim or to an
  acceptance, gate, risk, authorization, or governance predicate respectively.
  **Incidental** — established non-material; an unresolved item is material.

## Suites and Cases

- **Case** — one repository-grounded task ([CASE-001](standard.md#authoring)).
- **Agent-visible projection** — the complete sealed input an arm can see;
  hidden requirements are not part of it.
- **Oracle material** — reference solutions, hidden checks, grader fixtures,
  scoring internals, or derived state unavailable to an evaluated arm.
  **Leakage control** — a validated oracle-domain detector; a missing detection
  is not proof of cleanliness.
- **Held-out slice**, **exposure budget** —
  [HOLD-002](standard.md#held-out-exposure-and-reuse).
- **Lifecycle state** — [CASE-003](standard.md#lifecycle-states).
- **Case QA record** — [CASE-004](standard.md#activation-and-maintenance).
- **Decision surface**, **declared coverage gap** —
  [CASE-005](standard.md#decision-surface-coverage).

## Experiment and Execution

- **Run / sealed experiment**, **arm**, **comparative design** —
  [EXP-001 to EXP-003](standard.md#sealed-experiment-contract).
- **Measurement profile** — the evaluation-profile digest plus the
  outcome-profile identity bound to a case; comparator arms share it.
- **Scheduled cell** — one case, arm, and repetition; the experimental
  observation. **Physical attempt** — one execution in a cell's retry lineage;
  an accounting unit, not an observation. **Trial** — the valid selected result
  that resolves a cell.
- **Attempt ledger** — [RUN-002](standard.md#i5-attribution-and-complete-attempt-accounting).
- **Interactive protocol** — [INT-001](standard.md#interactive-actors-and-simulators).
- **Agent configuration** — the complete evaluated model-and-harness behavior,
  not a model label. **Evaluation harness** — runner infrastructure.
  **Agent harness** — the evaluated scaffold. **Adapter** — the integration
  boundary between them.

## Evidence and Judgment

- **Evidence artifact** — [EVID-001](evidence-and-validation-contract.md#canonical-evidence-artifact).
  **Validation envelope** — [EVID-002](evidence-and-validation-contract.md#detached-validation-envelope).
- **Authenticated** — resolved by exact ID, version, and recomputed SHA-256 from
  a version-controlled source the verifier selects; no signature is implied
  ([integrity model](evidence-and-validation-contract.md#integrity-model)).
- **Sealed** — fixed by content digest and committed before the step that
  depends on it; the first containing commit is the seal point.
- **A1** — [Conformance](conformance.md#baseline-a1). **`stat-defaults-v1`** —
  [base statistical defaults](standard.md#base-statistical-defaults).
- **Measurement trust domain** — [RUN-003](standard.md#i13-trusted-measurement-boundary).
- **Deterministic verifier**, **expert adjudication**, **model-based grader** —
  [JUDGE-001 to JUDGE-003](standard.md#evidence-hierarchy).
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
2. **Role-appropriate blinding.** Case activation and pre-run reviewers have
   no access to evaluated-trial outcomes, scores, or claim results before their
   judgment is committed. Their review commit **MUST** precede the first result
   commit, or access-controlled-store logs **MUST** establish the same order.
   Raters **MUST NOT** see other raters' judgments before recording their own,
   and arm identities remain hidden where the applicable protocol requires it.
   Conformance reviewers and governance approvers inspect the completed evidence
   their duties require; access to that evidence does not defeat independence.
3. **No declared conflict.** They declare no conflict of interest under the
   sealed conflict-of-interest rule. Membership in the same team or reporting
   line is not, by itself, a conflict.

The record of an independent judgment **MUST** name the person or operated
service, role, the commit or time at which the judgment was recorded, and the
commit or time at which the results first became available to anyone in that
role.

**Small-team model.** Independence is about people and information flow, not
organizational distance. Two people suffice for deterministic
[A1](conformance.md#baseline-a1) cases: one authors the
cases and configures the arm; the other performs the pre-run reviews and later
reviews conformance. Two raters required by `JUDGE-003` additionally **MUST NOT** see
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

- **Primary outcome**, **successful outcome**, **accepted outcome** —
  [Scorecard Contract](scorecard-contract.md#primary-outcome-categories); an
  accepted outcome is not a release or autonomy decision.
- **Claim**, **claim status** — [CLAIM-001](scorecard-contract.md#claims).
- **Validity** — whether measurement supports interpretation and attribution,
  distinct from success or acceptance.
- **Assurance level**, **assurance overlay**, **A0** —
  [ASSURE-001](standard.md#assurance-levels).
- **Production telemetry** — evidence usable only for validity, concordance,
  drift, and post-decision assurance. **Input origin** — `synthetic` or
  `public`. **Evaluation mode** — `controlled_fixture` or `simulation`.
- **Inherent task hazard** — potential harm in the task content itself.
  **Effective risk** — [RISK-001](standard.md#risk-model).
- **pass@k**, **pass^k**, **identification bounds** —
  [STAT-001, STAT-002](standard.md#statistics-and-missingness); 0.1.0 supports
  pass@1 and pass^k (`pass_hat_k`), not pass@k for `k > 1`.
- **Composite score** — a diagnostic summary after gate and eligibility checks;
  not a claim or decision.
