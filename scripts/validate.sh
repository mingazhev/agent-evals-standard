#!/usr/bin/env bash
# Validate the repository: schemas, examples, prose consistency, versions.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! python3 -c "import jsonschema" 2>/dev/null; then
  echo "error: the 'jsonschema' package is required. Install it with:" >&2
  echo "  pip install jsonschema" >&2
  exit 2
fi

exec python3 "$ROOT/scripts/validate_standard.py" "$@"
