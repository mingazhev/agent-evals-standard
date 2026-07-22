# Changelog

All normative changes to the Agent Evals Golden Standard are recorded here.
Versions follow Semantic Versioning.

## 4.0.0 — 2026-07-22

- added conditional decision-surface inventories and activation controls that
  cover valid alternative paths without prescribing a reference trajectory;
- added Case QA controls for model-grader identity, order, and verbosity bias;
- defined transcript evidence as an append-only pre-transform runner stream;
- introduced typed interactive actors, event attribution, and model-simulator
  validation;
- required post-decision assurance plans and fail-closed escalation for changed
  configurations, degraded production concordance, and missing evidence;
- released Case Contract 3.0.0 (`agent-eval-case-3`), Case QA Contract 3.0.0
  (`case-qa-record-3`), Scorecard Contract 3.0.0
  (`agent-eval-scorecard-4`), semantic-validation-2.0.0, and associated
  governance and conformance schema revisions, including typed assurance
  observations and Governance Resolution v2.

This is a major release because the new evidence and post-decision assurance
requirements strengthen mandatory conformance and decision semantics.

## 3.0.1 — 2026-07-22

- dedicated the repository contents to the public domain under CC0 1.0
  Universal, removing the previous attribution requirement;
- made no normative changes to the standard or its component contracts.

## Documentation — 2026-07-22

Informative Mermaid diagrams only; no normative change and no independent
version bump.

- `standard/standard.md` — system under evaluation, case lifecycle, run protocol;
- `standard/case-qa-playbook.md` — Case QA activation pipeline;
- `standard/scorecard-contract.md` — outcome priority order and attempt states;
- `standard/integrity-and-semantic-validation.md` — ledger attempt reducer.

## 3.0.0 — 2026-07-21

First public, implementation-independent release.

- extracted the normative standard, schemas, governance policy, and templates
  from the original implementation repository;
- replaced Docker-specific baseline identifiers with the technology-neutral
  `isolatedExecutionBackend` and `noContainerControlPlaneAccess` identifiers;
- added an explicit conformance contract and rules for public conformance
  statements, extensions, deviations, and document/schema conflicts;
- defined scheduled cells and retry lineages so conservative bounds remain
  within `[0,1]`, and made run-level case/trial contributions explicit;
- added mandatory semantic validation, RFC 8785 canonical hashing,
  authenticated evidence manifests, signed append-only ledgers, and signed
  public conformance statements;
- added typed escalation events, operational-policy checks, immutable
  scorecards, and append-only governance resolution;
- relocated schema references into this repository and separated normative
  requirements from implementation status;
- added a curated informative-source register and public contribution policy.

This is a major release because stable gate identifiers changed.

## 2.1.0 — 2026-07-21

Internal predecessor. It reconciled gate pre-registration with sealed post-diff
rules, introduced the trusted measurement-boundary gate, and tightened claim,
governance, lifecycle, and Case QA semantics. It was not published as a release
of this standalone repository.
