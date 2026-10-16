# Normative Schemas

These JSON Schemas define the machine-readable contracts for the unpublished
Git-backed Repository SDLC Agent Evals Standard draft `0.1.0`. This draft has no legacy discriminator or
migration surface: every schema uses URN suffix `:1`.

One schema family covers all four assurance levels. The six run-family schemas
carry the A1 fields as required properties; their A2/A3 additions are optional
properties that the prose makes REQUIRED at A2 and above, and only
`run-manifest.schema.json` enforces level conditionals because it declares
`assuranceLevel`. The complete normative schema set is every `*.schema.json`
file in this directory (22); repository checks enumerate that set rather than
relying on this table.

| Group | Schemas | Maturity |
| --- | --- | --- |
| Run family (6) | `case`, `case-qa`, `run-manifest`, `attempt-ledger`, `scorecard`, `conformance-statement` | normative |
| Registries | `requirement-registry`, `work-artifact-registry` | normative |
| A2/A3 registries and profiles | `escalation-event-registry`, `evaluation-profile`, `outcome-profile` | draft annex |
| Evidence | `workspace-manifest` | normative |
| A2/A3 evidence | `evidence-artifact`, `validation-envelope` | draft annex |
| A2/A3 attachments | `validity-argument`, `evaluation-threat-model`, `held-out-exposure-budget`, `held-out-exposure-ledger`, `grader-validation`, `risk-assessment`, `operational-governance-policy`, `governance-decision` | draft annex |

Each schema is the file `<name>.schema.json`.

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

Validation results are detached. A `validation-envelope-1` binds the
subject type, ID, canonical digest, projection, validation contract, findings,
and output digest; the validated subject never embeds that result.

The schemas and Markdown requirements are jointly normative. Conflict handling
is defined by the [Conformance Contract](../standard/conformance.md).

`workspace-manifest-1` has three and only three Git repository-state modes:
`tree_snapshot`, `bounded_ancestry`, and `full_ancestry`. Their object-closure,
gitlink, LFS-exclusion, and fail-closed verdict semantics are owned by the
[Git Repository-State Boundary Contract](../standard/standard.md#git-repository-state-boundary-contract-scope-003),
not by schema annotations. Schema `$comment` fields are informative navigation.
