# Git-backed Repository SDLC Agent Evals Glossary

- Status: unpublished 0.1.0 publication candidate
- Version: 0.1.0
- Purpose: canonical terms used by the normative artifacts.

Terms are defined here once. An evaluation profile can add narrower terms under its
namespace but cannot change these meanings.

## Scope and Design

- **Repository-grounded SDLC agent evaluation** — an evaluation whose claim-
  bearing work passes the four material repository-grounding tests against a
  sealed Git workspace manifest and produces, verifies, or justifies
  a repository-governed code, review, test, design, release, operations, or
  incident artifact or decision. The artifact may be stored outside the
  repository; its claim and acceptance invariants remain bound to the sealed
  repository state. Clarification, handoff, and coordination are ancillary to
  these outcomes. This is the standard's conformance scope.
- **Sealed repository snapshot** — an immutable, content-addressed Git workspace
  manifest that identifies every repository root and selects exactly one
  executable repository-state mode: `tree_snapshot`, `bounded_ancestry`, or
  `full_ancestry`. It binds the selected tree or commit, exact Git object
  closure, repository-governed non-code inputs, and any gitlink to a separate
  repository entry. It may bind one repository or a coordinated multi-
  repository workspace. Storage inside or outside a repository neither
  establishes nor defeats scope; the four material-grounding tests do.
- **Materially repository-grounded** — the repository state is necessary task
  input; each material claim-bearing outcome has an acceptance invariant that
  traces to that state; the result changes, verifies, or justifies a repository-
  governed artifact or SDLC decision; and a verifier-selected semantic
  counterfactual changes each exact claim/outcome predicate from executed
  `pass` to executed `fail`. The case records a typed evidence pointer for each
  test and an externally bound predicate/executor/intervention contract for every
  material outcome and claim. A link, ticket, arbitrary repository blob, missing
  bytes, code fragment, or output path alone does not establish this.
- **Foundation layer** — the internal cross-cutting invariants for evidence,
  isolation, claims, and governance used inside this repository-SDLC base
  standard. They are candidates for a future shared extraction, not evidence
  that the rules are domain-neutral. The layer is not a separate conformance
  target.
- **Base standard** — requirements common to every repository-grounded SDLC
  evaluation: identity, projection, experiment, evidence, accounting, claims,
  risk, and conformance.
- **Evaluation profile** — a versioned specialization for one or more SDLC
  capability families, repository environments, or work-product classes. It
  supplies allowed outcome profiles, applicable gates, QA controls, metrics, and
  domain rules by narrowing or strengthening the base standard. It cannot add a
  capability family or new domain. It has zero or one parent and resolves to one
  deterministic `effectiveProfileDigest`. Bundled and adopter-defined profiles
  receive the same schema, semantic, inheritance, and base-compatibility
  validation; a profile is not itself one of the five conformance targets.
- **Profile terminology** — `evaluation profile`, `outcome profile`, `signature
  profile`, and `claim-trust profile` are distinct contracts. Normative text and
  machine fields use the qualified term; unqualified `profile` is explanatory
  shorthand only when exactly one kind is possible in context.
- **Effective profile resolution** — deterministic parent-to-child flattening
  using the closed merge key for each field. Every effective requirement mapping
  retains a `sourceProfileId`; a repeated key is accepted only as a proven
  narrowing or strengthening, and every other conflict fails closed.
- **SDLC capability family** — one stable ID in the closed taxonomy:
  `CAP.DISCOVER_SPECIFY`, `CAP.PLAN_DESIGN`, `CAP.IMPLEMENT_CHANGE`,
  `CAP.VERIFY_ASSURE`, `CAP.REVIEW_DECIDE`, `CAP.RELEASE_OPERATE`, or
  `CAP.REMEDIATE_LEARN`.
- **Work-artifact registry** — the authenticated standard-owned, closed mapping
  from each material work-artifact type to exactly one SDLC capability family.
  Every declared artifact type maps to a selected family, and every selected
  family has at least one material mapped type; a family with none is an invalid
  passenger.
- **Interaction-mode ID** — one of `noninteractive_repository_task`,
  `interactive_repository_session`, `pull_request_workflow`, or
  `ci_or_release_workflow`. A case selects exactly one supported ID as
  `interactionModeId`; `interactive` and `non_interactive` are not aliases.
- **Outcome profile** — the versioned result-shape contract selected through an
  evaluation profile for a case. It defines terminal evidence, valid
  alternatives, evidence mode, gates, failure taxonomy, and claim compatibility.
  It cannot expand capability, risk, assurance, or base scope. A workspace diff
  is a content-addressed evidence artifact required by the bundled repo-change
  profile for `solved`; it is not itself an outcome profile.
- **Normalized primary outcome** — one of the eight base aggregation classes
  used to compare and count trials across compatible profiles. `solved`,
  `correct_refusal`, and `already_satisfied` describe normalized satisfaction
  classes, not profile-native vocabulary. Every trial also preserves its
  registered profile-native outcome and optional substatus; normalization never
  discards whether a review was approved, changes were requested, a rollout was
  rolled back, or an incident cause was established.
- **Universal gate** — the name used in requirement `GATE-001` for a core
  non-compensable gate that applies to every conforming repository-SDLC
  evaluation inside this standard's applicability boundary; it is not a claim
  about agents generally.
- **Intended use** — the users, decisions, environment, assurance level, and
  risk context for which evaluation evidence is designed.
- **Construct** — the capability, behavior, risk, or quality the evaluation
  intends to measure, distinct from a convenient proxy metric.
- **Validity argument** — the versioned claim-to-evidence argument addressing
  representation, construct validity, alternative explanations, criterion and
  production concordance, error, missingness, and decision consequences.
- **Material** — relative to one named outcome, risk, acceptance, claim,
  conformance, or governance predicate, an artifact, state, condition, actor, or
  dependency is material when the selected contract requires it, the
  authenticated dependency graph records it as directly or transitively
  consumed, or a pre-declared admissible intervention that removes or substitutes
  only it while holding other bound inputs fixed changes that predicate. An item
  is incidental only when an evaluator-controlled rule and authenticated
  dependency evidence establish that none of those tests applies. A claimant's
  label, storage location, or omission from its own manifest cannot establish
  immateriality.
- **Claim-bearing** — directly or transitively consumed by a registered claim's
  eligibility, estimand, value, interval, population or scope, limitation, or
  status predicate. Evidence against a claim and evidence that narrows a claim
  are claim-bearing as well as evidence that supports it.
- **Decision-bearing** — directly or transitively consumed by an acceptance or
  hard-gate predicate, effective-risk classification, authorization, escalation,
  suspension or revocation rule, or governance decision. Diagnostic material is
  not decision-bearing unless one of those predicates consumes it.
- **Incidental** — proven non-material for the exact named predicates under the
  materiality rule above. `incidental` is a derived result, not a claimant-chosen
  evidence class. An unresolved dependency or counterfactual cannot produce it.

## Suites and Cases

- **Evaluation suite** — a case collection designed to measure related
  constructs under one suite manifest and validity argument.
- **Case** — one repository-grounded evaluation task with a content-addressed
  workspace manifest, a sealed agent-visible projection, exactly one effective
  evaluation profile and one outcome profile in every run. Non-A0 use requires
  those profiles to be compatible; A0 retains both bindings as `diagnostic_only`
  without asserting compatibility. A case also binds one concrete interaction-
  mode ID, a nonempty capability-family subset with no passenger family, closed
  material work-artifact types, typed applicability evidence, environment, risk
  metadata, QA evidence, owner, and lifecycle.
- **Agent-visible projection** — the complete sealed input visible to an arm:
  task, repository history projection, documentation, policies, retrieval
  corpus, tool schemas, and interaction protocol. Hidden requirements are not
  part of this projection.
- **Oracle material** — reference solutions, hidden checks, grader fixtures,
  scoring internals, or derived state unavailable to an evaluated arm.
- **Leakage control** — one validated oracle-domain detector: a canary with
  semantic-inertness evidence, authenticated access telemetry, or a matched
  decoy. A missing detection is not proof that the oracle remained clean.
- **Held-out slice** — cases reserved for release or autonomy evidence under an
  exposure budget. The task projection becomes visible during an authorized
  attempt; oracle material remains hidden.
- **Exposure budget** — the sealed limit and immutable history of agent,
  configuration-family, provider-session, operator, activation, pilot, and reuse
  exposure for held-out cases.
- **Lifecycle state** — `candidate`, `active`, `saturated`, `regression`,
  `quarantined`, or `retired`.
- **Case QA record** — evidence that a case, its projection, outcome profile,
  checks or adjudication, controls, and graders satisfy activation requirements.
- **Decision surface** — a pre-registered consequential decision not
  necessarily proven by the terminal artifact. It has materiality,
  applicability, coverage, evidence, valid alternatives, and claim effect.
- **Declared coverage gap** — a pre-registered applicable surface with no
  adequate measurement. It restricts named claims and never becomes pass.

## Experiment and Execution

- **Run / sealed experiment** — one pre-registered experiment containing one or
  more arms, a fixed scheduled-cell manifest, shared measurement identity,
  claims, and, when applicable, a comparative design.
- **Arm** — one fully identified system-under-evaluation configuration in an
  experiment. Its identity covers model, harness, prompts, policies, tools,
  permissions, budgets, retrieval, memory, context, environment, and external
  services. It excludes the measurement profile.
- **Measurement profile** — the effective evaluation-profile digest plus the
  outcome-profile ID, version, and digest bound to a case/cell. Direct comparator
  arms share it; changing it defines a measurement-system study, not a direct
  agent comparison.
- **Comparative design** — the sealed definition of comparator arms, declared
  treatment bundle, paired cases, blocking or randomization, ordering, reset,
  interference control, and analysis.
- **Scheduled cell** — one `cellId`, case, arm, repetition, explicit block, and
  explicit seed. It is the experimental observation resolved once by an
  eligible lineage.
- **Physical attempt** — one execution within a cell's retry lineage. It is an
  accounting unit, not an additional observation.
- **Trial** — the valid selected result that resolves a scheduled cell. A cell
  without a valid eligible lineage member is unresolved.
- **Attempt ledger** — the runner-owned authenticated append-only record of
  scheduled, started, completed, interrupted, missing-capture, and replacement
  attempts, including lineage, telemetry, validity, and artifact hashes.
- **Interactive protocol** — the versioned contract for actors, components,
  roles, permissions, projections, scheduler, shared state, events, terminal
  rules, and responsibility.
- **Agent configuration** — the complete evaluated model-and-harness behavior
  configuration, not a model label.
- **Evaluation harness** — runner infrastructure that materializes cases,
  invokes arms, isolates trials, captures evidence, calls graders or packages
  adjudication, and aggregates results.
- **Agent harness** — the evaluated scaffold that orchestrates a model, context,
  tools, memory, retries, and stopping.
- **Adapter** — the integration boundary that invokes an agent harness without
  changing case or scoring semantics.

## Evidence and Judgment

- **Evidence artifact** — one `evidence-artifact-1` record binding immutable
  bytes to media type, digest, producer, role, trust domain, phase, access,
  retention, schema, timestamp, and attestation.
- **Validation envelope** — a detached signed `validation-envelope-1` that binds
  a validator verdict to a subject digest. The subject does not embed its own
  envelope.
- **Measurement trust domain** — runner-owned graders, adjudication packaging,
  commands, manifests, result channels, and capture mechanisms that evaluated
  output cannot modify.
- **Deterministic verifier** — runner-owned executable or formal logic producing
  reproducible typed evidence for a mechanically decidable fact.
- **Expert adjudication** — qualified, blinded, independent multi-rater
  evaluation under a versioned rubric, uncertainty and sealed conflict
  resolution.
- **Model-based grader** — a model used for auxiliary grading, triage, or
  annotation. It is not sole evidence for a hard safety gate or deterministic
  fact.
- **Governance status** — an accountable review or authorization condition kept
  separate from automated gates, grading, outcomes, and decision verdicts.
- **Automated hard gate** — a backed, stable, fail-closed condition whose failure
  makes an outcome unacceptable regardless of quality or composite metrics.
- **Control proof** — recomputable evidence that a verifier or adjudication
  protocol distinguishes expected positive and negative controls.

## Outcomes, Claims, and Statistics

- **Primary outcome** — the Scorecard Contract's mutually exclusive trial
  classification derived from terminal state, trajectory, policy evidence, and
  measurement validity.
- **Successful outcome** — a trial satisfying `functional-outcome-v1`.
- **Accepted outcome** — a successful trial satisfying
  `accepted-outcome-v1`; it is not a release or autonomy decision.
- **Claim** — one registered proposition with intended use, construct,
  estimand, population, scope, success predicate, analysis, threshold, and
  evidence status. One scorecard can contain multiple claims.
- **Claim status** — `supported`, `insufficient_evidence`, or `not_applicable`,
  computed independently for each claim.
- **Validity** — whether measurement supports interpretation and attribution,
  distinct from success or acceptance.
- **Assurance level** — `A0 diagnostic_run`, `A1 capability`, `A2 release`, or
  `A3 autonomy`, expressing required evidence depth rather than a quality score.
- **Assurance overlay** — the base-owned cumulative A1–A3 requirements plus
  structured profile additions. A profile can narrow its supported levels or add
  evidence requirements; it cannot replace or weaken the base level.
- **A0 / `diagnostic_run`** — an experiment with `runMode: diagnostic_run`,
  `claimEligibility: none`, no claims, and case-profile bindings marked
  `diagnostic_only`. It can diagnose evaluator mechanics but cannot support
  positive claims or suite, case, experiment, or decision conformance. It may
  support evaluator conformance; the bindings only make measurement semantics
  reproducible and do not assert profile compatibility.
- **Production telemetry** — evidence used for validity, concordance, drift, and
  post-decision assurance. A real production action is never an evaluation case;
  controlled fixtures or simulations represent operational work in a case.
  Production telemetry is not task input, trial outcome evidence, or a scheduled
  cell.
- **Production-derived fixture input** — a content-addressed controlled input
  declared by `inputOrigin: production_derived`. Before its consuming pre-run
  seal, authenticated passing evidence binds its provenance, data-owner
  authorization, redaction, re-identification-risk approval, and verified
  absence of production read/write paths, live connections, and credentials.
  Its source cutoff is strictly earlier than that seal. It is governed
  evaluation data, not live production telemetry or trial outcome evidence.
- **Input origin** — the closed environment-contract discriminator `synthetic`,
  `public`, or `production_derived`. Only `production_derived` carries a non-null
  `productionDerivedInput` proof bundle; semantic validation rejects relabeling.
- **Evaluation mode** — `controlled_fixture` or `simulation`, the only execution
  modes for an evaluation case. Both require `productionActionAllowed: false`.
- **Inherent task hazard** — potential harm arising from the task content before
  deployment exposure is considered.
- **Effective risk** — the policy-derived tier for task hazard combined with
  data, autonomy, permissions, environment, deployment, blast radius, oversight,
  likelihood, and uncertainty.
- **pass@k** — a pre-declared estimator of at least one successful result among
  `k` eligible repetitions under its sampling and dependence assumptions.
- **pass^k / reliability@k** — a pre-declared estimator of all `k` eligible
  repetitions succeeding under its sampling and dependence assumptions.
- **Identification bounds** — the range of claim values compatible with observed
  resolved cells and sealed assumptions about unresolved cells. A valid-only
  estimate is not an identification bound.
- **Composite score** — a diagnostic summary after gate and eligibility checks.
  It is not a claim or governance decision.
