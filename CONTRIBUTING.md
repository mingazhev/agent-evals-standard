# Contributing

Changes are welcome when they make evaluation evidence more trustworthy,
reproducible, or implementable without weakening existing protections.

## Change process

1. Open an issue describing the observed failure mode and affected normative
   artifact.
2. Submit a pull request with the smallest enforceable change.
3. Update every affected schema, example, cross-reference, and conformance
   rule in the same pull request.
4. Keep exactly one valid example per schema in `examples/` and add an invalid
   example only when it illustrates a rule the schema itself enforces.

The repository holds contracts, not implementations. Validators, runners,
graders, and their test-vector corpora live in implementation repositories with
their own versioning; do not add executable verifiers here.

Normative pull requests should include:

- conflicting or insufficient text quoted precisely;
- a concrete implementation, measurement, adversarial, logic, or governance
  failure mode;
- impact on existing draft artifacts and implementations;
- verification evidence, including schema and local-link validation.

## Validation

Run the local check before opening a pull request:

- `npm ci` — install the pinned toolchain;
- `npm test` — schemas compile in strict mode, every example matches its
  declared expectation, bundled contracts validate, profile fixture
  descriptors resolve, and local Markdown links and anchors resolve.

The same check runs in CI on every pull request. It is deliberately not a
conformance validator: digests inside examples are illustrative and are not
re-verified.

## Pre-publication discipline

The standard has not been published. Until publication, every component remains
version `0.1.0`, and incompatible changes replace the working draft in place.
Do not add migration aliases or legacy contracts unless publication has created
compatibility obligations.

The publication process MUST freeze an exact commit. The candidate commit MUST
pass `npm test` from a clean checkout, and `standard/source-evidence-manifest.json`
MUST report `evidenceReadiness: ready`. The first release MUST use the
annotated tag `v0.1.0`; its CI run MUST resolve that tag to the exact checked-out
commit. Repository administrators MUST protect the tag with a GitHub ruleset,
and a published tag must never be rewritten.

## Style

Use uppercase RFC 2119 key words only where a requirement is intended to be
normative.
Define a term once in the glossary and reference it elsewhere. Keep examples
clearly non-normative and implementation-neutral.
