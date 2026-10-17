# Git-backed Repository Change Interoperability Profile

- Status: bundled interoperability profile
- Version: 0.1.0
- Evaluation profile ID: `repo-change-v1`
- Outcome profile ID: `workspace-change-v1`

This profile covers `CAP.IMPLEMENT_CHANGE` in a single Git repository root.
A case selects one `capabilityFamilyId`, one `workArtifactType`, and one
`interactionModeId`. Its artifact type is `code_change`, `test_change`, or
`repository_configuration`, according to the requested evaluated result and the
[work-artifact registry](../../standard/work-artifact-registry.json).
A code fix may include tests, configuration, and documentation; no path
classifier or per-file type declarations are needed. Supporting checks are
measurement evidence. An independently evaluated assurance report needs its own
case and profile, as do other capability families.

Every `solved` result requires exactly one authenticated, content-addressed
`workspace_diff`. Replay applies it to the sealed base and verifies that it
reconstructs the state used for assessment. `correct_refusal` requires refusal
and applicability records; `already_satisfied` requires a base-state record.
These alternatives do not fabricate a diff. There are no native substatuses.

The adopter supplies the runner and replay implementation, sealed through the
run manifest's existing `harness` component binding. This repository does not
ship an executor or require an executor registry. The normative details are in
the [outcome replay contract](outcome-replay-contract.md) and authenticated
[case contract](case-contract.json); this README is an orientation guide.
The base workspace schema supports multiple roots, but this bundled patch
format deliberately covers one. A multi-root profile must define how each
root's changes are packaged and reconstructed.

This profile is an interoperability example, not a universal release threshold.
An adopter must replace example ownership, thresholds, environment bindings,
and governance policy before operational use, without weakening the base
standard under `PROFILE-001`. The bundled profile never authorizes a deployment
claim by itself.

The machine-readable entry points are [evaluation-profile.json](evaluation-profile.json)
and [outcome-profile.json](outcome-profile.json). Supporting contracts are
content-addressed by the profile. Positive and negative schema examples are
listed in [`examples/manifest.json`](../../examples/manifest.json).
