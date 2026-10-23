# Draft Annex (A2/A3)

This directory holds the A2/A3 draft material of 0.1.0. It is informative as a
map; the documents inside carry the text that the requirements in
[standard.md](../standard.md) invoke.

- The material is unvalidated by any run.
- It may change incompatibly within 0.1.x without a major version bump.
- A conformance claim at A2 or A3 is a claim against this annex, and says so in
  its restrictions.

| Document | Invoked by |
| --- | --- |
| [Validity, threat, and held-out exposure contracts](validity-threat-held-out-contracts.md) | `VALID-002`, `VALID-003`, `HOLD-002` |
| [Security Threat Model](security-threat-model.md) | `RISK-001`, `RUN-003`, `DATA-001`, `DATA-002` |
| [Governance Policy](governance-policy.md) | `GOV-001` |
| [Governance decision record template](governance-decision-record.md) | informative authoring checklist |

The JSON registries and all schemas stay in `standard/` and `schemas/`, where
the repository check reads them.

## Known gaps

- No schema exists for post-decision governance events, enforcement receipts,
  assurance observations, or the governance record; the related sections of the
  Governance Policy are informative shape guidance.
- No bundled profile exists for any capability family except
  `CAP.IMPLEMENT_CHANGE`.
- A2 and A3 have never been exercised end to end.
