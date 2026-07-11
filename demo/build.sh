#!/usr/bin/env bash
# Build the Jargon student-portal demo: trim the score, capture frames deterministically,
# mux into a 1080p H.264 MP4. Requires a real ffmpeg (imageio-ffmpeg wheel provides one) and
# the pre-installed Chromium under /opt/pw-browsers (driven by capture.mjs / Playwright).
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FFMPEG="${FFMPEG:-$(python3 -c 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())')}"
SRC="${SRC:-$DIR/clair-de-lune.src.mp3}"
DUR="${DUR:-62.5}"           # video length (s) — matches DURATION in the HTML
OUT="$DIR/jargon-portal-demo.mp4"

echo "ffmpeg : $FFMPEG"
echo "source : $SRC"

# 1) Audio: ~opening minute of Clair de Lune, tiny fade-in, gentle 2.7s tail fade so it
#    resolves under the black "Learn with Jargon" close instead of hard-cutting.
"$FFMPEG" -y -loglevel error -i "$SRC" -t "$DUR" \
  -af "afade=t=in:st=0:d=0.2,afade=t=out:st=59.8:d=2.7" \
  -ac 2 -c:a aac -b:a 192k "$DIR/audio.m4a"
echo "audio  : $DIR/audio.m4a"

# 2) Frames -> video-only mp4 (capture.mjs pipes PNG frames straight into ffmpeg; no PNGs on disk).
FFMPEG="$FFMPEG" OUT="$DIR/demo.raw.mp4" node "$DIR/capture.mjs"

# 3) Mux video + audio (video stream copied, no re-encode).
"$FFMPEG" -y -loglevel error -i "$DIR/demo.raw.mp4" -i "$DIR/audio.m4a" \
  -map 0:v -map 1:a -c:v copy -c:a aac -shortest -movflags +faststart "$OUT"

rm -f "$DIR/demo.raw.mp4"
echo "done   : $OUT"
"$FFMPEG" -hide_banner -i "$OUT" 2>&1 | grep -E "Duration|Stream" || true
