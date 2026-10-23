# Adoption Guide

- Status: unpublished 0.1.0 publication candidate
- Version: 0.1.0
- Purpose: an informative implementation guide. The registered requirements
  and their primary contracts define conformance.

## Minimum implementation: an A1 repository-change evaluation

A1 is the smallest level for a bounded capability claim. It is limited to low
or medium effective risk and cannot support a release, autonomy, or risk
acceptance decision. Start with the [A1 contract](conformance.md#baseline-a1)
and the registry entries whose `minimumLevel` is `A1`.

For a repository-change case, use `CAP.IMPLEMENT_CHANGE` and one material
`workArtifactType` whose mapping is in the
[work-artifact registry](work-artifact-registry.json). The bundled
[`repo-change-v1` profile](../profiles/repo-change-v1/README.md) is an
interoperability example. Evaluation- and outcome-profile bindings are A2
requirements; they are not needed to establish an A1 claim. At A1, the existing
case acceptance checks and descriptions define the evidence and outcome
classification under [`OUT-001`](scorecard-contract.md#primary-outcome-categories).

Build these six document types in order. Keep each seal in Git before work that
depends on it:

1. **Case** (`case-1`, [`case.schema.json`](../schemas/case.schema.json)). Pin
   the repository state and visible inputs; describe the task, material work
   product, all four scope tests and rationales, deterministic checks, hard
   gates, oracle isolation, and effective risk. In the acceptance descriptions
   and checks, seal outcome distinctions and any refusal or already-satisfied
   alternative. Commit this candidate case.
2. **Case QA** (`case-qa-1`,
   [`case-qa.schema.json`](../schemas/case-qa.schema.json)). A reviewer
   independent of the case author checks scope and inferability before results
   exist. A known-good result must pass; a no-op, plausible wrong result, and,
   where applicable, disabled-test and hard-coded-output controls must fail
   stably; record why a trivial-strategy control does not apply. Record the
   `already_satisfied` no-op alternative only when it is registered and
   independently verified. The QA record binds the candidate case; then commit
   the active case with only its `lifecycle` added.
3. **Run manifest** (`run-manifest-1`,
   [`run-manifest.schema.json`](../schemas/run-manifest.schema.json)). Pin the
   active cases, identify every arm, and declare the no-action baseline, a
   distinct non-agent control (recommended; record the gap if omitted), trial schedule, replacement policy, claims and
   decision rules, and `stat-defaults-v1` or explicit statistical overrides.
   Commit the manifest before the first attempt; that commit is the seal point.
4. **Attempt ledger** (`attempt-ledger-1`,
   [`attempt-ledger.schema.json`](../schemas/attempt-ledger.schema.json)).
   Record every dispatched attempt, including invalid and replacement
   attempts, in the hash chain. Reconcile never-dispatched cells against the
   sealed schedule as unresolved, without inventing attempts. Commit ledger updates to Git; the
   manifest seal commit must be an ancestor of the first attempt.
5. **Scorecard** (`scorecard-1`,
   [`scorecard.schema.json`](../schemas/scorecard.schema.json)). Derive counts,
   outcomes, gate failures, per-case results, identification bounds, and
   intervals from the ledger and the sealed rules. Keep gates, outcomes, claim
   status, and verdict in their separate fields.
6. **Conformance statement** (`conformance-statement-1`,
   [`conformance-statement.schema.json`](../schemas/conformance-statement.schema.json)).
   Record one result for every applicable A1 requirement. Have the independent
   reviewer review the subject and results, commit that review, then commit the
   statement binding the review commit in `independentReview.recordedAtCommit`.

The [worked example](../examples/core/README.md) shows the document contents,
Git order, and scorecard arithmetic. For deterministic cases, two people can
cover author/configurer and independent review; judgment-bound checks need two
independent raters in addition to the author/configurer.

## Where implementation rules live

Use the
[requirement registry](requirement-registry.json) to select applicable
requirements and locate each primary definition. The [Conformance
Contract](conformance.md) defines A1 coverage and how a statement's verdict is
derived.

| Implementer question | Authority |
| --- | --- |
| What obligations apply? | The registered primary requirement and its linked contract. The [Core Standard](standard.md) owns most requirements; [Scorecard](scorecard-contract.md), [Evidence and Validation](evidence-and-validation-contract.md), and [Conformance](conformance.md) own their registered requirements. |
| Is the JSON document well-formed? | The matching JSON Schema in [`schemas/`](../schemas/). Schemas define accepted structure, not cross-document truth. |
| Do references, hashes, Git order, ledger, scorecard, and verdict agree? | The invoked semantic contract: chiefly [Integrity and Semantic Validation](evidence-and-validation-contract.md#integrity-and-semantic-validation-contract), [Scorecard](scorecard-contract.md), and the [Git repository-state contract](git-repository-state-contract.md). A schema-valid document may still fail these checks. |
| How is an A1 case activated? | `CASE-004` in the [Core Standard](standard.md#activation-and-maintenance) and the [A1 activation record](case-qa-playbook.md#activation-record). The playbook's stages 1–6 are A2/A3 requirements. |
| What do examples establish? | Nothing normative. [`examples/`](../examples/README.md) illustrates document shape and calculations; it cannot add or waive requirements. |

At A1, independent review replaces the detached validation envelope, not the
automated semantic checks required by the requirement registry.

The repository's `npm test` checks schemas, examples, bundled contracts, and
links. It does not validate an adopter's evaluation. An independent
implementation needs semantic checks for the registered requirements it
claims, with its own positive and negative vectors.

## What changes at A2 and A3

A2 and A3 retain the A1 artifacts and add requirements. Do not build these
attachments just to make an A1 capability claim.

- **A2** adds evaluation- and outcome-profile bindings, a validity argument,
  risk assessment, operational policy, held-out budget and ledger, canonical
  evidence-artifact records, Case QA stages 1–6, and detached validation of the
  conformance statement. Outcome profiles with `replayContract` also bind the shared executor
  through the run's `replayImplementation`. Multi-arm runs add a comparative design; governance
  runs also seal a decision plan before execution.
- **A3** adds an evaluation threat model, separate security approval, a bound
  post-decision assurance plan, and adversarial positive controls.

See [assurance levels](standard.md#assurance-levels) and the registered
requirements for the exact conditions. The A2/A3 path is a draft annex and may
change incompatibly.

Case profile references use the profile's declared self-digest; run attachments
with `{path, commit, digest}` authenticate stored file bytes. These digests may
differ for the same profile file; both are recomputed under their named contract.

### Preparing an A2/A3 pilot

Before spending the run budget, work through these steps with the independent
reviewer:

1. Fix the claim population, intended application envelope, risk assessment,
   and assurance level. A capability-only claim does not grant a release or
   autonomy approval; `RISK-001` still requires the intended decision envelope
   for claims-eligible A2/A3 runs.
2. Prepare the operational policy, profiles, Case QA, held-out budget and
   pre-debits, and any governance decision plan. For A3 also prepare the threat
   model, separate security approval, and contingent assurance plan. Keep
   run-specific inputs in the decision plan rather than the reusable policy.
3. Finalize all run fields except `validityArgument`, then follow the
   [validity-argument sealing order](evidence-and-validation-contract.md#validity-argument-run-binding).
   Review the argument and seal the complete manifest before the first attempt.
4. Exercise the implementation's preflight checks and decision outcomes before
   dispatch. The examples below are useful boundary cases, not conformance
   evidence supplied by this repository.

| Boundary case | Expected behavior |
| --- | --- |
| `pass_hat_k`, `k=3`, three scheduled cells per case | One all-three-successful indicator per case. An unresolved cell remains in the failure/success bounds. |
| `pass_hat_k`, `k=3`, two or four scheduled cells per case | Reject before dispatch; if discovered later, `insufficient_evidence`. Do not select three from four. |
| Approval with all policy conditions passing | Bind the independently approved assurance plan, including all 13 material-change triggers. See the [approval shape example](../examples/valid/governance-decision.approve.json). |
| Failed or insufficient policy condition | Apply the sealed reject/insufficient rule; no approval. A rejecting decision does not bind an assurance plan. |
| Required monitoring evidence missing or late after approval | Suspend the affected approval under the sealed rule and record the governance event. |

Complete the pilot with authenticated evidence, detached validation, and the
independent conformance review. Schema checks alone cannot establish that these
cross-document and operational behaviors work.

## Pinning and governance

This candidate is unpublished. A conformance statement pins version `0.1.0`
and the exact standard commit. After publication, it must also pin the
protected annotated release tag. A “based on” statement is not a conformance
claim.

For governance use, prepare the decision plan and controls before the run, then
make a separate decision against validated experiment evidence. Use the
[Governance Policy](annex/governance-policy.md) and
[decision-record template](annex/governance-decision-record.md); keep
decisions, renewals, waivers, and rollbacks in a version-controlled governance
record. Record expected assurance-monitoring windows there as well. Missing or
late monitoring evidence suspends the affected approval; this candidate does
not define a schema for those observations.

## Invariants to preserve

- Seal everything that affects the verdict before results are observed (`I3`).
- A failed acceptance or hard gate cannot be offset by quality, cost, or a
  composite score (`I1`); indeterminate gates do not pass (`I10`).
- Keep claims within the declared population and evidence (`I6`), and use
  deterministic checks for objectively executable or mechanically inspectable
  outcomes (`I9`).

This repository defines contracts only. It supplies no evaluation runner,
grader, benchmark suite, certification, or leaderboard.
