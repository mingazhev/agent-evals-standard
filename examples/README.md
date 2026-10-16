# Examples

Informative instances of the standard's JSON contracts. They show shape, not
conformance, and they cannot create, waive, or decide an obligation.

- [`core/`](core/README.md) — a complete A1 experiment, worked through
  with every number computed; its six files are the valid examples of the
  `case`, `case-qa`, `run-manifest`, `attempt-ledger`, `scorecard`, and
  `conformance-statement` schemas.
- `valid/` — one valid instance for each A2/A3 attachment and registry schema that has
  no bundled instance in [`profiles/`](../profiles/) or [`standard/`](../standard/).
- `invalid/` — a few instances that the schema itself rejects, each illustrating
  one rule.
- [`manifest.json`](manifest.json) — the declared expectation for every example:
  path, schema, `valid`, and for invalid examples the expected error location
  and the rule it illustrates. Profile `fixtures` descriptors point here.

`npm test` checks that every schema has a valid example, that each example
matches its expectation, and that bundled contracts validate. It does not
re-verify digests, cross-document references, or commit identifiers inside the
examples; those are illustrative.
