import { createHash } from "node:crypto";

function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}

function byId(left, right) {
  return String(left.id ?? left.requirementId).localeCompare(String(right.id ?? right.requirementId));
}

export function sourceReviewProjection(document, source) {
  const reviewedSource = {
    id: source.id,
    title: source.title,
    authorsOrOrganization: source.authorsOrOrganization,
    producerIds: source.producerIds,
    publicationDate: source.publicationDate,
    sourceType: source.sourceType,
    versionIdentity: source.versionIdentity,
    mutableLocator: source.mutableLocator,
    versionLocator: source.sourceReview?.versionLocator,
    evidenceClass: source.evidenceClass,
    empiricalRole: source.empiricalRole,
    limitations: source.limitations,
    population: source.population,
    contraryEvidence: source.contraryEvidence
  };
  if (source.fundingDisclosure !== undefined) reviewedSource.fundingDisclosure = source.fundingDisclosure;
  const observations = (document.observations ?? [])
    .filter((observation) => observation.sourceId === source.id)
    .toSorted(byId);
  const claims = (document.mappings ?? [])
    .filter((mapping) => (mapping.sourceIds ?? []).includes(source.id)
      || (mapping.rationaleEvidence?.sourceIds ?? []).includes(source.id))
    .toSorted(byId);
  const capabilityClaims = (document.capabilityCoverage ?? [])
    .filter((capability) => (capability.sourceIds ?? []).includes(source.id))
    .toSorted((left, right) => left.capabilityId.localeCompare(right.capabilityId));
  return { source: reviewedSource, observations, claims, capabilityClaims };
}

export function sourceReviewBindings(document, source) {
  const projection = sourceReviewProjection(document, source);
  return {
    observationIds: projection.observations.map((observation) => observation.id),
    requirementIds: projection.claims.map((claim) => claim.requirementId),
    capabilityIds: projection.capabilityClaims.map((claim) => claim.capabilityId),
    digest: `sha256:${createHash("sha256").update(Buffer.from(canonicalize(projection), "utf8")).digest("hex")}`
  };
}
