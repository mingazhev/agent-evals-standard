# Adoption Guide

- Status: unpublished 0.1.0 publication candidate
- Version: 0.1.0
- Purpose: an informative reading and dependency guide for a draft-conforming
  case, experiment, scorecard, and conformance statement. The linked primary
  contracts determine the requirements.

Use the [requirement registry](requirements.md) to find each rule's authoritative
location. Measurement and governance share a preparation path; governance
planning branches **before** the run it will judge:

```mermaid
flowchart LR
  A[Pin commit and select intended use] --> P[Prepare policy, risk and assurance]
  P --> B[Author case and activate via Case QA]
  B --> C{Intended decision}
  C -->|Capability| R[Seal and execute experiment]
  C -->|Governance| G[Seal decision plan and held-out controls]
  G --> R
  R --> S[Scorecard and detached validation]
  S --> E[One conformance statement per target]
  S --> D[Governance decision if pre-planned]
  D --> M[Assurance monitoring after approval]
```

Conformance is claimed per target, not globally. You can be case-conformant
today without claiming decision conformance. Each statement names exactly one
target and covers every requirement registered for that target. A deviation
records the unsupported rule and affected claim restrictions; it does not
permit omitting a required coverage row ([Conformance](conformance.md)).

## Local development

The repository validates itself with Node tooling:

```bash
npm ci
npm run check          # repository consistency: schemas, $ref resolution, links
npm test               # full corpus: fixtures, vectors, and verifier tools
npm run release:check  # pre-publication gate (check:generated + tests + evidence readiness)
```

Machine-verifiable expectations are captured as positive and negative
[conformance fixtures](../conformance/fixtures/) and verified by `npm test`.
If you change a schema or a normative requirement, add or update fixtures and
run `npm test` in the same pull request.

## Core path (measurement)

### 1. Pin the draft

The standard is an unpublished `0.1.0` candidate. Record the exact commit and
the version `0.1.0`; after publication you must additionally pin the protected
annotated tag `v0.1.0`. Every artifact you produce later references these pins.
Saying “based on” the standard is not a conformance claim.

### 2. Prepare policy, risk, and assurance

Select the intended decision class and risk/assurance path
under [ASSURE-001 and RISK-001](standard.md#assurance-levels). The authenticated
operational policy determines the assurance minimum even for capability
claims.

The bundled [Governance Policy](governance-policy.md) and
[Escalation and Stop Matrix](escalation-stop-matrix.md) fix base assurance floors
and event semantics but leave adopter thresholds, owners, and SLAs unset.
Prepare authenticated adopter-owned instances before the Case QA and run stages
that bind them. Their schemas are
[`operational-governance-policy.schema.json`](../schemas/operational-governance-policy.schema.json)
and [`operational-escalation-matrix.schema.json`](../schemas/operational-escalation-matrix.schema.json).
An unset required value blocks the affected path.

### 3. Author a case

Read the [Case Lifecycle Requirements](standard.md#case-lifecycle-requirements)
and the [Authoring requirements](standard.md#authoring) in the core standard,
then produce a `case.json` that satisfies
[`schemas/case.schema.json`](../schemas/case.schema.json).

A case binds exactly one effective [evaluation profile](../profiles/), one
outcome profile shared by all its cells, one or more capability families with mapped
work-artifact types, an applicability contract, a Git workspace manifest, a
claim registry, and a sealed risk assessment. The bundled executable profiles
are `repo-change-v1` and read-only `repository-review-v1`; they demonstrate
interoperability mechanics, not empirical validity.

Checklist:

- [ ] `case.json` validates against the case schema
- [ ] the resolved evaluation profile and outcome profile are bound with digests
- [ ] every capability family has at least one material mapped work-artifact type
- [ ] the Git workspace is sealed with oracle-isolated state and visible-history closure
- [ ] risk assessment, inherent risk tier, leakage controls, and contamination
      metadata are recorded
- [ ] every decision surface is `checked`, `covered_by_final_state`,
      `not_applicable`, or an explicit declared gap with claim restrictions
- [ ] every claim in the claim registry resolves

### 4. Activate via Case QA

Before a case may enter `active`, run the [Case QA Playbook](case-qa-playbook.md)
stages and record the result in a `case-qa-record.json`
([`schemas/case-qa-record.schema.json`](../schemas/case-qa-record.schema.json)).

Use the outcome-specific known-good, known-bad, trivial-strategy, and
alternative-result controls in Stages 3–7, followed by stability validation.
A reference result is one possible known-good control. For `already_satisfied`,
the declared empty-diff control is expected to pass. Stage 7 allows
`not_applicable` only through the authenticated singleton-validity proof.
The playbook defines the complete activation evidence; its semantic validation
precedes `active` and no blocking defect may remain open.

### 5. Seal the experiment and any decision plan

Before the first trial, seal the pre-run manifest, the statistical plan, the
risk assessment, and the scheduled-cell commitment. For governance use, also
seal the held-out exposure controls and an immutable decision plan with the
evidence level, thresholds, zero-tolerance gates, expected governance statuses,
and approve/reject/insufficient-evidence conditions.

A diagnostic or development run supports iteration; it cannot acquire a missing
governance plan or held-out controls retroactively.

### 6. Run and emit a scorecard

One run = one sealed experiment with one or more arms + one scorecard
([`schemas/scorecard.schema.json`](../schemas/scorecard.schema.json)). After the run, the
scorecard must show, in order: experiment identity, arms, and cells; validity,
hard-gate and governance statuses; one trial result for each resolved cell;
claims and claim results; metrics, cost, and provenance. Schema validation is
necessary but not sufficient: the
[Integrity and Semantic Validation Contract](integrity-and-semantic-validation.md)
recomputes hashes, formulas, ledger continuity, verdict implications, and
outcome replay for claim-bearing cells.

### 7. Publish a conformance statement

Publish a signed statement
([`schemas/conformance-statement.schema.json`](../schemas/conformance-statement.schema.json))
that names the version and commit pins, its single target, typed evidence
locations and hashes, deviations with claim restrictions, and the issuer
identity. The target record also contains the closed
requirement-coverage matrix required by `CONF-002`: exactly the requirements
whose authenticated [requirement-registry](requirement-registry.json) entry
includes the claimed target, each with a signed
`conformance-applicability-contract-1` whose rule predicate binds the digest of
that registry entry.

A conforming claim is the signed statement plus a separate signed
`validation-envelope-1` whose subject digest equals the statement digest; an
unsigned statement or a missing envelope is an unauthenticated assertion, not
conformance.

You can claim `suite`, `case`, `evaluator`, `experiment`, or `decision`
conformance in separate statements. `evaluator` additionally requires enforcement
of the invariant, gate, evidence, and trust-boundary requirements
registered for the evaluator target; `experiment` additionally requires a
conforming suite and cases, a conforming evaluator, and an immutable scorecard
with authenticated ledgers.

## Governance path (decisions)

These steps consume the validated evidence from the pre-planned governance run.

### 8. Make a governance decision

Decisions use [`schemas/governance-decision.schema.json`](../schemas/governance-decision.schema.json)
and the [decision-record template](../templates/governance-decision-record.md).
An approval additionally binds a post-decision assurance plan. Resolutions,
waivers, renewals, and rollbacks are appended to the signed
governance-resolution ledger; the scorecard itself is immutable.

### 9. Monitor via assurance observations

Every expected monitoring window appends a typed assurance observation
(`assurance-observation.schema.json`). Missing, late, or unauthenticated
evidence triggers `assuranceEvidenceMissing` and suspends the affected
approval.

## Frequently used rules

- **Pre-registration (I3).** Everything that decides a verdict - case set,
  thresholds, gates, statistical plan, success definition - is sealed before
  the run and cannot be changed after results are observed.
- **Non-compensation (I1).** An acceptance, security, or policy violation
  cannot be offset by quality, cost, or composite scores.
- **Fail closed (I10).** An indeterminate gate or blocker is not a silent pass.
- **Evidence bounds claims (I6).** Positive, comparative, and governance claims
  are limited to the pre-declared target population, strata, and statistical
  plan; `insufficient_evidence` is a verdict, not a failure.
- **Evidence fits the construct (I9).** Correctness and quality must use the
  strongest evidence that directly measures the declared construct;
  deterministic verification is required when the outcome is objectively
  executable or mechanically inspectable, and model-based grading cannot be the
  sole evidence for a hard safety gate or deterministic fact.

## What the standard deliberately does not do

This repository provides no evaluation runner, grader, benchmark cases,
certification, or leaderboard. If you need those, this standard is the contract
your implementation should satisfy, not the implementation itself.
