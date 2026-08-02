import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  checkRepoChangeDistributionBindings,
  checkRepoChangeBoundVerification,
  repoChangeAssurancePassengerBinding,
  repoChangeAssuranceReportBinding,
  repoChangeVerificationBinding
} from "./verify-machine-contract-bindings.mjs";

const toolPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(toolPath), "..");

async function readJson(relative) {
  return JSON.parse(await readFile(path.join(repositoryRoot, relative), "utf8"));
}

const caseContract = await readJson("profiles/repo-change-v1/case-contract.json");
const evaluationProfile = await readJson("profiles/repo-change-v1/evaluation-profile.json");
const outcomeProfile = await readJson("profiles/repo-change-v1/outcome-profile.json");
const workArtifactRegistry = await readJson("standard/work-artifact-registry.json");
const workArtifactRegistryBytes = await readFile(path.join(repositoryRoot, "standard/work-artifact-registry.json"));
const workArtifactRegistryDigest = `sha256:${createHash("sha256")
  .update(workArtifactRegistryBytes).digest("hex")}`;

const positiveCase = {
  id: "repo-change-bound-positive",
  evaluationProfile: { id: "repo-change-v1", version: "0.1.0" },
  capabilityFamilyIds: ["CAP.IMPLEMENT_CHANGE", "CAP.VERIFY_ASSURE"],
  workArtifactTypes: ["code_change", "assurance_report"]
};

function withoutWorkspaceDiff(profile) {
  const mutated = structuredClone(profile);
  mutated.terminalEvidenceRequirements.solved.requiredArtifacts
    = mutated.terminalEvidenceRequirements.solved.requiredArtifacts.filter(function (requirement) {
      return requirement.artifactType !== "workspace_diff";
    });
  return mutated;
}

function withoutRequiredBinding(contract, requiredBinding) {
  const mutated = structuredClone(contract);
  mutated.requiredProfileBindings = mutated.requiredProfileBindings.filter(function (binding) {
    return binding !== requiredBinding;
  });
  return mutated;
}

const vectors = [
  {
    id: "accept-change-bound-verification",
    caseRecord: positiveCase,
    expectedIssues: []
  },
  {
    id: "accept-implementation-only",
    caseRecord: {
      ...positiveCase,
      capabilityFamilyIds: ["CAP.IMPLEMENT_CHANGE"],
      workArtifactTypes: ["code_change"]
    },
    expectedIssues: []
  },
  {
    id: "reject-assurance-only-capability",
    caseRecord: {
      ...positiveCase,
      capabilityFamilyIds: ["CAP.VERIFY_ASSURE"],
      workArtifactTypes: ["assurance_report"]
    },
    expectedDiagnostic: "CAP.VERIFY_ASSURE requires CAP.IMPLEMENT_CHANGE"
  },
  {
    id: "reject-verify-implement-without-implementation-type",
    caseRecord: {
      ...positiveCase,
      capabilityFamilyIds: ["CAP.IMPLEMENT_CHANGE", "CAP.VERIFY_ASSURE"],
      workArtifactTypes: ["assurance_report"]
    },
    expectedDiagnostic: "CAP.VERIFY_ASSURE requires at least one selected implementation work artifact mapped to CAP.IMPLEMENT_CHANGE"
  },
  {
    id: "reject-verification-without-assurance-report",
    caseRecord: {
      ...positiveCase,
      workArtifactTypes: ["code_change"]
    },
    expectedDiagnostic: "CAP.VERIFY_ASSURE requires assurance_report as a selected material work artifact"
  },
  {
    id: "reject-assurance-report-passenger",
    caseRecord: {
      ...positiveCase,
      capabilityFamilyIds: ["CAP.IMPLEMENT_CHANGE"]
    },
    expectedDiagnostic: "assurance_report requires CAP.VERIFY_ASSURE"
  },
  {
    id: "reject-missing-workspace-diff-terminal-requirement",
    caseRecord: positiveCase,
    outcomeProfile: withoutWorkspaceDiff(outcomeProfile),
    expectedDiagnostic: "solved terminal evidence requires exactly one authenticated content-addressed workspace_diff"
  },
  {
    id: "reject-implementation-only-without-workspace-diff-terminal-requirement",
    caseRecord: {
      ...positiveCase,
      capabilityFamilyIds: ["CAP.IMPLEMENT_CHANGE"],
      workArtifactTypes: ["code_change"]
    },
    outcomeProfile: withoutWorkspaceDiff(outcomeProfile),
    expectedDiagnostic: "solved terminal evidence requires exactly one authenticated content-addressed workspace_diff"
  },
  {
    id: "reject-missing-change-bound-profile-binding",
    caseRecord: positiveCase,
    caseContract: withoutRequiredBinding(caseContract, repoChangeVerificationBinding),
    expectedDiagnostic: `authenticated case contract lacks required binding ${repoChangeVerificationBinding}`
  },
  {
    id: "reject-missing-assurance-report-profile-binding",
    caseRecord: positiveCase,
    caseContract: withoutRequiredBinding(caseContract, repoChangeAssuranceReportBinding),
    expectedDiagnostic: `authenticated case contract lacks required binding ${repoChangeAssuranceReportBinding}`
  },
  {
    id: "reject-missing-assurance-passenger-profile-binding",
    caseRecord: positiveCase,
    caseContract: withoutRequiredBinding(caseContract, repoChangeAssurancePassengerBinding),
    expectedDiagnostic: `authenticated case contract lacks required binding ${repoChangeAssurancePassengerBinding}`
  }
];

let failures = 0;
for (const vector of vectors) {
  const label = `vector ${vector.id}`;
  const issues = checkRepoChangeBoundVerification(vector.caseRecord, {
    label,
    caseContract: vector.caseContract ?? caseContract,
    outcomeProfile: vector.outcomeProfile ?? outcomeProfile,
    workArtifactRegistry
  });
  const expectedIssues = vector.expectedIssues
    ?? [`${label}: ${vector.expectedDiagnostic}`];
  const passed = JSON.stringify(issues) === JSON.stringify(expectedIssues);
  if (!passed) {
    failures += 1;
    process.stderr.write(`${vector.id}: expected ${JSON.stringify(expectedIssues)}, found ${JSON.stringify(issues)}\n`);
  }
}

const distributionCase = {
  ...positiveCase,
  evaluationProfile: {
    id: evaluationProfile.id,
    version: evaluationProfile.version,
    digest: evaluationProfile.digest,
    effectiveProfileDigest: evaluationProfile.effectiveProfileDigest
  },
  outcomeProfile: {
    id: outcomeProfile.id,
    version: outcomeProfile.version,
    digest: outcomeProfile.digest
  },
  workArtifactRegistry: {
    id: workArtifactRegistry.id,
    version: workArtifactRegistry.version,
    digest: workArtifactRegistryDigest
  }
};
const distributionVectors = [
  { id: "accept-current-distribution-bindings", caseRecord: distributionCase, expectedIssues: [] },
  {
    id: "reject-stale-evaluation-profile-digest",
    caseRecord: {
      ...structuredClone(distributionCase),
      evaluationProfile: {
        ...distributionCase.evaluationProfile,
        digest: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
      }
    },
    expectedDiagnostic: "evaluation profile binding does not resolve the current authenticated distribution profile"
  },
  {
    id: "reject-stale-effective-profile-digest",
    caseRecord: {
      ...structuredClone(distributionCase),
      evaluationProfile: {
        ...distributionCase.evaluationProfile,
        effectiveProfileDigest: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
      }
    },
    expectedDiagnostic: "evaluation profile binding does not resolve the current authenticated distribution profile"
  },
  {
    id: "reject-stale-outcome-profile-digest",
    caseRecord: {
      ...structuredClone(distributionCase),
      outcomeProfile: {
        ...distributionCase.outcomeProfile,
        digest: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
      }
    },
    expectedDiagnostic: "outcome profile binding does not resolve the current authenticated distribution profile"
  },
  {
    id: "reject-stale-work-artifact-registry-digest",
    caseRecord: {
      ...structuredClone(distributionCase),
      workArtifactRegistry: {
        ...distributionCase.workArtifactRegistry,
        digest: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
      }
    },
    expectedDiagnostic: "work-artifact registry binding does not resolve the current authenticated distribution registry"
  }
];

for (const vector of distributionVectors) {
  const label = `distribution vector ${vector.id}`;
  const issues = checkRepoChangeDistributionBindings(vector.caseRecord, {
    label,
    evaluationProfile,
    outcomeProfile,
    workArtifactRegistry,
    workArtifactRegistryDigest
  });
  const expectedIssues = vector.expectedIssues ?? [`${label}: ${vector.expectedDiagnostic}`];
  if (JSON.stringify(issues) !== JSON.stringify(expectedIssues)) {
    failures += 1;
    process.stderr.write(`${vector.id}: expected ${JSON.stringify(expectedIssues)}, found ${JSON.stringify(issues)}\n`);
  }
}

if (failures > 0) {
  process.exitCode = 1;
} else {
  process.stdout.write(`Verified repo-change bound-verification vectors passed: ${vectors.length}/${vectors.length}.\n`);
  process.stdout.write(`Verified repo-change distribution-binding vectors passed: ${distributionVectors.length}/${distributionVectors.length}.\n`);
}
