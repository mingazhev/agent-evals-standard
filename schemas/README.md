# Normative Schemas

These JSON Schemas are normative documents for Golden Standard 3.0.1:

| Schema | Discriminator or identity |
| --- | --- |
| `case.schema.json` | `urn:agent-evals-standard:schema:case:2` |
| `case-qa-record.schema.json` | `urn:agent-evals-standard:schema:case-qa-record:2` |
| `conformance-statement.schema.json` | `urn:agent-evals-standard:schema:conformance-statement:1` |
| `escalation-event.schema.json` | `urn:agent-evals-standard:schema:escalation-event:1` |
| `governance-resolution.schema.json` | `urn:agent-evals-standard:schema:governance-resolution:1` |
| `governance-resolution-ledger.schema.json` | `urn:agent-evals-standard:schema:governance-resolution-ledger:1` |
| `governance-decision.schema.json` | `urn:agent-evals-standard:schema:governance-decision:1` |
| `scorecard.schema.json` | `urn:agent-evals-standard:schema:scorecard:3` |

Schema discriminators evolve independently from prose contract versions. A
prose-only version bump does not require a new discriminator when the accepted
JSON shape remains compatible.

Validators load every schema in this directory into a registry keyed by its
absolute `$id` before resolving cross-schema references.

The schemas and Markdown requirements are jointly normative. Conflict handling
is defined by the [Conformance Contract](../standard/conformance.md).
