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
[Validity, threat, and held-out exposure contracts](standard.md#validity-threat-and-held-out-exposure-contracts),
for example, are invoked by their registered primary anchors; they are not a
second primary location for `VALID-002` or any other requirement.

`TRACE-001` — Every registry entry whose `evidenceBasis.kind` is
`source_evidence` **MUST** cite at least one source ID that appears in
[Informative References](references.md). A `design_invariant` entry carries its
`threatRationale` in the registry. References are informative and never
normative. The release gate **MUST** run `npm test` on a clean checkout of the
exact candidate commit; on a tag, the annotated tag `v0.1.0` **MUST** resolve to
that commit. The repository check proves schema, example, and link consistency
only; it is not a conformance validator.

## Canonical artifact contracts

`EVID-001` and `EVID-002` are defined once in
[Evidence and Detached Validation](evidence-and-validation-contract.md). Every
normative artifact **MUST** use its canonical `evidence-artifact-1` and detached
`validation-envelope-1` contracts. Scorecards, Case QA records, conformance
statements, decisions, and ledgers **MUST NOT** embed their own validation
result. This registry records ownership and traceability without duplicating the
field-level contracts.
