import { createHash } from "node:crypto";

const INDEPENDENT_STAGE_IDS = ["stage3", "stage6", "stage7"];
const AUTHORITY_DIMENSIONS = ["id", "role", "trustDomain", "keyId", "publicKeyDigest"];
const CLASSIFICATION_EVIDENCE_SCHEMA_ID = "urn:agent-evals-standard:schema:case-qa-record:1#/$defs/classificationPolicyApplicabilityEvidence";

function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}

function sha256Bytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function sameCanonical(left, right) {
  return canonicalize(left) === canonicalize(right);
}

export function caseQaMaterialPathDigest(pathValue) {
  return sha256Bytes(Buffer.from(pathValue, "utf8"));
}

export function caseQaMaterialPathSetDigest(materialPaths) {
  const normalized = [...(materialPaths ?? [])]
    .map(({ repositoryId, path: pathValue, pathDigest }) => ({
      repositoryId,
      path: pathValue,
      pathDigest
    }))
    .sort((left, right) => {
      const leftCanonical = canonicalize(left);
      const rightCanonical = canonicalize(right);
      return leftCanonical < rightCanonical ? -1 : leftCanonical > rightCanonical ? 1 : 0;
    });
  return sha256Bytes(Buffer.from(canonicalize({
    schemaVersion: "case-qa-material-path-set-1",
    materialPaths: normalized
  }), "utf8"));
}

export function caseQaRepositoryConventionManifestDigest(manifest) {
  return sha256Bytes(Buffer.from(canonicalize(manifest), "utf8"));
}

export function caseQaRepositorySelectorDigest(selector) {
  return sha256Bytes(Buffer.from(canonicalize(selector), "utf8"));
}

function sortedUnique(values) {
  return [...new Set(values ?? [])].sort();
}

function sameStringSet(left, right) {
  return JSON.stringify(sortedUnique(left)) === JSON.stringify(sortedUnique(right));
}

function hasOnlyUnicodeScalars(value) {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function isSafeRepositoryRelativePath(value) {
  if (typeof value !== "string" || value.length === 0 || !hasOnlyUnicodeScalars(value)
    || value.includes("\\") || /[\u0000-\u001f\u007f]/u.test(value)) return false;
  if (value.startsWith("/") || /^[A-Za-z]:/u.test(value)) return false;
  return value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function repositorySelectorMatches(selector, pathValue) {
  if (selector?.kind === "exact_path") return pathValue === selector.path;
  if (selector?.kind === "path_prefix") return pathValue.startsWith(selector.prefix);
  if (selector?.kind === "path_segment") return pathValue.split("/").includes(selector.segment);
  if (selector?.kind === "path_suffix") return pathValue.endsWith(selector.suffix);
  return false;
}

function materialPathKey(value) {
  return `${value?.repositoryId ?? ""}\0${value?.path ?? ""}`;
}

function normalizedClassification(value) {
  return {
    repositoryId: value?.repositoryId,
    path: value?.path,
    pathDigest: value?.pathDigest,
    matchedConventionIds: sortedUnique(value?.matchedConventionIds),
    workArtifactType: value?.workArtifactType
  };
}

function normalizedCollision(value) {
  return {
    repositoryId: value?.repositoryId,
    path: value?.path,
    pathDigest: value?.pathDigest,
    matchedConventionIds: sortedUnique(value?.matchedConventionIds),
    candidateClasses: sortedUnique(value?.candidateClasses)
  };
}

function sameCanonicalObjectSet(left, right, normalize = (value) => value) {
  const normalizedLeft = (left ?? []).map(normalize).map(canonicalize).sort();
  const normalizedRight = (right ?? []).map(normalize).map(canonicalize).sort();
  return JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight)
    && normalizedLeft.length === new Set(normalizedLeft).size
    && normalizedRight.length === new Set(normalizedRight).size;
}

function sameBoundMechanisms(left, right) {
  return sameStringSet(left?.checkIds, right?.checkIds)
    && sameStringSet(left?.componentDigests, right?.componentDigests);
}

function separationIssues(left, right, owner, issues) {
  for (const dimension of AUTHORITY_DIMENSIONS) {
    if (left?.[dimension] === right?.[dimension]) {
      issues.push(`caseQaRecord: ${owner} shares ${dimension} ${JSON.stringify(left?.[dimension])}`);
    }
  }
}

/**
 * Perform the cross-field checks that JSON Schema cannot express for a Case QA
 * activation record. The caller supplies the trust-profile-aware evidence
 * authenticator; the fixture runner supplies its pinned Ed25519 verifier.
 * resolveClassificationFrame is a trust boundary: it must return paths from
 * the sealed activation-input closure and repository-authority-authenticated
 * selector definitions, never values recovered from the evidence under review.
 * resolveOutcomeReplayBinding must expose the classifier imported from the
 * exact executor bytes whose digest it verifies.
 */
export async function checkCaseQaRecord(document, issues, options = {}) {
  const authenticateEvidence = options.authenticateEvidence;
  const validFrom = Date.parse(document.validFrom);
  const expiresAt = Date.parse(document.expiresAt);
  if (!Number.isFinite(validFrom) || !Number.isFinite(expiresAt) || validFrom >= expiresAt) {
    issues.push("caseQaRecord: validFrom must precede expiresAt");
  }

  const evidenceEntries = document.evidenceManifest ?? [];
  const evidenceById = new Map();
  for (const artifact of evidenceEntries) {
    if (evidenceById.has(artifact.id)) {
      issues.push(`caseQaRecord: duplicate evidence artifact ID ${artifact.id}`);
    } else {
      evidenceById.set(artifact.id, artifact);
    }
  }
  const evidenceAuthentication = new Map();
  async function requireEvidence(evidenceId, owner) {
    const artifact = evidenceById.get(evidenceId);
    if (!artifact) {
      issues.push(`caseQaRecord: ${owner} references unknown evidence ${evidenceId}`);
      return null;
    }
    if (!evidenceAuthentication.has(evidenceId)) {
      let problem = artifact.attestation ? null : "missing attestation";
      if (!problem && authenticateEvidence) {
        try {
          problem = await authenticateEvidence(artifact);
        } catch (error) {
          problem = `authentication error: ${error.message}`;
        }
      }
      evidenceAuthentication.set(evidenceId, problem);
    }
    const problem = evidenceAuthentication.get(evidenceId);
    if (problem) issues.push(`caseQaRecord: ${owner} evidence ${evidenceId} is unauthenticated (${problem})`);
    return artifact;
  }

  for (const [stageId, stage] of Object.entries(document.stages ?? {})) {
    for (const evidenceId of stage.evidenceIds ?? []) {
      await requireEvidence(evidenceId, `${stageId}.evidenceIds`);
    }
  }

  const stage0 = document.stages?.stage0;
  const classificationApplicability = stage0?.classificationPolicyApplicability;
  if (classificationApplicability) {
    const classificationEvidenceIds = [
      classificationApplicability.applicabilityEvidenceId,
      classificationApplicability.coverageEvidenceId
    ].filter(Boolean);
    for (const evidenceId of classificationEvidenceIds) {
      if (!(stage0.evidenceIds ?? []).includes(evidenceId)) {
        issues.push(`caseQaRecord: Stage 0 classification-policy evidence ${evidenceId} must be included in stage0.evidenceIds`);
      }
      await requireEvidence(evidenceId, "Stage 0 classification-policy applicability");
    }

    let trustedBinding = null;
    let trustedFrame = null;
    if (classificationApplicability.status !== "not_applicable") {
      if (typeof options.resolveOutcomeReplayBinding !== "function") {
        issues.push("caseQaRecord: trusted outcome-replay registry resolver is unavailable");
      } else {
        try {
          trustedBinding = await options.resolveOutcomeReplayBinding(classificationApplicability.outcomeProfile?.id);
        } catch (error) {
          issues.push(`caseQaRecord: trusted outcome-replay binding resolution failed (${error.message})`);
        }
        if (!trustedBinding) {
          issues.push(`caseQaRecord: no trusted outcome-replay binding for ${classificationApplicability.outcomeProfile?.id}`);
        }
      }
      if (typeof options.resolveClassificationFrame !== "function") {
        issues.push("caseQaRecord: trusted sealed-activation classification-frame resolver is unavailable");
      } else {
        try {
          trustedFrame = await options.resolveClassificationFrame({
            id: document.case?.id,
            version: document.case?.version,
            digest: document.case?.digest,
            activationInputDigest: document.case?.activationInputDigest
          });
        } catch (error) {
          issues.push(`caseQaRecord: trusted sealed-activation classification-frame resolution failed (${error.message})`);
        }
        if (!trustedFrame) {
          issues.push(`caseQaRecord: no trusted sealed-activation classification frame for ${document.case?.id}`);
        } else if (trustedFrame.activationInputDigest !== document.case?.activationInputDigest) {
          issues.push("caseQaRecord: trusted classification frame does not bind case.activationInputDigest");
        }
      }
    }
    if (trustedBinding) {
      for (const [field, expected] of [
        ["outcomeReplayRegistry", trustedBinding.registry],
        ["outcomeProfile", trustedBinding.outcomeProfile],
        ["classificationPolicyContract", trustedBinding.semanticContract],
        ["executor", trustedBinding.executor],
        ["applicabilityRule", trustedBinding.applicabilityRule]
      ]) {
        if (!sameCanonical(classificationApplicability[field], expected)) {
          issues.push(`caseQaRecord: Stage 0 ${field} must exactly equal the trusted outcome-replay registry binding`);
        }
      }
      if (typeof trustedBinding.classifyMaterialPath !== "function") {
        issues.push("caseQaRecord: trusted outcome-replay binding does not expose its registered material-path classifier");
      }
    }

    const typedEvidenceCache = new Map();
    async function validateClassificationEvidence(evidenceId) {
      if (typedEvidenceCache.has(evidenceId)) return typedEvidenceCache.get(evidenceId);
      const artifact = await requireEvidence(evidenceId, "Stage 0 typed classification-policy applicability");
      if (!artifact) return null;
      if (artifact.schemaMetadata?.schemaId !== CLASSIFICATION_EVIDENCE_SCHEMA_ID
        || artifact.schemaMetadata?.schemaVersion !== "case-qa-classification-applicability-evidence-1") {
        issues.push(`caseQaRecord: Stage 0 evidence ${evidenceId} has the wrong typed classification-evidence schema`);
      }
      if (trustedBinding && artifact.schemaMetadata?.validatorDigest !== trustedBinding.applicabilityRule.digest) {
        issues.push(`caseQaRecord: Stage 0 evidence ${evidenceId} validatorDigest does not bind the trusted applicability rule`);
      }
      const expectedSemanticContract = trustedBinding ? {
        id: trustedBinding.applicabilityRule.id,
        version: trustedBinding.applicabilityRule.version,
        digest: trustedBinding.applicabilityRule.digest
      } : null;
      if (expectedSemanticContract
        && !sameCanonical(artifact.mediaInterpretation?.semanticContract, expectedSemanticContract)) {
        issues.push(`caseQaRecord: Stage 0 evidence ${evidenceId} media interpretation does not bind the trusted applicability rule`);
      }
      if (artifact.mediaType !== "application/json" || artifact.creationPhase !== "case_qa") {
        issues.push(`caseQaRecord: Stage 0 evidence ${evidenceId} must be Case-QA JSON evidence`);
      }

      let bytes = null;
      try {
        if (typeof options.resolveEvidencePayload === "function") {
          bytes = Buffer.from(await options.resolveEvidencePayload(artifact));
        } else if (artifact.payload?.kind === "inline_base64") {
          bytes = Buffer.from(artifact.payload.contentBase64, "base64");
        } else {
          throw new Error("no trusted payload resolver for a non-inline artifact");
        }
      } catch (error) {
        issues.push(`caseQaRecord: Stage 0 evidence ${evidenceId} payload is unavailable (${error.message})`);
        return null;
      }
      if (artifact.byteLength !== bytes.length || artifact.digest !== sha256Bytes(bytes)
        || artifact.uri !== `artifact:${artifact.digest}`) {
        issues.push(`caseQaRecord: Stage 0 evidence ${evidenceId} payload bytes do not match its URI, digest, and byteLength`);
      }
      let payload;
      try {
        payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      } catch (error) {
        issues.push(`caseQaRecord: Stage 0 evidence ${evidenceId} is not strict UTF-8 JSON (${error.message})`);
        return null;
      }
      if (typeof options.validateClassificationEvidence !== "function") {
        issues.push("caseQaRecord: typed classification-evidence schema validator is unavailable");
        typedEvidenceCache.set(evidenceId, payload);
        return payload;
      } else {
        const schemaProblem = options.validateClassificationEvidence(payload);
        if (schemaProblem) {
          issues.push(`caseQaRecord: Stage 0 evidence ${evidenceId} typed payload is schema invalid (${schemaProblem})`);
          typedEvidenceCache.set(evidenceId, payload);
          return payload;
        }
      }
      typedEvidenceCache.set(evidenceId, payload);

      const expectedCase = {
        id: document.case?.id,
        version: document.case?.version,
        digest: document.case?.digest,
        activationInputDigest: document.case?.activationInputDigest
      };
      for (const [field, expected] of [
        ["case", expectedCase],
        ["outcomeReplayRegistry", classificationApplicability.outcomeReplayRegistry],
        ["outcomeProfile", classificationApplicability.outcomeProfile],
        ["classificationPolicyContract", classificationApplicability.classificationPolicyContract],
        ["executor", classificationApplicability.executor],
        ["applicabilityRule", classificationApplicability.applicabilityRule]
      ]) {
        if (!sameCanonical(payload?.[field], expected)) {
          issues.push(`caseQaRecord: Stage 0 evidence ${evidenceId} ${field} does not bind the Case QA record`);
        }
      }
      const computedConventionManifestDigest = payload?.repositoryConventionManifest
        ? caseQaRepositoryConventionManifestDigest(payload.repositoryConventionManifest)
        : null;
      if (payload?.repositoryConventionManifestDigest !== computedConventionManifestDigest) {
        issues.push(`caseQaRecord: Stage 0 evidence ${evidenceId} repository-convention manifest digest is invalid`);
      }
      if (payload?.repositoryConventionManifestDigest !== classificationApplicability.repositoryConventionManifestDigest) {
        issues.push(`caseQaRecord: Stage 0 evidence ${evidenceId} repository-convention manifest digest does not bind the Case QA record`);
      }
      const computedMaterialPathSetDigest = Array.isArray(payload?.materialPaths)
        ? caseQaMaterialPathSetDigest(payload.materialPaths)
        : null;
      if (payload?.materialPathSetDigest !== computedMaterialPathSetDigest) {
        issues.push(`caseQaRecord: Stage 0 evidence ${evidenceId} material-path-set digest is invalid`);
      }
      if (payload?.materialPathSetDigest !== classificationApplicability.materialPathSetDigest) {
        issues.push(`caseQaRecord: Stage 0 evidence ${evidenceId} material-path-set digest does not bind the Case QA record`);
      }

      if (payload?.frameSource !== "sealed_activation_input") {
        issues.push(`caseQaRecord: Stage 0 evidence ${evidenceId} must use the sealed activation-input classification frame`);
      }
      if (trustedFrame) {
        if (!sameCanonical(payload?.repositoryConventionManifest, trustedFrame.repositoryConventionManifest)) {
          issues.push(`caseQaRecord: Stage 0 evidence ${evidenceId} repository-convention manifest does not equal the trusted sealed-activation frame`);
        }
        if (!sameCanonical(payload?.materialPaths, trustedFrame.materialPaths)) {
          issues.push(`caseQaRecord: Stage 0 evidence ${evidenceId} material paths do not equal the trusted sealed-activation frame`);
        }
      }

      const repositoryById = new Map();
      for (const repository of payload?.repositoryConventionManifest?.repositories ?? []) {
        if (repositoryById.has(repository.repositoryId)) {
          issues.push(`caseQaRecord: Stage 0 evidence ${evidenceId} duplicates repository convention manifest ${repository.repositoryId}`);
          continue;
        }
        const conventionById = new Map();
        for (const convention of repository.conventions ?? []) {
          if (conventionById.has(convention.id)) {
            issues.push(`caseQaRecord: Stage 0 evidence ${evidenceId} duplicates convention ID ${convention.id} in repository ${repository.repositoryId}`);
          }
          conventionById.set(convention.id, convention);
          if (convention.selectorDigest !== caseQaRepositorySelectorDigest(convention.selector)) {
            issues.push(`caseQaRecord: Stage 0 evidence ${evidenceId} convention ${convention.id} selectorDigest is invalid`);
          }
        }
        repositoryById.set(repository.repositoryId, { ...repository, conventionById });
      }

      const materialByKey = new Map();
      const expectedClassifications = [];
      const expectedUnknownPaths = [];
      const expectedCollisions = [];
      for (const materialPath of payload?.materialPaths ?? []) {
        const key = materialPathKey(materialPath);
        if (materialByKey.has(key)) {
          issues.push(`caseQaRecord: Stage 0 evidence ${evidenceId} duplicates material path ${materialPath.repositoryId}:${materialPath.path}`);
          continue;
        }
        materialByKey.set(key, materialPath);
        if (!isSafeRepositoryRelativePath(materialPath.path)) {
          issues.push(`caseQaRecord: Stage 0 evidence ${evidenceId} contains an unsafe or non-scalar material path`);
          continue;
        }
        if (materialPath.pathDigest !== caseQaMaterialPathDigest(materialPath.path)) {
          issues.push(`caseQaRecord: Stage 0 evidence ${evidenceId} material path ${materialPath.repositoryId}:${materialPath.path} has an invalid raw UTF-8 pathDigest`);
        }
        const repository = repositoryById.get(materialPath.repositoryId);
        if (!repository) {
          expectedUnknownPaths.push({ ...materialPath });
          continue;
        }
        const matchingConventions = [...repository.conventionById.values()]
          .filter((convention) => repositorySelectorMatches(convention.selector, materialPath.path));
        const matchedConventionIds = matchingConventions.map((entry) => entry.id).sort();
        if (matchingConventions.length === 0) {
          expectedUnknownPaths.push({ ...materialPath });
          continue;
        }
        let classifierClass = null;
        if (typeof trustedBinding?.classifyMaterialPath === "function") {
          try {
            classifierClass = await trustedBinding.classifyMaterialPath(materialPath.path, {
              repositoryId: materialPath.repositoryId
            });
          } catch (error) {
            issues.push(`caseQaRecord: Stage 0 registered classifier failed for ${materialPath.repositoryId}:${materialPath.path} (${error.message})`);
          }
        }
        if (!["code_change", "test_change", "repository_configuration"].includes(classifierClass)) {
          issues.push(`caseQaRecord: Stage 0 registered classifier returned an invalid class for ${materialPath.repositoryId}:${materialPath.path}`);
          continue;
        }
        const conventionClasses = sortedUnique(matchingConventions.flatMap((entry) => entry.permittedClasses ?? []));
        if (conventionClasses.length !== 1 || conventionClasses[0] !== classifierClass) {
          expectedCollisions.push({
            ...materialPath,
            matchedConventionIds,
            candidateClasses: sortedUnique([...conventionClasses, classifierClass])
          });
          continue;
        }
        expectedClassifications.push({
          ...materialPath,
          matchedConventionIds,
          workArtifactType: classifierClass
        });
      }

      const claimedClassificationKeys = new Set();
      for (const classification of payload?.classifications ?? []) {
        const key = materialPathKey(classification);
        if (claimedClassificationKeys.has(key)) {
          issues.push(`caseQaRecord: Stage 0 evidence ${evidenceId} classifies path ${classification.repositoryId}:${classification.path} more than once`);
        }
        claimedClassificationKeys.add(key);
      }
      if (!sameCanonicalObjectSet(payload?.classifications, expectedClassifications, normalizedClassification)) {
        issues.push(`caseQaRecord: Stage 0 evidence ${evidenceId} classifications do not equal the registered classifier and trusted repository-selector result`);
      }
      if (!sameCanonicalObjectSet(payload?.unknownPaths, expectedUnknownPaths)) {
        issues.push(`caseQaRecord: Stage 0 evidence ${evidenceId} unknown paths do not equal the trusted selector result`);
      }
      if (!sameCanonicalObjectSet(payload?.collisions, expectedCollisions, normalizedCollision)) {
        issues.push(`caseQaRecord: Stage 0 evidence ${evidenceId} collisions do not equal the registered classifier and trusted selector result`);
      }
      if ((payload?.materialPaths ?? []).length !== classificationApplicability.materialPathCount
        || (payload?.classifications ?? []).length !== classificationApplicability.classifiedPathCount
        || (payload?.unknownPaths ?? []).length !== classificationApplicability.unknownPathCount
        || (payload?.collisions ?? []).length !== classificationApplicability.collisionCount) {
        issues.push(`caseQaRecord: Stage 0 evidence ${evidenceId} path counts do not bind the Case QA record`);
      }
      if (payload?.result !== classificationApplicability.status) {
        issues.push(`caseQaRecord: Stage 0 evidence ${evidenceId} result does not bind the Case QA record status`);
      }
      const computedResult = expectedUnknownPaths.length === 0
        && expectedCollisions.length === 0
        && expectedClassifications.length === materialByKey.size
        ? "applicable"
        : "insufficient_evidence";
      if (payload?.result !== computedResult) {
        issues.push(`caseQaRecord: Stage 0 evidence ${evidenceId} result does not equal the recomputed classification result`);
      }
      return payload;
    }

    if (classificationApplicability.status !== "not_applicable") {
      for (const evidenceId of new Set(classificationEvidenceIds)) {
        await validateClassificationEvidence(evidenceId);
      }
    }
    if (classificationApplicability.status === "applicable") {
      if (classificationApplicability.classifiedPathCount !== classificationApplicability.materialPathCount) {
        issues.push("caseQaRecord: Stage 0 classifiedPathCount must equal materialPathCount");
      }
    } else if (classificationApplicability.status === "insufficient_evidence") {
      if (stage0.status !== "failed") {
        issues.push("caseQaRecord: Stage 0 classification-policy insufficient_evidence requires failed stage status");
      }
      const causes = new Set(classificationApplicability.causes ?? []);
      const hasGroundedCause = (classificationApplicability.unknownPathCount ?? 0) > 0
        || (classificationApplicability.collisionCount ?? 0) > 0
        || classificationApplicability.classifiedPathCount !== classificationApplicability.materialPathCount;
      if (!hasGroundedCause) {
        issues.push("caseQaRecord: classification-policy insufficient_evidence has no unknown path, collision, or coverage gap");
      }
      if ((classificationApplicability.unknownPathCount ?? 0) > 0 && !causes.has("unknown_repository_convention")) {
        issues.push("caseQaRecord: unknown paths require the unknown_repository_convention cause");
      }
      if ((classificationApplicability.collisionCount ?? 0) > 0 && !causes.has("classification_collision")) {
        issues.push("caseQaRecord: classification collisions require the classification_collision cause");
      }
      if (classificationApplicability.classifiedPathCount !== classificationApplicability.materialPathCount
        && !causes.has("material_path_coverage_gap")) {
        issues.push("caseQaRecord: unequal material-path coverage requires the material_path_coverage_gap cause");
      }
    }
    if (classificationApplicability.outcomeProfile?.id === "workspace-change-v1") {
      if (classificationApplicability.status !== "applicable") {
        issues.push("caseQaRecord: workspace-change-v1 requires applicable Stage 0 classification-policy evidence");
      }
    }
  }

  const baselineByActorId = new Map();
  for (const entry of document.independenceBaseline ?? []) {
    const actorId = entry.actor?.id;
    if (baselineByActorId.has(actorId)) {
      issues.push(`caseQaRecord: duplicate independence-baseline actor ID ${actorId}`);
    } else {
      baselineByActorId.set(actorId, entry.actor);
    }
  }
  const baselineActorIds = sortedUnique([...baselineByActorId.keys()]);

  async function checkIndependence(owner, authority, claim, expectedAuthorities, stageEvidenceIds) {
    const expectedActorIds = sortedUnique(expectedAuthorities.map((entry) => entry?.id));
    if (!sameStringSet(claim?.independentOfActorIds, expectedActorIds)) {
      issues.push(`caseQaRecord: ${owner}.independentOfActorIds must equal ${JSON.stringify(expectedActorIds)}`);
    }
    if (claim?.evidenceId) {
      if (!(stageEvidenceIds ?? []).includes(claim.evidenceId)) {
        issues.push(`caseQaRecord: ${owner}.evidenceId must be included in the stage evidenceIds`);
      }
      await requireEvidence(claim.evidenceId, `${owner}.evidenceId`);
    }
    for (const expected of expectedAuthorities) {
      separationIssues(authority, expected, `${owner} reviewer and authority ${expected?.id}`, issues);
    }
  }

  const alternative = document.alternativeValidResult;
  const alternativeProducer = alternative && typeof alternative === "object" ? alternative.producer : null;
  for (const stageId of INDEPENDENT_STAGE_IDS) {
    const stage = document.stages?.[stageId];
    if (!stage) continue;
    const expected = [...baselineByActorId.values()];
    if (stageId === "stage7" && alternativeProducer) expected.push(alternativeProducer);
    await checkIndependence(stageId, stage.reviewer, stage.independence, expected, stage.evidenceIds);
  }

  const independentStages = INDEPENDENT_STAGE_IDS
    .map((stageId) => [stageId, document.stages?.[stageId]])
    .filter(([, stage]) => stage?.reviewer);
  for (let leftIndex = 0; leftIndex < independentStages.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < independentStages.length; rightIndex += 1) {
      const [leftId, leftStage] = independentStages[leftIndex];
      const [rightId, rightStage] = independentStages[rightIndex];
      separationIssues(leftStage.reviewer, rightStage.reviewer, `${leftId} reviewer and ${rightId} reviewer`, issues);
    }
  }

  const stage7 = document.stages?.stage7;
  if (stage7?.status === "not_applicable") {
    if (alternative !== null) {
      issues.push("caseQaRecord: Stage 7 not_applicable requires alternativeValidResult null");
    }
    const proof = stage7.singletonValidityProof;
    if (!proof) return;
    const proofEvidenceIds = [
      proof.applicabilityEvidenceId,
      proof.equivalenceEvidenceId,
      proof.exhaustivenessEvidenceId,
      proof.counterexampleSearchEvidenceId,
      proof.canonicalResultControl?.evidenceId,
      ...(proof.nearMissControls ?? []).map((control) => control.evidenceId)
    ].filter(Boolean);
    for (const evidenceId of proofEvidenceIds) {
      if (!(stage7.evidenceIds ?? []).includes(evidenceId)) {
        issues.push(`caseQaRecord: Stage 7 singleton proof evidence ${evidenceId} must be included in stage7.evidenceIds`);
      }
      await requireEvidence(evidenceId, "Stage 7 singleton validity proof");
    }
    const canonical = proof.canonicalResultControl;
    if (canonical && proof.singletonResultDigest !== canonical.inputDigest) {
      issues.push("caseQaRecord: singletonResultDigest must equal canonicalResultControl.inputDigest");
    }
    const nearMissInputDigests = new Set();
    const nearMissControlIds = new Set();
    for (const control of proof.nearMissControls ?? []) {
      if (canonical && !sameBoundMechanisms(canonical, control)) {
        issues.push(`caseQaRecord: near-miss control ${control.id} must bind the canonical result's exact verdict mechanisms`);
      }
      if (control.inputDigest === proof.singletonResultDigest) {
        issues.push(`caseQaRecord: near-miss control ${control.id} reuses the singleton result digest`);
      }
      if (nearMissInputDigests.has(control.inputDigest)) {
        issues.push(`caseQaRecord: duplicate near-miss input digest ${control.inputDigest}`);
      }
      nearMissInputDigests.add(control.inputDigest);
      if (nearMissControlIds.has(control.id)) {
        issues.push(`caseQaRecord: duplicate near-miss control ID ${control.id}`);
      }
      nearMissControlIds.add(control.id);
    }
  } else if (alternative && typeof alternative === "object") {
    await checkIndependence(
      "alternativeValidResult.producer",
      alternative.producer,
      alternative.independence,
      [...baselineByActorId.values()],
      stage7?.evidenceIds
    );
    separationIssues(
      stage7?.reviewer,
      alternative.producer,
      "stage7 reviewer and alternative-result producer",
      issues
    );
    for (const [field, evidenceId] of [
      ["validityEvidenceId", alternative.validityEvidenceId],
      ["differenceEvidenceId", alternative.differenceEvidenceId],
      ["control.evidenceId", alternative.control?.evidenceId]
    ]) {
      if (!(stage7?.evidenceIds ?? []).includes(evidenceId)) {
        issues.push(`caseQaRecord: alternativeValidResult.${field} must be included in stage7.evidenceIds`);
      }
      if (evidenceId) await requireEvidence(evidenceId, `alternativeValidResult.${field}`);
    }
  }

  // Keep this explicit so a validator cannot accidentally treat an empty
  // baseline as satisfying the set-equality checks above.
  if (baselineActorIds.length === 0) {
    issues.push("caseQaRecord: independence baseline must not be empty");
  }
}

export const caseQaAuthorityDimensions = Object.freeze([...AUTHORITY_DIMENSIONS]);
