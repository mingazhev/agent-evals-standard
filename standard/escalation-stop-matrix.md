# Escalation and Stop Matrix Contract and Non-Operational Template

- Status: unpublished working draft; bundled matrix instance is non-operational
- Version: 0.1.0
- Owner: adopter-defined; a conforming matrix instance requires a resolvable
  team identifier or email before any held-out, release, or autonomy decision.
- Storage: the adopter policy instance **MUST** define the event, enforcement-
  receipt, resolution, and checkpoint locations.

The canonical closed event registry is
[`escalation-event-registry.json`](escalation-event-registry.json). Its 20
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

All `unset` owner or SLA values are deliberate blockers, including the expiry,
review, and assurance rows. Every registry action remains normative; the
adopter **MUST** assign a concrete owner and SLA before an operational decision
can cite this matrix.

## Immutable event lifecycle

1. A trigger **MUST** append an immutable open escalation event. The source
   event contains no resolution or terminal disposition.
2. The stop and rollback/scope actions **MUST** be applied and recorded in a
   separate enforcement receipt binding the event hash, exact scope, action IDs,
   authorized executor, times, outcome, and canonical evidence.
3. A later resolution **MUST** bind the unchanged source-event hash, triage and
   corrective evidence, resolver authorization and role-conflict check,
   terminal disposition, residual risk, expiry, and required receipt. It closes
   status; it **MUST NOT** mutate the event.
4. Resume **MUST** produce another receipt proving all row conditions for the
   same scope. Missing, late, or failed enforcement emits
   `assuranceEvidenceMissing` and keeps the original event open.

Baseline hard-gate events and every identifier declared non-waivable by the
Governance Policy **MUST NOT** resolve as `waived`. Case or evaluator defects
**MAY** be quarantined only through independent Case QA invalidation; the failed
run remains immutable and a new sealed run is REQUIRED.

Events are recorded using the normative
[`schemas/escalation-event.schema.json`](../schemas/escalation-event.schema.json)
payload shape inside the signed event envelope of the governance-resolution
ledger. Resolutions and enforcement receipts use separate typed payloads and
bind the earlier escalation payload hash in the same chain. Evidence follows
the [Evidence and Detached Validation Contract](evidence-and-validation-contract.md);
ledger signatures and checkpoints follow the
[Signature and Trust Profile](signature-and-trust-profile.md).
