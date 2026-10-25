#!/bin/bash
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd -P)/common.sh"
compose stop
printf '%s\n' "시연 서비스를 멈췄습니다. 시연 DB는 보존됩니다. bash demo/start.command 로 다시 실행하세요."
