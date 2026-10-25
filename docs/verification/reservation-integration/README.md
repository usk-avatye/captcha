# 예약 서비스 연동 검증

2026-10-25 로컬 실행 결과다. SDK 저장소 `feat/react-sdk-package`, 고객사 저장소 `feat/calendar`에서 구현했다. 원격 push, npm 공개, 기존 DB 초기화는 수행하지 않았다.

## 구현과 책임

- `@captchavatye/react@0.1.0`은 고객사 `frontend/vendor`에 포함한 npm tarball로 설치한다. 소스 경로 alias는 사용하지 않는다. 선택적 `challenge` 입력으로 고객사 서버가 발급한 퍼즐을 표시하고 완료 결과만 콜백으로 전달한다.
- CAPTCHAvatye는 인증, 이벤트, 모의 시승 전환을 별도 PostgreSQL DB에 저장한다. 실행 앱은 메모리로 자동 대체하지 않는다. 전환과 전환 이벤트는 같은 트랜잭션에서 기록한다.
- 고객사 서버는 로그인 사용자와 예약 입력에 묶인 intent를 저장한다. 비밀키를 사용하는 서버 간 확인 후, 예약과 완료 ID 사용 기록을 한 트랜잭션으로 저장한다. 같은 요청을 다시 받으면 기존 예약을 반환한다.
- 고객사 로그인, CSRF, Origin, 회의실 행 잠금 및 시간 겹침 규칙은 유지한다. SDK에 예약이나 포인트 정책을 추가하지 않았다. CTA 참여 여부는 인증 확인과 예약 조건에 포함하지 않는다.

## 실행 설정

provider의 DB URL과 공유키를 export하고 `backend/README.md`에 따라 Alembic 마이그레이션을 적용한다. 고객사는 `docs/design/captchavatye.md`를 따른다. 기존 개발 DB에 자동 마이그레이션을 적용하지 않았다.

| 서비스 | 기본 주소 | 경로 |
| --- | --- | --- |
| provider API | 127.0.0.1:8001 | 공개 `/api`, 서버 전용 `/internal` |
| provider 데모 및 소재 | 127.0.0.1:5173 | `/creatives`, `/demo/test-drive` |
| 고객사 API | 127.0.0.1:8002 | `/api` |
| 고객사 화면 | 127.0.0.1:5175 | `/api`는 고객사, `/captchavatye/api`는 provider 프록시 |

서버 전용 API는 32자 이상의 `CAPTCHAVATYE_SERVICE_KEY`를 두 백엔드에 동일하게 설정한다. 브라우저에는 전달하지 않는다. `POST /internal/challenges`는 `creativeId`, `subject`를 받으며 10분 만료의 인증을 발급한다. `POST /internal/completions/verify`는 `challengeId`, `completionId`, `subject`의 연결과 성공 및 만료를 확인한다. 공개 데모 인증은 이 확인을 통과하지 못한다.

## 실제 확인 결과

| 검증 | 관찰 결과 |
| --- | --- |
| SDK 단위 테스트 | 54 passed |
| provider 전체 백엔드 | 164 passed, 실제 PostgreSQL 테스트 8개 포함 |
| 고객사 전체 백엔드 | 184 passed |
| 고객사 전체 프론트엔드 | 57 passed, 8 files |
| SDK 린트 및 패키지 계약 | 통과 |
| provider editable 설치 | `pip install --no-deps -e './backend[test]'` 통과 |
| SDK와 데모, 고객사 빌드 | 통과 |
| 인증 증명 누락, pending, 위조, 다른 사용자 또는 예약 입력 | 거부, 예약 생성 없음 |
| 서버 간 키 누락, 다른 subject, 공개 인증의 우회 | 거부 |
| 같은 인증의 동시 검증 | 실제 2-worker provider에 8개 HTTP 요청, ID 쌍 한 개 |
| 같은 intent의 동시 예약 | 실제 HTTP 8개 요청, 예약 한 개 |
| 완료 ID 재사용 | 다른 intent 거부, 고객사 DB UNIQUE 제약으로도 방어 |
| provider 장애와 잘못된 응답 | 실패 처리, 예약 및 사용 기록 생성 없음, 같은 요청 재시도 가능 |
| 예약 commit 실패 | 예약과 intent 사용 기록 모두 rollback |
| 두 프로세스 실제 재시작 | 기존 완료 ID, 동일 예약 응답, 이벤트 중복, 전환 중복 유지 |
| 재시작 전 미완료 인증 | 재시작 후 이어서 인증과 예약 성공 |
| 시작 시각 및 인증 만료 후 불확실한 재시도 | 화면 테스트에서 6분 및 11분 뒤 같은 증명으로 재전송 |
| 이벤트 ID 길이 | 121자 이상 및 DB 인덱스 한계를 넘는 무작위 ID 원문 보존과 중복 판정 |
| 실제 브라우저 | 로그인, 퍼즐 드래그, 완료 후 닫기와 재열기, CTA 없이 예약 저장 |

브라우저에서 인증 완료 직후 고객사 DB의 해당 제목 예약은 0건이었다. `예약 계속하기` 후 1건이었고 provider 이벤트는 `cta_shown` 한 개만 있었다. `cta_clicked`, 시승 신청 및 전환은 발생하지 않았다. 브라우저 콘솔 오류와 경고는 0개였다. 고객사 백엔드 테스트에는 기존 Starlette TestClient의 httpx 사용 중단 예정 경고 한 개가 있다.

독립 리뷰의 Origin 누락, 오래 지난 불확실 요청의 증명 교체, 이벤트 ID 길이 제한을 수정하고 해당 회귀를 확인했다. 미해결 중요 리뷰 항목은 없다.

## 재현

단위 및 PostgreSQL 테스트:

```bash
# SDK 저장소 루트, 별도 _test DB에만 지정
CAPTCHAVATYE_TEST_DATABASE_URL='postgresql+psycopg://USER:PASSWORD@HOST:PORT/captchavatye_test' backend/.venv/bin/python -m pytest backend/tests -q
npm test
npm run lint
npm run build
npm run verify:package

# 고객사 backend 폴더, 별도 _test DB에만 지정
TEST_DATABASE_URL='postgresql+psycopg://USER:PASSWORD@HOST:PORT/meeting_room_test' .venv/bin/python -m pytest -q

# 고객사 frontend 폴더
npm test
npm run build
```

두 PostgreSQL 테스트 스위트는 명시한 전용 `_test` DB의 테이블을 초기화한다. 운영 DB나 유지할 개발 데이터가 있는 DB에는 실행하지 않는다. 이번에는 새 `captchavatye_followup_test`, `meeting_room_captcha_followup_test` DB를 생성해 사용했다.

실제 HTTP 재시작 검증은 마이그레이션한 전용 테스트 DB로 두 API 서버를 실행한 후 수행한다. 먼저 고객사 backend 폴더에서 `DATABASE_URL`을 `_test` DB로 지정하고 `PYTHONPATH=. .venv/bin/python <SDK>/scripts/seed-reservation-test.py > <SDK>/artifacts/reservation-e2e-account.json`을 실행한다. 새 테스트 계정과 회의실만 추가한다. SDK 저장소에서 다음 환경변수를 지정한다.

```bash
export RESERVATION_E2E_ACCOUNT="$PWD/artifacts/reservation-e2e-account.json"
export RESERVATION_E2E_STATE="$PWD/artifacts/reservation-http-state.json"
# 실행한 두 백엔드와 같은 CAPTCHAVATYE_SERVICE_KEY도 export
backend/.venv/bin/python scripts/verify-reservation-integration.py before
# 두 API 프로세스 종료 후 같은 DB와 키로 재시작
backend/.venv/bin/python scripts/verify-reservation-integration.py after
```

각 phase는 불일치 시 assertion으로 실패한다. 재실행할 때 새 계정과 회의실을 생성하고 이전 서버나 타인의 프로세스를 종료하지 않는다. 검증용 비밀번호 및 실행 상태 파일은 git에 포함하지 않는다.

## 제한

실제 봇 탐지, 공개 운영 보안 인증, 다중 고객사 키 관리 및 배포는 포함하지 않는다. 실제 개발 또는 운영 환경에는 별도 DB 및 공유키 설정과 마이그레이션 적용이 필요하다. 화면 새로고침 및 다른 기기에서 초안과 미확정 요청을 복원하는 기능은 포함하지 않으며, 저장된 예약은 DB와 캘린더에서 유지된다. 기존 고객사의 참석자 관련 TODO는 그대로다.

![인증 완료 화면](browser-authenticated.png)

![CTA 없이 예약 저장](browser-booked.png)
