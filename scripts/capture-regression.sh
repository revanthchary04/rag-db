#!/usr/bin/env bash
# Record the eval regression-flow video and copy it to docs/images/.
# Playwright writes the .webm under test-results/; we lift the newest one out.
#
#   pnpm demo:capture-regression   # this script
#   pnpm demo:regression-gif        # then convert the .webm to a GIF
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DEST="$ROOT/docs/images/eval-regression-flow.webm"

CAPTURE_REGRESSION_GIF=1 pnpm exec playwright test e2e/eval-regression-capture.spec.ts

WEBM="$(find "$ROOT/test-results" -type f -name '*.webm' -path '*eval-regression*' -print0 \
  | xargs -0 ls -t 2>/dev/null | head -1 || true)"

if [[ -z "${WEBM:-}" || ! -f "$WEBM" ]]; then
  echo "No video produced under test-results/ — did the capture test run?" >&2
  exit 1
fi

cp "$WEBM" "$DEST"
echo "Wrote $DEST"
