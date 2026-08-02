# Repository review profile

- Status: bundled interoperability profile
- Version: 0.1.0

`repository-review-v1` is a bounded interoperability proof for evaluating an
SDLC agent that reads a sealed repository and produces an accountable review
decision. It is not a general agent profile and it does not claim coverage of
implementation, verification, release, planning, discovery, or remediation.

## Closed scope

- Capability: `CAP.REVIEW_DECIDE` only.
- Work artifact: `review_decision` only.
- Interaction: `noninteractive_repository_task` only.
- Repository access: read-only; both agent-writable-root sets are empty.
- Result transport: an authenticated runner-owned channel, never a workspace
  diff.
- Native successful results: `approved`, `changes_requested`, and
  `findings_reported` when the findings carry accountable dispositions.

A `review_decision` requires an explicit `artifactClass`, a decision
authority, and dispositions for reported findings. Bare fact-finding is an
`assurance_report` under `CAP.VERIFY_ASSURE`, so it cannot satisfy this
profile.

## Substantive acceptance

Read-only execution and valid digests are necessary but not sufficient. The
focused positive fixture compares the decision with a sealed material oracle.
The outcome profile also permits blinded hybrid adjudication. A missing
material finding, an unsupported finding, or a wrong disposition fails closed.

The profile-resolution record, terminal evidence, environment, profile, and
outcome profile are content-bound. Fixture signatures use the public RFC 8032
test key and prove interoperability mechanics only; deployment or governance
use requires externally provisioned trust.

Run the focused proof with:

    node profiles/repository-review-v1/verify-profile.mjs

The verifier exercises one positive and twenty-two negative vectors. This is a
small end-to-end profile proof, not a complete evaluation suite, empirical
benchmark result, or conformance claim for an agent implementation.
