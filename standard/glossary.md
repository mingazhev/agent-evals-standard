# Agent Evals Glossary

- Status: current
- Purpose: shared terminology for the normative, contractual, and operational
  `agent-evals` documentation.

Terms are defined once in this glossary. Other documents may reference these
definitions but must not introduce local definitions with different semantics.

## Terms

- **Golden set** — the private, versioned collection of evaluation cases used by
  an evaluator. It contains development, held-out, smoke, and frozen-comparison
  slices as declared by the suite manifest.
- **Case (task or test case)** — one evaluation task with a pinned snapshot,
  task description, setup and validation procedures, scoring rules, risk tier,
  and owner. `Case` is the local contract name for what evaluation literature
  commonly calls a task or test case.
- **Held-out set** — a non-agent-visible suite slice reserved for release,
  governance, or autonomy evidence. It is not used in tuning, development, or
  provider training and is governed by I2.
- **Smoke set** — a small, fast suite slice for harness, prompt, or
  infrastructure checks. It is not evidence for capability, release, or
  autonomy claims.
- **Trial** — the result selected from the retry lineage for one scheduled cell,
  if a valid lineage member exists; otherwise the cell is unresolved.
- **Scheduled cell** — one pre-registered case, agent configuration, and
  repetition slot. It is the statistical sampling unit and is resolved once.
- **Physical attempt** — one execution in a scheduled cell's retry lineage. It
  is an accounting unit, never an additional statistical observation.
- **Run** — a set of scheduled cells performed against a fixed case-set version
  with a fixed agent configuration.
- **Validity** — the `valid` or `invalid` interpretation status of a selected
  trial. A physical attempt instead records `measurementValidity`:
  `valid`, `invalid`, or `not_assessable` when it was interrupted or its capture
  is insufficient. These fields answer whether measurement supports
  attribution, not whether the agent succeeded.
- **Decision surface** — a pre-registered decision whose correctness is not
  necessarily implied by the final workspace, such as tool selection, stop or
  escalation, handoff, or context management. It has materiality,
  applicability, coverage, evidence, and a verdict.
- **Indeterminate applicability** — a decision-surface applicability result that
  cannot be resolved by its pinned verifier. It fails closed as
  `insufficient_evidence` and prevents trial acceptance.
- **Declared coverage gap** — an explicit, pre-registered `declared_gap` on an
  applicable decision surface. It produces `not_evaluated`, never a silent pass,
  and restricts each affected run-level claim; unlike indeterminate
  applicability, it does not by itself change the trial predicate.
- **Agent configuration** — the exact model, agent harness, prompts, tool
  access, budgets, safeguards, and other settings under evaluation.
- **Grader** — logic that evaluates one aspect of agent performance. A grader
  may contain multiple assertions or checks and may inspect the transcript, the
  final outcome, or both.
- **Task outcome** — the final state of the environment at the end of a trial,
  as distinct from what the agent merely claims to have done.
- **Primary outcome** — the Scorecard Contract's mutually exclusive trial
  classification derived from task outcome, trajectory, policy evidence, and
  measurement validity. It is broader than the final environment state.
- **Transcript evidence** — the runner-captured append-only event stream of a
  trial as observed before compaction, summarization, filtering, tool-output
  clearing, or display transformation. It includes model-visible messages,
  tool calls and results, approvals, context-management events, and typed
  actor interactions. Derived views and agent-authored memory are untrusted
  supplements and never replace the pre-transform stream. Hidden chain of
  thought is neither required nor inferred.
- **Evaluation harness** — the infrastructure that runs evaluations end to end:
  it provides instructions and tools, isolates and executes trials, records
  traces and artifacts, invokes graders, and aggregates results.
- **Agent harness (scaffold)** — the system that turns a model into an agent by
  processing inputs, orchestrating tool use, managing state, and returning
  results. The evaluated agent includes both the model and this harness.
- **Evaluation suite** — a collection of tasks designed to measure related
  capabilities, behaviors, or failure modes.
- **Profile** — the stack- or domain-specific layer that provides bootstrap
  logic, graders, hidden checks, and local engineering rules.
- **Adapter** — the integration layer that invokes a particular agent or agent
  harness without leaking implementation details into the core case model or
  scoring logic.
- **Automated hard gate** — a deterministic acceptance condition whose failure
  makes a result unacceptable regardless of any quality metric or composite
  score.
- **Diagnostic check** — a measurement retained for analysis but absent from
  `scoring.hardGates`. A hard gate cannot be downgraded by labeling its backing
  evidence diagnostic.
- **Backing check** — an automated check that produces typed evidence for a
  specific gate. A process invocation or exit code without a valid result
  envelope is not backing evidence.
- **Control proof** — recorded evidence that a backing check distinguishes the
  expected positive and negative controls and is not vacuous. It is a property
  of the measurement system, not an agent result.
- **Governance gate/status** — an accountable review or approval condition that
  blocks acceptance until explicitly closed through a policy-valid `resolved`
  or `waived` terminal state but is not an automated grader. A determinate
  untriggered condition is `not_applicable`, not pseudo-resolved. It is represented
  by a field orthogonal to the outcome, such as `manual_review_required` or
  `security_review_required`.
- **Composite score** — a summary or triage signal calculated after hard gates;
  it is not an autonomous governance decision.
- **Successful outcome** — a trial for which the Scorecard Contract's
  `functional-outcome-v2` predicate is true. It is the default success event for
  pass@k and pass^k.
- **Valid functional outcome** — a successful outcome used as the conditioning
  event for efficiency analysis; its denominator names included outcome
  categories and attempts.
- **Accepted outcome** — a successful outcome for which
  `accepted-outcome-v2` is true: all expected blocking governance statuses are
  `not_applicable`, `resolved`, or policy-validly `waived`. This is a trial
  predicate, not a release or autonomy decision; the full canonical definition
  is in the Scorecard Contract.
- **Invalid trial/run** — a trial or run whose result cannot be interpreted as
  agent success or failure because a case contract is violated, a required gate
  lacks backing evidence, oracle isolation is compromised, a trigger state is
  indeterminate, or the measurement system is corrupted.
- **Attempt ledger (ledger)** — the runner-owned, append-only record of every
  physical attempt and its `scheduled → started → completed|interrupted|missing_capture`
  lifecycle, including replacements, measurement-validity reasons, retry
  lineage, typed telemetry, and artifact hashes.
- **Measurement trust domain** — runner-owned grader execution, commands,
  manifests, result channels, and artifact capture that agent-controlled code
  cannot modify and that remain distinct from agent-authored evidence.
- **pass@k** — the probability of at least one successful outcome in `k`
  independent attempts.
- **pass^k / reliability@k** — the probability that all `k` independent trials
  succeed; a consistency signal relevant to autonomy decisions. `k`, the
  estimator, reset conditions, and any departure from independence are fixed in
  the statistical plan.
- **Conservative bound** — a pre-registered interval that assigns unresolved or
  invalid observations in the direction least favorable to the claim. The
  default binary and comparative formulas are defined by the Scorecard
  Contract; “valid-only” is not itself a conservative bound.
- **Risk tier** — a pre-assigned level of potential harm and required
  governance that is not changed retroactively after results are observed.
- **Lifecycle state** — a case state: `candidate`, `active`, `saturated`,
  `regression`, `quarantined`, or `retired`.
- **Regression case** — a case in lifecycle state `regression`, used to detect
  regressions under its sealed reliability threshold and case-set membership;
  it is not automatically a must-pass requirement.
- **Case QA record** — a case-activation artifact containing evidence for the
  stages in the [Case QA Playbook](case-qa-playbook.md).
- **Canary marker** — a unique string embedded in case artifacts to detect
  leakage beyond the evaluation boundary.
- **Memorization probe** — a check for whether a model or harness reproduces a
  reference solution without repository access.
- **Diff scope** — a grader-owned comparison between the current workspace and
  a trusted base manifest, including additions, modifications, deletions, file
  modes, and every regular-file type. A workspace-owned baseline is not trusted.
- **Approver** — the accountable person authorized by policy to make the stated
  decision and independent of the experiment operator and evidence producer.
- **Risk owner** — the person accountable for residual harm within the approved
  scope and for rollback when a pre-registered condition triggers.
- **Security approver** — the policy-authorized independent approver for a
  security-sensitive decision or closure.
- **False-positive / false-negative owner** — the named owner responsible for
  triage, remediation, and revalidation of the corresponding grader defect.
- **Data owner** — the authority for access, retention, export, rotation, and
  held-out status of case data.
