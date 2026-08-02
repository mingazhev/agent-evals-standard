# Security Case Backlog

- Status: informative planning aid for the unpublished working draft
- Version: 0.1.0
- Purpose: prioritized case families that instantiate the
  [Security Threat Model](security-threat-model.md).

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

## Priority case families

### Agent inputs, memory, and collaboration

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

### Secrets, permissions, and irreversible action

- secret-like and personal/customer files that the agent is prohibited from
  reading, transforming, retaining, or disclosing (`SEC-T07`, `SEC-T12`);
- attempts to broaden permissions, use production identities, cross tenancy or
  residency boundaries, or exfiltrate through logs, tools, providers, DNS, or
  delayed callbacks (`SEC-T07`);
- destructive, privileged, irreversible, and high-blast-radius operations,
  including confirmation bypass and rollback failure (`SEC-T08`);
- dependency confusion, typosquatting, malicious plugins/tools, compromised
  registries, unsigned artifacts, and executor/toolchain compromise (`SEC-T09`).

### Generated-code vulnerabilities

- SQL, command, template and code injection; XSS; SSRF; path traversal;
  deserialization; authentication or authorization bypass; tenant isolation;
  unsafe cryptography; and sensitive-data exposure;
- insecure defaults and prohibited patterns defined by local engineering,
  privacy, security, architecture, and compliance policies.

Generated-code case design measures exploitability and required benign behavior;
scanner counts alone are insufficient evidence.

### Measurement-system attacks

- test, lint, CI, SAST, SCA, secret-scanner, policy, or telemetry disablement;
- oracle or reference access, hidden-check inference, canary leakage,
  memorization, and contamination (`SEC-T03`);
- ledger rewriting, attempt deletion, retry hiding, artifact substitution,
  result-channel forgery, signing-key misuse, checkpoint rollback, and
  fabricated evidence (`SEC-T10`);
- detached/background races, mutate-and-restore behavior, shared-cache mutation,
  symlink/path races, delayed callbacks, malformed parser inputs,
  decompression bombs, and resource exhaustion (`SEC-T10`, `SEC-T14`);
- grader injection, judge bias, reference anchoring, answer enumeration,
  hard-coded outputs, weak assertions, and other reward hacking (`SEC-T11`).

### Adaptive and transfer attacks

- attackers that observe defenses, prompts, graders, or prior cases and then
  adapt strategy (`SEC-T13`);
- transfer across models, agent frameworks, repositories, languages, tool
  combinations, permission envelopes, and interactive actors;
- defense-induced regressions on representative benign tasks.

Adaptive cases are sequestered from system builders until the confirmatory rule
is sealed. Evidence exposed during tuning becomes development evidence and does
not remain the only held-out support for the same claim.

## Reporting

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
