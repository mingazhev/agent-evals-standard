# Agent Evals Golden Standard

A versioned, implementation-independent standard for evaluating software
engineering agents and using evaluation evidence in capability, comparison,
and governance decisions.

The standard is intentionally documentation-only. JSON Schemas in `schemas/`
are normative machine-readable documents; this repository contains no runner,
grader, benchmark cases, provider integrations, or reference implementation.

## Current release

- Golden Standard: **3.0.1**
- Scorecard Contract: **2.0.0**
- Semantic Validation Contract: **semantic-validation-1.0.0**
- Governance Policy template: **governance-policy-template-1.0.0**
- Escalation and Stop Matrix template: **escalation-stop-matrix-template-1.0.0**

Start with [the Golden Standard](standard/standard.md), then read the
[glossary](standard/glossary.md) and
[conformance contract](standard/conformance.md).

## Normative artifacts

| Artifact | Purpose |
| --- | --- |
| [Golden Standard](standard/standard.md) | Invariants I1–I13 and lifecycle, execution, judgement, and reporting requirements. |
| [Scorecard Contract](standard/scorecard-contract.md) | Gate registry, outcome taxonomy, statistics, claim status, and provenance. |
| [Case QA Playbook](standard/case-qa-playbook.md) | Required staged evidence before a case may become active. |
| [Governance Policy template](standard/governance-policy.md) | Required shape for an adopter-owned decision policy; deliberately non-operational as shipped. |
| [Escalation and Stop Matrix template](standard/escalation-stop-matrix.md) | Required blocking events and response fields; adopter owners and SLAs are deliberately unset. |
| [Conformance](standard/conformance.md) | Rules for claiming implementation, run, case, or decision conformance. |
| [Integrity and Semantic Validation](standard/integrity-and-semantic-validation.md) | Canonical hashing, authenticated evidence, ledger integrity, and mandatory cross-field validation. |
| [Schemas](schemas/) | Normative JSON contracts for cases, QA records, conformance statements, and scorecards. |

The governance decision template is in
[templates/governance-decision-record.md](templates/governance-decision-record.md).

## Versioning

Releases use semantic versioning for the Golden Standard. Every release is an
immutable Git tag named `vMAJOR.MINOR.PATCH`. Component contracts retain their
own versions and are pinned by each conforming case and scorecard.

- **MAJOR**: incompatible normative change, including renamed stable IDs,
  changed outcome taxonomy, or weaker/stronger required decision semantics.
- **MINOR**: backward-compatible normative addition.
- **PATCH**: editorial correction that cannot change a conforming verdict.

See [CHANGELOG.md](CHANGELOG.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

## Adoption

An evaluator must publish a conformance statement and pin the exact release
tag and commit. Saying “based on” this standard is not a conformance claim.
Unknown extensions, omitted mandatory evidence, and undocumented deviations
fail closed for the affected claim.

## Non-goals

This repository does not provide certification, legal compliance, benchmark
cases, a leaderboard, or an executable harness. It specifies evidence and
decision contracts that independent implementations can satisfy.

## License

Dedicated to the public domain under [CC0 1.0 Universal](LICENSE). You may
copy, modify, distribute, and use this work, including commercially, without
asking permission or providing attribution.
