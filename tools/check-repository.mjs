import { readFile, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";

const root = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, "$1"));
const failures = [];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    if ([".git", "node_modules"].includes(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await walk(absolute));
    else paths.push(absolute);
  }
  return paths;
}

function relative(file) {
  return path.relative(root, file).replaceAll("\\", "/");
}

function visit(value, callback, pointer = "#") {
  callback(value, pointer);
  if (Array.isArray(value)) {
    value.forEach((item, index) => visit(item, callback, `${pointer}/${index}`));
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      const escaped = key.replaceAll("~", "~0").replaceAll("/", "~1");
      visit(item, callback, `${pointer}/${escaped}`);
    }
  }
}

function packageVersionFailures(document, label, { lockfile = false } = {}) {
  const problems = [];
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    return [`${label} must be a JSON object`];
  }
  if (document.version !== "0.1.0") {
    problems.push(`${label} version must be exactly 0.1.0; found ${JSON.stringify(document.version)}`);
  }
  if (lockfile && document.packages?.[""]?.version !== "0.1.0") {
    problems.push(`${label} root package version must be exactly 0.1.0; found ${JSON.stringify(document.packages?.[""]?.version)}`);
  }
  return problems;
}

function citationVersionFailures(content, label) {
  const matches = [...content.matchAll(/^version:\s*(?:"([^"]*)"|'([^']*)'|([^\s#]+))\s*(?:#.*)?$/gm)];
  if (matches.length !== 1) {
    return [`${label} must contain exactly one root project version field; found ${matches.length}`];
  }
  const value = matches[0][1] ?? matches[0][2] ?? matches[0][3];
  return value === "0.1.0"
    ? []
    : [`${label} version must be exactly 0.1.0; found ${JSON.stringify(value)}`];
}

function projectJsonVersionFailures(document, label) {
  const problems = [];

  function walk(value, pointer = "#", context = {}) {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${pointer}/${index}`, {
        runtimeComponent: context.runtimeList === true
      }));
      return;
    }
    if (!value || typeof value !== "object") return;

    const isEnvironmentContract = value.schemaVersion === "agent-eval-environment-contract-1";
    for (const [key, item] of Object.entries(value)) {
      const escaped = key.replaceAll("~", "~0").replaceAll("/", "~1");
      const itemPointer = `${pointer}/${escaped}`;
      const isProjectVersionField = key === "version" || (key !== "schemaVersion" && key.endsWith("Version"));
      const isTypedRuntimeVersion = context.runtimeComponent === true && key === "version";

      if (isProjectVersionField && !isTypedRuntimeVersion) {
        if (item !== "0.1.0") {
          problems.push(`${label} ${itemPointer} must be exactly 0.1.0; found ${JSON.stringify(item)}`);
        }
      }

      walk(item, itemPointer, {
        runtimeList: isEnvironmentContract && key === "runtimes"
      });
    }
  }

  walk(document);
  return problems;
}

function runVersionInvariantSelfTests() {
  const checks = [
    {
      name: "package mutation",
      actual: packageVersionFailures({ version: "0.1.1" }, "synthetic package").length,
      expected: 1
    },
    {
      name: "package-lock root mutation",
      actual: packageVersionFailures({ version: "0.1.0", packages: { "": { version: "0.1.1" }, "node_modules/example": { version: "9.9.9" } } }, "synthetic lockfile", { lockfile: true }).length,
      expected: 1
    },
    {
      name: "CITATION mutation",
      actual: citationVersionFailures("cff-version: 1.2.0\nversion: 0.1.1\n", "synthetic citation").length,
      expected: 1
    },
    {
      name: "project JSON mutation",
      actual: projectJsonVersionFailures({ schemaVersion: "format-1", component: { version: "0.1.1" } }, "synthetic artifact").length,
      expected: 1
    },
    {
      name: "project JSON named-version mutation",
      actual: projectJsonVersionFailures({ schemaVersion: "format-1", standardVersion: "0.1.1" }, "synthetic artifact").length,
      expected: 1
    },
    {
      name: "format and runtime exclusions",
      actual: projectJsonVersionFailures({
        schemaVersion: "agent-eval-environment-contract-1",
        version: "0.1.0",
        runtimes: [{ id: "node-runtime", version: "25.2.1", digest: "sha256:synthetic" }],
        mutations: [{ pointer: "/component/version", value: "0.1.1" }]
      }, "synthetic environment").length,
      expected: 0
    }
  ];
  return checks
    .filter(({ actual, expected }) => actual !== expected)
    .map(({ name, actual, expected }) => `internal version-invariant self-test ${name} expected ${expected} failure(s), observed ${actual}`);
}

function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}

function canonicalSelfDigest(document) {
  const projection = structuredClone(document);
  delete projection.digest;
  delete projection.signature;
  return `sha256:${createHash("sha256").update(Buffer.from(canonicalize(projection), "utf8")).digest("hex")}`;
}

function expectedVerificationContract(requirement) {
  const permittedMethods = requirement.verificationKind === "manual_governance"
    ? ["accountable_review"]
    : ["automated_replay"];
  return {
    criterionId: `${requirement.id}.complete`,
    strength: "complete_primary_definition",
    normativeReference: requirement.normativeReference,
    question: `Does the target satisfy every applicable REQUIRED obligation of ${requirement.id} at ${requirement.normativeReference} and every named semantic contract invoked there, and either satisfy or record an approved, scoped deviation for every applicable RECOMMENDED obligation?`,
    permittedMethods
  };
}

function resolvesPointer(document, fragment) {
  if (!fragment || fragment === "#") return true;
  if (!fragment.startsWith("#/")) return false;
  let current = document;
  for (const encoded of fragment.slice(2).split("/")) {
    const token = decodeURIComponent(encoded).replaceAll("~1", "/").replaceAll("~0", "~");
    if (current === null || typeof current !== "object" || !(token in current)) return false;
    current = current[token];
  }
  return true;
}

function githubHeadingSlug(text) {
  return text
    .trim()
    .replace(/\s+#+\s*$/, "")
    .replace(/<[^>]*>/g, "")
    .replace(/[`*_~]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}

function markdownAnchors(content) {
  const counts = new Map();
  const anchors = new Set();
  for (const line of content.split(/\r?\n/)) {
    const match = /^(?: {0,3})#{1,6}\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    const base = githubHeadingSlug(match[1]);
    if (!base) continue;
    const count = counts.get(base) ?? 0;
    anchors.add(count === 0 ? base : `${base}-${count}`);
    counts.set(base, count + 1);
  }
  return anchors;
}

const files = await walk(root);
failures.push(...runVersionInvariantSelfTests());

const version = (await readFile(path.join(root, "VERSION"), "utf8")).trim();
if (version !== "0.1.0") failures.push(`VERSION must be exactly 0.1.0; found ${version}`);

for (const [name, options] of [["package.json", {}], ["package-lock.json", { lockfile: true }]]) {
  try {
    const document = JSON.parse(await readFile(path.join(root, name), "utf8"));
    failures.push(...packageVersionFailures(document, name, options));
  } catch (error) {
    failures.push(`${name} cannot be checked for version identity: ${error.message}`);
  }
}

try {
  const citation = await readFile(path.join(root, "CITATION.cff"), "utf8");
  failures.push(...citationVersionFailures(citation, "CITATION.cff"));
} catch (error) {
  failures.push(`CITATION.cff cannot be checked for version identity: ${error.message}`);
}

const projectJsonFiles = files.filter((file) => {
  const name = relative(file);
  return file.endsWith(".json")
    && !name.startsWith("schemas/")
    && !["package.json", "package-lock.json"].includes(name);
});
for (const file of projectJsonFiles) {
  const name = relative(file);
  try {
    const document = JSON.parse(await readFile(file, "utf8"));
    failures.push(...projectJsonVersionFailures(document, name));
  } catch (error) {
    failures.push(`${name} cannot be checked for version identity: ${error.message}`);
  }
}

if (files.some((file) => relative(file).toLowerCase() === "changelog.md")) {
  failures.push("CHANGELOG.md must not exist before the first publication");
}

const textFiles = files.filter((file) => [".md", ".json", ".cff", ".yml", ".yaml"].includes(path.extname(file).toLowerCase()));
const forbidden = [
  [/0\.2\.0/g, "obsolete draft version 0.2.0"],
  [/semantic-validation-0\.(?!1\.0)\d+\.\d+/g, "non-0.1.0 semantic contract"],
  [/(?:governance-policy|escalation-stop-matrix)-template-0\.(?!1\.0)\d+\.\d+/g, "non-0.1.0 template"],
  [/^#{1,6}\s+(?:change\s*log|version history)\s*$/gim, "version-history section"]
];
for (const file of textFiles) {
  const content = await readFile(file, "utf8");
  for (const [pattern, label] of forbidden) {
    pattern.lastIndex = 0;
    if (pattern.test(content)) failures.push(`${relative(file)} contains ${label}`);
  }
}

const schemaFiles = files.filter((file) => relative(file).startsWith("schemas/") && file.endsWith(".schema.json"));
const schemas = new Map();
for (const file of schemaFiles) {
  let schema;
  try {
    schema = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    failures.push(`${relative(file)} is not valid JSON: ${error.message}`);
    continue;
  }
  if (schema.$schema !== "https://json-schema.org/draft/2020-12/schema") {
    failures.push(`${relative(file)} must declare JSON Schema 2020-12`);
  }
  if (typeof schema.$id !== "string") {
    failures.push(`${relative(file)} has no root $id`);
  } else if (schemas.has(schema.$id)) {
    failures.push(`${relative(file)} duplicates $id ${schema.$id}`);
  } else {
    schemas.set(schema.$id, { file, schema });
  }
}

for (const { file, schema } of schemas.values()) {
  visit(schema, (value, pointer) => {
    if (pointer.endsWith("/$comment") && typeof value === "string"
      && /\b(?:MUST(?:\s+NOT)?|REQUIRED|SHALL(?:\s+NOT)?|SHOULD(?:\s+NOT)?|RECOMMENDED|MAY|OPTIONAL)\b/.test(value)) {
      failures.push(`${relative(file)} ${pointer} uses an RFC 2119 keyword in an informative annotation`);
    }
    if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.$ref !== "string") return;
    const [base, rawFragment] = value.$ref.split("#", 2);
    const fragment = rawFragment === undefined ? "" : `#${rawFragment}`;
    let target = schema;
    if (base) {
      const resolved = schemas.get(base);
      if (!resolved) {
        failures.push(`${relative(file)} ${pointer}/$ref cannot resolve schema ${base}`);
        return;
      }
      target = resolved.schema;
    }
    if (!resolvesPointer(target, fragment)) {
      failures.push(`${relative(file)} ${pointer}/$ref cannot resolve pointer ${fragment || "#"}`);
    }
  });
}

const markdownFiles = files.filter((file) => file.endsWith(".md"));
const markdownAnchorCache = new Map();
const localMarkdownEdges = new Set();
for (const file of markdownFiles) {
  const content = await readFile(file, "utf8");
  const linkPattern = /(?<!!)\[[^\]]*\]\((?<target>[^)]+)\)/g;
  for (const match of content.matchAll(linkPattern)) {
    let target = match.groups.target.trim();
    if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1);
    if (/^(?:https?:|mailto:)/i.test(target)) continue;
    const hashIndex = target.indexOf("#");
    const rawFilePart = hashIndex === -1 ? target : target.slice(0, hashIndex);
    const rawFragment = hashIndex === -1 ? "" : target.slice(hashIndex + 1);
    const filePart = decodeURIComponent(rawFilePart);
    const absolute = filePart ? path.resolve(path.dirname(file), filePart) : file;
    let targetStat;
    try {
      targetStat = await stat(absolute);
      if (!targetStat.isFile() && !targetStat.isDirectory()) throw new Error("not a file or directory");
    } catch {
      failures.push(`${relative(file)} has broken local link ${target}`);
      continue;
    }
    if (targetStat.isFile() && path.extname(absolute).toLowerCase() === ".md") {
      localMarkdownEdges.add(`${relative(file)}->${relative(absolute)}`);
    }
    if (rawFragment && targetStat.isFile() && path.extname(absolute).toLowerCase() === ".md") {
      if (!markdownAnchorCache.has(absolute)) {
        markdownAnchorCache.set(absolute, markdownAnchors(await readFile(absolute, "utf8")));
      }
      const fragment = decodeURIComponent(rawFragment).toLowerCase();
      if (!markdownAnchorCache.get(absolute).has(fragment)) {
        failures.push(`${relative(file)} has broken Markdown anchor ${target}`);
      }
    }
  }
}

const requiredNormativeInvocations = [
  ["standard/standard.md", "standard/requirements.md"],
  ["standard/standard.md", "standard/scorecard-contract.md"],
  ["standard/standard.md", "standard/case-qa-playbook.md"],
  ["standard/standard.md", "standard/evidence-and-validation-contract.md"],
  ["standard/standard.md", "standard/security-threat-model.md"],
  ["standard/standard.md", "standard/validity-threat-exposure-contracts.md"],
  ["standard/standard.md", "standard/governance-policy.md"],
  ["standard/standard.md", "standard/conformance.md"],
  ["standard/conformance.md", "standard/integrity-and-semantic-validation.md"],
  ["standard/evidence-and-validation-contract.md", "standard/signature-and-trust-profile.md"],
  ["standard/evidence-and-validation-contract.md", "standard/security-threat-model.md"],
  ["standard/evidence-and-validation-contract.md", "standard/validity-threat-exposure-contracts.md"],
  ["standard/governance-policy.md", "standard/escalation-stop-matrix.md"]
];
for (const [primary, contract] of requiredNormativeInvocations) {
  if (!localMarkdownEdges.has(`${primary}->${contract}`)) {
    failures.push(`${primary} must explicitly invoke normative contract ${contract}`);
  }
}

for (const name of ["standard/references.md", "standard/security-case-backlog.md"]) {
  const content = await readFile(path.join(root, name), "utf8");
  if (/\b(?:MUST(?:\s+NOT)?|REQUIRED|SHALL(?:\s+NOT)?|SHOULD(?:\s+NOT)?|RECOMMENDED|MAY|OPTIONAL)\b/.test(content)) {
    failures.push(`${name} is informative and must not contain RFC 2119 keywords`);
  }
}

try {
  const registry = JSON.parse(await readFile(path.join(root, "standard", "requirement-registry.json"), "utf8"));
  const registryIds = (registry.requirements ?? []).map((requirement) => requirement.id);
  const requirementsIndex = await readFile(path.join(root, "standard", "requirements.md"), "utf8");
  const indexRows = requirementsIndex.split(/\r?\n/)
    .map((line) => {
      const columns = line.startsWith("|") ? line.slice(1, -1).split("|").map((value) => value.trim()) : [];
      const id = /^`([^`]+)`$/.exec(columns[0] ?? "")?.[1];
      const primaryReference = /\]\(([^)]+)\)/.exec(columns[3] ?? "")?.[1];
      return id ? { id, primaryReference } : null;
    })
    .filter(Boolean);
  const indexIds = indexRows.map((row) => row.id);
  const indexPrimaryReferenceById = new Map(indexRows.map((row) => [row.id, row.primaryReference]));
  if (new Set(registryIds).size !== registryIds.length) failures.push("requirement-registry.json contains duplicate requirement IDs");
  if (new Set(indexIds).size !== indexIds.length) failures.push("requirements.md contains duplicate requirement IDs");
  if (registryIds.length !== indexIds.length || registryIds.some((id, index) => indexIds[index] !== id)) {
    failures.push("requirements.md IDs and order must exactly match requirement-registry.json");
  }
  const expectedRegistryDigest = canonicalSelfDigest(registry);
  if (registry.digest !== expectedRegistryDigest) {
    failures.push(`requirement-registry.json self digest must be ${expectedRegistryDigest}`);
  }
  for (const requirement of registry.requirements ?? []) {
    if (indexPrimaryReferenceById.get(requirement.id) !== requirement.normativeReference) {
      failures.push(`requirements.md ${requirement.id} primary reference must equal requirement-registry.json ${requirement.normativeReference}`);
    }
    const expected = expectedVerificationContract(requirement);
    if (canonicalize(requirement.verificationContract) !== canonicalize(expected)) {
      failures.push(`requirement-registry.json ${requirement.id} verificationContract is not the canonical requirement-owned contract`);
    }
  }
} catch (error) {
  failures.push(`could not compare requirement registry projections: ${error.message}`);
}

if (failures.length) {
  console.error(`Repository checks failed (${failures.length}):`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`Repository checks passed: ${schemaFiles.length} schemas, ${markdownFiles.length} Markdown files.`);
