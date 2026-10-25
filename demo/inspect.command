#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/common.sh"

command -v python3 >/dev/null 2>&1 || fail "보고서 생성에 python3가 필요합니다."
inspection_json="$(mktemp)"
trap 'rm -f "$inspection_json"' EXIT
compose exec -T provider-api python -m app.inspect_interactions > "$inspection_json"
python3 "$DEMO_DIR/render_interactions.py" "$inspection_json" "$DEMO_DIR/reports/latest-interactions.html"
