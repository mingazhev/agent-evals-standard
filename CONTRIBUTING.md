# Contributing

Changes are welcome when they make evaluation evidence more trustworthy,
reproducible, or implementable without weakening existing protections.

## Change process

1. Open an issue describing the observed failure mode and affected normative
   artifact.
2. Submit a pull request with the smallest enforceable change.
3. Update every affected schema, example, cross-reference, and conformance
   rule in the same pull request.
4. Add or update positive and negative conformance fixtures for every
   machine-verifiable requirement that changes.

Normative pull requests should include:

- conflicting or insufficient text quoted precisely;
- a concrete implementation, measurement, adversarial, logic, or governance
  failure mode;
- impact on existing draft artifacts and implementations;
- verification evidence, including schema and local-link validation.

## Validation

Run the local checks before opening a pull request:

- `npm ci` — install the pinned toolchain;
- `npm run check` — repository consistency: schema well-formedness, `$ref`
  resolution, and cross-document links;
- `npm run check:generated` — generated-artifact freshness and idempotence;
- `npm test` — the full corpus of conformance fixtures, vectors, and verifier
  tools, including schema validation of every fixture.

The same checks run in CI on every pull request. When you change a schema or a
normative requirement, update the affected fixtures and run `npm test` in the
same pull request; the `tools/` verifiers encode the expected behavior and
fail on drift.

## Pre-publication discipline

The standard has not been published. Until publication, every component remains
version `0.1.0`, and incompatible changes replace the working draft in place.
Do not add migration aliases or legacy contracts unless publication has created
compatibility obligations.

The publication process MUST freeze an exact commit and its conformance
corpus. The candidate commit MUST pass `npm run release:check` from a clean
checkout; that command first proves generated-artifact freshness, runs the full
test corpus, and then checks evidence readiness. The first release MUST use the
annotated tag `v0.1.0`; its CI run MUST resolve that tag to the exact checked-out
commit. Repository administrators MUST protect the tag with a GitHub ruleset,
and a published tag must never be rewritten.

## Style

Use uppercase RFC 2119 key words only where a requirement is intended to be
normative.
Define a term once in the glossary and reference it elsewhere. Keep examples
clearly non-normative and implementation-neutral.
