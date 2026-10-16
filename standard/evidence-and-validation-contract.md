# Evidence and Detached Validation Contract

- Status: unpublished 0.1.0 publication candidate
- Version: 0.1.0
- Requirement IDs: `EVID-001`, `EVID-002`, `DATA-002`

The normative keywords **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**,
**SHOULD NOT**, and **MAY** have the meanings defined in RFC 2119 and RFC 8174.
Only uppercase keywords are normative.

## Integrity model

This standard uses no cryptographic signatures, key management, trusted-time
service, or anti-rollback protocol. Integrity, provenance, and ordering rest on
three mechanisms that every conforming implementation **MUST** apply:

1. **Content addressing.** Every claim-bearing artifact is identified by `id`,
   `version`, and a `sha256:` digest over its stored bytes or over the RFC 8785
   JCS projection its schema names. A reference is a binding only when the
   verifier resolves the bytes and recomputes that digest. A changed byte is a
   different artifact; it cannot be patched into a sealed experiment, scorecard,
   or decision.
2. **Version-control order.** Every sealed artifact — suite manifest, pre-run
   manifest, statistical plan, evaluator manifest, decision plan, and policy
   instance — and every append-only ledger **MUST** be committed to a
   version-controlled repository before any step that depends on it. The commit
   that first contains a sealed artifact is its seal point. "Before execution"
   means that commit is an ancestor of the commit that first contains any trial
   result for the run. Ledgers are hash chains: each entry binds the digest of
   its predecessor and the verifier recomputes the root. Hosted repositories
   **SHOULD** use a protected branch that rejects history rewrites, and the
   claimant **MUST** disclose the hosting, branch-protection, and write-access
   settings on which the ordering relies.
3. **Producer identity and authority.** Every evidence artifact names its
   producer `id`, `role`, and `trustDomain`. Whether that producer may create
   that kind of evidence is decided only by an evaluator-controlled authority
   registry or contract established outside evaluated input, never by the
   evidence itself. Where a requirement demands independence, the producers
   **MUST** satisfy the [independence definition](glossary.md#independence).

Residual limit: without signatures, a party with write access to every
repository involved could rewrite an artifact and every reference to it. The
model therefore relies on separated write access — the evaluated arm has none,
and the claimant cannot rewrite a protected branch — and on reviewers being able
to inspect history. An adopter that needs non-repudiation against a hostile
repository administrator **MAY** add a signature scheme as a namespaced
extension under `CONF-003`; that extension cannot weaken any requirement here.

## Canonical evidence artifact

`EVID-001` — Every evidence reference used by Case QA, a scorecard, semantic
validation, or governance **MUST** resolve to exactly one
`evidence-artifact-1` record. The record **MUST** contain:

- a stable artifact ID, immutable URI, and resolvable `payload` locator;
- media type, exact byte length, and `sha256:<64 lowercase hexadecimal digits>`
  over the bytes as stored;
- producer ID, role, trust domain, creation phase, and UTC creation time;
- access class, retention class, retention deadline or disposition rule, and
  applicable privacy or IP restrictions;
- the schema and semantic-contract versions needed to interpret the bytes.

The producer's authority for the artifact's schema and creation phase is
established by the [integrity model](#integrity-model), not by a field in the
record.

An immutable URI **MUST** be content-addressed or refer to storage that prevents
replacement under the same identifier. Text, archive, and media bytes **MUST
NOT** be normalized before digest verification. JSON that a contract identifies
as canonical **MUST** satisfy RFC 8785's I-JSON input constraints and use JCS
encoded as UTF-8. A parser **MUST** reject duplicate member names, invalid
Unicode, and numeric values outside the interoperable JCS domain before it
constructs an object; parse-and-overwrite behavior is non-conforming. A manifest
**MUST** have unique artifact IDs, **MUST** reject conflicting records for one
ID, and **MUST** sort records by artifact ID before its own canonical digest is
computed.

The verifier **MUST** reject a dangling reference, digest or length mismatch,
unauthorized producer, wrong creation phase, expired evidence, or access
outside the approved purpose. It **MUST NOT** repair,
relabel, or infer missing evidence.

For machine-authoritative validity, threat, exposure, and control bindings,
`EVID-001` invokes the resolvable binding and external-authority rules in the
[Validity, threat, and held-out exposure machine contracts](validity-threat-exposure-contracts.md#resolvable-verified-machine-contract).

### Material-byte resolution

An evidence record without accessible subject bytes is metadata, not evidence.
The `payload` locator **MUST** use exactly one of these modes:

- `inline_base64` — canonical RFC 4648 base64 embedded in the record;
- `repository_relative` — a portable relative path below an explicitly supplied
  evidence root; dot segments, absolute paths, and symlink escape **MUST** fail;
- `immutable_external` — a URI resolved only by an explicitly configured,
  authorized resolver.

For every referenced record, the verifier **MUST** resolve the locator, read the
exact stored bytes without normalization, and recompute `byteLength` and
`digest`. The resolved bytes **MUST** match both fields. `mediaType` is
authenticated evidence metadata; when a resolver returns a media type, it
**MUST** equal the record's value. If `uri` is an `artifact:sha256:` content
address, it **MUST** equal `artifact:` followed by the recomputed digest. A
resolver failure, absent bytes, metadata mismatch, unsupported locator mode, or
resolver supplied only by the evaluated scorecard is `insufficient_evidence`.

When a selected outcome profile declares an evidence kind as terminal, that
profile's authenticated semantic contract owns its evidence-kind-specific media
types, non-emptiness rule, and structural validity. Independently of evidence
kind, terminal evidence **MUST** have resolvable non-empty bytes and an
`artifact:sha256:` URI equal to the payload digest. A digest and byte count with
no resolvable payload **MUST NOT** satisfy a terminal-evidence requirement.

## Detached validation envelope

`EVID-002` — Semantic validation **MUST** produce a detached
`validation-envelope-1`. The subject artifact **MUST NOT** contain the envelope
or the completed-envelope digest. This separation prevents a self-hash cycle.

The envelope **MUST** bind:

- the subject digest and one named canonical projection;
- validator ID, contract version, implementation digest, and UTC validation
  time;
- one result for every evaluated requirement ID and the evidence IDs used;
- the aggregate `pass`, `fail`, or `insufficient_evidence` result;
- the complete evidence manifest and either `output: null` or a content-addressed
  output artifact when validation produces a separate deterministic result.

The authenticated requirement registry selects the exact closed check set for
the envelope's `subject.claimTarget`. The envelope **MUST** contain each selected
requirement ID exactly once and no unselected or unknown requirement ID. Every
evidence ID and finding ID **MUST** resolve exactly once. Because applicability
is resolved before a requirement is selected, a selected check has exactly one
of `pass`, `fail`, or `insufficient_evidence`; it cannot be
`not_applicable`. Aggregate result is derived without discretion: any `fail`
produces `fail`; otherwise any `insufficient_evidence` produces
`insufficient_evidence`; otherwise `pass` is permitted only when every selected
check is `pass`. Empty or incomplete selected-check sets never pass.

The supported projection identifiers have these meanings:

- `full_document_without_digest` — RFC 8785 JCS of the complete JSON document
  after removing only the top-level digest field named by its schema;
- `sealed_activation_input` — UTF-8 bytes of RFC 8785 JCS for the
  `agent-eval-activation-input-1` manifest defined by
  [`case-activation-input.schema.json`](../schemas/case-activation-input.schema.json).
  The manifest's `projection` is the case document with exactly its
  `lifecycle` and `digest` members removed. Its `case` object
  binds the case `id`, `version`, and the SHA-256 of that projection. The
  activated case's `lifecycle.activationInputDigest` is the SHA-256 of the
  complete manifest bytes. A validator MUST reconstruct the projection from
  the case and require exact canonical bytes and both digest relations before
  accepting activation. The source case MUST separately pass
  `case.schema.json`, including the lifecycle condition for its current state;
  this input manifest is a binding of inputs, not QA validity evidence. This
  exclusion of activation-only fields is the acyclic boundary: the manifest
  does not contain the activated case digest.

The activation-input projection includes every top-level case member required
by `case.schema.json` except `lifecycle` and `digest`; the
optional `interactionProtocol` is included when present. Object member order is
the RFC 8785 JCS order and array order is the case document's order. An
unknown or ambiguous projection yields `insufficient_evidence`. `sealed_run`
and `governance_state` are reserved identifiers with no projection contract in
this version; an envelope using either identifier is schema-invalid and MUST
fail closed. A projection contract MUST identify exact included fields and
ordering.

A later artifact **MAY** refer independently to the subject digest and the
digest of the completed envelope.

## Evidence minimization and retention

`DATA-002` — Evidence collection **MUST** be purpose-limited. Secrets, hidden
oracles, personal data, customer content, licensed code, and unique canary
values **MUST NOT** be copied into scorecards, logs, findings, or reviewer notes
when a digest, redacted extract, or access-controlled pointer is sufficient.
The evidence owner **MUST** define lawful authority, permitted reviewers,
retention, deletion or legal-hold handling, and incident response before
collection. Retention expiry **MUST** make dependent claims expired or
reproducibly preserve an authorized replacement; it **MUST NOT** silently leave
an unverifiable positive claim active.

This requirement invokes the applicable data, privacy, IP, and retention rows of
the [Security Threat Model and Coverage Contract](security-threat-model.md).

Every artifact class **MUST** declare access roles, trust domain, encryption,
external-export rule, retention period, legal-hold behavior, deletion verifier,
and incident response. Agent-visible held-out input sent to a provider requires
prior data-owner authorization and a provider contract consistent with its
access and retention class. Oracle material **MUST NOT** be sent to the evaluated
provider.

For production-derived fixture input, every proof named by the environment
contract is an evidence reference under `EVID-001`; an inline `result: pass` is
not evidence by itself. The environment **MUST** content-address a
`production-derived-authority-contract-1`, and its consuming authenticated
pre-run manifest **MUST** bind that exact environment ID, version, and digest.
The authority contract is the only source of proof-to-producer, role, trust-
domain, creation-phase, evidence-schema, and verifier authorization. A
proof, payload, or evidence bundle **MUST NOT** introduce or override any of
those values. The production-derived validator **MUST** receive the pre-run
schema-validation and authentication results from evaluator-controlled
verifiers; a related file path, self-digest, unknown document shape, or
authority asserted only by evaluated input is not a seal.

Every named verifier **MUST** resolve exactly once through an evaluator-owned
registry established outside the evaluated input. The registry entry **MUST**
bind verifier ID and version to the SHA-256 digest of exact implementation
bytes. Merely repeating a verifier digest in a proof, evidence record, or
authority contract is not authentication. The evidence record's
`schemaMetadata.validatorDigest` and
`mediaInterpretation.semanticContract` **MUST** equal that registered verifier,
and its producer **MUST** equal the producer the authority contract assigns to
that proof kind.

Semantic re-evaluation **MUST** compare the closed payload for each proof kind
with sealed values:

- provenance binds snapshot digest, source cutoff, source systems, dataset ID,
  record count, and the sealed export-ledger digest and transformation ID,
  version, and digest;
- data-owner authorization binds owner, snapshot scope, purpose, decision, and
  authorization time;
- redaction binds policy ID, version, and digest and reports zero direct-
  identifier, secret, and unresolved findings;
- re-identification binds method ID, version, and digest, decision, and a
  residual-risk value no greater than the sealed maximum;
- production isolation binds the named boundary projection and digest and
  reports every production read, write, live-connectivity, and credential flag
  as false.

Data-owner, privacy, and isolation evidence **MUST** have pairwise-distinct
producer IDs and trust domains. Redaction and re-
identification use the same accountable privacy authority. A missing registry,
unresolved implementation bytes, unsealed authority contract, reused required
authority boundary, unknown field, or semantic mismatch yields
`insufficient_evidence`. The exact projections and time-order checks are defined
once in the [applicability boundary](standard.md#applicability-boundary-and-profiles)
and the machine-readable environment and authority schemas.

## Verification order

A verifier **MUST** perform, in order: schema validation; subject-projection
reconstruction; material-payload resolution and byte/length/digest/media checks;
producer-authorization checks; version-control order checks for sealed
artifacts and ledgers; requirement-result recomputation; and aggregate-result
recomputation. Failure at any step yields `insufficient_evidence` for every
dependent positive, comparative, or governance claim.

An implementation **MUST** pass an explicit evidence root for
`repository_relative` payloads or an authorized resolver for
`immutable_external` payloads, resolve every referenced evidence record's bytes,
and propagate any material-payload issue as `insufficient_evidence` before
terminal-outcome selection.

The machine-readable records are
[`evidence-artifact.schema.json`](../schemas/evidence-artifact.schema.json),
[`production-derived-authority-contract.schema.json`](../schemas/production-derived-authority-contract.schema.json),
and [`validation-envelope.schema.json`](../schemas/validation-envelope.schema.json).
