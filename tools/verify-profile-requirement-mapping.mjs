import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const REQUIREMENT_MAPPING_RESOLVER_ID = "agent-evals-standard-requirement-mapping-resolver";
export const REQUIREMENT_MAPPING_RESOLVER_VERSION = "0.1.0";

export function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}

export function sha256Canonical(value) {
  return `sha256:${createHash("sha256").update(Buffer.from(canonicalize(value), "utf8")).digest("hex")}`;
}

export function sha256Bytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export async function distributionRequirementMappingResolver() {
  const bytes = await readFile(fileURLToPath(import.meta.url));
  return {
    id: REQUIREMENT_MAPPING_RESOLVER_ID,
    version: REQUIREMENT_MAPPING_RESOLVER_VERSION,
    implementationDigest: sha256Bytes(bytes)
  };
}

function same(left, right) {
  return canonicalize(left) === canonicalize(right);
}

function pointerIdentity(pointer) {
  return pointer && {
    id: pointer.id,
    version: pointer.version,
    digest: pointer.digest
  };
}

function counts(values) {
  const result = new Map();
  for (const value of values) result.set(value, (result.get(value) ?? 0) + 1);
  return result;
}

export function expectedRequirementImplementations(registry) {
  return [...(registry.requirements ?? [])]
    .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    .map((requirement) => ({
      requirementId: requirement.id,
      criterionId: requirement.verificationContract.criterionId,
      verificationContractDigest: sha256Canonical(requirement.verificationContract),
      proofBasis: "requirement_owned_conformance_proof"
    }));
}

export function validateRequirementImplementationRouting({
  profile,
  registry,
  canonicalRegistryIdentity,
  contract,
  contractPointer,
  distributionResolver
}) {
  const issues = [];
  const profileIdentity = { id: profile?.id, version: profile?.version };
  const rows = profile?.requirementMapping ?? [];
  const expectedEntries = expectedRequirementImplementations(registry);
  const expectedIds = expectedEntries.map((entry) => entry.requirementId);
  const actualIds = rows.map((row) => row.requirementId);
  const actualCounts = counts(actualIds);

  for (const id of expectedIds) {
    if (actualCounts.get(id) !== 1) issues.push(`requirementMapping: ${id} occurs ${actualCounts.get(id) ?? 0} times`);
  }
  for (const id of actualCounts.keys()) {
    if (!expectedIds.includes(id)) issues.push(`requirementMapping: unknown requirement ${id}`);
  }
  if (!same(actualIds, [...expectedIds].sort())) {
    issues.push("requirementMapping: the leaf declaration must be complete and lexically ordered");
  }

  if (!same(pointerIdentity(profile?.baseCompatibility?.requirementRegistry), canonicalRegistryIdentity)) {
    issues.push("requirementMapping: baseCompatibility does not bind the canonical distributed requirement registry");
  }
  if (contract?.id !== contractPointer?.id || contract?.version !== contractPointer?.version) {
    issues.push("requirementMapping: implementation pointer does not bind the resolved contract identity");
  }
  if (!same(contract?.profile, profileIdentity) || !same(contract?.sourceProfile, profileIdentity)) {
    issues.push("requirementMapping: implementation contract does not bind the leaf profile as profile and source");
  }
  if (!same(contract?.requirementRegistry, canonicalRegistryIdentity)) {
    issues.push("requirementMapping: implementation contract does not bind the canonical distributed registry");
  }
  if (!same(contract?.resolver, distributionResolver)) {
    issues.push("requirementMapping: resolver is not the distribution-owned implementation");
  }

  const expectedContractId = `${profile?.id}-requirement-implementation-contract`;
  if (contract?.id !== expectedContractId) {
    issues.push(`requirementMapping: implementation contract id must be ${expectedContractId}`);
  }

  const contractEntries = contract?.implementations ?? [];
  const contractIds = contractEntries.map((entry) => entry.requirementId);
  const contractCounts = counts(contractIds);
  for (const id of expectedIds) {
    if (contractCounts.get(id) !== 1) {
      issues.push(`requirementMapping: contract implementation ${id} occurs ${contractCounts.get(id) ?? 0} times`);
    }
  }
  for (const id of contractCounts.keys()) {
    if (!expectedIds.includes(id)) issues.push(`requirementMapping: contract has unknown requirement ${id}`);
  }
  if (!same(contractEntries, expectedEntries)) {
    issues.push("requirementMapping: contract entries do not exactly reproduce requirement-owned verification contracts");
  }

  for (const row of rows) {
    if (row.sourceProfileId !== profile?.id) {
      issues.push(`requirementMapping: ${row.requirementId} sourceProfileId must be ${profile?.id}`);
    }
    if (!same(row.implementation, contractPointer)) {
      issues.push(`requirementMapping: ${row.requirementId} does not bind the leaf implementation contract`);
    }
  }

  return [...new Set(issues)];
}
