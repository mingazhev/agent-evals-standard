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
The run manifest's `coverage` records the capability families in scope and
its gaps; the arm environment, evaluation profile (A2+), and outcome profile
**MUST** be compatible with that declared scope. A validator **MUST NOT** infer
a cross-profile or cross-repository union from unrelated fields. An A0
diagnostic run is not a conformance subject.

`CONF-001` invokes the versioned
[Integrity and Semantic Validation Contract](evidence-and-validation-contract.md#integrity-and-semantic-validation-contract)
as its cross-document verdict algorithm and
[Normative Artifact Consistency](#normative-artifact-consistency) as its exact
distribution-identity contract. A claim cannot satisfy `CONF-001` by validating
schema shape while omitting an applicable check from either contract.

The applicability-boundary label is not evidence. Every scheduled case
**MUST** carry the four `SCOPE-003` tests as holding, each with a rationale
confirmed by an independent Case QA reviewer. A case whose tests are
unconfirmed is outside the boundary and may be represented honestly only as
`insufficient_evidence`.

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

The base `SCOPE-003` applicability and four-test boundary are defined once in
the [Standard](standard.md#applicability-boundary-and-profiles). This
conformance contract only defines the evidence required to verify that
boundary; it does not redefine `SCOPE-003`.

The repository **MUST** bundle one repository-change evaluation profile, one
compatible outcome profile, and positive and negative examples as an
interoperability example. Bundled and adopter-defined profiles receive identical
schema, semantic, and base-compatibility validation when they
satisfy this contract and publish schemas, evidence, examples, versions, and
digests. A profile is not a separate conformance target.

## Baseline (A1)

A1 is the entry level of this standard. It lets a small team make a bounded,
trustworthy capability claim about a repository-SDLC agent without the full
evidence graph, operational policy, or governance machinery. It uses only
content digests and Git commits for integrity, under the
[integrity model](evidence-and-validation-contract.md#integrity-model).

An A1 claim is an experiment claim over one experiment: its cases, Case QA
records, sealed run manifest, attempt ledger, and scorecard, described by the
`case-1`, `case-qa-1`, `run-manifest-1`, `attempt-ledger-1`, `scorecard-1`, and
`conformance-statement-1` schemas in [`schemas/`](../schemas/). Every A1 claim
has these fixed limits:

- effective risk is `low` or `medium`, with a recorded rationale (`high` and
  `critical` require A3, and A2 allows `low` or `medium` only);
- the environment is a controlled fixture or simulation with no production
  action or production credential;
- claims are capability claims only. A `release`, `autonomy`, or
  `risk_acceptance` decision **MUST NOT** cite A1 evidence; reaching a higher
  level requires a new run under the A2 or A3 requirements;
- a claim of improvement over an incumbent workflow is permitted only when
  that incumbent was measured as an arm;
- evaluation and outcome profiles bind at A2 and above; at A1 every reference
  is a `{path, commit, digest}` reference, and the A1 statement is validated by
  independent review, not by an envelope.

The authoritative A1 set is every entry in the
[requirement registry](requirement-registry.json) with `minimumLevel` `A1`
(26 IDs). The list below groups them by theme and gives each one's A1 form.
Where that form is narrower than the full requirement (notably `CASE-004`,
which at A1 needs only the controls and one review rather than the full
playbook), the narrowing is deliberate and is the reason A1 claims cannot reach
governance use.

- **Identity and grounding.**
  - `SCOPE-001`: every arm records model, agent configuration, prompts, harness, tools, permissions, and budgets by version or digest.
  - `SCOPE-003`: each case records all four `SCOPE-003` tests as holding, each with a rationale reviewed in Case QA.
- **Pre-registration and oracle isolation.**
  - `I3`: the run manifest (cases, arms, repetitions, retry policy, claims, decision rules, statistics) is committed before the commit containing the first attempt and is never edited afterward.
  - `HOLD-001`: hidden checks and reference solutions are outside every agent-readable path, history, and remote; attributed access is a hard-gate failure and unattributed exposure invalidates the run.
- **Acceptance and evidence.**
  - `I1`, `GATE-001`: success is exactly "every acceptance check and every hard gate passes"; no quality, cost, or composite value can override a failed gate.
  - `I9`, `JUDGE-002`, `JUDGE-003`: executable or mechanically inspectable outcomes use deterministic runner-owned checks; a judgment-bound check uses at least two [independent](glossary.md#independence) raters, and a model grader is never sole evidence for a hard gate.
- **Validated cases.**
  - `I12`, `CASE-004`: each active case has a known-good result that passes; a no-op result, at least one plausible wrong result and, where the case has tests or hidden checks, a result with those tests disabled or weakened and a result that hard-codes the expected outputs all fail, repeated stably; a case where a trivial strategy is not applicable records why; and a person independent of the case author reviews inferability.
- **Accounting and statistics.**
  - `RUN-002`: a hash-chained attempt ledger committed to Git records every scheduled and started attempt, including invalid and replacement attempts; a replacement links its original and is not a new observation.
  - `OUT-001`, `CLAIM-001`, `CLAIM-002`, `I6`: hard-gate results, primary outcomes, claim status, and decision verdict are separate fields; each claim states its population, case count, and restrictions and does not extend beyond them.
  - `STAT-001`, `STAT-003`: cases are the analysis unit; repeatability claims need repeated trials per case; estimators and intervals follow the [base statistical defaults](standard.md#base-statistical-defaults) or overrides sealed in the run manifest.
  - `STAT-002`: the scorecard reports scheduled, resolved, valid, invalid, and replacement counts per arm and identification bounds for every success metric; a valid-only estimate alone supports no claim.
- **Baselines and least privilege.**
  - `VALID-003`: the run includes a no-action baseline and a distinct non-agent control, measured with the same checks; an unmeasured incumbent is recorded and restricts claims.
  - `I7`: no production credentials; tools, network, and writable paths are limited by the environment, not by instructions to the agent.

An A1 conformance statement records one `requirementResults` row per A1
requirement under [Requirement Coverage](#requirement-coverage). Under the
small-team model two people suffice for every A1 role, and independent review
suffices in place of a detached validation envelope.

A complete A1 experiment with real numbers is worked through in
[`examples/core/`](../examples/core/README.md).

## Conformance Targets

Conformance is claimed as exactly two claims, `experiment` and `decision`:

1. **Experiment claim** — one sealed experiment: its cases, Case QA, evaluation
   profile and outcome profile (A2+), run manifest, arms, cells, comparative
   design when applicable, attempt ledger, and scorecard. The requirements for
   cases and Case QA apply as part of the run, and the runner is the arm's
   measurement stack described in the run manifest. The subject binds a
   `run-manifest-1`, an `attempt-ledger-1`, and a `scorecard-1`.
2. **Decision claim** — a governance decision uses conforming experiment
   claims at the required assurance level and satisfies the pinned policy,
   roles, scope, expiry, escalation, and post-decision assurance rules. The
   subject binds one `governance-decision-1` and the scorecards it used, and
   requires a conforming experiment claim for each.

Resolving an ID and digest without validating the subject schemas is
insufficient. A `not_claimed` or `nonconforming` diagnostic **MAY** expose an
incomplete graph, but every reference it does declare **MUST** be type-correct,
compatible, and non-duplicated; incompleteness can never support a conforming
verdict.

A decision claim's scorecard references (`subject.scorecards`) **MUST** resolve as `scorecard-1` by
path, commit, and digest and equal the scorecards named by the decision.
Missing, extra, duplicate, nonconforming, expired, or scope-incompatible
scorecards make the decision claim nonconforming. Copying only IDs or verdict
strings is not composition evidence.

An experiment claim does not imply a decision claim. Version 0.1.0 defines no
aggregate label over several claims. A claim field **MUST NOT** use `full` or a
profile as its value.

## Requirement Coverage

`CONF-002` — Every conformance statement **MUST** contain a closed
requirement-coverage matrix. The matrix contains exactly the registry
requirements whose `targets` contain the claim and whose `minimumLevel` is at
most the statement's `assuranceLevel`; other requirements are absent rather
than marked `not_applicable`. Each row is a `requirementResults` entry
`{requirementId, status, evidence, note}` with exactly one status:

- `pass`: a registered deterministic verifier replayed successfully, or every
  criterion of an authorized independent accountable review passed;
- `fail`: evidence establishes violation;
- `insufficient_evidence`: required evidence is absent, invalid, expired, or
  indeterminate.

`evidence` lists at least one evidence location. Applicability is registry
membership and nothing else: an issuer cannot exclude an applicable
requirement, and a row for a requirement outside the claim and level is
invalid.

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

A claim conforms only when every applicable REQUIRED requirement is `pass` and every
approved **SHOULD** deviation is explicitly recorded with its rationale and
claim restriction. The verdict is derived, never chosen by the issuer:
any `fail` yields `nonconforming`; any `insufficient_evidence` or missing
applicable row yields `not_claimed`; only complete qualifying coverage yields
`conforming`, which also requires `independentReview.verdict` `confirmed`. A
`not_claimed` statement is useful diagnostic output but is not a conformance
claim.

## Conformance Statement

A conformance statement is a `conformance-statement-1` document. It **MUST**
contain:

- `id`, `version`, and `issuer`;
- `standard {version, commit}` — the draft version and exact repository commit;
  an unpublished draft has no release tag;
- `assuranceLevel` (`A1`, `A2`, or `A3`) and `claim` (`experiment` or
  `decision`);
- `subject`: for an experiment claim, `{runManifest, attemptLedger, scorecard}`;
  for a decision claim, `{governanceDecision, scorecards}` where `scorecards`
  is a nonempty list; each is a `{path, commit, digest}` reference;
- `requirementResults` — the matrix defined under
  [Requirement Coverage](#requirement-coverage);
- `restrictions` (`governanceUse`, `population`, `incumbentComparison`) and
  `independentReview {reviewer, verdict, recordedAtCommit}`;
- `verdict`: `conforming`, `nonconforming`, or `not_claimed`.

The statement is integrity-bound by its digest and the commit that publishes it,
under the [integrity model](evidence-and-validation-contract.md#integrity-model).
The statement pins the exact standard commit in `standard.commit`. The
validator **MUST** resolve that commit and use the schema and contract files it
contains; a file set differing from that commit fails closed.

A detached `validation-envelope-1` is **REQUIRED** at A2 and A3 and not used at
A1, where independent review suffices. The statement never references its
envelope and **MUST NOT** embed its own semantic-validation result. The envelope
is published alongside the statement and binds the statement digest; a verifier
discovers it by the publication location (the same directory or a publication
record), not by a field in the statement. A claim that requires an envelope
consists of the statement plus a separate envelope, produced by a validator
[independent](glossary.md#independence) of the claimant, whose subject digest
equals the statement digest. A statement whose bytes do not match its
published digest, or that lacks a required passing envelope, is an
unauthenticated assertion, not conformance.

`restrictions.governanceUse` is `prohibited` or `eligible`. At A1 it is
`prohibited`; at A2 and A3 either value is allowed. A decision claim requires
`eligible` on its own statement and on each supporting experiment statement.

A statement makes one claim. Evidence about the other claim belongs in a
separate statement. A general-agent, customer-support, office-automation,
browser-use, or embodied-agent claim cannot become conforming by retaining only
foundation invariants or by writing repository-related words in a restriction.

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

A deviation **MUST** identify requirement ID, reason, affected claims and claim
IDs, compensating evidence, owner, expiry, and restriction. A deviation from a
**MUST** requirement prevents conformance for the affected claim. The word
`partial` **MUST NOT** hide that result.

## Normative Artifact Consistency

Authority is partitioned by question. `Primary` below means the one registered
requirement definition; `invoked` means a closed algorithm or control whose
authority exists only because that primary definition names it.

| Question | Authority role | Authoritative artifact |
| --- | --- | --- |
| requirement identity, primary location, targets, ownership, applicability, and evidence basis | primary index | `requirement-registry.json` together with the linked primary requirement prose |
| accepted JSON structure | normative shape | JSON validation keywords in the registered JSON Schema; annotations such as `$comment`, `title`, `description`, and `examples` are informative |
| canonicalization, hashing, cross-field and cross-document verdict algorithms | invoked normative contract | the exact named semantic contract, but only for the scope stated by its invoking primary requirement |
| illustrative instances | informative | `examples/`; an example demonstrates shape and cannot create, waive, or decide an obligation |
| requirement-to-source references | informative | `references.md`; cited external sources never create obligations |
| implementation technique | non-normative | the repository check, validator implementations, and implementation notes |

By `ARCH-001`, a semantic document that no registered primary anchor invokes has
no verdict-changing authority. The invocation identifies the contract
unambiguously, the pinned standard commit binds its exact distributed bytes, and
the named contract cannot expand the invoking requirement's targets,
applicability, or consequences.

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
verdict without privileged oral context. The validator **MUST** verify
schema and semantic consistency, content digests, producer authorization,
version-control order of sealed artifacts, requirement coverage, subject digest,
expiry, and evaluation-profile and outcome-profile compatibility. A self-reported boolean is not evidence. This standard does not appoint a
certifier or imply legal or regulatory compliance.
