# Normative Schemas

These JSON Schemas are normative documents for Golden Standard 0.1.0:

| Schema | Discriminator or identity |
| --- | --- |
| `case.schema.json` | `urn:agent-evals-standard:schema:case:1` |
| `case-qa-record.schema.json` | `urn:agent-evals-standard:schema:case-qa-record:1` |
| `conformance-statement.schema.json` | `urn:agent-evals-standard:schema:conformance-statement:1` |
| `escalation-event.schema.json` | `urn:agent-evals-standard:schema:escalation-event:1` |
| `assurance-observation.schema.json` | `urn:agent-evals-standard:schema:assurance-observation:1` |
| `governance-resolution.schema.json` | `urn:agent-evals-standard:schema:governance-resolution:1` |
| `governance-resolution-ledger.schema.json` | `urn:agent-evals-standard:schema:governance-resolution-ledger:1` |
| `governance-decision.schema.json` | `urn:agent-evals-standard:schema:governance-decision:1` |
| `scorecard.schema.json` | `urn:agent-evals-standard:schema:scorecard:1` |

Schema discriminators evolve independently from prose contract versions. A
prose-only version bump does not require a new discriminator when the accepted
JSON shape remains compatible.

Validators load every schema in this directory into a registry keyed by its
absolute `$id` before resolving cross-schema references.

Schema version constants are declared once in [`versions.json`](../versions.json)
and verified by `scripts/validate.sh`. Machine-validatable example instances
live in [`examples/`](../examples/README.md); every schema change must update
the affected examples in the same pull request.

The schemas and Markdown requirements are jointly normative. Conflict handling
is defined by the [Conformance Contract](../standard/conformance.md).
