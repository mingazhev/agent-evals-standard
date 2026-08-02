#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalize, sha256Canonical } from "./outcome-replay-executor.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(
  path.join(root, "conformance", "fixtures", "positive", "contract-manifest.json"), "utf8"));

function sha256Bytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function filesWithExtensions(directory, extensions) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesWithExtensions(absolute, extensions));
    else if (entry.isFile() && extensions.some((extension) => entry.name.endsWith(extension))) {
      files.push(absolute);
    }
  }
  return files;
}

async function expectedEntries(byteOverrides = new Map()) {
  const files = [
    ...await filesWithExtensions(path.join(root, "standard"), [".json", ".md"]),
    ...await filesWithExtensions(path.join(root, "profiles"), [".json", "-contract.md"])
  ];
  const entries = [];
  for (const absolute of files) {
    const uri = path.relative(root, absolute).split(path.sep).join("/");
    const bytes = byteOverrides.get(uri) ?? await readFile(absolute);
    const parsed = absolute.endsWith(".json") ? JSON.parse(bytes.toString("utf8")) : null;
    entries.push({
      id: parsed ? (parsed.id ?? parsed.schemaVersion) : `normative-prose:${uri}`,
      version: parsed?.version ?? parsed?.standardVersion ?? "0.1.0",
      uri,
      digest: sha256Bytes(bytes)
    });
  }
  return entries.sort((left, right) => left.uri.localeCompare(right.uri, "en"));
}

async function validates(candidate, byteOverrides = new Map()) {
  const expected = await expectedEntries(byteOverrides);
  return candidate.entriesDigest === sha256Canonical(candidate.entries)
    && canonicalize(candidate.entries) === canonicalize(expected);
}

const normativeEntry = manifest.entries.find((entry) => entry.uri.endsWith(".md"));
if (!normativeEntry) throw new Error("contract manifest has no normative Markdown entry");
const normativeBytes = await readFile(path.join(root, normativeEntry.uri));
function withRecomputedEntries(entries) {
  return { ...manifest, entries, entriesDigest: sha256Canonical(entries) };
}
const vectors = [
  { id: "current-exact-contract-distribution-positive", candidate: manifest, valid: true },
  {
    id: "normative-prose-byte-mutation-negative",
    candidate: manifest,
    overrides: new Map([[normativeEntry.uri, Buffer.concat([normativeBytes, Buffer.from("\nverdict-changing mutation\n")])]]),
    valid: false
  },
  {
    id: "missing-normative-prose-entry-negative",
    candidate: withRecomputedEntries(
      manifest.entries.filter((entry) => entry.uri !== normativeEntry.uri)),
    valid: false
  },
  {
    id: "passenger-contract-entry-negative",
    candidate: withRecomputedEntries([...manifest.entries, {
        id: "passenger-contract",
        version: "0.1.0",
        uri: "standard/passenger.md",
        digest: `sha256:${"f".repeat(64)}`
      }]),
    valid: false
  },
  {
    id: "forged-entries-digest-negative",
    candidate: { ...manifest, entriesDigest: `sha256:${"f".repeat(64)}` },
    valid: false
  }
];

const failures = [];
for (const vector of vectors) {
  const observed = await validates(vector.candidate, vector.overrides);
  if (observed !== vector.valid) failures.push(
    `${vector.id}: expected valid=${vector.valid}, observed valid=${observed}`);
}
if (failures.length > 0) {
  process.stderr.write(`Distribution-manifest vectors failed:\n${failures.map((entry) => `- ${entry}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`Exact distribution-manifest vectors passed: ${vectors.length}/${vectors.length}.\n`);
