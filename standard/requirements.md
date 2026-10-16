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

The registry JSON, [`requirement-registry.json`](requirement-registry.json), is the sole normative list of requirement IDs, subjects, primary locations, targets, verification kinds, and owners. This document does not repeat that list; it holds only the traceability rules (`ARCH-001`, `TRACE-001`) and the canonical artifact contracts note.

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
[Validity, threat, and held-out exposure contracts](validity-threat-exposure-contracts.md),
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
new receipt. The review record provides accountable process evidence. This
review establishes catalog accountability and
traceability
only. It **MUST NOT** be represented as independent replication, byte
preservation, or target-population validation.

An ordinary informative reference does not require a repository-controlled
copy or independent archive assessment. A claim that explicitly
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
`evidence_gap`. A requirement whose registry `evidenceBasis.kind` is
`design_invariant` carries its threat rationale in the registry and has no
source mapping; only `source_evidence` requirements appear in the manifest's
`mappings[]`. The release gate
**MUST** run the repository check (`npm test`) on a clean checkout of the exact
candidate commit and confirm that every maintainer review receipt is current.
On a release tag it **MUST** additionally bind the exact `v0.1.0` annotated tag
to that commit. The repository check proves schema, example, and link
consistency only; it is not a conformance validator. Release metadata **MUST
NOT** embed a digest of content that recursively embeds that same release
metadata.

## Canonical artifact contracts

`EVID-001` and `EVID-002` are defined once in
[Evidence and Detached Validation](evidence-and-validation-contract.md). Every
normative artifact **MUST** use its canonical `evidence-artifact-1` and detached
`validation-envelope-1` contracts. Scorecards, Case QA records, conformance
statements, decisions, and ledgers **MUST NOT** embed their own validation
result. This registry records ownership and traceability without duplicating the
field-level contracts.
