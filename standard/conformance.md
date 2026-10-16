# Conformance Contract

- Status: unpublished 0.1.0 publication candidate
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
leaf evaluation profile, one or more authenticated outcome profiles, assurance
(`A1`–`A3`), risk, capability families, interaction modes, and work-artifact
types. The evaluation profile, outcome profiles, registry, and declared scope
**MUST** be compatible. A validator **MUST NOT** infer a cross-profile or
cross-repository union from fields belonging to different slices. An A0
diagnostic run is not a conformance subject and has no slice.

`CONF-001` invokes the versioned
[Integrity and Semantic Validation Contract](integrity-and-semantic-validation.md)
as its cross-document verdict algorithm and
[Normative Artifact Consistency](#normative-artifact-consistency) as its exact
distribution-identity contract. A target cannot satisfy `CONF-001` by validating
schema shape while omitting an applicable check from either contract.

The applicability-boundary label is not evidence. Every case in a slice
**MUST** carry the four `SCOPE-003` tests as holding, each with a rationale
confirmed by an independent Case QA reviewer. A slice containing a case whose
tests are unconfirmed is outside the boundary and may be represented honestly
only as `insufficient_evidence`.

The foundation invariants are part of this base standard. They are not a
standalone general-agent certification. An evaluation outside the applicability
boundary **MUST NOT** claim conformance by citing only those invariants. A new
domain requires a separate sibling base or domain standard; an evaluation
profile cannot expand this standard into one. Version 0.1.0 defines no
inheritance, conformance, or compatibility relation from this standard to such a
sibling. Future shared-foundation eligibility is defined by
[SCOPE-003](standard.md#applicability-boundary-and-profiles).

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

`PROFILE-001` is defined in the
[Core Standard](standard.md#evaluation-profile-resolution), which invokes the
complete [resolution algorithm](profile-resolution-contract.md).
This contract does not restate or alter that algorithm. For a `CONF-001` claim,
the claimant **MUST** provide every source profile, authenticated contract,
resolution record, replacement proof, effective projection, and fixture needed
to execute that primary algorithm without implementation-specific assumptions.
The conformance validator **MUST** apply the primary profile-resolution
algorithm unchanged and **MUST** reject a profile when any required input is
absent, unauthenticated, or cannot reproduce the declared effective digest. Profile
shape, work-product classification, interaction-mode membership, outcome
compatibility, and terminal-evidence semantics are validated through the exact
registered schemas and primary contracts selected by that effective profile;
conformance does not create a second definition of them.

The repository **MUST** bundle one repository-change evaluation profile, one
compatible outcome profile, and positive and negative examples as an
interoperability example. Bundled and adopter-defined profiles receive identical
schema, semantic, inheritance, and base-compatibility validation when they
satisfy this contract and publish schemas, evidence, examples, versions, and
digests. A profile is not a separate conformance target.

## Core Level

The Core level is the entry level of this standard. It lets a small team make a
bounded, trustworthy capability claim about a repository-SDLC agent without the
full evidence graph, operational policy, or governance machinery. It uses only
content digests and Git commits for integrity, under the
[integrity model](evidence-and-validation-contract.md#integrity-model).

A Core claim covers one Core experiment: its cases, Case QA records, sealed run
manifest, attempt ledger, and scorecard, described by the `core-*` schemas in
[`schemas/`](../schemas/). Core conformance is not one of the five targets
below and does not imply any of them. Every Core claim has assurance level
`A1-lite` and these fixed limits:

- effective risk is `low` or `medium`, with a recorded rationale;
- the environment is a controlled fixture or simulation with no production
  action or production credential;
- claims are capability claims only. A `release`, `autonomy`, or
  `risk_acceptance` decision **MUST NOT** cite Core evidence, and an A1–A3
  claim **MUST NOT** cite it either; reaching a higher level requires a new run
  under the full requirements;
- a claim of improvement over an incumbent workflow is permitted only when
  that incumbent was measured as an arm.

Core conformance requires every obligation below. Each obligation applies the
named requirements in the stated Core form; where the Core form is narrower
than the full requirement (notably `CASE-004`, which at Core needs only the
three controls and one review rather than the full playbook), the narrowing is
deliberate and is the reason Core claims cannot reach governance use.

| ID | Obligation | Requirements | Core form |
| --- | --- | --- | --- |
| C1 | System identity | `SCOPE-001` | Every arm records model, agent configuration, prompts, harness, tools, permissions, and budgets by version or digest. |
| C2 | Repository grounding | `SCOPE-003` | Each case records all four `SCOPE-003` tests as holding, each with a rationale reviewed in Case QA. |
| C3 | Pre-registration | `I3` | The run manifest — cases, arms, repetitions, retry policy, claims, decision rules, and statistics — is committed before the commit containing the first attempt, and is never edited afterward. |
| C4 | Oracle isolation | `HOLD-001` | Hidden checks and reference solutions are outside every agent-readable path, history, and remote; attributed access is a hard-gate failure and unattributed exposure invalidates the run. |
| C5 | Non-compensable acceptance | `I1`, `GATE-001` | Success is exactly "every acceptance check and every hard gate passes"; no quality, cost, or composite value can override a failed gate. |
| C6 | Evidence fits the construct | `I9`, `JUDGE-002`, `JUDGE-003` | Executable or mechanically inspectable outcomes use deterministic runner-owned checks. A judgment-bound check uses at least two [independent](glossary.md#independence) raters; a model grader is never sole evidence for a hard gate. |
| C7 | Validated cases | `I12`, `CASE-004` | Each active case has a known-good result that passes, a no-op result and at least one plausible wrong result that fail, repeated stably, and an inferability review by a person independent of the case author. |
| C8 | Complete attempt accounting | `RUN-002` | A hash-chained attempt ledger committed to Git records every scheduled and started attempt, including invalid and replacement attempts; a replacement links its original and is not a new observation. |
| C9 | Separate fields and bounded claims | `OUT-001`, `CLAIM-001`, `CLAIM-002`, `I6` | Hard-gate results, primary outcomes, claim status, and decision verdict are separate fields; each claim states its population, case count, and restrictions and does not extend beyond them. |
| C10 | Unit of analysis and declared statistics | `STAT-001`, `STAT-003` | Cases are the analysis unit; repeatability claims need repeated trials per case; estimators and intervals follow the [base statistical defaults](standard.md#base-statistical-defaults) or overrides sealed in the run manifest. |
| C11 | Missingness | `STAT-002` | The scorecard reports scheduled, resolved, valid, invalid, and replacement counts per arm and identification bounds for every success metric; a valid-only estimate alone supports no claim. |
| C12 | Non-agent baselines | `VALID-003` | The run includes a no-action baseline and a distinct non-agent control, measured with the same checks. An unmeasured incumbent is recorded and restricts claims. |
| C13 | Least privilege | `I7` | No production credentials; tools, network, and writable paths are limited by the environment, not by instructions to the agent. |

A Core conformance statement records one status per obligation — `pass`,
`fail`, or `insufficient_evidence` — with evidence locations given as
repository path, commit, and digest. Its verdict is derived: any `fail` yields
`nonconforming`; otherwise any `insufficient_evidence` yields `not_claimed`;
only thirteen `pass` rows yield `core_conforming`. A `core_conforming` verdict
additionally requires a review of the statement by a person
[independent](glossary.md#independence) of the claimant, recorded at a commit.
Under the small-team model two people suffice for every Core role.

A complete Core experiment with real numbers is worked through in
[`examples/core/`](../examples/core/README.md).

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

Target composition is closed and content-addressed. Suite, case, and evaluator
targets have no prerequisite conformance target. To claim `conforming`, an
experiment target **MUST** bind exactly one conforming suite, every scheduled
case as a conforming case, and exactly one conforming evaluator. To claim
`conforming`, a decision target **MUST** bind exactly one conforming experiment
and every scorecard used by the decision. A `not_claimed` or `nonconforming`
diagnostic **MAY** expose an incomplete prerequisite graph, but every dependency
it does declare **MUST** still be type-correct, authenticated, compatible, and
non-duplicated; incompleteness can never support a conforming verdict. Each prerequisite
conformance dependency **MUST** be one compound dependency-manifest entry that
contains the immutable target subject, its conforming statement, and the
passing detached validation envelope for that exact statement. The
statement and envelope **MUST** resolve to their declared raw-byte digests; the
envelope subject digest **MUST** reproduce the named statement projection; and
the dependency statement's target subject, target type, standard release, scope,
and validity interval **MUST** be compatible with the containing claim.
The sealed pre-run manifest **MUST** name the exact evaluator manifest
before execution. The experiment dependency graph **MUST** match the sealed
suite, every sealed case, and that evaluator by subject identity and
authenticated subject digest; matching an ID alone is insufficient.

A scorecard dependency **MUST** bind both the raw scorecard bytes and its
canonical subject digest, resolve as `scorecard-1`, and equal a scorecard named
by the decision subject. Missing, extra, duplicate, cyclic, nonconforming,
expired, scope-incompatible, or ambiguously paired dependencies make the
containing target nonconforming. Transitive dependencies are established by the
dependency statements and their passing validation envelopes; copying only
their target IDs or verdict strings is not composition evidence.

Conformance at one target does not imply another, and version 0.1.0 defines
no aggregate label over several targets. A target field **MUST NOT** use `full`
or a profile as its value.

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

Each `requirementResult` **MUST** include `requirementId`, `target`, `status`,
`verifierOrReviewer`, canonical `evidenceIds`, `evaluationProfileRuleIds`, and
deterministic `claimEffect`. Applicability is registry target membership and
nothing else: an issuer cannot exclude an applicable requirement, and a row for
a requirement not registered for the target is invalid.

The registry entry's `verificationKind` fixes the method. `schema` and
`semantic` requirements are established only by automated replay of the
registered primary definition and every semantic contract it invokes; a
reviewer statement cannot replace replay, and A2 or A3 review is additional
assurance, not a substitute. `manual_governance` requirements are established
only by an accountable review that answers, for the whole primary definition,
whether every applicable REQUIRED obligation is satisfied and every applicable
RECOMMENDED obligation is satisfied or covered by a recorded, scoped deviation.
The reviewer **MUST** be [independent](glossary.md#independence) of the
claimant, and the record names the reviewer, cites the evidence used, and gives
a rationale that addresses each applicable obligation. The validator derives
`pass` only from passing replay or a passing complete review, `fail` from a
failing one, and otherwise `insufficient_evidence`; a status asserted in
evidence is never trusted.

`evaluationProfileRuleIds` **MUST** list every selected-profile rule that affects
the result and **MUST** be empty only when no selected-profile rule applies (as
in a base-only result).
Claim effect is `none` for `pass`, `nonconforming` for `fail`, and `insufficient_evidence` for
`insufficient_evidence`. Its target **MUST** equal the containing target record.
A target conforms only when every applicable REQUIRED requirement is `pass` and every
approved **SHOULD** deviation is explicitly recorded with its rationale and
claim restriction. The target verdict is derived, never chosen by the issuer:
any `fail` yields `nonconforming`; any `insufficient_evidence` or missing
applicable row yields `not_claimed`; only complete qualifying coverage yields
`conforming`. A `not_claimed` statement is useful diagnostic output but is not a
conformance claim and does not require a passing detached validation envelope.

The bundled decision-statement example is intentionally `not_claimed`: the
repository ships no validator and no complete authenticated
prerequisite-conformance graph. Turning placeholder digests or self-reported
passes into a demonstrative `conforming` example would overstate what the
repository proves.

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
- canonical evidence manifest;
- extensions, deviations, unsupported requirements, and affected claim IDs;
- effective, review, and expiry timestamps for decision targets.

The statement is integrity-bound by its digest and the commit that publishes it,
under the [integrity model](evidence-and-validation-contract.md#integrity-model).

The scope is structured, not inferred from `intendedUse` prose. It **MUST**
contain only `intendedUse`, the
`repository_grounded_sdlc_agent_evaluation` applicability boundary, and a
nonempty `slices[]`. Every slice has a unique ID and independently binds one
resolvable content-addressed `workspace-manifest-1`, exactly one effective leaf
`evaluationProfile`, one or more authenticated outcome profiles, a nonempty
subset of the closed SDLC capability-family taxonomy, interaction modes, work-
artifact types, assurance, and risk tiers, and requires full
evaluation-profile, outcome-profile, registry, and scope compatibility.
Versions of adopter snapshots and
profiles are authenticated exact-match identities and are not required to equal
the standard's version. A general-agent,
customer-support, office-automation, browser-use, or embodied-agent claim
cannot become conforming by retaining only foundation invariants or by writing
repository-related words in `intendedUse`.


One statement claims exactly one target: `targetEvidence` **MUST** contain
exactly the record named by `claim`. Evidence about another target belongs in a
separate statement and **MUST NOT** appear as a second conforming target
record. The target record's `targetId` **MUST** equal its resolved
`targetSubject.id`; reusing the same ID with different bytes or a different
digest is a hard failure. Its dependency manifest **MUST** enumerate the exact
target subject, scope workspaces, effective evaluation profiles, selected
work-artifact registries, and outcome profiles. The detached validation
envelope binds this manifest but is excluded from its entries to avoid a digest
cycle. For an experiment or decision, it **MUST** additionally contain the exact
compound conformance dependencies and decision scorecards required by the
closed target composition rules above.

The dependency-manifest digest is `sha256:` plus SHA-256 of the UTF-8 RFC 8785
JCS bytes of exactly `{id, version, entries}` under those field names. It
**MUST NOT** include the manifest's `digest`. The verifier
**MUST** reject any other projection even when all declared entries happen to
resolve.

The statement is the validation subject and **MUST NOT** embed its semantic-
validation result. A conforming claim consists of the statement plus a separate
`validation-envelope-1`, produced by a validator
[independent](glossary.md#independence) of the claimant, whose subject digest
equals the statement digest. The detached envelope **MUST** repeat the
exact target-subject digest and dependency manifest; a subject-ID echo is
insufficient. A statement whose bytes do not match its published digest, or
that has no passing envelope, is an unauthenticated assertion, not conformance.
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
| evaluation-profile inheritance, effective projection, provenance and replacement-proof algorithm | primary requirement plus normative shape | the [resolution algorithm](profile-resolution-contract.md) invoked by `PROFILE-001`, together with `profile-resolution-record.schema.json` |
| canonicalization, hashing, cross-field and cross-document verdict algorithms | invoked normative contract | the exact named semantic contract, but only for the scope stated by its invoking primary requirement |
| illustrative instances | informative | `examples/`; an example demonstrates shape and cannot create, waive, or decide an obligation |
| requirement-to-source references | informative | `references.md`; cited external sources never create obligations |
| implementation technique | non-normative | the repository check, validator implementations, and implementation notes |

By `ARCH-001`, a semantic document that no registered primary anchor invokes has
no verdict-changing authority. The invocation identifies the contract
unambiguously, the pinned standard commit binds its exact distributed bytes, and
the named contract cannot expand the invoking requirement's targets,
applicability, or consequences.

The conformance statement pins the exact standard commit in
`standardRelease.commit`. The validator **MUST** resolve that commit and use
the schema and contract files it contains; a file set differing from that
commit fails closed.

Examples **MUST NOT** create an obligation without a registered requirement and
primary normative location. Tools **MUST NOT** redefine a contract or example.
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
schema and semantic consistency, content digests, producer authorization,
version-control order of sealed artifacts, requirement coverage, subject digest,
expiry, and evaluation-profile and outcome-profile compatibility for every
slice. A self-reported boolean is not evidence. This standard does not appoint a
certifier or imply legal or regulatory compliance.
