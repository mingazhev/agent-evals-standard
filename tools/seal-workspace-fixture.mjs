#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  gitObjectGraphDigest,
  gitObjectId,
  repositoryTreeDigest,
  verifyWorkspaceManifest,
  workspaceRootDigest
} from "./verify-repository-grounding.mjs";

function objectRecord(type, content) {
  return {
    objectId: gitObjectId("sha1", type, content),
    type,
    byteLength: content.length,
    contentBase64: content.toString("base64")
  };
}

function entrySortKey(entry) {
  return Buffer.from(`${entry.name}${entry.mode === "40000" ? "/" : ""}`, "utf8");
}

function treeContent(entries) {
  return Buffer.concat(entries.map((entry) => Buffer.concat([
    Buffer.from(`${entry.mode} ${entry.name}\0`, "utf8"),
    Buffer.from(entry.objectId, "hex")
  ])));
}

function buildRepository(repository) {
  const requestedMode = repository.historyProjection?.mode ?? "tree_snapshot";
  if (!["tree_snapshot", "full_ancestry"].includes(requestedMode)) {
    throw new Error(`${repository.id}: fixture sealer can build only tree_snapshot or root full_ancestry; bounded ancestry requires an explicit history graph`);
  }
  const rootNode = { directories: new Map(), files: new Map(), gitlinks: new Map() };
  const objects = [];
  for (const file of repository.files ?? []) {
    const segments = file.path.split("/");
    let directory = rootNode;
    for (const segment of segments.slice(0, -1)) {
      if (!directory.directories.has(segment)) directory.directories.set(segment, { directories: new Map(), files: new Map(), gitlinks: new Map() });
      directory = directory.directories.get(segment);
    }
    const name = segments.at(-1);
    if (directory.files.has(name) || directory.directories.has(name) || directory.gitlinks.has(name)) throw new Error(`${repository.id}: duplicate Git path ${file.path}`);
    const blob = objectRecord("blob", Buffer.from(file.contentBase64, "base64"));
    objects.push(blob);
    directory.files.set(name, { mode: file.mode, objectId: blob.objectId });
  }
  for (const gitlink of repository.gitlinks ?? []) {
    const segments = gitlink.path.split("/");
    let directory = rootNode;
    for (const segment of segments.slice(0, -1)) {
      if (!directory.directories.has(segment)) directory.directories.set(segment, { directories: new Map(), files: new Map(), gitlinks: new Map() });
      directory = directory.directories.get(segment);
    }
    const name = segments.at(-1);
    if (directory.files.has(name) || directory.directories.has(name) || directory.gitlinks.has(name)) throw new Error(`${repository.id}: duplicate Git path ${gitlink.path}`);
    directory.gitlinks.set(name, { mode: "160000", objectId: gitlink.targetCommit });
  }

  function buildTree(directory) {
    const entries = [];
    for (const [name, child] of directory.directories) {
      const tree = buildTree(child);
      entries.push({ mode: "40000", name, objectId: tree.objectId });
    }
    for (const [name, file] of directory.files) entries.push({ mode: file.mode, name, objectId: file.objectId });
    for (const [name, gitlink] of directory.gitlinks) entries.push({ mode: gitlink.mode, name, objectId: gitlink.objectId });
    entries.sort((left, right) => Buffer.compare(entrySortKey(left), entrySortKey(right)));
    const tree = objectRecord("tree", treeContent(entries));
    objects.push(tree);
    return tree;
  }

  const rootTree = buildTree(rootNode);
  repository.objectFormat = "sha1";
  delete repository.baseRevision;
  delete repository.baseTree;
  const verifier = {
    id: "agent-evals-standard.git-repository-state-verifier",
    version: "0.1.0",
    algorithm: "git-repository-state-v1"
  };
  if (requestedMode === "tree_snapshot") {
    repository.baseTree = rootTree.objectId;
    repository.gitObjectGraph = { refs: [], objects, digest: "" };
    repository.historyProjection = {
      mode: "tree_snapshot",
      baseTree: rootTree.objectId,
      objectGraphDigest: "",
      reachableObjectCount: objects.length,
      verifier
    };
  } else {
    const commit = objectRecord("commit", Buffer.from([
      `tree ${rootTree.objectId}`,
      `author Fixture Builder <fixture@example.invalid> 0 +0000`,
      `committer Fixture Builder <fixture@example.invalid> 0 +0000`,
      "",
      `sealed workspace ${repository.id}`,
      ""
    ].join("\n"), "utf8"));
    objects.push(commit);
    repository.baseRevision = commit.objectId;
    repository.gitObjectGraph = {
      baseRef: "refs/heads/eval-base",
      refs: [{ name: "refs/heads/eval-base", target: commit.objectId }],
      objects,
      digest: ""
    };
    repository.historyProjection = {
      mode: "full_ancestry",
      cutoffRevision: commit.objectId,
      baseRef: "refs/heads/eval-base",
      objectGraphDigest: "",
      reachableObjectCount: objects.length,
      verifier
    };
  }
  objects.sort((left, right) => left.objectId.localeCompare(right.objectId));
  repository.treeDigest = repositoryTreeDigest(repository);
  repository.gitObjectGraph.digest = gitObjectGraphDigest(repository);
  repository.historyProjection.objectGraphDigest = repository.gitObjectGraph.digest;
}

export function sealWorkspaceManifest(manifest) {
  for (const repository of manifest.repositories ?? []) buildRepository(repository);
  manifest.repositories.sort((left, right) => left.id.localeCompare(right.id));
  manifest.workspaceRootDigest = workspaceRootDigest(manifest);
  const issues = verifyWorkspaceManifest(manifest);
  if (issues.length) throw new Error(issues.join("\n"));
  return manifest;
}

async function main() {
  const inputs = process.argv.slice(2);
  if (inputs.length === 0) {
    process.stderr.write("usage: node tools/seal-workspace-fixture.mjs <workspace.json> [...workspace.json]\n");
    process.exitCode = 2;
    return;
  }
  for (const input of inputs) {
    const absolute = path.resolve(input);
    const manifest = JSON.parse(await readFile(absolute, "utf8"));
    sealWorkspaceManifest(manifest);
    await writeFile(absolute, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    process.stdout.write(`${path.relative(process.cwd(), absolute)}\n`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  await main();
}
