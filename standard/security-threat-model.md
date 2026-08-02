# Security Threat Model and Coverage Contract

- Status: unpublished working draft
- Version: 0.1.0
- Requirement IDs: `RISK-001`, `RUN-003`, `DATA-001`, `DATA-002`

This is a named cross-document coverage contract invoked explicitly by each
listed requirement's primary anchor. It supplies their threat-coverage rules; it
does not create an unregistered requirement or change their conformance targets.

An adopter **MUST** instantiate this threat model for each evaluation profile.
The instance **MUST** identify assets, actors, trust boundaries, credible threat
scenarios, required controls, test cases, evidence, residual risk, owner, review
date, and scope. An empty cell or unjustified exclusion yields
`insufficient_evidence` for the affected security claim.

## Assets, actors, and boundaries

At minimum, the inventory **MUST** cover source and generated code; held-out
tasks, checks, reference solutions, canaries, credentials, personal data and IP;
agent prompts, memory and retrieval; tool and delegated identities; inter-agent
messages and shared state; runners, graders, evidence stores, ledgers, signing
keys, checkpoints, registries, CI/CD, and production integration.

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
| `SEC-T09` | dependency confusion, malicious package/tool/plugin, compromised registry, executor, or supply chain | pinned provenance, signature and sandbox controls, adversarial dependency cases | compromise rate, provenance failures, benign build success |
| `SEC-T10` | measurement tampering: test disablement, ledger rewrite, artifact substitution, retry hiding, race, callback, or parser attack | positive controls at every measurement boundary and external checkpoint verification | bypass rate, detection rate, evidence completeness |
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
