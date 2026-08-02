# Examples

Minimal but complete, machine-validatable instances of every normative artifact
in the Core adoption path. Each file is a **hypothetical** instance: hashes,
signatures, timestamps, and artifact URIs are placeholders that satisfy the
schema patterns, not references to real files.

| File | Validates against | What it shows |
| --- | --- | --- |
| `case.json` | `schemas/case.schema.json` | A non-interactive, `clear-cut`, `development`-set case in `active` lifecycle state. |
| `case-qa-record.json` | `schemas/case-qa-record.schema.json` | The activation record: 9 stages passed, control proofs, stability proofs, FP/FN validation, decision `activated`. |
| `scorecard.json` | `schemas/scorecard.schema.json` | A sealed one-case capability run: one valid `solved` trial, all 15 baseline gates passing, supported claim, complete attempt ledger. |
| `conformance-statement.json` | `schemas/conformance-statement.schema.json` | A signed `case`-target conformance statement. |
| `governance-decision.json` | `schemas/governance-decision.schema.json` | A `release` decision with verdict `reject` and a full condition trace (no post-decision assurance plan required). |

All files are checked by `scripts/validate.sh` in CI. If you change a schema,
run the validator and update the affected examples in the same pull request.

## How to use these files

1. Copy the closest match, keep only the fields your implementation actually
   produces, and replace placeholders with real values.
2. Validate your artifact against the schema and the
   [Integrity and Semantic Validation Contract](../standard/integrity-and-semantic-validation.md)
   before treating it as evidence.
3. Publish a [conformance statement](../standard/conformance.md) only after the
   artifact satisfies both schema and semantic validation.

The Governance-path artifacts (`escalation-event.json`,
`governance-resolution.json`, `assurance-observation.json`,
`governance-resolution-ledger.json`) are intentionally not exemplified here;
their payloads are bound to an adopter-owned policy and matrix instance, which
this repository does not ship.
