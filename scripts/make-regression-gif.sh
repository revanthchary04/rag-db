#!/usr/bin/env bash
# Convert the recorded regression-flow video into an optimized GIF for the README.
# Two-pass ffmpeg (palettegen + paletteuse) for clean colour on the dark UI.
#
#   pnpm demo:capture-regression   # records docs/images/eval-regression-flow.webm
#   pnpm demo:regression-gif        # this script → docs/images/eval-regression-flow.gif
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/docs/images/eval-regression-flow.webm"
OUT="$ROOT/docs/images/eval-regression-flow.gif"
PALETTE="$(mktemp -t regression-palette-XXXX).png"

if [[ ! -f "$SRC" ]]; then
  echo "Missing $SRC — run: pnpm demo:capture-regression" >&2
  exit 1
fi
if ! command -v ffmpeg &>/dev/null; then
  echo "Install ffmpeg to build the GIF." >&2
  exit 1
fi

# Skip the initial blank load flash so the GIF opens on rendered content (a good
# poster frame). fps 13 + 1100px wide keeps the file small while staying legible;
# lanczos scaling and a diff-mode palette avoid banding on the dark background.
START="${REGRESSION_GIF_START:-1.6}"
FILTERS="fps=13,scale=1100:-1:flags=lanczos"

ffmpeg -y -ss "$START" -i "$SRC" -vf "${FILTERS},palettegen=stats_mode=diff" "$PALETTE" 2>/dev/null
ffmpeg -y -ss "$START" -i "$SRC" -i "$PALETTE" \
  -lavfi "${FILTERS}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle" \
  "$OUT" 2>/dev/null
rm -f "$PALETTE"

SIZE="$(du -h "$OUT" | cut -f1)"
echo "Wrote $OUT ($SIZE)"
