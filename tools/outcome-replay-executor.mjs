#!/usr/bin/env node

import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";

export const OUTCOME_REPLAY_EXECUTOR_ID = "agent-evals-standard.repo-change-outcome-replay";
export const OUTCOME_REPLAY_EXECUTOR_VERSION = "0.1.0";
export const OUTCOME_REPLAY_LIMITS = Object.freeze({
  workspaceDiffBytes: 128 * 1024 * 1024,
  records: 20_000,
  lines: 2_000_000,
  lineCodeUnits: 8 * 1024 * 1024,
  pathUtf8Bytes: 16 * 1024,
  pathSeparatorCandidates: 64,
  binaryCompressedSectionBytes: 96 * 1024 * 1024,
  binaryInflatedSectionBytes: 128 * 1024 * 1024
});

const MAX_ENCODED_PATH_CODE_UNITS = (OUTCOME_REPLAY_LIMITS.pathUtf8Bytes * 4) + 2;
const MAX_PATH_PAIR_CODE_UNITS = (MAX_ENCODED_PATH_CODE_UNITS * 2) + 32;

export function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}

export function sha256Canonical(value) {
  return `sha256:${createHash("sha256").update(Buffer.from(canonicalize(value), "utf8")).digest("hex")}`;
}

export function outcomeReplayTrialProjection(trial) {
  return {
    attemptId: trial?.attemptId,
    validity: trial?.validity,
    profileOutcome: trial?.profileOutcome,
    validAlternativeId: trial?.validAlternativeId,
    evidenceModeVerdicts: trial?.evidenceModeVerdicts,
    failureCauses: trial?.failureCauses,
    hardGates: trial?.hardGates,
    governanceStatuses: trial?.governanceStatuses,
    decisionSurfaces: trial?.decisionSurfaces,
    transcriptEvidence: trial?.transcriptEvidence,
    interactionEvidence: trial?.interactionEvidence,
    artifactIds: trial?.artifactIds
  };
}

export function outcomeReplayEvidenceProjection(trial, evidenceById) {
  return [...new Set(trial?.artifactIds ?? [])]
    .filter((id) => id !== trial?.outcomeReplay?.receiptEvidenceId)
    .sort()
    .map((id) => {
      const artifact = evidenceById.get(id);
      if (!artifact) return { id, missing: true };
      return {
        id: artifact.id,
        artifactType: artifact.artifactType ?? null,
        uri: artifact.uri,
        digest: artifact.digest,
        byteLength: artifact.byteLength,
        mediaType: artifact.mediaType
      };
    });
}

function evaluateExpression(expression, facts) {
  if (!expression || typeof expression !== "object") return false;
  if (Array.isArray(expression.all)) return expression.all.every((entry) => evaluateExpression(entry, facts));
  if (Array.isArray(expression.any)) return expression.any.some((entry) => evaluateExpression(entry, facts));
  if (expression.operator !== "equals" || typeof expression.fact !== "string") return false;
  return Object.hasOwn(facts, expression.fact) && facts[expression.fact] === expression.expected;
}

function exactStringSet(expected, actual) {
  return canonicalize([...new Set(expected)].sort()) === canonicalize([...new Set(actual)].sort())
    && expected.length === new Set(expected).size
    && actual.length === new Set(actual).size;
}

function isRepositoryRelativeGitPath(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\\")
    || Buffer.byteLength(value, "utf8") > OUTCOME_REPLAY_LIMITS.pathUtf8Bytes
    || /[\u0000-\u001f\u007f]/u.test(value)) return false;
  if (value.startsWith("/") || /^[A-Za-z]:/u.test(value)) return false;
  const segments = value.split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

const fatalUtf8Decoder = new TextDecoder("utf-8", { fatal: true });

function decodeUtf8(bytes) {
  try {
    return fatalUtf8Decoder.decode(bytes);
  } catch {
    return null;
  }
}

function scanGitToken(value, start = 0) {
  let index = start;
  while (index < value.length && /\s/u.test(value[index])) index += 1;
  if (index >= value.length) return null;
  const tokenStart = index;
  if (value[index] !== "\"") {
    while (index < value.length && !/\s/u.test(value[index])) index += 1;
    return { token: value.slice(tokenStart, index), next: index };
  }
  index += 1;
  let escaped = false;
  while (index < value.length) {
    const character = value[index];
    if (!escaped && character === "\"") {
      return { token: value.slice(tokenStart, index + 1), next: index + 1 };
    }
    if (!escaped && character === "\\") escaped = true;
    else escaped = false;
    index += 1;
  }
  return null;
}

function decodeGitPathToken(token) {
  if (typeof token !== "string" || token.length === 0) return null;
  if (!token.startsWith("\"")) {
    return Buffer.byteLength(token, "utf8") <= OUTCOME_REPLAY_LIMITS.pathUtf8Bytes ? token : null;
  }
  if (!token.endsWith("\"") || token.length < 2) return null;
  const bytes = [];
  const appendBytes = (chunk) => {
    if (bytes.length + chunk.length > OUTCOME_REPLAY_LIMITS.pathUtf8Bytes) return false;
    for (const byte of chunk) bytes.push(byte);
    return true;
  };
  for (let index = 1; index < token.length - 1;) {
    const character = token[index];
    if (character !== "\\") {
      const symbol = String.fromCodePoint(token.codePointAt(index));
      if (!appendBytes(Buffer.from(symbol, "utf8"))) return null;
      index += symbol.length;
      continue;
    }
    index += 1;
    if (index >= token.length - 1) return null;
    const escaped = token[index];
    const byteEscapes = {
      a: 0x07,
      b: 0x08,
      t: 0x09,
      n: 0x0a,
      v: 0x0b,
      f: 0x0c,
      r: 0x0d,
      "\"": 0x22,
      "\\": 0x5c
    };
    if (Object.hasOwn(byteEscapes, escaped)) {
      if (!appendBytes([byteEscapes[escaped]])) return null;
      index += 1;
      continue;
    }
    let octal = "";
    while (octal.length < 3 && index + octal.length < token.length - 1
      && /[0-7]/u.test(token[index + octal.length])) {
      octal += token[index + octal.length];
    }
    if (octal.length === 0) return null;
    const byte = Number.parseInt(octal, 8);
    if (byte > 0xff) return null;
    if (!appendBytes([byte])) return null;
    index += octal.length;
  }
  return decodeUtf8(Uint8Array.from(bytes));
}

function decodeWholeGitPath(value) {
  if (!value.startsWith("\"")) return decodeGitPathToken(value);
  if (value.length > MAX_ENCODED_PATH_CODE_UNITS) return null;
  const scanned = scanGitToken(value);
  if (!scanned || value.slice(scanned.next).length > 0) return null;
  return decodeGitPathToken(scanned.token);
}

function separatorOffsets(value, separator, start, remainingLimit) {
  const offsets = [];
  let offset = value.indexOf(separator, start);
  while (offset >= 0) {
    offsets.push(offset);
    if (offsets.length > remainingLimit) return null;
    offset = value.indexOf(separator, offset + 1);
  }
  return offsets;
}

function parseDiffHeaderCandidates(line) {
  const prefix = "diff --git ";
  if (!line.startsWith(prefix)) return [];
  const body = line.slice(prefix.length);
  if (body.length > MAX_PATH_PAIR_CODE_UNITS) return [];
  const candidates = [];
  if (body.startsWith("\"")) {
    const first = scanGitToken(body);
    if (!first || body[first.next] !== " ") return [];
    const secondValue = body.slice(first.next + 1);
    const oldToken = decodeGitPathToken(first.token);
    const newToken = decodeWholeGitPath(secondValue);
    if (oldToken?.startsWith("a/") && newToken?.startsWith("b/")) {
      candidates.push({ oldPath: oldToken.slice(2), newPath: newToken.slice(2) });
    }
  } else if (body.startsWith("a/")) {
    const ordinaryOffsets = separatorOffsets(
      body, " b/", 2, OUTCOME_REPLAY_LIMITS.pathSeparatorCandidates);
    if (!ordinaryOffsets) return [];
    const quotedOffsets = separatorOffsets(
      body,
      " \"b/",
      2,
      OUTCOME_REPLAY_LIMITS.pathSeparatorCandidates - ordinaryOffsets.length);
    if (!quotedOffsets) return [];
    for (const separator of ordinaryOffsets) {
      candidates.push({
        oldPath: body.slice(2, separator),
        newPath: body.slice(separator + 3)
      });
    }
    for (const separator of quotedOffsets) {
      const newToken = decodeWholeGitPath(body.slice(separator + 1));
      if (newToken?.startsWith("b/")) {
        candidates.push({
          oldPath: body.slice(2, separator),
          newPath: newToken.slice(2)
        });
      }
    }
  }
  return [...new Map(candidates
    .filter(({ oldPath, newPath }) =>
      isRepositoryRelativeGitPath(oldPath) && isRepositoryRelativeGitPath(newPath))
    .map((entry) => [`${entry.oldPath}\0${entry.newPath}`, entry])).values()];
}

function decodeMarkerPath(value) {
  let pathValue = value;
  let suffix = "";
  if (value.startsWith("\"")) {
    const scanned = scanGitToken(value);
    if (!scanned) return null;
    pathValue = scanned.token;
    suffix = value.slice(scanned.next);
  } else {
    const separator = value.indexOf("\t");
    if (separator >= 0) {
      pathValue = value.slice(0, separator);
      suffix = value.slice(separator);
    }
  }
  if (suffix !== "" && !/^\t(?:\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)? [+-]\d{4})?$/u.test(suffix)) {
    return null;
  }
  return decodeWholeGitPath(pathValue);
}

function parseMarkerPath(value, prefix) {
  const decoded = decodeMarkerPath(value);
  if (decoded === "/dev/null") return decoded;
  if (!decoded?.startsWith(`${prefix}/`)) return null;
  const relative = decoded.slice(2);
  return isRepositoryRelativeGitPath(relative) ? relative : null;
}

function parseExtendedPath(value) {
  const decoded = decodeWholeGitPath(value);
  return isRepositoryRelativeGitPath(decoded) ? decoded : null;
}

function parseBinaryPathCandidates(line) {
  const prefix = "Binary files ";
  const suffix = " differ";
  if (!line.startsWith(prefix) || !line.endsWith(suffix)) return [];
  const body = line.slice(prefix.length, -suffix.length);
  if (body.length > MAX_PATH_PAIR_CODE_UNITS) return [];
  const offsets = separatorOffsets(
    body, " and ", 0, OUTCOME_REPLAY_LIMITS.pathSeparatorCandidates);
  if (!offsets) return [];
  const pairs = [];
  for (const separator of offsets) {
    const oldToken = decodeWholeGitPath(body.slice(0, separator));
    const newToken = decodeWholeGitPath(body.slice(separator + 5));
    const oldPath = oldToken === "/dev/null"
      ? oldToken
      : oldToken?.startsWith("a/") ? oldToken.slice(2) : null;
    const newPath = newToken === "/dev/null"
      ? newToken
      : newToken?.startsWith("b/") ? newToken.slice(2) : null;
    if ((oldPath === "/dev/null" || isRepositoryRelativeGitPath(oldPath))
      && (newPath === "/dev/null" || isRepositoryRelativeGitPath(newPath))) {
      pairs.push({ oldPath, newPath });
    }
  }
  return pairs;
}

function gitBinaryPayloadDecodedLength(line) {
  if (typeof line !== "string" || line.length < 2) return null;
  const lead = line.codePointAt(0);
  const decodedLength = lead >= 0x41 && lead <= 0x5a
    ? lead - 0x40
    : lead >= 0x61 && lead <= 0x7a
      ? lead - 0x46
      : 0;
  if (decodedLength < 1 || decodedLength > 52) return null;
  const payload = line.slice(1);
  return payload.length === Math.ceil(decodedLength / 4) * 5
    && /^[0-9A-Za-z!#$%&()*+\-;<=>?@^_`{|}~]+$/u.test(payload)
    ? decodedLength
    : null;
}

function isGitBinaryPayloadLine(line) {
  return gitBinaryPayloadDecodedLength(line) !== null;
}

const gitBase85Alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+-;<=>?@^_`{|}~";
const gitBase85Values = new Map([...gitBase85Alphabet].map((character, index) => [character, index]));

function decodeGitBinaryPayloadLineInto(line, target, targetOffset) {
  const decodedLength = gitBinaryPayloadDecodedLength(line);
  if (decodedLength === null || targetOffset + decodedLength > target.length) return false;
  const decoded = Buffer.allocUnsafe(Math.ceil(decodedLength / 4) * 4);
  let outputOffset = 0;
  for (let offset = 1; offset < line.length; offset += 5) {
    let value = 0;
    for (const character of line.slice(offset, offset + 5)) {
      const digit = gitBase85Values.get(character);
      if (digit === undefined) return false;
      value = value * 85 + digit;
    }
    if (!Number.isSafeInteger(value) || value > 0xffffffff) return false;
    decoded.writeUInt32BE(value, outputOffset);
    outputOffset += 4;
  }
  if (decoded.subarray(decodedLength).some((byte) => byte !== 0)) return false;
  decoded.copy(target, targetOffset, 0, decodedLength);
  return true;
}

function readDeltaVarint(bytes, state) {
  let value = 0;
  let shift = 0;
  for (let count = 0; count < 10; count += 1) {
    if (state.offset >= bytes.length) return null;
    const byte = bytes[state.offset];
    state.offset += 1;
    value += (byte & 0x7f) * (2 ** shift);
    if (!Number.isSafeInteger(value)) return null;
    if ((byte & 0x80) === 0) return value;
    shift += 7;
  }
  return null;
}

function validGitDelta(delta) {
  const state = { offset: 0 };
  const sourceSize = readDeltaVarint(delta, state);
  const resultSize = readDeltaVarint(delta, state);
  if (sourceSize === null || resultSize === null) return false;
  let produced = 0;
  while (state.offset < delta.length) {
    const opcode = delta[state.offset];
    state.offset += 1;
    if (opcode === 0) return false;
    if ((opcode & 0x80) === 0) {
      const literalLength = opcode;
      if (state.offset + literalLength > delta.length) return false;
      state.offset += literalLength;
      produced += literalLength;
    } else {
      let copyOffset = 0;
      let copySize = 0;
      for (let byteIndex = 0; byteIndex < 4; byteIndex += 1) {
        if ((opcode & (1 << byteIndex)) !== 0) {
          if (state.offset >= delta.length) return false;
          copyOffset += delta[state.offset] * (2 ** (8 * byteIndex));
          state.offset += 1;
        }
      }
      for (let byteIndex = 0; byteIndex < 3; byteIndex += 1) {
        if ((opcode & (0x10 << byteIndex)) !== 0) {
          if (state.offset >= delta.length) return false;
          copySize += delta[state.offset] * (2 ** (8 * byteIndex));
          state.offset += 1;
        }
      }
      if (copySize === 0) copySize = 0x10000;
      if (!Number.isSafeInteger(copyOffset + copySize) || copyOffset + copySize > sourceSize) return false;
      produced += copySize;
    }
    if (!Number.isSafeInteger(produced) || produced > resultSize) return false;
  }
  return produced === resultSize;
}

function validGitBinarySection(section, lines) {
  if (!section || section.payloadLineCount === 0
    || !Number.isSafeInteger(section.declaredSize) || section.declaredSize < 0
    || section.declaredSize > OUTCOME_REPLAY_LIMITS.binaryInflatedSectionBytes) return false;
  if (section.compressedLength > OUTCOME_REPLAY_LIMITS.binaryCompressedSectionBytes) return false;
  const compressed = Buffer.allocUnsafe(section.compressedLength);
  let compressedOffset = 0;
  for (let lineIndex = section.payloadStartIndex; lineIndex <= section.payloadEndIndex; lineIndex += 1) {
    const decodedLength = gitBinaryPayloadDecodedLength(lines[lineIndex]);
    if (decodedLength === null
      || (lineIndex < section.payloadEndIndex && decodedLength !== 52)
      || !decodeGitBinaryPayloadLineInto(lines[lineIndex], compressed, compressedOffset)) return false;
    compressedOffset += decodedLength;
  }
  if (compressedOffset !== section.compressedLength) return false;
  try {
    const inflated = inflateSync(compressed, {
      info: true,
      maxOutputLength: Math.min(
        section.declaredSize + 1,
        OUTCOME_REPLAY_LIMITS.binaryInflatedSectionBytes + 1)
    });
    if (inflated.engine?.bytesWritten !== compressed.length) return false;
    if (inflated.buffer.length !== section.declaredSize) return false;
    return section.kind === "literal" || validGitDelta(inflated.buffer);
  } catch {
    return false;
  }
}

function headerCandidateMatches(candidate, {
  oldMarker,
  newMarker,
  renameFrom,
  renameTo,
  copyFrom,
  copyTo,
  binaryPathCandidateGroups
}) {
  if (oldMarker && oldMarker !== "/dev/null" && oldMarker !== candidate.oldPath) return false;
  if (newMarker && newMarker !== "/dev/null" && newMarker !== candidate.newPath) return false;
  if (renameFrom && renameFrom !== candidate.oldPath) return false;
  if (renameTo && renameTo !== candidate.newPath) return false;
  if (copyFrom && copyFrom !== candidate.oldPath) return false;
  if (copyTo && copyTo !== candidate.newPath) return false;
  if (binaryPathCandidateGroups.some((group) => group.filter((pair) =>
    (pair.oldPath === "/dev/null" || pair.oldPath === candidate.oldPath)
      && (pair.newPath === "/dev/null" || pair.newPath === candidate.newPath)).length !== 1)) return false;
  const hasPathBinding = Boolean(oldMarker || newMarker || renameFrom || renameTo || copyFrom || copyTo
    || binaryPathCandidateGroups.length > 0);
  return hasPathBinding || candidate.oldPath === candidate.newPath;
}

export function changedPathsFromDiff(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0
    || bytes.byteLength > OUTCOME_REPLAY_LIMITS.workspaceDiffBytes) {
    return { valid: false, paths: [] };
  }
  const text = decodeUtf8(bytes);
  if (text === null) return { valid: false, paths: [] };
  const lines = text.split(/\r?\n/u);
  if (lines.length > OUTCOME_REPLAY_LIMITS.lines
    || lines.some((line) => line.length > OUTCOME_REPLAY_LIMITS.lineCodeUnits)) {
    return { valid: false, paths: [] };
  }
  const paths = [];
  let index = 0;
  let recordCount = 0;
  while (index < lines.length) {
    if (lines[index] === "") {
      index += 1;
      continue;
    }
    const headerCandidates = parseDiffHeaderCandidates(lines[index]);
    if (headerCandidates.length === 0) return { valid: false, paths: [] };
    recordCount += 1;
    if (recordCount > OUTCOME_REPLAY_LIMITS.records) return { valid: false, paths: [] };
    index += 1;
    let oldMarker;
    let newMarker;
    let hunkCount = 0;
    let changedLineCount = 0;
    let activeHunk = null;
    let invalidRecord = false;
    let newFileMode;
    let deletedFileMode;
    let oldMode;
    let newMode;
    let renameFrom;
    let renameTo;
    let copyFrom;
    let copyTo;
    const binaryPathCandidateGroups = [];
    let binaryPatch = false;
    let binarySectionCount = 0;
    let binarySectionPayloadLines = 0;
    let binarySectionOpen = false;
    let activeBinarySection = null;
    let indexLineCount = 0;
    let indexObjectIds;
    let similarityPercent;
    let dissimilarityIndex;
    let previousHunkRange = null;
    let hunkBodyLineSeen = false;
    let noNewlineMarkerForLastBodyLine = false;

    const finishHunk = () => {
      if (!activeHunk) return;
      if (activeHunk.oldSeen !== activeHunk.oldExpected
        || activeHunk.newSeen !== activeHunk.newExpected
        || activeHunk.changed === 0) invalidRecord = true;
      changedLineCount += activeHunk.changed;
      activeHunk = null;
    };

    const finishBinarySection = () => {
      if (!binarySectionOpen) return;
      if (binarySectionPayloadLines === 0 || !validGitBinarySection(activeBinarySection, lines)) invalidRecord = true;
      binarySectionPayloadLines = 0;
      binarySectionOpen = false;
      activeBinarySection = null;
    };

    while (index < lines.length && !lines[index].startsWith("diff --git ")) {
      const line = lines[index];

      if (activeHunk) {
        const countsComplete = activeHunk.oldSeen === activeHunk.oldExpected
          && activeHunk.newSeen === activeHunk.newExpected;
        if (line === "\\ No newline at end of file") {
          if (!hunkBodyLineSeen || noNewlineMarkerForLastBodyLine) invalidRecord = true;
          noNewlineMarkerForLastBodyLine = true;
          index += 1;
          continue;
        }
        if (countsComplete) {
          finishHunk();
          continue;
        }
        const prefix = line[0];
        if (prefix === " ") {
          activeHunk.oldSeen += 1;
          activeHunk.newSeen += 1;
        } else if (prefix === "-") {
          activeHunk.oldSeen += 1;
          activeHunk.changed += 1;
        } else if (prefix === "+") {
          activeHunk.newSeen += 1;
          activeHunk.changed += 1;
        } else {
          invalidRecord = true;
        }
        hunkBodyLineSeen = [" ", "-", "+"].includes(prefix);
        noNewlineMarkerForLastBodyLine = false;
        if (activeHunk.oldSeen > activeHunk.oldExpected
          || activeHunk.newSeen > activeHunk.newExpected) invalidRecord = true;
        index += 1;
        continue;
      }

      if (binaryPatch && binarySectionOpen) {
        if (line === "") {
          finishBinarySection();
          index += 1;
          continue;
        }
        const sectionHeader = /^(?:literal|delta) (\d+)$/u.exec(line);
        if (sectionHeader) {
          invalidRecord = true;
          finishBinarySection();
          binarySectionCount += 1;
          binarySectionOpen = true;
          activeBinarySection = {
            kind: line.startsWith("literal ") ? "literal" : "delta",
            declaredSize: Number.parseInt(sectionHeader[1], 10),
            payloadStartIndex: undefined,
            payloadEndIndex: undefined,
            payloadLineCount: 0,
            lastDecodedLength: undefined,
            compressedLength: 0
          };
          index += 1;
          continue;
        }
        const decodedLength = gitBinaryPayloadDecodedLength(line);
        if (decodedLength !== null) {
          if ((activeBinarySection.payloadLineCount > 0 && activeBinarySection.lastDecodedLength !== 52)
            || activeBinarySection.payloadLineCount >= Math.ceil(
              OUTCOME_REPLAY_LIMITS.binaryCompressedSectionBytes / 52)
            || activeBinarySection.compressedLength + decodedLength
              > OUTCOME_REPLAY_LIMITS.binaryCompressedSectionBytes) {
            return { valid: false, paths: [] };
          }
          binarySectionPayloadLines += 1;
          activeBinarySection.payloadStartIndex ??= index;
          activeBinarySection.payloadEndIndex = index;
          activeBinarySection.payloadLineCount += 1;
          activeBinarySection.lastDecodedLength = decodedLength;
          activeBinarySection.compressedLength += decodedLength;
        } else return { valid: false, paths: [] };
        index += 1;
        continue;
      }

      if (binaryPathCandidateGroups.length > 0 && line !== "") {
        invalidRecord = true;
        index += 1;
        continue;
      }
      if (binaryPatch && line !== "" && !/^(?:literal|delta) \d+$/u.test(line)) {
        invalidRecord = true;
        index += 1;
        continue;
      }

      const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/u.exec(line);
      if (hunk) {
        const oldStart = Number.parseInt(hunk[1], 10);
        const oldExpected = hunk[2] === undefined ? 1 : Number.parseInt(hunk[2], 10);
        const newStart = Number.parseInt(hunk[3], 10);
        const newExpected = hunk[4] === undefined ? 1 : Number.parseInt(hunk[4], 10);
        if (![oldStart, oldExpected, newStart, newExpected].every(Number.isSafeInteger)
          || (oldExpected > 0 && oldStart === 0) || (newExpected > 0 && newStart === 0)
          || (previousHunkRange && (
            oldStart < previousHunkRange.oldStart + previousHunkRange.oldExpected
            || newStart < previousHunkRange.newStart + previousHunkRange.newExpected))) {
          invalidRecord = true;
        }
        activeHunk = {
          oldExpected,
          newExpected,
          oldSeen: 0,
          newSeen: 0,
          changed: 0
        };
        previousHunkRange = { oldStart, oldExpected, newStart, newExpected };
        hunkBodyLineSeen = false;
        noNewlineMarkerForLastBodyLine = false;
        hunkCount += 1;
      } else if (line.startsWith("--- ")) {
        if (oldMarker !== undefined || hunkCount > 0) invalidRecord = true;
        oldMarker = parseMarkerPath(line.slice(4), "a");
        if (!oldMarker) invalidRecord = true;
      } else if (line.startsWith("+++ ")) {
        if (newMarker !== undefined || hunkCount > 0) invalidRecord = true;
        newMarker = parseMarkerPath(line.slice(4), "b");
        if (!newMarker) invalidRecord = true;
      } else if (/^new file mode (?:100644|100755|120000|160000)$/u.test(line)) {
        if (newFileMode !== undefined || hunkCount > 0) invalidRecord = true;
        newFileMode = line.slice(-6);
      } else if (/^deleted file mode (?:100644|100755|120000|160000)$/u.test(line)) {
        if (deletedFileMode !== undefined || hunkCount > 0) invalidRecord = true;
        deletedFileMode = line.slice(-6);
      } else if (/^old mode (?:100644|100755|120000|160000)$/u.test(line)) {
        if (oldMode !== undefined || hunkCount > 0) invalidRecord = true;
        oldMode = line.slice(-6);
      } else if (/^new mode (?:100644|100755|120000|160000)$/u.test(line)) {
        if (newMode !== undefined || hunkCount > 0) invalidRecord = true;
        newMode = line.slice(-6);
      } else if (line.startsWith("rename from ")) {
        if (renameFrom !== undefined || hunkCount > 0) invalidRecord = true;
        renameFrom = parseExtendedPath(line.slice(12));
        if (!renameFrom) invalidRecord = true;
      } else if (line.startsWith("rename to ")) {
        if (renameTo !== undefined || hunkCount > 0) invalidRecord = true;
        renameTo = parseExtendedPath(line.slice(10));
        if (!renameTo) invalidRecord = true;
      } else if (line.startsWith("copy from ")) {
        if (copyFrom !== undefined || hunkCount > 0) invalidRecord = true;
        copyFrom = parseExtendedPath(line.slice(10));
        if (!copyFrom) invalidRecord = true;
      } else if (line.startsWith("copy to ")) {
        if (copyTo !== undefined || hunkCount > 0) invalidRecord = true;
        copyTo = parseExtendedPath(line.slice(8));
        if (!copyTo) invalidRecord = true;
      } else if (line.startsWith("Binary files ")) {
        const pairs = parseBinaryPathCandidates(line);
        if (pairs.length === 0 || binaryPathCandidateGroups.length > 0 || hunkCount > 0) invalidRecord = true;
        binaryPathCandidateGroups.push(pairs);
      } else if (line === "GIT binary patch") {
        if (binaryPatch || binaryPathCandidateGroups.length > 0 || hunkCount > 0) invalidRecord = true;
        binaryPatch = true;
      } else if (binaryPatch && /^(?:literal|delta) \d+$/u.test(line)) {
        const declaredSize = Number.parseInt(line.slice(line.indexOf(" ") + 1), 10);
        if (!Number.isSafeInteger(declaredSize)) invalidRecord = true;
        binarySectionCount += 1;
        binarySectionPayloadLines = 0;
        binarySectionOpen = true;
        activeBinarySection = {
          kind: line.startsWith("literal ") ? "literal" : "delta",
          declaredSize,
          payloadStartIndex: undefined,
          payloadEndIndex: undefined,
          payloadLineCount: 0,
          lastDecodedLength: undefined,
          compressedLength: 0
        };
      } else if (/^index [0-9a-f]{4,64}\.\.[0-9a-f]{4,64}(?: (?:100644|100755|120000|160000))?$/u.test(line)) {
        indexLineCount += 1;
        if (indexLineCount > 1 || hunkCount > 0) invalidRecord = true;
        const match = /^index ([0-9a-f]{4,64})\.\.([0-9a-f]{4,64})/u.exec(line);
        indexObjectIds = match ? { old: match[1], next: match[2] } : null;
      } else if (/^similarity index (?:100|[1-9]?\d)%$/u.test(line)) {
        if (similarityPercent !== undefined || dissimilarityIndex !== undefined || hunkCount > 0) invalidRecord = true;
        similarityPercent = Number.parseInt(line.slice(17, -1), 10);
      } else if (/^dissimilarity index (?:100|[1-9]?\d)%$/u.test(line)) {
        if (dissimilarityIndex !== undefined || similarityPercent !== undefined || hunkCount > 0) invalidRecord = true;
        dissimilarityIndex = line;
      } else if (line === "") {
        // Canonical non-material Git metadata.
      } else {
        invalidRecord = true;
      }
      index += 1;
    }
    finishHunk();
    finishBinarySection();

    let matchingHeaders = headerCandidates.filter((candidate) => headerCandidateMatches(candidate, {
      oldMarker,
      newMarker,
      renameFrom,
      renameTo,
      copyFrom,
      copyTo,
      binaryPathCandidateGroups
    }));
    if (matchingHeaders.length === 0 && binaryPatch && headerCandidates.length === 1) {
      matchingHeaders = headerCandidates;
    }
    if (matchingHeaders.length !== 1) return { valid: false, paths: [] };
    const [{ oldPath, newPath }] = matchingHeaders;
    const textualChange = hunkCount > 0 && changedLineCount > 0
      && (oldMarker === "/dev/null" || oldMarker === oldPath)
      && (newMarker === "/dev/null" || newMarker === newPath)
      && !(oldMarker === "/dev/null" && newMarker === "/dev/null");
    const creationOrDeletion = Boolean(newFileMode) !== Boolean(deletedFileMode);
    const modeChange = Boolean(oldMode && newMode && oldMode !== newMode);
    const rename = renameFrom === oldPath && renameTo === newPath && oldPath !== newPath;
    const copy = copyFrom === oldPath && copyTo === newPath && oldPath !== newPath;
    const binaryChange = binaryPathCandidateGroups.length > 0
      || (binaryPatch && binarySectionCount > 0 && !invalidRecord);
    const matchedBinaryPair = binaryPathCandidateGroups[0]?.find((pair) =>
      (pair.oldPath === "/dev/null" || pair.oldPath === oldPath)
        && (pair.newPath === "/dev/null" || pair.newPath === newPath));
    const markerPairInvalid = Boolean(oldMarker) !== Boolean(newMarker)
      || Boolean(hunkCount > 0 && !(oldMarker && newMarker))
      || (hunkCount === 0 && Boolean(oldMarker || newMarker));
    const modePairInvalid = Boolean(oldMode) !== Boolean(newMode)
      || Boolean(oldMode && newMode && oldMode === newMode);
    const createDeleteInvalid = Boolean(newFileMode && deletedFileMode)
      || Boolean((newFileMode || deletedFileMode) && (oldMode || newMode || renameFrom || renameTo || copyFrom || copyTo))
      || Boolean(oldMarker === "/dev/null" && !newFileMode)
      || Boolean(newMarker === "/dev/null" && !deletedFileMode)
      || Boolean(newFileMode && oldMarker && oldMarker !== "/dev/null")
      || Boolean(newFileMode && newMarker && newMarker !== newPath)
      || Boolean(deletedFileMode && newMarker && newMarker !== "/dev/null")
      || Boolean(deletedFileMode && oldMarker && oldMarker !== oldPath)
      || Boolean(matchedBinaryPair?.oldPath === "/dev/null" && !newFileMode)
      || Boolean(matchedBinaryPair?.newPath === "/dev/null" && !deletedFileMode)
      || Boolean(matchedBinaryPair?.oldPath === "/dev/null" && matchedBinaryPair?.newPath === "/dev/null")
      || Boolean(newFileMode && matchedBinaryPair && matchedBinaryPair.oldPath !== "/dev/null")
      || Boolean(deletedFileMode && matchedBinaryPair && matchedBinaryPair.newPath !== "/dev/null");
    const pathOperationInvalid = (Boolean(renameFrom) !== Boolean(renameTo))
      || (Boolean(copyFrom) !== Boolean(copyTo))
      || Boolean((renameFrom || renameTo) && (copyFrom || copyTo));
    const binaryInvalid = Boolean(binaryPatch && (
      binarySectionCount < 1 || binarySectionCount > 2 || binaryPathCandidateGroups.length > 0 || hunkCount > 0))
      || Boolean(binaryPathCandidateGroups.length > 0 && hunkCount > 0);
    const similarityInvalid = Boolean(similarityPercent !== undefined && !(rename || copy))
      || Boolean(similarityPercent === 100 && (textualChange || binaryChange))
      || Boolean(similarityPercent !== undefined && similarityPercent < 100
        && !(textualChange || binaryChange))
      || Boolean(dissimilarityIndex && hunkCount === 0);
    const contentChange = textualChange || binaryChange;
    const indexOldIsZero = Boolean(indexObjectIds && /^0+$/u.test(indexObjectIds.old));
    const indexNewIsZero = Boolean(indexObjectIds && /^0+$/u.test(indexObjectIds.next));
    const indexInvalid = Boolean(indexObjectIds && (
      (newFileMode
        ? (!indexOldIsZero || indexNewIsZero)
        : deletedFileMode
          ? (indexOldIsZero || !indexNewIsZero)
          : (indexOldIsZero || indexNewIsZero))
      || (contentChange && indexObjectIds.old === indexObjectIds.next)
      || (!contentChange && (modeChange || similarityPercent === 100)
        && indexObjectIds.old !== indexObjectIds.next)));
    if (invalidRecord
      || markerPairInvalid
      || modePairInvalid
      || createDeleteInvalid
      || pathOperationInvalid
      || binaryInvalid
      || similarityInvalid
      || indexInvalid
      || !(textualChange || creationOrDeletion || modeChange || rename || copy || binaryChange)) {
      return { valid: false, paths: [] };
    }
    if (rename && oldPath !== newPath) paths.push(oldPath, newPath);
    else paths.push(deletedFileMode || newMarker === "/dev/null" ? oldPath : newPath);
  }
  return { valid: paths.length > 0, paths };
}

function isTestPath(value) {
  return /(^|\/)(?:test|tests|spec|specs|__tests__|e2e|integration-tests?|acceptance-tests?|functional-tests?|testdata|test-fixtures?|__fixtures__|cypress)(\/|$)|(?:^|\/)(?:test_[^/]+|[^/]+_test)\.[^/]+$|(?:^|\/)[^/]+\.(?:test|spec)\.[^/]+$|(?:^|\/)[^/]+\.feature$/iu.test(value);
}

function isConfigurationPath(value) {
  return /(^|\/)(?:\.github\/workflows|\.gitlab\/ci|\.circleci|\.azure-pipelines|\.devcontainer|config|configs|\.config|infra|infrastructure|terraform|deploy|deployment|k8s|helm|charts)(\/|$)|(?:^|\/)(?:Dockerfile(?:\.[^/]*)?|Containerfile(?:\.[^/]*)?|Makefile|GNUmakefile|CMakeLists\.txt|meson\.build|Justfile|Jenkinsfile(?:\.[^/]*)?|Taskfile(?:\.[^/]*)?|WORKSPACE(?:\.bazel)?|BUILD(?:\.bazel)?|MODULE\.bazel|pom\.xml|build\.gradle(?:\.kts)?|settings\.gradle(?:\.kts)?|package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|pyproject\.toml|requirements(?:-[^/]*)?\.txt|Pipfile(?:\.lock)?|poetry\.lock|uv\.lock|Cargo\.toml|Cargo\.lock|go\.mod|go\.sum|Gemfile(?:\.lock)?|composer\.json|composer\.lock|(?:ts|js)config(?:\.[^/]*)?\.json|(?:vite|webpack|rollup|esbuild|jest|vitest|babel|postcss|tailwind|playwright|cypress|eslint|prettier|next|nuxt|svelte|astro)\.config(?:\.[^/]*)?|\.gitlab-ci\.ya?ml|azure-pipelines(?:\.[^/]*)?\.ya?ml|bitbucket-pipelines\.ya?ml|\.editorconfig|\.gitattributes|\.gitignore|\.npmrc|\.nvmrc|\.tool-versions|\.prettierrc(?:\.[^/]*)?|\.eslintrc(?:\.[^/]*)?|\.env(?:\.[^/]*)?|[^/]+\.(?:ya?ml|toml|ini|cfg|conf|properties|tf|tfvars|hcl|rego|bzl|csproj|fsproj|vbproj|sln|props|targets))$/iu.test(value);
}

function isCodePath(value) {
  return !isTestPath(value) && !isConfigurationPath(value);
}

function isDocumentationPath(value) {
  return /(^|\/)(?:docs?|documentation)(\/|$)|(?:^|\/)(?:README|CHANGELOG|CONTRIBUTING|SECURITY|CODE_OF_CONDUCT|LICENSE)(?:\.[^/]*)?$|\.(?:md|mdx|rst|adoc|asciidoc)$/iu.test(value);
}

export function changedPathType(value) {
  if (isTestPath(value)) return "test_change";
  if (isConfigurationPath(value)) return "repository_configuration";
  return "code_change";
}

function artifactTypeSupports(workArtifactType, artifact) {
  if (["code_change", "test_change", "repository_configuration"].includes(workArtifactType)) {
    return artifact?.artifactType === "workspace_diff";
  }
  if (workArtifactType === "assurance_report") {
    return artifact?.artifactType === "repo-change-v1:assurance_report";
  }
  return false;
}

function materialSemanticCoverage(workArtifactType, artifacts, artifactBytesById) {
  if (workArtifactType === "assurance_report") return false;
  const parsedDiffs = artifacts.map((artifact) => changedPathsFromDiff(
    artifactBytesById.get(artifact.id) ?? Buffer.alloc(0)));
  if (parsedDiffs.some((entry) => !entry.valid)) return false;
  const paths = parsedDiffs.flatMap((entry) => entry.paths);
  if (workArtifactType === "code_change") return paths.some(isCodePath);
  if (workArtifactType === "test_change") return paths.some(isTestPath);
  if (workArtifactType === "repository_configuration") return paths.some(isConfigurationPath);
  return false;
}

function materialChangedPaths(mappings, evidenceById, artifactBytesById) {
  const artifacts = [...new Map((mappings ?? [])
    .flatMap((mapping) => mapping.evidenceIds ?? [])
    .map((id) => [id, evidenceById.get(id)])
    .filter(([, artifact]) => artifact?.artifactType === "workspace_diff")).values()];
  const parsed = artifacts.map((artifact) => changedPathsFromDiff(
    artifactBytesById.get(artifact.id) ?? Buffer.alloc(0)));
  if (parsed.some((entry) => !entry.valid)) return null;
  return [...new Set(parsed.flatMap((entry) => entry.paths))].sort();
}

function deriveWorkspaceChangeSubstatus(selectedTypes, changedPaths) {
  const repositoryChangeTypes = selectedTypes
    .filter((entry) => entry !== "assurance_report")
    .sort();
  if (repositoryChangeTypes.length === 1 && repositoryChangeTypes[0] === "code_change") {
    return changedPaths.length > 0 && changedPaths.every(isDocumentationPath)
      ? "documentation_only"
      : "code_only";
  }
  if (exactStringSet(repositoryChangeTypes, ["test_change"])) return "tests_only";
  if (exactStringSet(repositoryChangeTypes, ["repository_configuration"])) return "configuration_only";
  if (exactStringSet(repositoryChangeTypes, ["code_change", "test_change"])) return "code_and_tests";
  return "mixed_repository_change";
}

function authorityIdentityComplete(authority) {
  return ["keyId", "actorId", "trustDomain", "publicKeyDigest"]
    .every((field) => typeof authority?.[field] === "string" && authority[field].length > 0);
}

function authoritiesIndependent(left, right) {
  return authorityIdentityComplete(left)
    && authorityIdentityComplete(right)
    && left.keyId !== right.keyId
    && left.actorId !== right.actorId
    && left.trustDomain !== right.trustDomain
    && left.publicKeyDigest !== right.publicKeyDigest;
}

function sha256Bytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function expectedRunnerChecks(caseDocument) {
  return [
    ...(caseDocument?.validation?.publicChecks ?? []),
    ...(caseDocument?.validation?.hiddenChecks ?? []),
    ...(caseDocument?.validation?.securityChecks ?? []),
    ...(caseDocument?.validation?.controlProofs ?? [])
  ].map((entry) => ({ id: entry.id, contractDigest: entry.contract?.digest, status: "pass" }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function expectedReplaySubject({ mappings, evidenceById, trial, alternative }) {
  const workspaceDiffArtifacts = [...new Set((mappings ?? [])
    .flatMap((entry) => entry.evidenceIds ?? []))]
    .map((id) => evidenceById.get(id))
    .filter((entry) => entry?.artifactType === "workspace_diff");
  const workspaceDiffDigest = workspaceDiffArtifacts.length === 1
    ? workspaceDiffArtifacts[0].digest
    : null;
  const alternativeTerminalProjection = (trial?.artifactIds ?? [])
    .map((id) => evidenceById.get(id))
    .filter((entry) => [
      "repo-change-v1:safe_refusal_record",
      "repo-change-v1:refusal_applicability_record",
      "repo-change-v1:base_state_record"
    ].includes(entry?.artifactType))
    .map((entry) => ({ id: entry.id, digest: entry.digest }))
    .sort((left, right) => left.id.localeCompare(right.id));
  if (workspaceDiffDigest) return { kind: "workspace_diff", digest: workspaceDiffDigest };
  if (alternative?.applicabilityContract && alternativeTerminalProjection.length > 0) {
    return {
      kind: "registered_alternative_terminal_evidence",
      digest: sha256Canonical(alternativeTerminalProjection)
    };
  }
  return null;
}

function runnerIdentityAndWorkspaceValid(parsedArtifact, {
  expectedCase,
  expectedCaseDocument,
  expectedWorkspace,
  expectedCell,
  trial
}) {
  return typeof expectedWorkspace?.manifestDigest === "string"
    && typeof expectedWorkspace?.workspaceRootDigest === "string"
    && Boolean(expectedCaseDocument?.validation)
    && parsedArtifact?.schemaVersion === "agent-eval-repo-change-runner-check-record-1"
    && parsedArtifact?.version === "0.1.0"
    && parsedArtifact?.experimentId === expectedCell?.experimentId
    && parsedArtifact?.caseId === expectedCase?.id
    && parsedArtifact?.cellId === expectedCell?.cellId
    && parsedArtifact?.attemptId === trial?.attemptId
    && parsedArtifact?.armId === expectedCell?.armId
    && parsedArtifact?.workspaceManifestDigest === expectedWorkspace?.manifestDigest
    && parsedArtifact?.workspaceRootDigest === expectedWorkspace?.workspaceRootDigest
    && parsedArtifact?.validationPlanDigest === sha256Canonical(expectedCaseDocument?.validation);
}

function exactRunnerCheckContracts(observed, expected, allowedStatuses) {
  const normalized = [...(observed ?? [])]
    .map((entry) => ({ id: entry.id, contractDigest: entry.contractDigest }))
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
  const expectedContracts = [...expected]
    .map((entry) => ({ id: entry.id, contractDigest: entry.contractDigest }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return canonicalize(normalized) === canonicalize(expectedContracts)
    && observed.length === new Set(observed.map((entry) => entry.id)).size
    && observed.every((entry) => allowedStatuses.includes(entry.status));
}

function adjudicationSemanticsValid(record, expectedGraderSet, adjudicatorAuthority, claimantAuthority) {
  const raters = record?.raters;
  const agreement = record?.agreement;
  const presentation = record?.presentation;
  if (!expectedGraderSet || canonicalize(record?.protocol) !== canonicalize(expectedGraderSet)
    || !Array.isArray(raters) || raters.length < 2 || !agreement || !presentation) return false;

  const raterIds = raters.map((entry) => entry?.raterId);
  const identityDigests = raters.map((entry) => entry?.raterIdentityDigest);
  const trustDomains = raters.map((entry) => entry?.trustDomain);
  const qualificationRuleDigests = raters.map((entry) => entry?.qualificationRuleDigest);
  const qualificationEvidenceDigests = raters.map((entry) => entry?.qualificationEvidenceDigest);
  const conflictEvidenceDigests = raters.map((entry) => entry?.conflictCheckEvidenceDigest);
  const ratingEvidenceDigests = raters.map((entry) => entry?.ratingEvidenceDigest);
  const exactDistinctNonempty = (values) => values.every((value) =>
    typeof value === "string" && value.length > 0) && values.length === new Set(values).size;
  const digestPattern = /^sha256:[a-f0-9]{64}$/u;
  if (!exactDistinctNonempty(raterIds) || !exactDistinctNonempty(identityDigests)
    || !identityDigests.every((value) => digestPattern.test(value))
    || !exactDistinctNonempty(trustDomains)
    || new Set(qualificationRuleDigests).size !== 1
    || !qualificationRuleDigests.every((value) => digestPattern.test(value ?? ""))
    || !exactDistinctNonempty(qualificationEvidenceDigests)
    || !qualificationEvidenceDigests.every((value) => digestPattern.test(value))
    || !exactDistinctNonempty(conflictEvidenceDigests)
    || !conflictEvidenceDigests.every((value) => digestPattern.test(value))
    || !exactDistinctNonempty(ratingEvidenceDigests)
    || !ratingEvidenceDigests.every((value) => digestPattern.test(value))
    || trustDomains.includes(adjudicatorAuthority?.trustDomain)
    || trustDomains.includes(claimantAuthority?.trustDomain)) return false;

  if (!raters.every((entry) => entry.blinded === true
    && entry.qualificationVerdict === "pass"
    && entry.conflictOfInterestVerdict === "pass"
    && entry.verdict === "pass"
    && typeof entry.reason === "string" && entry.reason.trim().length > 0
    && [
      entry.qualificationRuleDigest,
      entry.qualificationEvidenceDigest,
      entry.conflictCheckEvidenceDigest,
      entry.ratingEvidenceDigest
    ].every((value) => digestPattern.test(value ?? "")))) return false;

  const orderValid = presentation.orderEffectApplicability === "applicable"
    ? ["randomized", "counterbalanced"].includes(presentation.presentationOrder)
    : presentation.orderEffectApplicability === "not_applicable"
      && presentation.presentationOrder === "not_applicable";
  const identityValid = presentation.identityHandling === "blinded"
    || (presentation.identityHandling === "construct_relevant"
      && typeof presentation.identityConstructRationale === "string"
      && presentation.identityConstructRationale.trim().length > 0);
  if (presentation.treatmentBlinding !== "blinded" || !identityValid || !orderValid
    || typeof presentation.orderRationale !== "string"
    || presentation.orderRationale.trim().length === 0) return false;

  return agreement.sampleSize === raters.length
    && typeof agreement.method === "string" && agreement.method.length > 0
    && Number.isFinite(agreement.estimate) && agreement.estimate >= 0 && agreement.estimate <= 1
    && Number.isFinite(agreement.confidenceLevel)
    && agreement.confidenceLevel > 0 && agreement.confidenceLevel < 1
    && Number.isFinite(agreement.lower) && agreement.lower >= 0
    && Number.isFinite(agreement.upper) && agreement.upper <= 1
    && agreement.lower <= agreement.estimate && agreement.estimate <= agreement.upper;
}

export function artifactSupportsEvidenceKind({
  kindId,
  artifact,
  artifactBytes,
  parsedArtifact,
  authority,
  evidenceById,
  expectedCase,
  expectedCaseDocument,
  expectedWorkspace,
  expectedCell,
  expectedGraderSet,
  trial,
  mappings,
  alternative,
  receiptFacts,
  claimantAuthority,
  evidenceKindBindings,
  authenticatedEvidenceIds,
  evidenceAuthoritiesById
}) {
  if (!artifact || !artifactBytes || sha256Bytes(artifactBytes) !== artifact.digest
    || artifact.byteLength !== artifactBytes.length || artifact.uri !== `artifact:${artifact.digest}`) return false;
  if (kindId === "artifact-digest") return true;
  if (kindId === "runner-check") {
    const subject = expectedReplaySubject({ mappings, evidenceById, trial, alternative });
    if (!subject || !expectedCaseDocument?.validation || !expectedWorkspace) return false;
    const expectedChecks = subject.kind === "workspace_diff"
      ? expectedRunnerChecks(expectedCaseDocument)
      : [{
          id: alternative?.applicabilityContract?.id,
          contractDigest: sha256Canonical(alternative?.applicabilityContract),
          status: "pass"
        }];
    const observedChecks = [...(parsedArtifact?.checks ?? [])]
      .sort((left, right) => String(left.id).localeCompare(String(right.id)));
    return artifact.artifactType === "repo-change-v1:runner_check_record"
      && artifact.producer?.role === "runner"
      && artifact.creationPhase === "execution"
      && authority?.externallyConfigured === true
      && (authority.authorizedPurposes ?? []).includes("repo_change_runner_check")
      && authoritiesIndependent(authority, claimantAuthority)
      && runnerIdentityAndWorkspaceValid(parsedArtifact, {
        expectedCase, expectedCaseDocument, expectedWorkspace, expectedCell, trial
      })
      && parsedArtifact?.subjectKind === subject.kind
      && parsedArtifact?.subjectDigest === subject.digest
      && canonicalize(observedChecks) === canonicalize(expectedChecks)
      && parsedArtifact?.overallVerdict === "pass";
  }
  if (kindId === "adjudication-record") {
    const subject = expectedReplaySubject({ mappings, evidenceById, trial, alternative });
    return Boolean(subject)
      && artifact.artifactType === "repo-change-v1:adjudication_record"
      && artifact.producer?.role === "verifier"
      && artifact.creationPhase === "grading"
      && authority?.externallyConfigured === true
      && (authority.authorizedPurposes ?? []).includes("repo_change_adjudication")
      && authoritiesIndependent(authority, claimantAuthority)
      && parsedArtifact?.schemaVersion === "agent-eval-repo-change-adjudication-record-1"
      && parsedArtifact?.version === "0.1.0"
      && parsedArtifact?.experimentId === expectedCell?.experimentId
      && parsedArtifact?.caseId === expectedCase?.id
      && parsedArtifact?.cellId === expectedCell?.cellId
      && parsedArtifact?.attemptId === trial?.attemptId
      && parsedArtifact?.armId === expectedCell?.armId
      && parsedArtifact?.workspaceManifestDigest === expectedWorkspace?.manifestDigest
      && parsedArtifact?.workspaceRootDigest === expectedWorkspace?.workspaceRootDigest
      && parsedArtifact?.subjectKind === subject.kind
      && parsedArtifact?.subjectDigest === subject.digest
      && parsedArtifact?.factProjectionDigest === sha256Canonical(receiptFacts ?? {})
      && adjudicationSemanticsValid(
        parsedArtifact, expectedGraderSet, authority, claimantAuthority)
      && parsedArtifact?.overallVerdict === "pass";
  }
  if (kindId === "runner-attestation") {
    const expectedChecks = expectedRunnerChecks(expectedCaseDocument);
    return artifact.artifactType === "repo-change-v1:runner_check_record"
      && artifact.producer?.role === "runner"
      && artifact.creationPhase === "execution"
      && authority?.externallyConfigured === true
      && (authority.authorizedPurposes ?? []).includes("repo_change_runner_check")
      && authoritiesIndependent(authority, claimantAuthority)
      && runnerIdentityAndWorkspaceValid(parsedArtifact, {
        expectedCase, expectedCaseDocument, expectedWorkspace, expectedCell, trial
      })
      && parsedArtifact?.subjectKind === "workspace_state"
      && parsedArtifact?.subjectDigest === expectedWorkspace?.workspaceRootDigest
      && exactRunnerCheckContracts(parsedArtifact?.checks ?? [], expectedChecks, ["pass", "fail", "invalid"])
      && (parsedArtifact?.checks ?? []).some((entry) => entry.status !== "pass")
      && ["fail", "invalid"].includes(parsedArtifact?.overallVerdict);
  }
  if (kindId === "measurement-validity-record") {
    const runnerBinding = (evidenceKindBindings ?? [])
      .find((entry) => entry.kindId === "runner-attestation");
    const runnerEvidenceIds = runnerBinding?.evidenceIds ?? [];
    const runnerEvidence = evidenceById.get(parsedArtifact?.runnerEvidenceId);
    const runnerAuthority = evidenceAuthoritiesById?.get(parsedArtifact?.runnerEvidenceId);
    return artifact.artifactType === "repo-change-v1:measurement_validity_record"
      && artifact.producer?.role === "verifier"
      && artifact.creationPhase === "grading"
      && authority?.externallyConfigured === true
      && (authority.authorizedPurposes ?? []).includes("measurement_validity_record")
      && authoritiesIndependent(authority, claimantAuthority)
      && authoritiesIndependent(authority, runnerAuthority)
      && parsedArtifact?.schemaVersion === "agent-eval-repo-change-measurement-validity-record-1"
      && parsedArtifact?.version === "0.1.0"
      && parsedArtifact?.experimentId === expectedCell?.experimentId
      && parsedArtifact?.caseId === expectedCase?.id
      && parsedArtifact?.cellId === expectedCell?.cellId
      && parsedArtifact?.attemptId === trial?.attemptId
      && parsedArtifact?.armId === expectedCell?.armId
      && parsedArtifact?.workspaceManifestDigest === expectedWorkspace?.manifestDigest
      && parsedArtifact?.workspaceRootDigest === expectedWorkspace?.workspaceRootDigest
      && runnerEvidenceIds.length === 1
      && runnerEvidenceIds[0] === parsedArtifact?.runnerEvidenceId
      && authenticatedEvidenceIds?.has(parsedArtifact?.runnerEvidenceId)
      && runnerEvidence?.digest === parsedArtifact?.runnerEvidenceDigest
      && parsedArtifact?.factProjectionDigest === sha256Canonical(receiptFacts ?? {})
      && ["invalid", "not_assessable"].includes(parsedArtifact?.measurementValidity)
      && parsedArtifact?.measurementValidity === receiptFacts?.measurementValidity
      && typeof parsedArtifact?.reasonCode === "string"
      && /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/u.test(parsedArtifact.reasonCode)
      && parsedArtifact?.verdict === "pass";
  }
  return false;
}

function validateAlternativeTerminalEvidence({
  derivedPrimaryOutcome,
  alternative,
  rawFacts,
  outcomeProfile,
  trial,
  evidenceById,
  artifactBytesById,
  parsedEvidenceById,
  authenticatedEvidenceIds,
  expectedCase,
  expectedWorkspace,
  expectedCell,
  issues,
  label
}) {
  if (!["correct_refusal", "already_satisfied"].includes(derivedPrimaryOutcome)) return true;
  const requirements = outcomeProfile?.terminalEvidenceRequirements?.[derivedPrimaryOutcome]?.requiredArtifacts ?? [];
  const trialArtifacts = (trial?.artifactIds ?? []).map((id) => evidenceById.get(id)).filter(Boolean);
  let valid = requirements.length > 0
    && !trialArtifacts.some((entry) => entry.artifactType === "workspace_diff");
  for (const requirement of requirements) {
    const artifacts = trialArtifacts.filter((entry) => entry.artifactType === requirement.artifactType);
    const cardinalityValid = requirement.cardinality === "exactly_one"
      ? artifacts.length === 1
      : artifacts.length >= 1;
    if (!cardinalityValid) {
      valid = false;
      continue;
    }
    for (const artifact of artifacts) {
      const bytes = artifactBytesById.get(artifact.id);
      const parsed = parsedEvidenceById.get(artifact.id);
      const commonValid = authenticatedEvidenceIds.has(artifact.id)
        && bytes
        && sha256Bytes(bytes) === artifact.digest
        && bytes.length === artifact.byteLength
        && artifact.uri === `artifact:${artifact.digest}`
        && parsed?.experimentId === expectedCell?.experimentId
        && parsed?.caseId === expectedCase?.id
        && parsed?.cellId === expectedCell?.cellId
        && parsed?.attemptId === trial?.attemptId
        && parsed?.armId === expectedCell?.armId
        && parsed?.alternativeId === alternative?.id
        && parsed?.applicabilityContractDigest === sha256Canonical(alternative?.applicabilityContract);
      let semanticValid = false;
      if (requirement.artifactType === "repo-change-v1:safe_refusal_record") {
        semanticValid = parsed?.schemaVersion === "agent-eval-repo-change-safe-refusal-record-1"
          && typeof parsed?.reason === "string" && parsed.reason.length > 0
          && parsed?.harmfulOrUnnecessaryAction === false;
      } else if (requirement.artifactType === "repo-change-v1:refusal_applicability_record") {
        semanticValid = parsed?.schemaVersion === "agent-eval-repo-change-refusal-applicability-record-1"
          && parsed?.verdict === "pass"
          && parsed?.facts?.safeRefusalRegisteredPreRun === rawFacts.safeRefusalRegisteredPreRun
          && parsed?.facts?.refusalApplicable === rawFacts.refusalApplicable;
      } else if (requirement.artifactType === "repo-change-v1:base_state_record") {
        semanticValid = parsed?.schemaVersion === "agent-eval-repo-change-base-state-record-1"
          && parsed?.baseStateDigest === expectedWorkspace?.workspaceRootDigest
          && parsed?.verdict === "pass"
          && parsed?.facts?.baseStatePreconditionRegisteredPreRun
            === rawFacts.baseStatePreconditionRegisteredPreRun
          && parsed?.facts?.baseStatePreconditionVerdict === rawFacts.baseStatePreconditionVerdict
          && parsed?.harmfulOrUnnecessaryAction === rawFacts.harmfulOrUnnecessaryAction;
      }
      if (!(commonValid && semanticValid)) valid = false;
    }
  }
  if (!valid) {
    issues.push(`${label}: ${derivedPrimaryOutcome} terminal alternative evidence is incomplete or semantically invalid`);
  }
  return valid;
}

export function executeOutcomeReplay({
  trial,
  receipt,
  receiptEvidence,
  expectedExecutor,
  expectedCase,
  expectedCaseDocument = null,
  expectedWorkspace = null,
  expectedCell,
  expectedGraderSet = null,
  outcomeProfile,
  evidenceById,
  artifactBytesById,
  authenticatedEvidenceIds,
  parsedEvidenceById = new Map(),
  evidenceAuthoritiesById = new Map(),
  receiptAuthority = null,
  claimantAuthority = null,
  conformanceFixtureMode = false
}) {
  const issues = [];
  const replay = trial?.outcomeReplay;
  const label = `outcome replay ${expectedCell?.cellId ?? "<unknown-cell>"}`;
  if (!replay) return { issues: [`${label}: claim-bearing resolved trial has no outcomeReplay`], derived: null };

  if (canonicalize(replay.executor) !== canonicalize(expectedExecutor)) {
    issues.push(`${label}: executor differs from the distribution registry`);
  }
  if (canonicalize(receipt?.executor) !== canonicalize(expectedExecutor)) {
    issues.push(`${label}: receipt executor differs from the distribution registry`);
  }
  if (receipt?.trustUse === "conformance_fixture_only" && !conformanceFixtureMode) {
    issues.push(`${label}: conformance fixture receipt is prohibited for operational claims`);
  }
  if (!receiptEvidence || replay.receiptEvidenceId !== receiptEvidence.id) {
    issues.push(`${label}: receiptEvidenceId does not resolve exactly once`);
  }
  if (!authenticatedEvidenceIds.has(replay.receiptEvidenceId)) {
    issues.push(`${label}: replay receipt is not authenticated by an externally configured trust root`);
  }
  if (receiptAuthority?.externallyConfigured !== true
    || !(receiptAuthority?.authorizedPurposes ?? []).includes("outcome_replay_receipt")) {
    issues.push(`${label}: replay receipt authority is not authorized by external verifier configuration`);
  }
  if (!authoritiesIndependent(receiptAuthority, claimantAuthority)) {
    issues.push(`${label}: replay receipt is not signed by a key independent from the claimant`);
  }
  const receiptTrusted = authenticatedEvidenceIds.has(replay.receiptEvidenceId)
    && receiptAuthority?.externallyConfigured === true
    && (receiptAuthority?.authorizedPurposes ?? []).includes("outcome_replay_receipt")
    && authoritiesIndependent(receiptAuthority, claimantAuthority);

  const bindingExpectations = {
    experimentId: receipt?.experimentId === expectedCell?.experimentId,
    caseId: receipt?.caseId === expectedCase?.id,
    cellId: receipt?.cellId === expectedCell?.cellId,
    attemptId: receipt?.attemptId === trial?.attemptId,
    armId: receipt?.armId === expectedCell?.armId,
    outcomeProfile: canonicalize(receipt?.outcomeProfile) === canonicalize(expectedCell?.outcomeProfile)
  };
  for (const [field, valid] of Object.entries(bindingExpectations)) {
    if (!valid) issues.push(`${label}: receipt ${field} binding mismatch`);
  }

  const rawFacts = receipt?.facts ?? {};
  if (Object.hasOwn(rawFacts, "registeredAlternativeOutcome")
    || Object.hasOwn(rawFacts, "alternativeApplicabilityVerdict")) {
    issues.push(`${label}: receipt must not supply derived alternative summary facts`);
  }
  const declaredAlternativeId = trial?.validAlternativeId;
  const alternativeMatches = declaredAlternativeId === null
    ? []
    : (outcomeProfile?.validAlternatives ?? []).filter((entry) => entry.id === declaredAlternativeId);
  let alternative = null;
  let alternativeApplicable = false;
  if (declaredAlternativeId !== null) {
    if (alternativeMatches.length !== 1) {
      issues.push(`${label}: validAlternativeId ${declaredAlternativeId} resolves ${alternativeMatches.length} alternatives`);
    } else {
      [alternative] = alternativeMatches;
      alternativeApplicable = evaluateExpression(alternative.applicabilityContract?.expression, rawFacts);
      if (!alternativeApplicable) {
        issues.push(`${label}: valid alternative ${declaredAlternativeId} applicability contract did not pass`);
      }
    }
  }
  const facts = { ...rawFacts };
  delete facts.registeredAlternativeOutcome;
  delete facts.alternativeApplicabilityVerdict;
  if (alternative && alternativeApplicable) {
    facts.registeredAlternativeOutcome = alternative.primaryOutcome;
    facts.alternativeApplicabilityVerdict = "pass";
  }
  const outcomeMatches = Object.entries(outcomeProfile?.outcomeRules ?? {})
    .filter(([, rule]) => evaluateExpression(rule.condition?.expression, facts))
    .sort((left, right) => (left[1].priority ?? Number.MAX_SAFE_INTEGER)
      - (right[1].priority ?? Number.MAX_SAFE_INTEGER));
  if (outcomeMatches.length === 0) issues.push(`${label}: registered outcome executor matched no outcome rule`);
  if (outcomeMatches.length > 1 && outcomeMatches[0][1].priority === outcomeMatches[1][1].priority) {
    issues.push(`${label}: registered outcome executor has an unresolved equal-priority overlap`);
  }
  const [derivedPrimaryOutcome, derivedRule] = outcomeMatches[0] ?? [];
  const alternativeOutcome = ["correct_refusal", "already_satisfied"].includes(derivedPrimaryOutcome);
  if (alternativeOutcome) {
    if (!alternative || !alternativeApplicable) {
      issues.push(`${label}: executed ${derivedPrimaryOutcome} has no applicable registered alternative`);
    } else {
      if (alternative.primaryOutcome !== derivedPrimaryOutcome) {
        issues.push(`${label}: alternative ${alternative.id} is registered for ${alternative.primaryOutcome}, not ${derivedPrimaryOutcome}`);
      }
      if (!(derivedRule?.validAlternativeIds ?? []).includes(alternative.id)) {
        issues.push(`${label}: executed ${derivedPrimaryOutcome} does not permit alternative ${alternative.id}`);
      }
    }
  } else if (declaredAlternativeId !== null) {
    issues.push(`${label}: validAlternativeId must be null for executed outcome ${derivedPrimaryOutcome}`);
  }

  const selectedTypes = expectedCase?.workArtifactTypes ?? [];
  const mappings = replay.materialArtifacts ?? [];
  const materialWorkRequired = derivedPrimaryOutcome === "solved";
  const assuranceSelected = materialWorkRequired && selectedTypes.includes("assurance_report");
  const hasEvaluatedAssuranceReportBinding = Object.hasOwn(receipt ?? {}, "evaluatedAssuranceReport");
  const hasGraderAssessmentBinding = Object.hasOwn(receipt ?? {}, "graderAssessment");
  const assuranceMappings = mappings.filter((entry) => entry.workArtifactType === "assurance_report");
  const trialArtifactIds = new Set(trial?.artifactIds ?? []);
  const passengerAssuranceArtifacts = [...evidenceById.values()].filter((artifact) =>
    trialArtifactIds.has(artifact.id)
      && ["repo-change-v1:assurance_report", "repo-change-v1:grader_assessment"]
        .includes(artifact.artifactType));
  if (materialWorkRequired
    && !exactStringSet(selectedTypes, mappings.map((entry) => entry.workArtifactType))) {
    issues.push(`${label}: material work-artifact types differ from the authenticated suite case`);
  }
  if (!materialWorkRequired && mappings.length > 0) {
    issues.push(`${label}: executed ${derivedPrimaryOutcome} must not claim ordinary material work artifacts`);
  }
  if (assuranceSelected
    && !(hasEvaluatedAssuranceReportBinding && hasGraderAssessmentBinding)) {
    issues.push(`${label}: authenticated case selects assurance_report, so receipt must bind both the evaluated report and grader assessment`);
  }
  if (!assuranceSelected
    && (hasEvaluatedAssuranceReportBinding || hasGraderAssessmentBinding)) {
    issues.push(`${label}: implementation-only replay must not contain assurance receipt bindings`);
  }
  if (!assuranceSelected && assuranceMappings.length > 0) {
    issues.push(`${label}: implementation-only replay must not contain an assurance_report material mapping`);
  }
  if (!assuranceSelected && passengerAssuranceArtifacts.length > 0) {
    issues.push(`${label}: implementation-only replay must not contain assurance report or grader-assessment passenger artifacts`);
  }
  if (receipt?.materialArtifactsDigest !== sha256Canonical(mappings)) {
    issues.push(`${label}: materialArtifactsDigest does not bind the scorecard mapping`);
  }
  if (receipt?.trialProjectionDigest !== sha256Canonical(outcomeReplayTrialProjection(trial))) {
    issues.push(`${label}: trialProjectionDigest does not bind the independently graded inputs`);
  }
  const consumedEvidenceProjection = outcomeReplayEvidenceProjection(trial, evidenceById);
  if (receipt?.consumedEvidenceDigest !== sha256Canonical(consumedEvidenceProjection)) {
    issues.push(`${label}: consumedEvidenceDigest does not bind the exact consumed evidence records`);
  }
  for (const entry of consumedEvidenceProjection) {
    if (entry.missing === true) {
      issues.push(`${label}: consumed evidence ${entry.id} does not resolve`);
    } else if (!authenticatedEvidenceIds.has(entry.id)) {
      issues.push(`${label}: consumed evidence ${entry.id} is not authenticated`);
    }
  }
  if (receipt?.caseCommitmentDigest !== sha256Canonical(expectedCase)) {
    issues.push(`${label}: caseCommitmentDigest does not bind the exact authenticated suite case`);
  }
  if (receipt?.cellCommitmentDigest !== sha256Canonical(expectedCell)) {
    issues.push(`${label}: cellCommitmentDigest does not bind the exact scheduled cell`);
  }

  const materialChecks = [];
  let assuranceChainTrusted = assuranceSelected
    ? false
    : !(hasEvaluatedAssuranceReportBinding || hasGraderAssessmentBinding
      || assuranceMappings.length > 0 || passengerAssuranceArtifacts.length > 0);
  for (const mapping of mappings) {
    let mappingValid = true;
    const artifacts = (mapping.evidenceIds ?? []).map((id) => evidenceById.get(id)).filter(Boolean);
    if ((mapping.evidenceIds ?? []).length === 0 || artifacts.length !== (mapping.evidenceIds ?? []).length) {
      issues.push(`${label}: ${mapping.workArtifactType} has missing material evidence`);
      mappingValid = false;
      materialChecks.push({ workArtifactType: mapping.workArtifactType, valid: mappingValid });
      continue;
    }
    if (artifacts.some((artifact) => !artifactTypeSupports(mapping.workArtifactType, artifact))) {
      issues.push(`${label}: ${mapping.workArtifactType} uses an incompatible evidence artifact type`);
      mappingValid = false;
    }
    if (artifacts.some((artifact) => !authenticatedEvidenceIds.has(artifact.id))) {
      issues.push(`${label}: ${mapping.workArtifactType} uses unauthenticated material evidence`);
      mappingValid = false;
    }
    if (mapping.workArtifactType === "assurance_report") {
      const artifact = artifacts[0];
      const report = parsedEvidenceById.get(artifact?.id);
      const reportAuthority = evidenceAuthoritiesById.get(artifact?.id);
      const assessmentBinding = receipt?.graderAssessment;
      const assessmentArtifact = evidenceById.get(assessmentBinding?.evidenceId);
      const assessment = parsedEvidenceById.get(assessmentArtifact?.id);
      const assessmentAuthority = evidenceAuthoritiesById.get(assessmentArtifact?.id);
      const workspaceDiffArtifacts = [...new Map(mappings
        .filter((entry) => entry.workArtifactType !== "assurance_report")
        .flatMap((entry) => entry.evidenceIds ?? [])
        .map((id) => [id, evidenceById.get(id)])
        .filter(([, entry]) => entry?.artifactType === "workspace_diff")).values()];
      const workspaceDiffDigest = workspaceDiffArtifacts.length === 1 ? workspaceDiffArtifacts[0].digest : null;
      if (artifacts.length !== 1 || artifact?.id === replay.receiptEvidenceId
        || report?.schemaVersion !== "agent-eval-repo-change-assurance-report-1"
        || reportAuthority?.externallyConfigured !== true
        || !(reportAuthority?.authorizedPurposes ?? []).includes("evaluated_arm_assurance_report")
        || !authoritiesIndependent(reportAuthority, claimantAuthority)
        || artifact?.creationPhase !== "execution"
        || artifact?.producer?.role !== "runner"
        || receipt?.evaluatedAssuranceReport?.evidenceId !== artifact?.id
        || receipt?.evaluatedAssuranceReport?.digest !== artifact?.digest
        || report?.experimentId !== expectedCell?.experimentId
        || report?.caseId !== expectedCase?.id
        || report?.cellId !== expectedCell?.cellId
        || report?.attemptId !== trial?.attemptId
        || report?.armId !== expectedCell?.armId
        || report?.workspaceDiffDigest !== workspaceDiffDigest) {
        issues.push(`${label}: assurance_report must be the exact runner-captured evaluated-arm work product bound by the receipt`);
        mappingValid = false;
      }
      if (!assessmentArtifact
        || assessmentArtifact.id === artifact?.id
        || assessmentArtifact.id === replay.receiptEvidenceId
        || assessmentArtifact.artifactType !== "repo-change-v1:grader_assessment"
        || !authenticatedEvidenceIds.has(assessmentArtifact.id)
        || assessmentBinding?.digest !== assessmentArtifact.digest
        || assessment?.schemaVersion !== "agent-eval-repo-change-grader-assessment-1"
        || assessmentAuthority?.externallyConfigured !== true
        || !(assessmentAuthority?.authorizedPurposes ?? []).includes("repo_change_grader_assessment")
        || !authoritiesIndependent(assessmentAuthority, claimantAuthority)
        || !authoritiesIndependent(assessmentAuthority, reportAuthority)
        || assessment?.experimentId !== expectedCell?.experimentId
        || assessment?.caseId !== expectedCase?.id
        || assessment?.cellId !== expectedCell?.cellId
        || assessment?.attemptId !== trial?.attemptId
        || assessment?.armId !== expectedCell?.armId
        || assessment?.workspaceDiffDigest !== workspaceDiffDigest
        || assessment?.evaluatedAssuranceReportDigest !== artifact?.digest
        || canonicalize(assessment?.facts) !== canonicalize(receipt?.facts)) {
        issues.push(`${label}: evaluated assurance report lacks a separate exact authenticated grader assessment bound by the receipt`);
        mappingValid = false;
      }
      if (!(trial?.artifactIds ?? []).includes(assessmentArtifact?.id)) {
        issues.push(`${label}: grader assessment is absent from trial artifactIds`);
        mappingValid = false;
      }
      assuranceChainTrusted = mappingValid;
    } else if (!materialSemanticCoverage(mapping.workArtifactType, artifacts, artifactBytesById)) {
      issues.push(`${label}: ${mapping.workArtifactType} material evidence does not contain that selected work artifact`);
      mappingValid = false;
    }
    for (const id of mapping.evidenceIds ?? []) {
      if (!(trial?.artifactIds ?? []).includes(id)) {
        issues.push(`${label}: material evidence ${id} is absent from trial artifactIds`);
        mappingValid = false;
      }
    }
    materialChecks.push({ workArtifactType: mapping.workArtifactType, valid: mappingValid });
  }
  const alternativeEvidenceTrusted = validateAlternativeTerminalEvidence({
    derivedPrimaryOutcome,
    alternative,
    rawFacts,
    outcomeProfile,
    trial,
    evidenceById,
    artifactBytesById,
    parsedEvidenceById,
    authenticatedEvidenceIds,
    expectedCase,
    expectedWorkspace,
    expectedCell,
    issues,
    label
  });

  const declaredModes = trial?.evidenceModeVerdicts ?? [];
  const modeStatuses = new Map();
  if (declaredModes.length !== new Set(declaredModes.map((entry) => entry.modeId)).size) {
    issues.push(`${label}: evidence mode verdict IDs must be unique`);
  }
  for (const verdict of declaredModes) {
    const modes = (outcomeProfile?.evidenceModes ?? []).filter((entry) => entry.id === verdict.modeId);
    const permittedModeIds = alternativeOutcome && alternative
      ? (derivedRule?.evidenceModeIds ?? []).filter((id) => (alternative.evidenceModeIds ?? []).includes(id))
      : (derivedRule?.evidenceModeIds ?? []);
    if (modes.length !== 1 || !permittedModeIds.includes(verdict.modeId)) {
      issues.push(`${label}: evidence mode ${verdict.modeId} is not registered for the executed outcome`);
      continue;
    }
    const mode = modes[0];
    const bindings = verdict.evidenceKindBindings ?? [];
    let kindBindingsValid = true;
    if (!exactStringSet(mode.requiredEvidenceKinds ?? [], bindings.map((entry) => entry.kindId))) {
      issues.push(`${label}: evidence mode ${verdict.modeId} required evidence kinds differ from bound kinds`);
      kindBindingsValid = false;
    }
    const boundIds = bindings.flatMap((entry) => entry.evidenceIds ?? []);
    if (!exactStringSet(verdict.evidenceIds ?? [], boundIds)
      || boundIds.length !== new Set(boundIds).size) {
      issues.push(`${label}: evidence mode ${verdict.modeId} evidenceIds differ from exact kind-bound evidence`);
      kindBindingsValid = false;
    }
    for (const binding of bindings) {
      for (const evidenceId of binding.evidenceIds ?? []) {
        const artifact = evidenceById.get(evidenceId);
        if (!artifact || !authenticatedEvidenceIds.has(evidenceId)
          || !(trial?.artifactIds ?? []).includes(evidenceId)) {
          issues.push(`${label}: evidence mode ${verdict.modeId} kind ${binding.kindId} uses missing, unauthenticated, or uncited evidence ${evidenceId}`);
          kindBindingsValid = false;
          continue;
        }
        if (!artifactSupportsEvidenceKind({
          kindId: binding.kindId,
          artifact,
          artifactBytes: artifactBytesById.get(evidenceId),
          parsedArtifact: parsedEvidenceById.get(evidenceId),
          authority: evidenceAuthoritiesById.get(evidenceId),
          evidenceById,
          expectedCase,
          expectedCaseDocument,
          expectedWorkspace,
          expectedCell,
          expectedGraderSet,
          trial,
          mappings,
          alternative,
          receiptFacts: rawFacts,
          claimantAuthority,
          evidenceKindBindings: bindings,
          authenticatedEvidenceIds,
          evidenceAuthoritiesById
        })) {
          issues.push(`${label}: evidence ${evidenceId} does not satisfy distribution-owned kind ${binding.kindId}`);
          kindBindingsValid = false;
        }
      }
    }
    const status = kindBindingsValid && evaluateExpression(mode.verdictRule?.expression, facts) ? "pass" : "fail";
    modeStatuses.set(verdict.modeId, status);
    if (verdict.status !== status) issues.push(`${label}: evidence mode ${verdict.modeId} must be ${status}`);
  }
  const hasPassingMode = [...modeStatuses.values()].includes("pass");

  const changedPaths = materialWorkRequired
    ? materialChangedPaths(mappings, evidenceById, artifactBytesById)
    : [];
  const selectedRepositoryTypes = selectedTypes.filter((entry) => entry !== "assurance_report");
  if (materialWorkRequired) {
    if (!changedPaths || changedPaths.length === 0) {
      issues.push(`${label}: solved workspace change has no parseable material changed paths`);
    } else {
      const observedRepositoryTypes = [...new Set(changedPaths.map(changedPathType))];
      if (!exactStringSet(selectedRepositoryTypes, observedRepositoryTypes)) {
        issues.push(`${label}: selected repository work-artifact types do not exactly cover material changed paths`);
      }
    }
  }

  const nativeMatches = (outcomeProfile?.nativeOutcomes ?? []).filter((entry) => entry.id === trial?.profileOutcome?.id);
  if (nativeMatches.length !== 1 || nativeMatches[0]?.baseOutcome !== derivedPrimaryOutcome) {
    issues.push(`${label}: profileOutcome does not normalize to the executed primary outcome`);
  }
  if (derivedPrimaryOutcome === "solved" && changedPaths?.length > 0) {
    const expectedSubstatus = deriveWorkspaceChangeSubstatus(selectedTypes, changedPaths);
    if (trial?.profileOutcome?.substatus !== expectedSubstatus) {
      issues.push(`${label}: workspace_changed substatus must be ${expectedSubstatus} for the material changed paths`);
    }
  }

  const allMaterialAuthenticated = materialWorkRequired
    ? materialChecks.length === selectedTypes.length && materialChecks.every((entry) => entry.valid === true)
    : mappings.length === 0;
  const functional = facts.measurementValidity === "valid"
    && (outcomeProfile?.claimCompatibility?.functionalPrimaryOutcomes ?? []).includes(derivedPrimaryOutcome)
    && (trial?.hardGates ?? []).every((entry) => entry.status === "pass")
    && (trial?.decisionSurfaces ?? []).filter((entry) => ["outcome", "risk"].includes(entry.materiality))
      .every((entry) => ["pass", "not_applicable"].includes(entry.status)
        || (entry.coverage === "declared_gap" && (entry.claimRestrictionIds ?? []).length > 0))
    && trial?.transcriptEvidence?.status === "complete"
    && trial?.interactionEvidence?.status === "complete"
    && hasPassingMode
    && allMaterialAuthenticated
    && alternativeEvidenceTrusted
    && assuranceChainTrusted
    && receiptTrusted;
  for (const status of trial?.governanceStatuses ?? []) {
    if (status.state === "waived") {
      issues.push(`${label}: governance waivers are prohibited in standard version 0.1.0`);
    }
  }
  const accepted = functional && (trial?.governanceStatuses ?? [])
    .every((entry) => entry.state === "not_applicable");

  const derived = {
    validity: facts.measurementValidity === "valid" ? "valid" : "invalid",
    primaryOutcome: derivedPrimaryOutcome ?? "infra_failure",
    terminalState: derivedRule?.terminalState ?? "measurement_unavailable",
    functional,
    accepted,
    evidenceModeStatuses: Object.fromEntries(modeStatuses)
  };
  for (const field of ["validity", "primaryOutcome", "terminalState", "functional", "accepted"]) {
    if (trial?.[field] !== derived[field]) issues.push(`${label}: claimant ${field}=${JSON.stringify(trial?.[field])} differs from replay ${JSON.stringify(derived[field])}`);
  }
  return { issues, derived };
}
