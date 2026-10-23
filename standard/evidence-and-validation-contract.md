# Evidence and Detached Validation Contract

- Status: unpublished 0.1.0 publication candidate
- Version: 0.1.0
- Requirement IDs: `EVID-001`, `EVID-002`, `DATA-002`

The normative keywords **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**,
**SHOULD NOT**, and **MAY** have the meanings defined in RFC 2119 and RFC 8174.
Only uppercase keywords are normative.

## Integrity model

This standard uses no cryptographic signatures, key management, trusted-time
service, or anti-rollback protocol. Integrity, provenance, and ordering rest on
three mechanisms that every conforming implementation **MUST** apply:

1. **Content addressing.** Every claim-bearing artifact is identified by `id`,
   `version`, and a `sha256:` digest over its stored bytes or over the RFC 8785
   JCS projection its schema names. A reference is a binding only when the
   verifier resolves the bytes and recomputes that digest. A changed byte is a
   different artifact; it cannot be patched into a sealed experiment, scorecard,
   or decision. For profile pointers containing `uri` and `digest`, and case
   profile references containing `{id, version, digest}`, the digest
   **MUST** use the target schema's declared self-digest projection when one
   exists, otherwise SHA-256 of stored bytes. A verifier **MUST** recompute the
   projected digest and verify both the target's self-digest and the pointer;
   copying the self-digest is insufficient. This rule does not override explicit
   digest contracts on other bindings, including `{path, commit, digest}`.
2. **Version-control order.** Every sealed artifact — the run manifest, decision
   plan, and policy instance — and every append-only ledger **MUST** be committed to a
   version-controlled repository before any step that depends on it. The commit
   that first contains a sealed artifact is its seal point. "Before execution"
   means that commit is an ancestor of the commit that first contains any trial
   result for the run. Ledgers are hash chains: each entry binds the digest of
   its predecessor and the verifier recomputes the chain. Hosted repositories
   **SHOULD** use a protected branch that rejects history rewrites, and the
   claimant **MUST** disclose the hosting, branch-protection, and write-access
   settings on which the ordering relies.
3. **Producer identity and authority.** Every evidence artifact names its
   producer `id`, `role`, and `trustDomain`. Whether that producer may create
   that kind of evidence is decided only by an evaluator-controlled authority
   registry or contract established outside evaluated input, never by the
   evidence itself. Where a requirement demands independence, the producers
   **MUST** satisfy the [independence definition](glossary.md#independence).

Residual limit: without signatures, a party with write access to every
repository involved could rewrite an artifact and every reference to it. The
model therefore relies on separated write access — the evaluated arm has none,
and the claimant cannot rewrite a protected branch — and on reviewers being able
to inspect history. An adopter that needs non-repudiation against a hostile
repository administrator **MAY** add a signature scheme as a namespaced
extension under `CONF-003`; that extension cannot weaken any requirement here.

## Canonical evidence artifact

`EVID-001` — At A2 and above, every evidence reference used by Case QA, a
scorecard, semantic validation, or governance **MUST** resolve to exactly one
`evidence-artifact-1` record. The record **MUST** contain:

- a stable artifact ID, immutable URI, and resolvable `payload` locator;
- media type, exact byte length, and `sha256:<64 lowercase hexadecimal digits>`
  over the bytes as stored;
- producer ID, role, trust domain, creation phase, and UTC creation time;
- access class, retention class, retention deadline or disposition rule, and
  applicable privacy or IP restrictions;
- the schema and semantic-contract versions needed to interpret the bytes.

At A1, evidence is referenced as a `{path, commit, digest}` triple under the
[integrity model](#integrity-model); `evidence-artifact-1` records are not
required. At every level, structural document bindings (for example
`runManifest`, `case`, or `workspaceManifest`) keep their schema-defined shape
and resolve directly to the named document. At A2 and above, payload-evidence
references use that shape to locate an evidence-artifact record, which in turn
locates the payload; they do not replace document bindings with a new shape.

The producer's authority for the artifact's schema and creation phase is
established by the [integrity model](#integrity-model), not by a field in the
record.

An immutable URI **MUST** be content-addressed or refer to storage that prevents
replacement under the same identifier. Text, archive, and media bytes **MUST
NOT** be normalized before digest verification. JSON that a contract identifies
as canonical **MUST** satisfy RFC 8785's I-JSON input constraints and use JCS
encoded as UTF-8. A parser **MUST** reject duplicate member names, invalid
Unicode, and numeric values outside the interoperable JCS domain before it
constructs an object; parse-and-overwrite behavior is non-conforming. A manifest
**MUST** have unique artifact IDs, **MUST** reject conflicting records for one
ID, and **MUST** sort records by artifact ID before its own canonical digest is
computed.

The verifier **MUST** reject a dangling reference, digest or length mismatch,
unauthorized producer, wrong creation phase, expired evidence, or access
outside the approved purpose. It **MUST NOT** repair,
relabel, or infer missing evidence.

### Material-byte resolution

An evidence record without accessible subject bytes is metadata, not evidence.
The `payload` locator **MUST** use exactly one of these modes:

- `inline_base64` — canonical RFC 4648 base64 embedded in the record;
- `repository_relative` — a portable relative path below an explicitly supplied
  evidence root; dot segments, absolute paths, and symlink escape **MUST** fail;
- `immutable_external` — a URI resolved only by an explicitly configured,
  authorized resolver.

For every referenced record, the verifier **MUST** resolve the locator, read the
exact stored bytes without normalization, and recompute `byteLength` and
`digest`. The resolved bytes **MUST** match both fields. `mediaType` is
authenticated evidence metadata; when a resolver returns a media type, it
**MUST** equal the record's value. If `uri` is an `artifact:sha256:` content
address, it **MUST** equal `artifact:` followed by the recomputed digest. A
resolver failure, absent bytes, metadata mismatch, unsupported locator mode, or
resolver supplied only by the evaluated scorecard is `insufficient_evidence`.

When a selected outcome profile declares an evidence kind as terminal, that
profile's authenticated semantic contract owns its evidence-kind-specific media
types, non-emptiness rule, and structural validity. Independently of evidence
kind, terminal evidence **MUST** have resolvable non-empty bytes and an
`artifact:sha256:` URI equal to the payload digest. A digest and byte count with
no resolvable payload **MUST NOT** satisfy a terminal-evidence requirement.

## Detached validation envelope

`EVID-002` — At A2 and above, semantic validation **MUST** produce a detached
`validation-envelope-1`. The subject artifact **MUST NOT** contain the envelope
or the completed-envelope digest. This separation prevents a self-hash cycle.
The envelope is published alongside its subject and binds the subject digest; a
verifier discovers it by the publication location (the same directory or a
publication record), not by a field in the subject. A conformance statement
never references its envelope. At A1 the statement is validated by independent
review and no envelope is used.

The envelope's `subject.type` is one of the closed values in
`validation-envelope.schema.json`; the schema enum is authoritative. Its
`claimTarget` is `experiment` or `decision`.

The envelope **MUST** bind:

- the subject digest and one named canonical projection;
- validator ID, contract version, implementation digest, and UTC validation
  time;
- one result for every evaluated requirement ID and the evidence IDs used;
- the aggregate `pass`, `fail`, or `insufficient_evidence` result;
- the complete evidence manifest and either `output: null` or a content-addressed
  output artifact when validation produces a separate deterministic result.

For a conformance-statement subject, the authenticated requirement registry
selects the exact closed check set using both `subject.claimTarget` and the
statement's `assuranceLevel`, under `CONF-002`. For a supporting-artifact subject,
the evaluator-controlled validation contract selects the closed checks of the
named semantic contract for that artifact type and level, and for `case_qa`
subjects its validation stages; it does not require future run results to
activate a case. `subject.claimTarget`
identifies the target that relies on the artifact and does not select that
target's full requirement set. The selected set is fixed outside the subject
and bound by the validator's contract and implementation identity. If the
subject type, level, or applicable Case QA stages do not resolve one closed set,
validation is `insufficient_evidence`; a validator **MUST NOT** substitute a target-wide set.
For a `case_qa` subject, the stage is read from the authenticated QA record and
the selected checks cover that record's applicable Case QA stages only.
A supporting-artifact envelope cannot replace full conformance coverage. The envelope **MUST** contain each selected
requirement ID exactly once and no unselected or unknown requirement ID. Every
evidence ID and finding ID **MUST** resolve exactly once. Because applicability
is resolved before a requirement is selected, a selected check has exactly one
of `pass`, `fail`, or `insufficient_evidence`; it cannot be
`not_applicable`. Aggregate result is derived without discretion: any `fail`
produces `fail`; otherwise any `insufficient_evidence` produces
`insufficient_evidence`; otherwise `pass` is permitted only when every selected
check is `pass`. Empty or incomplete selected-check sets never pass.

The supported projection identifiers have these meanings:

- `full_document_without_digest` — RFC 8785 JCS of the complete JSON document
  after removing only the top-level digest field named by its schema;

An unknown or ambiguous projection yields `insufficient_evidence`.
`sealed_run` and `governance_state` are reserved identifiers with no projection
contract in this version; an envelope using either **MUST** fail closed. A Case
QA record binds its case by the case reference `{path, commit, digest}` instead.
A projection contract **MUST** identify exact included fields and ordering.

A later artifact **MAY** refer independently to the subject digest and the
digest of the completed envelope.

### Validity argument run binding

The `run` binding in `agent-eval-validity-argument-1` uses the
`suite_precontrol_projection_v1` projection. Its digest is SHA-256 of UTF-8 RFC
8785 JCS of the complete, schema-valid run-manifest object after removing only
the top-level `validityArgument` property. No other field is removed or
normalized; optional fields are included when present, absent fields remain
absent, and array order is preserved. The projection includes the exact case
set and all other run fields, while removing the sole run-to-argument reference
that would make the two digests depend on each other.

To create the binding, finalize the run-manifest fields and attachments except
`validityArgument`, then compute the projection digest. Put that digest and the
run ID in the validity argument and obtain the independent review. The review
record **MUST** authenticate SHA-256 of UTF-8 RFC 8785 JCS of the complete
validity argument with only `review.evidence` omitted. All other review fields,
the run binding, and the argument content are included. Commit that review
record, add its reference as `review.evidence`, and commit the final argument;
no other field may change after review. This removes the argument-to-review
self-reference without excluding reviewed claims or baseline definitions.
Add the argument's `{path, commit, digest}`
reference to the run manifest and commit the complete run manifest before any
trial result. A verifier validates the complete run manifest, removes only
`validityArgument`, recomputes the projection digest, and checks it against the
argument's `run` binding. It also checks that `run.id` equals the projected
manifest's `id`, `run.artifactVersion` equals its `standard.version`, and
`run.schemaId` identifies the run-manifest schema. Any change to another run
field requires a newly reviewed validity argument. The verifier also recomputes
the argument's review projection and compares it with the authenticated review
record; merely resolving `review.evidence` is insufficient.

## Evidence minimization and retention

`DATA-002` — Evidence collection **MUST** be purpose-limited. Secrets, hidden
oracles, personal data, customer content, licensed code, and unique canary
values **MUST NOT** be copied into scorecards, logs, findings, or reviewer notes
when a digest, redacted extract, or access-controlled pointer is sufficient.
The evidence owner **MUST** define lawful authority, permitted reviewers,
retention, deletion or legal-hold handling, and incident response before
collection. Retention expiry **MUST** make dependent claims expired or
reproducibly preserve an authorized replacement; it **MUST NOT** silently leave
an unverifiable positive claim active.

This requirement invokes the applicable data, privacy, IP, and retention rows of
the [Security Threat Model and Coverage Contract](annex/security-threat-model.md).

Every artifact class **MUST** declare access roles, trust domain, encryption,
external-export rule, retention period, legal-hold behavior, deletion verifier,
and incident response. Agent-visible held-out input sent to a provider requires
prior data-owner authorization and a provider contract consistent with its
access and retention class. Oracle material **MUST NOT** be sent to the evaluated
provider.

Version 0.1.0 defines no production-derived fixture input; an adopter adding
one as a `CONF-003` extension owns its provenance, authorization, redaction,
and isolation evidence under this same `EVID-001` contract.

## Verification order

A verifier **MUST** perform, in order: schema validation; subject-projection
reconstruction; material-payload resolution and byte/length/digest/media checks;
producer-authorization checks; version-control order checks for sealed
artifacts and ledgers; requirement-result recomputation; and aggregate-result
recomputation. Failure at any step yields `insufficient_evidence` for every
dependent positive, comparative, or governance claim.

An implementation **MUST** pass an explicit evidence root for
`repository_relative` payloads or an authorized resolver for
`immutable_external` payloads, resolve every referenced evidence record's bytes,
and propagate any material-payload issue as `insufficient_evidence` before
terminal-outcome selection.

The machine-readable records are
[`evidence-artifact.schema.json`](../schemas/evidence-artifact.schema.json)
and [`validation-envelope.schema.json`](../schemas/validation-envelope.schema.json).

## Integrity and Semantic Validation Contract

- Version: 0.1.0
- Status: unpublished 0.1.0 publication candidate

Checks apply only within the invoking requirement's registered target and
minimum assurance level. A1 uses its primary requirements and schema-defined
references; A2/A3 attachment checks do not create additional A1 obligations.

JSON Schema validates transport shape. It does not establish that hashes are
correct, references resolve, formulas were recomputed, or verdict fields
agree. A scorecard or conformance statement is conforming
only after both schema validation and this semantic validation succeed.

### Git workspace digest projections

These are the exact `git-repository-state-v1` projections invoked by `SCOPE-003`.
Each digest below is `sha256:` followed by SHA-256 of UTF-8 RFC 8785 JCS of
exactly the stated object. Raw Git object IDs remain governed by the declared
Git object format; they are distinct from these SHA-256 commitments.

Before hashing, `repositories[]` **MUST** be strictly ordered by `id`,
`gitObjectGraph.objects[]` by `objectId`, and `gitObjectGraph.refs[]` by `name`,
using ascending ASCII order. File and gitlink ordering follows `SCOPE-003`'s
UTF-8 path-byte rule. Arrays retain this order in every projection; a verifier
**MUST NOT** repair an incorrectly ordered input by sorting it.

| Digest | Exact projection |
| --- | --- |
| `gitObjectGraph.digest` | `{objectFormat, refs, objects}`, plus `baseRef` only when present in the graph. `objectFormat` is the containing repository's value; each ref retains exactly `{name, target}`. Each object becomes `{objectId, type, byteLength, contentDigest}`, where `contentDigest` is `sha256:` plus SHA-256 of its decoded raw `contentBase64` bytes. |
| `treeDigest` | `{files}`, plus `gitlinks` only when nonempty. Each file becomes exactly `{path, mode, mediaType, byteLength, digest}`; its digest hashes the decoded raw file bytes. Each gitlink retains exactly `{path, repositoryId, targetCommit}`. |
| `workspaceRootDigest` | `{repositories}`. Each repository becomes exactly `{id, path, objectFormat, treeDigest, gitObjectGraphDigest, historyProjection}`, plus `baseTree` or `baseRevision` only when present in that repository. `gitObjectGraphDigest` is its recomputed graph digest, `treeDigest` is its recomputed tree digest, and `historyProjection` is the complete schema-valid object. |

The graph and `historyProjection.objectGraphDigest` **MUST** both equal the
recomputed graph digest before the workspace root is accepted. Omitted optional
fields remain absent, not null. No other field enters these projections; in
particular, neither encoded payload bytes nor a digest being computed enters
its own projection. The verifier **MUST** still authenticate payload bytes,
lengths, Git object IDs, closure, and repository-state semantics before accepting
any of these commitments.

### Canonical evidence and detached validation

Canonical bytes, evidence manifests, subject projections, and validation
envelopes follow the
[Evidence and Detached Validation Contract](#evidence-and-detached-validation-contract).
Every scorecard, Case QA record, conformance statement, governance decision, and
other artifact type explicitly registered by `validation-envelope-1` **MUST**
have a detached validation envelope whenever the applicable primary
contract requires one. A ledger state requires an envelope only through a named,
registered subject type and canonical projection; an implementation **MUST NOT**
invent an unregistered `ledger_state` subject. The subject
**MUST NOT** contain or hash its validation envelope or the completed-envelope
digest.
A validator **MUST** reconstruct the named projection rather than remove fields
by guesswork.

At A2 and above, every payload-evidence reference **MUST** resolve to one canonical authenticated
artifact with authorized producer, phase, access, privacy/IP, and retention
metadata. A dangling reference, digest or length mismatch, wrong producer or
phase, unauthorized access, or expired evidence fails the affected path closed.

### Hash-chained append-only ledger

Attempt accounting uses the sole chain definition in the Scorecard Contract's
[Attempt Accounting](scorecard-contract.md#attempt-accounting), algorithm
`sha256-jcs-entry-chain-v1`. The verifier reproduces its entry digests, genesis,
terminal digest, retry lineage, and first-valid selection, reconciles one
terminal entry per dispatch, and leaves undispatched cells unresolved. No
separate state-transition event stream is required.

Ordering and rewrite resistance come from the
[integrity model](#integrity-model): the
ledger's commit history, not a recomputed hash, is what a verifier inspects.

### Required scorecard checks

The versioned semantic validator MUST verify at least the following. Any
failed check produces `insufficient_evidence` for the affected positive,
comparative, or governance claim. A validator cannot repair or silently infer
missing evidence.

| # | Check | Normative requirement |
| --- | --- | --- |
| 1 | Gate set | Every `hardGateFailures` row names a gate that the evaluation profile, case, or `GATE-001` registers, and is backed by the affected attempts' authenticated evidence, resolved through their `evidenceDigest`; the summary row does not add an evidence field. |
| 2 | Governance statuses | When `governanceStatuses` is present, every status obeys the Scorecard Contract's disposition rules and every terminal or `not_applicable` status has the required evidence; at A2 and above every status the operational policy expects is present. |
| 3 | Outcome replay | Per-arm `outcomes` and every selected predicate are recomputed exclusively from the Scorecard Contract's `functional-outcome-v1` and `accepted-outcome-v1` definitions, including transcript and interaction evidence, by executing the verifier's own outcome-replay executor over the selected work-artifact set. Where the outcome profile requires independently graded work, replay also requires the runner-captured work product and a separate authenticated grader assessment. Replay never consumes claimant booleans or substitutes grader output for evaluated work. |
| 4 | Invalid attempts | An invalid attempt (`invalid_infrastructure` or `invalid_capture`) has a null primary outcome, is not accepted, and is excluded from valid-only estimates while remaining in `accounting`, `telemetry`, and identification bounds; agent-attributed interference remains a valid `unsafe_policy_violation` rather than infrastructure invalidity. For each arm the seven `outcomes` counts sum to `validTrials`. |
| 5 | Attempt accounting | `scheduledCells`, `physicalAttempts`, `validTrials`, `invalidAttempts`, `replacementAttempts`, `unresolvedCells`, and the `perCase` rows equal the attempt ledger; every dispatch has one terminal record; every resolved cell selects its first eligible valid trial regardless of success. Each attempt's `validity` is `valid`, `invalid_infrastructure`, or `invalid_capture`; the failed-gate rule requiring a non-null outcome applies only to valid attempts. |
| 6 | Bounds and statistics | Each metric's `identificationBounds` are recomputed from scheduled cells under the Scorecard Contract; component binary-rate bounds stay within `[0,1]` and comparative difference bounds within `[-1,1]`; interval endpoints are ordered; every pass@1/pass^k value is recomputed from consistent valid counts, successes, and `k`. For `pass_hat_k`, the named arm's sealed `trialsPerCase` equals the claim's `k`, with no selection of a subset of scheduled cells. |
| 7 | Aggregation | Per-case contributions, weights, and the run estimate reproduce the declared estimator and the complete case set sealed in the run manifest. |
| 8 | Claim support | `supported` implies valid accounting, a complete sealed run manifest, current Case QA evidence for every case, no coverage or telemetry gap material to the claim, and a recomputed decision rule that passes. |
| 9 | Composite and waivability | A hard-gate failure in any trial included by a declared composite makes that composite unusable for ranking, tuning, capability, governance, or autonomy selection, while the trial remains in the ledger and failure-aware statistics. Every baseline hard gate is non-waivable; Case QA invalidation **MUST NOT** rewrite the failed run or convert it to a pass. |
| 10 | Identity | Every reference — run manifest, attempt ledger, Case QA records — resolves at its commit to bytes matching its digest, and the run manifest's arm identities resolve to authenticated versions or digests. |
| 11 | Cost estimands | Both cost estimands are recomputed from every physical attempt record; the numerator, denominator predicate, success and attempt counts, and `telemetry` rows agree. Missing cost under a fail-closed policy yields `insufficient_evidence`. A zero success count forces `insufficient_evidence`, a null value, and the `zero_success_denominator` reason; the observed cost numerator remains. |
| 12 | Decision surfaces | At A2 and above, decision-surface IDs, materialities, coverage modes, and declared-gap claim restrictions match the case's inventory exactly once in every Case QA `decisionSurfaceValidation`; applicability rules and final-state proofs resolve through deterministic verifiers. No material `declared_gap`, failure, or insufficient verdict supports an affected positive, comparative, or governance claim, and a listed material restriction requires that claim's status to be `insufficient_evidence`. |
| 13 | Lifecycle transitions | A Case QA record with `decision` `quarantined` carries an `invalidation` (reason and nonempty evidence) and is the target of the case's `lifecycle.quarantineRecord`; a re-QA record for a quarantined case returns to `active` only when `active`, and to `candidate` when `rejected`. A QA record binds the case at its candidate commit (the case document without `lifecycle`), and the active case differs from it only by `lifecycle`, so `lifecycle.qaRecord` → QA record → candidate case is acyclic. |
| 14 | Transcript evidence | Transcript evidence is complete for every valid trial. At A1 it resolves, through the attempt's ledger `evidenceDigest`, to the raw runner-captured event stream captured before any compaction or display transformation. At A2 and above it also verifies its append-only root, proves pre-transform capture, and preserves context-management events. A compacted view, summary, cleared tool output, or agent-authored memory cannot satisfy this requirement. |
| 15 | Interaction evidence | Interaction evidence is complete for every valid trial whose case `interactionModeId` is not `noninteractive_repository_task` and `not_applicable` only for that exact mode. At A1 it is the recorded interaction events resolved through the attempt's ledger `evidenceDigest`; at A2 and above it binds the case protocol, attributes every event and shared-state mutation, verifies initial and final state hashes, and has zero unattributed mutations. |
| 16 | Run manifest statistics | The statistics sealed in the run manifest (`stat-defaults-v1` plus overrides) recompute the target population, estimators, intervals, dependence, missingness and retry handling, and multiplicity adjustment. At A2 and above they also cover the held-out exposure and reuse budget. Unregistered looks, post-observation threshold changes, exhausted reuse, or an exploratory result used as a hard gate yield `insufficient_evidence`. |
| 17 | Evidence lifecycle | Every evidence artifact's access, privacy/IP, retention, and expiry metadata agree with the pinned policy. Unlawful, unauthorized, expired, or disposition-inconsistent evidence cannot support a claim. |

### Required evaluator-boundary checks

The run manifest **MUST** identify the measurement stack used for each arm:
every outcome-relevant runner, grader, capture, policy, statistics, and
external-service component. Shared replay components are pinned once through
`replayImplementation`; the remaining arm-specific components use pinned
`arms[].components` entries. These
runner-owned entries describe measurement provenance, not the evaluated
treatment bundle. The runner-owned evidence packet binds the detailed component,
trust-domain, authority, data-flow, and control inventories; the closed manifest
does not embed those inventories. Inventory component IDs are unique; every enforcement contract and data-flow endpoint resolves exactly
once. Trust-domain membership partitions the component set exactly once, and an
`evaluated_arm` domain **MUST NOT** own a `runner_owned` enforcement contract.
The declared data-flow inventory is closed: an unknown endpoint or undeclared
cross-domain flow is `insufficient_evidence`.

Each positive-control pointer **MUST** resolve exactly once to a material
control record whose record bytes and evidence payload reproduce the pointer
digests. It contains a known violation with `expectedDetection: true` and
`observedDetection: true` for the exact bound implementation and detector
components. Each negative-control pointer resolves under the same rules to a
known benign stimulus with `expectedDetection: false` and
`observedDetection: false`. Metadata-only records, unresolved payload bytes,
wrong component bindings, or a control evaluated against different
implementation bytes do not establish the control.

### Required Case QA checks

Case QA activation is itself subject to semantic validation before the case
loader permits `active`; validation is not deferred until a later scorecard.
The validator resolves the versioned calculation contract and raw adjudication
evidence for false-positive and false-negative estimates, recomputes sample
size, estimate, interval, endpoint order, threshold rule, and verdict, checks
expiry and coverage, and binds its result evidence into the Case QA record.
A mismatch, unknown method, expired validation, or non-`pass` verdict blocks
activation.
It also checks that decision-surface validation covers every case surface,
checks the case's inline acceptance checks and hard gates and the QA evidence
for public, hidden, security, and control coverage under `CASE-001`. An unknown
applicability determination or unsupported omission is invalid. It then re-executes or recomputes the typed known-good, known-bad, and alternate-path
controls against their bound check and component digests, requires observed
verdicts to equal the sealed expected verdicts,
verifies that every hidden requirement traces to an exact artifact and location
in the complete sealed agent-visible projection, and rejects a requirement that
depends only on oracle, reference, or post-run information. It verifies QA-role
independence, sequestering, exposure and held-out reuse records, and absence of
tuning on QA outcomes.

For each model-grader use, the validator resolves an unexpired shared
`grader-validation-1` record and verifies sampling-frame applicability, power
or minimum sample, human-label independence and uncertainty, class and stratum
coverage, false-positive and false-negative results, and exact component
digests. It recomputes identity/family-cue, order, length/style, self/family
preference, reference/rubric sensitivity, reasoning-demand, injection,
domain/risk, and drift controls where applicable. An omitted applicable bias,
out-of-frame reuse, or validation-set tuning yields `insufficient_evidence`.

The validator distinguishes `contamination_suspected` from
`contamination_confirmed`. It verifies pre-registered probe statistics,
negative controls, repetitions, false-alarm threshold, exposure and reuse
accounting, provenance, affected scope, and disposition. Suspicion blocks
high-stakes clean-slice use while open; only authenticated canary or access
provenance establishes confirmation.

For cases whose exact `interactionModeId` requires an interaction protocol, it enforces exactly one
evaluated agent, unique actor IDs, protocol references, and passing simulator
goal-persistence, disclosure, termination, refusal, anti-collusion, stability,
and variance evidence for every simulator actor. It also verifies exact
component identity from case to QA to runtime and requires the evaluated-agent
responsibility surface and no-op-agent controls to pass. The named surface is
unique, material, `checked`, backed by the same pinned responsibility verifier,
and recomputed from each trial's event ledger. Typed `not_applicable` is accepted only when the case
does not use the relevant model grader or simulator.

### Required conformance-statement checks

The validator verifies the canonical statement digest and issuer identity, the
exact standard version and source commit (`standard.commit`), the declared
`claim` and `assuranceLevel`, and that every `subject` reference resolves at its
commit to bytes matching its digest and validates against its schema
(`run-manifest-1`, `attempt-ledger-1`, `scorecard-1` for an experiment claim;
`governance-decision-1` and each `scorecard-1` of `subject.scorecards` for a
decision claim). It also checks `restrictions.governanceUse`: `prohibited` at
A1, and for a decision claim `eligible` on the statement and on each supporting
experiment statement. A statement
whose bytes do not reproduce its published digest, or whose issuer is not an
authorized identity, is an unauthenticated self-assertion and is not conforming.
At A2 and above it also verifies the detached envelope published alongside the
statement (found by publication location, not by a statement field), whose
subject digest equals the statement digest; at A1 independent review replaces
the envelope.

For an experiment claim it additionally applies the scorecard checks above to
the bound scorecard, run manifest, and attempt ledger. For a decision claim it
resolves the decision record, recomputes every sealed condition and final
decision, enforces `effectiveAt < reviewAt <= expiresAt`, the policy's maximum
lifetime and risk-tier approval rules, role incompatibilities, and the
non-waivable registry, and verifies that the decision verdict equals the sealed
decision verdict; it requires a conforming experiment claim for each scorecard
the decision used and checks that those scorecards equal the decision's.
An approval **MUST** bind a post-decision assurance plan; a rejected or
insufficient-evidence decision **MUST NOT** bind one. The plan's change
triggers cover every required trigger exactly once and bind its threshold, claim
effect, stop, scope, rollback, revalidation, and resume actions; its production
signals, sampling, evidence-retention, thresholds, owner, SLA, claim effects,
and fail-closed missing-evidence action agree with the operational policy and
escalation-event registry.

Requirement coverage is fail-closed and non-circular. The validator selects
exactly the registry requirements whose `targets` contain the claim and whose
`minimumLevel` is at most `assuranceLevel`; there is no `not_applicable` row.
For each asserted `pass` or `fail` it either replays the registered primary
definition itself (`schema` and `semantic` kinds) or validates a complete
independent accountable review (`manual_governance` kind), and derives the row
status from that work. A status in evidence, an incomplete review, or a
non-independent reviewer cannot establish a result. Missing or invalid evidence
derives `insufficient_evidence`, which derives verdict `not_claimed`. Any
`fail` row requires `nonconforming`, and `conforming` requires
`independentReview.verdict` `confirmed`.

### Post-decision governance state

Version 0.1.0 defines the governance decision record and the post-decision
assurance plan it binds, but no ledger, escalation-event, enforcement-receipt,
or assurance-observation schema. Adopters record post-decision state in their
own version-controlled governance records under the
[Governance Policy](annex/governance-policy.md); those records are outside the
semantic checks of this contract.

### Validator provenance

Results identify the semantic-validator ID, version, implementation digest,
validation timestamp, subject projection and digest, output digest, and evidence
manifest in a detached `validation-envelope-1`. A validator implementation is
testable against positive and negative vectors that it maintains; schema
validity alone **MUST NOT** be presented as a conformance verdict.
