# Git Repository-State Boundary Contract

- Status: unpublished 0.1.0 publication candidate
- Version: 0.1.0
- Purpose: the executable repository-state contract invoked by `SCOPE-003`

The normative keywords **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**,
**SHOULD NOT**, and **MAY** have the meanings defined in RFC 2119 and RFC 8174.
Only uppercase keywords are normative.

### Git Repository-State Boundary Contract (`SCOPE-003`)

At A1, `case.repository` binds the URI, base commit, and visible-history mode.
The verifier resolves the immutable commit, verifies its tree and the declared
history projection, and confirms oracle isolation under `HOLD-001`. The detailed
manifest transport below is required at A2 and above; it is not an additional
A1 artifact requirement.

At A2 and above, `workspace-manifest-1` is the executable repository-state identity.
Each repository entry **MUST** select exactly one closed mode:

- `tree_snapshot` — `baseTree` identifies the selected root tree. The object
  graph contains exactly that tree's recursive tree/blob closure, exposes no
  refs, and contains no commit objects.
- `bounded_ancestry` — `baseRevision` identifies a commit exposed through
  exactly one sealed local branch ref. `maxParentDepth` counts parent edges from
  that commit. The graph contains every commit whose minimum parent-edge
  distance is at most that limit and the complete recursive tree/blob closure
  of each such commit. `boundaryParentObjectIds` is the exact sorted set of
  parent IDs referenced beyond the limit and not otherwise included; omission
  before the boundary or embedding an object beyond it is invalid. The set
  **MUST** be empty when no included boundary commit names a parent beyond the
  limit, including a bounded projection whose selected base is a root commit.
- `full_ancestry` — `baseRevision` identifies a commit exposed through exactly
  one sealed local branch ref. The graph contains every reachable parent commit
  and the complete recursive tree/blob closure of every reachable commit. No
  shallow boundary is permitted.

For every mode, the verifier **MUST** recompute each Git object ID from the
declared object format and raw uncompressed object content, recompute the graph,
tree, and workspace digests using the invoked
[Git workspace digest projections](evidence-and-validation-contract.md#git-workspace-digest-projections),
and require exact object closure: missing,
unreachable, future, duplicate, or wrong-type objects are invalid. `files[]`
**MUST** equal the flattened non-directory, non-gitlink entries of the selected
base tree byte-for-byte, including Git mode. The only refs permitted are the
single declared base branch ref in commit-based modes; `tree_snapshot` permits
none.

Version 0.1.0 represents a Git path only when every raw tree-entry name is
well-formed UTF-8. Decoding and re-encoding each manifest path component
**MUST** reproduce those bytes exactly; implementations **MUST NOT** normalize
Unicode. A component **MUST** be nonempty, **MUST NOT** be `.` or `..`, and
**MUST NOT** contain `/`, `\`, or NUL. Flattened file, gitlink, and non-root
workspace repository paths **MUST** be relative slash-separated paths with no
empty component, leading slash, or drive-absolute prefix. `repository.path`
**MAY** be `.` only for a repository at the workspace root. Subject to those
exclusions, spaces and all other Unicode scalar values with a well-formed UTF-8
representation are permitted.
`files[]` and `gitlinks[]` **MUST** be strictly ordered by unsigned
lexicographic comparison of their complete UTF-8 path bytes. A repository with
a non-UTF-8 tree-entry name is outside the executable path contract in 0.1.0;
it **MUST NOT** be silently decoded with replacement characters.

This UTF-8 boundary applies only to Git path identity. Commit objects remain
raw byte strings for hashing and closure. Their structural `tree` and `parent`
headers **MUST** contain the required ASCII names and hexadecimal object IDs,
but other header values and commit-message bytes **MUST NOT** be rejected merely
because they are not UTF-8.

A base-tree entry with Git mode `160000` **MUST** have exactly one matching
`gitlinks[]` record. That record **MUST** name a separate repository entry whose
workspace-relative path equals the containing repository path joined with the
gitlink path (`gitlink.path` alone when `repository.path` is `.`), whose commit-based
`baseRevision` equals the gitlink target and whose Git object format equals the
containing repository's format. The gitlink target is not embedded in the
containing repository's object graph. A missing, ambiguous, tree-only, format-
or revision-mismatched linked repository is invalid.

Version 0.1.0 does not define Git LFS object transport, authorization, or
materialization. A reachable blob recognized as a Git LFS pointer therefore
makes the workspace manifest invalid; `.gitattributes` without a reachable LFS
pointer is not by itself invalid. A later contract may add LFS only with
content-addressed payload identity, authenticated retrieval, byte-level
materialization verification, and offline replay semantics.

Schema validation alone does not establish this boundary. At A2 and above, a repository-state
verifier that implements algorithm `git-repository-state-v1` and is pinned in
the sealed run manifest **MUST** execute all rules above. Any
unresolved base identity, reference, object, gitlink, LFS, projection, or digest
condition yields `insufficient_evidence` for case activation and for every
dependent positive claim or conformance claim; it **MUST NOT** be downgraded to
a warning or `not_applicable`. A passing repository-state verdict establishes
only immutable Git input identity and closure, not material repository
grounding, task validity, or outcome correctness.

A repository URL, ticket link, copied code fragment, or output location alone is
insufficient. The case contract **MUST** record each of the four tests as
holding, with a rationale that an independent reviewer confirms during Case QA
(`CASE-004`). Making bytes unavailable, citing an arbitrary repository blob, or
adding a repository-dependent side condition **MUST NOT** bootstrap an otherwise
general-agent claim into scope; a reviewer who cannot confirm a test records it
as failed and the case stays `candidate`.

In scope are repository changes; repository research, debugging, review,
security, and test design; repository-bound requirements, plans, architecture,
API, migration, and threat models; and release, observability, rollback, runbook,
or incident artifacts evaluated in controlled operational fixtures or
simulations. Clarification, handoff, and multi-actor coordination are ancillary
to those outcomes, not standalone capability claims.

Out of scope are general-agent capability claims; unrelated office, business,
customer-support, embodied, or arbitrary-computer-use work; and open-ended web
research without a repository-grounded deliverable. The breadth of the evaluated
implementation and the channel through which it delivers a result do not decide
applicability: only the bounded evaluated work and claim may enter scope, and
both **MUST** pass the four `SCOPE-003` tests. Every case environment **MUST**
declare `evaluationMode: controlled_fixture` or
`evaluationMode: simulation` and `productionActionAllowed: false`. Real
production actions **MUST NOT** become evaluation cases, even under operational
authorization. Live or unsealed production telemetry **MAY** support only
validity or post-decision assurance. It **MUST NOT** become task input, trial
outcome evidence, or a scheduled cell, and it does not convert production
operation into a trial. Version 0.1.0 defines no production-derived fixture
input: every case environment declares `inputOrigin` as `synthetic` or
`public`. An adopter that needs sealed, redacted production snapshots as
fixture input adds that path as a namespaced extension under `CONF-003` with
its own provenance, authorization, redaction, and isolation evidence.

The base layer defines common identity, isolation, experiment, evidence,
accounting, claims, risk, and governance requirements. An evaluation profile
only narrows this repository-SDLC base to capabilities, outcome profiles,
environments, gates, controls, and metrics. It **MUST NOT** add a new domain or
weaken the base. A new domain requires a separate sibling base or domain
standard. Version 0.1.0 defines no conformance, or compatibility
relation between that sibling and this standard; copied or similarly named
rules do not create one.

Profile distribution and equal treatment of bundled and adopter-defined profiles
are governed by [Conformance](conformance.md#base-and-evaluation-profile-model).

The base invariants are an internal foundation, not a standalone claim for
agents outside this applicability boundary.

Version 0.1.0 intentionally defines no domain-neutral parent standard.

In the requirement name “universal gates,” `universal` means every conforming
repository-SDLC evaluation inside this boundary. It never means agents or
agent evaluations generally.

Use the following composition decision before creating a new contract. The
choice follows semantics, not directory layout or naming preference:

| Needed change | Contract to create or change | Boundary test |
| --- | --- | --- |
| Narrow the repository-SDLC base | a new profile that narrows the base | Every field is a permitted subset, preservation, or strengthening under `PROFILE-001`; no new capability family, interaction mode, normalized primary outcome, or weaker obligation appears. |
| Cover repository-SDLC work that cannot be expressed under the current base | a new base revision, followed by a compatible evaluation profile | Passing `SCOPE-003` alone does not authorize additions or semantic substitutions forbidden by `PROFILE-001`. |
| Define how one work-product class reaches terminal results | outcome profile | The change concerns terminal evidence, valid alternatives, evidence modes, gates, failure taxonomy, native outcomes, or claim compatibility. Each consuming evaluation profile must separately allow and authenticate it. |
| Add adopter-specific, stricter metadata or decision controls without changing base semantics | namespaced extension | The addition fits a schema-declared extension container or a permitted pointer to a separate namespaced artifact and satisfies `CONF-003`. |

A change that introduces a non-repository domain is none of these; it requires
a sibling base or domain standard. When more than one row applies, each layer
**MUST** receive its own artifact and explicit authenticated binding rather than
combining the changes under the label `profile`.
