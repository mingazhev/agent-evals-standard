import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  binaryStatisticValue,
  caseWeightedIdentificationBounds,
  completeCaseClaimStatisticsIssues,
  differenceIdentificationBounds
} from "./scorecard-statistics.mjs";

const root = new URL("../", import.meta.url);
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const checkBounds = (actual, lower, upper) => {
  assert.ok(actual);
  close(actual.lower, lower);
  close(actual.upper, upper);
};
const rate = (total, successes) => successes / total;

// Unequal repetitions must not silently turn an equal-case estimand into a
// pooled cell rate: 1/2 of cases succeed, although only 2/10 cells succeed.
const unequal = [
  { scheduled: 2, successes: 2, unresolved: 0, weight: 1 },
  { scheduled: 8, successes: 0, unresolved: 0, weight: 1 }
];
checkBounds(caseWeightedIdentificationBounds(unequal, rate), 0.5, 0.5);
checkBounds(caseWeightedIdentificationBounds(unequal.map((row, index) => ({ ...row, weight: index ? 3 : 1 })), rate), 0.25, 0.25);
checkBounds(caseWeightedIdentificationBounds(unequal.map((row) => ({ ...row, weight: row.scheduled })), rate), 0.2, 0.2);

const unresolved = [{ scheduled: 3, successes: 1, unresolved: 1, weight: 1 }];
checkBounds(caseWeightedIdentificationBounds(unresolved, rate), 1 / 3, 2 / 3);
checkBounds(caseWeightedIdentificationBounds(unresolved,
  (n, y) => binaryStatisticValue("pass_at_k", n, y, 2)), 2 / 3, 1);
// The existing reliability plug-in estimator is applied to each completion;
// it is not interchangeable with the underlying pass@1 rate.
checkBounds(caseWeightedIdentificationBounds(unresolved,
  (n, y) => binaryStatisticValue("reliability_at_k", n, y, 2)), 1 / 9, 4 / 9);
checkBounds(caseWeightedIdentificationBounds([{ scheduled: 2, successes: 0, unresolved: 2, weight: 1 }], rate), 0, 1);
assert.equal(caseWeightedIdentificationBounds(unresolved,
  (n, y) => binaryStatisticValue("pass_at_k", n, y, 4)), null);
checkBounds(differenceIdentificationBounds({ lower: 0.25, upper: 0.75 }, { lower: 0.2, upper: 0.4 }), -0.15, 0.55);
assert.equal(caseWeightedIdentificationBounds([{ scheduled: 1, successes: 1, unresolved: 1, weight: 1 }], rate), null);

const scorecard = JSON.parse(await readFile(new URL("conformance/fixtures/positive/scorecard.json", root), "utf8"));
const claim = structuredClone(scorecard.claims[0]);
const result = structuredClone(scorecard.claimResults[0]);
const caseResult = structuredClone(scorecard.caseResults[0]);
const armId = scorecard.arms[0].id;
const second = { ...structuredClone(caseResult.cells[0]), cellId: "second-cell" };
caseResult.cells.push(second);
caseResult.weight = 1;
result.eligibleCellIds.push(second.cellId);
result.successAssignments.push({ cellId: second.cellId, success: false, evidenceIds: ["test-evidence"] });
result.status = "insufficient_evidence";
result.decisionRuleResult = "fail";
result.reasonIds = ["threshold_not_met"];
result.estimate = 0.5;
result.interval = { method: "wilson", version: "0.1.0", confidenceLevel: 0.95, lower: 0.09453120573423074, upper: 0.9054687942657693 };
result.identificationBounds.lower = 0.5;
result.identificationBounds.upper = 0.5;
const problems = (value = result, selectedClaim = claim, cases = [caseResult]) =>
  completeCaseClaimStatisticsIssues(selectedClaim, value, cases, [armId]);
assert.deepEqual(problems(), [], "a computed threshold failure retains its evidence");
assert.ok(problems({ ...result, estimate: null, interval: null }).some((issue) => issue.includes("cannot erase")));
assert.ok(problems({ ...result, status: "supported" }).some((issue) => issue.includes("passing decision rule")));
assert.ok(problems({ ...result, identificationBounds: { ...result.identificationBounds, lower: 0.75 } })
  .some((issue) => issue.includes("bounds must be")));
assert.ok(problems({ ...result, estimate: 0.75 }).some((issue) => issue.includes("reported estimate must be")));
assert.ok(problems({ ...result, status: "supported", identificationBounds: { ...result.identificationBounds, method: "unknown-bound" } })
  .some((issue) => issue.includes("outside the executable")));
assert.deepEqual(problems({ ...result, estimate: null, interval: null,
  identificationBounds: { ...result.identificationBounds, method: "unknown-bound" } }), []);
assert.ok(problems({ ...result, status: "supported" }, { ...claim, analysisUnit: "case" }).some((issue) => issue.includes("outside the executable")));
assert.ok(problems({ ...result, status: "supported" }, { ...claim, direction: "difference", comparatorArmIds: [armId, "arm-b"] })
  .some((issue) => issue.includes("outside the executable")));
const kCase = structuredClone(caseResult);
kCase.statistics[0].k = 2;
assert.ok(problems({ ...result, status: "supported" }, claim, [kCase]).some((issue) => issue.includes("outside the executable")));
const uncomputableCase = structuredClone(caseResult);
uncomputableCase.statistics[0].status = "insufficient_evidence";
uncomputableCase.statistics[0].value = null;
assert.deepEqual(problems({ ...result, estimate: null, interval: null }, claim, [uncomputableCase]), []);
const otherCase = structuredClone(caseResult);
otherCase.case.id = "other-case";
otherCase.cells = [otherCase.cells[0]];
otherCase.cells[0].cellId = "other-cell";
assert.ok(problems(result, { ...claim, slice: [...claim.slice, otherCase.case.id] }, [caseResult, otherCase])
  .some((issue) => issue.includes("weights proportional")));
const emptyCase = structuredClone(caseResult);
for (const cell of emptyCase.cells) cell.state = "unresolved";
const noncomputable = { ...result, estimate: null, interval: null, successAssignments: [],
  decisionRuleResult: "insufficient_evidence", identificationBounds: { ...result.identificationBounds, lower: 0, upper: 1 } };
assert.deepEqual(problems(noncomputable, claim, [emptyCase]), []);

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
for (const name of await readdir(new URL("schemas/", root))) {
  if (name.endsWith(".schema.json")) ajv.addSchema(JSON.parse(await readFile(new URL(`schemas/${name}`, root), "utf8")));
}
const validate = ajv.getSchema("urn:agent-evals-standard:schema:scorecard:1#/$defs/claimResult");
assert.equal(validate(result), true, ajv.errorsText(validate.errors));
assert.equal(validate({ ...result, status: "supported" }), false, "supported cannot carry a failing decision rule");
assert.equal(validate(noncomputable), true, ajv.errorsText(validate.errors));
assert.equal(validate({ ...noncomputable, interval: result.interval }), false, "null estimate cannot retain an interval");
assert.equal(validate({ ...result, interval: null }), false, "numeric estimate requires an interval");
assert.equal(validate({ ...result, status: "not_applicable" }), false, "not-applicable result cannot retain a numeric estimate");
console.log("Scorecard statistics vectors passed: weighted bounds, k-statistics, missingness, differences, and computability.");
