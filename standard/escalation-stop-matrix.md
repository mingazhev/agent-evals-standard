# Escalation and Stop Matrix Contract and Non-Operational Template

- Status: normative contract; bundled matrix instance is non-operational
- Version: escalation-stop-matrix-template-0.1.0
- Owner: adopter-defined; a conforming matrix instance requires a resolvable
  team identifier or email before any held-out, release, or autonomy decision.
- Storage: the adopter policy instance must define the decision-record location.

Every operational instance uses the following typed columns. `Event ID`, claim
effect, governance status, and stop action are separate namespaces; no cell may
substitute one for another. The instance also fills owner, SLA, rollback or
scope-reduction action, evidence, terminal disposition, and resume conditions.

| Event ID | Trigger | Claim effect | Governance status | Stop action | Rollback/scope action | Owner | SLA | Required evidence | Resume condition |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `hardGateRegression` | a baseline or declared hard gate fails | `insufficient_evidence` for positive governance claim | `manual_review_required` | `close_run` | `reject_or_reduce` | unset | unset | failing scorecard, diff, gate evidence | preserve the agent regression; quarantine only after independent Case QA invalidation proves a case/evaluator defect, then use a new sealed run |
| `untriagedCriticalScannerFinding` | untriaged high/critical finding | `insufficient_evidence` | `security_review_required` | `block_acceptance` | `reject_or_reduce` | unset | unset | scanner report and triage artifact | independent security disposition in the resolution ledger |
| `heldOutLeakage` | any held-out oracle exposure | `insufficient_evidence` | `security_review_required` | `stop_governance_use` | `revoke_affected_scope` | unset | unset | incident, exposure-path inventory, access/session revocation, root cause, historical-claim analysis | containment and state reset across caches, sessions, indexes, and providers; case rotation; new conforming held-out run |
| `escapedCriticalDefect` | escaped high/critical production defect | `insufficient_evidence` | `manual_review_required` | `freeze_scope` | `rollback_or_reduce` | unset | unset | incident and new/updated case | mitigation verified on a new sealed held-out run |
| `repeatedReviewRejection` | sealed rejection threshold breached | `insufficient_evidence` | `manual_review_required` | `block_scope_expansion` | `retain_or_reduce` | unset | unset | sampled reviews and reasons | approved rubric/profile/case update and new sealed run |
| `staleMeasurement` | suite or Case QA expiry/staleness | `insufficient_evidence` | `manual_review_required` | `block_acceptance` | `retain_valid_only` | unset | unset | staleness and affected-case report | revalidation or retirement recorded |
| `measurementErrorThreshold` | FP/FN threshold breached | `insufficient_evidence` | `manual_review_required` | `block_metric` | `reduce_affected` | unset | unset | audit sample, interval, threshold, adjudication | recalibration, Case QA, and new evidence |
| `suiteHealthDegradation` | sealed suite-health threshold breached | `insufficient_evidence` | `manual_review_required` | `block_suite` | `reduce_affected` | unset | unset | versioned report and affected-case list | breach closed; invalid QA records quarantined atomically; re-QA complete |
| `decisionExpired` | UTC expiry reached | `not_applicable` to new use | `manual_review_required` | `revoke_approval` | `revoke_expired` | accountable risk owner | immediate | decision and expiry evidence | new decision under a new pre-run plan |
| `reviewDue` | UTC review timestamp reached | `insufficient_evidence` for renewal/expansion | `manual_review_required` | `block_renewal_expansion` | `continue_until_expiry` | accountable risk owner | immediate | review-due event | independent renewal, narrowing, rejection, or expiry |
| `measurementBoundaryCompromise` | authenticated measurement boundary is compromised | `insufficient_evidence` | `security_review_required` | `stop_governance_use` | `revoke_affected_scope` | unset | unset | incident, trust-domain evidence, affected-run analysis | root cause closed, credentials/keys rotated, boundary revalidated, new sealed run |
| `irreversibleCriticalOperation` | critical irreversible operation is proposed or observed | `insufficient_evidence` | `security_review_required` | `block_acceptance` | `reject_or_reduce` | unset | unset | operation plan, blast-radius evidence, explicit authority | only a new policy-compliant decision may proceed; the trigger itself is never waived |
| `productionCredentialsProhibited` | production credential use or exposure is observed | `insufficient_evidence` | `security_review_required` | `stop_governance_use` | `revoke_affected_scope` | unset | unset | credential incident and revocation evidence | revoke/rotate credentials, contain exposure, review historical results, new sealed run |
| `approvedConfigurationChanged` | a material change crosses the sealed approval envelope | `insufficient_evidence` for changed scope | `manual_review_required` | `block_changed_scope` | `revalidate_or_revoke` | unset | unset | old and new component digests, change classification, affected-scope analysis | equivalence evidence or a new conforming run and decision for the changed scope |
| `productionConcordanceDegraded` | a sealed production-concordance threshold is breached | `insufficient_evidence` for affected scope | `manual_review_required` | `suspend_approval` | `narrow_suspend_or_revoke` | unset | unset | sampled production evidence, estimate, uncertainty interval, threshold, affected-scope analysis | breach disposition, verified mitigation, and policy-required revalidation or new run |
| `assuranceEvidenceMissing` | required assurance evidence is missing, late, unauthenticated, or materially incomplete | `insufficient_evidence` for affected scope | `manual_review_required` | `suspend_approval` | `narrow_suspend_or_revoke` | unset | immediate | missing-evidence inventory, collection audit, affected-scope analysis | authenticated complete evidence and independent review; otherwise revalidation or revocation |

Unset owner, SLA, or rollback/scope-action values are deliberate blockers. A governance decision
cannot cite this matrix as operationally ready until the accountable owner has
filled those cells.

Events are recorded using the normative
[`schemas/escalation-event.schema.json`](../schemas/escalation-event.schema.json)
payload shape inside the signed event envelope of the governance-resolution
ledger. Resolutions use the corresponding resolution payload and bind the
earlier escalation payload hash in the same chain.

## Changelog

- escalation-stop-matrix-template-0.1.0 — first public contract and deliberately
  non-operational template.
