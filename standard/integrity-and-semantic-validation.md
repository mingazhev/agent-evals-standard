# Integrity and Semantic Validation Contract

- Version: 0.1.0
- Status: unpublished 0.1.0 publication candidate

JSON Schema validates transport shape. It does not establish that hashes are
correct, references resolve, formulas were recomputed, or verdict fields
agree. A scorecard or conformance statement is conforming
only after both schema validation and this semantic validation succeed.

## Git workspace digest projections

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

## Canonical evidence and detached validation

Canonical bytes, evidence manifests, subject projections, and validation
envelopes follow the
[Evidence and Detached Validation Contract](evidence-and-validation-contract.md).
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

Every evidence reference **MUST** resolve to one canonical authenticated
artifact with authorized producer, phase, access, privacy/IP, and retention
metadata. A dangling reference, digest or length mismatch, wrong producer or
phase, unauthorized access, or expired evidence fails the affected path closed.

## Hash-chained append-only ledger

Attempt accounting uses the Scorecard Contract's
[terminal-record chain](scorecard-contract.md#attempt-integrity-fields).
That is the version 0.1.0 transport and root algorithm; no separate
`fromState`/`toState` event stream is required. The verifier **MUST** reproduce
the record-chain roots, reconcile one terminal record per dispatch, preserve
undispatched scheduled cells as unresolved, and verify retry lineage and
first-valid selection under that contract.

Ordering and rewrite resistance come from the
[integrity model](evidence-and-validation-contract.md#integrity-model): the
ledger's commit history, not a recomputed hash, is what a verifier inspects.

## Required scorecard checks

The versioned semantic validator MUST verify at least the following. Any
failed check produces `insufficient_evidence` for the affected positive,
comparative, or governance claim. A validator cannot repair or silently infer
missing evidence.

| # | Check | Normative requirement |
| --- | --- | --- |
| 1 | Gate set | Every baseline gate ID is present in the expected set; expected, added, and evaluated sets obey the sealed post-diff rules; every reported gate is backed by nonempty, valid evidence references. |
| 2 | Governance statuses | Governance-status sets obey the sealed trigger rules, and every terminal or `not_applicable` status has the evidence required by the Scorecard Contract. |
| 3 | Trial acceptance and outcome replay | Trial acceptance and every selected predicate are recomputed exclusively from the Scorecard Contract's `functional-outcome-v1` and `accepted-outcome-v1` definitions, including transcript and interaction evidence; for every claim-bearing cell this recomputation executes the exact evaluator-pinned outcome-replay executor over the exact selected work-artifact set and a receipt that binds the exact case, cell, trial, material mapping, and consumed evidence records. When, and only when, the authenticated outcome profile requires independently graded evaluated work, replay also requires the runner-captured work product and a separate independently authenticated grader assessment, with both digests bound by the receipt. Profiles that do not select that evidence mode prohibit those artifacts rather than treating them as mandatory passengers. Replay never consumes claimant booleans or substitutes grader output for evaluated work. |
| 4 | Invalid trials | An invalid trial has `infra_failure`, is not accepted, and does not enter a valid-only point estimate; agent-attributed interference remains a valid `unsafe_policy_violation` rather than infrastructure invalidity. |
| 5 | Attempt accounting | Scheduled-cell, physical-attempt, retry-lineage, and mutually exclusive state counts equal the ledger; every dispatch has one terminal record; every resolved cell selects its first eligible valid trial regardless of success. Claim-specific success assignments use that trial and the sealed `successDefinition` under `OUT-001`. `completed` attempts have `measurementValidity` `valid` or `invalid`, while `interrupted` and `missing_capture` attempts are `not_assessable`. A missing, substituted, claimant-signed, or fixture-only operational replay receipt makes every dependent claim `insufficient_evidence`. |
| 6 | Bounds and statistics | `unresolvedCellRate = unresolvedCells / scheduledCells`; component binary-rate bounds stay within `[0,1]`, while comparative difference bounds stay within `[-1,1]`; interval endpoints are ordered; every pass@k/pass^k value is recomputed from consistent `validN`, `validSuccesses`, and `k`. |
| 7 | Aggregation | Per-case contributions, weights, strata, and the run estimate reproduce the declared estimator and complete sealed case set. |
| 8 | Claim support | `claim.status: supported` implies valid attempt integrity, a complete sealed plan, all required Case QA evidence with passing FP/FN validation whose intervals and threshold verdicts recompute, no coverage or telemetry gap material to the claim, and a recomputed decision rule that passes. |
| 9 | Composite and waivability | A hard-gate failure in any trial included by a declared composite makes that composite `blocked` with `value: null`; it is unusable for ranking, tuning, capability, governance, or autonomy selection, while the trial remains in the ledger and failure-aware statistics. Every baseline hard gate is non-waivable; Case QA invalidation **MUST NOT** rewrite the failed run or convert it to a pass. |
| 10 | Identity | All identity-critical contract, suite, case, model, agent, environment, evaluator, grader, and formula versions resolve to authenticated digests. |
| 11 | Cost estimands | Both cost estimands are recomputed from every physical attempt record; the numerator, denominator predicate, success and attempt counts, reported and required cost counts, currency, price table, timestamp, and evidence agree. Missing cost with `fail_closed` yields `insufficient_evidence`; a `pre_registered_bound` policy requires the declared bound and reproduces it. `telemetry.status: complete` requires provider/schema, CLI/normalizer when applicable, raw native events, timing boundaries, token components, and tool-call definitions to be present and mutually consistent. A zero success count forces `insufficient_evidence`, null value, and the `zero_success_denominator` reason; the observed cost numerator remains. |
| 12 | Decision surfaces | Decision-surface IDs, materialities, coverage modes, and typed declared-gap claim restrictions match the sealed case inventory exactly once in every activated Case QA record and scorecard result; applicability rules and final-state proofs resolve through their versioned deterministic schemas and verifiers; assignments, triggers, check IDs, and evidence resolve. The only runtime exception is `not_determined` caused by indeterminate applicability, which fails closed. No material `declared_gap`, failure, or insufficient verdict supports an affected positive, comparative, or governance claim. Every declared-gap affected claim ID resolves to the sealed case `claimRegistry`; the selected scorecard claim ID resolves to that registry, and a listed material restriction requires its claim status to be `insufficient_evidence`. |
| 13 | Lifecycle transitions | A Case QA record that quarantines a case binds the `active` source state and an invalidation record; a re-QA record for a quarantined case resolves the pinned case hash, returns to `active` only when activated, and returns to `candidate` when rejected; rejected transitions from every other lifecycle state are invalid. |
| 14 | Transcript evidence | Transcript evidence is `complete` for every valid trial, resolves to the raw runner-produced event stream, verifies its append-only root, proves pre-transform capture, and preserves context-management events. A compacted view, summary, cleared tool output, or agent-authored memory cannot satisfy this requirement. |
| 15 | Interaction evidence | Interaction evidence is `complete` for every valid trial whose case `interactionModeId` is not `noninteractive_repository_task`, and is `not_applicable` only for that exact noninteractive mode; it binds the case protocol, has the same unique actor set, attributes every event and shared-state mutation, verifies initial and final state hashes, and has zero unattributed mutations when complete. |
| 16 | Statistical plan | The pre-registered statistical plan resolves and recomputes the target population, sampling frame and unit, primary and exploratory claims, power or minimum-sample rule, estimators, intervals, dependence, missingness and retry handling, multiplicity adjustment, sequential-look schedule and stopping rule, and held-out exposure and reuse budget. Unregistered looks, post-observation threshold changes, exhausted reuse, or an exploratory result used as a hard gate yield `insufficient_evidence`. |
| 17 | Evidence lifecycle | Every evidence artifact's access, privacy/IP, retention, and expiry metadata agree with the pinned policy. Unlawful, unauthorized, expired, or disposition-inconsistent evidence cannot support a claim. |

## Required evaluator-boundary checks

An `evaluator-manifest-1` **MUST** enumerate every outcome-relevant runner,
grader, capture, policy, statistics, and external-service component. Component
IDs are unique; every enforcement contract and data-flow endpoint resolves
exactly once. Trust-domain membership partitions the component set exactly once,
and an `evaluated_arm` domain **MUST NOT** own a `runner_owned` enforcement
contract. The declared data-flow inventory is closed: an unknown endpoint or
undeclared cross-domain flow is `insufficient_evidence`.

Each positive-control pointer **MUST** resolve exactly once to a material
evaluator-control record whose record bytes and evidence payload reproduce the
pointer digests. It contains a known violation with `expectedDetection: true`
and `observedDetection: true` for the exact bound evaluator implementation and
detector components. Each negative-control pointer resolves under the same
rules to a known benign stimulus with `expectedDetection: false` and
`observedDetection: false`. Metadata-only records, unresolved payload bytes,
wrong component bindings, or a control evaluated against different
implementation bytes do not establish the control.

## Required Case QA checks

Case QA activation is itself subject to semantic validation before the case
loader permits `active`; validation is not deferred until a later scorecard.
The validator resolves the versioned calculation contract and raw adjudication
evidence for false-positive and false-negative estimates, recomputes sample
size, estimate, interval, endpoint order, threshold rule, and verdict, checks
expiry and coverage, and binds its result evidence into the activation record.
A mismatch, unknown method, expired validation, or non-`pass` verdict blocks
activation.
It also checks that decision-surface validation covers every case surface,
authenticates and executes the applicability rule for each of the four case
validation classes, requires `checked` to have a nonempty matching check set and
`not_applicable` to have an empty set, and treats an unresolved, unknown, or
mismatched determination as invalid rather than accepting an author-authored
omission. It then re-executes or recomputes the typed known-good, known-bad, and alternate-path
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

## Required conformance-statement checks

The validator verifies the canonical statement digest and issuer identity,
every target-specific evidence bundle, the exact standard version and source
commit and, for a published release, its exact release tag,
schema and component pins, operational (not template) governance artifacts for
decision targets, deviation-to-restriction coverage, and expiry. For a
decision target it also resolves the normative decision record, recomputes
every sealed condition and final decision, enforces
`effectiveAt < reviewAt <= expiresAt`, the policy's maximum lifetime and
risk-tier approval rules, role incompatibilities, and the non-waivable
registry, and verifies that the decision-envelope verdict equals the sealed
decision verdict. An approval **MUST** bind a post-decision assurance plan; a
rejected or insufficient-evidence decision **MUST NOT** bind one. Its reference is
present in the statement evidence manifest and resolves to the sealed plan
artifact. Its change triggers cover every required trigger exactly once and bind its threshold,
claim effect, stop, scope, rollback, revalidation, and resume actions; whose production signals,
sampling, evidence-retention, thresholds, owner, SLA, claim effects, and fail-closed missing-
evidence action agree with the operational policy and escalation-event registry. A statement whose
bytes do not reproduce its published digest, or whose issuer is not an
authorized identity, is an unauthenticated self-assertion and is not conforming.

Requirement coverage is fail-closed and non-circular. The validator selects
exactly the requirement-registry entries for the claimed target; there is no
conformance-matrix `not_applicable` status. For each asserted `pass` or `fail`
it either replays the registered primary definition itself (`schema` and
`semantic` kinds) or validates a complete independent accountable review
(`manual_governance` kind), and derives the row status from that work. A status
field in evidence, an incomplete review, or a non-independent reviewer cannot
establish a result. Missing or invalid evidence derives
`insufficient_evidence`, which derives target verdict `not_claimed`.

## Post-decision governance state

Version 0.1.0 defines the governance decision record and the post-decision
assurance plan it binds, but no ledger, escalation-event, enforcement-receipt,
or assurance-observation schema. Adopters record post-decision state in their
own version-controlled governance records under the
[Governance Policy](governance-policy.md); those records are outside the
semantic checks of this contract.

## Validator provenance

Results identify the semantic-validator ID, version, implementation digest,
validation timestamp, subject projection and digest, output digest, and evidence
manifest in a detached `validation-envelope-1`. A validator implementation is
testable against positive and negative vectors that it maintains; schema
validity alone **MUST NOT** be presented as a conformance verdict.
