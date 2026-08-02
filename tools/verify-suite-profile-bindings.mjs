import path from "node:path";
import { checkRepoChangeBoundVerification } from "./verify-machine-contract-bindings.mjs";

const evaluationProfileSchemaId = "urn:agent-evals-standard:schema:evaluation-profile:1";
const outcomeProfileSchemaId = "urn:agent-evals-standard:schema:outcome-profile:1";
const repoChangeCaseContractSchemaId = "urn:agent-evals-standard:schema:repo-change-case-contract:1";

function artifactBindingKey(binding) {
  return JSON.stringify([binding?.id, binding?.version, binding?.digest]);
}

function sameRegistryBinding(left, right) {
  return left?.id === right?.id
    && left?.version === right?.version
    && left?.digest === right?.digest;
}

function sameStringSet(left, right) {
  return left.length === right.length
    && left.every((value) => right.includes(value))
    && right.every((value) => left.includes(value));
}

function reportDuplicateBindings(bindings, owner, issues) {
  const counts = new Map();
  for (const binding of bindings) {
    const key = artifactBindingKey(binding);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const [key, count] of counts) {
    if (count > 1) issues.push(`${owner}: binding ${key} occurs ${count} times`);
  }
}

async function checked(operation, owner, issues) {
  const localIssues = [];
  try {
    const value = await operation(localIssues);
    issues.push(...localIssues);
    return { value, authenticated: localIssues.length === 0 };
  } catch (error) {
    issues.push(`${owner}: ${error.message}`);
    return { value: null, authenticated: false };
  }
}

/**
 * Authenticate every suite evaluation-profile pointer and derive the exact
 * effective profile that suite case bindings are required to name. The
 * injected operations are the conformance runner's existing trust and profile
 * resolution primitives; keeping them injected makes this checker unable to
 * silently substitute a weaker digest or signature implementation.
 */
export async function checkSuiteProfileBindings(document, sourceAbsolute, issues, context) {
  const owner = "suiteProfileBindings";
  const requiredOperations = [
    "resolvePinnedArtifact",
    "resolveEffectiveProfile",
    "resolveWorkArtifactRegistry",
    "digestEffectiveProfile"
  ];
  for (const operation of requiredOperations) {
    if (typeof context?.[operation] !== "function") {
      issues.push(`${owner}: checker context lacks ${operation}`);
    }
  }
  if (issues.some((issue) => issue.startsWith(`${owner}: checker context lacks `))) return;

  const suiteDirectory = path.dirname(sourceAbsolute);
  const profileStates = [];

  for (const [profileIndex, pointer] of (document.evaluationProfiles ?? []).entries()) {
    const profileOwner = `${owner}: evaluationProfiles[${profileIndex}]`;
    const profileStart = issues.length;
    const profileResolution = await checked(
      (localIssues) => context.resolvePinnedArtifact(
        pointer,
        suiteDirectory,
        evaluationProfileSchemaId,
        profileOwner,
        localIssues
      ),
      `${profileOwner} cannot authenticate signed evaluation profile`,
      issues
    );
    const resolvedProfile = profileResolution.value;
    if (!resolvedProfile?.artifact) continue;

    const profile = resolvedProfile.artifact;
    const effectiveResolution = await checked(
      (localIssues) => context.resolveEffectiveProfile(
        profile,
        resolvedProfile.absolute,
        localIssues
      ),
      `${profileOwner} cannot resolve effective profile`,
      issues
    );
    const effectiveProfile = effectiveResolution.value;
    if (!effectiveProfile) continue;

    const effectiveProfileDigest = context.digestEffectiveProfile(effectiveProfile);
    if (profile.effectiveProfileDigest !== effectiveProfileDigest) {
      issues.push(`${profileOwner}: signed evaluation profile effectiveProfileDigest must be ${effectiveProfileDigest}, found ${profile.effectiveProfileDigest}`);
    }

    let caseContract = null;
    if (effectiveProfile.id === "repo-change-v1") {
      const caseContractResolution = await checked(
        (localIssues) => context.resolvePinnedArtifact(
          effectiveProfile.caseContract,
          path.dirname(resolvedProfile.absolute),
          repoChangeCaseContractSchemaId,
          `${profileOwner} repo-change case contract`,
          localIssues
        ),
        `${profileOwner} cannot authenticate repo-change case contract`,
        issues
      );
      caseContract = caseContractResolution.value?.artifact ?? null;
    }

    const registryResolution = await checked(
      (localIssues) => context.resolveWorkArtifactRegistry(
        effectiveProfile.workArtifactRegistry,
        path.dirname(resolvedProfile.absolute),
        `${profileOwner} effective profile`,
        localIssues
      ),
      `${profileOwner} cannot authenticate work-artifact registry`,
      issues
    );
    const effectiveRegistry = registryResolution.value;

    const allowedBindings = effectiveProfile.allowedOutcomeProfiles ?? [];
    reportDuplicateBindings(allowedBindings, `${profileOwner} allowedOutcomeProfiles`, issues);
    const outcomeStates = [];
    for (const [outcomeIndex, binding] of allowedBindings.entries()) {
      const outcomeOwner = `${profileOwner} allowedOutcomeProfiles[${outcomeIndex}]`;
      const outcomeStart = issues.length;
      const outcomeResolution = await checked(
        (localIssues) => context.resolvePinnedArtifact(
          binding,
          path.dirname(resolvedProfile.absolute),
          outcomeProfileSchemaId,
          outcomeOwner,
          localIssues
        ),
        `${outcomeOwner} cannot authenticate signed outcome profile`,
        issues
      );
      const resolvedOutcome = outcomeResolution.value;
      if (!resolvedOutcome?.artifact) continue;

      const outcomeProfile = resolvedOutcome.artifact;
      if (!sameRegistryBinding(effectiveProfile.workArtifactRegistry, outcomeProfile.workArtifactRegistry)) {
        issues.push(`${outcomeOwner}: outcome and effective evaluation profile must bind the same work-artifact registry`);
      }
      const outcomeRegistryResolution = await checked(
        (localIssues) => context.resolveWorkArtifactRegistry(
          outcomeProfile.workArtifactRegistry,
          path.dirname(resolvedOutcome.absolute),
          `${outcomeOwner} outcome profile`,
          localIssues
        ),
        `${outcomeOwner} cannot authenticate work-artifact registry`,
        issues
      );
      const outcomeRegistry = outcomeRegistryResolution.value;
      if (outcomeRegistry) {
        for (const type of outcomeProfile.workArtifactTypes ?? []) {
          if (!outcomeRegistry.byType.has(type)) {
            issues.push(`${outcomeOwner}: work artifact ${type} is outside the authenticated registry`);
          }
        }
      }
      outcomeStates.push({
        binding,
        profile: outcomeProfile,
        registry: outcomeRegistry,
        authenticated: issues.length === outcomeStart
      });
    }

    profileStates.push({
      binding: { id: profile.id, version: profile.version, digest: profile.digest },
      profile,
      effectiveProfile,
      effectiveProfileDigest,
      caseContract,
      registry: effectiveRegistry,
      outcomeStates,
      authenticated: issues.length === profileStart
    });
  }

  reportDuplicateBindings(profileStates.map((state) => state.binding), `${owner}: evaluationProfiles`, issues);

  for (const caseRecord of document.cases ?? []) {
    const caseOwner = `${owner}: case ${caseRecord.id}`;
    const profileMatches = profileStates.filter((state) => state.authenticated
      && artifactBindingKey(state.binding) === artifactBindingKey(caseRecord.evaluationProfile));
    if (profileMatches.length !== 1) {
      issues.push(`${caseOwner}: evaluationProfile must exactly match one authenticated suite evaluation profile; found ${profileMatches.length}`);
      continue;
    }

    const profileState = profileMatches[0];
    if (caseRecord.effectiveProfileDigest !== profileState.effectiveProfileDigest) {
      issues.push(`${caseOwner}: effectiveProfileDigest must be ${profileState.effectiveProfileDigest}, found ${caseRecord.effectiveProfileDigest}`);
    }

    for (const family of caseRecord.capabilityFamilyIds ?? []) {
      if (!(profileState.effectiveProfile.capabilityFamilies ?? []).includes(family)) {
        issues.push(`${caseOwner}: capability ${family} is outside the authenticated effective evaluation profile`);
      }
    }

    const outcomeMatches = profileState.outcomeStates.filter((state) => state.authenticated
      && artifactBindingKey(state.binding) === artifactBindingKey(caseRecord.outcomeProfile));
    if (outcomeMatches.length !== 1) {
      issues.push(`${caseOwner}: outcomeProfile must exactly match one authenticated allowedOutcomeProfiles binding; found ${outcomeMatches.length}`);
      continue;
    }

    const outcomeProfile = outcomeMatches[0].profile;
    const mappedFamilies = [];
    for (const type of caseRecord.workArtifactTypes ?? []) {
      if (!(outcomeProfile.workArtifactTypes ?? []).includes(type)) {
        issues.push(`${caseOwner}: work artifact ${type} is outside the authenticated outcome profile`);
      }
      const registryEntry = profileState.registry?.byType.get(type);
      if (!registryEntry) {
        issues.push(`${caseOwner}: work artifact ${type} is outside the authenticated work-artifact registry`);
      } else {
        mappedFamilies.push(registryEntry.capabilityFamilyId);
      }
    }

    const materialCapabilityProjection = [...new Set(mappedFamilies)];
    if (!sameStringSet(caseRecord.capabilityFamilyIds ?? [], materialCapabilityProjection)) {
      issues.push(`${caseOwner}: capabilityFamilyIds must exactly equal the authenticated work-artifact material capability projection`);
    }
    issues.push(...checkRepoChangeBoundVerification(caseRecord, {
      label: caseOwner,
      caseContract: profileState.caseContract,
      outcomeProfile,
      workArtifactRegistry: profileState.registry
    }));
  }
}
