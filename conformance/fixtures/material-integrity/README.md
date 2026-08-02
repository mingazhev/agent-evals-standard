# Material-integrity conformance vectors

- Version: 0.1.0

Run the self-contained vectors with:

```text
node tools/verify-material-integrity.mjs conformance/fixtures/material-integrity/vectors.json
```

The two negative vectors isolate the required failure modes:

- `negative-missing-artifact-bytes` has otherwise complete workspace-diff
  metadata and an attestation, but its payload locator resolves to no bytes;
- `negative-deleted-failed-attempt-recomputed-roots-and-scorecard` removes the
  failed first attempt and recomputes the ledger root, ledger digest, scorecard
  attempt accounting, and scorecard signature. The forged state is internally
  consistent but cannot match the independently signed scheduler checkpoint.

The scheduler fixture uses the public seed from RFC 8032 test vector 2. It is
distinct from the scorecard fixture key solely to exercise signer separation and
**MUST NOT** be trusted outside conformance tests.

Repository integration requires four explicit steps:

1. register `attempt-checkpoint.schema.json` and its positive root fixture in the
   repository's schema/fixture inventory;
2. add a resolvable `payload` to every canonical evidence artifact and refresh
   affected attestations and enclosing digests;
3. add `externalAttemptCheckpoint` to scorecards, publish the scheduler
   checkpoint independently, and refresh affected digests and signatures;
4. call `verifyEvidencePayload` before terminal-evidence selection and
   `verifyAttemptLedgerCheckpoint` before accepting attempt integrity, supplying
   the payload resolver, scheduler trust configuration, resolved scorecard
   signer key and trust domain, and externally observed append-only log head
   from outside the scorecard.

The standalone verifier and vectors do not modify the root fixture manifest or
package scripts.
