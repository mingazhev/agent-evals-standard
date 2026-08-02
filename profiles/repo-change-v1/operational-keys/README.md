# Operational reference keys

These public keys belong only to the signed `repo-change-v1` operational reference artifacts. They are distinct from `conformance/fixtures/keys/rfc8032-test-key-1.pem`, which is test material and MUST NOT be trusted for operational or governance decisions.

No private key is committed. The signatures make the reference graph independently verifiable, but the bundled public keys do not establish that the named operators or service endpoints are independent in a deployment. Before operational use, an adopter MUST provision externally controlled keys and endpoints, verify operator ownership and separation, pin the resulting trust anchor and contracts in its signature profile, and regenerate every affected digest and signature. Failure to verify any of those conditions is `stop_governance_use` or `insufficient_evidence` as specified by the governing contract.
