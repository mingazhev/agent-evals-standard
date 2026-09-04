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

Start with the [Adoption Guide](standard/adoption-guide.md), then use the
[authority map](#normative-authority-map) to find each contract. The guide orders
policy and assurance setup, case QA, pre-registration, execution, and separate
conformance statements; governance decisions and monitoring follow their
pre-planned evidence run.

The [source-evidence manifest](standard/source-evidence-manifest.json) records
`evidenceReadiness: ready`: source reviews are current and no normative
requirement has an evidence gap. Publication additionally requires the full
release check below. Neither status establishes empirical validity for an
adopter's population.

## Scope and implementation coverage

The bundled executable interoperability corpus is narrower than
the seven-family taxonomy. Its maturity is explicit:

| Capability surface | Bundled executable profile in 0.1.0 | Target-population evidence status |
| --- | --- | --- |
| `CAP.IMPLEMENT_CHANGE` | `repo-change-v1` | not yet established |
| `CAP.VERIFY_ASSURE` | change-bound assurance inside `repo-change-v1`; no pure read-only assurance profile | not yet established |
| `CAP.REVIEW_DECIDE` | read-only `repository-review-v1` | not yet established |
| `CAP.DISCOVER_SPECIFY`, `CAP.PLAN_DESIGN`, `CAP.RELEASE_OPERATE`, `CAP.REMEDIATE_LEARN` | normative taxonomy and contract surface only | not yet established |

The profiles demonstrate interoperability, not production trust readiness.
Each selected capability needs a material output mapped by the
[work-artifact registry](standard/work-artifact-registry.json).

The [Git boundary contract](standard/standard.md#git-repository-state-boundary-contract-scope-003)
supports one or multiple repositories, UTF-8 paths including spaces and
non-normalized Unicode, and byte-preserved commit metadata. Non-Git VCS,
non-UTF-8 path names, and reachable Git LFS pointer blobs are outside executable
conformance in 0.1.0. `.gitattributes` without an LFS pointer is permitted.

## Candidate components

- Core standard: **0.1.0**
- Case Contract: **0.1.0**
- Case QA Contract: **0.1.0**
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
checked by `npm test`, which runs the registered verifier suites and profile
tests. `npm run check` verifies repository consistency (schema
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
