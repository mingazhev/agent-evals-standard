# Validity, threat, and held-out exposure machine contracts

## Status and applicability

This document is normative for machine-authoritative validity, reference-
baseline, evaluation threat-model, and held-out exposure controls under
`VALID-002`, `VALID-003`, `HOLD-002`, `I4`, `I10`, and `EVID-001`. It defines the minimum interoperable
contracts used by suite, case, and pre-run artifacts. Prose-only declarations,
untyped URI pointers, and digest-only component records do not satisfy these
controls.

All contract and component versions in this release are `0.1.0`.

## Resolvable verified machine contract

A machine-authoritative binding **MUST** validate against
`verified-machine-contract-1` and **MUST** bind all of:

- the closed `contractType` and exact `schemaId`;
- an `artifact:sha256:<hex>` URI, stored-byte SHA-256 digest, media type, and
  non-zero byte length;
- a locator resolved relative to the document containing the binding;
- a content-addressed verifier with a declared entrypoint; and
- a content-addressed resolution contract describing how the locator and
  schema are applied; and
- `componentAuthority`, identifying the exact externally rooted authority
  policy that authorizes both components.

Semantic validation **MUST** resolve each locator, compare the stored bytes
with `uri`, `digest`, and `byteLength`, validate the payload against
`schemaId`, and independently authenticate the verifier and resolution
contract. The hexadecimal value in an artifact URI **MUST** equal the declared
digest. Resolution outside the declared base, mutable retrieval, an unavailable
verifier, an unknown schema, or any mismatch **MUST** produce
`insufficient_evidence`.

The authority policy **MUST** validate against
`agent-eval-evaluation-control-authority-policy-1`. Its exact stored-byte
digest and signing root **MUST** be supplied by evaluator-controlled trust
configuration pinned before evaluated input is accepted. The policy
**MUST NOT** obtain authority from a pointer, public key, verifier, resolution
contract, or signature introduced only by the evaluated system or claimant.
The verifier **MUST** authenticate the policy signature, validity interval,
self-digest, issuer role and trust domain against that external configuration.
It **MUST** then require an exact, unique policy authorization for verifier and
resolution-contract identity, version, digest, media type, and entrypoint or
schema. Content addressing without this independent authorization proves byte
identity, not authority.

The binding authenticates exact bytes; it does not make the bound content
substantively adequate. Applicable semantic checks below remain mandatory.

## Validity argument

The suite validity argument **MUST** validate against
`agent-eval-validity-argument-1`. It **MUST** identify the exact suite,
intended use, target population, evaluated constructs, permitted claims,
evidence required for each claim, assumptions, limitations, and an independent
review decision. It **MUST** address construct, internal, external, and
statistical-conclusion validity threats with explicit mitigations and residual
claim effects.

For `VALID-003`, `evidencePlan.referenceBaselines[]` **MUST** contain at least
two uniquely identified structured baselines and
`evidencePlan.incumbentDisposition` **MUST** be present in the exact reviewed
bytes. Every inventory entry records closed kind and agent-involvement values
plus nonempty conditions, resources, tools, and scoring. At least one baseline
has `agentInvolvement: none`.

For `incumbent_available`, `baselineId` **MUST** resolve exactly once to a
`current_workflow` or `incumbent_system` entry and a different entry **MUST** be
a non-agent control. For `no_incumbent_exists`, `baselineId` **MUST** be null,
rationale and evidence references **MUST** be nonempty, the inventory **MUST**
contain a `base_state_no_action` entry, and a different entry **MUST** be a
non-agent control. Unknown status, duplicate IDs, an unresolved incumbent, or a
single entry reused for both required roles yields `insufficient_evidence`.

The review decision **MUST** contain a material binding to a signed
`agent-eval-evaluation-control-authority-evidence-1` record. That record
**MUST** bind the canonical validity-argument projection that excludes only the
evidence pointer, and its actor, verdict, and time **MUST** match the review.
The authority policy **MUST** authorize the reviewer's exact actor ID, role,
trust domain, signature profile, and key for `validity_review`. Reviewer ID,
role, trust domain, or key equality with the owner or any claimant identity
**MUST** invalidate the independence claim.

Every claim's construct identifiers **MUST** resolve exactly once. An
unsupported construct, population, claim type, or evidence kind **MUST NOT** be
inferred from a successful score. Missing limitations or an unknown validity
threat **MUST** bound the affected claim or produce
`insufficient_evidence`.

## Evaluation threat model

The evaluation threat model **MUST** validate against
`agent-eval-evaluation-threat-model-1` and cover the declared suite,
evaluation profiles, and lifecycle phases. It **MUST** enumerate protected
assets, actors and their trust, enforced trust boundaries, attack paths,
impacts, mitigations, detections, residual risk, accountable owners,
assumptions, exclusions, and review triggers.

Every threat reference to an actor, asset, or boundary **MUST** resolve exactly
once in the same model. At least one enforced mitigation and one detection are
required for every threat. A scope change, new tool or provider, boundary
change, contamination event, or material control failure **MUST** trigger
review before new claims are accepted.

## Held-out budget and ledger

A held-out exposure budget **MUST** validate against
`agent-eval-held-out-exposure-budget-1`. It **MUST** bind the suite and
held-out case scope, identity dimensions, validity interval, permitted
purposes, material signed authorization, and independent maxima for:

- agent-visible case exposures;
- unblinded outcome looks; and
- oracle access, whose permitted maximum is zero.

Budget authorization **MUST** bind a signed authority-evidence record to the
canonical budget projection that excludes only its evidence pointer. The
record's actor ID, authorized role, trust domain, decision, time, profile, and
key **MUST** resolve exactly once through the externally rooted policy for
`held_out_budget_authorization`. A claimant-authored identifier or signature
does not authorize a budget.

An exposure ledger snapshot **MUST** validate against
`agent-eval-held-out-exposure-ledger-1`. It **MUST** bind the exact budget,
previous snapshot or genesis, monotonic sequence, immutable event records,
totals, remaining budget, saturation state, and seal time. Events **MUST**
identify the case, complete arm identity digest, purpose, authorization, units,
and evidence digest.

Every accepted ledger snapshot **MUST** contain a signed checkpoint evidence
binding from the policy-authorized independent scheduler or ledger custodian.
The checkpoint **MUST** bind the canonical ledger projection that excludes only
the evidence pointer, the ledger and previous-snapshot sequences and digests,
the prior checkpoint digest, and a monotonic log position. Verification
**MUST** compare it with an evaluator-observed log head obtained outside the
claimant-controlled artifact graph. A parent pre-run signature, an embedded
key, or a locally increasing number is not evidence against rollback, fork, or
checkpoint omission.

Semantic validation **MUST** recompute totals from the append-only event
sequence, require `remaining = limits - totals`, reject negative remaining
units, and set `saturated=true` when a consumable limit is reached or any
forbidden oracle access occurs. A zero oracle-access maximum is a prohibition,
not a budget that starts saturated. Duplicate, missing,
reordered, or unrecorded events, oracle access, budget mismatch, or a false
unsaturated state **MUST** stop the affected run and produce
`insufficient_evidence`. Saturated cases **MUST** be rotated or the affected
claim scope retired according to the sealed budget.

## Suite, case, and pre-run binding

The authoritative binding artifact **MUST** validate against
`agent-eval-evaluation-control-bindings-1`. It **MUST** contain exactly one
`suite` stage, a non-empty canonical ordered `cases[]` with one `case` stage
per entry in that same order, and exactly one final `pre_run` stage. The
aggregate `suiteSliceId` **MUST** select one suite slice whose ordered
`caseIds` equal `cases[]` exactly.

The dependency graph **MUST** be acyclic. A suite owns the direct verified
validity, threat-model, budget, and ledger bindings; it does not contain the
aggregate `evaluationControlBindings` binding. Cases also do not contain that
aggregate binding. The pre-run manifest alone embeds the aggregate after the
completed suite and every selected case are sealed.

The validity argument identifies its suite by
`suite_precontrol_projection_v1`: SHA-256 of RFC 8785 JCS of the suite after
removing only top-level `validityArgument`, `evaluationThreatModel`,
`heldOutExposure`, `digest`, and `signature`. This projection lets the controls
bind suite purpose, composition, exact material cases, and scope without a
validity-argument-to-suite digest cycle.

The aggregate binding's suite and case subjects **MUST** contain resolvable
stored-byte URI, SHA-256 digest, byte length, media type, repository-relative
locator, and the artifact's independently recomputed self-digest. These bind
the completed signed suite and ordered case documents. Every stage
`scopeDigest` **MUST** commit the suite slice, suite material identity, and
every ordered case material identity; an ID-only or unordered set commitment
is insufficient. Its pre-run subject instead
uses SHA-256 of RFC 8785 JCS after removing only top-level
`evaluationControlBindings`, `digest`, and `signature`; including a raw or
full-document pre-run digest would reintroduce a cycle.

The required build order is: seal every selected case; place those exact case
material pointers and matching profile metadata in canonical suite-slice
order; seal the suite with its direct controls; place the exact suite and case
material pointers in the pre-run projection; seal the aggregate control
artifact over the completed suite, ordered cases, and pre-run projection; then
embed the aggregate binding and seal the pre-run manifest. The verifier
**MUST** reproduce this graph, resolve every locator, authenticate each stored
byte and self-digest, and require exact ordered case equality across the
aggregate, selected suite slice, pre-run case set and profiles, first
appearance in scheduled cells, risk assessment, threat model, held-out budget,
and every statistical claim. Missing, extra, duplicate, reordered,
substituted, passenger, or per-case-divergent bindings fail closed.

- The suite stage **MUST** bind the completed signed suite that directly seals
  the validity argument, threat model, exposure budget, and current ledger
  before accepting cases into a claim-bearing slice.
- Each case stage **MUST** bind the corresponding completed signed case that
  the selected suite slice lists by exact material digest, locator, profile,
  scope, and lifecycle. A case outside the budget, suite, or validity scope is
  ineligible.
- The pre-run stage **MUST** bind the exact pre-run identity, a ledger sealed no
  later than the pre-run seal, and a minimum accepted ledger sequence. The
  projected attempt **MUST** fit within remaining budget.

The pre-run aggregate **MUST** contain the coherent suite, ordered case, and
pre-run stage subjects, and
its validity, threat, budget, and ledger bindings **MUST** equal the suite's
direct bindings. Unknown, absent, stale, or divergent bindings fail closed.
After an authorized held-out exposure, the runner **MUST** append and seal the
ledger before a later pre-run manifest can be accepted.
