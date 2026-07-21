# Changelog

All normative changes to the Agent Evals Golden Standard are recorded here.
Versions follow Semantic Versioning.

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
