# SDK Interaction Telemetry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 첫 조작 시간, 활성 풀이 시간, 실패 횟수와 제한된 드래그 경로를 기존 DB에 저장하고 두 시연에서 조회한다.

**Architecture:** SDK가 인증 ID별 누적 스냅샷을 비동기로 전송한다. 인증 서버는 revision으로 중복과 역순을 처리하고 JSONB 요약 한 행을 유지한다. 조회 명령은 로컬 HTML/SVG를 생성한다.

**Tech Stack:** React 19, TypeScript, Node 24.21.0, FastAPI, Pydantic, SQLAlchemy, Alembic, PostgreSQL 17, Python 3.12 이상.

**Spec:** `docs/superpowers/specs/2026-10-26-interaction-telemetry-design.md`

## Global Constraints

- 시나리오 구분 필드, 외부 분석 서비스와 고객사 개인정보 복제를 추가하지 않는다.
- 첫 조작 시간과 풀이 시간은 활성 시간이며 미측정은 null이다.
- 경로는 기본 1%, 시연 100%, 최소 100ms 간격, 인증당 최대 100점이다.
- 전송 본문 16KiB, 시간 24시간, 실패 횟수와 드래그 번호 각각 1000으로 제한한다.
- 계측 실패가 인증, 보상, 광고 링크와 예약 처리를 중단하지 않도록 한다.
- BMW 랜딩 설정과 기존 데이터를 유지한다. U+00B7 문자를 새 문구나 주석에 사용하지 않는다.
- 실행 방식은 동일 세션 직접 구현과 최종 독립 리뷰다. 사용자가 승인한 설계 범위에서 연속 실행한다.

## Review Focus

- 인증 성공 전에 닫아도 요약을 저장할 수 있어야 한다. Task 1과 2의 종료 테스트로 확인한다.
- 성공 응답과 닫기 사이의 경쟁에서 성공 시간을 잃거나 중복 전송하지 않아야 한다. Task 2의 스냅샷 테스트로 확인한다.
- 높은 revision이 먼저 도착해도 과거 요청이 최신 경로를 덮지 않아야 한다. Task 1의 동시성 테스트로 확인한다.
- 드래그 취소, 영역 밖 이동과 상한 도달 뒤에도 좌표와 마지막 점이 유효해야 한다. Task 2의 경로 테스트로 확인한다.
- 조회 파일 생성에 실패해도 기존 DB를 변경하거나 보고서 HTML에 문자열을 실행시키지 않아야 한다. Task 3의 렌더러 테스트로 확인한다.

### Task 1: 서버 계약과 영속 저장

**Files:** `backend/app/schemas/interactions.py`, `backend/app/services/interactions.py`, `backend/app/api/routes/interactions.py`, `backend/app/main.py`, `backend/app/store.py`, `backend/app/persistence.py`, `backend/migrations/versions/0004_interaction_summaries.py`, `backend/tests/test_interactions.py`, `backend/tests/test_postgres_persistence.py`.

**Interfaces:** `InteractionSummaryRequest = {challengeId, revision, metrics: {firstInteractionMs, solveMs, missCount, path}}`. 각 경로 점은 `{x, y, t, drag}`다. `collect_interaction(store, request) -> EventResponse`와 `PostgresStore.collect_interaction(request, received_at)`를 제공한다. 새 revision은 201, 중복과 역순은 200, 동일 revision의 다른 내용은 409다.

- [x] 성공 전 인증의 요약 저장, 동일 재전송 200, 다른 내용 409, 역순 무시, 없는 ID 404, 본문 16KiB 초과 413, 비유한 숫자와 상한 위반 422를 테스트로 먼저 작성한다.
- [x] `uv run --project backend --extra test pytest backend/tests/test_interactions.py -q`로 기능 부재에 따른 실패를 확인한다.
- [x] 인증 ID별 JSONB 한 행과 revision 비교를 구현한다. 요청 스트림을 제한한 뒤 모델을 검증하고 DB 작업은 동기 핸들러에서 실행한다. 인증 행 잠금으로 동시 요약 생성을 직렬화한다.
- [x] 마이그레이션과 check_ready의 요구 버전을 0004로 맞추고 전용 테스트 DB 정리 목록에 새 테이블을 포함한다. 재시작, 병렬 중복과 역순 갱신 테스트를 작성한다.
- [x] 위 대상 테스트와 backend 전체 테스트를 한 번 실행하고 통과 결과를 기록한다. 전용 `_test` DB에서 PostgreSQL 계약을 확인한다.
- [x] 이 작업 파일만 커밋한다.

### Task 2: SDK 계측과 화면 연결

**Files:** `packages/react/src/interactions.ts`, `packages/react/src/tracking.ts`, `packages/react/src/flow.ts`, `packages/react/src/useCaptchaFlow.ts`, `packages/react/src/CarPuzzle.tsx`, `packages/react/src/CaptchaModal.tsx`, `packages/react/src/types.ts`, `frontend/tests/interactions.test.ts`, `frontend/tests/interactionFlow.test.ts`, `frontend/tests/tracking.test.ts`.

**Interfaces:** `InteractionRecorder`는 `bind(challengeId)`, `ready(challengeId)`, `setOpen(open)`, `setVisible(visible)`, `press(x,y)`, `move(x,y)`, `release()`, `miss()`, `passed()`, `flush()`를 제공한다. 인증 발급 직후 ID를 연결하고 이미지 준비 후 활성 측정을 시작한다. 생성자는 제어 가능한 `now`, `random`, `deliver`와 `pathSampleRate`를 받는다. `CaptchaFlow`의 선택적 관측자는 `bind`, `ready`, `setOpen`, `miss`, `passed`를 받는다. SDK prop에 `telemetry?: {enabled?: boolean; pathSampleRate?: number}`를 추가한다. Task 1의 요청 계약을 사용한다.

- [x] 제어한 시계에서 첫 조작 200ms, 숨김과 닫힘 시간을 제외한 성공 700ms, 미조작 null, 실패 후 재열기 누적, 성공 직후 닫기 중복 생략을 먼저 테스트한다.
- [x] 표본 미선택의 path=null, 선택 후 미조작의 path=[], 경로의 시작과 끝, 100ms 간격, 최대 100점과 마지막 점 보존을 테스트한다.
- [x] Node 24의 `node --test frontend/tests/interactions.test.ts frontend/tests/interactionFlow.test.ts`로 RED를 확인한다.
- [x] 독립 계측 모듈을 구현하고 flow의 기존 성공, 실패와 이미지 준비 경계에 연결한다. 모달의 수명과 문서 가시성을 반영하고 CarPuzzle의 좌표는 영역 기준으로 정규화한다.
- [x] 기존 전송의 응답 검증과 재시도를 재사용할 수 있도록 일반 전송 함수를 분리한다. 계측은 keepalive와 고정 스냅샷을 사용하고 UI 콜백에 예외를 전파하지 않는다.
- [x] flow의 실제 상태 전이와 관측자를 함께 테스트하고, 기존 `npm test`와 SDK 빌드를 통과시킨다.
- [x] 이 작업 파일만 커밋한다.

### Task 3: 점검 도구와 두 소비 앱 반영

**Files:** `backend/app/inspect_interactions.py`, `demo/inspect.command`, `demo/render_interactions.py`, `demo/test_inspection.py`, `demo/Dockerfile.api`, `demo/README.md`, `packages/react/README.md`, `.gitignore`, `frontend/src/pages/DemoCommunityPage.tsx`, 고객사 `frontend/src/pages/reservation/ReservationPage.tsx`, 고객사 `frontend/vendor/captchavatye-react-0.1.0.tgz`, 고객사 `frontend/package-lock.json`.

**Interfaces:** `python -m app.inspect_interactions`는 최근 인증 요약 20건을 JSON으로 출력한다. `render_interactions.render(records) -> str`는 외부 의존성 없는 HTML/SVG를 반환한다. `bash demo/inspect.command`는 `demo/reports/latest-interactions.html`을 생성하고 절대 경로를 출력한다.

- [x] 요약 숫자와 여러 드래그를 렌더링하고 위험한 문자열을 실행 가능한 HTML로 삽입하지 않는 테스트를 먼저 작성한다. `python3 demo/test_inspection.py`로 RED를 확인한다.
- [x] 읽기 전용 조회와 로컬 경로 시각화를 구현하고, 보고서 폴더를 Git에서 제외한다.
- [x] 두 소비 화면에서 pathSampleRate=1로 설정한다. 새 SDK tgz를 빌드하고 고객사 vendor와 잠금 파일을 갱신한다.
- [x] SDK 빌드와 패키지 계약, 고객사 빌드를 확인한다. 필요한 변경의 문서와 점검 명령을 검토한다.
- [x] 최종 독립 리뷰를 수행하고 중요 발견을 재현하는 테스트와 함께 수정한다. 이미 통과한 검증은 관련 변경이 있을 때만 재실행한다.
- [x] 검증된 변경을 원래 두 저장소와 Docker 시연 환경에 반영한다. 마이그레이션, API 수집과 조회 도구의 실제 실행을 확인한다. 기존 예약 기록의 보존을 확인한다.
- [x] 변경, 검증 결과와 사용자가 확인할 명령 및 보고서 경로를 전달한다.
