import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  canonicalize,
  distributionRequirementMappingResolver,
  expectedRequirementImplementations,
  sha256Bytes,
  sha256Canonical,
  validateRequirementImplementationRouting
} from "./verify-profile-requirement-mapping.mjs";

const root = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, "$1"));
const schemaDirectory = path.join(root, "schemas");
const registry = JSON.parse(await readFile(path.join(root, "standard", "requirement-registry.json"), "utf8"));
const canonicalRegistryIdentity = {
  id: "agent-evals-standard-requirements",
  version: registry.standardVersion,
  digest: registry.digest
};
const distributionResolver = await distributionRequirementMappingResolver();
const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: true });
addFormats(ajv);
for (const name of await readdir(schemaDirectory)) {
  if (name.endsWith(".schema.json")) ajv.addSchema(JSON.parse(await readFile(path.join(schemaDirectory, name), "utf8")));
}
const validateProfile = ajv.getSchema("urn:agent-evals-standard:schema:evaluation-profile:1");
const validateContract = ajv.getSchema("urn:agent-evals-standard:schema:requirement-implementation-contract:1");

function clone(value) {
  return structuredClone(value);
}

async function loadBundle(profileRelative, contractRelative) {
  const profile = JSON.parse(await readFile(path.join(root, profileRelative), "utf8"));
  const contractBytes = await readFile(path.join(root, contractRelative));
  const contract = JSON.parse(contractBytes.toString("utf8"));
  return { profile, contract, contractDigest: sha256Bytes(contractBytes) };
}

function contractBytes(contract) {
  return Buffer.from(`${JSON.stringify(contract, null, 2)}\n`, "utf8");
}

function bundleIssues(profile, contract, resolvedContractDigest) {
  const issues = [];
  const pointer = profile.requirementMapping?.[0]?.implementation;
  if (!pointer) issues.push("missing implementation pointer");
  if (pointer?.digest !== resolvedContractDigest) {
    issues.push("implementation pointer digest does not authenticate contract bytes");
  }
  if (!validateProfile(profile)) issues.push(`profile schema: ${ajv.errorsText(validateProfile.errors)}`);
  if (!validateContract(contract)) issues.push(`contract schema: ${ajv.errorsText(validateContract.errors)}`);
  if (issues.length === 0) {
    issues.push(...validateRequirementImplementationRouting({
      profile,
      registry,
      canonicalRegistryIdentity,
      contract,
      contractPointer: pointer,
      distributionResolver
    }));
  }
  return issues;
}

const repoChange = await loadBundle(
  "profiles/repo-change-v1/evaluation-profile.json",
  "profiles/repo-change-v1/implementation-contract.json"
);
const repositoryReview = await loadBundle(
  "profiles/repository-review-v1/evaluation-profile.json",
  "profiles/repository-review-v1/implementation-contract.json"
);
const architectureChild = await loadBundle(
  "conformance/fixtures/architecture-evaluation-profile-child.json",
  "conformance/fixtures/architecture-requirement-implementation-contract.json"
);

const vectors = [];
function vector(id, valid, mutate, base = repoChange) {
  const profile = clone(base.profile);
  const contract = clone(base.contract);
  mutate?.(profile, contract);
  let resolvedContractDigest = base.contractDigest;
  if (mutate) {
    resolvedContractDigest = sha256Bytes(contractBytes(contract));
    for (const row of profile.requirementMapping ?? []) row.implementation.digest = resolvedContractDigest;
  }
  vectors.push({ id, valid, issues: bundleIssues(profile, contract, resolvedContractDigest) });
}

vector("repo-change-valid-neutral-routing", true);
vector("repository-review-valid-neutral-routing", true, null, repositoryReview);
vector("architecture-child-valid-leaf-complete-routing", true, null, architectureChild);

vector("reject-arbitrary-json-root", false, (_profile, contract) => {
  for (const key of Object.keys(contract)) delete contract[key];
  contract.preserves = true;
});
vector("reject-wrong-requirement-id", false, (_profile, contract) => {
  contract.implementations[0].requirementId = "CLAIMANT-001";
});
vector("reject-wrong-criterion-digest", false, (_profile, contract) => {
  contract.implementations[0].verificationContractDigest = "sha256:" + "0".repeat(64);
});
vector("reject-declared-effect", false, (profile) => {
  profile.requirementMapping[0].effect = "strengthens";
});
vector("reject-not-applicable-assertion", false, (profile) => {
  profile.requirementMapping[0].effect = "not_applicable_with_restriction";
});
vector("reject-content-equal-source-flip", false, (profile) => {
  profile.requirementMapping[0].sourceProfileId = "claimant-child";
});
vector("reject-generic-values-fallback", false, (_profile, contract) => {
  contract.values = ["claimant-obligation"];
});
vector("reject-claimant-verifier-echo", false, (_profile, contract) => {
  contract.resolver.implementationDigest = "sha256:" + "1".repeat(64);
  contract.verdict = "pass";
});
vector("reject-alternate-registry-same-ids", false, (profile, contract) => {
  const alternate = clone(registry);
  alternate.requirements[0].verificationContract.question = "Claimant-selected weakened criterion";
  delete alternate.digest;
  alternate.digest = sha256Canonical(alternate);
  profile.baseCompatibility.requirementRegistry.digest = alternate.digest;
  contract.requirementRegistry.digest = alternate.digest;
  contract.implementations = expectedRequirementImplementations(alternate);
});
vector("reject-missing-requirement", false, (profile) => {
  profile.requirementMapping.pop();
});
vector("reject-duplicate-requirement", false, (profile) => {
  profile.requirementMapping[1] = clone(profile.requirementMapping[0]);
});
vector("reject-unknown-requirement", false, (profile) => {
  profile.requirementMapping[0].requirementId = "UNKNOWN-001";
});

const failures = [];
for (const entry of vectors) {
  const accepted = entry.issues.length === 0;
  if (accepted !== entry.valid) {
    failures.push(`${entry.id}: expected ${entry.valid ? "pass" : "fail"}, got ${accepted ? "pass" : `fail (${entry.issues.join("; ")})`}`);
  }
}

if (failures.length > 0) {
  process.stderr.write(`Requirement-routing vectors failed (${failures.length}):\n- ${failures.join("\n- ")}\n`);
  process.exit(1);
}
process.stdout.write(`Requirement-routing vectors passed: ${vectors.length} (${vectors.filter((entry) => entry.valid).length} positive, ${vectors.filter((entry) => !entry.valid).length} negative).\n`);
