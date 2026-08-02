import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { changedPathType } from "./outcome-replay-executor.mjs";
import {
  caseQaMaterialPathDigest,
  caseQaMaterialPathSetDigest,
  caseQaRepositoryConventionManifestDigest,
  caseQaRepositorySelectorDigest,
  checkCaseQaRecord
} from "./verify-case-qa-record.mjs";

const root = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, "$1"));
const schemaDirectory = path.join(root, "schemas");
const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: true });
addFormats(ajv);
for (const name of [
  "signature-profile.schema.json",
  "evidence-artifact.schema.json",
  "case-qa-record.schema.json"
]) {
  ajv.addSchema(JSON.parse(await readFile(path.join(schemaDirectory, name), "utf8")));
}
const validate = ajv.getSchema("urn:agent-evals-standard:schema:case-qa-record:1");
if (!validate) throw new Error("case-qa-record schema is not registered");

const base = JSON.parse(await readFile(
  path.join(root, "conformance", "fixtures", "positive", "case-qa-activated.json"),
  "utf8"
));
const trustedClassificationFrameAnchor = JSON.parse(await readFile(
  path.join(
    root,
    "conformance",
    "fixtures",
    "positive",
    "case-qa-classification-frame-trust-anchor.json"
  ),
  "utf8"
));
const registryPath = path.join(root, "standard", "outcome-replay-executor-registry.json");
const registryBytes = await readFile(registryPath);
const registry = JSON.parse(registryBytes.toString("utf8"));
const registryEntries = (registry.executors ?? []).filter((entry) => entry.outcomeProfileId === "workspace-change-v1");
if (registryEntries.length !== 1) throw new Error("workspace-change-v1 must have exactly one trusted registry entry");
const registryEntry = registryEntries[0];

function sha256Bytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

for (const field of ["outcomeProfile", "semanticContract", "executor", "classificationApplicabilityRule"]) {
  const pointer = registryEntry[field];
  const bytes = await readFile(path.resolve(path.dirname(registryPath), pointer.uri));
  if (pointer.digest !== sha256Bytes(bytes)) throw new Error(`trusted registry ${field} digest is stale`);
}
const trustedBinding = {
  registry: {
    id: registry.id,
    version: registry.version,
    uri: "standard/outcome-replay-executor-registry.json",
    digest: sha256Bytes(registryBytes)
  },
  outcomeProfile: structuredClone(registryEntry.outcomeProfile),
  semanticContract: structuredClone(registryEntry.semanticContract),
  executor: structuredClone(registryEntry.executor),
  applicabilityRule: structuredClone(registryEntry.classificationApplicabilityRule),
  classifyMaterialPath: changedPathType
};
const validateClassificationEvidence = ajv.getSchema(
  "urn:agent-evals-standard:schema:case-qa-record:1#/$defs/classificationPolicyApplicabilityEvidence"
);
if (!validateClassificationEvidence) throw new Error("classification applicability evidence schema is unavailable");
const trustedClassificationFrame = {
  activationInputDigest: trustedClassificationFrameAnchor.case.activationInputDigest,
  repositoryConventionManifest: structuredClone(trustedClassificationFrameAnchor.repositoryConventionManifest),
  materialPaths: structuredClone(trustedClassificationFrameAnchor.materialPaths)
};

function clone(value) {
  return structuredClone(value);
}

function mutateClassificationPayload(value, mutate) {
  const artifact = value.evidenceManifest.find((entry) => entry.id === "classification-policy-applicability-evidence");
  if (!artifact) throw new Error("classification applicability evidence is missing");
  const payload = JSON.parse(Buffer.from(artifact.payload.contentBase64, "base64").toString("utf8"));
  mutate(payload, artifact);
  const bytes = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, "utf8");
  artifact.payload.contentBase64 = bytes.toString("base64");
  artifact.byteLength = bytes.length;
  artifact.digest = sha256Bytes(bytes);
  artifact.uri = `artifact:${artifact.digest}`;
  return payload;
}

function singletonRecord() {
  const value = clone(base);
  value.stages.stage7.status = "not_applicable";
  value.stages.stage7.independence.independentOfActorIds = [
    "case-author",
    "reference-producer",
    "verdict-owner"
  ];
  value.stages.stage7.singletonValidityProof = {
    applicabilityRule: {
      id: "singleton-applicability-rule",
      version: "0.1.0",
      digest: `sha256:${"4".repeat(64)}`
    },
    validResultSetDefinition: {
      id: "singleton-valid-result-set",
      version: "0.1.0",
      digest: `sha256:${"5".repeat(64)}`
    },
    singletonResultDigest: `sha256:${"6".repeat(64)}`,
    applicabilityEvidenceId: "fixture-evidence-1",
    equivalenceEvidenceId: "fixture-evidence-1",
    exhaustivenessEvidenceId: "fixture-evidence-1",
    counterexampleSearchEvidenceId: "fixture-evidence-1",
    canonicalResultControl: {
      id: "singleton-known-good",
      inputDigest: `sha256:${"6".repeat(64)}`,
      checkIds: ["hidden-check"],
      componentDigests: [`sha256:${"7".repeat(64)}`],
      expected: "pass",
      observed: "pass",
      evidenceId: "fixture-evidence-1"
    },
    nearMissControls: [
      {
        id: "singleton-near-miss-a",
        inputDigest: `sha256:${"8".repeat(64)}`,
        checkIds: ["hidden-check"],
        componentDigests: [`sha256:${"7".repeat(64)}`],
        expected: "fail",
        observed: "fail",
        evidenceId: "fixture-evidence-1"
      },
      {
        id: "singleton-near-miss-b",
        inputDigest: `sha256:${"9".repeat(64)}`,
        checkIds: ["hidden-check"],
        componentDigests: [`sha256:${"7".repeat(64)}`],
        expected: "fail",
        observed: "fail",
        evidenceId: "fixture-evidence-1"
      }
    ],
    verdict: "pass"
  };
  value.alternativeValidResult = null;
  return value;
}

const vectors = [
  { id: "applicable-alternative-valid-result", valid: true, value: clone(base) },
  { id: "proven-singleton-not-applicable", valid: true, value: singletonRecord() },
  {
    id: "reject-reviewer-actor-collision",
    valid: false,
    expected: "shares id",
    value: (() => { const value = clone(base); value.stages.stage3.reviewer.id = "case-author"; return value; })()
  },
  {
    id: "reject-reviewer-role-collision",
    valid: false,
    expected: "shares role",
    value: (() => { const value = clone(base); value.stages.stage3.reviewer.role = "case_author"; return value; })()
  },
  {
    id: "reject-reviewer-trust-domain-collision",
    valid: false,
    expected: "shares trustDomain",
    value: (() => { const value = clone(base); value.stages.stage3.reviewer.trustDomain = "authoring"; return value; })()
  },
  {
    id: "reject-reviewer-key-id-collision",
    valid: false,
    expected: "shares keyId",
    value: (() => { const value = clone(base); value.stages.stage3.reviewer.keyId = "case-author-key"; return value; })()
  },
  {
    id: "reject-reviewer-public-key-collision",
    valid: false,
    expected: "shares publicKeyDigest",
    value: (() => { const value = clone(base); value.stages.stage3.reviewer.publicKeyDigest = value.independenceBaseline[0].actor.publicKeyDigest; return value; })()
  },
  {
    id: "reject-incomplete-independence-baseline-coverage",
    valid: false,
    expected: "independentOfActorIds must equal",
    value: (() => { const value = clone(base); value.stages.stage6.independence.independentOfActorIds.pop(); return value; })()
  },
  {
    id: "reject-correlated-independent-stage-reviewers",
    valid: false,
    expected: "stage3 reviewer and stage6 reviewer shares id",
    value: (() => { const value = clone(base); value.stages.stage6.reviewer = clone(value.stages.stage3.reviewer); return value; })()
  },
  {
    id: "reject-alternative-producer-authority-collision",
    valid: false,
    expected: "alternativeValidResult.producer reviewer and authority case-author shares id",
    value: (() => { const value = clone(base); value.alternativeValidResult.producer.id = "case-author"; return value; })()
  },
  {
    id: "reject-unknown-independence-evidence",
    valid: false,
    expected: "references unknown evidence",
    value: (() => {
      const value = clone(base);
      value.stages.stage3.independence.evidenceId = "missing-independence-evidence";
      value.stages.stage3.evidenceIds.push("missing-independence-evidence");
      return value;
    })()
  },
  {
    id: "reject-wrong-stage-capability",
    valid: false,
    expected: "must be equal to constant",
    value: (() => { const value = clone(base); value.stages.stage2.reviewerCapabilityId = "adversarial_measurement_review"; return value; })()
  },
  {
    id: "reject-missing-implementation-kind",
    valid: false,
    expected: "must have required property 'implementationKind'",
    value: (() => { const value = clone(base); delete value.stages.stage2.implementationKind; return value; })()
  },
  {
    id: "reject-incomplete-material-path-classification",
    valid: false,
    expected: "classifiedPathCount must equal materialPathCount",
    value: (() => {
      const value = clone(base);
      value.stages.stage0.classificationPolicyApplicability.materialPathCount = 2;
      return value;
    })()
  },
  {
    id: "reject-unregistered-workspace-change-classification-policy",
    valid: false,
    expected: "classificationPolicyContract must exactly equal",
    value: (() => {
      const value = clone(base);
      value.stages.stage0.classificationPolicyApplicability.classificationPolicyContract.id = "claimant-selected-policy";
      return value;
    })()
  },
  {
    id: "reject-substituted-outcome-replay-registry-digest",
    valid: false,
    expected: "outcomeReplayRegistry must exactly equal",
    value: (() => {
      const value = clone(base);
      const substituted = `sha256:${"a".repeat(64)}`;
      value.stages.stage0.classificationPolicyApplicability.outcomeReplayRegistry.digest = substituted;
      mutateClassificationPayload(value, (payload) => { payload.outcomeReplayRegistry.digest = substituted; });
      return value;
    })()
  },
  {
    id: "reject-substituted-outcome-profile-digest",
    valid: false,
    expected: "outcomeProfile must exactly equal",
    value: (() => {
      const value = clone(base);
      const substituted = `sha256:${"b".repeat(64)}`;
      value.stages.stage0.classificationPolicyApplicability.outcomeProfile.digest = substituted;
      mutateClassificationPayload(value, (payload) => { payload.outcomeProfile.digest = substituted; });
      return value;
    })()
  },
  {
    id: "reject-substituted-semantic-contract-digest",
    valid: false,
    expected: "classificationPolicyContract must exactly equal",
    value: (() => {
      const value = clone(base);
      const substituted = `sha256:${"c".repeat(64)}`;
      value.stages.stage0.classificationPolicyApplicability.classificationPolicyContract.digest = substituted;
      mutateClassificationPayload(value, (payload) => { payload.classificationPolicyContract.digest = substituted; });
      return value;
    })()
  },
  {
    id: "reject-substituted-executor-digest",
    valid: false,
    expected: "executor must exactly equal",
    value: (() => {
      const value = clone(base);
      const substituted = `sha256:${"d".repeat(64)}`;
      value.stages.stage0.classificationPolicyApplicability.executor.digest = substituted;
      mutateClassificationPayload(value, (payload) => { payload.executor.digest = substituted; });
      return value;
    })()
  },
  {
    id: "reject-substituted-applicability-rule-digest",
    valid: false,
    expected: "applicabilityRule must exactly equal",
    value: (() => {
      const value = clone(base);
      const substituted = `sha256:${"e".repeat(64)}`;
      value.stages.stage0.classificationPolicyApplicability.applicabilityRule.digest = substituted;
      mutateClassificationPayload(value, (payload, artifact) => {
        payload.applicabilityRule.digest = substituted;
        artifact.schemaMetadata.validatorDigest = substituted;
        artifact.mediaInterpretation.semanticContract.digest = substituted;
      });
      return value;
    })()
  },
  {
    id: "reject-generic-signed-classification-evidence",
    valid: false,
    expected: "typed payload is schema invalid",
    value: (() => {
      const value = clone(base);
      mutateClassificationPayload(value, (payload) => {
        for (const key of Object.keys(payload)) delete payload[key];
        Object.assign(payload, {
          schemaVersion: "fixture-evidence-payload-1",
          id: "generic-signed-evidence",
          version: "0.1.0"
        });
      });
      return value;
    })()
  },
  {
    id: "reject-classification-evidence-subject-substitution",
    valid: false,
    expected: "case does not bind the Case QA record",
    value: (() => {
      const value = clone(base);
      mutateClassificationPayload(value, (payload) => {
        payload.case.activationInputDigest = `sha256:${"f".repeat(64)}`;
      });
      return value;
    })()
  },
  {
    id: "reject-self-consistent-activation-input-substitution",
    valid: false,
    expected: "no trusted sealed-activation classification frame",
    value: (() => {
      const value = clone(base);
      const substituted = `sha256:${"f".repeat(64)}`;
      value.case.activationInputDigest = substituted;
      mutateClassificationPayload(value, (payload) => {
        payload.case.activationInputDigest = substituted;
      });
      return value;
    })()
  },
  {
    id: "reject-classification-evidence-unknown-convention",
    valid: false,
    expected: "classifications do not equal the registered classifier",
    value: (() => {
      const value = clone(base);
      mutateClassificationPayload(value, (payload) => {
        payload.classifications[0].matchedConventionIds = ["claimant-invented-convention"];
      });
      return value;
    })()
  },
  {
    id: "reject-classification-not-permitted-by-convention",
    valid: false,
    expected: "classifications do not equal the registered classifier",
    value: (() => {
      const value = clone(base);
      mutateClassificationPayload(value, (payload) => {
        payload.classifications[0].workArtifactType = "test_change";
      });
      return value;
    })()
  },
  {
    id: "reject-self-consistent-selector-and-class-relabel",
    valid: false,
    expected: "repository-convention manifest does not equal the trusted sealed-activation frame",
    value: (() => {
      const value = clone(base);
      mutateClassificationPayload(value, (payload) => {
        const convention = payload.repositoryConventionManifest.repositories[0].conventions[0];
        convention.selector = { kind: "path_prefix", prefix: "src/" };
        convention.selectorDigest = caseQaRepositorySelectorDigest(convention.selector);
        convention.permittedClasses = ["test_change"];
        payload.repositoryConventionManifestDigest = caseQaRepositoryConventionManifestDigest(
          payload.repositoryConventionManifest
        );
        payload.classifications[0].workArtifactType = "test_change";
        value.stages.stage0.classificationPolicyApplicability.repositoryConventionManifestDigest =
          payload.repositoryConventionManifestDigest;
      });
      return value;
    })()
  },
  {
    id: "reject-self-consistent-material-path-frame-substitution",
    valid: false,
    expected: "material paths do not equal the trusted sealed-activation frame",
    value: (() => {
      const value = clone(base);
      mutateClassificationPayload(value, (payload) => {
        const materialPath = {
          repositoryId: "fixture-repository",
          path: "tests/example.test.js",
          pathDigest: caseQaMaterialPathDigest("tests/example.test.js")
        };
        const convention = payload.repositoryConventionManifest.repositories[0].conventions[0];
        convention.selector = { kind: "path_prefix", prefix: "tests/" };
        convention.selectorDigest = caseQaRepositorySelectorDigest(convention.selector);
        convention.permittedClasses = ["test_change"];
        payload.repositoryConventionManifestDigest = caseQaRepositoryConventionManifestDigest(
          payload.repositoryConventionManifest
        );
        payload.materialPaths = [materialPath];
        payload.materialPathSetDigest = caseQaMaterialPathSetDigest(payload.materialPaths);
        payload.classifications = [{
          ...materialPath,
          matchedConventionIds: [convention.id],
          workArtifactType: "test_change"
        }];
        value.stages.stage0.classificationPolicyApplicability.repositoryConventionManifestDigest =
          payload.repositoryConventionManifestDigest;
        value.stages.stage0.classificationPolicyApplicability.materialPathSetDigest = payload.materialPathSetDigest;
      });
      return value;
    })()
  },
  {
    id: "reject-duplicate-material-path-classification",
    valid: false,
    expected: "classifies path",
    value: (() => {
      const value = clone(base);
      value.stages.stage0.classificationPolicyApplicability.classifiedPathCount = 2;
      mutateClassificationPayload(value, (payload) => {
        payload.classifications.push({
          ...structuredClone(payload.classifications[0]),
          workArtifactType: "test_change"
        });
      });
      return value;
    })()
  },
  {
    id: "reject-self-consistent-substituted-material-path-set-digest",
    valid: false,
    expected: "material-path-set digest is invalid",
    value: (() => {
      const value = clone(base);
      const substituted = `sha256:${"1".repeat(64)}`;
      value.stages.stage0.classificationPolicyApplicability.materialPathSetDigest = substituted;
      mutateClassificationPayload(value, (payload) => { payload.materialPathSetDigest = substituted; });
      return value;
    })()
  },
  {
    id: "reject-generic-evidence-id-substitution",
    valid: false,
    expected: "wrong typed classification-evidence schema",
    value: (() => {
      const value = clone(base);
      value.stages.stage0.classificationPolicyApplicability.applicabilityEvidenceId = "fixture-evidence-1";
      value.stages.stage0.classificationPolicyApplicability.coverageEvidenceId = "fixture-evidence-1";
      return value;
    })()
  },
  {
    id: "reject-untrusted-typed-validator-digest",
    valid: false,
    expected: "validatorDigest does not bind",
    value: (() => {
      const value = clone(base);
      const artifact = value.evidenceManifest.find((entry) => entry.id === "classification-policy-applicability-evidence");
      artifact.schemaMetadata.validatorDigest = `sha256:${"2".repeat(64)}`;
      return value;
    })()
  },
  {
    id: "reject-unknown-classification-coverage-evidence",
    valid: false,
    expected: "references unknown evidence",
    value: (() => {
      const value = clone(base);
      value.stages.stage0.classificationPolicyApplicability.coverageEvidenceId = "missing-path-coverage-evidence";
      value.stages.stage0.evidenceIds.push("missing-path-coverage-evidence");
      return value;
    })()
  },
  {
    id: "reject-workspace-change-unknown-convention",
    valid: false,
    expected: "workspace-change-v1 requires applicable",
    value: (() => {
      const value = clone(base);
      const applicable = value.stages.stage0.classificationPolicyApplicability;
      value.stages.stage0.status = "failed";
      value.case.toState = "candidate";
      value.decision.status = "rejected";
      value.stages.stage0.classificationPolicyApplicability = {
        ...applicable,
        status: "insufficient_evidence",
        classifiedPathCount: 0,
        unknownPathCount: 1,
        causes: ["unknown_repository_convention"]
      };
      return value;
    })()
  },
  {
    id: "reject-workspace-change-not-applicable-claim",
    valid: false,
    expected: "workspace-change-v1 requires applicable",
    value: (() => {
      const value = clone(base);
      const applicable = value.stages.stage0.classificationPolicyApplicability;
      value.stages.stage0.classificationPolicyApplicability = {
        status: "not_applicable",
        outcomeProfile: clone(applicable.outcomeProfile),
        applicabilityRule: clone(applicable.applicabilityRule),
        applicabilityEvidenceId: "fixture-evidence-1"
      };
      return value;
    })()
  },
  {
    id: "reject-not-applicable-with-alternative-result",
    valid: false,
    expected: "must be null",
    value: (() => { const value = singletonRecord(); value.alternativeValidResult = clone(base.alternativeValidResult); return value; })()
  },
  {
    id: "reject-not-applicable-without-equivalence-evidence",
    valid: false,
    expected: "must have required property 'equivalenceEvidenceId'",
    value: (() => { const value = singletonRecord(); delete value.stages.stage7.singletonValidityProof.equivalenceEvidenceId; return value; })()
  },
  {
    id: "reject-singleton-canonical-digest-mismatch",
    valid: false,
    expected: "singletonResultDigest must equal",
    value: (() => { const value = singletonRecord(); value.stages.stage7.singletonValidityProof.canonicalResultControl.inputDigest = `sha256:${"a".repeat(64)}`; return value; })()
  },
  {
    id: "reject-singleton-near-miss-binding-mismatch",
    valid: false,
    expected: "must bind the canonical result's exact verdict mechanisms",
    value: (() => { const value = singletonRecord(); value.stages.stage7.singletonValidityProof.nearMissControls[0].checkIds = ["different-check"]; return value; })()
  },
  {
    id: "reject-singleton-duplicate-near-miss-input",
    valid: false,
    expected: "duplicate near-miss input digest",
    value: (() => {
      const value = singletonRecord();
      value.stages.stage7.singletonValidityProof.nearMissControls[1].inputDigest = value.stages.stage7.singletonValidityProof.nearMissControls[0].inputDigest;
      return value;
    })()
  },
  {
    id: "reject-singleton-with-one-near-miss",
    valid: false,
    expected: "must NOT have fewer than 2 items",
    value: (() => { const value = singletonRecord(); value.stages.stage7.singletonValidityProof.nearMissControls.pop(); return value; })()
  },
  {
    id: "reject-singleton-unknown-counterexample-evidence",
    valid: false,
    expected: "references unknown evidence",
    value: (() => {
      const value = singletonRecord();
      value.stages.stage7.singletonValidityProof.counterexampleSearchEvidenceId = "missing-counterexample-evidence";
      value.stages.stage7.evidenceIds.push("missing-counterexample-evidence");
      return value;
    })()
  }
];

let failures = 0;
for (const vector of vectors) {
  const schemaValid = validate(vector.value);
  const schemaErrors = structuredClone(validate.errors ?? []);
  const semanticIssues = [];
  if (schemaValid) {
    await checkCaseQaRecord(vector.value, semanticIssues, {
      authenticateEvidence: (artifact) => artifact.attestation ? null : "missing attestation",
      resolveEvidencePayload: (artifact) => Buffer.from(artifact.payload.contentBase64, "base64"),
      resolveOutcomeReplayBinding: (outcomeProfileId) => outcomeProfileId === "workspace-change-v1"
        ? {
            ...structuredClone({
              registry: trustedBinding.registry,
              outcomeProfile: trustedBinding.outcomeProfile,
              semanticContract: trustedBinding.semanticContract,
              executor: trustedBinding.executor,
              applicabilityRule: trustedBinding.applicabilityRule
            }),
            classifyMaterialPath: changedPathType
          }
        : null,
      resolveClassificationFrame: (caseBinding) =>
        ["id", "version", "digest", "activationInputDigest"].every(
          (field) => caseBinding?.[field] === trustedClassificationFrameAnchor.case?.[field]
        )
          ? structuredClone(trustedClassificationFrame)
          : null,
      validateClassificationEvidence: (payload) => validateClassificationEvidence(payload)
        ? null
        : ajv.errorsText(validateClassificationEvidence.errors)
    });
  }
  const accepted = schemaValid && semanticIssues.length === 0;
  const diagnostics = [ajv.errorsText(schemaErrors), ...semanticIssues].filter(Boolean).join("\n");
  if (accepted !== vector.valid || (!vector.valid && vector.expected && !diagnostics.includes(vector.expected))) {
    failures += 1;
    console.error(`${vector.id}: expected ${vector.valid ? "pass" : "fail"}, got ${accepted ? "pass" : "fail"}; ${diagnostics}`);
  }
}

if (failures > 0) process.exit(1);
console.log(`Case QA record vectors passed: ${vectors.length} (${vectors.filter((entry) => entry.valid).length} positive, ${vectors.filter((entry) => !entry.valid).length} negative).`);
