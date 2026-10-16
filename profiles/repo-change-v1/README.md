# Git-backed Repository Change Interoperability Profile

- Status: bundled interoperability profile
- Version: 0.1.0
- Evaluation profile ID: `repo-change-v1`
- Outcome profile ID: `workspace-change-v1`

This profile is the smallest concrete specialization shipped with the draft. It
covers repository changes that produce a workspace diff and can be evaluated by
build, test, security, repository-integrity, and policy evidence. It supports
`CAP.IMPLEMENT_CHANGE` and `CAP.VERIFY_ASSURE`; it does not claim coverage of
the other SDLC capability families.

Cases select one concrete interaction ID from the profile's closed
`interactionModes` set; binary aliases are not accepted. The profile, outcome,
and case all bind the standard
[`work-artifact-registry`](../../standard/work-artifact-registry.json).
Delivered `code_change`, `test_change`, and `repository_configuration` outputs
materialize implementation; an independently graded verification conclusion
materializes as `assurance_report`. Every selected capability must therefore
have a material mapped output rather than appearing as a passenger label.
`code_change` is the fallback ID for material repository-content implementation
changes not recognized as tests or repository configuration. It is deliberately
extension-agnostic, so an unfamiliar programming language does not disappear
from material evidence. The native `workspace_changed` outcome uses
`documentation_only` only when every changed path is recognized as repository
documentation.

An implementation-only case selects `CAP.IMPLEMENT_CHANGE` and one or more
implementation artifact types without selecting `CAP.VERIFY_ASSURE` or an
`assurance_report`. `CAP.VERIFY_ASSURE` is optional and change-bound: when it is
selected, the case must also select `CAP.IMPLEMENT_CHANGE`, at least one mapped
implementation artifact, and `assurance_report` as a material, independently
judged output. Conversely, `assurance_report` is invalid unless
`CAP.VERIFY_ASSURE` is selected. A pure read-only analysis, debugging, security
assessment, or assurance case is outside `repo-change-v1` and must select a
different evaluation and outcome profile. A workspace diff proves the change
outcome; it never substitutes for the assurance verdict.

The profile's accepted terminal alternatives are outcome-specific. Every
`solved` result requires exactly one authenticated content-addressed
`workspace_diff`; the case contract adds the conditional material-work-product
obligation above when verification is selected. `correct_refusal` requires
authenticated refusal and applicability records; `already_satisfied` requires an
authenticated base-state record. The latter two do not fabricate a diff. The authenticated
[case contract](case-contract.json) fixes the profile-specific case shape and
cross-artifact bindings.

The profile is an interoperability example, not a privileged policy or a
universal release threshold. A deployment-specific profile may reuse its
measurement rules under `PROFILE-001`, but it must replace the example
ownership, thresholds, environment bindings, and governance policy before
operational use. The bundled profile establishes only that the contracts fit
together; it never authorizes a deployment claim.

Repository identity is a content-addressed workspace manifest. Each repository
root in that manifest selects one repository-state mode and binds its own object
format, tree digest, exact object graph, mode-specific base tree or revision,
history boundary when applicable, and repository-state verifier; the same per-
root shape is used for one- and multi-repository workspaces.

A conforming replay executor parses strict UTF-8 Git unified diffs.
It accepts canonical C-quoted Unicode paths and material hunks, creation,
deletion, mode-only, rename, copy, and binary records; it rejects unsafe paths
and metadata-only headers. It derives the native substatus from the complete
changed-path classification: `documentation_only` for documentation-only
`code_change`, `code_only`, `tests_only`, or `configuration_only` for the
corresponding singleton class, `code_and_tests` for exactly those two classes,
and `mixed_repository_change` otherwise. An implementation seals the
executor's exact bytes and digest through an outcome-replay executor registry
pinned by its evaluator manifest. Projects with different path
conventions need a differently identified and sealed profile/executor.
The normative profile-owned details are in the authenticated
[outcome replay contract](outcome-replay-contract.md); this README is only an
orientation guide.

The machine-readable entry points are [evaluation-profile.json](evaluation-profile.json)
and [outcome-profile.json](outcome-profile.json). Supporting contracts are
content-addressed by the profile. Positive and negative examples are listed in
[`examples/manifest.json`](../../examples/manifest.json).
