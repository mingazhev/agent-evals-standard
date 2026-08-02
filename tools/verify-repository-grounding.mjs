#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}

export function sha256Bytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function sha256Canonical(value) {
  return sha256Bytes(Buffer.from(canonicalize(value), "utf8"));
}

function fileProjection(file) {
  return {
    path: file.path,
    mode: file.mode,
    mediaType: file.mediaType,
    byteLength: file.byteLength,
    digest: file.digest
  };
}

export function repositoryTreeDigest(repository, removedObjectDigests = []) {
  const removed = new Set(removedObjectDigests);
  const projection = {
    files: (repository.files ?? [])
      .filter((file) => !removed.has(file.digest))
      .map(fileProjection)
  };
  if ((repository.gitlinks ?? []).length > 0) {
    projection.gitlinks = repository.gitlinks.map(({ path, repositoryId, targetCommit }) => ({
      path,
      repositoryId,
      targetCommit
    }));
  }
  return sha256Canonical(projection);
}

function workspaceProjection(manifest, removedObjectDigests = new Set()) {
  return {
    repositories: (manifest.repositories ?? []).map((repository) => {
      const projection = {
        id: repository.id,
        path: repository.path,
        objectFormat: repository.objectFormat,
        treeDigest: repositoryTreeDigest(repository, [...removedObjectDigests]),
        gitObjectGraphDigest: repository.gitObjectGraph?.digest,
        historyProjection: repository.historyProjection
      };
      if (repository.baseTree !== undefined) projection.baseTree = repository.baseTree;
      if (repository.baseRevision !== undefined) projection.baseRevision = repository.baseRevision;
      return projection;
    })
  };
}

export function workspaceRootDigest(manifest, removedObjectDigests = []) {
  return sha256Canonical(workspaceProjection(manifest, new Set(removedObjectDigests)));
}

function decodeCanonicalBase64(value, label, issues) {
  if (typeof value !== "string") {
    issues.push(`${label}: contentBase64 is not a string`);
    return null;
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) issues.push(`${label}: non-canonical base64`);
  return bytes;
}

function gitHashAlgorithm(objectFormat) {
  return objectFormat === "sha1" ? "sha1" : objectFormat === "sha256" ? "sha256" : null;
}

export function gitObjectId(objectFormat, type, content) {
  const algorithm = gitHashAlgorithm(objectFormat);
  if (!algorithm || !["blob", "tree", "commit"].includes(type)) return null;
  const header = Buffer.from(`${type} ${content.length}\0`, "utf8");
  return createHash(algorithm).update(header).update(content).digest("hex");
}

export function gitObjectGraphDigest(repository) {
  const graph = repository.gitObjectGraph ?? {};
  const projection = {
    objectFormat: repository.objectFormat,
    refs: graph.refs ?? [],
    objects: (graph.objects ?? []).map((object) => {
      const content = Buffer.from(object.contentBase64 ?? "", "base64");
      return {
        objectId: object.objectId,
        type: object.type,
        byteLength: object.byteLength,
        contentDigest: sha256Bytes(content)
      };
    })
  };
  if (graph.baseRef !== undefined) projection.baseRef = graph.baseRef;
  return sha256Canonical(projection);
}

function isGitLfsPointer(content) {
  const lf = Buffer.from("version https://git-lfs.github.com/spec/v1\n", "ascii");
  const crlf = Buffer.from("version https://git-lfs.github.com/spec/v1\r\n", "ascii");
  return content.subarray(0, lf.length).equals(lf)
    || content.subarray(0, crlf.length).equals(crlf);
}

function isUnicodeScalarString(value) {
  return typeof value === "string" && Buffer.from(value, "utf8").toString("utf8") === value;
}

function isSafeRepositoryRelativePath(value) {
  if (!isUnicodeScalarString(value) || value.length === 0 || value.includes("\0")
    || value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:\//u.test(value)) {
    return false;
  }
  return value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function startsWithBytes(value, prefix) {
  return value.length >= prefix.length && value.subarray(0, prefix.length).equals(prefix);
}

function parseGitCommit(content, objectId, idLength, issues) {
  const separator = content.indexOf(Buffer.from("\n\n", "utf8"));
  if (separator < 0) {
    issues.push(`Git commit ${objectId}: missing header/message separator`);
    return { tree: null, parents: [] };
  }
  const headerBytes = content.subarray(0, separator);
  const treePrefix = Buffer.from("tree ", "ascii");
  const parentPrefix = Buffer.from("parent ", "ascii");
  const treeLines = [];
  const parents = [];
  for (const line of headerBytes.toString("latin1").split("\n").map((entry) => Buffer.from(entry, "latin1"))) {
    if (startsWithBytes(line, treePrefix)) treeLines.push(line.subarray(treePrefix.length).toString("latin1"));
    if (startsWithBytes(line, parentPrefix)) parents.push(line.subarray(parentPrefix.length).toString("latin1"));
  }
  if (treeLines.length !== 1 || !new RegExp(`^[a-f0-9]{${idLength}}$`).test(treeLines[0] ?? "")) {
    issues.push(`Git commit ${objectId}: must contain exactly one valid tree header`);
  }
  for (const parent of parents) {
    if (!new RegExp(`^[a-f0-9]{${idLength}}$`).test(parent)) {
      issues.push(`Git commit ${objectId}: invalid parent ${parent}`);
    }
  }
  return { tree: treeLines[0] ?? null, parents };
}

function parseGitTree(content, objectId, objectIdBytes, issues) {
  const entries = [];
  let offset = 0;
  let previousSortKey = null;
  const names = new Set();
  while (offset < content.length) {
    const space = content.indexOf(0x20, offset);
    const nul = space < 0 ? -1 : content.indexOf(0x00, space + 1);
    if (space < 0 || nul < 0 || nul + 1 + objectIdBytes > content.length) {
      issues.push(`Git tree ${objectId}: truncated entry at byte ${offset}`);
      return entries;
    }
    const mode = content.subarray(offset, space).toString("ascii");
    const nameBytes = content.subarray(space + 1, nul);
    const name = nameBytes.toString("utf8");
    if (!Buffer.from(name, "utf8").equals(nameBytes)) {
      issues.push(`Git tree ${objectId}: entry name at byte ${offset} is not well-formed UTF-8`);
    } else if (name.length === 0 || name === "." || name === ".."
      || name.includes("/") || name.includes("\\") || name.includes("\0")) {
      issues.push(`Git tree ${objectId}: unsafe UTF-8 entry name at byte ${offset}`);
    }
    if (!/^(?:100644|100755|120000|160000|40000)$/.test(mode)) {
      issues.push(`Git tree ${objectId}/${name}: unsupported mode ${mode}`);
    }
    if (names.has(name)) issues.push(`Git tree ${objectId}: duplicate entry ${name}`);
    names.add(name);
    const target = content.subarray(nul + 1, nul + 1 + objectIdBytes).toString("hex");
    const sortKey = Buffer.concat([nameBytes, mode === "40000" ? Buffer.from("/", "ascii") : Buffer.alloc(0)]);
    if (previousSortKey !== null && Buffer.compare(previousSortKey, sortKey) >= 0) {
      issues.push(`Git tree ${objectId}: entries are not in canonical Git order`);
    }
    previousSortKey = sortKey;
    entries.push({ mode, name, target });
    offset = nul + 1 + objectIdBytes;
  }
  return entries;
}

function verifyRepositoryGitGraph(repository, issues) {
  const owner = repository.id ?? "unknown-repository";
  const algorithm = gitHashAlgorithm(repository.objectFormat);
  if (!algorithm) {
    issues.push(`${owner}: unsupported Git object format ${repository.objectFormat}`);
    return { baseGitlinks: [] };
  }
  const objectIdBytes = repository.objectFormat === "sha1" ? 20 : 32;
  const idLength = objectIdBytes * 2;
  const objectIdPattern = new RegExp(`^[a-f0-9]{${idLength}}$`);
  const graph = repository.gitObjectGraph ?? {};
  const projection = repository.historyProjection ?? {};
  const mode = projection.mode;
  const objectsById = new Map();
  let priorObjectId = null;
  for (const object of graph.objects ?? []) {
    const label = `${owner}: Git ${object.type ?? "object"} ${object.objectId ?? "unknown"}`;
    if (!objectIdPattern.test(object.objectId ?? "")) {
      issues.push(`${label}: objectId length must match ${repository.objectFormat}`);
    }
    if (objectsById.has(object.objectId)) issues.push(`${owner}: duplicate Git object ${object.objectId}`);
    if (priorObjectId !== null && object.objectId <= priorObjectId) {
      issues.push(`${owner}: Git objects must be strictly sorted by objectId`);
    }
    priorObjectId = object.objectId;
    const content = decodeCanonicalBase64(object.contentBase64, label, issues) ?? Buffer.alloc(0);
    if (content.length !== object.byteLength) issues.push(`${label}: byteLength must be ${content.length}`);
    const actualId = gitObjectId(repository.objectFormat, object.type, content);
    if (object.objectId !== actualId) issues.push(`${label}: objectId must be ${actualId}`);
    if (object.type === "blob" && isGitLfsPointer(content)) {
      issues.push(`${owner}: Git LFS pointer blob ${object.objectId} is excluded from workspace-manifest-1`);
    }
    objectsById.set(object.objectId, { ...object, content });
  }

  const expectedGraphDigest = gitObjectGraphDigest(repository);
  if (graph.digest !== expectedGraphDigest) issues.push(`${owner}: Git object-graph digest must be ${expectedGraphDigest}`);
  if (projection.objectGraphDigest !== expectedGraphDigest) {
    issues.push(`${owner}: history objectGraphDigest must be ${expectedGraphDigest}`);
  }
  const expectedVerifier = {
    id: "agent-evals-standard.git-repository-state-verifier",
    version: "0.1.0",
    algorithm: "git-repository-state-v1"
  };
  if (canonicalize(projection.verifier) !== canonicalize(expectedVerifier)) {
    issues.push(`${owner}: history verifier must be agent-evals-standard.git-repository-state-verifier 0.1.0 using git-repository-state-v1`);
  }
  if (!["tree_snapshot", "bounded_ancestry", "full_ancestry"].includes(mode)) {
    issues.push(`${owner}: unsupported repository-state mode ${mode}`);
    return { baseGitlinks: [] };
  }

  const refs = graph.refs ?? [];
  const refNames = new Set();
  let priorRefName = null;
  for (const ref of refs) {
    if (refNames.has(ref.name)) issues.push(`${owner}: duplicate Git ref ${ref.name}`);
    refNames.add(ref.name);
    if (priorRefName !== null && ref.name <= priorRefName) issues.push(`${owner}: Git refs must be strictly sorted by name`);
    priorRefName = ref.name;
    if (!/^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(ref.name ?? "")) {
      issues.push(`${owner}: only a sealed local branch ref is permitted`);
    }
    if (!objectsById.has(ref.target)) issues.push(`${owner}: ref ${ref.name} targets missing object ${ref.target}`);
  }

  let baseObject = null;
  if (mode === "tree_snapshot") {
    if (Object.hasOwn(graph, "baseRef") || refs.length !== 0) {
      issues.push(`${owner}: tree_snapshot must expose no Git refs`);
    }
    if (repository.baseTree !== projection.baseTree) {
      issues.push(`${owner}: tree_snapshot baseTree must equal its history projection baseTree`);
    }
    baseObject = objectsById.get(repository.baseTree);
    if (!baseObject || baseObject.type !== "tree") {
      issues.push(`${owner}: baseTree must identify an embedded tree object`);
      return { baseGitlinks: [] };
    }
  } else {
    if (projection.cutoffRevision !== repository.baseRevision) {
      issues.push(`${owner}: history cutoffRevision must equal baseRevision`);
    }
    if (projection.baseRef !== graph.baseRef) {
      issues.push(`${owner}: history baseRef must equal the sealed Git graph baseRef`);
    }
    if (refs.length !== 1 || refs[0]?.name !== graph.baseRef) {
      issues.push(`${owner}: commit-based mode must expose exactly its baseRef and no other ref`);
    }
    const baseRef = refs.find((ref) => ref.name === graph.baseRef);
    if (baseRef?.target !== repository.baseRevision) {
      issues.push(`${owner}: baseRef must resolve exactly to baseRevision ${repository.baseRevision}`);
    }
    baseObject = objectsById.get(repository.baseRevision);
    if (!baseObject || baseObject.type !== "commit") {
      issues.push(`${owner}: baseRevision must identify an embedded commit object`);
      return { baseGitlinks: [] };
    }
  }

  const parsedCommits = new Map();
  const parsedTrees = new Map();
  const parseCommit = (object) => {
    if (!parsedCommits.has(object.objectId)) {
      parsedCommits.set(object.objectId, parseGitCommit(object.content, object.objectId, idLength, issues));
    }
    return parsedCommits.get(object.objectId);
  };
  const parseTree = (object) => {
    if (!parsedTrees.has(object.objectId)) {
      parsedTrees.set(object.objectId, parseGitTree(object.content, object.objectId, objectIdBytes, issues));
    }
    return parsedTrees.get(object.objectId);
  };
  const requireObject = (objectId, expectedType, edgeLabel) => {
    const object = objectsById.get(objectId);
    if (!object) {
      issues.push(`${owner}: ${edgeLabel} references missing Git object ${objectId}`);
      return null;
    }
    if (object.type !== expectedType) {
      issues.push(`${owner}: ${edgeLabel} requires ${expectedType}, found ${object.type} ${objectId}`);
      return null;
    }
    return object;
  };

  const reachable = new Set();
  const activeTrees = new Set();
  function visitTree(treeId, edgeLabel) {
    const tree = requireObject(treeId, "tree", edgeLabel);
    if (!tree) return;
    if (activeTrees.has(treeId)) {
      issues.push(`${owner}: recursive tree cycle at ${treeId}`);
      return;
    }
    if (reachable.has(treeId)) return;
    reachable.add(treeId);
    activeTrees.add(treeId);
    for (const entry of parseTree(tree)) {
      if (entry.mode === "40000") {
        visitTree(entry.target, `tree ${treeId}/${entry.name}`);
      } else if (entry.mode !== "160000") {
        const blob = requireObject(entry.target, "blob", `tree ${treeId}/${entry.name}`);
        if (blob) reachable.add(blob.objectId);
      }
    }
    activeTrees.delete(treeId);
  }

  if (mode === "tree_snapshot") {
    visitTree(repository.baseTree, "baseTree");
  } else if (mode === "full_ancestry") {
    const activeCommits = new Set();
    function visitCommit(commitId, edgeLabel) {
      const commitObject = requireObject(commitId, "commit", edgeLabel);
      if (!commitObject) return;
      if (activeCommits.has(commitId)) {
        issues.push(`${owner}: Git commit ancestry contains a cycle at ${commitId}`);
        return;
      }
      if (reachable.has(commitId)) return;
      reachable.add(commitId);
      activeCommits.add(commitId);
      const commit = parseCommit(commitObject);
      if (commit.tree) visitTree(commit.tree, `commit ${commitId} tree`);
      for (const parent of commit.parents) visitCommit(parent, `commit ${commitId} parent`);
      activeCommits.delete(commitId);
    }
    visitCommit(repository.baseRevision, "baseRevision");
  } else {
    const maxDepth = Number.isInteger(projection.maxParentDepth) && projection.maxParentDepth >= 0
      ? projection.maxParentDepth : 0;
    if (maxDepth !== projection.maxParentDepth) {
      issues.push(`${owner}: bounded_ancestry maxParentDepth must be a non-negative integer`);
    }
    const commitDepths = new Map([[repository.baseRevision, 0]]);
    const queue = [repository.baseRevision];
    for (let index = 0; index < queue.length; index += 1) {
      const commitId = queue[index];
      const depth = commitDepths.get(commitId);
      const commitObject = requireObject(commitId, "commit", depth === 0 ? "baseRevision" : `bounded ancestry depth ${depth}`);
      if (!commitObject) continue;
      reachable.add(commitId);
      const commit = parseCommit(commitObject);
      if (commit.tree) visitTree(commit.tree, `commit ${commitId} tree`);
      if (depth < maxDepth) {
        for (const parent of commit.parents) {
          const parentObject = requireObject(parent, "commit", `commit ${commitId} parent before bounded boundary`);
          if (parentObject && !commitDepths.has(parent)) {
            commitDepths.set(parent, depth + 1);
            queue.push(parent);
          }
        }
      }
    }
    const exactBoundary = new Set();
    for (const [commitId, depth] of commitDepths) {
      if (depth !== maxDepth) continue;
      const commitObject = objectsById.get(commitId);
      if (!commitObject || commitObject.type !== "commit") continue;
      for (const parent of parseCommit(commitObject).parents) {
        if (!commitDepths.has(parent)) exactBoundary.add(parent);
      }
    }
    const expectedBoundary = [...exactBoundary].sort();
    const declaredBoundary = projection.boundaryParentObjectIds ?? [];
    if (canonicalize(declaredBoundary) !== canonicalize([...declaredBoundary].sort())) {
      issues.push(`${owner}: boundaryParentObjectIds must be strictly sorted`);
    }
    if (new Set(declaredBoundary).size !== declaredBoundary.length) {
      issues.push(`${owner}: boundaryParentObjectIds must be unique`);
    }
    if (canonicalize(declaredBoundary) !== canonicalize(expectedBoundary)) {
      issues.push(`${owner}: boundaryParentObjectIds must equal the exact bounded ancestry boundary`);
    }
  }

  if (reachable.size !== objectsById.size) {
    const extras = [...objectsById.keys()].filter((id) => !reachable.has(id));
    issues.push(`${owner}: sealed Git graph contains unreachable/future objects: ${extras.join(", ")}`);
  }
  if (projection.reachableObjectCount !== reachable.size) {
    issues.push(`${owner}: reachableObjectCount must be ${reachable.size}`);
  }

  const selectedTreeId = mode === "tree_snapshot" ? repository.baseTree : parseCommit(baseObject).tree;
  const treeFiles = new Map();
  const treeGitlinks = new Map();
  const flatteningTrees = new Set();
  function flattenTree(treeId, prefix) {
    if (flatteningTrees.has(treeId)) {
      issues.push(`${owner}: recursive base-tree cycle at ${treeId}`);
      return;
    }
    const tree = objectsById.get(treeId);
    if (!tree || tree.type !== "tree") return;
    flatteningTrees.add(treeId);
    for (const entry of parseTree(tree)) {
      const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.mode === "40000") {
        flattenTree(entry.target, fullPath);
      } else if (entry.mode === "160000") {
        if (treeGitlinks.has(fullPath)) issues.push(`${owner}: duplicate flattened gitlink path ${fullPath}`);
        treeGitlinks.set(fullPath, entry.target);
      } else {
        if (treeFiles.has(fullPath)) issues.push(`${owner}: duplicate flattened Git path ${fullPath}`);
        const blob = objectsById.get(entry.target);
        if (blob?.type === "blob") treeFiles.set(fullPath, { mode: entry.mode, blob });
      }
    }
    flatteningTrees.delete(treeId);
  }
  if (selectedTreeId) flattenTree(selectedTreeId, "");

  const manifestFiles = new Map((repository.files ?? []).map((file) => [file.path, file]));
  const expectedPaths = [...treeFiles.keys()].sort(compareUtf8);
  const actualPaths = [...manifestFiles.keys()].sort(compareUtf8);
  if (canonicalize(expectedPaths) !== canonicalize(actualPaths)) {
    issues.push(`${owner}: files[] paths differ from the selected base tree`);
  }
  for (const [filePath, treeFile] of treeFiles) {
    const file = manifestFiles.get(filePath);
    if (!file) continue;
    const manifestBytes = Buffer.from(file.contentBase64 ?? "", "base64");
    if (file.mode !== treeFile.mode) issues.push(`${owner}/${filePath}: mode differs from the selected base tree`);
    if (!manifestBytes.equals(treeFile.blob.content)) {
      issues.push(`${owner}/${filePath}: bytes differ from the selected base-tree blob ${treeFile.blob.objectId}`);
    }
  }

  const declaredGitlinks = new Map();
  let priorGitlinkPath = null;
  for (const gitlink of repository.gitlinks ?? []) {
    if (!isSafeRepositoryRelativePath(gitlink.path)) {
      issues.push(`${owner}: gitlink path must be a safe UTF-8 repository-relative path`);
    }
    if (declaredGitlinks.has(gitlink.path)) issues.push(`${owner}: duplicate gitlink path ${gitlink.path}`);
    if (priorGitlinkPath !== null && compareUtf8(gitlink.path, priorGitlinkPath) <= 0) {
      issues.push(`${owner}: gitlinks must be strictly sorted by UTF-8 path bytes`);
    }
    priorGitlinkPath = gitlink.path;
    declaredGitlinks.set(gitlink.path, gitlink);
  }
  if (canonicalize([...treeGitlinks.keys()].sort(compareUtf8)) !== canonicalize([...declaredGitlinks.keys()].sort(compareUtf8))) {
    issues.push(`${owner}: gitlinks[] paths differ from mode-160000 entries in the selected base tree`);
  }
  for (const [gitlinkPath, targetCommit] of treeGitlinks) {
    const declared = declaredGitlinks.get(gitlinkPath);
    if (declared && declared.targetCommit !== targetCommit) {
      issues.push(`${owner}/${gitlinkPath}: gitlink targetCommit must be ${targetCommit}`);
    }
  }
  return { baseGitlinks: [...declaredGitlinks.values()] };
}

export function verifyWorkspaceManifest(manifest) {
  const issues = [];
  const repositoryIds = new Set();
  const repositoryPaths = new Set();
  const repositoriesById = new Map();
  const graphResults = new Map();
  let priorRepositoryId = null;
  for (const repository of manifest.repositories ?? []) {
    if (repositoryIds.has(repository.id)) issues.push(`duplicate repository id ${repository.id}`);
    repositoryIds.add(repository.id);
    repositoriesById.set(repository.id, repository);
    if (repositoryPaths.has(repository.path)) issues.push(`duplicate repository path ${repository.path}`);
    repositoryPaths.add(repository.path);
    if (repository.path !== "." && !isSafeRepositoryRelativePath(repository.path)) {
      issues.push(`${repository.id}: repository path must be '.' or a safe UTF-8 workspace-relative path`);
    }
    if (priorRepositoryId !== null && repository.id <= priorRepositoryId) {
      issues.push("repositories must be strictly sorted by id");
    }
    priorRepositoryId = repository.id;
    const paths = new Set();
    let priorPath = null;
    for (const file of repository.files ?? []) {
      if (!isSafeRepositoryRelativePath(file.path)) {
        issues.push(`${repository.id}: file path must be a safe UTF-8 repository-relative path`);
      }
      if (paths.has(file.path)) issues.push(`${repository.id}: duplicate file path ${file.path}`);
      paths.add(file.path);
      if (priorPath !== null && compareUtf8(file.path, priorPath) <= 0) issues.push(`${repository.id}: files must be strictly sorted by UTF-8 path bytes`);
      priorPath = file.path;
      const bytes = decodeCanonicalBase64(file.contentBase64, `${repository.id}/${file.path}`, issues);
      if (!bytes) continue;
      if (bytes.length !== file.byteLength) issues.push(`${repository.id}/${file.path}: byteLength must be ${bytes.length}`);
      const digest = sha256Bytes(bytes);
      if (file.digest !== digest) issues.push(`${repository.id}/${file.path}: digest must be ${digest}`);
    }
    const treeDigest = repositoryTreeDigest(repository);
    if (repository.treeDigest !== treeDigest) issues.push(`${repository.id}: treeDigest must be ${treeDigest}`);
    graphResults.set(repository.id, verifyRepositoryGitGraph(repository, issues));
  }
  for (const repository of manifest.repositories ?? []) {
    for (const gitlink of graphResults.get(repository.id)?.baseGitlinks ?? []) {
      const linked = repositoriesById.get(gitlink.repositoryId);
      if (!linked) {
        issues.push(`${repository.id}/${gitlink.path}: gitlink repository ${gitlink.repositoryId} is missing`);
        continue;
      }
      const expectedPath = repository.path === "." ? gitlink.path : `${repository.path}/${gitlink.path}`;
      if (linked.path !== expectedPath) {
        issues.push(`${repository.id}/${gitlink.path}: linked repository path must be ${expectedPath}`);
      }
      if (linked.historyProjection?.mode === "tree_snapshot" || linked.baseRevision === undefined) {
        issues.push(`${repository.id}/${gitlink.path}: linked repository must use a commit-based mode`);
      } else if (linked.baseRevision !== gitlink.targetCommit) {
        issues.push(`${repository.id}/${gitlink.path}: linked repository baseRevision must equal gitlink targetCommit ${gitlink.targetCommit}`);
      }
      if (linked.objectFormat !== repository.objectFormat) {
        issues.push(`${repository.id}/${gitlink.path}: linked repository objectFormat must equal the containing repository objectFormat`);
      }
    }
  }
  const rootDigest = workspaceRootDigest(manifest);
  if (manifest.workspaceRootDigest !== rootDigest) issues.push(`workspaceRootDigest must be ${rootDigest}`);
  return issues;
}

export function dependencyManifestDigest(manifest) {
  return sha256Canonical({ id: manifest.id, version: manifest.version, entries: manifest.entries });
}

function exactCanonical(expected, actual, label, issues) {
  const expectedValues = expected.map(canonicalize).sort();
  const actualValues = actual.map(canonicalize).sort();
  if (canonicalize(expectedValues) !== canonicalize(actualValues)) issues.push(`${label} differs from the exact expected set`);
}

function assertionProjection(assertion) {
  const projection = structuredClone(assertion);
  delete projection.resultDigest;
  return projection;
}

function causalContractProjection(contract) {
  const projection = structuredClone(contract);
  delete projection.digest;
  return projection;
}

function replayProjection(replay) {
  const projection = structuredClone(replay);
  delete projection.digest;
  return projection;
}

function subjectKey(subject) {
  return `${subject.subjectKind}:${subject.subjectId}:${subject.subjectVersion}:${subject.subjectDigest}`;
}

function pointerProjection(pointer) {
  return { id: pointer.id, version: pointer.version, digest: pointer.digest };
}

function predicateProjection(predicate) {
  const projection = structuredClone(predicate);
  delete projection.digest;
  return projection;
}

function exactSubjectCoverage(subjects, kind) {
  return subjects.filter((subject) => subject.subjectKind === kind).map((subject) => ({
    id: subject.subjectId,
    version: subject.subjectVersion,
    digest: subject.subjectDigest
  }));
}

function counterfactualInputDigest(workspaceManifest, replacements) {
  return sha256Canonical({
    baselineWorkspaceRootDigest: workspaceRootDigest(workspaceManifest),
    replacements: replacements.map(({ repositoryId, path, originalDigest, replacementDigest }) => ({
      repositoryId, path, originalDigest, replacementDigest
    }))
  });
}

function applyCounterfactual(workspaceManifest, replacements, issues) {
  const workspace = structuredClone(workspaceManifest);
  const seen = new Set();
  for (const replacement of replacements) {
    const key = `${replacement.repositoryId}:${replacement.path}`;
    if (seen.has(key)) issues.push(`counterfactual contains duplicate replacement ${key}`);
    seen.add(key);
    const repository = (workspace.repositories ?? []).find((entry) => entry.id === replacement.repositoryId);
    const file = repository?.files?.find((entry) => entry.path === replacement.path);
    if (!file) {
      issues.push(`counterfactual replacement ${key} does not identify a workspace file`);
      continue;
    }
    if (file.digest !== replacement.originalDigest) {
      issues.push(`counterfactual replacement ${key} originalDigest differs from the authenticated workspace object`);
    }
    const bytes = Buffer.from(replacement.replacementContentBase64 ?? "", "base64");
    if (bytes.toString("base64") !== replacement.replacementContentBase64) {
      issues.push(`counterfactual replacement ${key} is not canonical base64`);
    }
    const digest = sha256Bytes(bytes);
    if (digest !== replacement.replacementDigest) {
      issues.push(`counterfactual replacement ${key} replacementDigest must be ${digest}`);
    }
    file.contentBase64 = bytes.toString("base64");
    file.byteLength = bytes.length;
    file.digest = digest;
  }
  return workspace;
}

function executeSubjects(workspace, subjects, context, issues) {
  const registry = context.executorAuthority?.executors ?? [];
  return subjects.map((subject) => {
    const matches = registry.filter((candidate) => candidate.id === subject.executor?.id
      && candidate.version === subject.executor?.version);
    const entry = matches.length === 1 ? matches[0] : null;
    if (!entry || entry.authenticated !== true
      || canonicalize(pointerProjection(entry)) !== canonicalize(subject.executor)) {
      issues.push(`grounding subject ${subjectKey(subject)} executor is not the exact verifier-selected registry entry`);
      return null;
    }
    if (!(entry.algorithms ?? []).includes(subject.predicate?.algorithm)) {
      issues.push(`grounding subject ${subjectKey(subject)} predicate algorithm is not registered for its executor`);
      return null;
    }
    const predicateDigest = sha256Canonical(predicateProjection(subject.predicate ?? {}));
    if (subject.predicate?.digest !== predicateDigest) {
      issues.push(`grounding subject ${subjectKey(subject)} predicate digest must be ${predicateDigest}`);
      return null;
    }
    if (typeof entry.execute !== "function") {
      issues.push("repository grounding predicate executor is unavailable to the verifier");
      return null;
    }
    return entry.execute(workspace, subject);
  }).filter(Boolean);
}

function exactReplayResultSubjects(subjects, results, label, issues) {
  const expected = subjects.map(({ subjectKind, subjectId, subjectVersion, subjectDigest }) => ({
    subjectKind, subjectId, subjectVersion, subjectDigest
  }));
  const actual = results.map(({ subjectKind, subjectId, subjectVersion, subjectDigest }) => ({
    subjectKind, subjectId, subjectVersion, subjectDigest
  }));
  exactCanonical(expected, actual, label, issues);
}

export function verifyRepositoryGroundingEvidence(evidence, context) {
  const issues = [];
  const {
    statementId,
    target,
    targetSubject,
    dependencyManifest,
    scopeSlice,
    workspaceManifest,
    workspaceManifestDigest,
    verifierDigest,
    targetVerdict,
    groundingContract
  } = context;
  if (evidence.statementId !== statementId) issues.push("statementId differs from the conformance statement");
  if (evidence.scopeSliceId !== scopeSlice.id) issues.push("scopeSliceId differs from the conformance slice");
  if (evidence.target !== target) issues.push("target differs from the conformance claim");
  if (canonicalize(evidence.targetSubject) !== canonicalize(targetSubject)) issues.push("targetSubject differs from the immutable conformance target subject");
  if (evidence.dependencyManifestDigest !== dependencyManifest.digest) issues.push("dependencyManifestDigest differs from the conformance target dependency manifest");
  if (canonicalize(evidence.workspaceManifest) !== canonicalize(scopeSlice.repositorySnapshot)) issues.push("workspaceManifest differs from the conformance slice snapshot");

  const workspaceProblems = verifyWorkspaceManifest(workspaceManifest);
  issues.push(...workspaceProblems.map((problem) => `workspace manifest ${problem}`));

  const trustedContract = groundingContract ?? null;
  const trustedSubjects = trustedContract?.subjectPredicates ?? [];
  const expectedOutcomes = exactSubjectCoverage(trustedSubjects, "outcome");
  const expectedClaims = exactSubjectCoverage(trustedSubjects, "claim");
  const authoritativeOutcomes = (scopeSlice.outcomeProfiles ?? [])
    .map(({ id, version, digest }) => ({ id, version, digest }));
  const authoritativeClaims = targetVerdict === "not_claimed" ? [] : [{
    id: targetSubject.id,
    version: targetSubject.version,
    digest: targetSubject.digest
  }];
  exactCanonical(expectedOutcomes, evidence.subjectCoverage?.outcomes ?? [], "covered outcomes", issues);
  exactCanonical(expectedClaims, evidence.subjectCoverage?.claims ?? [], "covered claims", issues);

  if (targetVerdict === "not_claimed" && expectedClaims.length !== 0) {
    issues.push("a not_claimed target must not supply claim grounding contracts");
  }

  const baseInputs = [
    { role: "workspace_manifest", id: scopeSlice.repositorySnapshot.id, digest: workspaceManifestDigest },
    { role: "target_subject", id: targetSubject.id, digest: targetSubject.digest },
    { role: "dependency_manifest", id: dependencyManifest.id, digest: dependencyManifest.digest }
  ];

  if (!trustedContract || trustedSubjects.length === 0) {
    if (evidence.causalContract !== null || evidence.causalReplay !== null) {
      issues.push("grounding without verifier-selected executable subject contracts must not declare a causal contract or replay");
    }
    exactCanonical(baseInputs, evidence.verifierExecution?.inputs ?? [], "verifier inputs", issues);
    if (evidence.verifierExecution?.verifier?.digest !== verifierDigest) {
      issues.push(`verifier executable digest must be ${verifierDigest}`);
    }
    const assertions = evidence.assertions ?? [];
    const expectedTypes = [
      "repository_necessity",
      "claim_invariant_traceability",
      "repository_governed_outcome",
      "removal_counterfactual"
    ];
    exactCanonical(expectedTypes, assertions.map((assertion) => assertion.type), "grounding assertion types", issues);
    for (const assertion of assertions) {
      if (assertion.verdict !== "insufficient_evidence"
        || assertion.reasonCode !== "no_executable_subject_contract") {
        issues.push(`${assertion.type}: must report insufficient_evidence/no_executable_subject_contract`);
      }
      const resultDigest = sha256Canonical(assertionProjection(assertion));
      if (assertion.resultDigest !== resultDigest) issues.push(`${assertion.type}: resultDigest must be ${resultDigest}`);
    }
    const assertionResults = assertions.map((assertion) => ({
      type: assertion.type,
      verdict: "insufficient_evidence",
      resultDigest: assertion.resultDigest
    }));
    const expectedOutput = {
      overallVerdict: "insufficient_evidence",
      reasonCodes: ["no_executable_subject_contract"],
      assertionResults
    };
    const expectedOutputDigest = sha256Canonical(expectedOutput);
    if (canonicalize(evidence.verifierExecution?.output) !== canonicalize({
      ...expectedOutput,
      outputDigest: expectedOutputDigest
    })) {
      issues.push(`verifier output must report the derived insufficient-evidence result and outputDigest ${expectedOutputDigest}`);
    }
    if (evidence.verdict !== "insufficient_evidence") {
      issues.push("grounding verdict must be insufficient_evidence without executable subject contracts");
    }
    return issues;
  }

  exactCanonical(authoritativeOutcomes, expectedOutcomes,
    "verifier-selected outcome subject contracts", issues);
  exactCanonical(authoritativeClaims, expectedClaims,
    "verifier-selected claim subject contracts", issues);

  const expectedTrustedContract = structuredClone(trustedContract);
  expectedTrustedContract.digest = sha256Canonical(causalContractProjection(expectedTrustedContract));
  const contract = evidence.causalContract ?? {};
  const expectedContractDigest = expectedTrustedContract.digest;
  if (canonicalize(contract) !== canonicalize(expectedTrustedContract)) {
    issues.push("causal contract differs from the exact verifier-selected subject contracts and intervention");
  }
  if (evidence.causalReplay?.contractDigest !== expectedContractDigest) {
    issues.push(`causal replay contractDigest must be ${expectedContractDigest}`);
  }

  const subjectKeys = trustedSubjects.map(subjectKey);
  if (new Set(subjectKeys).size !== subjectKeys.length) issues.push("verifier-selected grounding contract contains duplicate subjects");
  const expectedInputs = [
    ...baseInputs,
    { role: "causal_contract", id: contract.id, digest: expectedContractDigest },
    ...trustedSubjects.map((entry) => ({
      role: entry.subjectKind === "outcome" ? "outcome_subject" : "claim_subject",
      id: entry.subjectId,
      digest: entry.subjectDigest
    })),
    ...[...new Map(trustedSubjects.map((entry) => [
      `${entry.executor.id}:${entry.executor.version}:${entry.executor.digest}`,
      { role: "grounding_executor", id: entry.executor.id, digest: entry.executor.digest }
    ])).values()]
  ];
  exactCanonical(expectedInputs, evidence.verifierExecution?.inputs ?? [], "verifier inputs", issues);
  if (evidence.verifierExecution?.verifier?.digest !== verifierDigest) issues.push(`verifier executable digest must be ${verifierDigest}`);

  const baselineExecutionIssues = [];
  const baselineResults = executeSubjects(workspaceManifest, trustedSubjects, context, baselineExecutionIssues);
  issues.push(...baselineExecutionIssues);
  exactReplayResultSubjects(trustedSubjects, baselineResults, "baseline replay subject coverage", issues);
  const expectedBaseline = {
    workspaceRootDigest: workspaceRootDigest(workspaceManifest),
    subjectResults: baselineResults
  };
  expectedBaseline.digest = sha256Canonical(expectedBaseline);
  if (canonicalize(evidence.causalReplay?.baseline) !== canonicalize(expectedBaseline)) {
    issues.push("causal baseline replay differs from registered predicate execution over the authenticated workspace");
  }

  const replacements = trustedContract.counterfactual?.replacements ?? [];
  const counterfactualWorkspace = applyCounterfactual(workspaceManifest, replacements, issues);
  const counterfactualExecutionIssues = [];
  const counterfactualResults = executeSubjects(counterfactualWorkspace, trustedSubjects, context, counterfactualExecutionIssues);
  issues.push(...counterfactualExecutionIssues);
  exactReplayResultSubjects(trustedSubjects, counterfactualResults, "counterfactual replay subject coverage", issues);
  const expectedCounterfactual = {
    replacements,
    inputDigest: counterfactualInputDigest(workspaceManifest, replacements),
    subjectResults: counterfactualResults
  };
  expectedCounterfactual.digest = sha256Canonical(expectedCounterfactual);
  if (canonicalize(evidence.causalReplay?.counterfactual) !== canonicalize(expectedCounterfactual)) {
    issues.push("causal counterfactual replay differs from registered predicate execution over the verifier-selected intervention");
  }

  const groundingEstablished = baselineResults.length === trustedSubjects.length
    && counterfactualResults.length === trustedSubjects.length
    && baselineResults.every((result) => result.executionStatus === "executed" && result.semanticResult === "pass")
    && counterfactualResults.every((result) => result.executionStatus === "executed" && result.semanticResult === "fail");
  if (!groundingEstablished && evidence.verdict === "established") {
    issues.push("an established grounding verdict requires executed semantic pass -> fail for every exact covered subject; unavailable bytes are only insufficient_evidence");
  }

  const baselineConsumed = [...new Map(baselineResults.flatMap((result) => result.consumedObjects)
    .map((object) => [object.digest, object])).values()];
  const materialObjectDigests = baselineConsumed.map((entry) => entry.digest).sort();
  const consumedPaths = new Set(baselineConsumed.map((entry) => `${entry.repositoryId}:${entry.path}`));
  for (const replacement of replacements) {
    if (!consumedPaths.has(`${replacement.repositoryId}:${replacement.path}`)) {
      issues.push(`counterfactual replacement ${replacement.repositoryId}:${replacement.path} is passenger data not consumed by a covered predicate`);
    }
  }

  const assertions = evidence.assertions ?? [];
  const expectedTypes = [
    "repository_necessity",
    "claim_invariant_traceability",
    "repository_governed_outcome",
    "removal_counterfactual"
  ];
  exactCanonical(expectedTypes, assertions.map((assertion) => assertion.type), "grounding assertion types", issues);
  for (const assertion of assertions) {
    const resultDigest = sha256Canonical(assertionProjection(assertion));
    if (assertion.resultDigest !== resultDigest) issues.push(`${assertion.type}: resultDigest must be ${resultDigest}`);
  }

  const necessity = assertions.find((assertion) => assertion.type === "repository_necessity");
  if (!necessity || !(necessity.requiredDependencyRoles ?? []).includes("repository_snapshot")
    || !(necessity.requiredDependencyRoles ?? []).includes("causal_contract")) {
    issues.push("repository necessity must consume repository_snapshot and causal_contract dependencies");
  }
  exactCanonical(materialObjectDigests, necessity?.observedObjectDigests ?? [],
    "repository-necessity material objects", issues);

  const traceability = assertions.find((assertion) => assertion.type === "claim_invariant_traceability");
  const expectedTraceBindings = baselineResults.map((result) => ({
    subjectKind: result.subjectKind,
    subjectId: result.subjectId,
    subjectVersion: result.subjectVersion,
    subjectDigest: result.subjectDigest,
    predicateDigest: result.predicateDigest,
    repositoryObjectDigests: result.consumedObjects.map((entry) => entry.digest).sort()
  }));
  exactCanonical(expectedTraceBindings, traceability?.bindings ?? [], "claim/invariant causal trace", issues);

  const governed = assertions.find((assertion) => assertion.type === "repository_governed_outcome");
  const expectedGoverned = baselineResults
    .filter((result) => result.subjectKind === "outcome")
    .map((result) => ({
      outcomeId: result.subjectId,
      outcomeVersion: result.subjectVersion,
      outcomeDigest: result.subjectDigest,
      predicateDigest: result.predicateDigest,
      governingRepositoryObjectDigests: result.consumedObjects.map((entry) => entry.digest).sort()
    }));
  exactCanonical(expectedGoverned, governed?.outcomeBindings ?? [], "repository-governed outcome causal bindings", issues);

  const counterfactual = assertions.find((assertion) => assertion.type === "removal_counterfactual");
  exactCanonical(replacements, counterfactual?.interventions ?? [], "semantic-counterfactual interventions", issues);
  if (counterfactual?.counterfactualInputDigest !== expectedCounterfactual.inputDigest) {
    issues.push(`counterfactualInputDigest must be ${expectedCounterfactual.inputDigest}`);
  }
  if (counterfactual?.baselineResult !== "pass" || counterfactual?.counterfactualResult !== "fail") {
    issues.push("grounding counterfactual must declare the executed semantic transition pass -> fail");
  }
  const expectedAffected = counterfactualResults
    .filter((result, index) => baselineResults[index]?.semanticResult === "pass" && result.semanticResult === "fail")
    .map((result) => result.subjectDigest);
  exactCanonical(expectedAffected, counterfactual?.affectedSubjectDigests ?? [], "semantic-counterfactual affected subjects", issues);

  const expectedAssertionResults = assertions.map((assertion) => ({
    type: assertion.type,
    verdict: groundingEstablished ? "established" : "insufficient_evidence",
    resultDigest: assertion.resultDigest
  }));
  exactCanonical(expectedAssertionResults, evidence.verifierExecution?.output?.assertionResults ?? [], "verifier assertion results", issues);
  const expectedOutput = {
    overallVerdict: groundingEstablished ? "established" : "insufficient_evidence",
    causalContractDigest: expectedContractDigest,
    baselineReplayDigest: expectedBaseline.digest,
    counterfactualReplayDigest: expectedCounterfactual.digest,
    assertionResults: expectedAssertionResults
  };
  const expectedOutputDigest = sha256Canonical(expectedOutput);
  if (evidence.verifierExecution?.output?.causalContractDigest !== expectedContractDigest
    || evidence.verifierExecution?.output?.baselineReplayDigest !== expectedBaseline.digest
    || evidence.verifierExecution?.output?.counterfactualReplayDigest !== expectedCounterfactual.digest
    || evidence.verifierExecution?.output?.outputDigest !== expectedOutputDigest) {
    issues.push(`verifier output must bind contract/replay digests and outputDigest ${expectedOutputDigest}`);
  }
  const expectedVerdict = groundingEstablished ? "established" : "insufficient_evidence";
  if (evidence.verdict !== expectedVerdict) issues.push(`grounding verdict must be ${expectedVerdict}`);
  return issues;
}

async function main() {
  const [workspacePath] = process.argv.slice(2);
  if (!workspacePath) {
    console.error("Usage: node tools/verify-repository-grounding.mjs <workspace-manifest.json>");
    process.exitCode = 2;
    return;
  }
  const manifest = JSON.parse(await readFile(workspacePath, "utf8"));
  const issues = verifyWorkspaceManifest(manifest);
  if (issues.length) {
    issues.forEach((issue) => console.error(`- ${issue}`));
    process.exitCode = 1;
    return;
  }
  console.log(`Workspace manifest verified: ${manifest.id}@${manifest.version} (${manifest.workspaceRootDigest})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
