import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { checkProductionDerivedInput } from "./validate-production-derived-input.mjs";

const FIXTURE_SEEDS = Object.freeze({
  provenance: "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
  data_owner: "0f0e0d0c0b0a09080706050403020100112233445566778899aabbccddeeff00",
  privacy: "c5aa8df43f9f837bedb7442f31dcb7b166d38535076f094b85ce3a2e0b4458f7",
  isolation: "8a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c",
  scheduler: "4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb"
});
const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const SOURCE_ROOT = path.resolve("conformance/fixtures/production-derived-authority");
const MACHINE_ROOT = path.resolve("conformance/fixtures/machine-contracts-v1/positive");
const COMMON_ROOT = path.resolve(".");
const TEMP_PREFIX = ".agent-evals-production-derived-authority-";

function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function sha256Canonical(value) {
  return sha256(Buffer.from(canonicalize(value), "utf8"));
}

function preRunProjection(preRun) {
  const projection = structuredClone(preRun);
  delete projection.evaluationControlBindings;
  delete projection.digest;
  delete projection.signature;
  return projection;
}

function rebaseLocators(value, sourceOwner, targetOwner) {
  if (!value || typeof value !== "object") return;
  if (!Array.isArray(value) && value.locator?.kind === "repository_relative"
    && value.locator?.base === "binding_document") {
    const target = path.resolve(sourceOwner, value.locator.path);
    value.locator.path = path.relative(targetOwner, target).replaceAll("\\", "/");
  }
  for (const nested of Array.isArray(value) ? value : Object.values(value)) {
    rebaseLocators(nested, sourceOwner, targetOwner);
  }
}

async function rebuildEvaluationControlChain(directory, preRun) {
  const focusedPreRun = await readJson(path.join(MACHINE_ROOT, "stage-pre-run-manifest.json"));
  const controls = await readJson(path.join(MACHINE_ROOT, "control-bindings.json"));
  preRun.suite = structuredClone(focusedPreRun.suite);
  preRun.caseSet = structuredClone(focusedPreRun.caseSet);
  rebaseLocators(preRun.suite, MACHINE_ROOT, directory);
  rebaseLocators(preRun.caseSet, MACHINE_ROOT, directory);
  preRun.caseProfiles = focusedPreRun.caseProfiles.map((profile) => ({
    ...structuredClone(profile),
    bindingUse: "diagnostic_only"
  }));
  for (const cell of preRun.scheduledCells) cell.caseId = preRun.caseSet[0].id;

  rebaseLocators(controls, MACHINE_ROOT, directory);
  const preRunStage = controls.stageBindings.find((entry) => entry.stage === "pre_run");
  preRunStage.subject = {
    id: preRun.id,
    artifactVersion: "0.1.0",
    schemaId: "urn:agent-evals-standard:schema:pre-run-manifest:1",
    identityProjection: "full_document_without_evaluation_control_bindings_digest_signature",
    digest: sha256Canonical(preRunProjection(preRun))
  };
  preRunStage.sealedAt = preRun.sealedAt;
  const controlBytes = await writeJson(path.join(directory, "evaluation-control-bindings.json"), controls);

  const binding = structuredClone(focusedPreRun.evaluationControlBindings);
  rebaseLocators(binding, MACHINE_ROOT, directory);
  const controlDigest = sha256(controlBytes);
  binding.uri = `artifact:${controlDigest}`;
  binding.digest = controlDigest;
  binding.byteLength = controlBytes.length;
  binding.locator.path = "evaluation-control-bindings.json";
  preRun.evaluationControlBindings = binding;
}

function privateKey(seedName) {
  return createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, Buffer.from(FIXTURE_SEEDS[seedName], "hex")]),
    format: "der",
    type: "pkcs8"
  });
}

async function readJson(target) {
  return JSON.parse(await readFile(target, "utf8"));
}

async function writeJson(target, value, pretty = true) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, pretty ? 2 : 0)}\n`, "utf8");
  await writeFile(target, bytes);
  return bytes;
}

function signArtifact(artifact, seedName, keyId = artifact.attestation.keyId) {
  artifact.attestation.keyId = keyId;
  const projection = structuredClone(artifact);
  delete projection.attestation.value;
  const message = Buffer.concat([
    Buffer.from("agent-evals-evidence-artifact-1", "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalize(projection), "utf8")
  ]);
  artifact.attestation.value = sign(null, message, privateKey(seedName)).toString("base64url");
}

function sealPreRun(preRun) {
  const digestProjection = structuredClone(preRun);
  delete digestProjection.digest;
  delete digestProjection.signature;
  preRun.digest = sha256Canonical(digestProjection);
  preRun.signature ??= {
    profileId: "fixture-independent-scheduler-profile",
    algorithm: "Ed25519",
    keyId: "rfc8032-test-key-2-scheduler",
    signedAt: preRun.sealedAt,
    value: ""
  };
  const signingProjection = structuredClone(preRun);
  delete signingProjection.signature.value;
  const message = Buffer.concat([
    Buffer.from(preRun.schemaVersion, "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalize(signingProjection), "utf8")
  ]);
  preRun.signature.value = sign(null, message, privateKey("scheduler")).toString("base64url");
}

function authenticatePreRun(preRun) {
  if (preRun.signature?.profileId !== "fixture-independent-scheduler-profile"
    || preRun.signature?.algorithm !== "Ed25519"
    || preRun.signature?.keyId !== "rfc8032-test-key-2-scheduler") {
    return "unrecognized pre-run signing authority";
  }
  const digestProjection = structuredClone(preRun);
  delete digestProjection.digest;
  delete digestProjection.signature;
  if (preRun.digest !== sha256Canonical(digestProjection)) return "pre-run self digest mismatch";
  const signingProjection = structuredClone(preRun);
  delete signingProjection.signature.value;
  const message = Buffer.concat([
    Buffer.from(preRun.schemaVersion, "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalize(signingProjection), "utf8")
  ]);
  const publicKey = createPublicKey(privateKey("scheduler"));
  return verify(null, message, publicKey, Buffer.from(preRun.signature.value, "base64url"))
    ? null : "pre-run Ed25519 verification failed";
}

function proofAt(environment, kind) {
  const contract = environment.productionDerivedInput;
  return {
    production_input_provenance: contract.provenance,
    data_owner_authorization: contract.dataOwnerAuthorization.proof,
    redaction_verification: contract.redactionVerification.proof,
    reidentification_assessment: contract.reidentificationAssessment.proof,
    production_path_isolation: contract.productionIsolationVerification.proof
  }[kind];
}

async function resealEnvironment(directory, environment, preRun) {
  const projection = structuredClone(environment);
  delete projection.digest;
  environment.digest = sha256Canonical(projection);
  preRun.arms[0].environment = { id: environment.id, version: environment.version, digest: environment.digest };
  await rebuildEvaluationControlChain(directory, preRun);
  sealPreRun(preRun);
  await writeJson(path.join(directory, "environment.json"), environment);
  await writeJson(path.join(directory, "pre-run.json"), preRun);
}

async function resealAuthorityContract(directory, authorityContract, bundle, environment, preRun) {
  const projection = structuredClone(authorityContract);
  delete projection.digest;
  authorityContract.digest = sha256Canonical(projection);
  const bytes = await writeJson(path.join(directory, "authority-contract.json"), authorityContract);
  const digest = sha256(bytes);
  const pointer = {
    id: authorityContract.id,
    version: authorityContract.version,
    schemaId: "urn:agent-evals-standard:schema:production-derived-authority-contract:1",
    uri: `artifact:${digest}`,
    digest,
    byteLength: bytes.length
  };
  environment.productionDerivedInput.authorityContract = pointer;
  bundle.authorityContract = { ...pointer, payloadPath: "authority-contract.json" };
  await writeJson(path.join(directory, "evidence-bundle.json"), bundle);
  await resealEnvironment(directory, environment, preRun);
}

async function resealPayload(directory, kind, payload, bundle, environment, preRun, seedName, keyId) {
  const entry = bundle.evidenceArtifacts.find((candidate) => candidate.proofKind === kind);
  const bytes = await writeJson(path.join(directory, entry.payloadPath), payload, false);
  const digest = sha256(bytes);
  entry.artifact.digest = digest;
  entry.artifact.uri = `artifact:${digest}`;
  entry.artifact.byteLength = bytes.length;
  signArtifact(entry.artifact, seedName, keyId);
  const proof = proofAt(environment, kind);
  proof.evidence = { id: entry.artifact.id, uri: entry.artifact.uri, digest: entry.artifact.digest };
  await writeJson(path.join(directory, "evidence-bundle.json"), bundle);
  await resealEnvironment(directory, environment, preRun);
}

async function mutate(directory, mutation) {
  if (mutation === "none") return;
  const environment = await readJson(path.join(directory, "environment.json"));
  const preRun = await readJson(path.join(directory, "pre-run.json"));
  const bundle = await readJson(path.join(directory, "evidence-bundle.json"));
  const authorityContract = await readJson(path.join(directory, "authority-contract.json"));

  if (mutation === "unregistered_verifier") {
    const unregistered = `sha256:${"a".repeat(64)}`;
    for (const policy of authorityContract.proofPolicies) policy.verifier.digest = unregistered;
    for (const kind of Object.keys({
      production_input_provenance: 1,
      data_owner_authorization: 1,
      redaction_verification: 1,
      reidentification_assessment: 1,
      production_path_isolation: 1
    })) proofAt(environment, kind).verifier.digest = unregistered;
    await resealAuthorityContract(directory, authorityContract, bundle, environment, preRun);
    return;
  }
  if (mutation === "self_named_producer") {
    const entry = bundle.evidenceArtifacts.find((candidate) => candidate.proofKind === "data_owner_authorization");
    entry.artifact.producer.id = "self-named-attacker";
    signArtifact(entry.artifact, "data_owner");
    await writeJson(path.join(directory, "evidence-bundle.json"), bundle);
    return;
  }
  if (mutation === "reused_authority_boundaries") {
    const owner = authorityContract.authorities.find((entry) => entry.authorityId === "production-data-owner-authority");
    const privacy = authorityContract.authorities.find((entry) => entry.authorityId === "production-privacy-authority");
    privacy.producer.id = owner.producer.id;
    privacy.producer.trustDomain = owner.producer.trustDomain;
    privacy.attestation = structuredClone(owner.attestation);
    await resealAuthorityContract(directory, authorityContract, bundle, environment, preRun);
    return;
  }
  if (mutation === "authority_contract_tamper") {
    authorityContract.authorities[0].producer.id = "substituted-after-seal";
    await writeJson(path.join(directory, "authority-contract.json"), authorityContract);
    return;
  }
  if (mutation === "unsealed_environment") {
    preRun.arms[0].environment.digest = `sha256:${"f".repeat(64)}`;
    await rebuildEvaluationControlChain(directory, preRun);
    sealPreRun(preRun);
    await writeJson(path.join(directory, "pre-run.json"), preRun);
    return;
  }
  if (mutation === "wrong_authority_key") {
    const entry = bundle.evidenceArtifacts.find((candidate) => candidate.proofKind === "data_owner_authorization");
    signArtifact(entry.artifact, "privacy", "production-privacy-key");
    await writeJson(path.join(directory, "evidence-bundle.json"), bundle);
    return;
  }

  const mutationByName = {
    provenance_cutoff_mismatch: {
      kind: "production_input_provenance",
      field: "sourceCutoff",
      value: "2026-07-31T23:00:00Z",
      seed: "provenance"
    },
    provenance_transformation_mismatch: {
      kind: "production_input_provenance",
      field: "transformationDigest",
      value: `sha256:${"e".repeat(64)}`,
      seed: "provenance"
    },
    authorization_owner_mismatch: {
      kind: "data_owner_authorization",
      field: "ownerId",
      value: "self-declared-owner",
      seed: "data_owner"
    },
    redaction_secret_finding: {
      kind: "redaction_verification",
      field: "secretsFound",
      value: 1,
      seed: "privacy"
    },
    excess_reidentification_risk: {
      kind: "reidentification_assessment",
      field: "residualRiskScore",
      value: 0.8,
      seed: "privacy"
    },
    production_read_path: {
      kind: "production_path_isolation",
      field: "productionReadPathAvailable",
      value: true,
      seed: "isolation"
    }
  };
  const selected = mutationByName[mutation];
  if (!selected) throw new Error(`unknown mutation ${mutation}`);
  const entry = bundle.evidenceArtifacts.find((candidate) => candidate.proofKind === selected.kind);
  const payload = await readJson(path.join(directory, entry.payloadPath));
  payload[selected.field] = selected.value;
  await resealPayload(directory, selected.kind, payload, bundle, environment, preRun, selected.seed);
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
for (const schemaPath of [
  "schemas/signature-profile.schema.json",
  "schemas/evidence-artifact.schema.json",
  "schemas/production-derived-authority-contract.schema.json",
  "schemas/verified-machine-contract.schema.json",
  "schemas/pre-run-manifest.schema.json",
  "schemas/environment-contract.schema.json"
]) {
  ajv.addSchema(await readJson(path.resolve(schemaPath)));
}
const validateEnvironment = ajv.getSchema("urn:agent-evals-standard:schema:environment-contract:1");
const validateEvidenceArtifact = ajv.getSchema("urn:agent-evals-standard:schema:evidence-artifact:1");
const validateAuthorityContract = ajv.getSchema("urn:agent-evals-standard:schema:production-derived-authority-contract:1");
const validatePreRunManifest = ajv.getSchema("urn:agent-evals-standard:schema:pre-run-manifest:1");
const vectors = await readJson(path.join(SOURCE_ROOT, "vectors.json"));
const verifierPath = path.resolve("profiles/repo-change-v1/verify-production-derived.mjs");
const verifierDigest = sha256(await readFile(verifierPath));
let passed = 0;

if (process.argv.includes("--refresh-source")) {
  const sourceEnvironment = await readJson(path.join(SOURCE_ROOT, vectors.environmentPath));
  const sourcePreRun = await readJson(path.join(SOURCE_ROOT, vectors.relatedPath));
  sourcePreRun.arms[0].environment = {
    id: sourceEnvironment.id,
    version: sourceEnvironment.version,
    digest: sourceEnvironment.digest
  };
  await rebuildEvaluationControlChain(SOURCE_ROOT, sourcePreRun);
  sealPreRun(sourcePreRun);
  await writeJson(path.join(SOURCE_ROOT, vectors.relatedPath), sourcePreRun);
}

for (const vector of vectors.cases) {
  const directory = await mkdtemp(path.join(COMMON_ROOT, TEMP_PREFIX));
  try {
    await cp(SOURCE_ROOT, directory, { recursive: true });
    await mutate(directory, vector.mutation);
    const environment = await readJson(path.join(directory, vectors.environmentPath));
    const issues = [];
    if (!validateEnvironment(environment)) {
      for (const error of validateEnvironment.errors ?? []) {
        issues.push(`environment schema: ${error.instancePath || "/"} ${error.message}`);
      }
    }
    const digestProjection = structuredClone(environment);
    delete digestProjection.digest;
    const expectedDigest = sha256Canonical(digestProjection);
    if (environment.digest !== expectedDigest) issues.push(`environment self digest must be ${expectedDigest}`);
    await checkProductionDerivedInput(environment, path.join(directory, vectors.environmentPath), issues, {
      relatedPath: vectors.relatedPath,
      evidencePath: vectors.evidencePath
    }, {
      root: COMMON_ROOT,
      fixtureDirectory: directory,
      validateEvidenceArtifact,
      validateProductionDerivedAuthorityContract: validateAuthorityContract,
      validatePreRunManifest,
      authenticatePreRun,
      productionDerivedVerifierRegistry: [{
        id: "repo-change-production-derived-verifier",
        version: "0.1.0",
        path: path.relative(COMMON_ROOT, verifierPath),
        digest: verifierDigest
      }]
    });
    const valid = issues.length === 0;
    const expectedFound = vector.valid || issues.some((issue) => issue.includes(vector.expectedError));
    if (valid !== vector.valid || !expectedFound) {
      process.stderr.write(`${vector.id}: expected valid=${vector.valid}, got ${valid}\n${issues.join("\n")}\n`);
      process.exitCode = 1;
    } else {
      passed += 1;
      process.stdout.write(`PASS ${vector.id}\n`);
    }
  } finally {
    const relative = path.relative(COMMON_ROOT, path.resolve(directory));
    if (!relative.startsWith("..") && !path.isAbsolute(relative)
      && path.basename(directory).startsWith(TEMP_PREFIX)) {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
process.stdout.write(`${passed}/${vectors.cases.length} production-derived authority vectors passed\n`);
