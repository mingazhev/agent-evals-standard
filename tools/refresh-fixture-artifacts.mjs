import { createHash, createPrivateKey, sign } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

// RFC 8032 test vector 1. This is public conformance material, never an
// operational secret. Operational reference artifacts deliberately use a
// separate trust graph and cannot be refreshed by this tool.
const ED25519_SEED = Buffer.from(
  "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
  "hex"
);
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const FIXTURE_PROFILE_ID = "fixture-signature-profile";
const FIXTURE_KEY_ID = "rfc8032-test-key-1";

function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}

function clone(value) {
  return structuredClone(value);
}

function sha256Canonical(value) {
  return `sha256:${createHash("sha256").update(Buffer.from(canonicalize(value), "utf8")).digest("hex")}`;
}

function fixturePrivateKey() {
  return createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, ED25519_SEED]),
    format: "der",
    type: "pkcs8"
  });
}

function refreshSignedArtifact(document) {
  const signature = document.signature;
  if (!document.schemaVersion || !signature) {
    throw new Error("expected a schemaVersion and signature");
  }
  if (signature.profileId !== FIXTURE_PROFILE_ID || signature.keyId !== FIXTURE_KEY_ID
    || signature.algorithm !== "Ed25519") {
    throw new Error("refusing to refresh a non-fixture signature");
  }
  if (typeof document.digest === "string") {
    const digestProjection = clone(document);
    delete digestProjection.digest;
    delete digestProjection.signature;
    document.digest = sha256Canonical(digestProjection);
  }
  const signingProjection = clone(document);
  delete signingProjection.signature.value;
  const message = Buffer.concat([
    Buffer.from(document.schemaVersion, "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalize(signingProjection), "utf8")
  ]);
  document.signature.value = sign(null, message, fixturePrivateKey()).toString("base64url");
}

function refreshEvidenceAttestation(document) {
  const attestation = document.attestation;
  if (!attestation || attestation.profileId !== FIXTURE_PROFILE_ID
    || attestation.keyId !== FIXTURE_KEY_ID || attestation.algorithm !== "Ed25519") {
    throw new Error("refusing to refresh a non-fixture evidence attestation");
  }
  const projection = clone(document);
  delete projection.attestation.value;
  const message = Buffer.concat([
    Buffer.from("agent-evals-evidence-artifact-1", "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalize(projection), "utf8")
  ]);
  document.attestation.value = sign(null, message, fixturePrivateKey()).toString("base64url");
}

const inputs = process.argv.slice(2);
if (inputs.length === 0) {
  process.stderr.write("usage: node tools/refresh-fixture-artifacts.mjs <json> [...json]\n");
  process.exit(2);
}

for (const input of inputs) {
  const absolute = path.resolve(input);
  const document = JSON.parse(await readFile(absolute, "utf8"));
  if (document.schemaVersion === "fixture-production-derived-evidence-bundle-1") {
    for (const entry of document.evidenceArtifacts ?? []) refreshEvidenceAttestation(entry.artifact);
  } else if (document.attestation) {
    refreshEvidenceAttestation(document);
  } else {
    for (const entry of document.evidenceManifest ?? []) {
      if (entry.attestation) refreshEvidenceAttestation(entry);
    }
    refreshSignedArtifact(document);
  }
  await writeFile(absolute, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  process.stdout.write(`${path.relative(process.cwd(), absolute)}\n`);
}
