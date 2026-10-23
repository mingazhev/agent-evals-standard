# Validity, threat, and held-out exposure contracts

- Status: unpublished 0.1.0 publication candidate; draft annex (A2/A3)
- Version: 0.1.0
- Purpose: the validity-argument, evaluation-threat-model, and held-out
  budget-and-ledger contracts invoked by `VALID-002`, `VALID-003`, and
  `HOLD-002`

The normative keywords **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**,
**SHOULD NOT**, and **MAY** have the meanings defined in RFC 2119 and RFC 8174.
Only uppercase keywords are normative.

## Status and applicability

This document is normative for the validity argument, reference-baseline
inventory, evaluation threat model, and held-out exposure controls under
`VALID-002`, `VALID-003`, and `HOLD-002`. It defines the minimum interoperable
attachments that the run manifest binds at A2 and above. Prose-only
declarations and untyped URI pointers do not satisfy these controls: every
binding below uses its schema-defined content-addressed reference (`{path,
commit, digest}` for run attachments; `{id, version, uri, digest}` where the
attachment schema declares that form). The verifier resolves and re-hashes the
referenced bytes under the
[integrity model](../evidence-and-validation-contract.md#integrity-model).

All contract versions in this release are `0.1.0`.

## Validity argument

The validity argument **MUST** validate against
`agent-eval-validity-argument-1`. It **MUST** identify the exact case set,
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

The review decision **MUST** reference the committed review record as an
evidence artifact. The reviewer **MUST** be
[independent](../glossary.md#independence) of the owner and every claimant, and
the review commit **MUST** be an ancestor of the first commit containing any
trial result of a run that cites the argument. Reviewer identity equal to the
owner or any claimant identity invalidates the independence claim.

Every claim's construct identifiers **MUST** resolve exactly once. An
unsupported construct, population, claim type, or evidence kind **MUST NOT** be
inferred from a successful score. Missing limitations or an unknown validity
threat **MUST** bound the affected claim or produce `insufficient_evidence`.

## Evaluation threat model

The evaluation threat model **MUST** validate against
`agent-eval-evaluation-threat-model-1` and cover the declared case set,
evaluation profile, and lifecycle phases. It **MUST** enumerate protected
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
`agent-eval-held-out-exposure-budget-1`. It **MUST** bind the
held-out case scope, identity dimensions, validity interval, permitted
purposes, the committed authorization record, and independent maxima for:

- agent-visible case exposures;
- unblinded outcome looks; and
- oracle access, whose permitted maximum is zero.

The authorization record names the authorizing person or operated service,
role, and decision time; the authorizer **MUST** be
[independent](../glossary.md#independence) of every evaluated arm's configurer. A
claimant-authored identifier does not authorize a budget.

An exposure ledger snapshot **MUST** validate against
`agent-eval-held-out-exposure-ledger-1`. It **MUST** bind the exact budget,
previous snapshot or genesis, monotonic sequence, immutable event records,
totals, remaining budget, saturation state, and seal time. Events **MUST**
identify the case, complete actor identity digest, purpose, authorization,
units, and evidence digest. Events are **pre-exposure debits**: `occurredAt` is
the debit time, and `evidenceDigest` binds an existing authorization record
identifying its subject and the scheduled exposures or reviews it pays for.
For a run, it names the run ID; pre-run Case QA instead names the case and QA
stage. A debit authorizes only the exposures in that record; unused units
cannot be transferred to another authorization. A named run ID **MUST NOT** be
reused for a different sealed run. The authorization does
not bind a future result or final run-manifest digest. The snapshot containing
the debit is committed before the authorized exposure. A debit consumes its
units even if execution is cancelled; there are no refunds or mutable
reservation states. An actual exposure **MUST** map to exactly one paid unit,
and a paid unit **MUST NOT** authorize two exposures. Completion evidence is
recorded separately and does not debit the ledger again.

Each authorized actual exposure **MUST** have an authenticated use record,
linked through the relevant Case QA evidence references or the consuming
scorecard/envelope's evidence manifest. A disclosure covering several held-out
cases consumes one unit per case for each actor. The use record's adopter-defined
payload **MUST** bind the debit event ID, unit
kind and one-based unit index, authorized subject, case ID, actor identity digest,
exposure time, and a distinct exposure identity (attempt, QA-stage, or disclosure
event ID, as applicable). It includes the run ID when the authorization names
one. The unit index **MUST** be within
the event's debit for that kind; the same `(event ID, kind, index)` **MUST NOT**
occur twice, and an exposure **MUST NOT** be assigned multiple use records.
Subject, case, actor, run when present, purpose, and exposure **MUST** match the
authorization. Existing evidence may supply the record if it binds all these
values; non-attempt disclosures still require use evidence. Oracle access
cannot be authorized or assigned a paid unit; it is recorded as a violation
and triggers the stop rule below.

Each snapshot contains the cumulative ordered `events` array; its predecessor's
array **MUST** be an exact prefix. Genesis has `sequence: 0`, no predecessor,
and no events; each successor increments the snapshot sequence by one and
appends at least one event. Event sequences start at 1 and increase by one;
event IDs are unique across the chain. The commit history, not a recomputed
hash, is the evidence against rollback.

Semantic validation **MUST** recompute totals from the append-only event
sequence, require `remaining = limits - totals`, reject negative remaining
units, and set `saturated=true` when a consumable limit is reached or any
forbidden oracle access occurs. A zero oracle-access maximum is a prohibition,
not a budget that starts saturated. Saturation closes new authorizations;
already paid exposures may finish within their limits. Duplicate, missing,
reordered, unpaid, or multiply consumed events, oracle access, budget mismatch,
or a false unsaturated state **MUST** stop the affected run and produce
`insufficient_evidence`. Before further exposures beyond the paid units,
saturated cases **MUST** be rotated or the affected claim scope retired
according to the sealed budget.

## Run manifest binding

The run manifest binds its validity argument, evaluation profile, risk
assessment, policy, and held-out budget and ledger snapshot (`heldOut`)
directly, the decision plan for a governance run, and at A3 the threat model,
security approval, and assurance plan. The ordered case set, the claims, and
the ledger snapshot are sealed together, with the snapshot sealed no later than
the run manifest. Every possible attempt, including the allowed replacements,
and every planned unblinded look **MUST** be covered by unused debits in that
snapshot. `remaining` is capacity for later authorizations, not a second charge
for this run. The runner records actual use against those debits; later runs
**MUST** authenticate the latest ledger and use records so that no unit can be
reused. Unknown, absent, stale, or divergent bindings fail closed.
