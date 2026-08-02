#!/usr/bin/env node

import { createHash } from "node:crypto";

export const EXECUTOR_ID = "agent-evals-standard.repository-contract-predicate";
export const EXECUTOR_VERSION = "0.1.0";
export const EXECUTOR_ALGORITHM = "json-field-equals-js-export-v1";

function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}

function sha256Bytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function sha256Canonical(value) {
  return sha256Bytes(Buffer.from(canonicalize(value), "utf8"));
}

function canonicalBase64Bytes(value) {
  if (typeof value !== "string") return null;
  const bytes = Buffer.from(value, "base64");
  return bytes.toString("base64") === value ? bytes : null;
}

function findFile(workspace, reference) {
  const repository = (workspace.repositories ?? []).find((entry) => entry.id === reference.repositoryId);
  const file = repository?.files?.find((entry) => entry.path === reference.path);
  if (!file) return null;
  const bytes = canonicalBase64Bytes(file.contentBase64);
  if (!bytes || bytes.length !== file.byteLength || sha256Bytes(bytes) !== file.digest) return null;
  return { repositoryId: repository.id, path: file.path, digest: file.digest, bytes };
}

function resultFor(subject, executionStatus, semanticResult, consumedObjects) {
  const result = {
    subjectKind: subject.subjectKind,
    subjectId: subject.subjectId,
    subjectVersion: subject.subjectVersion,
    subjectDigest: subject.subjectDigest,
    executor: structuredClone(subject.executor),
    predicateDigest: subject.predicate.digest,
    executionStatus,
    semanticResult,
    consumedObjects: consumedObjects
      .map(({ repositoryId, path, digest }) => ({ repositoryId, path, digest }))
      .sort((left, right) => `${left.repositoryId}:${left.path}`.localeCompare(`${right.repositoryId}:${right.path}`))
  };
  result.resultDigest = sha256Canonical(result);
  return result;
}

/**
 * Reference predicate used by the conformance hardening corpus. Integrations may
 * register other executors, but a verifier must select them from its own pinned
 * registry and must never execute an implementation named only by the evidence.
 */
export function executeRepositoryPredicate(workspace, subject) {
  if (subject?.predicate?.algorithm !== EXECUTOR_ALGORITHM) {
    return resultFor(subject, "insufficient_evidence", "insufficient_evidence", []);
  }
  const parameters = subject.predicate.parameters ?? {};
  const config = findFile(workspace, parameters.configFile ?? {});
  const source = findFile(workspace, parameters.sourceFile ?? {});
  const consumed = [config, source].filter(Boolean);
  if (!config || !source) {
    return resultFor(subject, "insufficient_evidence", "insufficient_evidence", consumed);
  }

  let expected;
  try {
    const parsed = JSON.parse(config.bytes.toString("utf8"));
    expected = parsed[parameters.configField];
  } catch {
    return resultFor(subject, "insufficient_evidence", "insufficient_evidence", consumed);
  }
  if (typeof expected !== "string" || typeof parameters.exportName !== "string") {
    return resultFor(subject, "insufficient_evidence", "insufficient_evidence", consumed);
  }
  const escapedName = parameters.exportName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.bytes.toString("utf8").match(
    new RegExp(`(?:export\\s+)?const\\s+${escapedName}\\s*=\\s*(["'])(.*?)\\1\\s*;`)
  );
  if (!match) return resultFor(subject, "insufficient_evidence", "insufficient_evidence", consumed);
  return resultFor(subject, "executed", match[2] === expected ? "pass" : "fail", consumed);
}
