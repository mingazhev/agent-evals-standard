import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { canonicalize, sha256Canonical } from "./verify-material-integrity.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function activationInputProjection(caseDocument) {
  const projection = structuredClone(caseDocument);
  for (const field of ["lifecycle", "digest", "signature"]) delete projection[field];
  return projection;
}

function activationInputManifest(caseDocument) {
  const projection = activationInputProjection(caseDocument);
  return {
    schemaVersion: "agent-eval-activation-input-1",
    case: {
      id: projection.id,
      version: projection.caseVersion,
      projectionDigest: sha256Canonical(projection)
    },
    projection
  };
}

function activationInputBindingIssues(caseDocument, manifest) {
  const expectedProjection = activationInputProjection(caseDocument);
  const issues = [];
  if (manifest?.case?.id !== caseDocument?.id) issues.push("case id does not match activation manifest");
  if (manifest?.case?.version !== caseDocument?.caseVersion) issues.push("case version does not match activation manifest");
  if (canonicalize(manifest?.projection) !== canonicalize(expectedProjection)) {
    issues.push("activation projection does not match the case pre-QA projection");
  }
  if (manifest?.case?.projectionDigest !== sha256Canonical(expectedProjection)) {
    issues.push("activation projection digest does not match the case pre-QA projection");
  }
  if (caseDocument?.lifecycle?.activationInputDigest !== sha256Canonical(manifest)) {
    issues.push("case lifecycle activationInputDigest does not match the activation manifest");
  }
  return issues;
}

function reordered(value) {
  if (Array.isArray(value)) return value.map(reordered);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().reverse().map((key) => [key, reordered(value[key])]));
}

const vectorPath = path.join(root, "conformance", "fixtures", "activation-input", "vectors.json");
const schemaPath = path.join(root, "schemas", "case-activation-input.schema.json");
const envelopeSchemaPath = path.join(root, "schemas", "validation-envelope.schema.json");
const envelopePath = path.join(root, "conformance", "fixtures", "positive", "validation-envelope-decision.json");
const [vectors, activationSchema, envelopeSchema, envelope] = await Promise.all([
  readFile(vectorPath, "utf8").then(JSON.parse),
  readFile(schemaPath, "utf8").then(JSON.parse),
  readFile(envelopeSchemaPath, "utf8").then(JSON.parse),
  readFile(envelopePath, "utf8").then(JSON.parse)
]);
const baseCase = JSON.parse(await readFile(path.resolve(path.dirname(vectorPath), vectors.baseCasePath), "utf8"));

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const schemaDirectory = path.join(root, "schemas");
const schemaFiles = await readdir(schemaDirectory);
for (const name of schemaFiles.filter((entry) => entry.endsWith(".json"))) {
  ajv.addSchema(JSON.parse(await readFile(path.join(schemaDirectory, name), "utf8")));
}
const validateManifest = ajv.getSchema(activationSchema.$id);
if (!validateManifest) throw new Error("activation-input schema is not registered");
const validateEnvelope = ajv.getSchema(envelopeSchema.$id);
if (!validateEnvelope) throw new Error("validation-envelope schema is not registered");
const validateCase = ajv.getSchema("urn:agent-evals-standard:schema:case:1");
if (!validateCase) throw new Error("case schema is not registered");

const baseManifest = activationInputManifest(baseCase);
const storedManifest = JSON.parse(await readFile(path.join(root, "conformance", "fixtures", "positive", "case-activation-input.json"), "utf8"));
assert.deepEqual(storedManifest, baseManifest, "generated activation input must reproduce the source case projection");
assert.equal(validateCase(baseCase), true, JSON.stringify(validateCase.errors));
assert.equal(validateManifest(baseManifest), true, JSON.stringify(validateManifest.errors));
assert.equal(baseManifest.case.id, baseCase.id);
assert.equal(baseManifest.case.version, baseCase.caseVersion);
// The small known-answer input checks projection bytes only, not case validity.
// The real fixture above supplies the independent case/manifest shape check.
const knownManifest = activationInputManifest(vectors.projectionInput);
assert.equal(knownManifest.case.projectionDigest, vectors.expected.projectionDigest);
assert.equal(sha256Canonical(knownManifest), vectors.expected.activationInputDigest);
const activationDigest = sha256Canonical(baseManifest);

const boundCase = structuredClone(baseCase);
boundCase.lifecycle.activationInputDigest = activationDigest;
assert.deepEqual(activationInputBindingIssues(boundCase, baseManifest), []);

const wrongCaseBinding = structuredClone(baseManifest);
wrongCaseBinding.case.id = "different-case";
assert.equal(activationInputBindingIssues(boundCase, wrongCaseBinding).includes("case id does not match activation manifest"), true);

const reorderedManifest = reordered(baseManifest);
assert.equal(sha256Canonical(reorderedManifest), activationDigest);

const lifecycleOnlyChange = structuredClone(baseCase);
lifecycleOnlyChange.lifecycle.status = "active";
lifecycleOnlyChange.lifecycle.activationInputDigest = `sha256:${"f".repeat(64)}`;
assert.equal(sha256Canonical(activationInputManifest(lifecycleOnlyChange)), activationDigest);

const inputChange = structuredClone(baseCase);
inputChange.task = { changed: true };
assert.notEqual(sha256Canonical(activationInputManifest(inputChange)), activationDigest);

const activationEnvelope = structuredClone(envelope);
activationEnvelope.subject.type = "case";
activationEnvelope.subject.claimTarget = "case";
activationEnvelope.subject.projection = "sealed_activation_input";
assert.equal(validateEnvelope(activationEnvelope), true, JSON.stringify(validateEnvelope.errors));
assert.equal(validateEnvelope({ ...activationEnvelope, subject: { ...activationEnvelope.subject, type: "decision" } }), false, "sealed activation input must target a case");
for (const unsupported of ["sealed_run", "governance_state"]) {
  const candidate = structuredClone(activationEnvelope);
  candidate.subject.projection = unsupported;
  assert.equal(validateEnvelope(candidate), false, `${unsupported} must fail closed`);
}

console.log("activation-input vectors: ok");
