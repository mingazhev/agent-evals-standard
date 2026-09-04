import { canonicalize, sha256Canonical } from "./verify-material-integrity.mjs";

export function governanceLedgerInitialRoot(ledger) {
  return sha256Canonical({
    ledgerId: ledger.ledgerId,
    policyInstanceHash: ledger.policyInstanceHash,
    matrixInstanceHash: ledger.matrixInstanceHash
  });
}

export function governanceLedgerEventHash(event) {
  const projection = structuredClone(event);
  delete projection.eventHash;
  delete projection.signature;
  return sha256Canonical(projection);
}

export function governanceLedgerEventSigningBytes(event) {
  const projection = structuredClone(event);
  delete projection.signature.value;
  return Buffer.concat([
    Buffer.from("agent-evals-governance-ledger-event-1\0", "utf8"),
    Buffer.from(canonicalize(projection), "utf8")
  ]);
}

// Schema, authorization, and signature callbacks are supplied by the evaluator.
// This reproduces the ledger chain; external anti-rollback evidence is separate.
export async function governanceLedgerIssues(ledger, {
  verifyLedgerSignature,
  verifyEventSignature,
  verifyPayload
} = {}) {
  const issues = [];
  const initialRoot = governanceLedgerInitialRoot(ledger);
  if (ledger.initialRoot !== initialRoot) issues.push("governanceLedger: initial root differs from its identity projection");
  if (!await verified(verifyLedgerSignature, ledger)) issues.push("governanceLedger: ledger signature is not authenticated");
  const events = ledger.events ?? [];
  const ids = new Set();
  let previousHash = null;
  for (const [index, event] of events.entries()) {
    if (event.sequence !== index + 1) issues.push("governanceLedger: event sequence is not contiguous from 1");
    if (ids.has(event.eventId)) issues.push("governanceLedger: duplicate event id");
    ids.add(event.eventId);
    if (event.previousEventHash !== previousHash) issues.push("governanceLedger: previous event hash differs");
    if (event.payloadHash !== sha256Canonical(event.payload)) issues.push("governanceLedger: payload hash differs from signed payload");
    const hash = governanceLedgerEventHash(event);
    if (event.eventHash !== hash) issues.push("governanceLedger: event hash differs from its projection");
    if (!await verified(verifyEventSignature, event, governanceLedgerEventSigningBytes(event))) {
      issues.push("governanceLedger: event signature is not authenticated");
    }
    if (!await verified(verifyPayload, event.payload, event.eventType)) {
      issues.push("governanceLedger: payload is not authenticated");
    }
    if (!orderedTimes(index === 0 ? [event.timestamp] : [events[index - 1].timestamp, event.timestamp])) {
      issues.push("governanceLedger: event timestamps are not ordered");
    }
    previousHash = hash;
  }
  if (ledger.currentRoot !== (previousHash ?? initialRoot)) issues.push("governanceLedger: current root differs from terminal event");
  return issues;
}

function orderedTimes(values) {
  const times = values.map(Date.parse);
  return times.every((time, index) => Number.isFinite(time)
    && (index === 0 || time >= times[index - 1]));
}

async function verified(callback, ...args) {
  if (typeof callback !== "function") return false;
  try {
    return await callback(...args) === true;
  } catch {
    return false;
  }
}

// Inputs must first pass their schemas, signatures, and ledger membership checks.
// Authorization callbacks come from the evaluator, never from receipt payloads.
export async function enforcementReceiptBindingIssues(receipt, {
  event,
  resolution,
  verifyResolution,
  authorizeResume,
  verifyResumeCondition
} = {}) {
  const issues = [];
  if (!event) return ["sourceEventBinding: authenticated source event is required"];
  if (receipt.sourceEventId !== event.id) issues.push("sourceEventBinding: sourceEventId does not match event id");
  if (receipt.sourceEventDigest !== sha256Canonical(event)) issues.push("sourceEventBinding: sourceEventDigest differs from source event");
  if (canonicalize(receipt.affectedScope) !== canonicalize(event.affectedScope)) issues.push("sourceEventBinding: affectedScope differs from source event");

  if (receipt.resumeAction === undefined) {
    if (["sourceResolutionId", "sourceResolutionDigest", "resumeConditionResults"].some((key) => key in receipt)) {
      issues.push("sourceEventBinding: stop receipt contains resume fields");
    }
    if (receipt.stopAction !== event.stopAction) issues.push("sourceEventBinding: stopAction differs from source event");
    if (receipt.scopeAction !== event.scopeAction) issues.push("sourceEventBinding: scopeAction differs from source event");
    if (receipt.requestedAt !== event.enforcementRequest?.requestedAt) issues.push("sourceEventBinding: requestedAt differs from source event");
    if (!orderedTimes([event.triggeredAt, receipt.requestedAt, receipt.startedAt, receipt.completedAt])) {
      issues.push("sourceEventBinding: event, request, start, and completion times are not ordered");
    }
    return issues;
  }

  if (receipt.resumeAction !== "resume_approved_scope" || "stopAction" in receipt || "scopeAction" in receipt) {
    issues.push("resumeBinding: resume and stop action forms are not interchangeable");
  }
  if (!resolution) return [...issues, "resumeBinding: authenticated prior resolution is required"];
  if (receipt.sourceResolutionId !== resolution.eventId
    || receipt.sourceResolutionDigest !== sha256Canonical(resolution)) {
    issues.push("resumeBinding: source resolution identity or digest differs");
  }
  if (resolution.action !== "resolve"
    || resolution.sourceEventId !== event.id
    || resolution.sourceEventHash !== sha256Canonical(event)
    || resolution.sourceEventType !== event.eventId
    || resolution.governanceStatusId !== event.governanceStatus
    || resolution.riskTier !== event.affectedScope?.riskTier
    || resolution.scope !== event.affectedScope?.scopeDigest) {
    issues.push("resumeBinding: resolution does not close the same event, status, and scope");
  }
  if (!orderedTimes([event.triggeredAt, resolution.timestamp, receipt.requestedAt, receipt.startedAt, receipt.completedAt])) {
    issues.push("resumeBinding: resolution must precede the resume request and execution");
  }
  if (resolution.expiresAt !== undefined && (!Number.isFinite(Date.parse(resolution.expiresAt))
    || Date.parse(receipt.completedAt) >= Date.parse(resolution.expiresAt))) {
    issues.push("resumeBinding: source resolution expires before resume completes");
  }
  if (!await verified(verifyResolution, resolution, event)) {
    issues.push("resumeBinding: prior resolution, stop enforcement, and ledger authorization are not verified");
  }
  if (!await verified(authorizeResume, receipt, event, resolution)) {
    issues.push("resumeBinding: executor and currently approved scope are not authorized to resume");
  }

  const conditions = event.resumeConditions ?? [];
  const results = receipt.resumeConditionResults ?? [];
  const reported = results.map((result) => result.condition);
  if (conditions.length === 0 || new Set(conditions).size !== conditions.length
    || new Set(reported).size !== reported.length
    || canonicalize([...conditions].sort()) !== canonicalize([...reported].sort())) {
    issues.push("resumeBinding: resume conditions must match the sealed set exactly once");
  }
  for (const result of results) {
    if (result.status !== "pass" || !Array.isArray(result.evidenceIds) || result.evidenceIds.length === 0
      || result.evidenceIds.some((id) => !receipt.evidence?.includes(id))
      || !await verified(verifyResumeCondition, result, event, resolution)) {
      issues.push(`resumeBinding: condition ${result.condition} lacks verified passing evidence`);
    }
  }
  return issues;
}

export async function governanceResolutionBindingIssues(resolution, {
  event,
  stopReceipt,
  authorizeResolution
} = {}) {
  if (!event || !stopReceipt) return ["resolutionBinding: authenticated source event and stop receipt are required"];
  const issues = await enforcementReceiptBindingIssues(stopReceipt, { event });
  if (stopReceipt.resumeAction !== undefined) issues.push("resolutionBinding: a resume receipt cannot establish prior stop enforcement");
  if (resolution.sourceEventId !== event.id || resolution.sourceEventHash !== sha256Canonical(event)
    || resolution.sourceEventType !== event.eventId || resolution.governanceStatusId !== event.governanceStatus
    || resolution.riskTier !== event.affectedScope?.riskTier
    || resolution.sourceFindingRef !== event.findingRef || resolution.sourceTriageArtifact !== event.triageArtifact) {
    issues.push("resolutionBinding: resolution differs from the source event, finding, status, or risk tier");
  }
  if (resolution.enforcementReceipt?.id !== stopReceipt.id
    || resolution.enforcementReceipt?.digest !== stopReceipt.digest) {
    issues.push("resolutionBinding: resolution does not bind the original stop receipt");
  }
  if (!orderedTimes([stopReceipt.completedAt, resolution.timestamp])) {
    issues.push("resolutionBinding: resolution precedes stop enforcement");
  }
  const roles = {
    dataOwnerReviewRequired: "data_owner",
    riskAcceptanceRequired: "risk_acceptance_authority"
  };
  if (roles[event.eventId] && (resolution.action !== "resolve"
    || resolution.actor?.role !== roles[event.eventId]
    || resolution.waivability !== "non_waivable"
    || resolution.scope !== event.affectedScope?.scopeDigest)) {
    issues.push("resolutionBinding: owner/risk disposition requires its exact authorized role, scope, and non-waivable resolution");
  }
  if (!await verified(authorizeResolution, resolution, event, stopReceipt)) {
    issues.push("resolutionBinding: exact disposition and separation of duties lack independent policy authorization");
  }
  return issues;
}
