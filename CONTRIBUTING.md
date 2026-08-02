# Contributing

Changes are welcome when they make evaluation evidence more trustworthy,
reproducible, or implementable without weakening existing protections.

## Change process

1. Open an issue describing the observed failure mode and affected normative
   artifact.
2. Submit a pull request with the smallest enforceable change.
3. Update the artifact-local changelog and the repository changelog when the
   change is normative.
4. Update every affected schema, example, cross-reference, and conformance
   rule in the same pull request.
5. State whether the change is major, minor, or patch and justify that choice.

Normative pull requests should include:

- conflicting or insufficient text quoted precisely;
- a concrete implementation, measurement, adversarial, logic, or governance
  failure mode;
- migration impact for existing conformance statements and scorecards;
- verification evidence, including schema and local-link validation.

## Validation

Run `./scripts/validate.sh` (requires the `jsonschema` Python package) before
opening a pull request. It checks that:

- every schema in `schemas/` is valid JSON with a unique `$id`, and every
  `$ref` resolves;
- every example in `examples/` validates against its schema and is
  semantically coherent;
- prose registries and enums (gate IDs, outcome categories, lifecycle states,
  escalation event IDs, conformance targets) match the schemas;
- `versions.json` agrees with the schema constants and the `VERSION` file.

The same checks run in CI. When you change a schema, update the affected
examples and `versions.json` in the same pull request; when you add a
contract version, bump `versions.json` first.

## Version discipline

Do not rewrite a released tag. A correction that can change whether a case,
run, scorecard, or decision conforms is not editorial and cannot be a patch.
Before `1.0.0`, renaming stable IDs or changing outcome priority requires the
next minor release; from `1.0.0` onward, it requires a major release.

## Style

Use RFC 2119 key words only where a requirement is intended to be normative.
Define a term once in the glossary and reference it elsewhere. Keep examples
clearly non-normative and implementation-neutral.
