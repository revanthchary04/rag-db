#!/usr/bin/env bash
# Build docs/images/demo-walkthrough.gif from docs/images/demo-frames/*.png
# Requires ImageMagick (`magick` or `convert` on PATH).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FRAMES="$ROOT/docs/images/demo-frames"
OUT="$ROOT/docs/images/demo-walkthrough.gif"

if [[ ! -d "$FRAMES" ]]; then
  echo "Missing $FRAMES — run: pnpm demo:capture" >&2
  exit 1
fi

files=(
  "$FRAMES/01-chat.png"
  "$FRAMES/02-query-logs.png"
  "$FRAMES/03-eval-runs.png"
  "$FRAMES/04-eval-compare.png"
  "$FRAMES/05-eval-export.png"
)
for f in "${files[@]}"; do
  if [[ ! -f "$f" ]]; then
    echo "Missing $f — run: pnpm demo:capture" >&2
    exit 1
  fi
done

if command -v magick &>/dev/null; then
  magick -delay 110 -loop 0 "${files[@]}" "$OUT"
elif command -v convert &>/dev/null; then
  convert -delay 110 -loop 0 "${files[@]}" "$OUT"
else
  echo "Install ImageMagick (magick or convert) to stitch GIF." >&2
  exit 1
fi

echo "Wrote $OUT"
