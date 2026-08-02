/**
 * Closed, deterministic adapters used by the non-circular proof conformance
 * vectors. Production validators must maintain their own allow-list keyed by
 * adapter ID and exact implementation digest; they must never execute a URI
 * merely because a proof-set or verifier registry names it.
 */

function one(items, predicate, label) {
  const matches = (items ?? []).filter(predicate);
  if (matches.length !== 1) throw new Error(`${label} resolves ${matches.length} times`);
  return matches[0];
}

export function fixtureBooleanRequirementV1({ assertion, inputDocuments }) {
  const registry = inputDocuments.get("requirement_registry");
  const subject = inputDocuments.get("target_subject");
  const applicability = inputDocuments.get("applicability_contract");

  const requirement = one(registry?.requirements,
    (entry) => entry.id === assertion.requirementId,
    `requirement ${assertion.requirementId}`);
  const rule = one(applicability?.rules,
    (entry) => entry.requirementId === assertion.requirementId && entry.target === assertion.target,
    `applicability rule ${assertion.requirementId}/${assertion.target}`);

  if (!(requirement.targets ?? []).includes(assertion.target) || rule.applicable !== true) {
    return { result: "insufficient_evidence", findingIds: ["fixture-applicability-unresolved"] };
  }
  const observed = subject?.checks?.[assertion.requirementId];
  if (observed === true) return { result: "pass", findingIds: [] };
  if (observed === false) return { result: "fail", findingIds: ["fixture-requirement-failed"] };
  return { result: "insufficient_evidence", findingIds: ["fixture-requirement-not-observed"] };
}

export const conformanceProofAdapterAllowList = Object.freeze({
  "fixture-json-boolean-v1": Object.freeze({
    exportedFunction: "fixtureBooleanRequirementV1",
    run: fixtureBooleanRequirementV1
  })
});
