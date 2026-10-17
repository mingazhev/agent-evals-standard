# Git-backed Repository Change Interoperability Profile

- Status: bundled interoperability profile
- Version: 0.1.0
- Evaluation profile ID: `repo-change-v1`
- Outcome profile ID: `workspace-change-v1`

This profile is the smallest concrete specialization shipped with the draft. It
covers repository changes that produce a workspace diff and can be evaluated by
build, test, security, repository-integrity, and policy evidence. It supports
`CAP.IMPLEMENT_CHANGE`. The taxonomy's other capability families need other
evaluation and outcome profiles.

Each case selects one `capabilityFamilyId`, one `workArtifactType`, and one
`interactionModeId`. The selected artifact type is `code_change`, `test_change`,
or `repository_configuration` and maps to `CAP.IMPLEMENT_CHANGE` in the profile's
[work-artifact registry](../../standard/work-artifact-registry.json).
`code_change` includes repository documentation and implementation assets.
The 0.1.0 case format cannot express several material artifact types in one
case. Independently evaluated assurance reports and pure read-only assurance
cases are outside this bundled profile; verification used to assess a change
is measurement evidence, not a second evaluated capability.

The profile's accepted terminal alternatives are outcome-specific. Every
`solved` result requires exactly one authenticated content-addressed
`workspace_diff` matching the selected material work-artifact type. `correct_refusal` requires
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
corresponding singleton class. Several material classes require separately
scoped cases under the 0.1.0 case format. An implementation seals the
executor's exact bytes and digest through an outcome-replay executor registry
pinned in the run manifest. Projects with different path
conventions need a differently identified and sealed profile/executor.
The normative profile-owned details are in the authenticated
[outcome replay contract](outcome-replay-contract.md); this README is only an
orientation guide.

The machine-readable entry points are [evaluation-profile.json](evaluation-profile.json)
and [outcome-profile.json](outcome-profile.json). Supporting contracts are
content-addressed by the profile. Positive and negative examples are listed in
[`examples/manifest.json`](../../examples/manifest.json).
