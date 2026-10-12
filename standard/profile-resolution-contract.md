# Evaluation-Profile Resolution Contract

- Status: unpublished 0.1.0 publication candidate
- Version: 0.1.0
- Requirement ID: `PROFILE-001`

This is the complete inheritance, authentication, provenance, fixture-execution,
and digest algorithm invoked by the primary
[PROFILE-001 definition](standard.md#evaluation-profile-resolution).
It supplies that requirement's executable detail without creating a second
primary definition.

## Resolution rules

An evaluation profile has zero or one parent. Resolution **MUST** flatten the
single-parent chain from base to leaf, detect cycles, bind every effective value
to its source profile and every requirement rule to its base requirement ID,
and compute `effectiveProfileDigest` over the flattened form. Duplicate or
incompatible rules produce a conflict report and make the profile invalid;
declaration order **MUST NOT** resolve a conflict.

Inheritance is closed by field:

| Fields | Parent-to-child operation |
| --- | --- |
| `schemaVersion`, `id`, `namespace`, `owner`, `version` | take the leaf value; these identify the leaf and are not inherited rules |
| `parentProfile` | resolve and authenticate the chain, then set to `null` in the effective projection |
| `baseCompatibility` | require the same standard version, verdict, and authenticated requirement-registry ID, version, and digest throughout the chain; a document-relative URI may differ only when it resolves to that same artifact |
| `signatureProfile` | take the explicitly declared leaf value; never inherit it from a parent; authenticate every source profile in the chain under that source profile's own binding, require the leaf profile's own signature to use the leaf binding, and use the leaf binding for effective-profile artifacts; `deployment_bound` rejects fixture/reference trust and requires typed, authenticated, externally rooted key-authorization, revocation, trusted-time, and anti-rollback contracts; the signing key must be active, non-reassignable, algorithm-compatible, authorized for the evaluation-profile schema and leaf owner role, and scoped over every leaf assurance-by-risk tuple |
| `claimTrustProfile`, `claimTrustUse` | take the explicitly declared leaf values; these operational acceptance bindings are never inherited from a parent profile and are not a parent measurement guarantee; authenticate the leaf trust profile, resolve its key authorization, revocation, trusted-time, and anti-rollback contracts, and reject unresolved trust or any assurance/risk tuple outside their applicability; `deployment_bound` additionally rejects fixture/reference trust, while `conformance_fixture_requires_external_rekey` permits only conformance mechanics and never deployment trust |
| `caseContract`, `workArtifactRegistry` | require the same authenticated profile-specific case-shape contract and the same standard-owned work-artifact registry ID, version, and digest throughout the chain; a document-relative URI may differ only when it resolves to the same artifact |
| `capabilityFamilies`, `interactionModes`, `supportedAssuranceLevels`, `effectiveRiskRange` | replace the complete parent set only when the child set is a nonempty subset; equality is allowed and any added value is a conflict |
| `allowedOutcomeProfiles` | replace the complete parent declaration with a nonempty subset of its authenticated IDs; an omitted parent ID is removed, a new ID is a conflict, and a retained ID with a different pointer requires the same `content_equal`, `preserves`, or `strengthens` replacement proof used for keyed pointer replacement |
| `gateRegistry`, `caseQa`, `failureTaxonomy` | replace the singleton only after resolving both contracts and proving that every applicable parent obligation is preserved or strengthened; an unproved replacement is a conflict |
| `requirementMapping` | replace with the leaf's complete declaration; never inherit, merge, or use a replacement proof |
| `metrics`, `additionalAssuranceRequirements` | merge by `id` |
| `exclusions` | merge by `scope` |
| `fixtures` | form a validation-only union by fixture `id`: omitted parent fixtures remain required, a child may add only previously unseen IDs, and any duplicate ID anywhere in the chain is a conflict; authenticate and validate the union, then omit it from the effective digest projection |
| `conflictReport`, `resolutionEvidence`, `effectiveProfileDigest`, `digest`, `signature` | derive for the leaf after resolution; never inherit |

The resolver **MUST** authenticate `baseCompatibility.requirementRegistry`
against the exact registry ID, version, and digest distributed with the named
standard version. A caller-selected registry is not authoritative even when it
has the same requirement IDs. Each leaf `requirementMapping` **MUST** then
contain exactly one lexically ordered entry for every canonical registry ID, no
unknown ID, and no duplicate. Every `sourceProfileId` **MUST** equal the leaf
profile ID.

Every mapping entry **MUST** bind its leaf's same authenticated
`requirement-implementation-contract-1`. That closed contract **MUST** bind the
leaf profile and source identity, the exact canonical registry identity and
digest, the canonical digest and `criterionId` of every registry-owned
`verificationContract`, and the ID, version, and byte digest of the resolver
shipped with the standard implementation. The validator **MUST** resolve and
schema-check the contract, authenticate that distribution-owned resolver, and
recompute every entry. Arbitrary JSON, missing or additional requirements,
criterion drift, an alternate registry, an unresolved implementation, or a
claimant-selected resolver is a conflict.

`requirementMapping` is neutral routing metadata. It **MUST NOT** contain or
imply a claimant-declared `preserves`, `strengthens`, applicability, exception,
or conformance result. Actual satisfaction or strengthening of a requirement
is established only by the requirement-owned conformance proof selected by the
canonical registry's `verificationContract` and the applicable assurance
rules. A valid mapping alone is never evidence that the profile, suite, case,
evaluator, experiment, decision, or claim conforms.

Every fixture descriptor in the validation-only union **MUST** resolve
`manifestUri` relative to the profile that declared it and within the
repository, reproduce `manifestDigest` from its exact bytes, and resolve
`manifestExpectationId` to exactly one fixture-manifest entry. The manifest and
its direct executor **MUST** be registered by the validator distribution; a
profile, manifest, fixture, or claimant **MUST NOT** select a validator or
supply an execution report. The distribution-owned executor **MUST** execute
every selected expectation with the same schema and semantic checks used by
the conformance runner. The observed result **MUST** equal both the entry's
`valid` value and the descriptor's `expectedVerdict`; an invalid expectation
**MUST** also produce a diagnostic containing that entry's `expectedError`.
Execution recursion or a repeated manifest-and-expectation pair is a cycle and
**MUST** fail closed. Duplicate or missing expectation IDs, an unregistered or
unreadable manifest, or any digest, verdict, observed-result, or failure-reason
mismatch invalidates the profile.

For delta keyed collections an omitted parent key remains effective: omission is
not deletion. A repeated key replaces the parent only after a validator proves
monotonic narrowing or strengthening; otherwise it is a conflict. Version 0.1.0
has no deletion operator. `allowedOutcomeProfiles` and `requirementMapping` are
complete-child exceptions. `fixtures` is the add-only exception: omission
inherits a parent fixture and a repeated fixture ID is always a conflict, so a
child cannot replace or shadow a parent conformance obligation.
`allowedOutcomeProfiles` authenticates every retained binding and intentionally
removes an omitted parent ID. `requirementMapping` is rebuilt completely for the
leaf and validated against the canonical registry and closed routing contract;
no parent mapping row or relation is inherited. Set and singleton fields are
also complete child declarations; other keyed collections in a child are
deltas, and constraints stated for an effective collection are checked after
merging. Unlisted fields or arrays **MUST NOT** be inherited.
Set fields are ordered by their closed base enumeration; keyed collections are
ordered lexicographically by merge key. The resolution evidence **MUST** record
the source profile for every effective field or key; every
`requirementMapping.sourceProfileId` is the leaf profile ID and its provenance
operation is `leaf_complete`. The phrase “scalar arrays by exact value” in the
signature projection describes value comparison and canonical ordering, not
set union.

Every profile **MUST** bind one versioned `resolutionEvidence` pointer to a
detached, self-digested and signed `profile-resolution-record-1`. Its
`parentChain` is the authenticated chain ordered from base to direct parent (and
is empty for a root). `fieldProvenance` **MUST** cover every non-keyed field in
the effective projection exactly once; the union of `keyedProvenance` entries
**MUST** cover every effective collection/key pair exactly once. Unknown,
duplicate, missing, unauthenticated, or out-of-order provenance is a conflict.
Every non-identical permitted singleton or repeated delta-key pointer
declaration **MUST** have
exactly one `replacementProof` containing the parent and child artifact
pointers, claimed relation (`subset`, `content_equal`, `preserves`, or
`strengthens`), and proof-input evidence IDs. This includes different pointer
metadata that
resolves to content-equal bytes. Byte-for-byte identical pointer declarations
**MUST NOT** have a replacement proof. `requirementMapping` never has a
replacement proof because it is a complete, independently validated leaf
declaration rather than an inherited keyed delta.
The named distribution-owned PROFILE-001 semantic resolver **MUST** reject a
missing, duplicate, or unpaired proof; resolve both pointers and every evidence
ID exactly once through the record's canonical `evidenceManifest`; validate each
evidence payload as closed `profile-resolution-proof-inputs-1`; require its
profile, target, parent, and child declarations to reproduce the proof exactly;
and independently recompute the stated relation from authenticated bytes.
Proof-input evidence **MUST NOT** name or select a verifier and **MUST NOT**
declare a relation, verdict, preservation result, or strengthening result. Its
producer and attestation establish input provenance and integrity, never
semantic authority. `content_equal` requires equal resolved canonical-content
digests, `subset` requires strict-or-equal set containment, `preserves` requires
all applicable parent obligations, and `strengthens` requires preservation plus
at least one enforceable narrower or stronger child obligation.
`evidenceManifest` **MUST** be empty exactly when `replacementProofs` is empty
and nonempty otherwise. The signed resolution record is the resolver output;
claimant-supplied evidence never supplies a verifier verdict.

Artifact-pointer equality in this algorithm compares `id`, `version`, and
authenticated content `digest`. `uri` is a document-relative locator and is not
measurement identity: every locator **MUST** resolve to the declared artifact,
but two profiles in different directories may use different locators for the
same content. Resolution retains the earliest effective canonical pointer.
Except for the exact identity-preservation fields, the leaf-only signature and
operational claim-trust fields, and complete
`requirementMapping` named in the table, where a child repeats a singleton or
delta-keyed pointer with different serialized locator metadata, the resolution
record **MUST** include a `content_equal` replacement proof. The
identity-preservation fields record `exact_match` provenance only after the
parent and child locators authenticate the same ID, version, and digest.
`signatureProfile`, `claimTrustProfile`, and `claimTrustUse` instead record
`leaf_identity` after the leaf locators authenticate their declared artifacts;
they are not compared with, inherited from, or allowed to fall back to the
parent bindings. Neither rule authorizes substitution within an authenticated
pointer or trust graph.

The normative resolution and digest algorithm is:

1. Validate and authenticate the leaf and every referenced parent; reject a
   repeated profile identity, a digest mismatch, or an unresolved pointer.
2. Order the chain base-to-leaf, require exact `baseCompatibility`,
   `caseContract`, and `workArtifactRegistry`; authenticate every source profile
   under its own declared `signatureProfile`; take the explicit leaf
   `signatureProfile`, `claimTrustProfile`, and `claimTrustUse` without
   inheriting any of them from a parent;
   and apply only the closed per-field operations above. Authenticate the exact
   distributed requirement registry and routing resolver, validate the leaf's
   complete requirement routing contract, use the distribution-owned PROFILE-001
   resolver to recompute every replacement relation, validate the fixture union,
   then remove the fixtures.
3. Canonically order closed sets by their base enumeration and keyed
   collections lexically by key. Form the effective projection from every
   remaining flattened field, set `parentProfile` to `null`, and omit exactly
   `fixtures`, `conflictReport`, `resolutionEvidence`,
   `effectiveProfileDigest`, `digest`, and `signature`.
4. Set `effectiveProfileDigest` to `sha256:` plus SHA-256 of the UTF-8 RFC 8785
   JCS bytes of that projection.
5. Construct the detached resolution record, require its effective digest,
   exact provenance/proof coverage, and canonical evidence manifest to
   reproduce steps 1–4, compute its generic self-digest, and sign it. The record
   identifies the leaf by ID and version, not by the leaf self-digest, so no
   digest cycle is created.
6. Insert its versioned pointer as `resolutionEvidence`; `conflictReport.evidence`
   **MAY** use the same pointer. Insert `effectiveProfileDigest`, then compute the
   evaluation profile's generic self-digest and signature.

The resolution record and its pointer are detached derived material and
**MUST NOT** enter `effectiveProfileDigest`. The signed profile self-digest does
bind the pointer. Any other omission, merge operation, ordering, or digest
sequence is non-conforming.
