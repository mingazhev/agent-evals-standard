# Governance Decision Record Template

The normative machine-readable record is
[`schemas/governance-decision.schema.json`](../schemas/governance-decision.schema.json).
This Markdown file is its authoring view.

- Decision ID:
- Golden Standard version:
- Scorecard Contract version:
- Policy instance version/location/hash:
- Escalation and Stop Matrix instance version/location/hash:
- Pre-run decision-plan ID:
- Pre-run decision-plan hash:
- Pre-run decision-plan timestamp:
- Decision type: autonomy | release | risk acceptance
- Decision timestamp (UTC):
- Case-set membership:
- Immutable scorecard IDs/locations/hashes:
- Attempt-ledger initial/terminal roots:
- Governance-resolution-ledger location/initial/current roots:
- Run IDs:
- Configuration ID/hash:
- Risk tier:
- Approved task classes:
- Approved repositories/components:
- Approved environments:
- Approved target population:
- Approved represented strata:
- Approved exclusions and coverage gaps:
- Approved autonomy/tool boundaries:
- Effective timestamp (UTC):
- Review timestamp (UTC):
- Expiry timestamp (UTC):
- Decision: approve | reject | insufficient_evidence
- Approver stable ID/role/attestation:
- Security approver stable ID/role/attestation:
- Status resolver stable ID/role:
- Waiver authority stable ID/role:
- Rollback verifier stable ID/role:
- Per-role separation-of-duties evidence/hash:
- Accountable risk owner:
- False-positive owner:
- False-negative owner:

## Policy Condition Trace

Record every sealed decision predicate; do not summarize it away.

| Condition ID | Sealed requirement | Observed value | Evidence ID/hash | Evaluator ID | Verdict | Failure effect |
| --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  | pass/fail/insufficient_evidence |  |

## Evidence Summary

- Required pass^k/reliability@k:
- Observed pass^k/reliability@k:
- Required pass@k:
- Observed pass@k:
- Confidence-interval method/level/observed interval:
- Minimum sample and observed sample:
- Invalid-rate threshold/observed rate:
- Differential-invalidity threshold/observed interval/verdict:
- Conservative-bound method/observed bound:
- Hard-gate status:
- Governance statuses:
- Governance status resolutions: append-only resolution-ledger event IDs only;
  do not mutate the run scorecard
- Review burden:
- Cost/review thresholds and observed values:
- Transcript-review record and quota:
- Suite-health report/version and threshold status:
- Quarantined/invalid slices excluded from the claim:

## Rationale

Explain why the decision follows the cited governance policy. Do not introduce
new thresholds in this record.

## Residual Risks

List known unresolved risks, mitigations, and owners.

## Overrides

- Override used: yes | no
- Override rule ID from the policy allowlist:
- Original/new risk tier or requirement:
- Scope and expiry:
- Override rationale:
- Override approver:
- Separation-of-duties evidence:
- Non-waivable registry and mechanical check evidence/hash:

## Rollback or Scope Reduction

- Pre-run decision-plan rollback-condition ID:
- Trigger status and evidence:
- Applied rollback or scope reduction:
- Independent rollback verifier and attestation:
- Resolution-ledger event ID:

Do not create a new rollback threshold in this record.
