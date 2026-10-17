#!/usr/bin/env node
// Lightweight repository check for the standard's contracts. It is not a
// conformance validator: it proves only that schemas compile, examples match
// their declared expectations, bundled contracts are schema-valid, profile
// digests and references agree, required case fields exist, fixture descriptors
// resolve, local Markdown links resolve, and the worked example recomputes.

import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const relative = (absolute) => path.relative(root, absolute).split(path.sep).join("/");
const readJson = async (absolute) => JSON.parse(await readFile(absolute, "utf8"));
const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
// shortcut: schema-checked repository JSON only; use a rejecting JCS parser for untrusted input.
const jcs = (value) => Array.isArray(value) ? `[${value.map(jcs).join(",")}]`
  : value && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${jcs(value[key])}`).join(",")}}`
  : JSON.stringify(value);
const canonicalDocumentDigest = (document) => {
  const { digest, ...projection } = document;
  return sha256(Buffer.from(jcs(projection), "utf8"));
};
assert.equal(jcs({ b: [2, 1], a: "quote\"\nline" }), "{\"a\":\"quote\\\"\\nline\",\"b\":[2,1]}");
const referencedDigest = (document, bytes) => typeof document?.digest === "string" ? canonicalDocumentDigest(document) : sha256(bytes);
assert.equal(referencedDigest({}, Buffer.from("profile reference")), "sha256:a86ea6454739ac2f561f67559e599632fef8ec47dc3a422016a1414719e073a5");
assert.notEqual(referencedDigest({ id: "a", digest: "stale" }), referencedDigest({ id: "b", digest: "stale" }));

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if ([".git", "node_modules"].includes(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

// 1. Every schema compiles in strict mode with every $ref resolved.
const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: true });
addFormats(ajv);
const schemaFiles = (await readdir(path.join(root, "schemas"))).filter((name) => name.endsWith(".schema.json")).sort();
const schemaIdByFile = new Map();
const schemaFileByVersion = new Map();
for (const name of schemaFiles) {
  const schema = await readJson(path.join(root, "schemas", name));
  ajv.addSchema(schema);
  schemaIdByFile.set(`schemas/${name}`, schema.$id);
  const version = schema.properties?.schemaVersion?.const;
  if (version) schemaFileByVersion.set(version, `schemas/${name}`);
}
for (const [file, id] of schemaIdByFile) {
  try {
    ajv.getSchema(id);
  } catch (error) {
    failures.push(`${file} does not compile: ${error.message}`);
  }
}

function validate(schemaFile, document) {
  const validator = ajv.getSchema(schemaIdByFile.get(schemaFile));
  if (!validator) return { valid: false, errors: `unknown schema ${schemaFile}` };
  const valid = validator(document);
  return { valid, errors: valid ? "" : JSON.stringify(validator.errors) };
}

function hasSchemaProperty(schema, pointer) {
  if (!pointer.startsWith("/")) return false;
  let current = schema;
  for (const segment of pointer.slice(1).split("/").map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"))) {
    if (!Object.hasOwn(current?.properties ?? {}, segment)) return false;
    current = current.properties[segment];
  }
  return true;
}

assert.equal(hasSchemaProperty({ properties: { nested: { properties: { value: {} } } } }, "/nested/value"), true);
assert.equal(hasSchemaProperty({ properties: { nested: {} } }, "/nested/value"), false);

// 2. Examples behave as the example manifest declares.
const examplesDirectory = path.join(root, "examples");
const exampleManifestPath = path.join(examplesDirectory, "manifest.json");
const exampleManifestBytes = await readFile(exampleManifestPath);
const exampleManifest = JSON.parse(exampleManifestBytes.toString("utf8"));
const examplesById = new Map();
const coveredSchemas = new Set();
const checkedInstances = new Set();
for (const example of exampleManifest.examples) {
  if (examplesById.has(example.id)) failures.push(`examples/manifest.json repeats id ${example.id}`);
  examplesById.set(example.id, example);
  const absolute = path.resolve(examplesDirectory, example.path);
  let document;
  try {
    document = await readJson(absolute);
  } catch (error) {
    failures.push(`example ${example.id}: cannot read ${example.path}: ${error.message}`);
    continue;
  }
  checkedInstances.add(absolute);
  const result = validate(example.schema, document);
  if (example.valid && !result.valid) failures.push(`example ${example.id} must be valid: ${result.errors}`);
  if (!example.valid && result.valid) failures.push(`example ${example.id} must be invalid against ${example.schema}`);
  if (!example.valid && example.expectedError && !result.errors.includes(example.expectedError)) {
    failures.push(`example ${example.id} fails for a different reason than ${JSON.stringify(example.expectedError)}: ${result.errors}`);
  }
  if (example.valid) coveredSchemas.add(example.schema);
}
for (const file of schemaIdByFile.keys()) {
  if (!coveredSchemas.has(file)) failures.push(`${file} has no valid example in examples/manifest.json`);
}

// 3. Bundled contracts in profiles/ and standard/ match the schema named by their schemaVersion.
const allFiles = await walk(root);
for (const absolute of allFiles.filter((file) => file.endsWith(".json"))) {
  const file = relative(absolute);
  if (!/^(profiles|standard)\//.test(file) || checkedInstances.has(absolute)) continue;
  const document = await readJson(absolute);
  const schemaFile = schemaFileByVersion.get(document?.schemaVersion);
  if (!schemaFile) continue;
  const result = validate(schemaFile, document);
  if (!result.valid) failures.push(`${file} is invalid against ${schemaFile}: ${result.errors}`);
}

// 4. Profile references resolve to local artifact identities and digests.
async function checkProfileReferences(value, profilePath, location = relative(profilePath)) {
  if (Array.isArray(value)) {
    for (const item of value) await checkProfileReferences(item, profilePath, location);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (typeof value.uri === "string" && typeof value.digest === "string") {
    const target = path.resolve(path.dirname(profilePath), value.uri);
    if (!/^[a-z]+:/i.test(value.uri)) {
      if (!allFiles.includes(target)) {
        failures.push(`${location} references missing local artifact ${value.uri}`);
      } else {
        const bytes = await readFile(target);
        let document;
        if (target.endsWith(".json")) {
          document = JSON.parse(bytes.toString("utf8"));
          if (typeof document.id === "string" && value.id !== document.id) {
            failures.push(`${location} reference ${value.uri} must identify ${document.id}`);
          }
          const version = document.version ?? document.standardVersion;
          if (typeof version === "string" && value.version !== version) {
            failures.push(`${location} reference ${value.uri} must use version ${version}`);
          }
        }
        const expectedDigest = referencedDigest(document, bytes);
        if (typeof document?.digest === "string" && document.digest !== expectedDigest) {
          failures.push(`${relative(target)} digest must be ${expectedDigest}`);
        }
        if (value.digest !== expectedDigest) failures.push(`${location} reference ${value.uri} must use digest ${expectedDigest}`);
      }
    }
  }
  for (const [key, child] of Object.entries(value)) {
    await checkProfileReferences(child, profilePath, `${location}.${key}`);
  }
}

// 5. Profile fixture descriptors resolve to declared example expectations.
for (const absolute of allFiles.filter((file) => /profiles\/[^/]+\/(?:evaluation-profile|outcome-profile)\.json$/.test(relative(file)))) {
  const profile = await readJson(absolute);
  const expectedProfileDigest = canonicalDocumentDigest(profile);
  if (profile.digest !== expectedProfileDigest) {
    failures.push(`${relative(absolute)} digest must be ${expectedProfileDigest}`);
  }
  await checkProfileReferences(profile, absolute);
  if (!/evaluation-profile\.json$/.test(relative(absolute))) {
    const scorecardContractDigest = sha256(await readFile(path.join(root, "standard/scorecard-contract.md")));
    for (const [field, id] of [["functionalSuccess", "functional-outcome-v1"], ["acceptedOutcome", "accepted-outcome-v1"]]) {
      const predicate = profile[field];
      if (predicate?.id !== id || predicate.version !== "0.1.0" || predicate.contractDigest !== scorecardContractDigest) {
        failures.push(`${relative(absolute)} ${field} must bind ${id} 0.1.0 to standard/scorecard-contract.md (${scorecardContractDigest})`);
      }
    }
    continue;
  }
  const contractRef = profile.caseContract;
  const contractPath = path.resolve(path.dirname(absolute), contractRef.uri);
  const caseContract = await readJson(contractPath);
  const caseSchemaFile = [...schemaIdByFile].find(([, id]) => id === caseContract.caseSchema?.id)?.[0];
  if (!caseSchemaFile) {
    failures.push(`${relative(contractPath)} references unknown case schema ${caseContract.caseSchema?.id}`);
  } else {
    const caseSchema = await readJson(path.join(root, caseSchemaFile));
    if (caseSchema.additionalProperties !== false) {
      failures.push(`${caseSchemaFile} must remain a closed case schema`);
    }
    for (const property of caseContract.requiredCaseProperties ?? []) {
      if (!hasSchemaProperty(caseSchema, property)) {
        failures.push(`${relative(contractPath)} requires undeclared case property ${property}`);
      }
    }
  }
  for (const fixture of profile.fixtures ?? []) {
    const label = `${relative(absolute)} fixture ${fixture.id}`;
    if (path.resolve(path.dirname(absolute), fixture.manifestUri) !== exampleManifestPath) {
      failures.push(`${label} must reference examples/manifest.json`);
      continue;
    }
    if (fixture.manifestDigest !== sha256(exampleManifestBytes)) {
      failures.push(`${label} manifestDigest must be ${sha256(exampleManifestBytes)}`);
    }
    const example = examplesById.get(fixture.manifestExpectationId);
    if (!example) failures.push(`${label} names unknown example ${fixture.manifestExpectationId}`);
    else if ((fixture.expectedVerdict === "pass") !== example.valid) {
      failures.push(`${label} expectedVerdict ${fixture.expectedVerdict} contradicts example ${example.id}`);
    }
  }
}

// 6. Local Markdown links and heading anchors resolve.
function githubHeadingSlug(text) {
  return text.trim().replace(/\s+#+\s*$/, "").replace(/<[^>]*>/g, "").replace(/[`*_~]/g, "")
    .toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").trim().replace(/\s+/g, "-");
}
function markdownAnchors(content) {
  const counts = new Map();
  const anchors = new Set();
  let fenced = false;
  for (const line of content.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    const match = !fenced && /^(?: {0,3})#{1,6}\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    const base = githubHeadingSlug(match[1]);
    if (!base) continue;
    const count = counts.get(base) ?? 0;
    anchors.add(count === 0 ? base : `${base}-${count}`);
    counts.set(base, count + 1);
  }
  return anchors;
}
const anchorCache = new Map();
for (const absolute of allFiles.filter((file) => file.endsWith(".md"))) {
  const content = (await readFile(absolute, "utf8")).replace(/```[\s\S]*?```/g, "");
  for (const [, target] of content.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    if (/^(?:[a-z]+:|mailto:)/i.test(target)) continue;
    const [targetPath, anchor] = target.split("#");
    const resolved = targetPath ? path.resolve(path.dirname(absolute), decodeURIComponent(targetPath)) : absolute;
    if (!allFiles.includes(resolved) && !allFiles.some((file) => file.startsWith(`${resolved}${path.sep}`))) {
      failures.push(`${relative(absolute)} has broken local link ${target}`);
      continue;
    }
    if (anchor && resolved.endsWith(".md")) {
      if (!anchorCache.has(resolved)) anchorCache.set(resolved, markdownAnchors(await readFile(resolved, "utf8")));
      if (!anchorCache.get(resolved).has(anchor)) failures.push(`${relative(absolute)} links to missing anchor ${target}`);
    }
  }
}

// 7. The worked example's ledger chain and point estimates recompute.
const worked = spawnSync(process.execPath, [path.join(root, "tools/verify-worked-example.mjs")], { encoding: "utf8" });
if (worked.status !== 0) failures.push(`worked example: ${worked.stderr.trim()}`);

if (failures.length) {
  console.error(`Repository check failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`Repository check passed: ${schemaFiles.length} schemas, ${exampleManifest.examples.length} examples, bundled contracts, profile fixtures, Markdown links, and the worked example.`);
