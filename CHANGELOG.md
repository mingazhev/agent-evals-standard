# Changelog

All normative changes to the Agent Evals Golden Standard are recorded here.
Versions follow Semantic Versioning.

## 0.2.0 — 2026-07-28

- resolves acceptance-predicate and run-level composite semantics;
- makes scheduled-cell accounting, retry lineage, physical-attempt terminal
  states, unresolved cells, and measurement validity schema-enforceable;
- separates decision-surface applicability from coverage and binds declared gaps
  to typed affected-claim restrictions;
- requires schema-bound post-decision evidence-retention, escalation triage, and
  finding references; resolution records bind those source fields;
- releases the version-2 case, Case QA, conformance, escalation, governance
  decision, governance resolution, and resolution-ledger schemas, plus the
  version-2 scorecard schema (`agent-eval-scorecard-2`).

## 0.1.0 — 2026-07-22

First public, implementation-independent release.

- establishes invariants I1–I13, case lifecycle, execution, judgement,
  conformance, governance, and semantic-validation requirements;
- defines conditional decision-surface coverage, append-only pre-transform
  transcript evidence, typed interactive actors, and simulator validation;
- establishes model-grader calibration and bias controls;
- establishes post-decision assurance, typed observations, and fail-closed
  escalation for changed configurations, degraded production concordance, and
  missing evidence;
- releases Case Contract 0.1.0 (`agent-eval-case-1`), Case QA Contract 0.1.0
  (`case-qa-record-1`), Scorecard Contract 0.1.0
  (`agent-eval-scorecard-1`), semantic-validation-0.1.0, and the initial
  governance and conformance schemas;
- dedicates the repository contents to the public domain under CC0 1.0
  Universal.
