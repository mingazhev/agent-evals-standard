import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  assurancePolicyIssues,
  assuranceSelectionIssues
} from "./assurance-policy.mjs";

const root = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, "$1"));
const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: true });
addFormats(ajv);
for (const name of await readdir(path.join(root, "schemas"))) {
  if (name.endsWith(".schema.json")) {
    ajv.addSchema(JSON.parse(await readFile(path.join(root, "schemas", name), "utf8")));
  }
}
const validatePolicy = ajv.getSchema("urn:agent-evals-standard:schema:operational-governance-policy:1");
const policy = JSON.parse(await readFile(
  path.join(root, "conformance", "fixtures", "positive", "operational-governance-policy.json"),
  "utf8"
));

function clone(value) {
  return structuredClone(value);
}

const failures = [];
function expect(id, condition, diagnostic) {
  if (!condition) failures.push(`${id}: ${diagnostic}`);
}

expect("policy-schema-positive", validatePolicy(policy), ajv.errorsText(validatePolicy.errors));
expect("policy-semantics-positive", assurancePolicyIssues(policy).length === 0,
  assurancePolicyIssues(policy).join("; "));

const selections = [
  ["a0-diagnostic", "A0", "low", "diagnostic", "none", true],
  ["a0-claim-rejected", "A0", "low", "capability_claim", "claims_eligible", false],
  ["low-capability-a1", "A1", "low", "capability_claim", "claims_eligible", true],
  ["medium-capability-a1", "A1", "medium", "capability_claim", "claims_eligible", true],
  ["low-release-a1-rejected", "A1", "low", "release", "claims_eligible", false],
  ["medium-release-a2", "A2", "medium", "release", "claims_eligible", true],
  ["high-release-a2-rejected", "A2", "high", "release", "claims_eligible", false],
  ["low-autonomy-a2-rejected", "A2", "low", "autonomy", "claims_eligible", false],
  ["critical-risk-acceptance-a3", "A3", "critical", "risk_acceptance", "claims_eligible", true],
  ["unknown-decision-rejected", "A3", "critical", "other", "claims_eligible", false]
];
for (const [id, assuranceLevel, effectiveRiskTier, decisionClass, claimEligibility, valid] of selections) {
  const issues = assuranceSelectionIssues({
    policy, assuranceLevel, effectiveRiskTier, decisionClass, claimEligibility
  });
  expect(id, (issues.length === 0) === valid, issues.join("; ") || "unexpected acceptance");
}

{
  const value = clone(policy);
  value.rules.find((rule) => rule.riskTier === "high")
    .minimumAssuranceByDecision.capability_claim = "A2";
  expect("schema-rejects-base-floor-downgrade", !validatePolicy(value), "schema accepted A2 at high risk");
}
{
  const value = clone(policy);
  value.rules.find((rule) => rule.riskTier === "low")
    .minimumAssuranceByDecision.capability_claim = "A3";
  value.rules.find((rule) => rule.riskTier === "medium")
    .minimumAssuranceByDecision.capability_claim = "A1";
  expect("semantic-rejects-risk-monotonicity", assurancePolicyIssues(value)
    .some((issue) => issue.includes("decreases at risk tier medium")), "monotonicity downgrade was accepted");
}
{
  const value = clone(policy);
  value.rules.find((rule) => rule.riskTier === "low")
    .minimumAssuranceByDecision.capability_claim = "A3";
  value.rules.find((rule) => rule.riskTier === "low")
    .minimumAssuranceByDecision.release = "A2";
  expect("semantic-rejects-decision-dominance", assurancePolicyIssues(value)
    .some((issue) => issue.includes("release minimum is below capability_claim")), "decision dominance downgrade was accepted");
}
{
  const value = clone(policy);
  value.rules.pop();
  expect("schema-rejects-missing-risk-rule", !validatePolicy(value), "schema accepted three risk rules");
}

if (failures.length > 0) {
  process.stderr.write(`ASSURE-001 policy vectors failed (${failures.length}):\n- ${failures.join("\n- ")}\n`);
  process.exit(1);
}
process.stdout.write(`ASSURE-001 policy vectors passed: ${2 + selections.length + 4}/${2 + selections.length + 4}.\n`);
