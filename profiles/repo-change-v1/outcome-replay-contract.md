# Repository Change Outcome Replay Contract

- Status: bundled profile contract
- Version: 0.1.0
- Outcome profile: `workspace-change-v1`
- Executor: `agent-evals-standard.repo-change-outcome-replay`

This contract owns the result and material-evidence semantics implemented by the
bundled executor. Its exact bytes and the executor bytes are authenticated by
the distribution outcome-replay executor registry. These rules apply only when
`workspace-change-v1` is selected; they are not base requirements for another
outcome profile.

## Terminal evidence

A `solved` result **MUST** resolve exactly one authenticated, content-addressed
`workspace_diff`. `correct_refusal` instead requires the registered safe-refusal
and applicability records. `already_satisfied` requires the registered sealed
base-state record. Neither alternative fabricates a diff.

The executor **MUST** bind every result to the exact case, scheduled cell,
attempt, arm, raw workspace-manifest digest, workspace-root digest, receipt-fact
projection, material-evidence projection, and executor ID, version, and digest.
An unresolved, passenger, substituted, unauthenticated, or cross-subject
artifact fails replay.

## Git diff serialization and materiality

`workspace_diff` is a strict UTF-8 Git unified-diff serialization. The executor
**MUST** decode canonical Git C-quoted paths, including octal-escaped UTF-8
bytes, and accept safe repository-relative Unicode paths and ASCII spaces in
both quoted and ordinary Git headers. It also accepts the unambiguous trailing
TAB field separator emitted by Git on file-marker lines, with an empty field or
a canonical unified-diff timestamp; the TAB is not part of the path. It **MUST** reject malformed quoting,
invalid UTF-8, absolute paths, backslashes, control characters, empty path
segments, and `.` or `..` segments.

Every record **MUST** have one unambiguous, internally consistent `diff --git`
path pair. File markers and rename, copy, or binary operands **MUST** resolve to
that pair. Hunk old/new counts **MUST** equal their parsed context, deletion, and
addition lines; multiple hunks **MUST** have non-overlapping, monotonic old and
new ranges. Singleton metadata and file markers **MUST NOT** be duplicated, and
metadata **MUST** precede hunks. Create and delete modes are mutually exclusive;
a paired mode change must change the mode. Rename and copy metadata are mutually
exclusive. `Binary files ... differ` and `GIT binary patch` are mutually
exclusive. A binary patch requires one or two non-empty, length-consistent Git
base-85 payload sections. Every section **MUST** decode and inflate; a `literal`
must inflate to its declared byte length and a `delta` must be a structurally
valid Git delta whose header length equals the inflated instruction-stream
length and whose internal source size, result size, and instructions agree. A `/dev/null`
operand or marker **MUST** be unique to one side and accompanied by the matching
new-file or deleted-file mode.

A rename or copy with similarity below 100% **MUST** serialize the corresponding
textual or binary content change. Similarity of 100% **MUST NOT** carry a content
change; mode metadata may still record an independent mode change.

When an object-index line is present, a creation **MUST** have an all-zero old
object ID and a nonzero new object ID; a deletion **MUST** have the inverse; and
every other change **MUST** have two nonzero IDs. A content-changing record
**MUST** use distinct IDs. A content-preserving similarity-100 or mode-only
record **MUST** use equal IDs. Object-ID abbreviation widths need not be equal.

At least one record **MUST** establish a material textual hunk, file creation or
deletion, changed mode, rename, copy, binary difference, or complete binary
patch. A header, object index, similarity value, no-op mode pair, incomplete
binary section, or unknown metadata line alone is not a material change.

The bundled executor applies authenticated resource ceilings before semantic
parsing: 128 MiB per serialized diff, 20,000 file records, 2,000,000 lines,
8,388,608 UTF-16 code units per line, and 16 KiB of UTF-8 per path. One binary
section is limited to 96 MiB compressed and 128 MiB inflated. Inflation is also
bounded to one byte beyond the declared section length so a small declaration
cannot trigger unbounded decompression. Path-pair metadata is limited to the
maximum encoded size of two bounded paths and at most 64 ambiguous separator
candidates. Quoted paths are decoded against the byte ceiling incrementally.
Git binary payloads require canonical 52-byte non-final chunks and are decoded
into one bounded buffer. Exceeding a ceiling is invalid, not a partial parse. A
deployment needing a larger boundary requires a differently identified
executor and outcome profile with its own authenticated limits and conformance
vectors.

## Work-artifact classification

The executor applies the following deterministic interoperability policy in
order: recognized test paths are `test_change`; recognized build, dependency,
workflow, infrastructure, policy-as-code, and repository configuration paths
are `repository_configuration`; every other safe repository-content path is
`code_change`. The last class deliberately supports source languages and
implementation assets without an extension allowlist. The independently
authenticated case capability-classification record remains the semantic
authority for the evaluated construct; this path policy is a structural replay
check, not permission to relabel a test or configuration artifact as code.

The authenticated executor source is the exact machine definition. Its bundled
policy recognizes common test, spec, end-to-end, integration, acceptance,
functional-test, test-data, fixture, Cypress, and feature-file conventions. It
recognizes common CI/workflow, dependency, build-system, toolchain, container,
infrastructure, deployment, policy-as-code, language-project, lockfile, and
JavaScript tool configuration conventions. These category descriptions do not
authorize an implementation to substitute a looser path heuristic.

Case QA **MUST** establish that the policy matches repository conventions and a
trusted, sealed-activation material-path frame before execution. That frame and
its selectors **MUST** be authorized by the repository owner or a preauthorized
measurement authority; neither the Stage 0 payload nor its producer may invent
their own authority. The actual trial diff does not yet exist at activation, so
this check **MUST NOT** stand in for replay. Replay **MUST** parse the
authenticated `workspace_diff` bytes and rerun the exact registered classifier
on every actual material path. A known collision, ambiguous convention, or
unknown applicability is `insufficient_evidence` and requires a differently
identified, sealed outcome profile and executor. A claimant **MUST NOT**
reinterpret path classes after execution.
Stage 0 records this determination in the Case QA record's
`classificationPolicyApplicability` object, binding the exact outcome profile,
semantic contract, executor, applicability rule, repository-convention
manifest, complete material-path-set digest, and authenticated applicability and
coverage evidence. `classifiedPathCount` **MUST** equal `materialPathCount`, and
both `unknownPathCount` and `collisionCount` **MUST** be zero.

Across all material diffs, the observed path classes **MUST** exactly equal the
case's selected repository work-artifact types. Native substatus is derived, not
claimed freely:

- exact `code_change`, with every path recognized as documentation:
  `documentation_only`;
- other exact `code_change`: `code_only`;
- exact `test_change`: `tests_only`;
- exact `repository_configuration`: `configuration_only`;
- exactly `code_change` plus `test_change`: `code_and_tests`;
- every other valid multi-class set: `mixed_repository_change`.

## Evidence modes

`runner-check` binds the exact validation plan and evaluated diff or registered-
alternative terminal projection. `adjudication-record` additionally binds the
arm's sealed `graderSet` and implements `JUDGE-003`: at least two pairwise-
independent blinded raters, one qualification rule, qualification and conflict
evidence commitments, reasons, applicable presentation-order control, agreement
with uncertainty, and a passing verdict from every decision-bearing rater.

`runner-attestation` binds a failed or invalid exact runner-check set to the
sealed workspace. `measurement-validity-record` binds that runner record, the
same workspace and fact projection, and a verifier independent from claimant
and runner. Evidence-kind labels are closed; a wrong schema, subject, authority,
protocol, workspace, or evidence set fails replay.
