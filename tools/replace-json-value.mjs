import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const [from, to, ...inputs] = process.argv.slice(2);
if (!from || !to || inputs.length === 0) {
  process.stderr.write("usage: node tools/replace-json-value.mjs <from> <to> <file-or-directory> [...]\n");
  process.exit(2);
}

async function jsonFiles(input) {
  const absolute = path.resolve(input);
  const entries = await readdir(absolute, { withFileTypes: true }).catch(() => null);
  if (!entries) return absolute.endsWith(".json") ? [absolute] : [];
  const nested = await Promise.all(entries
    .filter((entry) => ![".git", "node_modules"].includes(entry.name))
    .map((entry) => jsonFiles(path.join(absolute, entry.name))));
  return nested.flat();
}

function replaceExact(value) {
  if (value === from) return { value: to, count: 1 };
  if (Array.isArray(value)) {
    let count = 0;
    const replaced = value.map((entry) => {
      const result = replaceExact(entry);
      count += result.count;
      return result.value;
    });
    return { value: replaced, count };
  }
  if (value && typeof value === "object") {
    let count = 0;
    const replaced = {};
    for (const [key, entry] of Object.entries(value)) {
      const result = replaceExact(entry);
      replaced[key] = result.value;
      count += result.count;
    }
    return { value: replaced, count };
  }
  return { value, count: 0 };
}

const files = [...new Set((await Promise.all(inputs.map(jsonFiles))).flat())].sort();
let total = 0;
for (const absolute of files) {
  const document = JSON.parse(await readFile(absolute, "utf8"));
  const result = replaceExact(document);
  if (result.count === 0) continue;
  await writeFile(absolute, `${JSON.stringify(result.value, null, 2)}\n`, "utf8");
  total += result.count;
  process.stdout.write(`${path.relative(process.cwd(), absolute)}: ${result.count}\n`);
}
process.stdout.write(`replaced: ${total}\n`);
