#!/bin/bash
set -euo pipefail

DEMO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
SDK_ROOT="$(cd "$DEMO_DIR/.." && pwd -P)"
MISSIONS_ROOT="$(cd "$SDK_ROOT/.." && pwd -P)"
CUSTOMER_ROOT="$MISSIONS_ROOT/Internship-finalproject"
DEMO_ENV="$DEMO_DIR/.env"

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

USER_ROOT="$(cd "${HOME:?HOME is not set}" && pwd -P)"
[[ "$(basename "$SDK_ROOT")" == "final_mission" ]] || fail "SDK 저장소는 git clone URL final_mission 명령으로 폴더 이름을 지정해 주세요."
case "$SDK_ROOT" in
  "$USER_ROOT/dev/"*) ;;
  *) fail "저장소를 ~/dev 아래의 시연 폴더에 clone한 뒤 다시 실행해 주세요." ;;
esac

[[ -f "$CUSTOMER_ROOT/backend/alembic.ini" ]] || fail "SDK의 final_mission 폴더와 고객사의 Internship-finalproject 폴더를 나란히 clone해 주세요."
[[ -x "$(command -v docker || true)" ]] || fail "Docker Desktop을 설치하고 터미널을 다시 열어 주세요."
docker info >/dev/null 2>&1 || fail "Docker Desktop을 실행한 뒤 다시 시도해 주세요."

compose() {
  docker compose --project-name captchavatye-demo --env-file "$DEMO_ENV" -f "$DEMO_DIR/compose.yaml" "$@"
}

initialize_demo_environment() {
  if [[ -f "$DEMO_ENV" ]]; then
    return
  fi

  if [[ -n "$(docker ps -aq --filter label=com.docker.compose.project=captchavatye-demo)" ]] \
    || [[ -n "$(docker volume ls -q --filter label=com.docker.compose.project=captchavatye-demo)" ]]; then
    fail "기존 시연 DB가 있으나 demo/.env가 없습니다. 원래 clone 폴더의 demo/.env를 복원해 주세요. 새 비밀번호로 덮어쓰지 않았습니다."
  fi

  command -v openssl >/dev/null 2>&1 || fail "macOS 기본 openssl을 찾지 못했습니다. 터미널 환경을 확인해 주세요."
  local provider_key database_password customer_secret
  provider_key="$(openssl rand -hex 32)"
  database_password="$(openssl rand -hex 32)"
  customer_secret="$(openssl rand -hex 32)"
  (
    umask 077
    cat > "$DEMO_ENV" <<EOF
DEMO_IMAGE_TAG=local
DEMO_PROVIDER_API_PORT=58001
DEMO_CUSTOMER_API_PORT=58002
DEMO_PROVIDER_WEB_PORT=55173
DEMO_CUSTOMER_WEB_PORT=55175
POSTGRES_PASSWORD=${database_password}
CUSTOMER_SECRET_KEY=${customer_secret}
CAPTCHAVATYE_SERVICE_KEY=${provider_key}
EOF
  )
  printf '%s\n' "시연 DB 비밀번호와 두 서버의 인증 키를 demo/.env에 안전하게 만들었습니다. 파일을 다른 사람과 공유하지 마세요."
}

initialize_demo_environment

DEMO_IMAGE_TAG="$(awk -F= '$1 == "DEMO_IMAGE_TAG" {print $2}' "$DEMO_ENV")"
[[ "$DEMO_IMAGE_TAG" =~ ^[a-zA-Z0-9_.-]+$ ]] || fail "demo/.env의 Docker 이미지 태그가 올바르지 않습니다."
DEMO_CUSTOMER_WEB_PORT="$(awk -F= '$1 == "DEMO_CUSTOMER_WEB_PORT" {print $2}' "$DEMO_ENV")"
DEMO_CUSTOMER_WEB_PORT="${DEMO_CUSTOMER_WEB_PORT:-55175}"
[[ "$DEMO_CUSTOMER_WEB_PORT" =~ ^[0-9]+$ ]] || fail "demo/.env의 화면 포트는 숫자로 입력해 주세요."
DEMO_RESERVATION_URL="http://127.0.0.1:${DEMO_CUSTOMER_WEB_PORT}/reservations"

image_ready() {
  docker image inspect "captchavatye-demo-$1:$DEMO_IMAGE_TAG" >/dev/null 2>&1
}

prepare_demo_images() {
  compose pull postgres
  compose build
}
