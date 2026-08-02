# Normative Schemas

These JSON Schemas define the machine-readable contracts for the unpublished
Git-backed Repository SDLC Agent Evals Standard draft `0.1.0`. This draft has no legacy discriminator or
migration surface: every schema uses URN suffix `:1`.

The table below is a non-exhaustive navigation summary. The complete normative
schema set is every `*.schema.json` file in this directory; repository checks
enumerate that set rather than relying on this summary.

| Contract | File |
| --- | --- |
| Case and activation QA | `case.schema.json`, `case-qa-record.schema.json` |
| Suite, evaluator, and measurement profiles | `suite-manifest.schema.json`, `evaluator-manifest.schema.json`, `evaluation-profile.schema.json`, `profile-resolution-record.schema.json`, `profile-resolution-proof-inputs.schema.json`, `outcome-profile.schema.json` |
| Repository-change profile contracts and registries | `repo-change-case-contract.schema.json`, `repo-change-gate-registry.schema.json`, `repo-change-failure-taxonomy.schema.json` |
| Closed SDLC work products | `work-artifact-registry.schema.json` |
| Environment and sealed execution | `environment-contract.schema.json`, `production-derived-authority-contract.schema.json`, `pre-run-manifest.schema.json` |
| Risk derivation and sealed tier identity | `risk-assessment.schema.json` |
| Statistics and grader validity | `statistical-plan.schema.json`, `grader-validation.schema.json` |
| Validity, reference baselines, threats, and held-out exposure | `validity-argument.schema.json`, `evaluation-threat-model.schema.json`, `held-out-exposure-budget.schema.json`, `held-out-exposure-ledger.schema.json` |
| Scorecard | `scorecard.schema.json` |
| Canonical evidence and detached validation | `evidence-artifact.schema.json`, `source-evidence-manifest.schema.json`, `source-evidence-triangulation-fixture.schema.json`, `validation-envelope.schema.json` |
| Repository snapshot and material grounding | `workspace-manifest.schema.json`, `repository-grounding-evidence.schema.json` |
| Requirements and trust | `requirement-registry.schema.json`, `requirement-implementation-contract.schema.json`, `signature-profile.schema.json`, `anti-rollback-policy.schema.json` |
| Operational policy and escalation | `escalation-event-registry.schema.json`, `operational-governance-policy.schema.json` (closed ASSURE-001 risk/decision minima), `operational-escalation-matrix.schema.json`, `escalation-event.schema.json`, `enforcement-receipt.schema.json` |
| Governance state | `assurance-observation.schema.json`, `governance-resolution.schema.json`, `governance-resolution-ledger.schema.json`, `governance-decision.schema.json` |
| Conformance | `conformance-applicability-contract.schema.json`, `conformance-statement.schema.json` (including the material proof-set, verifier-registry, and verification-record fragments) |

Validators load every schema in this directory into a registry keyed by its
absolute `$id` before resolving cross-schema references. Semantic validation is
also required: JSON Schema cannot enforce projected uniqueness such as unique
`id` fields, cross-document referential integrity, digest reproduction,
timestamp ordering, or exact one-to-one correspondence between registries and
results. Arrays whose IDs require projected uniqueness carry a `$comment` when
this distinction is material.

Validators MUST implement Draft 2020-12 `format-assertion`, not annotation-only
format handling. Every normative `date-time` is additionally constrained to an
uppercase `Z` suffix and therefore represents UTC; offset timestamps are
invalid even when they denote the same instant.

In an environment isolation boundary, `agentWritableRoots` is the complete
allowlist of roots writable by the agent. An empty array is valid and means
that the boundary grants no filesystem write access. A validator or runner
**MUST NOT** synthesize a writable default, infer write permission from another
field, or treat the empty array as a missing declaration; omission of the
required field remains invalid.

Validation results are detached. A signed `validation-envelope-1` binds the
subject type, ID, canonical digest, projection, validation contract, findings,
and output digest; the validated subject never embeds that result.

The schemas and Markdown requirements are jointly normative. Conflict handling
is defined by the [Conformance Contract](../standard/conformance.md).

`workspace-manifest-1` has three and only three Git repository-state modes:
`tree_snapshot`, `bounded_ancestry`, and `full_ancestry`. Their object-closure,
gitlink, LFS-exclusion, and fail-closed verdict semantics are owned by the
[Git Repository-State Boundary Contract](../standard/standard.md#git-repository-state-boundary-contract-scope-003),
not by schema annotations. Schema `$comment` fields are informative navigation.
