import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { sourceReviewBindings } from "./source-evidence-review.mjs";

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
  "missingSourceReviewIds",
  "requirementEvidenceGapIds"
];

if (manifest.standardVersion !== "0.1.0") problems.push("source-evidence manifest standardVersion is not 0.1.0");
if (manifest.evidenceReadiness !== "ready") {
  problems.push(`evidenceReadiness is ${JSON.stringify(manifest.evidenceReadiness)}, not "ready"`);
}
for (const source of manifest.sources ?? []) {
  if (source.sourceReview?.status !== "maintainer_reviewed") {
    problems.push(`source ${source.id} has no completed accountable maintainer review`);
  }
  if (source.sourceReview?.reviewedLocator !== source.mutableLocator) {
    problems.push(`source ${source.id} maintainer review is not bound to its declared mutableLocator`);
  }
  if (!source.sourceReview?.reviewerIdentity) {
    problems.push(`source ${source.id} maintainer review has no accountable reviewer identity URI`);
  }
  if (!source.sourceReview?.reviewRecordLocator) {
    problems.push(`source ${source.id} maintainer review has no auditable review-record locator`);
  }
  if (source.sourceReview?.status === "maintainer_reviewed") {
    const expected = sourceReviewBindings(manifest, source);
    if (JSON.stringify([...(source.sourceReview.reviewedObservationIds ?? [])].sort()) !== JSON.stringify([...expected.observationIds].sort())) {
      problems.push(`source ${source.id} maintainer review is not bound to its exact observation IDs`);
    }
    if (JSON.stringify([...(source.sourceReview.reviewedRequirementIds ?? [])].sort()) !== JSON.stringify([...expected.requirementIds].sort())) {
      problems.push(`source ${source.id} maintainer review is not bound to its exact requirement IDs`);
    }
    if (JSON.stringify([...(source.sourceReview.reviewedCapabilityIds ?? [])].sort()) !== JSON.stringify([...expected.capabilityIds].sort())) {
      problems.push(`source ${source.id} maintainer review is not bound to its exact capability IDs`);
    }
    if (source.sourceReview.reviewedContentDigest !== expected.digest) {
      problems.push(`source ${source.id} maintainer review content digest must be ${expected.digest}`);
    }
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
  if (process.env.GITHUB_REF_TYPE === "tag") {
    const tagName = process.env.GITHUB_REF_NAME;
    if (tagName !== "v0.1.0") {
      problems.push(`release tag must be v0.1.0, found ${JSON.stringify(tagName)}`);
    } else {
      const tagType = git("cat-file", "-t", `refs/tags/${tagName}`);
      if (tagType !== "tag") problems.push(`release tag ${tagName} must be annotated, found Git object type ${tagType}`);
      const taggedCommit = git("rev-list", "-n", "1", `refs/tags/${tagName}`);
      if (taggedCommit !== commit) problems.push(`release tag ${tagName} resolves to ${taggedCommit}, not checked-out commit ${commit}`);
    }
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
