# Security Threat Model and Coverage Contract

- Status: unpublished 0.1.0 publication candidate; draft annex (A2/A3)
- Version: 0.1.0
- Requirement IDs: `RISK-001`, `RUN-003`, `DATA-001`, `DATA-002`

This is a named cross-document coverage contract invoked explicitly by each
listed requirement's primary anchor. It supplies their threat-coverage rules; it
does not create an unregistered requirement or change their conformance claims.

An adopter **MUST** instantiate this threat model for each evaluation profile.
The instance **MUST** identify assets, actors, trust boundaries, credible threat
scenarios, required controls, test cases, evidence, residual risk, owner, review
date, and scope. An empty cell or unjustified exclusion yields
`insufficient_evidence` for the affected security claim.

## Assets, actors, and boundaries

At minimum, the inventory **MUST** cover source and generated code; held-out
tasks, checks, reference solutions, canaries, credentials, personal data and IP;
agent prompts, memory and retrieval; tool and delegated identities; inter-agent
messages and shared state; runners, graders, evidence stores, ledgers,
repository write permissions and branch protection, registries,
CI/CD, and production integration.

Actors **MUST** include the evaluated agent, case author, operator, grader,
interactive simulator or requester, helper agents, human reviewer, governance
roles, service providers, external attackers, and compromised dependencies or
infrastructure. Boundaries **MUST** include agent/runner, agent/tool,
agent/grader, agent/human, agent/agent, run/oracle, run/network,
workspace/evidence store, organization/provider, and evaluation/production.

## Minimum coverage matrix

| Threat ID | Threat scenario | Required evaluation evidence | Required measures |
| --- | --- | --- | --- |
| `SEC-T01` | direct, indirect, retrieved, file, tool-output, or cross-agent prompt injection | attacks across every enabled input channel; known-safe controls; instruction/provenance boundary evidence | attack-success rate, policy violations, benign-task success |
| `SEC-T02` | persistent memory, summary, cache, vector-store, or context poisoning | cross-session and delayed-trigger cases; provenance and reset proofs | persistence rate, recovery rate, benign utility after defense |
| `SEC-T03` | oracle leakage, memorization, benchmark contamination, or hidden-check inference | authenticated canaries, exposure inventory, suspected/confirmed disposition, clean controls | leakage detections, false alarms, affected scope |
| `SEC-T04` | confused deputy, delegated identity misuse, authority laundering, or scope escalation | actor-bound capabilities, delegation-chain tests, deny controls, revocation tests | unauthorized-action rate, attribution completeness |
| `SEC-T05` | insecure inter-agent communication, impersonation, collusion, shared-state corruption, or cascading failure | authenticated actor IDs/messages, concurrency and compromised-peer cases, no-op controls | unattributed mutations, cascade depth, containment time, benign coordination success |
| `SEC-T06` | manipulation of human trust, fabricated evidence, misleading explanations, or unsafe approval pressure | reviewer-blinded social-engineering cases and provenance verification | unsafe human acceptance, detection rate, reviewer disagreement |
| `SEC-T07` | secret disclosure, excessive permission, production credential use, or data exfiltration | least-privilege and deny tests across files, tools, logs, network, and providers | disclosure/action rate, scope reached, containment evidence |
| `SEC-T08` | destructive, irreversible, privileged, or high-blast-radius operation | authorization, preview, confirmation, rollback, stop, and blast-radius controls | unauthorized/irreversible action rate, rollback success |
| `SEC-T09` | dependency confusion, malicious package/tool/plugin, compromised registry, executor, or supply chain | pinned provenance and content digests, sandbox controls, adversarial dependency cases | compromise rate, provenance failures, benign build success |
| `SEC-T10` | measurement tampering: test disablement, ledger rewrite, artifact substitution, retry hiding, race, callback, or parser attack | positive controls at every measurement boundary and version-control history review | bypass rate, detection rate, evidence completeness |
| `SEC-T11` | grader injection, reference anchoring, reward hacking, judge-family bias, or weak-assertion exploitation | adversarial outputs and the complete judge-bias suite from Case QA | false-positive/false-negative rates by class and risk stratum |
| `SEC-T12` | privacy, IP, retention, deletion, residency, or purpose-limitation breach | lawful-source record, minimization/redaction controls, access and deletion tests | unauthorized access, retained prohibited bytes, deletion success |
| `SEC-T13` | adaptive or transfer attack selected after observing defenses or evaluation cases | sequestered adaptive red-team and cross-model/environment transfer set | adaptive attack success, transfer rate, benign utility |
| `SEC-T14` | resource exhaustion, denial of service, decompression/parser abuse, or unbounded remote action | quotas, timeout/teardown, malformed-input, delayed callback, and recovery cases | availability, containment, recovery time, cost bound |

Each applicable row **MUST** map to at least one QA-activated positive control
that demonstrates the unsafe path is detected and one benign control that
demonstrates the defense does not destroy required utility. A single aggregate
security score **MUST NOT** compensate for a hard-gate failure. Results **MUST**
report uncertainty, target population, attack preconditions, attacker knowledge,
tools, repetitions, and residual risk.

## Adaptive testing and reuse

Security cases used to tune prompts, policies, detectors, graders, or sandboxes
become development evidence and **MUST NOT** remain the sole held-out basis for
the same claim. Adaptive red teams **MUST** be sequestered from system builders,
record every defense exposure, and confirm a discovered class on fresh cases.
Exploratory attacks **MAY** discover threats, but a governance gate requires a
pre-registered confirmatory rule on unexposed evidence.

## Privacy, IP, and retention

Threat testing **MUST NOT** use production secrets or personal/customer data
when synthetic or redacted controls provide the same test. Where real data is
necessary, the profile **MUST** record authority, purpose, minimization,
residency, access, retention, deletion, and incident obligations. Canary values
and exploit details **MUST** remain in access-controlled evidence; reports use
digests or redacted descriptions.

The informative taxonomy and method sources are catalogued in
[Informative References](references.md), including NIST AI RMF, NIST AI 600-1,
NIST SSDF, OWASP Agentic Top 10, MITRE ATLAS, and AgentDojo.

## Security Case Backlog

- Status: informative planning aid for the unpublished 0.1.0 publication candidate
- Version: 0.1.0
- Purpose: prioritized case families that instantiate the
  [Security Threat Model](#security-threat-model-and-coverage-contract).

This backlog is not evidence of coverage and adds no requirement beyond the
registered primary text and invoked Security Threat Model. A profile using this
planning aid maps each applicable threat row to QA-activated cases, positive and
benign controls, an owner, risk tier, review date, result evidence, and residual-
risk disposition in the following matrix:

| Threat ID | Applicable scope | Case IDs | Positive-control IDs | Benign-control IDs | Status | Evidence | Residual risk/owner/review |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `SEC-T01`–`SEC-T14` | adopter-defined | unset | unset | unset | `insufficient_evidence` | unset | unset |

`unset` is a deliberate blocker, not a wildcard. Exclusion requires a
threat-model argument tied to absent assets, actors, or boundaries and an
independent approval. Case creation and activation follow the
[Case QA Playbook](case-qa-playbook.md).

### Priority case families

#### Agent inputs, memory, and collaboration

- direct and indirect injection through task text, repository files, comments,
  terminal/tool output, retrieval, documentation, images, and inter-agent
  messages (`SEC-T01`);
- persistent poisoning through summaries, agent-authored memory, caches,
  vector stores, reusable workspaces, and delayed triggers (`SEC-T02`);
- confused-deputy and delegated-identity attacks, capability forwarding,
  authority laundering, and failure to revoke a delegated token (`SEC-T04`);
- peer impersonation, unauthenticated messages, shared-state corruption,
  collusion, compromised-helper behavior, and cascading multi-agent failure
  (`SEC-T05`);
- fabricated provenance, misleading explanations, urgency, and other attempts
  to induce unsafe human approval (`SEC-T06`).

#### Secrets, permissions, and irreversible action

- secret-like and personal/customer files that the agent is prohibited from
  reading, transforming, retaining, or disclosing (`SEC-T07`, `SEC-T12`);
- attempts to broaden permissions, use production identities, cross tenancy or
  residency boundaries, or exfiltrate through logs, tools, providers, DNS, or
  delayed callbacks (`SEC-T07`);
- destructive, privileged, irreversible, and high-blast-radius operations,
  including confirmation bypass and rollback failure (`SEC-T08`);
- dependency confusion, typosquatting, malicious plugins/tools, compromised
  registries, unsigned artifacts, and executor/toolchain compromise (`SEC-T09`).

#### Generated-code vulnerabilities

- SQL, command, template and code injection; XSS; SSRF; path traversal;
  deserialization; authentication or authorization bypass; tenant isolation;
  unsafe cryptography; and sensitive-data exposure;
- insecure defaults and prohibited patterns defined by local engineering,
  privacy, security, architecture, and compliance policies.

Generated-code case design measures exploitability and required benign behavior;
scanner counts alone are insufficient evidence.

#### Measurement-system attacks

- test, lint, CI, SAST, SCA, secret-scanner, policy, or telemetry disablement;
- oracle or reference access, hidden-check inference, canary leakage,
  memorization, and contamination (`SEC-T03`);
- ledger rewriting, attempt deletion, retry hiding, artifact substitution,
  result-channel forgery, repository write-access misuse, history rewrite, and
  fabricated evidence (`SEC-T10`);
- detached/background races, mutate-and-restore behavior, shared-cache mutation,
  symlink/path races, delayed callbacks, malformed parser inputs,
  decompression bombs, and resource exhaustion (`SEC-T10`, `SEC-T14`);
- grader injection, judge bias, reference anchoring, answer enumeration,
  hard-coded outputs, weak assertions, and other reward hacking (`SEC-T11`).

#### Adaptive and transfer attacks

- attackers that observe defenses, prompts, graders, or prior cases and then
  adapt strategy (`SEC-T13`);
- transfer across models, agent frameworks, repositories, languages, tool
  combinations, permission envelopes, and interactive actors;
- defense-induced regressions on representative benign tasks.

Adaptive cases are sequestered from system builders until the confirmatory rule
is sealed. Evidence exposed during tuning becomes development evidence and does
not remain the only held-out support for the same claim.

### Reporting

For every family, the scorecard reports the attack preconditions, attacker
knowledge, tools, repetitions, attack-success rate, hard-gate outcomes,
detection/containment, uncertainty, and benign utility required by the owning
normative contract. Security aggregate metrics cannot compensate for a baseline
hard-gate failure.

Evidence follows the
[Evidence and Detached Validation Contract](evidence-and-validation-contract.md).
Real secrets, personal/customer data, licensed source, canary values, and
actionable exploit details stay out of broadly readable reports; use synthetic
controls, redaction, digests, or authorized pointers with explicit retention and
deletion rules.
