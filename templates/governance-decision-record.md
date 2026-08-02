# Governance Decision Record Template

- Status: unpublished working draft
- Template version: 0.1.0

This authoring view represents one decision over immutable scorecards and claim
results. The signed decision is a validation subject and **MUST NOT** embed its
semantic-validation result. A detached `validation-envelope-1` binds the final
decision digest.

## Identity and Contracts

- Decision ID:
- Decision type: release | autonomy | risk_acceptance
- Decision timestamp (UTC):
- Git-backed Repository SDLC Agent Evals Standard version/commit/digest:
- Requirements Registry version/digest:
- Scorecard Contract version/digest:
- Operational policy ID/version/location/digest:
- Escalation and Stop Matrix ID/version/location/digest:
- Suite `profiles[]` manifest location/digest:
- Effective leaf evaluation-profile ID/version/`effectiveProfileDigest`:
- Parent chain, deterministic flattening, requirement-source mapping, and conflict-report evidence:
- Outcome-profile ID/version/digest:
- Pre-run decision-plan ID/location/digest/timestamp:
- Decision schema and semantic-validation contract versions/digests:

## Applicability and Intended Use

- Repository-grounded SDLC applicability boundary:
- Intended users and decision:
- SDLC capability-family IDs from the closed base taxonomy:
- Outcome profiles:
- Target population and sampling frame:
- Represented strata:
- Exclusions and coverage gaps:
- Assurance level: A2 release | A3 autonomy
- Effective-risk tier and risk-record ID/digest:
- Inherent task hazards:
- Data sensitivity, residency, IP, and retention boundary:

## Experiment and Arm Scope

- Experiment IDs and manifest digests:
- Immutable scorecard IDs/locations/digests:
- Attempt-ledger initial/terminal roots:
- Held-out exposure-ledger location/root and remaining budget:
- Comparative-design ID/digest, when applicable:
- Declared treatment bundle:
- Shared measurement-profile ID/digest for comparator cells:
- Approved arm ID and full identity digest:
- Comparator arm IDs and identity digests:
- Approved task classes:
- Approved repositories/components:
- Approved environment and deployment scope:
- Approved tools, permissions, autonomy, and human-oversight boundary:
- Approved external services and data processors:
- Effective timestamp (UTC):
- Review timestamp (UTC):
- Expiry timestamp (UTC):

## Claim Decision Table

Every decision-bearing claim ID resolves to one immutable scorecard
`claimResults[]` entry.

| Claim ID | Type/construct | Population/slice | Required status/threshold | Observed estimate/interval/bounds | Missingness and coverage | Assurance/risk compatibility | Verdict | Evidence IDs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |  | pass/fail/insufficient_evidence |  |

## Policy Condition Trace

Record every sealed decision predicate. A summary **MUST NOT** replace this
trace.

| Condition ID | Requirement or policy clause | Sealed requirement | Observed value | Evidence-artifact IDs | Evaluator/reviewer | Verdict | Failure effect |
| --- | --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  | pass/fail/insufficient_evidence | reject/insufficient_evidence |

## Gate, Status, and Validity Summary

- Scorecard validation-envelope IDs/digests:
- Attempt-integrity status:
- Core/evaluation-profile/risk/case hard-gate status and failures:
- Governance statuses and resolution-ledger event IDs:
- Invalid and not-assessable attempt counts by arm/case:
- Unresolved-cell rates by arm/case:
- No-assumption identification bounds:
- Differential missingness and modeled sensitivity results:
- Transcript/expert-review quota and adjudication evidence:
- Suite-health status and material limitations:
- Baseline identities, resource parity, and results:
- Production-concordance evidence available before decision:
- Cost and review-burden limits and observed values:

## Roles and Separation of Duties

- Experiment operator stable ID/role:
- Evidence producers stable IDs/roles:
- Case and evaluation-profile owners stable IDs/roles:
- Claim evaluators stable IDs/roles:
- Expert adjudicators stable IDs/roles:
- Status resolver stable ID/role:
- Ordinary approver stable ID/role:
- Security approver stable ID/role, when policy-required:
- Data owner stable ID/role, when policy-required:
- Risk owner stable ID/role:
- Waiver authority stable ID/role:
- Rollback verifier stable ID/role:
- Role-conflict checks and evidence-artifact IDs:

## Decision

- Verdict: approve | reject | insufficient_evidence
- Rationale linked to condition and claim IDs:
- Approved scope:
- Residual risks, mitigations, owners, and deadlines:
- False-positive and false-negative owners:
- Next review trigger in addition to timestamp:

No metric or composite is a decision by itself. `approve` requires every sealed
approval condition to pass. A conclusive prohibited event maps to reject when
the policy says reject; missing or indeterminate required evidence maps to
insufficient evidence.

## Overrides and Waivers

- Used: yes | no
- Exact allowlisted rule ID:
- Original and substituted requirement or tier:
- Grounds and compensating evidence:
- Scope, effective time, expiry, and claim restrictions:
- Authorized actor and separation-of-duties evidence:
- Non-waivable registry check:

An override or waiver **MUST NOT** be inferred from free text or silence.

## Post-Decision Assurance

- Assurance-plan ID/version/location/digest:
- Independent assurance-plan approval ID/digest:
- Approved arm identity and envelope digest:
- Production-concordance signal, calculation, and threshold contract IDs/digests:
- Confirmation that production telemetry is assurance evidence, not an evaluation case:
- Sampling contract: population, frame, cadence, window, UTC anchor, lateness,
  missingness, minimum sample, verifier, owner, SLA, and retention:
- Missing-evidence action: suspend

| Change or assurance trigger | Threshold contract | Claim IDs and effect | Stop action | Scope action | Rollback conditions | Revalidation conditions | Resume conditions |
| --- | --- | --- | --- | --- | --- | --- | --- |
| model or agent configuration |  |  |  |  |  |  |  |
| prompt, policy, or harness |  |  |  |  |  |  |  |
| adapter, tool schema, or tool implementation |  |  |  |  |  |  |  |
| permissions, data, or processor |  |  |  |  |  |  |  |
| environment or deployment scope |  |  |  |  |  |  |  |
| evaluation profile, grader, rubric, or adjudication protocol |  |  |  |  |  |  |  |
| retrieval, memory, or agent-visible projection |  |  |  |  |  |  |  |
| production-concordance breach |  |  |  |  |  |  |  |
| assurance evidence missing or late |  |  |  |  |  |  |  |

## Rollback, Narrowing, or Suspension

- Trigger ID and evidence:
- Affected arm, repositories, claims, and deployment scope:
- Applied stop action:
- Rollback or scope reduction:
- Independent verification and evidence:
- Resolution-ledger event ID:
- Revalidation and resume conditions:

The record applies only thresholds and actions sealed in the policy and
decision plan; it does not invent them after observing results.

## Signature and Detached Validation

- Decision signer ID/key/suite/signature:
- Canonical decision digest:
- Detached validation-envelope ID/location/digest:
