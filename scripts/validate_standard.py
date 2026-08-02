#!/usr/bin/env python3
"""Repository-wide validation for the Agent Evals Golden Standard.

Checks:
1. Every schema in schemas/ is valid JSON with a unique absolute $id.
2. Every $ref in every schema resolves (local or within the schema registry).
3. Every example in examples/ validates against its schema.
4. Prose/schema consistency: enums and registries listed in the Markdown
   documents match the JSON Schemas (gate IDs, outcome categories, lifecycle
   states, escalation event IDs, conformance claim targets).
5. examples/ are semantically coherent: artifact references resolve into
   evidence manifests, ledger events and attempt records agree, cell states
   match trial results, and case hashes match QA records.
6. versions.json is the single source of truth for release/contract/schema
   versions and the schema constants agree with it.

Requires Python 3.8+ and the `jsonschema` package.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

try:
    from jsonschema import Draft202012Validator, FormatChecker
except ImportError:  # pragma: no cover
    sys.stderr.write(
        "Missing dependency: run `pip install jsonschema` or use scripts/validate.sh\n"
    )
    sys.exit(2)

ROOT = Path(__file__).resolve().parent.parent
SCHEMAS_DIR = ROOT / "schemas"
EXAMPLES_DIR = ROOT / "examples"
STANDARD_DIR = ROOT / "standard"
VERSIONS_FILE = ROOT / "versions.json"

failures: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)


# ---------------------------------------------------------------- schema loading

def load_schemas() -> dict[str, dict]:
    registry: dict[str, dict] = {}
    for path in sorted(SCHEMAS_DIR.glob("*.schema.json")):
        try:
            schema = json.loads(path.read_text())
        except json.JSONDecodeError as exc:
            fail(f"{path.relative_to(ROOT)}: not valid JSON: {exc}")
            continue
        sid = schema.get("$id")
        if not isinstance(sid, str) or not sid:
            fail(f"{path.relative_to(ROOT)}: missing or invalid $id")
            continue
        if sid in registry:
            fail(f"{path.relative_to(ROOT)}: duplicate $id {sid!r}")
        registry[sid] = schema
    return registry


def collect_refs(node: object, out: list[str]) -> None:
    if isinstance(node, dict):
        ref = node.get("$ref")
        if isinstance(ref, str):
            out.append(ref)
        for value in node.values():
            collect_refs(value, out)
    elif isinstance(node, list):
        for item in node:
            collect_refs(item, out)


def check_refs(registry: dict[str, dict]) -> None:
    for sid, schema in registry.items():
        refs: list[str] = []
        collect_refs(schema, refs)
        for ref in refs:
            if ref.startswith("#"):
                if not ref.startswith("#/$defs/"):
                    fail(f"{sid}: unsupported local $ref {ref!r}")
                elif ref[8:] not in schema.get("$defs", {}):
                    fail(f"{sid}: unresolvable local $ref {ref!r}")
            elif ref not in registry:
                fail(f"{sid}: unresolvable external $ref {ref!r}")


# --------------------------------------------------------------- example mapping

EXAMPLE_SCHEMAS = {
    "case.json": "urn:agent-evals-standard:schema:case:1",
    "case-qa-record.json": "urn:agent-evals-standard:schema:case-qa-record:1",
    "scorecard.json": "urn:agent-evals-standard:schema:scorecard:1",
    "conformance-statement.json": "urn:agent-evals-standard:schema:conformance-statement:1",
    "governance-decision.json": "urn:agent-evals-standard:schema:governance-decision:1",
}


def validate_examples(registry: dict[str, dict]) -> None:
    fmt = FormatChecker()
    for fname, sid in EXAMPLE_SCHEMAS.items():
        path = EXAMPLES_DIR / fname
        try:
            instance = json.loads(path.read_text())
        except json.JSONDecodeError as exc:
            fail(f"{path.relative_to(ROOT)}: not valid JSON: {exc}")
            continue
        validator = Draft202012Validator(registry[sid], format_checker=fmt)
        errors = sorted(validator.iter_errors(instance), key=lambda e: list(e.path))
        if errors:
            for err in errors[:10]:
                fail(f"{path.relative_to(ROOT)}: {err.message} at /{'/'.join(map(str, err.path))}")


# ------------------------------------------------------- prose/schema consistency

def backticked(cell: str) -> str:
    m = re.search(r"`([^`]+)`", cell)
    return m.group(1) if m else ""


def table_first_column_ids(md: Path, start: str | None = None, end: str | None = None) -> list[str]:
    text = md.read_text()
    if start:
        text = text[text.index(start):]
    if end:
        text = text[: text.index(end)]
    rows: list[str] = []
    for line in text.splitlines():
        m = re.match(r"^\|\s*`([^`]+)`\s*\|", line)
        if m:
            rows.append(m.group(1))
    return rows


def check_prose_schema_consistency(registry: dict[str, dict]) -> None:
    scorecard_md = STANDARD_DIR / "scorecard-contract.md"
    standard_md = STANDARD_DIR / "standard.md"
    matrix_md = STANDARD_DIR / "escalation-stop-matrix.md"
    conformance_md = STANDARD_DIR / "conformance.md"

    prose_gates = table_first_column_ids(scorecard_md, "## Gate Registry", "### Blocking Governance Status Registry")
    if len(prose_gates) != 15:
        fail(f"scorecard-contract.md: expected 15 baseline gate IDs, found {len(prose_gates)}")
    scorecard_schema = registry["urn:agent-evals-standard:schema:scorecard:1"]
    if scorecard_schema["$defs"]["gateCoverage"]["properties"]["registryVersion"]["const"] != "baseline-hard-gates-1":
        fail("scorecard.schema.json: gate registry version const does not match versions.json expectations")

    statuses_md = table_first_column_ids(scorecard_md, "### Blocking Governance Status Registry")
    if len(statuses_md) != 2:
        fail(f"scorecard-contract.md: expected 2 blocking governance statuses, found {len(statuses_md)}")

    outcome_enum = scorecard_schema["$defs"]["primaryOutcome"]["enum"]
    outcome_section = scorecard_md.read_text().split("## Primary Outcome Categories")[1].split("### Priority Order")[0]
    prose_outcomes = re.findall(r"^\- `([a-z_]+)` —", outcome_section, re.MULTILINE)
    if set(outcome_enum) != set(prose_outcomes):
        fail(
            "scorecard-contract.md primary outcome list diverges from scorecard.schema.json: "
            f"schema-only={sorted(set(outcome_enum) - set(prose_outcomes))} "
            f"prose-only={sorted(set(prose_outcomes) - set(outcome_enum))}"
        )

    lifecycle_enum = registry["urn:agent-evals-standard:schema:case:1"]["properties"]["lifecycle"]["properties"]["status"]["enum"]
    lifecycle_section = standard_md.read_text().split("### Lifecycle States")[1]
    prose_lifecycle = re.findall(r"^\- `([a-z_]+)`", lifecycle_section, re.MULTILINE)
    if set(lifecycle_enum) != set(prose_lifecycle):
        fail(
            "standard.md lifecycle states diverge from case.schema.json: "
            f"schema-only={sorted(set(lifecycle_enum) - set(prose_lifecycle))} "
            f"prose-only={sorted(set(prose_lifecycle) - set(lifecycle_enum))}"
        )

    event_enum = registry["urn:agent-evals-standard:schema:escalation-event:1"]["properties"]["eventId"]["enum"]
    prose_events = table_first_column_ids(matrix_md)
    if set(event_enum) != set(prose_events):
        fail(
            "escalation-stop-matrix.md event IDs diverge from escalation-event.schema.json: "
            f"schema-only={sorted(set(event_enum) - set(prose_events))} "
            f"prose-only={sorted(set(prose_events) - set(event_enum))}"
        )

    claim_enum = registry["urn:agent-evals-standard:schema:conformance-statement:1"]["properties"]["claim"]["enum"]
    conformance_text = conformance_md.read_text()
    for target in ["case", "evaluator", "run", "decision"]:
        if f"**{target.capitalize()} conformance**" not in conformance_text:
            fail(f"conformance.md: missing conformance target section for {target!r}")
    if "full conformance" not in conformance_text:
        fail("conformance.md: missing 'full conformance' wording")
    if "full" not in claim_enum:
        fail("conformance-statement.schema.json: claim enum lacks 'full'")

    scorecard_md_text = scorecard_md.read_text()
    if "functional-outcome-v1" not in scorecard_md_text or "accepted-outcome-v1" not in scorecard_md_text:
        fail("scorecard-contract.md: executable predicate IDs are missing from prose")


# ------------------------------------------------------------------ version check

def check_versions(registry: dict[str, dict]) -> None:
    if not VERSIONS_FILE.exists():
        fail("versions.json is missing")
        return
    versions = json.loads(VERSIONS_FILE.read_text())
    release = versions["release"]
    contracts = versions["contracts"]
    registries = versions["registries"]

    version_file = (ROOT / "VERSION").read_text().strip()
    if version_file != release["goldenStandard"]:
        fail(f"VERSION file ({version_file!r}) != versions.json release.goldenStandard ({release['goldenStandard']!r})")

    for fname, expected in versions["schemas"].items():
        schema = json.loads((SCHEMAS_DIR / fname).read_text())
        actual = schema.get("properties", {}).get("schemaVersion", {}).get("const")
        if actual != expected:
            fail(f"{fname}: schemaVersion const {actual!r} != versions.json {expected!r}")

    case_schema = registry["urn:agent-evals-standard:schema:case:1"]
    qa_schema = registry["urn:agent-evals-standard:schema:case-qa-record:1"]
    scorecard_schema = registry["urn:agent-evals-standard:schema:scorecard:1"]
    conformance_schema = registry["urn:agent-evals-standard:schema:conformance-statement:1"]

    for schema, label in [(case_schema, "case"), (qa_schema, "case-qa-record")]:
        contracts_node = schema["properties"]["contracts"]["properties"]
        for key, expected in [
            ("goldenStandardVersion", release["goldenStandard"]),
            ("caseContractVersion", contracts["case"]),
            ("scorecardContractVersion", contracts["scorecard"]),
            ("semanticValidationVersion", contracts["semanticValidation"]),
        ]:
            actual = contracts_node.get(key, {}).get("const")
            if actual != expected:
                fail(f"{label}.schema.json contracts.{key} const {actual!r} != versions.json {expected!r}")

    scorecard_release = scorecard_schema["$defs"]["provenance"]["properties"]["standardRelease"]["properties"]
    conformance_release = conformance_schema["properties"]["standardRelease"]["properties"]
    for schema, label, rel in [
        (scorecard_schema, "scorecard", scorecard_release),
        (conformance_schema, "conformance-statement", conformance_release),
    ]:
        if rel["version"]["const"] != release["goldenStandard"]:
            fail(f"{label}.schema.json standardRelease.version const != versions.json release.goldenStandard")
        if rel["tag"]["const"] != release["tag"]:
            fail(f"{label}.schema.json standardRelease.tag const != versions.json release.tag")

    contracts_node = scorecard_schema["$defs"]["provenance"]["properties"]["contracts"]["properties"]
    for key, expected in [
        ("scorecard", contracts["scorecard"]),
        ("case", contracts["case"]),
        ("semanticValidation", contracts["semanticValidation"]),
    ]:
        actual = contracts_node[key]["allOf"][1]["properties"]["version"]["const"]
        if actual != expected:
            fail(f"scorecard.schema.json provenance.contracts.{key} version const {actual!r} != versions.json {expected!r}")

    for key, expected, where in [
        ("baselineHardGates", registries["baselineHardGates"], scorecard_schema["$defs"]["gateCoverage"]["properties"]["registryVersion"]["const"]),
        ("blockingGovernanceStatuses", registries["blockingGovernanceStatuses"], scorecard_schema["$defs"]["governanceCoverage"]["properties"]["registryVersion"]["const"]),
    ]:
        if where != expected:
            fail(f"scorecard.schema.json registry {key} const {where!r} != versions.json {expected!r}")


# ---------------------------------------------------------- semantic example checks

def walk_artifact_ref_paths(schema: dict) -> list[list[str]]:
    """Return JSON-path patterns of every property bound to artifactRef.

    A pattern is a list of segments; segments are either ("key", name) or
    ("items",). Array indices in instances match ("items",) segments.
    """
    def resolves_to_ref(node: object) -> bool:
        if isinstance(node, dict):
            if node.get("$ref") == "#/$defs/artifactRef":
                return True
            for sub in node.get("oneOf", []):
                if sub.get("$ref") == "#/$defs/artifactRef":
                    return True
        return False

    def is_array_of_ref(node: object) -> bool:
        if not isinstance(node, dict):
            return False
        items = node.get("items")
        return isinstance(items, dict) and (
            items.get("$ref") == "#/$defs/artifactRef"
            or any(sub.get("$ref") == "#/$defs/artifactRef" for sub in items.get("oneOf", []))
        )

    paths: list[list[str]] = []
    visited: set[int] = set()

    def walk(node: object, path: list[str]) -> None:
        if isinstance(node, dict):
            ref = node.get("$ref")
            if isinstance(ref, str) and ref.startswith("#/$defs/"):
                target = schema["$defs"].get(ref[8:])
                if target is not None and id(target) not in visited:
                    visited.add(id(target))
                    walk(target, path)
                return
            for key, sub in node.get("properties", {}).items():
                if resolves_to_ref(sub) or is_array_of_ref(sub):
                    paths.append(path + ["key", key])
                else:
                    walk(sub, path + ["key", key])
            for sub in node.get("prefixItems", []):
                walk(sub, path + ["items"])
            for sub in node.get("allOf", []):
                walk(sub, path)
            for sub in node.get("oneOf", []):
                walk(sub, path)
        elif isinstance(node, list):
            for item in node:
                walk(item, path)

    walk(schema, [])
    return paths


def find_by_pattern(instance: object, pattern: list[str], cur: list[str] = None) -> list[object]:
    cur = cur or []
    results: list[object] = []

    def matches(pattern_seg: str, actual_seg: str) -> bool:
        return pattern_seg == actual_seg or (pattern_seg == "items" and actual_seg.startswith("index:"))

    if not pattern:
        results.append(instance)
        return results

    if isinstance(instance, dict):
        for key, value in instance.items():
            if matches(pattern[0], "key:" + key):
                results.extend(find_by_pattern(value, pattern[1:], cur + ["key:" + key]))
    elif isinstance(instance, list):
        if matches(pattern[0], "items"):
            for i, value in enumerate(instance):
                results.extend(find_by_pattern(value, pattern[1:], cur + [f"index:{i}"]))
    return results


def artifact_ref_values(instance: object, paths: list[list[str]]) -> list[tuple[str, list[str]]]:
    """Return (value, path-description) pairs found at the given ref paths."""
    found: list[tuple[str, list[str]]] = []
    for pattern in paths:
        for node in find_by_pattern(instance, pattern):
            values = node if isinstance(node, list) else [node]
            for value in values:
                if isinstance(value, str):
                    found.append((value, pattern))
    return found


def check_example_semantics(registry: dict[str, dict]) -> None:
    # ---- case / QA record cross-consistency
    case = json.loads((EXAMPLES_DIR / "case.json").read_text())
    qa = json.loads((EXAMPLES_DIR / "case-qa-record.json").read_text())

    if qa["case"]["hash"] != case.get("lifecycle", {}).get("activationInputHash"):
        fail("examples/case-qa-record.json: case.hash does not match examples/case.json lifecycle.activationInputHash")
    if qa["case"]["toState"] != "active":
        fail("examples/case-qa-record.json: activation record must move the case to active")
    if qa["decision"]["status"] != "activated" or qa["decision"]["unresolvedBlockingDefects"] != 0:
        fail("examples/case-qa-record.json: activated decision must have zero unresolved blocking defects")
    if any(stage["status"] != "passed" for stage in qa["stages"]):
        fail("examples/case-qa-record.json: activated record requires every stage passed")
    if qa["measurementValidation"]["falsePositive"]["status"] != "pass" or qa["measurementValidation"]["falseNegative"]["status"] != "pass":
        fail("examples/case-qa-record.json: activated record requires FP/FN validation pass")

    # ---- scorecard semantics
    scorecard = json.loads((EXAMPLES_DIR / "scorecard.json").read_text())
    scorecard_schema = registry["urn:agent-evals-standard:schema:scorecard:1"]
    ref_paths = walk_artifact_ref_paths(scorecard_schema)
    if not ref_paths:
        fail("scorecard.schema.json: no artifactRef properties found; walker may be broken")

    manifest_ids = {e["id"] for e in scorecard["evidenceManifest"]}
    for value, pattern in artifact_ref_values(scorecard, ref_paths):
        if value not in manifest_ids:
            fail(f"examples/scorecard.json: artifactRef {value!r} at {'.'.join(pattern[1::2])} not found in evidenceManifest")

    gate_ids = set(scorecard["caseResults"][0]["gateCoverage"]["evaluatedIds"])
    trial_gate_ids = {g["id"] for g in scorecard["caseResults"][0]["cells"][0]["trialResult"]["hardGates"]}
    if gate_ids != trial_gate_ids:
        fail("examples/scorecard.json: gateCoverage.evaluatedIds diverges from trial hard-gate IDs")

    attempts = {r["attemptId"] for r in scorecard["attemptIntegrity"]["attemptRecords"]}
    ledger_attempts = {e["attemptId"] for e in scorecard["attemptIntegrity"]["ledgerEvents"]}
    if attempts != ledger_attempts:
        fail("examples/scorecard.json: attemptRecords and ledgerEvents attempt IDs diverge")

    for cell in scorecard["caseResults"][0]["cells"]:
        result = cell["trialResult"]
        accepted = result["validity"]["status"] == "valid" and result["primaryOutcome"] in (
            "solved", "correct_refusal", "already_solved"
        ) and result["accepted"]
        cell_ok = cell["state"] == "valid_success" if accepted else cell["state"] in ("valid_failure", "unresolved")
        if not cell_ok:
            fail(f"examples/scorecard.json: cell {cell['cellId']} state inconsistent with its trial result")
        if result["accepted"] and any(g["status"] != "pass" for g in result["hardGates"]):
            fail(f"examples/scorecard.json: accepted trial {cell['cellId']} has a non-passing hard gate")
        if result["accepted"] and any(s["state"] == "open" for s in result["governanceStatuses"]):
            fail(f"examples/scorecard.json: accepted trial {cell['cellId']} has an open blocking governance status")

    # ---- conformance statement semantics
    conformance = json.loads((EXAMPLES_DIR / "conformance-statement.json").read_text())
    conformance_schema = registry["urn:agent-evals-standard:schema:conformance-statement:1"]
    manifest_ids = {e["id"] for e in conformance["evidenceManifest"]}
    for value, pattern in artifact_ref_values(conformance, walk_artifact_ref_paths(conformance_schema)):
        if value not in manifest_ids:
            fail(f"examples/conformance-statement.json: artifactRef {value!r} at {'.'.join(pattern[1::2])} not found in evidenceManifest")
    if conformance["deviations"] and not conformance["claimRestrictions"]:
        fail("examples/conformance-statement.json: deviations require claim restrictions")


# ---------------------------------------------------------------------------- main

def main() -> int:
    registry = load_schemas()
    if not registry:
        fail("no schemas loaded")
    check_refs(registry)
    validate_examples(registry)
    check_prose_schema_consistency(registry)
    check_versions(registry)
    check_example_semantics(registry)

    if failures:
        print(f"FAIL ({len(failures)} problem(s)):")
        for item in failures:
            print(f"  - {item}")
        return 1
    print(f"OK: {len(registry)} schemas, {len(EXAMPLE_SCHEMAS)} examples, versions, prose, and semantics consistent")
    return 0


if __name__ == "__main__":
    sys.exit(main())
