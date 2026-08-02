import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  distributionRequirementMappingResolver,
  expectedRequirementImplementations,
  sha256Bytes
} from "./verify-profile-requirement-mapping.mjs";

const root = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, "$1"));
const args = process.argv.slice(2);
if (args.length !== 3) {
  process.stderr.write(
    "usage: node tools/build-profile-requirement-routing.mjs <evaluation-profile.json> <implementation-contract.json> <profile-relative-contract-uri>\n"
  );
  process.exit(2);
}

const [profileInput, contractInput, contractUri] = args;
const profileAbsolute = path.resolve(profileInput);
const contractAbsolute = path.resolve(contractInput);
const registry = JSON.parse(await readFile(path.join(root, "standard", "requirement-registry.json"), "utf8"));
const profile = JSON.parse(await readFile(profileAbsolute, "utf8"));
const resolver = await distributionRequirementMappingResolver();
const contract = {
  schemaVersion: "agent-eval-requirement-implementation-contract-1",
  id: `${profile.id}-requirement-implementation-contract`,
  version: "0.1.0",
  profile: { id: profile.id, version: profile.version },
  sourceProfile: { id: profile.id, version: profile.version },
  requirementRegistry: {
    id: "agent-evals-standard-requirements",
    version: registry.standardVersion,
    digest: registry.digest
  },
  resolver,
  implementations: expectedRequirementImplementations(registry)
};
const contractBytes = Buffer.from(`${JSON.stringify(contract, null, 2)}\n`, "utf8");
await writeFile(contractAbsolute, contractBytes);

const pointer = {
  id: contract.id,
  version: contract.version,
  uri: contractUri,
  digest: sha256Bytes(contractBytes)
};
profile.baseCompatibility.requirementRegistry.id = "agent-evals-standard-requirements";
profile.baseCompatibility.requirementRegistry.version = registry.standardVersion;
profile.baseCompatibility.requirementRegistry.digest = registry.digest;
profile.requirementMapping = contract.implementations.map((entry) => ({
  requirementId: entry.requirementId,
  sourceProfileId: profile.id,
  implementation: pointer
}));
await writeFile(profileAbsolute, `${JSON.stringify(profile, null, 2)}\n`, "utf8");

process.stdout.write(`${path.relative(root, profileAbsolute)} -> ${path.relative(root, contractAbsolute)}\n`);
