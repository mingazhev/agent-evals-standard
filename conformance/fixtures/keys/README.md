# Conformance fixture key

`rfc8032-test-key-1.pem` is the public key from the first RFC 8032 Ed25519
test vector. Its private seed is public. It is intentionally untrusted and is
never an operational trust anchor. Fixtures that explicitly request a signature
check use it only to make canonicalization and verification reproducible.
