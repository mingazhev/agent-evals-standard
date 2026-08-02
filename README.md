# Git-backed Repository SDLC Agent Evals Standard

An implementation-independent standard for evaluating software-engineering
agents working with Git-backed code repositories across the SDLC and for using
evaluation evidence in capability, comparison, and governance decisions.

The scope is deliberately limited to evaluations whose claim-bearing work is
grounded in a sealed Git repository or repository-bound fixture. General-agent
capability claims and unrelated office, customer-support, embodied, or arbitrary-
computer-use work are outside conformance scope. The implementation's breadth is
irrelevant: a general-purpose system may be evaluated conformingly only for the
bounded work and claims that pass `SCOPE-003`. Common invariants form an internal
base; they are not a standalone “general agent” certification. Every non-
diagnostic claim binds one effective evaluation profile per case and one or more
authenticated outcome profiles across its eligible cells; each case and cell
selects exactly one outcome profile.

This repository contains an **unpublished 0.1.0 publication candidate**. Every
component is version **0.1.0** and may change incompatibly until the first
release commit and protected annotated tag are created. The version identifies the
candidate contract; it does not assert that a release has occurred.

Normative authority is partitioned by question: the requirement registry and
linked primary prose own requirement meaning; registered JSON Schemas own JSON
shape; named semantic contracts own canonical and cross-document algorithms;
and conformance fixtures are executable projections of those registered rules.
The source-evidence manifest is the normative traceability and evidence-
readiness record, but the external sources it cites are informative. Validation tooling and
implementation notes are non-normative and cannot redefine a contract or
fixture. Verdict-changing contradictions fail closed. The authoritative table
is in [Conformance](standard/conformance.md#normative-artifact-consistency).

Evidence readiness is `ready`: every cited source and bounded content claim has
an accountable maintainer review against its primary publisher record, every
review receipt is bound to the exact reviewed claim projection, every normative
requirement has a non-gap evidence classification, and the complete repository
validation corpus passes. This status means that the standard is ready to be
published; it does not mean that every capability family has been empirically
validated for every enterprise population. Capability rows preserve those
transfer limits explicitly. Byte archives remain optional provenance hardening
unless a claim specifically depends on archived bytes.

The repository provides no evaluation runner, grader, benchmark cases, or
provider integration.

The bundled executable interoperability corpus is narrower than
the seven-family taxonomy. Its maturity is explicit:

| Capability surface | Bundled executable profile in 0.1.0 | Target-population evidence status |
| --- | --- | --- |
| `CAP.IMPLEMENT_CHANGE` | `repo-change-v1` | not yet established |
| `CAP.VERIFY_ASSURE` | change-bound assurance inside `repo-change-v1`; no pure read-only assurance profile | not yet established |
| `CAP.REVIEW_DECIDE` | read-only `repository-review-v1` | not yet established |
| `CAP.DISCOVER_SPECIFY`, `CAP.PLAN_DESIGN`, `CAP.RELEASE_OPERATE`, `CAP.REMEDIATE_LEARN` | normative taxonomy and contract surface only | not yet established |

An absent executable profile is not evidence that the normative surface is
implemented. A bundled profile demonstrates interoperability mechanics, not
empirical validity or production trust readiness.

Work-product classification is closed and machine-readable in the
[`repository-sdlc-work-artifact-registry`](standard/work-artifact-registry.json):
each type maps to one capability family, and every selected family must have a
material mapped output. Cases select one concrete interaction-mode ID and bind
repository state through a content-addressed one- or multi-repository workspace
manifest.

Version 0.1.0 has executable repository-state semantics for Git repositories
only. A non-Git VCS evaluation is outside executable conformance until a
versioned repository-state contract supplies equivalent immutable state
identity, visible-history closure, oracle-isolation evidence, semantic
verification, and positive and negative conformance fixtures. This limitation
does not broaden the standard to agents generally.

**Git LFS boundary:** version 0.1.0 does not define LFS payload transport,
authorization, materialization, or offline replay. Any reachable Git blob that
is an LFS pointer makes that workspace invalid for executable conformance;
checking in the pointer while omitting or fetching the payload out of band is
not a conforming workaround. `.gitattributes` alone, with no reachable LFS
pointer, does not invalidate a workspace.

The 0.1.0 Git path contract supports spaces and non-normalized Unicode but
requires every tree-entry name to be well-formed UTF-8 and every serialized
path to be safe and relative. Repositories containing non-UTF-8 path bytes are
outside executable conformance in this draft; non-path commit metadata remains
byte-preserving and is not required to be UTF-8. The normative rules are in the
[Git Repository-State Boundary Contract](standard/standard.md#git-repository-state-boundary-contract-scope-003).

## Candidate components

- Core standard: **0.1.0**
- Case Contract: **0.1.0**
- Case QA Contract: **0.1.0**
- Scorecard Contract: **0.1.0**
- Semantic Validation Contract: **0.1.0**
- Governance Policy template: **0.1.0**
- Escalation and Stop Matrix template: **0.1.0**

Start with [the core standard](standard/standard.md), then read the
[glossary](standard/glossary.md) and
[conformance contract](standard/conformance.md).

For a staged onboarding with checklists, read the
[Adoption Guide](standard/adoption-guide.md) — it separates a measurement
path (case → Case QA → run → scorecard → conformance statement) from a
governance path (policy instance → decision plan → decision → assurance).

For implementation, follow this dependency order:

1. establish applicability, the sealed Git workspace, and effective profiles;
2. bind suite scope, cases, work-artifact types, and validation strategies;
3. seal the evaluator, pre-run manifest, scheduled cells, and decision plan;
4. execute with isolated accounting and material evidence capture;
5. construct the scorecard and reproduce gates, outcomes, claims, and statistics;
6. perform detached semantic validation and target-specific conformance; and
7. make, enforce, and monitor any governance decision.

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
| Primary requirements | [Conformance](standard/conformance.md) | Primary definitions of `CONF-001`, `CONF-002`, and `CONF-003`, including authority and contradiction handling. |
| Invoked normative contract | [Case QA Playbook](standard/case-qa-playbook.md) | Complete activation and revalidation procedure invoked by `CASE-004`. |
| Invoked normative contract | [Validity, threat, and held-out exposure machine contracts](standard/validity-threat-exposure-contracts.md) | Typed, externally authorized machine contracts invoked by `VALID-002`, `VALID-003`, `HOLD-002`, `I4`, `I10`, and `EVID-001`. |
| Invoked normative contract | [Integrity and Semantic Validation](standard/integrity-and-semantic-validation.md) | Named canonical, cross-document, ledger, and verdict reproduction algorithms invoked by primary requirements. |
| Invoked normative contract | [Signature and Trust Profile](standard/signature-and-trust-profile.md) | Signature suites, authorization, revocation, trusted time, and anti-rollback rules invoked by evidence and conformance requirements. |
| Invoked normative contract | [Security Threat Model](standard/security-threat-model.md) | Threat-coverage rules invoked by `RISK-001`, `RUN-003`, `DATA-001`, and `DATA-002`. |
| Invoked normative templates | [Governance Policy](standard/governance-policy.md) and [Escalation and Stop Matrix](standard/escalation-stop-matrix.md) | Required adopter-owned policy and response shapes invoked by governance requirements; the bundled instances remain non-operational. |
| Normative shape | [Schemas](schemas/) and authenticated JSON registries | Closed JSON structure and registered machine identities; schema annotations are informative. |
| Executable projection | `conformance/fixtures/` | Positive and negative interoperability vectors derived from registered requirements and invoked contracts; fixtures cannot create obligations. |
| Normative traceability; informative sources | [Source-evidence manifest](standard/source-evidence-manifest.json) and [Informative References](standard/references.md) | Evidence-readiness and traceability records are normative; cited external sources and narrative summaries are informative. |

The governance decision template is in
[templates/governance-decision-record.md](templates/governance-decision-record.md).

## Publication discipline

Until publication, all components remain `0.1.0`; incompatible changes replace
the working draft in place. A
first publication must freeze an exact commit, publish the conformance corpus
for that commit, and create a protected annotated release tag. Repository
administrators must enforce tag immutability with a GitHub ruleset; repository
files cannot make a remotely hosted tag undeletable. The normative release CI
gate is `npm run release:check`: it proves generated-artifact freshness, runs
the complete `npm test` corpus, and then checks review receipts, evidence
readiness, and repository cleanliness on that exact commit. CI invokes this
same gate for pull requests, `main`, and version tags; tag runs additionally
require exact annotated tag `v0.1.0` to resolve to the checked-out commit.
Publication readiness does not promote capability evidence beyond
the status and population limits recorded in the source-evidence manifest. A
raw version string or Git tag by itself is not evidence that this candidate was
published.

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Validation

The repository validates itself. Machine-verifiable expectations are captured
as positive and negative [conformance fixtures](conformance/fixtures/) and
checked by `npm test`, which runs every verifier tool in `tools/` and every
profile test. `npm run check` verifies repository consistency (schema
well-formedness, `$ref` resolution, cross-document links);
`npm run check:generated` verifies generated-artifact freshness; and
`npm run release:check` adds evidence-readiness and cleanliness checks for the
publication candidate. The same checks run in CI on every pull request, on
`main`, and on version tags.

## Adoption

While the draft is unpublished, a claimant asserting draft conformance MUST
pin version `0.1.0` and the exact commit. After publication it MUST additionally
pin the protected annotated release tag. Saying “based on” this standard is not a
conformance claim. Unknown extensions, omitted mandatory evidence, and
undocumented deviations fail closed for the affected claim.

## Non-goals

This repository does not provide certification, legal compliance, benchmark
cases, a leaderboard, or an executable harness. It specifies evidence and
decision contracts that independent implementations can satisfy.

## License

Dedicated to the public domain under [CC0 1.0 Universal](LICENSE). You may
copy, modify, distribute, and use this work, including commercially, without
asking permission or providing attribution.
