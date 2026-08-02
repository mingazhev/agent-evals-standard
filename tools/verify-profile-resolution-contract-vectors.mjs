import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, "$1"));
const schemaDirectory = path.join(root, "schemas");
const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: true });
addFormats(ajv);
for (const name of await readdir(schemaDirectory)) {
  if (name.endsWith(".schema.json")) {
    ajv.addSchema(JSON.parse(await readFile(path.join(schemaDirectory, name), "utf8")));
  }
}

const record = JSON.parse(await readFile(
  path.join(root, "conformance", "fixtures", "architecture-profile-child-resolution.json"),
  "utf8"
));
const proofInputs = JSON.parse(await readFile(
  path.join(root, "conformance", "fixtures", "architecture-profile-resolution-evidence-payload.json"),
  "utf8"
));
const validateRecord = ajv.getSchema("urn:agent-evals-standard:schema:profile-resolution-record:1");
const validateProofInputs = ajv.getSchema("urn:agent-evals-standard:schema:profile-resolution-proof-inputs:1");

function clone(value) {
  return structuredClone(value);
}

const vectors = [];
function vector(id, valid, validator, value) {
  const accepted = validator(value);
  vectors.push({
    id,
    valid,
    accepted,
    diagnostics: accepted ? "" : ajv.errorsText(validator.errors)
  });
}

vector("child-proof-input-record-valid", true, validateRecord, record);
vector("closed-proof-input-payload-valid", true, validateProofInputs, proofInputs);

{
  const value = clone(record);
  value.replacementProofs[0].verifier = {
    id: "claimant-selected-verifier",
    version: "0.1.0",
    digest: `sha256:${"1".repeat(64)}`,
    schemaId: "claimant-result-1",
    verifierDigest: `sha256:${"2".repeat(64)}`
  };
  vector("reject-claimant-verifier-metadata", false, validateRecord, value);
}
{
  const value = clone(record);
  value.evidenceManifest = [];
  vector("reject-proof-without-input-evidence", false, validateRecord, value);
}
{
  const value = clone(record);
  value.replacementProofs = [];
  value.evidenceManifest = [];
  vector("root-shape-without-proof-evidence-valid", true, validateRecord, value);
}
{
  const value = clone(record);
  value.replacementProofs = [];
  vector("reject-resolver-result-evidence-without-proof", false, validateRecord, value);
}
{
  const value = clone(proofInputs);
  value.verdict = "pass";
  vector("reject-claimant-verdict-in-proof-inputs", false, validateProofInputs, value);
}
{
  const value = clone(proofInputs);
  value.verifier = {
    id: "claimant-selected-verifier",
    version: "0.1.0",
    implementationDigest: `sha256:${"3".repeat(64)}`
  };
  vector("reject-claimant-verifier-in-proof-inputs", false, validateProofInputs, value);
}
{
  const value = clone(proofInputs);
  value.proofInputs[0].relation = "strengthens";
  vector("reject-claimant-relation-in-proof-inputs", false, validateProofInputs, value);
}

const failures = vectors.filter((entry) => entry.accepted !== entry.valid);
if (failures.length > 0) {
  process.stderr.write(`Profile-resolution contract vectors failed (${failures.length}):\n`);
  for (const failure of failures) {
    process.stderr.write(`- ${failure.id}: expected ${failure.valid ? "pass" : "fail"}, got ${failure.accepted ? "pass" : `fail (${failure.diagnostics})`}\n`);
  }
  process.exit(1);
}

process.stdout.write(`Profile-resolution contract vectors passed: ${vectors.length} (${vectors.filter((entry) => entry.valid).length} positive, ${vectors.filter((entry) => !entry.valid).length} negative).\n`);
