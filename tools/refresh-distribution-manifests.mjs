#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sha256Canonical } from "./outcome-replay-executor.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const positiveRoot = path.join(root, "conformance", "fixtures", "positive");

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

async function entryFor(absolute, kind) {
  const bytes = await readFile(absolute);
  const relativeUri = path.relative(root, absolute).split(path.sep).join("/");
  const isJson = absolute.endsWith(".json");
  const document = isJson ? JSON.parse(bytes.toString("utf8")) : null;
  const id = isJson
    ? (kind === "schemas" ? document.$id : (document.id ?? document.schemaVersion))
    : `normative-prose:${relativeUri}`;
  const version = document?.version ?? document?.standardVersion ?? "0.1.0";
  if (typeof id !== "string" || typeof version !== "string") {
    throw new Error(`manifest source lacks stable identity: ${path.relative(root, absolute)}`);
  }
  return {
    id,
    version,
    uri: relativeUri,
    digest: sha256Bytes(bytes)
  };
}

async function build(kind, sources, id, outputName) {
  const entries = [];
  for (const absolute of sources.sort((left, right) => left.localeCompare(right, "en"))) {
    entries.push(await entryFor(absolute, kind));
  }
  entries.sort((left, right) => left.uri.localeCompare(right.uri, "en"));
  const document = {
    schemaVersion: "agent-eval-distribution-manifest-1",
    id,
    version: "0.1.0",
    kind,
    entries,
    entriesDigest: sha256Canonical(entries)
  };
  const absolute = path.join(positiveRoot, outputName);
  const bytes = Buffer.from(`${JSON.stringify(document, null, 2)}\n`, "utf8");
  await writeFile(absolute, bytes);
  process.stdout.write(`${path.relative(root, absolute)}\n`);
}

const schemaSources = await filesWithExtensions(path.join(root, "schemas"), [".json"]);
const contractSources = [
  ...await filesWithExtensions(path.join(root, "standard"), [".json", ".md"]),
  ...await filesWithExtensions(path.join(root, "profiles"), [".json", "-contract.md"])
];
await build("schemas", schemaSources, "standard-schema-manifest", "schema-manifest.json");
await build("contracts", contractSources, "standard-contract-manifest", "contract-manifest.json");
