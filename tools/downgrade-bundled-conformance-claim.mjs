import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDirectory = path.join(root, "conformance", "fixtures", "positive");
const statementPath = path.join(fixtureDirectory, "conformance-statement-decision.json");
const envelopePath = path.join(fixtureDirectory, "validation-envelope-conformance-statement.json");
const retainedEvidenceIds = ["repository-grounding-primary", "repository-grounding-secondary"];

const statement = JSON.parse(await readFile(statementPath, "utf8"));
const target = statement.targetEvidence?.[statement.claim];
if (!target) throw new Error("bundled conformance target is missing");
target.verdict = "not_claimed";
target.subjectSchema = "urn:agent-evals-standard:schema:governance-decision:1";
target.evidenceIds = retainedEvidenceIds;
for (const row of target.requirementResults ?? []) {
  row.status = "insufficient_evidence";
  row.claimEffect = "insufficient_evidence";
  row.evidenceIds = retainedEvidenceIds;
}
statement.evidenceManifest = (statement.evidenceManifest ?? [])
  .filter((evidence) => retainedEvidenceIds.includes(evidence.id));
await writeFile(statementPath, `${JSON.stringify(statement, null, 2)}\n`, "utf8");

const envelope = JSON.parse(await readFile(envelopePath, "utf8"));
for (const check of envelope.checks ?? []) {
  check.result = "insufficient_evidence";
  check.findingIds = ["unregistered-verification-evidence"];
  check.evidenceIds = retainedEvidenceIds;
}
envelope.result = "insufficient_evidence";
envelope.evidenceManifest = (envelope.evidenceManifest ?? [])
  .filter((evidence) => retainedEvidenceIds.includes(evidence.id));
await writeFile(envelopePath, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");

process.stdout.write("Bundled decision target is diagnostic not_claimed; no unverifiable pass remains.\n");
