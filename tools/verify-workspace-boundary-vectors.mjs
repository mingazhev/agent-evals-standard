#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import {
  gitObjectGraphDigest,
  gitObjectId,
  repositoryTreeDigest,
  sha256Bytes,
  verifyWorkspaceManifest,
  workspaceRootDigest
} from "./verify-repository-grounding.mjs";
import { sealWorkspaceManifest } from "./seal-workspace-fixture.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vectors = JSON.parse(await readFile(path.join(root, "conformance", "fixtures", "workspace-boundary-vectors.json"), "utf8"));
const schema = JSON.parse(await readFile(path.join(root, "schemas", "workspace-manifest.schema.json"), "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateSchema = ajv.compile(schema);

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function utf8Compare(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function objectRecord(type, content) {
  return {
    objectId: gitObjectId("sha1", type, content),
    type,
    byteLength: content.length,
    contentBase64: content.toString("base64")
  };
}

function treeContent(entries) {
  return Buffer.concat(entries.map((entry) => Buffer.concat([
    Buffer.from(`${entry.mode} ${entry.name}\0`, "utf8"),
    Buffer.from(entry.objectId, "hex")
  ])));
}

function commitRecord(treeId, message, parentId = null) {
  const lines = [
    `tree ${treeId}`,
    ...(parentId ? [`parent ${parentId}`] : []),
    "author Fixture Builder <fixture@example.invalid> 0 +0000",
    "committer Fixture Builder <fixture@example.invalid> 0 +0000",
    "",
    message,
    ""
  ];
  return objectRecord("commit", Buffer.from(lines.join("\n"), "utf8"));
}

function nonUtf8MetadataCommitRecord(treeId) {
  return objectRecord("commit", Buffer.concat([
    Buffer.from(`tree ${treeId}\nauthor `, "ascii"),
    Buffer.from([0x46, 0x69, 0x78, 0x74, 0x75, 0x72, 0x65, 0x20, 0xff]),
    Buffer.from(" <fixture@example.invalid> 0 +0000\ncommitter Fixture Builder <fixture@example.invalid> 0 +0000\n\nraw metadata is permitted\n", "ascii")
  ]));
}

function verifierIdentity() {
  return {
    id: "agent-evals-standard.git-repository-state-verifier",
    version: "0.1.0",
    algorithm: "git-repository-state-v1"
  };
}

function fileRecord(filePath, content, mediaType = "text/plain") {
  const bytes = Buffer.from(content, "utf8");
  return {
    path: filePath,
    mode: "100644",
    mediaType,
    byteLength: bytes.length,
    digest: sha256Bytes(bytes),
    contentBase64: bytes.toString("base64")
  };
}

function finalizeRepository(repository) {
  repository.files.sort((left, right) => utf8Compare(left.path, right.path));
  repository.gitlinks?.sort((left, right) => utf8Compare(left.path, right.path));
  repository.gitObjectGraph.refs.sort((left, right) => lexicalCompare(left.name, right.name));
  repository.gitObjectGraph.objects.sort((left, right) => lexicalCompare(left.objectId, right.objectId));
  repository.treeDigest = repositoryTreeDigest(repository);
  repository.gitObjectGraph.digest = gitObjectGraphDigest(repository);
  repository.historyProjection.objectGraphDigest = repository.gitObjectGraph.digest;
  repository.historyProjection.reachableObjectCount = repository.gitObjectGraph.objects.length;
  return repository;
}

function treeRepository({ id = "fixture-repository", repositoryPath = ".", content = "sealed tree\n" } = {}) {
  const file = fileRecord("README.md", content, "text/markdown");
  const blob = objectRecord("blob", Buffer.from(file.contentBase64, "base64"));
  const tree = objectRecord("tree", treeContent([{ mode: file.mode, name: "README.md", objectId: blob.objectId }]));
  return finalizeRepository({
    id,
    path: repositoryPath,
    objectFormat: "sha1",
    baseTree: tree.objectId,
    treeDigest: "",
    gitObjectGraph: { refs: [], objects: [blob, tree], digest: "" },
    historyProjection: {
      mode: "tree_snapshot",
      baseTree: tree.objectId,
      objectGraphDigest: "",
      reachableObjectCount: 0,
      verifier: verifierIdentity()
    },
    files: [file]
  });
}

function ancestryRepository({
  id = "fixture-repository",
  repositoryPath = ".",
  mode = "full_ancestry",
  maxParentDepth = undefined,
  includeParent = true,
  boundaryOverride = undefined,
  rootCommit = false
} = {}) {
  const file = fileRecord("README.md", "sealed ancestry\n", "text/markdown");
  const blob = objectRecord("blob", Buffer.from(file.contentBase64, "base64"));
  const tree = objectRecord("tree", treeContent([{ mode: file.mode, name: "README.md", objectId: blob.objectId }]));
  const parent = rootCommit ? null : commitRecord(tree.objectId, "parent");
  const base = commitRecord(tree.objectId, "base", parent?.objectId);
  const objects = [blob, tree, base, ...(parent && includeParent ? [parent] : [])];
  const historyProjection = {
    mode,
    cutoffRevision: base.objectId,
    baseRef: "refs/heads/eval-base",
    objectGraphDigest: "",
    reachableObjectCount: 0,
    verifier: verifierIdentity()
  };
  if (mode === "bounded_ancestry") {
    historyProjection.maxParentDepth = maxParentDepth;
    historyProjection.boundaryParentObjectIds = boundaryOverride ?? (parent ? [parent.objectId] : []);
  }
  const repository = finalizeRepository({
    id,
    path: repositoryPath,
    objectFormat: "sha1",
    baseRevision: base.objectId,
    treeDigest: "",
    gitObjectGraph: {
      baseRef: "refs/heads/eval-base",
      refs: [{ name: "refs/heads/eval-base", target: base.objectId }],
      objects,
      digest: ""
    },
    historyProjection,
    files: [file]
  });
  return { repository, parent, base };
}

function nonUtf8CommitMetadataRepository() {
  const file = fileRecord("README.md", "sealed ancestry\n", "text/markdown");
  const blob = objectRecord("blob", Buffer.from(file.contentBase64, "base64"));
  const tree = objectRecord("tree", treeContent([{ mode: file.mode, name: file.path, objectId: blob.objectId }]));
  const base = nonUtf8MetadataCommitRecord(tree.objectId);
  return finalizeRepository({
    id: "fixture-repository",
    path: ".",
    objectFormat: "sha1",
    baseRevision: base.objectId,
    treeDigest: "",
    gitObjectGraph: {
      baseRef: "refs/heads/eval-base",
      refs: [{ name: "refs/heads/eval-base", target: base.objectId }],
      objects: [blob, tree, base],
      digest: ""
    },
    historyProjection: {
      mode: "full_ancestry",
      cutoffRevision: base.objectId,
      baseRef: "refs/heads/eval-base",
      objectGraphDigest: "",
      reachableObjectCount: 0,
      verifier: verifierIdentity()
    },
    files: [file]
  });
}

function malformedTreeNameWorkspace(nameBytes, manifestPath) {
  const file = fileRecord(manifestPath, "malformed path\n", "text/plain");
  const blob = objectRecord("blob", Buffer.from(file.contentBase64, "base64"));
  const tree = objectRecord("tree", Buffer.concat([
    Buffer.from(`${file.mode} `, "ascii"),
    nameBytes,
    Buffer.from([0]),
    Buffer.from(blob.objectId, "hex")
  ]));
  return workspace([finalizeRepository({
    id: "fixture-repository",
    path: ".",
    objectFormat: "sha1",
    baseTree: tree.objectId,
    treeDigest: "",
    gitObjectGraph: { refs: [], objects: [blob, tree], digest: "" },
    historyProjection: {
      mode: "tree_snapshot",
      baseTree: tree.objectId,
      objectGraphDigest: "",
      reachableObjectCount: 0,
      verifier: verifierIdentity()
    },
    files: [file]
  })]);
}

function invalidFilePathWorkspace(invalidPath) {
  const manifest = workspace([treeRepository()]);
  manifest.repositories[0].files[0].path = invalidPath;
  return rebind(manifest);
}

function workspace(repositories) {
  const manifest = {
    schemaVersion: "agent-eval-workspace-manifest-1",
    id: "workspace-boundary-fixture",
    version: "0.1.0",
    repositories: repositories.sort((left, right) => lexicalCompare(left.id, right.id)),
    workspaceRootDigest: ""
  };
  manifest.workspaceRootDigest = workspaceRootDigest(manifest);
  return manifest;
}

function gitlinkWorkspace({ includeLinked = true, mismatch = false } = {}) {
  const { repository: linked } = ancestryRepository({
    id: "linked-component",
    repositoryPath: "vendor",
    mode: "full_ancestry"
  });
  const targetCommit = mismatch ? "f".repeat(40) : linked.baseRevision;
  const readme = fileRecord("README.md", "superproject\n", "text/markdown");
  const blob = objectRecord("blob", Buffer.from(readme.contentBase64, "base64"));
  const tree = objectRecord("tree", treeContent([
    { mode: "100644", name: "README.md", objectId: blob.objectId },
    { mode: "160000", name: "vendor", objectId: targetCommit }
  ]));
  const containing = finalizeRepository({
    id: "containing-repository",
    path: ".",
    objectFormat: "sha1",
    baseTree: tree.objectId,
    treeDigest: "",
    gitObjectGraph: { refs: [], objects: [blob, tree], digest: "" },
    historyProjection: {
      mode: "tree_snapshot",
      baseTree: tree.objectId,
      objectGraphDigest: "",
      reachableObjectCount: 0,
      verifier: verifierIdentity()
    },
    gitlinks: [{ path: "vendor", repositoryId: "linked-component", targetCommit }],
    files: [readme]
  });
  return workspace([containing, ...(includeLinked ? [linked] : [])]);
}

function rebind(manifest) {
  for (const repository of manifest.repositories) finalizeRepository(repository);
  manifest.workspaceRootDigest = workspaceRootDigest(manifest);
  return manifest;
}

function scenario(name) {
  if (name === "tree_snapshot") return workspace([treeRepository()]);
  if (name === "full_ancestry") return workspace([ancestryRepository().repository]);
  if (name === "bounded_ancestry") {
    return workspace([ancestryRepository({ mode: "bounded_ancestry", maxParentDepth: 0, includeParent: false }).repository]);
  }
  if (name === "bounded_root_commit") {
    return workspace([ancestryRepository({
      mode: "bounded_ancestry",
      maxParentDepth: 0,
      rootCommit: true
    }).repository]);
  }
  if (name === "unicode_space_paths") {
    const files = [
      fileRecord("docs/Руководство для агента.md", "UTF-8 paths remain byte exact.\n", "text/markdown"),
      fileRecord("docs/\uE000.txt", "private-use scalar\n"),
      fileRecord("docs/🚀.txt", "supplementary scalar\n")
    ].sort((left, right) => utf8Compare(left.path, right.path));
    return sealWorkspaceManifest({
      schemaVersion: "agent-eval-workspace-manifest-1",
      id: "workspace-boundary-fixture",
      version: "0.1.0",
      repositories: [{
        id: "fixture-repository",
        path: "services/Платёжный модуль",
        files
      }],
      workspaceRootDigest: ""
    });
  }
  if (name === "non_utf8_commit_metadata") return workspace([nonUtf8CommitMetadataRepository()]);
  if (name === "gitlink_bound") return gitlinkWorkspace();
  if (name === "gitlink_missing_repository") return gitlinkWorkspace({ includeLinked: false });
  if (name === "gitlink_revision_mismatch") return gitlinkWorkspace({ mismatch: true });
  if (name === "sealer_tree_default") {
    const file = fileRecord("README.md", "sealed by fixture sealer\n", "text/markdown");
    return sealWorkspaceManifest({
      schemaVersion: "agent-eval-workspace-manifest-1",
      id: "workspace-boundary-fixture",
      version: "0.1.0",
      repositories: [{ id: "fixture-repository", path: ".", files: [file] }],
      workspaceRootDigest: ""
    });
  }
  if (name === "tree_snapshot_with_ref") {
    const manifest = workspace([treeRepository()]);
    const repository = manifest.repositories[0];
    repository.gitObjectGraph.baseRef = "refs/heads/eval-base";
    repository.gitObjectGraph.refs = [{ name: "refs/heads/eval-base", target: repository.baseTree }];
    return rebind(manifest);
  }
  if (name === "bounded_wrong_boundary") {
    const built = ancestryRepository({ mode: "bounded_ancestry", maxParentDepth: 0, includeParent: false });
    built.repository.historyProjection.boundaryParentObjectIds = ["e".repeat(40)];
    return workspace([finalizeRepository(built.repository)]);
  }
  if (name === "bounded_missing_before_boundary") {
    return workspace([ancestryRepository({
      mode: "bounded_ancestry",
      maxParentDepth: 1,
      includeParent: false,
      boundaryOverride: ["e".repeat(40)]
    }).repository]);
  }
  if (name === "full_missing_parent") return workspace([ancestryRepository({ includeParent: false }).repository]);
  if (name === "unreachable_object") {
    const manifest = workspace([treeRepository()]);
    manifest.repositories[0].gitObjectGraph.objects.push(objectRecord("blob", Buffer.from("extra\n", "utf8")));
    return rebind(manifest);
  }
  if (name === "lfs_pointer") {
    return workspace([treeRepository({
      content: "version https://git-lfs.github.com/spec/v1\noid sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\nsize 1\n"
    })]);
  }
  if (name === "path_traversal") return invalidFilePathWorkspace("docs/../secret.txt");
  if (name === "path_absolute") return invalidFilePathWorkspace("/absolute.txt");
  if (name === "path_drive_absolute") return invalidFilePathWorkspace("C:/absolute.txt");
  if (name === "repository_path_absolute") return workspace([treeRepository({ repositoryPath: "/outside" })]);
  if (name === "path_backslash") return invalidFilePathWorkspace("docs\\unsafe.txt");
  if (name === "path_nul") return invalidFilePathWorkspace("docs/unsafe\0name.txt");
  if (name === "path_empty_component") return invalidFilePathWorkspace("docs//unsafe.txt");
  if (name === "path_non_scalar") return invalidFilePathWorkspace("docs/\ud800.txt");
  if (name === "tree_name_non_utf8") return malformedTreeNameWorkspace(Buffer.from([0xff]), "replacement.txt");
  if (name === "tree_name_slash") return malformedTreeNameWorkspace(Buffer.from("nested/name.txt", "utf8"), "nested/name.txt");
  throw new Error(`unknown workspace boundary scenario ${name}`);
}

let failures = 0;
for (const vector of vectors.vectors) {
  const manifest = scenario(vector.scenario);
  const schemaValid = validateSchema(manifest);
  const problems = [
    ...(schemaValid ? [] : validateSchema.errors.map((error) => `workspace schema ${error.instancePath} ${error.message}`)),
    ...verifyWorkspaceManifest(manifest)
  ];
  const actualValid = problems.length === 0;
  const matches = actualValid === vector.valid
    && (vector.valid || problems.join("\n").includes(vector.expectedError));
  if (!matches) {
    failures += 1;
    console.error(`${vector.id}: expected valid=${vector.valid}, found valid=${actualValid}`);
    problems.forEach((problem) => console.error(`  ${problem}`));
  }
}

if (failures > 0) {
  console.error(`workspace boundary vectors failed: ${failures}`);
  process.exitCode = 1;
} else {
  console.log(`workspace boundary vectors passed: ${vectors.vectors.length}`);
}
