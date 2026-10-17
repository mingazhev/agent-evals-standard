# Repository Change Outcome Replay Contract

- Status: bundled profile contract
- Version: 0.1.0
- Outcome profile: `workspace-change-v1`

This contract defines the result and material-evidence semantics of
`workspace-change-v1`. The adopter supplies the executor; this repository ships
no replay implementation. Before execution, each arm's `harness` component
**MUST** bind a resolvable, digested implementation manifest containing the
exact executor code, this contract, validation plan, Git version/configuration,
resource limits, and any adjudication protocol. The manifest uses the adopter's
format; its component `identity` resolves its bytes and `digest` authenticates
them. A separate executor registry is not required. Direct comparisons **MUST**
use the same replay semantics and validation plan.

## Terminal evidence

This bundled profile supports one repository root per workspace. A multi-root
profile needs its own per-root artifact packaging and reconstruction contract.

A `solved` result **MUST** resolve exactly one authenticated, content-addressed
`workspace_diff`. `correct_refusal` instead requires the registered safe-refusal
and applicability records. `already_satisfied` requires the registered sealed
base-state record. Neither alternative fabricates a diff.

The executor **MUST** bind every result to the exact case, scheduled cell,
attempt, arm, workspace-manifest digest, base and assessed repository states,
consumed evidence digests, and implementation-manifest digest. An unresolved,
substituted, unauthenticated, or cross-subject artifact cannot support a result.

## Patch reconstruction

`workspace_diff` is a Git patch that reconstructs the delivered repository
change from the sealed base. Its semantics are those of the pinned Git
implementation, not a second parser defined by this standard. A conforming
executor **MUST**:

1. Materialize the authenticated base in an isolated repository, with the
   sealed configuration and resource limits. The evaluated arm **MUST NOT**
   control Git configuration, hooks, external diff drivers, or replay tooling.
2. Apply the entire patch from the repository root to the base index and
   working tree, using `git apply --index` or an equivalent implementation.
   Partial application, path filtering, three-way fallback, whitespace repair,
   and unsafe-path overrides **MUST NOT** be used to make a patch pass.
3. Compare the reconstructed repository state with the independently captured
   state on which the required outcome checks ran. Paths, file bytes, file
   modes, symlink targets, and submodule object IDs **MUST** agree. The
   [repository-state contract](../../standard/git-repository-state-contract.md)
   governs state authentication. Temporary grader files and other excluded
   paths **MUST** be declared before execution and **MUST NOT** supply any part
   of the agent's solution. Untracked or ignored solution files are part of
   the delivered state and **MUST** be included in the patch.
4. Require a nonempty base-to-result state difference for `workspace_changed`,
   then evaluate the registered outcome conditions and hard gates. Merely
   changing a file is not evidence that the task is satisfied.

For example, Git's `diff --binary --full-index --no-ext-diff --no-textconv`
can serialize text and binary changes after all solution files have been
included in the compared trees. A plain `Binary files differ` marker cannot
reconstruct changed binary bytes and therefore cannot satisfy this contract.
The [Git diff](https://git-scm.com/docs/git-diff) and
[Git apply](https://git-scm.com/docs/git-apply) manuals define these commands.

Missing bytes, reconstruction mismatch, or exceeded capture/replay limits make
the affected result `insufficient_evidence`; they do not prove agent failure.
An authenticated unchanged or incorrect result remains an assessable
non-success under the outcome rules. Resource limits **MUST** be fixed before
execution and reported; this contract does not prescribe universal byte or
file-count ceilings.

## Evaluated work product

The case's single `workArtifactType` describes the requested, independently
evaluated result, not the extensions or directories of every changed file.
Case QA **MUST** verify that classification against the task and acceptance
conditions before execution. A `code_change` may include regression tests,
configuration, and documentation needed for that change. A `test_change` or
`repository_configuration` may likewise include supporting files. This does
not establish a second capability claim or exempt any changed file from gates.

The profile has no path classifier and no native substatuses.
`workspace_changed` maps to `solved` only when reconstruction and the required
outcome conditions pass. Independently evaluated work products of another
capability family require a separately scoped case and compatible profile.

## Evidence modes

The implementation records each kind below in its own format. Every record
**MUST** carry case, cell, and attempt identity, consumed evidence digests, and
verdict; the sealed implementation manifest fixes how it is interpreted.

`runner-check` binds the exact validation plan and reconstructed state or
registered alternative. `adjudication-record` additionally binds the sealed
grader identities and protocol and implements `JUDGE-003`: at least two
pairwise-independent blinded raters, qualification and conflict evidence,
reasons, applicable presentation-order control, agreement with uncertainty,
and a passing verdict from every decision-bearing rater.

`runner-failure-record` binds a failed or invalid runner-check set to the same
workspace. `measurement-validity-record` binds that record and workspace to a
verifier independent from claimant and runner. A wrong record kind, subject,
authority, protocol, workspace, or evidence set fails replay.
