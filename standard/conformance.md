# Conformance Contract

- Status: unpublished working draft
- Version: 0.1.0
- Purpose: define evidence-backed claims of adherence to the Repository SDLC
  Agent Evals Standard.

The normative keywords **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**,
**SHOULD NOT**, and **MAY** are interpreted as described by RFC 2119 and RFC
8174. Only uppercase forms are normative keywords. Requirement IDs and primary
locations are listed in the [Requirements Registry](requirements.md).

## Applicability Boundary

`CONF-001` — Conformance applies to repository-grounded SDLC agent evaluations
as defined in the [Glossary](glossary.md). This Applicability Boundary section is
the single primary anchor for `CONF-001`; its definition continues through
[Conformance Targets](#conformance-targets) and the evidence rules below. A
claimant **MUST** identify the
repository-grounded work, SDLC capability families, outcome profiles,
interaction modes, assurance levels, and effective-risk range in scope.
The structured scope **MUST** be a nonempty set of uniquely identified slices.
Each slice independently binds one immutable content-addressed workspace
manifest whose URI resolves to the exact manifest bytes, exactly one effective
leaf evaluation profile, one or more authenticated outcome profiles, assurance,
risk, capability families, interaction modes, and work-artifact types. Every
slice declares `bindingUse`. For A1–A3, it **MUST** be `claims_eligible`, and the
evaluation profile, outcome profiles, registry, and declared scope **MUST** be
compatible. For A0, it **MUST** be `diagnostic_only`; the validator **MUST**
authenticate and reproduce each bound artifact but **MUST NOT** infer or assert
compatibility among them or with the declared diagnostic scope. A validator
**MUST NOT** infer a cross-profile or cross-repository union from fields
belonging to different slices.

`CONF-001` invokes the versioned
[Integrity and Semantic Validation Contract](integrity-and-semantic-validation.md)
as its cross-document verdict algorithm and
[Normative Artifact Consistency](#normative-artifact-consistency) as its exact
distribution-identity contract. A target cannot satisfy `CONF-001` by validating
schema shape while omitting an applicable check from either contract.

The applicability-boundary label is not evidence. Every slice **MUST** bind
one signed `repository-grounding-evidence-1` payload containing exactly four
typed assertions: repository necessity, claim/invariant traceability, a
repository-governed outcome, and a semantic counterfactual. The validator
**MUST** resolve and hash every embedded workspace object byte string, reproduce
the workspace root, execute every exact outcome and target-claim predicate with
a distribution-pinned implementation, reproduce the counterfactual `pass` to
`fail` transition, and reproduce the declared verifier inputs and outputs. A
signed label, repeated subject metadata, arbitrary repository bytes, loss of
input availability, or a self-reported verdict is not grounding evidence.
Missing, non-executable, incomplete, or mismatched grounding evidence places the
slice outside the boundary; it may be represented honestly only as
`insufficient_evidence`.

The foundation invariants are part of this base standard. They are not a
standalone general-agent certification. An evaluation outside the applicability
boundary **MUST NOT** claim conformance by citing only those invariants. A new
domain requires a separate sibling base or domain standard; an evaluation
profile cannot expand this standard into one. Version 0.1.0 defines no
inheritance, conformance, or compatibility relation from this standard to such a
sibling. A future shared parent may be extracted only from rules proven across
at least two materially different domains with independent authorship,
implementation, and adoption, one branch-free common conformance corpus,
negative portability tests, and formal composition, versioning, and
no-weakening migration proofs.

## Base and Evaluation-Profile Model

The base standard owns system identity, projection, experiment design, evidence,
attempt accounting, claim semantics, risk, governance separation, and
conformance. An evaluation profile owns capability-specific case shapes,
allowed outcome profiles, gate registries, QA controls, metrics, and domain
rules. Outcome profiles define result shapes; they do not replace an evaluation
profile.

The core `SCOPE-003` applicability and four-test boundary are defined once in
the [Core Standard](standard.md#applicability-boundary-and-profiles). This
conformance contract only defines the evidence required to verify that
boundary; it does not redefine `SCOPE-003`.

`PROFILE-001` is defined exclusively by the closed inheritance and resolution
algorithm in the [Core Standard](standard.md#evaluation-profile-resolution).
This contract does not restate or alter that algorithm. For a `CONF-001` claim,
the claimant **MUST** provide every source profile, authenticated contract,
resolution record, replacement proof, effective projection, and fixture needed
to execute that primary algorithm without implementation-specific assumptions.
The conformance validator **MUST** apply the primary profile-resolution
algorithm unchanged and **MUST** reject a profile when any required input is
absent, unauthenticated, or cannot reproduce the declared effective digest. For
an A1–A3 `claims_eligible` slice, profile shape, work-product classification,
interaction-mode membership, outcome compatibility, and terminal-evidence
semantics are validated through the exact registered schemas and primary
contracts selected by that effective profile; conformance does not create a
second definition of them. For an A0 `diagnostic_only` slice, only the
standalone artifacts, identities, signatures, and effective profile resolution
are authenticated; those cross-artifact compatibility and profile-specific
case-acceptance checks **MUST NOT** run.

The repository **MUST** bundle one repository-change evaluation profile, one
compatible outcome profile, and positive and negative fixtures as an
interoperability example. Bundled and adopter-defined profiles receive identical
schema, semantic, inheritance, and base-compatibility validation when they
satisfy this contract and publish schemas, evidence, fixtures, versions, and
digests. A profile is not a separate conformance target.

Apply `ASSURE-001` in the core standard for A0 run semantics. Under `CONF-001`,
an A0 conformance statement **MUST** claim only the evaluator target, contain
exactly that one `targetEvidence` record, omit `decisionEnvelope`, and mark
every A0 scope slice `bindingUse: diagnostic_only`. This evaluator claim covers the
measurement stack, not compatibility or conformance of a bound profile, case,
suite, experiment, or decision.

## Conformance Targets

Conformance is claimed separately for exactly five targets represented by
`suite | case | evaluator | experiment | decision`:

1. **Suite conformance** — the suite has a bounded intended use, SDLC coverage
   map, validity argument, evaluation profiles, population, baselines, exposure controls,
   health rules, and claim registry.
2. **Case conformance** — a repository-grounded case satisfies its evaluation profile,
   projection, lifecycle, risk, data, Case QA, oracle-isolation, and outcome-
   evidence requirements.
3. **Evaluator conformance** — a runner and measurement stack enforce I1–I13,
   experiment arms, isolation, registries, attempt accounting, evidence,
   predicates, and detached validation.
4. **Experiment conformance** — one sealed experiment uses conforming suite,
   cases, evaluation profiles, evaluator, arms, cells, comparative design when applicable,
   and produces an immutable scorecard plus authenticated ledgers.
5. **Decision conformance** — a governance decision uses conforming claims at
   the required assurance level and satisfies the pinned policy, roles, scope,
   expiry, escalation, and post-decision assurance rules.

Every target **MUST** bind its target-specific subject schema: `suite-manifest-1`,
`case-1`, `evaluator-manifest-1`, `pre-run-manifest-1`, or
`governance-decision-1`, respectively. Resolving an ID and digest without
validating the target-specific schema is insufficient.

Target composition is closed and cryptographic. Suite, case, and evaluator
targets have no prerequisite conformance target. To claim `conforming`, an
experiment target **MUST** bind exactly one conforming suite, every scheduled
case as a conforming case, and exactly one conforming evaluator. To claim
`conforming`, a decision target **MUST** bind exactly one conforming experiment
and every scorecard used by the decision. A `not_claimed` or `nonconforming`
diagnostic **MAY** expose an incomplete prerequisite graph, but every dependency
it does declare **MUST** still be type-correct, authenticated, compatible, and
non-duplicated; incompleteness can never support a conforming verdict. Each prerequisite
conformance dependency **MUST** be one compound dependency-manifest entry that
contains the immutable target subject, its signed conforming statement, and the
signed passing detached validation envelope for that exact statement. The
statement and envelope **MUST** resolve to their declared raw-byte digests; the
envelope subject digest **MUST** reproduce the named statement projection; and
the dependency statement's target subject, target type, standard release, scope,
and validity interval **MUST** be compatible with the containing claim.
The sealed pre-run manifest **MUST** name the exact signed evaluator manifest
before execution. The experiment dependency graph **MUST** match the sealed
suite, every sealed case, and that evaluator by subject identity and
authenticated subject digest; matching an ID alone is insufficient.

A scorecard dependency **MUST** bind both the raw scorecard bytes and its
canonical subject digest, resolve as `scorecard-1`, and equal a scorecard named
by the decision subject. Missing, extra, duplicate, cyclic, nonconforming,
expired, scope-incompatible, or ambiguously paired dependencies make the
containing target nonconforming. Transitive dependencies are established by the
signed dependency statements; copying only their target IDs or verdict strings
is not composition evidence.

Conformance at one target does not imply another. `full conformance` is a
derived presentation label, not a sixth target or a statement value. It
**MUST NOT** be derived merely from any five passing statements. It requires a
signed, independently validated aggregate manifest over a verified dependency
graph: every case is an exact member of the suite; the experiment binds the
exact suite, cases, evaluator, profiles, and repositories; the decision binds
the exact experiment, scorecard, and claims; and all scope slices and validity
intervals are compatible. Version 0.1.0 does not publish an aggregate-
conformance-manifest schema, so an implementation **MUST NOT** publish the `full
conformance` label until that required future artifact and its semantic
validator are versioned and available. A target field **MUST NOT** use `full` or
a profile as its value.

## Requirement Coverage

`CONF-002` — Every target record **MUST** contain a closed requirement-coverage
matrix. The matrix contains exactly the requirements whose authenticated
registry entry includes the claimed target; requirements for other targets are
absent rather than marked `not_applicable`. Each included requirement has
exactly one status:

- `pass`: a registered deterministic verifier replayed successfully, or every
  criterion of an authorized independent accountable review passed;
- `fail`: evidence establishes violation;
- `insufficient_evidence`: required evidence is absent, invalid, expired, or
  indeterminate.

Each `requirementResult` **MUST** include `requirementId`, `target`, a
digest-bound `applicabilityContract`, `status`, `verifierOrReviewer`, canonical
`evidenceIds`, `evaluationProfileRuleIds`, and deterministic `claimEffect`.
The contract pointer **MUST** resolve to a signed
`conformance-applicability-contract-1`; its `ruleId` **MUST** select exactly one
rule for the same requirement and target. The contract **MUST** bind every scope
slice to its exact effective evaluation profile. Its rule predicate **MUST** be
typed `target_membership`, bind the recomputed digest of the authenticated
requirement-registry entry's ID, targets, and applicability rule, and derive
applicability from registry target membership. An issuer cannot exclude an
applicable requirement. Unknown rules, unresolved contracts, indeterminate
predicates, irrelevant evidence, expired evidence, or an unresolvable
selected-profile rule produce `insufficient_evidence`.

The authenticated requirement-registry entry is the sole owner of verification
criterion strength. Each entry **MUST** contain one `verificationContract` with:

- `criterionId` equal to `<requirementId>.complete`;
- `strength: complete_primary_definition`;
- `normativeReference` exactly equal to the entry's primary
  `normativeReference`;
- the exact question “Does the target satisfy every applicable REQUIRED
  obligation of `<requirementId>` at `<normativeReference>` and every named
  semantic contract invoked there, and either satisfy or record an approved,
  scoped deviation for every applicable RECOMMENDED obligation?”; and
- `permittedMethods` derived from `verificationKind`: `schema` and `semantic`
  permit only `automated_replay`; `manual_governance` permits only
  `accountable_review`. Assurance level does not relax this partition: A2 or A3
  review is additional assurance and **MUST NOT** replace required replay.

This single complete criterion is atomic for conformance aggregation: it cannot
be replaced by a subset of clauses, a looser question, or locally selected
acceptance criteria. A verifier registry entry **MUST** project, byte for byte,
the canonical verification contract for every allowed requirement ID and
**MUST NOT** add, omit, split, merge, or rewrite a criterion. Its authority is
limited to installed implementation and actor authorization. A mismatch makes
the affected result `insufficient_evidence`; it cannot be approved as an
extension or deviation.

A proof-set is an authenticated binding graph, not an authority for its own
result. It **MUST NOT** contain an assertion status, reviewer verdict, or an
unresolvable `verifierOutputDigest` that a validator merely trusts. For each
`pass` or `fail` row and each scope slice, the validator **MUST** instead find
exactly one assertion that points to material
`agent-eval-conformance-verification-record-1` bytes and binds the exact target
subject, dependency manifest, scope slice, requirement, and input artifacts by
raw-byte SHA-256 digest and byte length. The proof-set itself **MUST** first be
authenticated through its evidence-artifact wrapper.

Every assertion also binds one material, signed
`agent-eval-conformance-verifier-registry-1`. The registry signature **MUST**
chain to a trust anchor provisioned outside the claimant, statement, proof-set,
and cited evidence. Its entry fixes the allowed requirement IDs and JCS digest
of each exact authenticated requirement-registry entry, method, exact input
roles, authorized actor/key/trust-domain tuples and, for automated checks, the
adapter ID, executable bytes, runtime, and exported function. A validator
**MUST** execute only a locally installed allow-listed adapter whose raw bytes
match the registered digest; it **MUST NOT** load or execute claimant-selected
code merely because a URI names it.

For `automated_replay`, the validator first verifies that the entry projects
the requirement-owned complete criterion, then resolves and hashes every
registered input, reruns the pinned adapter, and derives result and findings
from that execution. A signed record that says `pass` while replay says
anything else is invalid. `accountable_review` is valid only for a
`manual_governance` requirement; a reviewer-authored criterion result cannot
establish a schema or semantic obligation, even when it is independently signed
or used at A2 or A3. For an eligible manual-governance requirement, the reviewer
key and trust domain **MUST** be externally authorized and independent of both
claimant and verifier-registry authority. The record **MUST** answer the
requirement-owned complete criterion exactly once, cite only bound material
inputs, and include a nonempty rationale that addresses every applicable
required obligation, recommendation, and deviation at the primary definition
and invoked semantic contracts. The validator derives `pass` only
when that criterion passes, `fail` when it fails, and otherwise
`insufficient_evidence`. A reviewer signature authenticates accountability; it
does not permit a missing, invented, subdivided, or weakened criterion. Missing
proof is allowed only for an
`insufficient_evidence` row and can never be upgraded by a declaration.

`evaluationProfileRuleIds` **MUST** list every selected-profile rule that affects
the result and **MUST** be empty only when no selected-profile rule applies (as
in a base-only or A0 result).
Claim effect is `none` for `pass`, `nonconforming` for `fail`, and `insufficient_evidence` for
`insufficient_evidence`. Its target **MUST** equal the containing target record.
A target conforms only when every applicable REQUIRED requirement is `pass` and every
approved **SHOULD** deviation is explicitly recorded with its rationale and
claim restriction. The target verdict is derived, never chosen by the issuer:
any `fail` yields `nonconforming`; any `insufficient_evidence` or missing
applicable row yields `not_claimed`; only complete qualifying coverage yields
`conforming`. A `not_claimed` statement is useful diagnostic output but is not a
conformance claim and does not require a passing detached validation envelope.

The reference non-circular proof verifier and focused positive/negative vectors
are executable with:

```text
node tools/verify-noncircular-conformance-proofs.mjs
```

The bundled decision statement is intentionally `not_claimed`: version 0.1.0
does not bundle replay adapters for every applicable decision requirement and
does not contain a complete authenticated prerequisite-conformance graph.
Turning placeholder digests or self-reported passes into a demonstrative
`conforming` fixture would overstate what the repository proves. Adopters may
produce a conforming statement only after supplying the complete registered
verification and dependency evidence required above.

## Conformance Statement

A public or internal conformance statement **MUST** contain:

- statement ID, issuer identity, issue time, and scope;
- draft version and exact repository commit; an unpublished draft has no release tag;
- one target record and its requirement-coverage matrix;
- an immutable `targetSubject {id, version, uri, digest}` whose URI resolves to
  the exact bytes of the claimed suite, case, evaluator, experiment, or
  decision, plus a canonical digest-bound dependency manifest;
- assurance levels, effective-risk range, capability families, outcome profiles,
  and applicability boundary;
- suite, case, evaluator, experiment, scorecard, policy, matrix, evaluation
  profile, profile-resolution record, schema, and semantic-validation versions
  and digests as applicable;
- implementation and arm identities for evaluator or experiment targets;
- the exact versioned signature-profile pointer used to authenticate the statement;
- the separately governed `claimTrustProfile` and `claimTrustUse` explicitly
  selected by every effective leaf evaluation profile in scope and shared by
  those leaves for the statement;
- canonical evidence manifest;
- extensions, deviations, unsupported requirements, and affected claim IDs;
- effective, review, and expiry timestamps for decision targets;
- issuer signature using the domain separator and projection in the
  [Signature and Trust Profile](signature-and-trust-profile.md), which omits
  only `signature.value` and retains its metadata.

The scope is structured, not inferred from `intendedUse` prose. It **MUST**
contain only `intendedUse`, the
`repository_grounded_sdlc_agent_evaluation` applicability boundary, and a
nonempty `slices[]`. Every slice has a unique ID and independently binds one
resolvable content-addressed `workspace-manifest-1`, exactly one effective leaf
`evaluationProfile`, one or more authenticated outcome profiles, a nonempty
subset of the closed SDLC capability-family taxonomy, interaction modes, work-
artifact types, assurance, risk tiers, `bindingUse`, and one signed grounding
payload with exactly four typed assertion IDs. `claims_eligible` A1–A3 slices
require full evaluation-profile, outcome-profile, registry, and scope
compatibility. `diagnostic_only` A0 slices require exact authentication but do
not claim or test that compatibility. Versions of adopter snapshots and
profiles are authenticated exact-match identities and are not required to equal
the standard's version. A general-agent,
customer-support, office-automation, browser-use, or embodied-agent claim
cannot become conforming by retaining only foundation invariants or by writing
repository-related words in `intendedUse`.

Artifact-signature verification and operational claim trust are separate. A
statement using repository fixture keys **MUST** declare
`conformance_fixture_requires_external_rekey` and an explicit restriction on
`deployment_trust`. `deployment_bound` requires externally provisioned,
owner-verified trust and **MUST NOT** resolve to repository reference keys.
Operational claim trust is a leaf deployment binding, not inherited measurement
semantics. Artifact-signature trust is leaf-bound for the same reason. A child
profile **MUST** explicitly declare `signatureProfile`, `claimTrustProfile`, and
`claimTrustUse` even when repeating its parent. Each source profile in the chain
is verified under its own declared signature profile before resolution; the
effective profile uses the leaf signature binding. An adopter may bind a child
to externally rooted artifact-signature and `deployment_bound` claim trust
without changing inherited evaluation semantics. The child profile itself
**MUST** be signed by a key authorized under its leaf signature binding.
`deployment_bound` requires typed key authorization, revocation, trusted-time,
and anti-rollback contracts and rejects fixture/reference trust, an unallowed
algorithm, an unauthorized artifact type, owner role, or assurance-by-risk
scope, a reassignable key ID, and an inactive or out-of-interval key. The
profile-signing key's authorized scopes **MUST** cover every Cartesian-product
tuple in the leaf's `supportedAssuranceLevels` and `effectiveRiskRange`. Any
omitted, unresolved, unauthenticated, or downgraded binding fails closed.

One statement claims exactly one target: `targetEvidence` **MUST** contain
exactly the record named by `claim`. Evidence about another target belongs in a
separately signed statement and **MUST NOT** appear as a second conforming target
record. The target record's `targetId` **MUST** equal its resolved
`targetSubject.id`; reusing the same ID with different bytes or a different
digest is a hard failure. Its dependency manifest **MUST** enumerate the exact
target subject, scope workspaces, effective evaluation profiles, selected
work-artifact registries, outcome profiles, and applicability contracts. Proof
artifacts bind this manifest but are excluded from its entries to avoid a digest
cycle. For an experiment or decision, it **MUST** additionally contain the exact
compound conformance dependencies and decision scorecards required by the
closed target composition rules above.

The dependency-manifest digest is `sha256:` plus SHA-256 of the UTF-8 RFC 8785
JCS bytes of exactly `{id, version, entries}` under those field names. It
**MUST NOT** include the manifest's `digest` or any proof artifact. The verifier
**MUST** reject any other projection even when all declared entries happen to
resolve.

The statement is the validation subject and **MUST NOT** embed its semantic-
validation result. A conforming claim consists of the signed statement plus a
separate signed `validation-envelope-1` whose subject digest equals the
statement digest. Every typed requirement-proof payload, every material
verification record, and the detached envelope **MUST** repeat the exact
target-subject digest and dependency manifest;
a subject-ID echo is insufficient. An unsigned statement or missing envelope is an
unauthenticated assertion, not conformance.
The publication bundle or conformance API **MUST** return the statement and its
detached envelope as one discoverable pair; the envelope is not embedded in the
statement because doing so would create a digest cycle.

## Extensions and Deviations

`CONF-003` — An extension **MAY** add stricter rules, gates, evaluation profiles,
or decision conditions under a documented namespace. It **MAY** add fields only
inside a schema-declared extension container, or in a separate namespaced
artifact reached through a pointer that the base schema expressly permits. It
**MUST NOT** inject fields into a closed base object, treat permissive parser
behavior as an extension point, or remove, rename, narrow, or reinterpret a base
or selected-evaluation-profile requirement.

Unknown extensions that affect validity, acceptance, claims, risk, or governance
yield `insufficient_evidence` for the affected claim. Readers claiming extension
support **MUST** preserve and validate its fields and authenticate every separate
extension artifact. An extension that cannot be represented through one of the
two permitted forms is incompatible, not an ignorable annotation.

A deviation **MUST** identify requirement ID, reason, affected targets and claim
IDs, compensating evidence, owner, expiry, and restriction. A deviation from a
**MUST** requirement prevents conformance for the affected target. The word
`partial` **MUST NOT** hide that result.

## Normative Artifact Consistency

Authority is partitioned by question. `Primary` below means the one registered
requirement definition; `invoked` means a closed algorithm or control whose
authority exists only because that primary definition names it.

| Question | Authority role | Authoritative artifact |
| --- | --- | --- |
| requirement identity, primary location, targets, ownership, applicability, and evidence basis | primary index | `requirement-registry.json` together with the linked primary requirement prose |
| accepted JSON structure | normative shape | JSON validation keywords in the registered JSON Schema; annotations such as `$comment`, `title`, `description`, and `examples` are informative |
| evaluation-profile inheritance, effective projection, provenance and replacement-proof algorithm | primary requirement plus normative shape | the closed `PROFILE-001` algorithm in the core standard together with `profile-resolution-record.schema.json` |
| canonicalization, hashing, signatures, cross-field and cross-document verdict algorithms | invoked normative contract | the exact named semantic contract, but only for the scope stated by its invoking primary requirement |
| executable interoperability verdicts | derived projection | conformance fixtures derived from registered primary requirements and invoked semantic contracts |
| requirement-to-source traceability and publication readiness | primary traceability record | `source-evidence-manifest.json`; the cited external sources remain informative |
| implementation technique | non-normative | tooling and implementation notes |

By `ARCH-001`, a semantic document that no registered primary anchor invokes has
no verdict-changing authority. The invocation identifies the contract
unambiguously, the dependency manifest binds its exact distributed bytes, and
the named contract cannot expand the invoking requirement's targets,
applicability, or consequences.

Every conformance statement **MUST** bind two exact raw-byte distribution
manifests. The schema manifest enumerates every distributed JSON Schema. The
contract manifest enumerates every standard-owned JSON contract, every
profile-owned JSON contract, and every Markdown file under `standard/` that can
supply primary or invoked normative prose. Each entry binds stable ID, version,
repository-relative URI, and SHA-256 of the exact file bytes; the manifest also
binds the canonical digest of the complete ordered entry array. The validator
**MUST** independently enumerate the distribution and require set and byte-digest
equality. A missing, extra, duplicate, renamed, or changed file fails closed.
A release tag or commit string does not substitute for these manifests; when an
implementation additionally cites one, it **MUST** resolve that identifier to
the same authenticated distribution bytes.

Fixtures **MUST NOT** create an obligation without a registered requirement and
primary normative location. Tools **MUST NOT** redefine a contract or fixture.
Generated projections **SHOULD** derive from one canonical rule definition. A
contradiction within or across authoritative artifacts that can change a
verdict is a draft defect: implementations **MUST** fail that path closed and
**MUST NOT** claim conformance until one candidate revision resolves it.
Informative rationale, examples, external sources, and implementation notes
cannot weaken a normative requirement.

Schema annotations **MUST NOT** supply a missing semantic rule. A validator may
use them as implementation guidance only after resolving the registered
primary requirement and named semantic contract; disagreement is resolved in
favor of those primary artifacts, never the annotation.

## Independent Verification

Evidence **MUST** be sufficient for an independent reviewer to reproduce the
target verdict without privileged oral context. The validator **MUST** verify
schema and semantic consistency, signatures, evidence attestations, requirement
coverage, subject digest, and expiry. It **MUST** verify evaluation-profile and
outcome-profile compatibility for every A1–A3 `claims_eligible` slice and
**MUST NOT** report such compatibility for an A0 `diagnostic_only` slice. A
self-reported boolean is not evidence. This standard does not appoint a
certifier or imply legal or regulatory compliance.
