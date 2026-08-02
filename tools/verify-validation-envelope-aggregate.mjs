import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  deriveValidationEnvelopeResult,
  validationEnvelopeAggregateIssues
} from "./validation-envelope-aggregate.mjs";

const root = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, "$1"));
const schemaDirectory = path.join(root, "schemas");
const vectorPath = path.join(root, "conformance", "fixtures", "validation-envelope", "aggregate-vectors.json");
const vectorDirectory = path.dirname(vectorPath);

async function readJson(absolute) {
  return JSON.parse(await readFile(absolute, "utf8"));
}

const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: true });
addFormats(ajv);
for (const name of await readdir(schemaDirectory)) {
  if (name.endsWith(".schema.json")) ajv.addSchema(await readJson(path.join(schemaDirectory, name)));
}
const validate = ajv.getSchema("urn:agent-evals-standard:schema:validation-envelope:1");
if (!validate) throw new Error("validation-envelope schema is not registered");

const vectorSet = await readJson(vectorPath);
if (vectorSet.schemaVersion !== "validation-envelope-aggregate-vectors-1"
  || vectorSet.validationContractVersion !== "0.1.0"
  || !Array.isArray(vectorSet.vectors) || vectorSet.vectors.length === 0) {
  throw new Error("invalid validation-envelope aggregate vector set");
}

const basePath = path.resolve(vectorDirectory, vectorSet.basePath);
const relativeBase = path.relative(root, basePath);
if (relativeBase.startsWith("..") || path.isAbsolute(relativeBase)) {
  throw new Error("validation-envelope aggregate vector basePath escapes the repository");
}
const base = await readJson(basePath);
let failures = 0;

for (const vector of vectorSet.vectors) {
  const document = structuredClone(base);
  document.result = vector.declaredResult;
  for (const override of vector.overrides ?? []) {
    const check = document.checks?.[override.index];
    if (!check) throw new Error(`${vector.id}: check index ${override.index} does not exist`);
    check.result = override.result;
    check.findingIds = override.result === "pass" || override.result === "not_applicable"
      ? []
      : [`${vector.id}-finding-${override.index}`];
  }

  const schemaValid = validate(document);
  const schemaErrors = structuredClone(validate.errors ?? []);
  const derivedResult = deriveValidationEnvelopeResult(document.checks);
  const aggregateIssues = validationEnvelopeAggregateIssues(document.checks, document.result);
  const problems = [];
  if (schemaValid !== vector.expectedSchemaValid) {
    problems.push(`schemaValid=${schemaValid}, expected ${vector.expectedSchemaValid}: ${ajv.errorsText(schemaErrors)}`);
  }
  for (const keyword of vector.expectedSchemaErrorKeywords ?? []) {
    if (!schemaErrors.some((error) => error.keyword === keyword)) {
      problems.push(`schema errors do not include keyword ${keyword}: ${ajv.errorsText(schemaErrors)}`);
    }
  }
  if (derivedResult !== vector.expectedDerivedResult) {
    problems.push(`derivedResult=${derivedResult}, expected ${vector.expectedDerivedResult}`);
  }
  if (aggregateIssues.length !== vector.expectedAggregateIssueCount) {
    problems.push(
      `aggregate issue count=${aggregateIssues.length}, expected ${vector.expectedAggregateIssueCount}: `
      + aggregateIssues.join("; ")
    );
  }
  for (const fragment of vector.expectedAggregateIssueFragments ?? []) {
    if (!aggregateIssues.some((issue) => issue.includes(fragment))) {
      problems.push(`aggregate issues do not include ${JSON.stringify(fragment)}: ${aggregateIssues.join("; ")}`);
    }
  }
  if (problems.length > 0) {
    failures += 1;
    console.error(`${vector.id}: ${problems.join(" | ")}`);
  }
}

if (failures > 0) process.exit(1);
console.log(`Validation-envelope aggregate vectors passed: ${vectorSet.vectors.length}.`);
