import { readFile, readdir } from "node:fs/promises";
import { verify } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { canonicalize, sha256Canonical } from "./verify-material-integrity.mjs";
import {
  enforcementReceiptBindingIssues,
  governanceResolutionBindingIssues,
  governanceLedgerEventHash,
  governanceLedgerIssues
} from "./governance-enforcement.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const load = async (name) => JSON.parse(await readFile(path.join(root, name), "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: true });
addFormats(ajv);
for (const name of await readdir(path.join(root, "schemas"))) {
  if (name.endsWith(".schema.json")) ajv.addSchema(await load(`schemas/${name}`));
}
const receiptSchema = ajv.getSchema("urn:agent-evals-standard:schema:enforcement-receipt:1");
const eventSchema = ajv.getSchema("urn:agent-evals-standard:schema:escalation-event:1");
const resolutionSchema = ajv.getSchema("urn:agent-evals-standard:schema:governance-resolution:1");
const registrySchema = ajv.getSchema("urn:agent-evals-standard:schema:escalation-event-registry:1");
const registry = await load("standard/escalation-event-registry.json");
const event = await load("conformance/fixtures/positive/open-escalation.json");
const stop = await load("conformance/fixtures/positive/enforcement-receipt.json");
const resolution = await load("conformance/fixtures/positive/governance-resolution.json");
const failures = [];
let count = 0;
function expect(id, passed, detail = "unexpected verdict") {
  count += 1;
  if (!passed) failures.push(`${id}: ${detail}`);
}
expect("registry-schema", registrySchema(registry), ajv.errorsText(registrySchema.errors));
const registryProjection = structuredClone(registry);
delete registryProjection.digest;
expect("registry-digest", registry.digest === sha256Canonical(registryProjection));
expect("legacy-stop-schema", receiptSchema(stop), ajv.errorsText(receiptSchema.errors));
expect("legacy-stop-binding", (await enforcementReceiptBindingIssues(stop, { event })).length === 0);

// These focused vectors supply independently selected authenticated inputs.
// Cryptographic and append-only authentication remain the caller's prerequisite;
// callbacks below model the evaluator's external authorization/condition registry.
resolution.scope = event.affectedScope.scopeDigest;
const resume = structuredClone(stop);
delete resume.stopAction;
delete resume.scopeAction;
Object.assign(resume, {
  id: "resume-receipt-fixture-1",
  resumeAction: "resume_approved_scope",
  sourceResolutionId: resolution.eventId,
  sourceResolutionDigest: sha256Canonical(resolution),
  requestedAt: "2026-08-01T00:00:20Z",
  startedAt: "2026-08-01T00:00:21Z",
  completedAt: "2026-08-01T00:00:22Z",
  resumeConditionResults: event.resumeConditions.map((condition) => ({
    condition, status: "pass", evidenceIds: ["independent-resume-condition-proof"]
  })),
  evidence: ["independent-resume-condition-proof"]
});
const trustedResolutionDigest = sha256Canonical(resolution);
const trustedConditions = new Map(resume.resumeConditionResults.map((result) => [result.condition, canonicalize(result)]));
const context = {
  event, resolution,
  verifyResolution: (value) => sha256Canonical(value) === trustedResolutionDigest,
  authorizeResume: (value) => value.executor.id === stop.executor.id
    && canonicalize(value.affectedScope) === canonicalize(event.affectedScope),
  verifyResumeCondition: (result) => trustedConditions.get(result.condition) === canonicalize(result)
};
expect("resume-schema", receiptSchema(resume), ajv.errorsText(receiptSchema.errors));
expect("resume-binding", (await enforcementReceiptBindingIssues(resume, context)).length === 0);

const resumeMutations = [
  ["mixed-stop-resume", (value) => { value.stopAction = stop.stopAction; }, "action forms"],
  ["wrong-event", (value) => { value.sourceEventId = "different-event"; }, "sourceEventId"],
  ["wrong-resolution-digest", (value) => { value.sourceResolutionDigest = `sha256:${"0".repeat(64)}`; }, "resolution identity"],
  ["wrong-scope", (value) => { value.affectedScope.scopeDigest = `sha256:${"0".repeat(64)}`; }, "affectedScope"],
  ["early-resume", (value) => { value.requestedAt = "2026-08-01T00:00:17Z"; }, "precede"],
  ["missing-condition", (value) => { value.resumeConditionResults = []; }, "exactly once"],
  ["duplicate-condition", (value) => { value.resumeConditionResults.push(structuredClone(value.resumeConditionResults[0])); }, "exactly once"],
  ["extra-condition", (value) => { value.resumeConditionResults.push({ condition: "unsealed condition", status: "pass", evidenceIds: value.evidence }); }, "exactly once"],
  ["failed-condition", (value) => { value.resumeConditionResults[0].status = "fail"; }, "verified passing"],
  ["unbound-evidence", (value) => { value.evidence = []; }, "verified passing"],
  ["unauthorized-executor", (value) => { value.executor.id = "claimant"; }, "authorized to resume"]
];
for (const [id, mutate, expected] of resumeMutations) {
  const value = structuredClone(resume);
  mutate(value);
  const issues = await enforcementReceiptBindingIssues(value, context);
  expect(id, issues.some((issue) => issue.includes(expected)), issues.join("; "));
}
for (const field of ["verifyResolution", "authorizeResume", "verifyResumeCondition"]) {
  const value = { ...context };
  delete value[field];
  expect(`missing-${field}`, (await enforcementReceiptBindingIssues(resume, value)).length > 0);
}
for (const [id, mutate] of [
  ["unclosed-resolution", (value) => { value.action = "narrow"; }],
  ["resolution-status-swap", (value) => { value.governanceStatusId = "manual_review_required"; }],
  ["expired-resolution", (value) => { value.expiresAt = "2026-08-01T00:00:22Z"; }]
]) {
  const value = structuredClone(resolution);
  mutate(value);
  const receipt = { ...resume, sourceResolutionDigest: sha256Canonical(value) };
  expect(id, (await enforcementReceiptBindingIssues(receipt, { ...context, resolution: value })).length > 0);
}
const mixed = { ...resume, stopAction: stop.stopAction };
expect("schema-rejects-mixed-actions", !receiptSchema(mixed));
const missingResolution = structuredClone(resume);
delete missingResolution.sourceResolutionDigest;
expect("schema-requires-resolution-binding", !receiptSchema(missingResolution));

for (const [eventId, role] of [
  ["dataOwnerReviewRequired", "data_owner"],
  ["riskAcceptanceRequired", "risk_acceptance_authority"]
]) {
  const tuple = registry.events.find((entry) => entry.eventId === eventId);
  const source = { ...structuredClone(event), ...tuple };
  source.enforcementRequest.action = source.stopAction;
  const receipt = { ...structuredClone(stop), sourceEventDigest: sha256Canonical(source), stopAction: source.stopAction, scopeAction: source.scopeAction };
  const closing = {
    ...structuredClone(resolution), sourceEventType: eventId,
    sourceEventHash: sha256Canonical(source), governanceStatusId: source.governanceStatus,
    actor: { id: `authorized-${role}`, role }
  };
  const authorizedDigest = sha256Canonical(closing);
  const closureContext = { event: source, stopReceipt: receipt, authorizeResolution: (value) => sha256Canonical(value) === authorizedDigest };
  expect(`${eventId}-event-schema`, eventSchema(source), ajv.errorsText(eventSchema.errors));
  expect(`${eventId}-resolution-schema`, resolutionSchema(closing), ajv.errorsText(resolutionSchema.errors));
  const issues = await governanceResolutionBindingIssues(closing, closureContext);
  expect(`${eventId}-authorized-resolution`, issues.length === 0, issues.join("; "));
  expect(`${eventId}-no-authority`, (await governanceResolutionBindingIssues(closing, { ...closureContext, authorizeResolution: undefined })).length > 0);
  for (const [name, mutate] of [
    ["wrong-status", (value) => { value.governanceStatusId = "manual_review_required"; }],
    ["wrong-authority-role", (value) => { value.actor.role = "status_resolver"; }],
    ["waiver", (value) => { value.action = "waive"; value.expiresAt = "2026-09-01T00:00:00Z"; }]
  ]) {
    const value = structuredClone(closing);
    mutate(value);
    expect(`${eventId}-${name}-schema`, !resolutionSchema(value));
    expect(`${eventId}-${name}-binding`, (await governanceResolutionBindingIssues(value, closureContext)).length > 0);
  }
  const wrongSource = { ...closing, sourceEventType: "measurementBoundaryCompromise" };
  expect(`${eventId}-cannot-relabel-source`, !resolutionSchema(wrongSource));
}

const ledger = await load("conformance/fixtures/positive/governance-resolution-ledger.json");
const fixtureKey = await readFile(path.join(root, "conformance/fixtures/keys/rfc8032-test-key-1.pem"), "utf8");
function fixtureSignatureValid(value, bytes) {
  if (value.signature?.profileId !== "fixture-signature-profile"
    || value.signature?.algorithm !== "Ed25519"
    || value.signature?.keyId !== "rfc8032-test-key-1") return false;
  if (!bytes) {
    const projection = structuredClone(value);
    delete projection.signature.value;
    bytes = Buffer.concat([Buffer.from(`${value.schemaVersion}\0`), Buffer.from(canonicalize(projection))]);
  }
  return verify(null, bytes, fixtureKey, Buffer.from(value.signature.value, "base64url"));
}
const payloadSchemas = {
  escalation: eventSchema,
  enforcement_receipt: receiptSchema,
  resolution: resolutionSchema,
  assurance_observation: ajv.getSchema("urn:agent-evals-standard:schema:assurance-observation:1")
};
const ledgerContext = {
  verifyLedgerSignature: fixtureSignatureValid,
  verifyEventSignature: fixtureSignatureValid,
  verifyPayload: (value, type) => payloadSchemas[type]?.(value) === true && fixtureSignatureValid(value)
};
expect("ledger-schema", ajv.getSchema("urn:agent-evals-standard:schema:governance-resolution-ledger:1")(ledger));
const ledgerIssues = await governanceLedgerIssues(ledger, ledgerContext);
expect("ledger-signed-chain", ledgerIssues.length === 0, ledgerIssues.join("; "));
for (const [id, mutate, expected] of [
  ["ledger-reordered", (value) => { value.events.reverse(); }, "sequence"],
  ["ledger-forged-root", (value) => { value.currentRoot = `sha256:${"0".repeat(64)}`; }, "current root"],
  ["ledger-wrong-identity-root", (value) => { value.policyInstanceHash = `sha256:${"0".repeat(64)}`; }, "initial root"],
  ["ledger-forged-link", (value) => { value.events[1].previousEventHash = `sha256:${"0".repeat(64)}`; }, "previous event hash"],
  ["ledger-substituted-payload", (value) => {
    value.events[0].payload.owner = "unapproved-owner";
    let previous = null;
    for (const entry of value.events) {
      entry.payloadHash = sha256Canonical(entry.payload);
      entry.previousEventHash = previous;
      entry.eventHash = governanceLedgerEventHash(entry);
      previous = entry.eventHash;
    }
    value.currentRoot = previous;
  }, "event signature"],
  ["ledger-untrusted-key", (value) => { value.events[0].signature.keyId = "claimant-key"; }, "event signature"],
  ["ledger-backdated-event", (value) => { value.events[1].timestamp = "2026-07-01T00:00:00Z"; }, "timestamps"]
]) {
  const value = structuredClone(ledger);
  mutate(value);
  const issues = await governanceLedgerIssues(value, ledgerContext);
  expect(id, issues.some((issue) => issue.includes(expected)), issues.join("; "));
}
for (const field of ["verifyLedgerSignature", "verifyEventSignature", "verifyPayload"]) {
  const context = { ...ledgerContext };
  delete context[field];
  expect(`ledger-missing-${field}`, (await governanceLedgerIssues(ledger, context)).length > 0);
}

if (failures.length > 0) {
  process.stderr.write(`Governance enforcement vectors failed (${failures.length}/${count}):\n- ${failures.join("\n- ")}\n`);
  process.exit(1);
}
process.stdout.write(`Governance enforcement vectors passed: ${count}/${count}.\n`);
