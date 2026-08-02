# Production-derived authority conformance vectors

- Version: 0.1.0

These vectors exercise the complete production-derived proof trust boundary:

- the environment is bound by a schema-valid, independently signed pre-run
  manifest;
- exact authority-contract bytes are content-addressed by that environment;
- verifier ID, version, and digest resolve to evaluator-pinned implementation
  bytes outside the evidence bundle;
- each evidence artifact is signed by its mapped authority key;
- data-owner, privacy, and isolation producers, trust domains, and keys are
  pairwise distinct;
- all five proof payloads are re-evaluated against sealed semantic fields.

All signing seeds are public deterministic fixture material. They establish
conformance-vector reproducibility only and are not operational trust anchors.
The pre-run uses the independent RFC 8032 vector-2 scheduler key already used by
the repository's material-integrity vectors; none of the mandatory proof
authorities uses that key.

Regenerate and run the vectors with:

```text
node tools/generate-production-derived-authority-vectors.mjs
node tools/run-production-derived-authority-vectors.mjs
```

Operational integration must supply five evaluator-controlled dependencies to
`checkProductionDerivedInput`: the evidence-artifact schema validator, the
authority-contract schema validator, the pre-run schema validator and signature
authenticator, and a verifier registry whose path resolves to authenticated
implementation bytes. Omitting any dependency fails closed.
