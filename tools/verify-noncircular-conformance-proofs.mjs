import { createHash, createPublicKey, verify } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { conformanceProofAdapterAllowList } from "./conformance-proof-adapters.mjs";

const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(toolDirectory, "..");
const conformanceSchemaId = "urn:agent-evals-standard:schema:conformance-statement:1";
const proofSchemaId = `${conformanceSchemaId}#/$defs/conformanceProofPayload`;
const registrySchemaId = `${conformanceSchemaId}#/$defs/conformanceVerifierRegistry`;
const recordSchemaId = `${conformanceSchemaId}#/$defs/conformanceVerificationRecord`;
const adapterModuleAbsolute = path.join(toolDirectory, "conformance-proof-adapters.mjs");

export function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}

function clone(value) {
  return structuredClone(value);
}

function sha256Bytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function sha256Canonical(value) {
  return sha256Bytes(Buffer.from(canonicalize(value), "utf8"));
}

// JSON.parse accepts duplicate object members. Proof verification may not: two
// implementations could otherwise authenticate identical bytes but execute
// different effective inputs. This parser validates the I-JSON/JCS domain
// before handing the text to JSON.parse.
export function parseIJson(text, label = "JSON input") {
  let index = 0;
  const fail = (message) => { throw new Error(`${label}: ${message} at byte/character ${index}`); };
  const skipWhitespace = () => {
    while (index < text.length && [" ", "\t", "\r", "\n"].includes(text[index])) index += 1;
  };
  const validateScalarString = (value) => {
    for (let offset = 0; offset < value.length; offset += 1) {
      const unit = value.charCodeAt(offset);
      if (unit >= 0xd800 && unit <= 0xdbff) {
        const next = value.charCodeAt(offset + 1);
        if (!(next >= 0xdc00 && next <= 0xdfff)) fail("lone high surrogate is not I-JSON");
        offset += 1;
      } else if (unit >= 0xdc00 && unit <= 0xdfff) {
        fail("lone low surrogate is not I-JSON");
      }
    }
  };
  const parseString = () => {
    const start = index;
    if (text[index] !== "\"") fail("expected string");
    index += 1;
    let escaped = false;
    while (index < text.length) {
      const character = text[index];
      if (!escaped && character === "\"") {
        index += 1;
        let value;
        try { value = JSON.parse(text.slice(start, index)); }
        catch (error) { fail(`invalid JSON string (${error.message})`); }
        validateScalarString(value);
        return value;
      }
      if (!escaped && character.charCodeAt(0) < 0x20) fail("unescaped control character");
      if (!escaped && character === "\\") escaped = true;
      else escaped = false;
      index += 1;
    }
    fail("unterminated string");
  };
  const parseNumber = () => {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(index));
    if (!match) fail("invalid number");
    const token = match[0];
    index += token.length;
    const value = Number(token);
    if (!Number.isFinite(value)) fail("number is outside the finite binary64 JCS domain");
    if (!/[.eE]/.test(token) && !Number.isSafeInteger(value)) fail("integer is outside the interoperable I-JSON range");
  };
  const parseValue = () => {
    skipWhitespace();
    const character = text[index];
    if (character === "{") return parseObject();
    if (character === "[") return parseArray();
    if (character === "\"") { parseString(); return; }
    if (character === "-" || (character >= "0" && character <= "9")) { parseNumber(); return; }
    for (const literal of ["true", "false", "null"]) {
      if (text.startsWith(literal, index)) { index += literal.length; return; }
    }
    fail("invalid JSON value");
  };
  const parseObject = () => {
    index += 1;
    skipWhitespace();
    const keys = new Set();
    if (text[index] === "}") { index += 1; return; }
    while (index < text.length) {
      const key = parseString();
      if (keys.has(key)) fail(`duplicate member name ${JSON.stringify(key)}`);
      keys.add(key);
      skipWhitespace();
      if (text[index] !== ":") fail("expected colon");
      index += 1;
      parseValue();
      skipWhitespace();
      if (text[index] === "}") { index += 1; return; }
      if (text[index] !== ",") fail("expected comma or object end");
      index += 1;
      skipWhitespace();
    }
    fail("unterminated object");
  };
  const parseArray = () => {
    index += 1;
    skipWhitespace();
    if (text[index] === "]") { index += 1; return; }
    while (index < text.length) {
      parseValue();
      skipWhitespace();
      if (text[index] === "]") { index += 1; return; }
      if (text[index] !== ",") fail("expected comma or array end");
      index += 1;
      skipWhitespace();
    }
    fail("unterminated array");
  };
  parseValue();
  skipWhitespace();
  if (index !== text.length) fail("trailing non-whitespace data");
  return JSON.parse(text);
}

let ajvPromise;
async function schemaRegistry() {
  if (!ajvPromise) {
    ajvPromise = (async () => {
      const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: true });
      addFormats(ajv);
      const schemaDirectory = path.join(repositoryRoot, "schemas");
      for (const name of await readdir(schemaDirectory)) {
        if (!name.endsWith(".schema.json")) continue;
        const text = await readFile(path.join(schemaDirectory, name), "utf8");
        ajv.addSchema(parseIJson(text, name));
      }
      ajv.getSchema(conformanceSchemaId);
      return ajv;
    })();
  }
  return ajvPromise;
}

function containedPath(baseDirectory, candidate, allowedRoot) {
  const absolute = path.resolve(baseDirectory, candidate);
  const relative = path.relative(allowedRoot, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`path escapes allowed root: ${candidate}`);
  }
  return absolute;
}

async function resolveBytes(pointer, baseDirectory, allowedRoot, label, issues) {
  try {
    const absolute = containedPath(baseDirectory, pointer.uri, allowedRoot);
    const bytes = await readFile(absolute);
    const digest = sha256Bytes(bytes);
    if (pointer.digest !== digest) issues.push(`${label}: raw digest must be ${digest}`);
    if (pointer.byteLength !== bytes.length) issues.push(`${label}: byteLength must be ${bytes.length}`);
    return { absolute, bytes };
  } catch (error) {
    issues.push(`${label}: cannot resolve material bytes (${error.message})`);
    return null;
  }
}

async function resolveJson(pointer, baseDirectory, allowedRoot, label, issues) {
  const resolved = await resolveBytes(pointer, baseDirectory, allowedRoot, label, issues);
  if (!resolved) return null;
  try {
    return { ...resolved, document: parseIJson(resolved.bytes.toString("utf8"), resolved.absolute) };
  } catch (error) {
    issues.push(`${label}: ${error.message}`);
    return null;
  }
}

function schemaCheck(ajv, schemaId, document, label, issues) {
  const validate = ajv.getSchema(schemaId);
  if (!validate) {
    issues.push(`${label}: schema ${schemaId} is unavailable`);
    return false;
  }
  if (!validate(document)) {
    issues.push(`${label}: schema invalid (${ajv.errorsText(validate.errors)})`);
    return false;
  }
  return true;
}

function checkSelfDigest(document, label, issues) {
  const projection = clone(document);
  delete projection.digest;
  delete projection.signature;
  const expected = sha256Canonical(projection);
  if (document.digest !== expected) issues.push(`${label}: self digest must be ${expected}`);
}

function checkSignature(document, trusted, label, issues) {
  const signature = document.signature;
  const trust = trusted?.[signature?.keyId];
  if (!trust) {
    issues.push(`${label}: signature key ${String(signature?.keyId)} is not externally trusted`);
    return null;
  }
  if (signature.algorithm !== "Ed25519") issues.push(`${label}: only Ed25519 is supported by this reference runner`);
  if (signature.profileId !== trust.profileId) issues.push(`${label}: signature profile is not externally authorized`);
  const projection = clone(document);
  delete projection.signature.value;
  const message = Buffer.concat([
    Buffer.from(document.schemaVersion, "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalize(projection), "utf8")
  ]);
  try {
    if (!verify(null, message, trust.publicKey, Buffer.from(signature.value, "base64url"))) {
      issues.push(`${label}: signature is invalid`);
    }
  } catch (error) {
    issues.push(`${label}: signature verification failed (${error.message})`);
  }
  return trust;
}

function samePublicKey(left, right) {
  try {
    const leftDer = createPublicKey(left).export({ format: "der", type: "spki" });
    const rightDer = createPublicKey(right).export({ format: "der", type: "spki" });
    return leftDer.equals(rightDer);
  } catch {
    return false;
  }
}

function reportUnique(values, label, issues) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) issues.push(`${label}: duplicate ${value}`);
    seen.add(value);
  }
}

function exactSet(expected, actual, label, issues) {
  const left = [...expected].sort();
  const right = [...actual].sort();
  if (canonicalize(left) !== canonicalize(right)) {
    issues.push(`${label}: expected ${canonicalize(left)}, found ${canonicalize(right)}`);
  }
}

function samePointerIdentity(left, right) {
  return left?.id === right?.id && left?.version === right?.version && left?.digest === right?.digest;
}

async function authenticateRegistry(proof, proofDirectory, options, ajv, issues) {
  const resolved = await resolveJson(proof.verifierRegistry, proofDirectory, options.allowedRoot,
    "verifier registry", issues);
  if (!resolved) return null;
  const registry = resolved.document;
  schemaCheck(ajv, registrySchemaId, registry, "verifier registry", issues);
  if (registry.id !== proof.verifierRegistry.id || registry.version !== proof.verifierRegistry.version) {
    issues.push("verifier registry: pointer identity differs from material registry");
  }
  checkSelfDigest(registry, "verifier registry", issues);
  const authority = checkSignature(registry, options.trustedRegistryAuthorities,
    "verifier registry", issues);
  if (authority) {
    if (authority.issuerId !== registry.issuer.id) issues.push("verifier registry: issuer is not authorized by external trust configuration");
    if (authority.trustDomain !== registry.issuer.trustDomain) issues.push("verifier registry: issuer trust domain is not externally authorized");
    if ((options.claimantKeyIds ?? []).includes(registry.signature.keyId)
      || (options.claimantTrustDomains ?? []).includes(registry.issuer.trustDomain)
      || (options.claimantPublicKeys ?? []).some((key) => samePublicKey(authority.publicKey, key))) {
      issues.push("verifier registry: authority is not independent from claimant");
    }
  }
  if (!(Date.parse(registry.validFrom) <= Date.parse(options.validationTime)
    && Date.parse(options.validationTime) <= Date.parse(registry.expiresAt))) {
    issues.push("verifier registry: validation time is outside registry validity");
  }
  reportUnique((registry.entries ?? []).map((entry) => entry.id), "verifier registry entries", issues);
  return { ...resolved, registry, authority };
}

function bindRecordToAssertion(proof, assertion, record, label, issues) {
  const bindings = [
    ["proofAssertionId", assertion.id],
    ["scopeSliceId", assertion.scopeSliceId],
    ["target", assertion.target],
    ["targetId", assertion.targetId],
    ["targetSubjectDigest", assertion.targetSubjectDigest],
    ["dependencyManifestDigest", assertion.dependencyManifestDigest],
    ["requirementId", assertion.requirementId]
  ];
  for (const [field, expected] of bindings) {
    if (record[field] !== expected) issues.push(`${label}: ${field} differs from proof assertion`);
  }
  if (assertion.target !== proof.target || assertion.targetId !== proof.targetId
    || assertion.targetSubjectDigest !== proof.targetSubject.digest
    || assertion.dependencyManifestDigest !== proof.dependencyManifest.digest) {
    issues.push(`${label}: assertion differs from proof-set target binding`);
  }
}

async function resolveRecordInputs(record, recordDirectory, proof, entry, options, issues) {
  const label = `verification record ${record.id}`;
  const roles = (record.inputBindings ?? []).map((binding) => binding.role);
  reportUnique(roles, `${label} input roles`, issues);
  exactSet(entry.requiredInputRoles ?? [], roles, `${label} input roles`, issues);
  reportUnique((record.inputBindings ?? []).map((binding) => binding.id), `${label} input IDs`, issues);
  const documents = new Map();
  const bindings = new Map();
  for (const binding of record.inputBindings ?? []) {
    const resolved = await resolveJson(binding, recordDirectory, options.allowedRoot,
      `${label} input ${binding.role}`, issues);
    if (!resolved) continue;
    if (resolved.document?.id !== undefined && resolved.document.id !== binding.id) {
      issues.push(`${label} input ${binding.role}: document id differs from binding`);
    }
    if (resolved.document?.version !== undefined && resolved.document.version !== binding.version) {
      issues.push(`${label} input ${binding.role}: document version differs from binding`);
    }
    documents.set(binding.role, resolved.document);
    bindings.set(binding.role, binding);
  }
  const target = bindings.get("target_subject");
  if (target && !samePointerIdentity(target, proof.targetSubject)) {
    issues.push(`${label}: target_subject input differs from proof targetSubject`);
  }
  const applicability = bindings.get("applicability_contract");
  if (applicability && !samePointerIdentity(applicability, proof.applicabilityContract)) {
    issues.push(`${label}: applicability_contract input differs from proof applicabilityContract`);
  }
  return { documents, bindings };
}

function authorizeRecordActor(record, entry, registryState, options, label, issues) {
  const trust = checkSignature(record, options.trustedActors, label, issues);
  const authorized = (entry.authorizedActors ?? []).filter((actor) =>
    actor.actorId === record.actor.id
    && actor.keyId === record.signature.keyId
    && actor.trustDomain === record.actor.trustDomain);
  if (authorized.length !== 1) issues.push(`${label}: actor/key/trust-domain tuple is not uniquely authorized by registry entry`);
  if (trust) {
    if (trust.actorId !== record.actor.id) issues.push(`${label}: actor is not authorized by external trust configuration`);
    if (trust.trustDomain !== record.actor.trustDomain) issues.push(`${label}: actor trust domain is not externally authorized`);
  }
  if (record.signature.keyId === registryState.registry.signature.keyId
    || record.actor.trustDomain === registryState.registry.issuer.trustDomain
    || (trust?.publicKey && registryState.authority?.publicKey
      && samePublicKey(trust.publicKey, registryState.authority.publicKey))) {
    issues.push(`${label}: verifier/reviewer is not independent from verifier-registry authority`);
  }
  if ((options.claimantKeyIds ?? []).includes(record.signature.keyId)
    || (options.claimantTrustDomains ?? []).includes(record.actor.trustDomain)
    || (trust?.publicKey && (options.claimantPublicKeys ?? []).some((key) => samePublicKey(trust.publicKey, key)))) {
    issues.push(`${label}: verifier/reviewer is not independent from claimant`);
  }
  if (record.signature.signedAt !== record.executedAt) {
    issues.push(`${label}: signature time must equal executedAt`);
  }
}

async function replayAutomated(assertion, record, entry, registryState, inputState, options, label, issues) {
  const implementation = await resolveBytes(entry.implementation, path.dirname(registryState.absolute),
    options.allowedRoot, `${label} verifier implementation`, issues);
  const adapter = conformanceProofAdapterAllowList[entry.adapterId];
  if (!adapter) {
    issues.push(`${label}: adapter ${entry.adapterId} is not installed in the validator allow-list`);
    return null;
  }
  if (!implementation) return null;
  if (path.resolve(implementation.absolute) !== path.resolve(adapterModuleAbsolute)) {
    issues.push(`${label}: adapter implementation path is not the installed allow-listed module`);
  }
  if (entry.implementation.exportedFunction !== adapter.exportedFunction) {
    issues.push(`${label}: exported function is not the installed allow-listed function`);
  }
  try {
    const replay = await adapter.run({
      assertion: clone(assertion),
      record: clone(record),
      inputDocuments: inputState.documents
    });
    if (replay.result !== record.result) {
      issues.push(`${label}: replayed result ${replay.result} differs from recorded result ${record.result}`);
    }
    if (canonicalize(replay.findingIds) !== canonicalize(record.findingIds)) {
      issues.push(`${label}: replayed findingIds differ from recorded findingIds`);
    }
    return replay.result;
  } catch (error) {
    issues.push(`${label}: deterministic replay failed (${error.message})`);
    return null;
  }
}

function validateAccountableReview(assertion, record, entry, inputState, label, issues) {
  const expected = (entry.criteria ?? [])
    .filter((criterion) => criterion.requirementId === assertion.requirementId)
    .map((criterion) => criterion.id);
  const actual = (record.criteria ?? []).map((criterion) => criterion.criterionId);
  reportUnique(expected, `${label} registered criteria`, issues);
  reportUnique(actual, `${label} criterion results`, issues);
  exactSet(expected, actual, `${label} criterion coverage`, issues);
  const inputIds = new Set([...inputState.bindings.values()].map((binding) => binding.id));
  for (const criterion of record.criteria ?? []) {
    for (const evidenceId of criterion.evidenceInputIds ?? []) {
      if (!inputIds.has(evidenceId)) issues.push(`${label}: criterion ${criterion.criterionId} cites unknown input ${evidenceId}`);
    }
  }
  const results = (record.criteria ?? []).map((criterion) => criterion.result);
  const derived = results.includes("fail") ? "fail"
    : results.length === expected.length && results.every((result) => result === "pass") ? "pass"
      : "insufficient_evidence";
  const derivedFindingIds = (record.criteria ?? [])
    .filter((criterion) => criterion.result !== "pass")
    .map((criterion) => criterion.criterionId);
  if (record.result !== derived) issues.push(`${label}: criterion-derived result ${derived} differs from recorded result ${record.result}`);
  if (canonicalize(record.findingIds) !== canonicalize(derivedFindingIds)) {
    issues.push(`${label}: findingIds must equal the non-passing criterion IDs`);
  }
  return derived;
}

function permittedMethodsFor(verificationKind) {
  if (verificationKind === "schema" || verificationKind === "semantic") return ["automated_replay"];
  if (verificationKind === "manual_governance") return ["accountable_review"];
  return [];
}

function expectedVerificationContract(requirement) {
  return {
    criterionId: `${requirement.id}.complete`,
    strength: "complete_primary_definition",
    normativeReference: requirement.normativeReference,
    question: `Does the target satisfy every applicable REQUIRED obligation of ${requirement.id} at ${requirement.normativeReference} and every named semantic contract invoked there, and either satisfy or record an approved, scoped deviation for every applicable RECOMMENDED obligation?`,
    permittedMethods: permittedMethodsFor(requirement.verificationKind)
  };
}

function validateCanonicalCriteria(entry, inputState, label, issues) {
  const registry = inputState.documents.get("requirement_registry");
  const allowed = entry.allowedRequirementIds ?? [];
  const criteria = entry.criteria ?? [];
  reportUnique(criteria.map((criterion) => criterion.id), `${label} canonical criterion IDs`, issues);
  reportUnique(criteria.map((criterion) => criterion.requirementId), `${label} canonical criterion requirements`, issues);
  exactSet(allowed, criteria.map((criterion) => criterion.requirementId),
    `${label} canonical criterion coverage`, issues);

  for (const requirementId of allowed) {
    const matches = (registry?.requirements ?? []).filter((candidate) => candidate.id === requirementId);
    if (matches.length !== 1) {
      issues.push(`${label}: canonical criterion requirement ${requirementId} resolves ${matches.length} times`);
      continue;
    }
    const requirement = matches[0];
    const expectedContract = expectedVerificationContract(requirement);
    if (canonicalize(requirement.verificationContract) !== canonicalize(expectedContract)) {
      issues.push(`${label}: requirement-owned verification contract for ${requirementId} is not canonical`);
    }
    const criterionMatches = criteria.filter((criterion) => criterion.requirementId === requirementId);
    if (criterionMatches.length !== 1) continue;
    const expectedCriterion = {
      id: expectedContract.criterionId,
      requirementId,
      strength: expectedContract.strength,
      normativeReference: expectedContract.normativeReference,
      question: expectedContract.question
    };
    if (canonicalize(criterionMatches[0]) !== canonicalize(expectedCriterion)) {
      issues.push(`${label}: registry criterion for ${requirementId} differs from the requirement-owned complete criterion`);
    }
    if (!expectedContract.permittedMethods.includes(entry.method)) {
      issues.push(`${label}: method ${entry.method} is not permitted for ${requirementId}`);
    }
  }
}

function validateRequirementBinding(assertion, entry, inputState, label, issues) {
  const allowed = entry.allowedRequirementIds ?? [];
  const bindings = entry.requirementBindings ?? [];
  reportUnique(allowed, `${label} allowed requirement IDs`, issues);
  reportUnique(bindings.map((binding) => binding.requirementId), `${label} requirement bindings`, issues);
  exactSet(allowed, bindings.map((binding) => binding.requirementId),
    `${label} registered requirement coverage`, issues);
  const binding = bindings.find((candidate) => candidate.requirementId === assertion.requirementId);
  const registry = inputState.documents.get("requirement_registry");
  const entries = (registry?.requirements ?? []).filter((candidate) => candidate.id === assertion.requirementId);
  if (!binding || entries.length !== 1) {
    issues.push(`${label}: exact authenticated requirement entry does not resolve`);
    return;
  }
  const actual = sha256Canonical(entries[0]);
  if (binding.entryDigest !== actual) {
    issues.push(`${label}: registered requirement-entry digest must be ${actual}`);
  }
}

async function verifyAssertion(proof, assertion, proofDirectory, registryState, options, ajv, issues) {
  const label = `proof assertion ${assertion.id}`;
  const before = issues.length;
  const resolved = await resolveJson(assertion.verificationRecord, proofDirectory, options.allowedRoot,
    `${label} verification record`, issues);
  if (!resolved) return { assertionId: assertion.id, valid: false, derivedStatus: "insufficient_evidence" };
  const record = resolved.document;
  schemaCheck(ajv, recordSchemaId, record, `${label} verification record`, issues);
  if (record.id !== assertion.verificationRecord.id || record.version !== assertion.verificationRecord.version) {
    issues.push(`${label}: verification-record pointer identity differs from material record`);
  }
  checkSelfDigest(record, `${label} verification record`, issues);
  bindRecordToAssertion(proof, assertion, record, label, issues);
  if (record.registry.id !== registryState.registry.id
    || record.registry.version !== registryState.registry.version
    || record.registry.digest !== proof.verifierRegistry.digest) {
    issues.push(`${label}: record does not bind the authenticated raw verifier-registry bytes`);
  }
  const entries = (registryState.registry.entries ?? []).filter((entry) => entry.id === record.entryId);
  if (entries.length !== 1) {
    issues.push(`${label}: verifier-registry entry resolves ${entries.length} times`);
    return { assertionId: assertion.id, valid: false, derivedStatus: "insufficient_evidence", actorId: record.actor?.id, method: record.method };
  }
  const entry = entries[0];
  if (entry.method !== record.method) issues.push(`${label}: record method differs from registry entry`);
  if (!(entry.allowedRequirementIds ?? []).includes(assertion.requirementId)) {
    issues.push(`${label}: registry entry is not authorized for requirement ${assertion.requirementId}`);
  }
  authorizeRecordActor(record, entry, registryState, options, `${label} verification record`, issues);
  if (!(Date.parse(registryState.registry.validFrom) <= Date.parse(record.executedAt)
    && Date.parse(record.executedAt) <= Date.parse(registryState.registry.expiresAt))) {
    issues.push(`${label}: execution time is outside verifier-registry validity`);
  }
  const inputState = await resolveRecordInputs(record, path.dirname(resolved.absolute), proof, entry, options, issues);
  validateRequirementBinding(assertion, entry, inputState, label, issues);
  validateCanonicalCriteria(entry, inputState, label, issues);
  let derivedStatus = "insufficient_evidence";
  if (record.method === "automated_replay") {
    derivedStatus = await replayAutomated(assertion, record, entry, registryState, inputState,
      options, label, issues) ?? "insufficient_evidence";
  } else if (record.method === "accountable_review") {
    derivedStatus = validateAccountableReview(assertion, record, entry, inputState, label, issues);
  }
  return {
    assertionId: assertion.id,
    valid: issues.length === before,
    derivedStatus,
    actorId: record.actor?.id,
    method: record.method
  };
}

/**
 * Verify a material conformance requirement proof-set.
 *
 * `proofAuthenticated` is deliberately mandatory: the proof-set itself is an
 * evidence payload and must first be authenticated by its evidence-artifact
 * wrapper. Registry-authority and actor keys are supplied by trust policy, not
 * discovered from the proof. The function derives each assertion status; it
 * never accepts a status declared by the proof-set or verification record.
 */
export async function verifyConformanceProofPayload(proof, proofAbsolute, options = {}) {
  const issues = [];
  const effective = {
    allowedRoot: path.resolve(options.allowedRoot ?? repositoryRoot),
    validationTime: options.validationTime ?? new Date().toISOString(),
    trustedRegistryAuthorities: options.trustedRegistryAuthorities ?? {},
    trustedActors: options.trustedActors ?? {},
    claimantKeyIds: options.claimantKeyIds ?? [],
    claimantTrustDomains: options.claimantTrustDomains ?? [],
    claimantPublicKeys: options.claimantPublicKeys ?? [],
    proofAuthenticated: options.proofAuthenticated === true
  };
  if (!effective.proofAuthenticated) {
    issues.push("proof-set bytes were not authenticated by their evidence-artifact wrapper");
  }
  const ajv = await schemaRegistry();
  schemaCheck(ajv, proofSchemaId, proof, "proof-set", issues);
  reportUnique((proof.proofAssertions ?? []).map((assertion) => assertion.id), "proof assertions", issues);
  const proofDirectory = path.dirname(path.resolve(proofAbsolute));
  const registryState = await authenticateRegistry(proof, proofDirectory, effective, ajv, issues);
  const results = [];
  if (registryState) {
    for (const assertion of proof.proofAssertions ?? []) {
      results.push(await verifyAssertion(proof, assertion, proofDirectory, registryState, effective, ajv, issues));
    }
  }
  return { valid: issues.length === 0, issues, results };
}

async function loadTrustMap(entries, vectorDirectory) {
  const result = {};
  for (const entry of entries ?? []) {
    const { keyId, publicKey, ...metadata } = entry;
    result[keyId] = {
      ...metadata,
      publicKey: await readFile(containedPath(vectorDirectory, publicKey, repositoryRoot), "utf8")
    };
  }
  return result;
}

async function runVectors(vectorPath) {
  const vectorAbsolute = path.resolve(vectorPath);
  const vectorDirectory = path.dirname(vectorAbsolute);
  const vectors = parseIJson(await readFile(vectorAbsolute, "utf8"), vectorAbsolute);
  let passed = 0;
  for (const vector of vectors.vectors ?? []) {
    const proofAbsolute = containedPath(vectorDirectory, vector.proof, repositoryRoot);
    const proof = parseIJson(await readFile(proofAbsolute, "utf8"), proofAbsolute);
    const trustedRegistryAuthorities = await loadTrustMap(vector.trust?.registryAuthorities, vectorDirectory);
    const trustedActors = await loadTrustMap(vector.trust?.actors, vectorDirectory);
    const claimantPublicKeys = [];
    for (const keyPath of vector.claimantPublicKeys ?? []) {
      claimantPublicKeys.push(await readFile(containedPath(vectorDirectory, keyPath, repositoryRoot), "utf8"));
    }
    const result = await verifyConformanceProofPayload(proof, proofAbsolute, {
      allowedRoot: repositoryRoot,
      validationTime: vector.validationTime,
      proofAuthenticated: vector.proofAuthenticated,
      claimantKeyIds: vector.claimantKeyIds,
      claimantTrustDomains: vector.claimantTrustDomains,
      claimantPublicKeys,
      trustedRegistryAuthorities,
      trustedActors
    });
    const errorText = result.issues.join("\n");
    const expectedErrorMatches = !vector.expectedError || errorText.includes(vector.expectedError);
    const okay = result.valid === vector.expectedValid && expectedErrorMatches;
    if (okay) {
      passed += 1;
      process.stdout.write(`PASS ${vector.id}\n`);
    } else {
      process.stderr.write(`FAIL ${vector.id}: expected valid=${vector.expectedValid}`
        + `${vector.expectedError ? ` containing ${JSON.stringify(vector.expectedError)}` : ""}; got valid=${result.valid}\n`);
      for (const issue of result.issues) process.stderr.write(`  - ${issue}\n`);
    }
  }
  process.stdout.write(`Non-circular conformance-proof vectors: ${passed}/${vectors.vectors.length} passed.\n`);
  if (passed !== vectors.vectors.length) process.exitCode = 1;
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const vectorPath = process.argv[2]
    ?? path.join(repositoryRoot, "conformance", "fixtures", "noncircular-proof-vectors.json");
  await runVectors(vectorPath);
}
