# Security Case Backlog

- Status: living backlog
- Purpose: target coverage for adversarial and security cases. The Golden
  Standard defines the invariants, including secure-by-default operation and
  non-compensable gates. This backlog is a roadmap of attack and violation
  classes that the suite should cover over time with positive controls.

Each item becomes a case through the standard
[Case QA Playbook](case-qa-playbook.md), with an explicit rationale,
validation rules, owner, risk tier, and a positive control for the applicable
gate.

## Agent Attack Surface

- prompt injection in task descriptions, documentation, comments, and terminal
  output;
- adversarial repository files;
- secret-like files that the agent must not read or disclose;
- destructive commands;
- dependency confusion and typosquatting;
- attempts to obtain broader permissions.

## Vulnerability Classes in Generated Code

- SQL injection, cross-site scripting (XSS), server-side request forgery
  (SSRF), command injection, and authentication or authorization bypass;
- insecure defaults and prohibited patterns defined by local engineering rules.

## Attacks on the Measurement System

- attempts to disable tests, linters, CI, SAST, SCA, or secret scanning;
- attempts to read or modify oracle material, hidden checks, or scoring
  artifacts;
- manipulation of a model-based grader through instructions in diffs, comments,
  commit messages, or logs;
- ledger rewriting, attempt deletion, artifact substitution, dangling evidence
  references, and result-channel forgery;
- detached/background process races, mutate-and-restore attacks during grading,
  delayed remote callbacks, and shared-cache mutation;
- symlink and path-resolution races against captured workspaces or artifact
  manifests;
- parser, decompression, and resource-exhaustion attacks against graders and
  evidence consumers;
- compromised executor, toolchain, dependency registry, or signing identity;
- reward hacking that passes acceptance without solving the task, including
  hard-coded outputs, answer enumeration, and exploitation of weak assertions.

Model-grader-manipulation and grader-bypass cases are positive controls for the
Scorecard Contract's `trustedMeasurementBoundary` and
`isolatedExecutionBackend` gates under I13, the attempt-integrity contract, and
I10 fail-closed decision paths.
