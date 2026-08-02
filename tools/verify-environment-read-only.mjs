import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

function decodePointerToken(token) {
  return token.replaceAll("~1", "/").replaceAll("~0", "~");
}

function applyMutation(document, mutation) {
  const tokens = mutation.pointer.slice(1).split("/").map(decodePointerToken);
  const leaf = tokens.pop();
  let target = document;
  for (const token of tokens) target = target[token];
  if (mutation.operation === "remove") delete target[leaf];
  else if (mutation.operation === "replace") target[leaf] = structuredClone(mutation.value);
  else throw new Error(`unsupported mutation operation ${mutation.operation}`);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schema = JSON.parse(await readFile(path.join(root, "schemas/environment-contract.schema.json"), "utf8"));
const vectorPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(root, "conformance/vectors/environment-read-only.json");
const vectorSet = JSON.parse(await readFile(vectorPath, "utf8"));

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);
let passed = 0;

for (const vector of vectorSet.vectors ?? []) {
  const document = structuredClone(vectorSet.baseDocument);
  for (const mutation of vector.mutations ?? []) applyMutation(document, mutation);
  const valid = validate(document);
  const issues = (validate.errors ?? []).map((error) => `${error.instancePath || "/"} ${error.message}`);
  const expectedErrorFound = vector.valid || issues.some((issue) => issue.includes(vector.expectedError));
  if (valid !== vector.valid || !expectedErrorFound) {
    throw new Error(
      `${vector.id}: expected valid=${vector.valid}${vector.expectedError ? ` and error containing ${vector.expectedError}` : ""}; got ${issues.join("; ") || "pass"}`
    );
  }
  passed += 1;
}

process.stdout.write(`Read-only environment-contract vectors passed: ${passed}/${vectorSet.vectors.length}.\n`);
