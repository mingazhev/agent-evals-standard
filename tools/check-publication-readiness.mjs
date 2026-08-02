import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, "$1"));

function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}

function selfDigest(document) {
  const projection = structuredClone(document);
  delete projection.digest;
  delete projection.signature;
  return `sha256:${createHash("sha256").update(Buffer.from(canonicalize(projection), "utf8")).digest("hex")}`;
}

function git(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

const manifest = JSON.parse(await readFile(path.join(root, "standard", "source-evidence-manifest.json"), "utf8"));
const problems = [];
const blockerFields = [
  "unverifiedSourceIds",
  "requirementEvidenceGapIds",
  "capabilityTargetValidationGapIds"
];

if (manifest.standardVersion !== "0.1.0") problems.push("source-evidence manifest standardVersion is not 0.1.0");
problems.push("publication is intentionally unavailable in 0.1.0 until normative detached target-validation and archive-verification assessment contracts are authenticated by release-authority trust roots outside the claimant manifest");
if (manifest.evidenceReadiness !== "ready") {
  problems.push(`evidenceReadiness is ${JSON.stringify(manifest.evidenceReadiness)}, not "ready"`);
}
for (const source of manifest.sources ?? []) {
  if (source.archive?.status === "verified") {
    problems.push(`source ${source.id} self-declares verified archive status, which 0.1.0 does not accept without offline byte resolution and an independently signed archive-verification assessment`);
  }
}
for (const capability of manifest.capabilityCoverage ?? []) {
  if (capability.targetPopulationValidation?.status === "independently_validated") {
    problems.push(`capability ${capability.capabilityId} self-declares independently_validated, which is unsupported in 0.1.0`);
  }
}
for (const field of blockerFields) {
  const ids = manifest.evidenceBlockers?.[field];
  if (!Array.isArray(ids)) problems.push(`evidenceBlockers.${field} is not an array`);
  else if (ids.length > 0) problems.push(`evidenceBlockers.${field} contains ${ids.length} blocker(s): ${ids.join(", ")}`);
}
const expectedDigest = selfDigest(manifest);
if (manifest.digest !== expectedDigest) {
  problems.push(`source-evidence manifest digest must be ${expectedDigest}, found ${manifest.digest}`);
}

let commit = "unknown";
try {
  commit = git("rev-parse", "--verify", "HEAD");
  const dirtyEntries = git("status", "--porcelain=v1", "--untracked-files=all");
  if (dirtyEntries) {
    problems.push("the publication gate must run on a clean checkout of the exact release commit");
  }
} catch (error) {
  problems.push(`cannot resolve and verify the exact Git commit: ${error.message}`);
}

if (problems.length > 0) {
  console.error(`Publication readiness blocked for commit ${commit}:`);
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}

console.log(`Publication readiness passed for exact commit ${commit}.`);
