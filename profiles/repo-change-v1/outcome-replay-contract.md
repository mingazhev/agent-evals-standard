# Repository Change Outcome Replay Contract

- Status: bundled profile contract
- ID: `repo-change-outcome-replay-contract`
- Version: 0.1.0
- Outcome profile: `workspace-change-v1`

This contract defines the result and material-evidence semantics of
`workspace-change-v1`. The adopter supplies the executor; this repository ships
no replay implementation. Before execution, the run's `replayImplementation`
**MUST** bind a committed implementation manifest containing the
exact executor code, this contract, validation plan, Git version/configuration,
resource limits, and any adjudication protocol. Its contract binding **MUST**
match the outcome profile's `replayContract`. The manifest uses the adopter's
format; the run reference authenticates its stored bytes. A separate executor
registry is not required. Direct comparisons **MUST**
use the same replay semantics and validation plan.

## Terminal evidence

This bundled profile requires exactly one `repositories[]` entry in the
workspace manifest (`single_repository_root`); submodule gitlinks are outside
this profile. A multi-root profile needs its own per-root artifact packaging
and reconstruction contract.

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
   Capture, diff generation, and apply **MUST** neutralize content transformations
   from in-tree attributes and configuration (line endings, encodings, ident
   expansion, and filters), and preserve file modes. The sealed evaluator-owned
   overrides **MUST** take precedence over `.gitattributes`; Git's
   [`info/attributes`](https://git-scm.com/docs/gitattributes) is one such mechanism.
2. Apply the entire patch from the repository root to the base index and
   working tree, using the pinned `git apply --index`.
   Partial application, path filtering, three-way fallback, whitespace repair,
   and unsafe-path overrides **MUST NOT** be used to make a patch pass.
3. Compare the reconstructed repository state with the independently captured
   state on which the required outcome checks ran. The runner-check **MUST**
   authenticate a capture record containing the complete delivered `files` and
   `gitlinks` inventories, content-addressed file bytes, and their recomputed
   [`treeDigest`](../../standard/evidence-and-validation-contract.md#git-workspace-digest-projections).
   `gitlinks` **MUST** be empty; a gitlink in the base or result yields
   `insufficient_evidence`.
   This reuses the tree projection, not a base-only workspace manifest.
   `mediaType` is `application/octet-stream` for every captured and reconstructed
   entry; bytes and lengths describe raw filesystem bytes (raw target bytes
   for symlinks), without clean/smudge or line-ending normalization. Replay
   **MUST** reproduce its paths, bytes, modes, and symlink targets.
   Both digests **MUST** agree. The capture includes every regular
   file and symlink below the root, including untracked and ignored files,
   except Git administrative metadata and declared exclusions. The implementation manifest's validation plan
   **MUST** enumerate any excluded repository-relative paths before execution;
   exclusions **MUST NOT** supply any part of the agent's solution. Every
   non-excluded solution file **MUST** be included in the patch.
   Unsupported paths, gitlinks, or transformations that prevent exact raw-byte
   reconstruction yield `insufficient_evidence`.
4. Require a nonempty base-to-result state difference for `workspace_changed`,
   using the same capture rules and exclusions for both states,
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
