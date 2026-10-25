#!/bin/bash
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd -P)/common.sh"

if ! image_ready provider-api || ! image_ready customer-api \
  || ! image_ready provider-web || ! image_ready customer-web; then
  prepare_demo_images
fi

compose up --pull never --detach --wait --wait-timeout 240
printf '\n%s\n' \
  "예약 화면: $DEMO_RESERVATION_URL" \
  "로그인: qa-member1@example.com" \
  "비밀번호: Qa12345!" \
  "종료하고 다음 시연에서 예약 기록을 유지하려면 bash demo/stop.command 를 실행하세요."
if [[ "${DEMO_OPEN_BROWSER:-1}" == "1" && "$(uname -s)" == "Darwin" ]] && command -v open >/dev/null 2>&1; then
  open "$DEMO_RESERVATION_URL"
fi
