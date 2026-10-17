# Examples

Informative instances of the standard's JSON contracts. They show shape, not
conformance, and they cannot create, waive, or decide an obligation.

- [`core/`](core/README.md) — an A1 arithmetic walkthrough, with one case
  shown from a synthetic 50-case run; its six files are the valid examples of the
  `case`, `case-qa`, `run-manifest`, `attempt-ledger`, `scorecard`, and
  `conformance-statement` schemas.
- `valid/` — one valid instance for each A2/A3 attachment and registry schema that has
  no bundled instance in [`profiles/`](../profiles/) or [`standard/`](../standard/).
- `invalid/` — a few instances that the schema itself rejects, each illustrating
  one rule.
- [`manifest.json`](manifest.json) — the declared expectation for every example:
  path, schema, `valid`, and for invalid examples the expected error location
  and the rule it illustrates. Profile `fixtures` descriptors point here.

A2/A3 fixtures illustrate the draft annex, not normative A1 content.
They are independent shape examples, not a connected conformance bundle.
For example, the validity argument's run binding is illustrative and does not
authenticate the separate A3 run-manifest example. In the held-out ledger
example, the one event prepays one case exposure and one outcome look; its
`occurredAt` precedes sealing and is the debit time, not completion time.

`npm test` checks that every schema has a valid example, that each example
matches its expectation, and that bundled contracts validate. It does not
re-verify digests, cross-document references, or commit identifiers inside the
examples; those are illustrative. In particular, case profile digests and run
attachment references (including `replayImplementation`) are placeholders,
not references to the current bundled files. Bundled profile hashes and local references
in `profiles/` are checked separately and are not illustrative placeholders.
