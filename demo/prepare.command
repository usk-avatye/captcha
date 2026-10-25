#!/bin/bash
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd -P)/common.sh"

printf '%s\n' "Docker 시연 이미지를 내려받아 빌드합니다. 최초 준비에는 인터넷 연결이 필요합니다."
prepare_demo_images
printf '%s\n' "준비 완료. bash demo/start.command 로 시연을 시작하세요."
