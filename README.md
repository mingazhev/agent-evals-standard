# Git-backed Repository SDLC Agent Evals Standard

An implementation-independent standard for evaluating software-engineering
agents working with Git-backed code repositories across the SDLC and for using
evaluation evidence in capability, comparison, and governance decisions.

Evaluated work and claims must be materially grounded in a sealed Git repository
or repository-bound fixture under [SCOPE-003](standard/standard.md#applicability-boundary-and-profiles).
A general-purpose agent may participate, but unrelated general-agent claims are
outside scope.

This repository contains an **unpublished 0.1.0 publication candidate**. Every
component is version **0.1.0** and may change incompatibly until the first
release commit and protected annotated tag are created. The version identifies the
candidate contract; it does not assert that a release has occurred.

## Implement an A1 evaluation

[A1](standard/conformance.md#baseline-a1) is the entry point for an independent
implementation. For a repository-change evaluation, follow the
[Adoption Guide](standard/adoption-guide.md) for the six document types and
their Git seal order, then inspect the arithmetic
[worked example](examples/core/README.md).

Implementers can use the [requirement registry](standard/requirement-registry.json)
to find A1 obligations and their primary definitions. Validate document shape
with the schemas; implement the semantic checks required by the linked
contracts, since schema validation alone does not establish conformance. The
[authority map](#normative-authority-map) lists the primary requirements and
invoked contracts.

A1 supports bounded capability claims at low or medium effective risk. It does
not support release, autonomy, or risk-acceptance decisions. Two people can
cover author/configurer and independent review for deterministic cases;
judgment-bound checks require two independent raters besides the
author/configurer.

A2 and A3 retain the A1 requirements and add profile bindings, attachments, and
stronger evidence forms. They are a draft annex; use the linked assurance
requirements when implementing those levels.

## Maturity

Version 0.1.0 is normative for assurance levels A0 and A1. A2 and A3 are
published as a **draft annex** (in [`standard/annex/`](standard/annex/README.md)): stable in intent, unvalidated by any run, and
may change incompatibly in a later 0.1.x without a major version bump. A
conformance claim at A2 or A3 is permitted but is a claim against the draft
annex and states so in its restrictions ([Conformance](standard/conformance.md) defines the obligation).

Normative at A1: the six run-family schemas, the registries, and the A1
requirement set. Draft annex: the A2/A3 attachments (validity argument, threat
model, held-out budget and ledger, grader validation, risk assessment,
governance decision, operational policy, escalation-event registry, evaluation
and outcome profiles, evidence artifact, validation envelope), the Governance
Policy, the Security Threat Model, and the A2/A3 parts of the Case QA playbook
and evidence contract.

## Scope and implementation coverage

The bundled profile is narrower than the seven-family taxonomy. Its maturity
is explicit:

| Capability surface | Bundled profile in 0.1.0 | Target-population evidence status |
| --- | --- | --- |
| `CAP.IMPLEMENT_CHANGE` | `repo-change-v1` | not yet established |
| `CAP.VERIFY_ASSURE` | taxonomy and contract surface only; no bundled assurance profile | not yet established |
| `CAP.DISCOVER_SPECIFY`, `CAP.PLAN_DESIGN`, `CAP.REVIEW_DECIDE`, `CAP.RELEASE_OPERATE`, `CAP.REMEDIATE_LEARN` | normative taxonomy and contract surface only | not yet established |

The profile demonstrates interoperability, not production trust readiness.
Each selected capability needs a material output mapped by the
[work-artifact registry](standard/work-artifact-registry.json).

The [Git boundary contract](standard/git-repository-state-contract.md)
supports one or multiple repositories, UTF-8 paths including spaces and
non-normalized Unicode, and byte-preserved commit metadata. Non-Git VCS,
non-UTF-8 path names, and reachable Git LFS pointer blobs are outside executable
conformance in 0.1.0. `.gitattributes` without an LFS pointer is permitted.

## Candidate components

- Core standard, including assurance level A1 and `stat-defaults-v1`: **0.1.0**
- Case QA Playbook: **0.1.0**
- Scorecard Contract: **0.1.0**
- Semantic Validation Contract: **0.1.0**
- Governance Policy template: **0.1.0**
- Escalation and Stop Matrix template: **0.1.0**

The [glossary](standard/glossary.md) defines shared terms. Candidate revisions
are identified by exact commit, not by these version strings alone.

## Normative authority map

`ARCH-001` permits one primary location for each requirement. An invoked
contract supplies algorithms or control detail only where that primary location
explicitly invokes it; it is not a second definition.

| Authority role | Artifact | Scope |
| --- | --- | --- |
| Primary requirements | [Requirements and traceability rules](standard/requirements.md) plus the [machine registry](standard/requirement-registry.json) | Requirement identity and the primary definitions of `ARCH-001` and `TRACE-001`; the registry selects every other primary anchor, target, owner, applicability rule, and evidence basis. |
| Primary requirements | [Core standard](standard/standard.md) | Every registered primary requirement except `ARCH-001`, `TRACE-001`, `GATE-001`, `OUT-001`, `CLAIM-001`, `DATA-002`, `EVID-001`, `EVID-002`, and `CONF-001`–`CONF-003`. |
| Primary requirements | [Scorecard Contract](standard/scorecard-contract.md) | Primary definitions of `GATE-001`, `OUT-001`, and `CLAIM-001`; scorecard projections invoked by the core statistical requirements. |
| Primary requirements | [Evidence and Detached Validation](standard/evidence-and-validation-contract.md) | Primary definitions of `DATA-002`, `EVID-001`, and `EVID-002`. |
| Primary requirements | [Conformance](standard/conformance.md) | Primary definitions of `CONF-001`, `CONF-002`, and `CONF-003`: two claims (experiment and decision), the A1 baseline, authority, and contradiction handling. |
| Invoked normative contract | [Case QA Playbook](standard/case-qa-playbook.md) | Complete activation and revalidation procedure invoked by `CASE-004`. |
| Invoked normative contract | [Validity, threat, and held-out exposure contracts](standard/annex/validity-threat-held-out-contracts.md) | Validity-argument, baseline, threat-model, and held-out budget and ledger contracts invoked by `VALID-002`, `VALID-003`, and `HOLD-002`. |
| Invoked normative contract | [Integrity and Semantic Validation](standard/evidence-and-validation-contract.md#integrity-and-semantic-validation-contract) | Named canonical, cross-document, ledger, and verdict reproduction algorithms invoked by primary requirements. |
| Invoked normative contract | [Git repository-state contract](standard/git-repository-state-contract.md) | Repository-state modes, closure, path and gitlink rules invoked by `SCOPE-003`. |
| Invoked normative contract | [Security Threat Model](standard/annex/security-threat-model.md) | Threat-coverage rules invoked by `RISK-001`, `RUN-003`, `DATA-001`, and `DATA-002`. |
| Invoked normative templates | [Governance Policy](standard/annex/governance-policy.md) and [Escalation and Stop Matrix](standard/annex/governance-policy.md#escalation-and-stop-matrix) | Required adopter-owned policy and response shapes invoked by governance requirements; the bundled instances remain non-operational. |
| Normative shape | [Schemas](schemas/) and authenticated JSON registries | Closed JSON structure and registered machine identities; schema annotations are informative. |
| Informative instances | [`examples/`](examples/README.md) | One valid example per schema, a few schema-level invalid examples, and the A1 worked example; examples cannot create obligations. Digests inside examples are illustrative. |
| Informative references | [references.md](standard/references.md) | Cited sources and the requirement IDs they inform; informative only. |

The governance decision template is in
[standard/annex/governance-decision-record.md](standard/annex/governance-decision-record.md).

## Publication discipline

Until publication, all components remain `0.1.0`; incompatible changes replace
the working draft in place. A first publication must freeze an exact commit and
create a protected annotated release tag. Repository administrators must
enforce tag immutability with a GitHub ruleset; repository files cannot make a
remotely hosted tag undeletable. The release gate is `npm test` on that exact
commit; tag runs
additionally require exact annotated tag `v0.1.0` to resolve to the checked-out
commit. A
raw version string or Git tag by itself is not evidence that this candidate was
published.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the release obligations.

## Validation

This repository holds contracts only — prose, JSON Schemas, profiles, templates,
and examples — and no validator, runner, or grader code. `npm test` runs one
lightweight check: every schema compiles in strict mode and keeps annotations
informative, every example matches its declared expectation, bundled contracts validate, profile hashes and
references agree, required case fields exist in the schema, profile fixture
descriptors resolve, and local Markdown links and anchors resolve. It is not a
conformance validator. Semantic validation belongs to implementations of this
standard, which maintain their own test vectors and versioning. The same check
runs in CI on every pull request, on `main`, and on version tags.

## Adoption

While the draft is unpublished, a claimant asserting draft conformance pins
version `0.1.0` and the exact commit, and after publication also the protected
annotated release tag; [Conformance](standard/conformance.md) defines the
obligation. Saying “based on” this standard is not a
conformance claim. Unknown extensions, omitted mandatory evidence, and
undocumented deviations fail closed for the affected claim.

## Non-goals

This repository does not provide certification, legal compliance, benchmark
cases, a leaderboard, an executable harness, or a conformance validator. It
specifies evidence and decision contracts that independent implementations can
satisfy.

## License

Dedicated to the public domain under [CC0 1.0 Universal](LICENSE). You may
copy, modify, distribute, and use this work, including commercially, without
asking permission or providing attribution.
