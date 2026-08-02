#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sha256Canonical } from "./outcome-replay-executor.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const registryPath = path.join(root, "standard", "requirement-registry.json");
const registry = JSON.parse(await readFile(registryPath, "utf8"));
const projection = structuredClone(registry);
delete projection.digest;
registry.digest = sha256Canonical(projection);
await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
process.stdout.write(`${path.relative(root, registryPath)}\n`);
