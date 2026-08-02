# Requirements Registry and Traceability

- Status: unpublished 0.1.0 publication candidate
- Version: 0.1.0
- Purpose: stable requirement identifiers, verification ownership, and evidence
  traceability for the Git-backed Repository SDLC Agent Evals Standard.

The normative machine projection is
[`requirement-registry.json`](requirement-registry.json). This document is its
human-readable index and rationale. A candidate revision is inconsistent when
the two projections disagree.

The normative keywords **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**,
**SHOULD NOT**, and **MAY** are interpreted as described by RFC 2119 and RFC
8174. Only uppercase keywords carry those meanings. A conformance statement
addresses requirements by the stable IDs below.

## Requirement registry

| ID | Subject | Verification owner | Primary normative artifact | Evidence basis |
| --- | --- | --- | --- | --- |
| `ARCH-001` | normative artifact and extension architecture | conformance validator | [Requirements Registry](requirements.md#traceability-rules) | interoperability and fail-closed design |
| `TRACE-001` | requirement-to-source evidence mapping | conformance validator | [Requirements Registry](requirements.md#traceability-rules) | evidence auditability |
| `I1` | non-compensable acceptance | scorecard validator | [Standard](standard.md#i1-acceptance-is-non-compensable) | safety and validity guardrails |
| `I2` | lifecycle-wide oracle isolation | run validator | [Standard](standard.md#i2-lifecycle-wide-oracle-isolation) | contamination findings in [Informative References](references.md) |
| `I3` | no post-hoc adaptation or selection | run validator | [Standard](standard.md#i3-no-post-hoc-adaptation-or-selection) | pre-registration |
| `I4` | reconstructible conditions and provenance | run validator | [Standard](standard.md#i4-reconstructible-conditions-and-provenance) | reproducibility |
| `I5` | attribution and complete attempt accounting | ledger validator | [Standard](standard.md#i5-attribution-and-complete-attempt-accounting) | retry and missingness control |
| `I6` | claims bounded by evidence | claim validator | [Standard](standard.md#i6-claims-are-bounded-by-evidence) | target-population inference |
| `I7` | enforced least privilege | run validator | [Standard](standard.md#i7-enforced-least-privilege) | enterprise security controls |
| `I8` | declared optimization objectives | metric validator | [Standard](standard.md#i8-optimization-objectives-are-declared) | denominator and selection integrity |
| `I9` | construct-fitting evidence | Case QA validator | [Standard](standard.md#i9-evidence-fits-the-construct) | deterministic and expert evidence hierarchy |
| `I10` | fail-closed required paths | semantic validator | [Standard](standard.md#i10-required-decision-paths-fail-closed) | fail-closed design |
| `I11` | causal comparability | statistical validator | [Standard](standard.md#i11-causal-comparability) | comparative experimental design |
| `I12` | validated measurement only | Case QA validator | [Standard](standard.md#i12-only-validated-measurement-enters-claims) | task and grader validation |
| `I13` | trusted measurement boundary | run validator | [Standard](standard.md#i13-trusted-measurement-boundary) | adversarial measurement-system design |
| `SCOPE-001` | system-under-evaluation identity | run validator | [Standard](standard.md#system-under-evaluation) | agent-evaluation architecture in [Informative References](references.md) |
| `SCOPE-002` | SDLC capability coverage | suite validator | [Standard](standard.md#sdlc-capability-taxonomy) | closed-taxonomy and explicit-gap design invariant; heterogeneous task and process surfaces in [Informative References](references.md) provide rationale only |
| `SCOPE-003` | repository-grounded applicability and profile selection | conformance validator | [Standard](standard.md#applicability-boundary-and-profiles) | bounded standard architecture |
| `PROFILE-001` | evaluation-profile hierarchy and effective measurement identity | suite and case validators | [Standard](standard.md#evaluation-profile-resolution) | deterministic specialization without weakening |
| `OUTPROF-001` | outcome-profile selection and compatibility | case validator | [Standard](standard.md#outcome-profiles) | artifact-appropriate evaluation without scope expansion |
| `VALID-001` | intended use and construct definition | suite validator | [Standard](standard.md#intended-use-and-validity-argument) | evaluation best practices in [Informative References](references.md) |
| `VALID-002` | validity argument and threats | suite validator | [Standard](standard.md#intended-use-and-validity-argument) | measurement validity and production concordance |
| `VALID-003` | reference baselines | statistical validator | [Standard](standard.md#intended-use-and-validity-argument) | current-workflow and human/tool comparison |
| `DATA-001` | lawful source, data, IP, and privacy controls | case validator | [Standard](standard.md#data-ip-privacy-and-retention) | enterprise data governance |
| `DATA-002` | artifact access and retention | evidence validator | [Evidence and Detached Validation](evidence-and-validation-contract.md#evidence-minimization-and-retention) | least privilege and purpose limitation |
| `CASE-001` | case contract and agent-visible projection | case validator | [Standard](standard.md#authoring) | reproducible task packaging in [Informative References](references.md) |
| `CASE-002` | outcome profile and alternative valid outcomes | Case QA validator | [Standard](standard.md#outcome-profiles) | task audit and false-negative evidence in [Informative References](references.md) |
| `CASE-003` | case lifecycle and retirement | suite validator | [Standard](standard.md#lifecycle-states) | living-set maintenance |
| `CASE-004` | Case QA activation and revalidation | Case QA validator | [Standard](standard.md#activation-and-maintenance) | professional task audit in [Informative References](references.md) |
| `CASE-005` | decision-surface coverage | Case QA validator | [Standard](standard.md#decision-surface-coverage) | trajectory-aware evaluation |
| `HOLD-001` | oracle isolation | run validator | [Standard](standard.md#i2-lifecycle-wide-oracle-isolation) | contamination findings in [Informative References](references.md) |
| `HOLD-002` | held-out exposure and reuse budget | suite validator | [Standard](standard.md#held-out-exposure-and-reuse), [machine contracts](validity-threat-exposure-contracts.md#held-out-budget-and-ledger) | contamination and saturation control |
| `EXP-001` | sealed experiment and scheduled cells | run validator | [Standard](standard.md#sealed-experiment-contract) | reproducibility and pre-registration |
| `EXP-002` | complete arm identity | run validator | [Standard](standard.md#sealed-experiment-contract) | causal comparability |
| `EXP-003` | comparative design | statistical validator | [Standard](standard.md#sealed-experiment-contract) | paired experimental design |
| `RUN-001` | isolation, execution, capture, and teardown | run validator | [Standard](standard.md#run-protocol) | reproducible harness practice in [Informative References](references.md) |
| `RUN-002` | complete attempt accounting | ledger validator | [Standard](standard.md#i5-attribution-and-complete-attempt-accounting) | missingness and retry-bias control |
| `RUN-003` | trusted measurement boundary | run validator | [Standard](standard.md#i13-trusted-measurement-boundary) | adversarial measurement-system design |
| `INT-001` | interactive actor protocol | Case QA and run validators | [Standard](standard.md#interactive-actors-and-simulators) | interactive simulator architecture in [Informative References](references.md) |
| `EVID-001` | canonical evidence artifacts | evidence validator | [Evidence and Detached Validation](evidence-and-validation-contract.md#canonical-evidence-artifact) | authenticated provenance |
| `EVID-002` | detached validation envelope | conformance validator | [Evidence and Detached Validation](evidence-and-validation-contract.md#detached-validation-envelope) | non-circular signed validation |
| `JUDGE-001` | evidence hierarchy | Case QA validator | [Standard](standard.md#evidence-hierarchy) | grader roles and human calibration in [Informative References](references.md) |
| `JUDGE-002` | deterministic verification | Case QA validator | [Standard](standard.md#evidence-hierarchy) | reproducible correctness evidence |
| `JUDGE-003` | expert adjudication | Case QA validator | [Standard](standard.md#evidence-hierarchy) | fail-closed multi-rater measurement design invariant; judge-bias evidence provides bounded rationale only |
| `GATE-001` | universal and profile gate registries | scorecard validator | [Scorecard Contract](scorecard-contract.md#gate-registry) | non-compensable safety and validity |
| `OUT-001` | outcome taxonomy and predicates | scorecard validator | [Scorecard Contract](scorecard-contract.md#successful-functional-and-accepted-outcomes) | explicit outcome contracts |
| `CLAIM-001` | closed claims registry and `claims[]` | scorecard validator | [Scorecard Contract](scorecard-contract.md#claims) | claim-bounded reporting |
| `CLAIM-002` | population and coverage limits | statistical validator | [Standard](standard.md#statistics-and-missingness) | target-population inference |
| `STAT-001` | repeated trials and units | statistical validator | [Standard](standard.md#statistics-and-missingness) | stochastic reliability estimation |
| `STAT-002` | missingness and identification bounds | statistical validator | [Standard](standard.md#statistics-and-missingness) | conservative partial identification |
| `STAT-003` | comparison and uncertainty | statistical validator | [Standard](standard.md#statistics-and-missingness) | paired case-level inference |
| `ASSURE-001` | proportional assurance level | conformance validator | [Standard](standard.md#assurance-levels) | risk-proportionate enterprise adoption |
| `RISK-001` | task hazard and exposure-derived risk | governance validator | [Standard](standard.md#risk-model) | deployment-context risk analysis |
| `GOV-001` | pre-registered governance decision | governance validator | [Standard](standard.md#governance-decisions-and-post-decision-assurance) | auditable decision governance |
| `GOV-002` | post-decision assurance and expiry | governance validator | [Standard](standard.md#governance-decisions-and-post-decision-assurance) | production concordance and reversibility |
| `HEALTH-001` | suite and measurement health | suite validator | [Standard](standard.md#suite-health) | living-set maintenance and drift control |
| `CONF-001` | target-specific conformance | conformance validator | [Conformance](conformance.md#applicability-boundary) | independently reviewable claims |
| `CONF-002` | requirement coverage matrix | conformance validator | [Conformance](conformance.md#requirement-coverage) | requirement-level traceability |
| `CONF-003` | extension and deviation handling | conformance validator | [Conformance](conformance.md#extensions-and-deviations) | compatible extension design |

## Traceability rules

`ARCH-001` — A normative requirement **MUST** have one stable ID, one primary
normative location, a conformance target, a required verifier or accountable
reviewer, and an evidence basis. An artifact **MUST NOT** redefine another
artifact's requirement or add a verdict-changing consequence under that
requirement ID. A secondary artifact **MAY** provide navigation, an example, or
a consequence already derivable from the primary definition. A new independent
obligation or consequence **MUST** receive its own registered requirement ID and
primary location.

The explicit requirement definition **MUST** occur at the registered primary
anchor. A secondary artifact may provide navigation, required verifier inputs,
or consequences under another requirement ID, but a summary of a primary
algorithm is informative and **MUST NOT** repeat normative keywords in a way
that creates a second candidate definition.

JSON Schema `$comment`, `title`, `description`, and `examples` annotations are
informative regardless of capitalization. They **MUST NOT** be the only
location of a verdict-changing rule. Schema keywords own JSON shape; a
cross-field or cross-document rule belongs at the registered primary
requirement or named semantic contract. The repository consistency check
**MUST** reject an annotation containing an unqualified RFC 2119 keyword so
that informative guidance cannot resemble a second definition.

Every normative change **MUST** update this registry and every affected schema,
fixture, cross-reference, and conformance assertion in the same candidate
revision. A source in [Informative References](references.md) supports rationale;
it does not become normative. When evidence is empirical, the adopting profile
**MUST** record applicability limits and contrary evidence relevant to its
population.

A primary requirement may explicitly invoke a named normative contract for its
closed algorithm, required inputs, or control procedure. That invoked contract
is authoritative only for the invocation's stated scope and **MUST NOT** add a
new requirement, target, or verdict consequence. The
[Validity, threat, and held-out exposure machine contracts](validity-threat-exposure-contracts.md),
for example, are invoked by their registered primary anchors; they are not a
second primary location for `VALID-002` or any other requirement.

`TRACE-001` — The draft **MUST** maintain one machine-readable
[`source-evidence-manifest-1`](source-evidence-manifest.json) that maps each
practice claim to stable source and observation IDs, archive-verification state,
evidence class, support strength, represented population, and the requirement
IDs it supports. `rationale_only` **MUST NOT** be presented as
`empirical_observation` or `triangulated_empirical` validation. A design invariant
without external empirical support **MUST** be labeled as such and linked to its
failure mode or threat rationale.

The manifest's `sources[].id` and `observations[].id` projections **MUST** be
unique. Every source ID in a requirement mapping, capability row,
`rationaleEvidence`, contrary-evidence edge, funding record, or evidence blocker
**MUST** resolve to exactly one source. Every observation **MUST** resolve to
exactly one source classified as `primary_empirical_source` with a compatible
primary empirical evidence class. Every cited observation ID **MUST** resolve to
exactly one observation whose source is in the citing row's `sourceIds`.
Two source records **MUST NOT** represent the same primary artifact: duplicate
immutable locators, duplicate locator/version identities, or duplicate verified
archive digests are invalid and cannot contribute independent observations.
`mappings` **MUST** contain exactly one row for every ID in the authenticated
requirement registry, with no unknown or duplicate ID. `capabilityCoverage`
**MUST** contain exactly one row for each of
`CAP.DISCOVER_SPECIFY`, `CAP.PLAN_DESIGN`, `CAP.IMPLEMENT_CHANGE`,
`CAP.VERIFY_ASSURE`, `CAP.REVIEW_DECIDE`, `CAP.RELEASE_OPERATE`, and
`CAP.REMEDIATE_LEARN`, with no other capability ID.

An `empirical_observation` mapping **MUST** cite at least one structured primary
empirical observation and state its represented population. Each observation
**MUST** record its exact studied population and sampling, method, result,
uncertainty and selection conditions, limits, and data or benchmark lineage. An
observation cannot establish transfer or normative necessity. A
`documented_mechanism` mapping **MUST** cite a primary
specification, framework, repository artifact, or paper that actually defines
or describes the bounded mechanism or property under its stated assumptions;
it cannot establish effectiveness, universality, transfer, or the necessity of
this standard's chosen rule.
`triangulated_empirical` **MUST** satisfy the stricter independence assessment,
cite at least two primary observations from at least two archived primary
empirical artifacts, and derive those artifacts from at least two non-overlapping
stable producer organizations. `rationale_only` and `evidence_gap` **MUST NOT**
be presented as empirical validation.

Maintainer source review and byte-archive verification are separate. Every
relied-on source **MUST** have a reviewer-identified and reviewer-dated
`sourceReview` record bound to the primary publisher locator, an exact version
locator where the publisher provides one, and review of title, producer,
publication date, version identity, and the bounded cited content claims. The
record **MUST** identify the accountable reviewer with a resolvable identity
URI, cite an auditable version-control or review-system record, and bind the
exact source, observation, capability, and requirement-claim projection by
SHA-256. Any projection change invalidates the review until a reviewer issues a
new receipt. The review record provides accountable process evidence, not a
cryptographic signature. This review establishes catalog accountability and
traceability
only. It **MUST NOT** be represented as independent replication, byte
preservation, or target-population validation.

An ordinary informative reference does not require a repository-controlled
copy or independently signed archive assessment. A claim that explicitly
depends on immutable source bytes, including `triangulated_empirical`, **MUST**
instead use `archive.status: verified`, bind a repository-relative artifact
path, byte length, and SHA-256, and make every cited result and funding statement
resolvable inside those bytes. Every archived empirical observation **MUST**
also locate the population, sampling, method, result, and data or benchmark
lineage fields used by evidence logic. The funding evidence **MUST** bind the
exact sponsor-ID classification. The validator **MUST** read the artifact,
recompute byte length and digest, and resolve each recorded extraction pointer.
For triangulation, every source also needs
`fundingDisclosure.status: verified_from_archived_source`. The independence
assessment **MUST** exactly identify observations, producers, authors, data and
benchmark lineage, population and method overlap, sponsors, and remaining
common-mode risk. Shared producer, data or benchmark lineage, or sponsor, or
pending, missing, or archive-unbound funding evidence invalidates the
independence conclusion.

Every capability row **MUST** state `targetPopulationValidation` separately from
mechanism or observation support. Its `observationPopulationRelations` **MUST**
contain exactly one bounded relation for every `basisObservationId`, including
justification, transfer assumptions, and limitations. Adjacent, simulated,
provider-owned, shared-lineage, broadly relabeled, or claimant-asserted populations
do not validate the repository-SDLC target.

The status `independently_validated` is not defined in 0.1.0. Capability rows
therefore record `not_established` or `single_producer_indication` and retain
their population relations, gaps, and transfer limits. Those limits constrain
capability claims but do not block publication of a standard whose normative
requirements are otherwise complete and correctly classified. In particular,
publication readiness **MUST NOT** be reported as empirical validation of all
seven capability families or transfer to an adopter's population.

`evidenceReadiness: ready` requires current, projection-bound maintainer review
receipts for every cited source and no normative requirement mapped as
`evidence_gap`.
Design invariants remain eligible when their threat rationale, failure mode,
validation obligation, and claim restriction are explicit. `npm run
release:check` **MUST** first prove generated-artifact freshness, run the
complete `npm test` corpus, and run the publication checks on a clean checkout
of the exact candidate commit. On a release tag it **MUST** additionally bind
the exact `v0.1.0` annotated tag to that commit. Neither the manifest
alone nor a partial fixture run is a whole-standard release gate. Release
metadata **MUST NOT** embed a digest of a corpus that recursively embeds that
same release metadata.

## Canonical artifact contracts

`EVID-001` and `EVID-002` are defined once in
[Evidence and Detached Validation](evidence-and-validation-contract.md). Every
normative artifact **MUST** use its canonical `evidence-artifact-1` and detached
`validation-envelope-1` contracts. Scorecards, Case QA records, conformance
statements, decisions, and ledgers **MUST NOT** embed their own validation
result. This registry records ownership and traceability without duplicating the
field-level contracts.
