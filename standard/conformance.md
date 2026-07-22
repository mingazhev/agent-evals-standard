# Conformance Contract

- Status: current
- Golden Standard version: 4.0.0
- Purpose: define what a public conformance claim means.

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**,
and **MAY** are interpreted as described by RFC 2119 and RFC 8174 when written
in uppercase.

## Conformance targets

Conformance is claimed separately for four targets:

1. **Case conformance** — a case package satisfies the case schema, Case QA
   lifecycle, oracle-isolation, and evidence requirements.
2. **Evaluator conformance** — a runner and its graders enforce I1–I13, the
   baseline gate registry, attempt accounting, provenance, and trust boundary.
3. **Run conformance** — a sealed run uses conforming cases and evaluator
   behavior and produces a schema-valid scorecard and complete evidence ledger.
4. **Decision conformance** — a governance decision uses a conforming run and
   satisfies the pinned policy, escalation matrix, approvals, and expiry rules.

A claim of “full conformance” MUST identify and satisfy all four targets.
Conformance at one target does not imply conformance at another.

## Required conformance statement

A public conformance statement MUST contain:

- Golden Standard release tag, version, and Git commit;
- Scorecard Contract, adopter-owned Governance Policy instance, adopter-owned
  Escalation Matrix instance, semantic-validation contract, and schema versions,
  each with immutable location and digest; shipped template identifiers are not
  operational policy instances;
- target type and exact scope, plus separate verdict and evidence for every
  included target; `full` requires all four target records;
- implementation name and immutable version or commit, when applicable;
- a typed evidence manifest and target-specific evidence locations and hashes;
- declared extensions and namespaces;
- every deviation, unsupported requirement, affected target, and at least one
  resulting claim restriction;
- for decision/full claims, the decision-record, approval-envelope, policy, and
  matrix hashes, effective timestamp, review timestamp, and expiry timestamp;
  a positive approval also includes its post-decision assurance-plan reference;
- a resolvable issuer identity and signature over the RFC 8785 canonical
  statement, with the signature field omitted.

Missing fields make the statement non-conforming. A deviation cannot be hidden
behind “partial conformance”; it MUST name the affected rule and claims that are
therefore unsupported.

The normative machine-readable form is
[`schemas/conformance-statement.schema.json`](../schemas/conformance-statement.schema.json).
Schema validation is necessary but insufficient; the
[Integrity and Semantic Validation Contract](integrity-and-semantic-validation.md)
is mandatory.

## Extensions and profiles

An implementation or domain profile MAY add stricter checks, gates, fields, or
decision rules. It MUST NOT remove, rename, narrow, or silently reinterpret a
baseline requirement. Extension identifiers and fields MUST use a documented
namespace and MUST be preserved by readers that claim extension support.

An unknown extension that affects acceptance, validity, or governance makes the
affected claim `insufficient_evidence`; it is not ignored.

## Normative artifact consistency

The Markdown requirements and JSON Schemas are jointly normative. Neither has
automatic precedence. A contradiction that can change a conforming verdict is
a release defect: implementations MUST fail the affected path closed and MUST
NOT claim conformance until a versioned correction or explicit erratum resolves
the conflict.

Informative examples, external references, and implementation notes cannot
weaken a normative requirement.

## Verification

Conformance is evidence-backed, not self-certified by a boolean. An unsigned
statement is an unauthenticated self-assertion and is not conforming. The issuer
MUST retain enough immutable evidence for an independent reviewer to reproduce
the verdict. This standard does not itself appoint certifiers or imply legal or
regulatory compliance.
