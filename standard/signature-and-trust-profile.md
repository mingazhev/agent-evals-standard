# Signature and Trust Profile

- Status: unpublished working draft
- Version: 0.1.0
- Requirement IDs: `EVID-001`, `EVID-002`, `RUN-003`

This profile makes a signature an interoperable authorization statement rather
than a free-form string. Every evaluation-profile source document **MUST**
explicitly pin one `agent-eval-signature-profile-1` artifact and its digest in
`evaluation-profile.signatureProfile` and **MUST** itself be signed under that
binding. The field is leaf-only, not inherited: resolution verifies each parent
under the parent's binding and the child under the child's binding, then uses
the leaf binding in the effective projection. A sealed pre-run manifest
**MUST** pin the same versioned artifact as every effective leaf profile in that
run. Every `signature.profileId` **MUST** resolve to exactly the governing
binding; an unknown, duplicate, unpinned, version-ambiguous, digest-mismatched,
fixture-for-deployment, or unauthorized profile yields `insufficient_evidence`
before cryptographic verification.

## Allowed suites and encoding

Only these algorithm identifiers are allowed:

| Identifier | Required suite |
| --- | --- |
| `Ed25519` | Ed25519 pure mode and its 64-octet signature encoding as specified by RFC 8032 |
| `ES256` | ECDSA over NIST P-256 with SHA-256 and the 64-octet JWA `R || S` encoding from RFC 7518 section 3.4; this profile additionally requires low-S signatures |
| `PS256` | RSASSA-PSS with SHA-256, MGF1 with SHA-256, a 32-octet salt, and an RSA modulus of at least 2048 bits, as pinned by RFC 7518 section 3.5 and RFC 8017 |

The `Ed25519` identifier is the fully specified JOSE name registered by RFC
9864; its algorithm and encoding are the Ed25519 parameter set in RFC 8032.

Signature `value` **MUST** be unpadded base64url. Implementations **MUST NOT**
accept algorithm substitution, a key of the wrong type, non-canonical ECDSA
encoding, RSA PKCS#1 v1.5, SHA-1, or an algorithm absent from the pinned
profile.

For `ES256`, a signer **MUST** emit `S <= n/2`, where `n` is the order of
P-256, and a verifier **MUST** reject `S > n/2`; verification also rejects zero
or out-of-range `R` or `S`. This is a profile-specific anti-malleability rule,
not a claim that RFC 7518 itself mandates low-S. For `PS256`, a verifier
**MUST** reject any parameter substitution, including another hash, another
MGF or MGF hash, a salt length other than 32 octets, or a modulus below 2048
bits.

The pinned signature profile **MUST** identify an algorithm-conformance vector
artifact. It **MUST** contain positive and negative vectors for every enabled
suite, including wrong key type, wrong algorithm, altered payload and malformed
encoding; `ES256` additionally needs high-S and out-of-range cases, and
`PS256` needs wrong salt length, MGF hash and undersized-key cases.
An enabled suite whose complete vector set is absent or fails is unavailable in
that operational profile; publication or a passing conformance claim **MUST NOT**
infer support from the generic suite definition alone.

The bundled, conformance-only
[`fixture-signature-profile`](../profiles/repo-change-v1/signature-profile.json)
enables all three suites and is pinned by its signed
[`EVID-001` implementation contract](../profiles/repo-change-v1/evid-001-signature-implementation-contract.json).
Its signed [vector artifact](../profiles/repo-change-v1/signature-conformance-vectors.json)
and [executable verifier](../profiles/repo-change-v1/verify-signature-vectors.mjs)
cover the required positive and profile-negative cases. Its trust contract
explicitly prohibits operational use; passing it demonstrates conformance
mechanics, not production trust readiness.

For a signed JSON object, the signing projection **MUST** retain the signature
metadata and omit only the cyclic signature-value field. The required contexts
are:

| Artifact | Domain separator | Projection |
| --- | --- | --- |
| `evidence-artifact-1` | ASCII `agent-evals-evidence-artifact-1` then zero byte | UTF-8 RFC 8785 JCS with only `attestation.value` omitted |
| `validation-envelope-1` | ASCII `agent-evals-validation-envelope-1` then zero byte | UTF-8 RFC 8785 JCS with only `signature.value` omitted |
| any other signed JSON contract in this draft | ASCII value of its required top-level `schemaVersion` then zero byte | UTF-8 RFC 8785 JCS with only top-level `signature.value` omitted |

An artifact contract that overrides the generic rule **MUST** define an equally
specific domain separator and signature-value path. Omitting `algorithm`, `keyId`, `profileId`,
`signedAt`, subject digest, scope, or authorization-relevant metadata from the
signed projection is invalid.

## Digest order and profile projections

Unless a schema explicitly defines its top-level `digest` as the digest of
external subject bytes, a self-digest is `sha256:` plus SHA-256 of UTF-8 RFC
8785 JCS after omitting the top-level `digest` and the complete top-level
`signature` object. The producer computes this digest first, inserts it, inserts
all signature metadata, and then computes the signature projection above.
`evidence-artifact-1.digest` is the explicit exception: it hashes the referenced
artifact bytes, not the evidence record.

An `escalation-event-1` has no self-digest field because its containing ledger
supplies `payloadHash`; an enforcement receipt's `sourceEventDigest` is SHA-256
of UTF-8 JCS of the complete immutable event, including its completed signature.
`enforcement-receipt-1.digest` follows the generic self-digest rule. Semantic
validation also requires exact equality of event ID, affected scope, stop and
scope actions, request time, and monotonic event/request/start/completion times.

For `evaluation-profile-1`, inheritance is resolved before
`effectiveProfileDigest` is computed. The effective projection is the complete
flattened leaf profile with `parentProfile` set to `null`, produced only by the
closed per-field `PROFILE-001` table and algorithm in the core standard. No
generic array merge or concatenation rule applies. The fields `fixtures`,
`conflictReport`, `resolutionEvidence`, `effectiveProfileDigest`, `digest`, and
`signature` are omitted. After the effective digest and detached signed
resolution record are complete, its pointer is inserted and the source-profile
self-digest is computed by the generic rule. `outcome-profile-1` uses the
generic self-digest rule. These projections are test vectors in the conformance
corpus; an alternative merge, ordering, omission, or digest sequence is
non-conforming.

## Key identity and authorization

`keyId` **MUST** resolve through the pinned key-resolution contract to one
public key, key type, owner, authorized roles, artifact types, scopes, validity
interval, and status. A key being cryptographically valid is not sufficient:
the producer role, trust domain, artifact type, evaluation scope, and creation
phase **MUST** all be authorized at verifier time.
The same `keyId` **MUST NOT** be reassigned to different public-key material.
An `authorizedScopes` value has the exact form
`profileId:assurance:effectiveRisk`. A hyphenated assurance range is inclusive
in `A0 < A1 < A2 < A3` order; a hyphenated risk range is inclusive in
`low < medium < high < critical` order; two ranges denote their Cartesian
product. Every affected tuple **MUST** be covered explicitly by at least one
authorized scope. An omitted tuple is unauthorized, not an implicit wildcard.

For a `deployment_bound` evaluation-profile leaf, all four signature-profile
pointers — key authorization, revocation, trusted time, and anti-rollback —
**MUST** be typed, digest-bound, authenticated external contracts. The key that
signs the leaf profile **MUST** resolve exactly once, be active and
non-reassignable, match an allowed algorithm and key type, authorize
`agent-eval-evaluation-profile-1` and `evaluation-profile.owner.role`, and
cover every Cartesian-product tuple in the leaf's
`supportedAssuranceLevels` and `effectiveRiskRange`. A fixture profile, a
repository `operationalReference`, a missing contract, a stale or invalid
contract, or partial authorization is `insufficient_evidence`; parent trust is
never a fallback.

Trust anchors **MUST** be outside the mutable run workspace. A trust-anchor or
authorization change **MUST** be an authenticated, append-only governance event.
Root replacement **MUST** satisfy the operational profile's independent
approval threshold and **MUST NOT** be authorized only by the incoming key.

## Rotation, revocation, and verifier time

The key-resolution and revocation contracts **MUST** define:

- activation and retirement times, rotation overlap, and maximum cryptoperiod;
- the authority and evidence required to add, rotate, suspend, revoke, or
  compromise a key;
- whether compromise invalidates earlier signatures and from which externally
  supported time;
- the maximum age of revocation and trust-state data accepted by an offline
  verifier.

The verifier **MUST** record `verifiedAt`, the trust-state digest, and the latest
anti-rollback evidence required by the pinned policy. It **MUST NOT** rely only on signer-controlled
`signedAt`. A signature made outside the key's authorized interval, after its
effective revocation, with stale trust state, or without required authorization
yields `insufficient_evidence`.

Rotation **MUST** preserve verification of retained evidence for its required
retention period. If that cannot be done, affected positive claims **MUST**
expire or be re-established from newly authenticated evidence.

The machine-contract verification sequence is normative. A verifier **MUST**:

1. resolve every `keyId` exactly once in the pinned key-authorization contract;
2. verify public-key digest, active status, trusted signature time inside the
   validity interval, producer role, artifact type, and affected-scope
   authorization;
3. resolve each authorization authority to a distinct key owner with the
   required authority role;
4. verify the revocation-state self-digest after omitting top-level `digest`, the
   complete top-level `signature`, and only the values of
   `authorizationSignatures`; then verify at least `authorityThreshold` distinct
   authorization signatures over that completed projection and the root
   signature over the completed document with only `signature.value` omitted;
5. require exactly one revocation status for every authorized key and no unknown
   key, enforce `publishedAt < nextUpdate`, obtain `verifiedAt` from the pinned
   trusted-time quorum, require `verifiedAt <= nextUpdate`, and apply the stated
   compromise rules; and
6. reject unknown, duplicate, stale, revoked, suspended, retired, or
   unauthorized keys as `insufficient_evidence`.

For trusted time, the verifier **MUST** resolve the digest-bound attestation
schema and every source key through the key-authorization contract; require the
`trusted_time_authority` role and distinct source key IDs, owner IDs, and trust
domains; validate signature, nonce, subject, chain, and freshness bindings; and
enforce the pinned quorum, maximum clock skew, and maximum attestation age for
one request. Signer-controlled `signedAt` alone is never trusted time.

A `trusted-time-attestation-1` self-digest omits `digest` and the complete
top-level signature. Its signing projection is the completed document with only
`signature.value` omitted, prefixed by `schemaVersion` and a zero byte. The
verifier **MUST** resolve `sourceId` and require its active
`trusted_time_authority` key, verify self-digest and signature, bind request
nonce and subject digest, require `attestedAt < expiresAt`, and enforce the
trusted-time freshness and future-skew limits. Sequence zero has a null
`previousAttestationDigest`; each later sequence binds the SHA-256 digest of RFC
8785 JCS of the complete preceding attestation from the same source. A lower,
duplicate-with-conflicting-content, broken-chain, stale, or future attestation is
invalid.

## Anti-rollback and equivocation evidence

Every operational profile **MUST** pin an
`agent-eval-anti-rollback-policy-1` artifact. The objective is to detect
rollback or equivocation before governance accepts the affected state; no
single storage product or checkpoint topology is universally required.
The verifier **MUST** require the actual assurance level and effective risk tier
to occur in the policy's `applicability`; an out-of-scope policy is inapplicable,
not a fallback.

For assurance levels `A2` or `A3`, or effective risk `high` or `critical`, the
policy **MUST** choose an external transparency log, independent notary, or
independently audited immutable storage. At lower assurance and risk, it may
select `not_required` only with a signed threat assessment and risk acceptance.
That acceptance **MUST** state review time, expiry, maximum review interval, and
reopen on assurance, risk, threat, or scope change. `reviewedAt` **MUST** precede
`expiresAt`, verifier time **MUST** be earlier than `expiresAt`, and any reopen
trigger **MUST** be followed by a new signed review before governance use.
Expiry or scope mismatch
stops governance use; `not_required` has no fictitious checkpoint freshness.
An active mechanism **MUST** state its operator and verifier trust assumptions,
independence from the run workspace, ledger writer, evidence signer, decision
approver, evaluator, and subject owner, authenticated receipt schema, freshness
bound and failure semantics.
The bound trust-threat assessment **MUST** make the principal sets for notary,
witness, trusted-time authority, revocation authority, decision approver,
evaluator, and subject owner pairwise disjoint. Sharing a principal across any
two of those sets is not independent control.
Every receipt binds ledger ID, sequence, root, previous receipt digest,
observation time, service identity and signature.

For an `anti-rollback-receipt-1`, the notary signing projection omits only
`signature.value` and the complete `witnessSignature`; the witness projection
includes the complete notary signature and omits only
`witnessSignature.value`. Each is prefixed by `schemaVersion` and a zero byte.
The verifier **MUST** resolve the service identity and notary key to the same
active `anti_rollback_receipt_signer`, resolve the witness as an active
`anti_rollback_witness` owned independently of the notary, verify both through
the pinned authorization and revocation contracts, bind the ledger ID and root
to the governed view, and validate `observedAt` through trusted time. Sequence
zero has a null predecessor; every later receipt binds the SHA-256 digest of RFC
8785 JCS of the complete preceding receipt for the same ledger. A lower or
conflicting sequence is rejected.

A transparency-log profile **MUST** verify both inclusion and append-only
consistency evidence and **MUST** obtain independent witness, quorum, or
authenticated-gossip evidence sufficient to expose split views. A signed
receipt chain by itself proves neither global consistency nor absence of
equivocation. RFC 9162 is a useful construction and threat reference, but an
implementation **MUST NOT** claim RFC 9162 compatibility unless its declared
protocol profile actually implements the applicable encoding and proof rules.

Before accepting current governance state under an active mechanism, the verifier
**MUST** obtain evidence within the pinned freshness limit and apply the policy's
witness checks. A lower
sequence, conflicting root, missing predecessor, invalid proof, unverifiable
receipt or stale evidence yields at least `insufficient_evidence`; rollback or
equivocation also opens `measurementBoundaryCompromise`. Replicating the same
mutable ledger under the same administrative control is not independent
evidence.

The machine-readable contracts are
[`signature-profile.schema.json`](../schemas/signature-profile.schema.json) and
[`anti-rollback-policy.schema.json`](../schemas/anti-rollback-policy.schema.json).
