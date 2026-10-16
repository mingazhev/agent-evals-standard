# Validity, threat, and held-out exposure contracts

## Status and applicability

This document is normative for the suite validity argument, reference-baseline
inventory, evaluation threat model, and held-out exposure controls under
`VALID-002`, `VALID-003`, and `HOLD-002`. It defines the minimum interoperable
contracts used by suite, statistical-plan, and pre-run artifacts. Prose-only
declarations and untyped URI pointers do not satisfy these controls: every
binding below is a content-addressed reference `{id, version, uri, digest}`
whose bytes the verifier resolves and re-hashes under the
[integrity model](evidence-and-validation-contract.md#integrity-model).

All contract versions in this release are `0.1.0`.

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

The review decision **MUST** reference the committed review record as an
evidence artifact. The reviewer **MUST** be
[independent](glossary.md#independence) of the owner and every claimant, and
the review commit **MUST** be an ancestor of the first commit containing any
trial result of a run that cites the argument. Reviewer identity equal to the
owner or any claimant identity invalidates the independence claim.

Every claim's construct identifiers **MUST** resolve exactly once. An
unsupported construct, population, claim type, or evidence kind **MUST NOT** be
inferred from a successful score. Missing limitations or an unknown validity
threat **MUST** bound the affected claim or produce `insufficient_evidence`.

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
purposes, the committed authorization record, and independent maxima for:

- agent-visible case exposures;
- unblinded outcome looks; and
- oracle access, whose permitted maximum is zero.

The authorization record names the authorizing person or operated service,
role, and decision time; the authorizer **MUST** be
[independent](glossary.md#independence) of every evaluated arm's configurer. A
claimant-authored identifier does not authorize a budget.

An exposure ledger snapshot **MUST** validate against
`agent-eval-held-out-exposure-ledger-1`. It **MUST** bind the exact budget,
previous snapshot or genesis, monotonic sequence, immutable event records,
totals, remaining budget, saturation state, and seal time. Events **MUST**
identify the case, complete arm identity digest, purpose, authorization, units,
and evidence digest. Each snapshot is committed before the exposure it
authorizes; the commit history, not a recomputed hash, is the evidence against
rollback.

Semantic validation **MUST** recompute totals from the append-only event
sequence, require `remaining = limits - totals`, reject negative remaining
units, and set `saturated=true` when a consumable limit is reached or any
forbidden oracle access occurs. A zero oracle-access maximum is a prohibition,
not a budget that starts saturated. Duplicate, missing, reordered, or
unrecorded events, oracle access, budget mismatch, or a false unsaturated state
**MUST** stop the affected run and produce `insufficient_evidence`. Saturated
cases **MUST** be rotated or the affected claim scope retired according to the
sealed budget.

## Suite and pre-run binding

The suite manifest binds its validity argument, threat model, budget, and
current ledger snapshot directly. The pre-run manifest binds the sealed suite,
the ordered case set, the statistical plan, and a ledger snapshot sealed no
later than the pre-run seal; the projected attempts **MUST** fit within the
remaining budget. After an authorized held-out exposure, the runner **MUST**
append and seal the ledger before a later pre-run manifest can be accepted.
Unknown, absent, stale, or divergent bindings fail closed.
