# PoC 최종 검증 — V01~V08

- 확인일: 2026-10-25 KST
- 대상: `/Users/jungle/dev/missions/final_mission`
- 제품 코드 기준: `87668373e1612062f2567fd9b1b80d1022dc8b7c`
- 결과: **V01~V08 확인 완료**. [DESIGN.md](../../../DESIGN.md)의 범위·계약을 유지한다.
- 환경: Mac의 Chrome **155.0.8059.85**, 별도 headless context. 1280×900과 390×844. 실제 FastAPI 단일 워커·Vite 프록시.
- 이번 단계에서는 제품 코드를 바꾸지 않고 검증 스크립트·결과·실행 안내를 추가했다.

DESIGN §7.2의 “미실행 검증 계획”은 구현 전 정본의 표현이다. 실제 실행 결과는 이 문서와 각 JSON으로 확인한다. 기존 결과는 현재 소스와 SHA-256이 같은지 확인해 재사용했으며, 모든 이전 테스트를 이번 단계에서 새로 실행했다고 표시하지 않는다. 현재 코드 61개 파일(백엔드 22·프론트엔드 35·설계/소재 4)의 해시가 이전 검증 기준과 일치한다.

## 1. 이번 단계에서 실행한 검증

| 실행 | 결과 | 증거 |
| --- | --- | --- |
| 현재 UI 경계·전체 이벤트 실패 | **9/9 통과**, page error 0 | [edges-results.json](edges-results.json) |
| 실제 HTTP 동시 인증 | **통과**: 동시 2건 + 다른 유효 좌표의 재전송이 같은 완료 ID 쌍 | [concurrent-verify-results.json](concurrent-verify-results.json) |
| 실제 재시작·열린 탭·초기화·재시연 | **11/11 확인 항목 통과**, page error 0 | [restart-results.json](restart-results.json) |
| 서버 로그 연결 | 최초 인증·신청 로그 한 번, 전후 ID 연결 확인 | [server-observation.json](server-observation.json) |
| 독립 검토 | 증거 누락 점검, 두 브라우저 runner 정적 검토, 문서 근거 검토 | [review.md](review.md) |

기존 통과 결과는 프론트엔드 단위 **49개**, 백엔드 **152개**, 전환 브라우저 **16개**, 기존 흐름 **12개**, React 호스트 경계 **6개**다. 새 브라우저 검증과 함께 아래 완료 조건을 뒷받침한다. 단위 테스트·실제 네트워크 요청·브라우저·서버 로그의 근거를 구분한다.

## 2. 완료 기준과 실제 증거

| ID | 확인한 결과 | 주된 실행 증거 |
| --- | --- | --- |
| V01 | 서버 응답 전·스냅·줌아웃 동안 0P, 유효한 연출 뒤 10P. 중복 완료/계속하기에도 글 한 건 | 기존 [regression-results.json](../stage4-ui/regression-results.json)의 `server_and_animation_reward_gate`, `desktop_flow_without_cta`; [host-results.json](../stage4-ui/host-results.json)의 `host_duplicate_completion_and_continue` |
| V02 | 오배치는 false 후 복귀. 이미지 밖·취소·리사이즈는 검증 요청 없음. 잡은 위치·창 크기와 무관하게 같은 조각 중심 좌표 | 이번 [edges-results.json](edges-results.json)의 앞 여섯 사례 |
| V03 | 성공 응답 유실 뒤 같은 요청·ID 쌍 복구. 실제 동시 HTTP 두 건과 passed 인증의 다른 유효 좌표도 기존 결과 | 기존 `lost_response_retry_rewards_once`; 이번 [concurrent-verify-results.json](concurrent-verify-results.json); 백엔드 Store의 click_links 한 건 assertion |
| V04 | 모든 수명 구간의 닫기·재열기에 초안 유지. 숨김 중 보상 없음. 받은 ID 재사용, 불확실한 검증은 같은 요청, 이전 응답·연출 무효화 | 기존 회귀의 close 사례 다섯 개 + 이번 `start_close_ignores_hidden_and_old_responses`, `asset_close_ignores_hidden_and_old_decodes`; 흐름·연출 단위 테스트 |
| V05 | CTA 없이도 글 등록. 실제 새 탭 이동·복귀·닫기·재열기 후 같은 완료·10P, 노출 이벤트 ID 추가 없음 | 기존 `desktop_flow_without_cta`, `native_popup_and_independent_application`; 이번 `all_events_503_preserves_application_and_original_post` |
| V06 | 클릭 이벤트보다 신청이 먼저여도 성공. 세 클라이언트 이벤트가 모두 503이어도 신청 201·10P·글 한 건 | 기존 `native_popup_and_independent_application`; 이번 전체 이벤트 503 사례; 신청·내부 전환 각각 한 건은 백엔드 Store assertion |
| V07 | 이벤트·신청의 순차/동시 중복은 200 재사용, 다른 내용은 409, 최초 기록 유지 | 기존 [이벤트 HTTP](../stage4-events/http-results.json), [신청 HTTP](../stage4-test-drives/http-results.json), 백엔드 Store 중복·충돌 테스트 |
| V08 | 실제 프로세스 재시작 후 기존 pending/완료 인증·신청·이벤트 ID는 404. 클라이언트 초기화 후 새 ID로 전체 시연 성공 | 이번 [restart-results.json](restart-results.json), [server-observation.json](server-observation.json) |

### V02·V04: 이번 UI 경계 사례

[verify.edges.cjs](verify.edges.cjs)의 사례 이름은 결과 JSON과 같다.

- `miss_then_recovery_current_ui`: 실제 false, 원위치, 같은 인증으로 정답 복구.
- `outside_image_drop_no_clamp_or_verify`: 원본 밖에서 조각을 좌표 경계로 강제 보정하지 않고 전송 없이 복귀.
- `pointercancel_restores_without_verify`: 실제 pointer ID의 취소 뒤 검증 없음, 이후 정상 조작 가능.
- `final_pointerup_coordinates`: 마지막 이동 좌표와 다른 최종 release 좌표를 사용.
- `resize_cancels_drag_and_recovers`: 드래그 중 화면 축소 취소, 새 크기에서 정상 완료.
- `grab_offsets_and_viewports_same_normalized_center`: 데스크톱·작은 창에서 중심/가장자리로 잡은 네 번의 원본 중심 좌표 비교.
- `start_close_ignores_hidden_and_old_responses`: 실제 시작 응답의 전달만 지연해 숨김 중·새 시작 후 늦은 응답을 무시하는지 확인.
- `asset_close_ignores_hidden_and_old_decodes`: 실제 이미지 decode 완료 전달만 지연해 이전 준비 완료가 현재 로딩을 끝내지 못하는지 확인.

시작·decode 검증은 격리된 페이지의 검증용 전달 지연을 사용했다. 실제 서버 성공 본문이나 이미지 크기·decode 성공을 만들지 않았다. 이전 검증·스냅·줌아웃의 닫기/재열기는 4단계 회귀를 재사용한다. 0ms·종료 이벤트 누락 우회·취소된 타이머의 조건은 `frontend/tests/stageCompletion.test.ts`의 다섯 단위 테스트가 근거다.

### V03·V07: 실제 네트워크와 내부 기록

이번 동시 인증은 Vite의 `/api` 프록시를 거쳐 실제 서버로 보낸다. 두 클라이언트 스레드를 같은 barrier에서 출발시킨 후 두 응답과 후속 `(1, 0)` 요청의 결과를 비교했다. 동일 completionId·clickId를 받았으며 최초 인증 성공 로그도 한 줄이다.

기존 이벤트 HTTP의 `twelve_identical_requests`는 **201 한 건 + 200 열한 건**, `twelve_conflicting_requests`는 **201 한 건 + 409 열한 건**을 확인했다. 신청 HTTP의 `twelve_identical_applications`와 `four_conflicting_applications`도 같은 원리로 최초 결과를 유지했다. 이벤트·신청 경로는 이번 단계에서 변경하지 않았다.

내부 메모리의 정확한 개수·시각·객체 보존은 실제 브라우저에서 읽은 값이 아니다. [test_captcha.py](../../../backend/tests/test_captcha.py), [test_events.py](../../../backend/tests/test_events.py), [test_demo.py](../../../backend/tests/test_demo.py)의 in-process HTTP/Store assertion으로 확인했다. 대표 신청 테스트는 다음과 같다.

- `test_all_four_choices_create_one_lead_and_conversion_without_client_events`
- `test_identical_retry_preserves_response_lead_time_and_conversion`
- `test_twelve_identical_applications_create_one_lead_and_conversion`
- `test_four_distinct_choices_preserve_only_the_winner`

신청은 lead와 서버 전용 `test_drive_requested`가 각각 한 건이며 중복·충돌 뒤 늘지 않는다. 클라이언트 이벤트가 처음부터 없어도 생성된다. 실행 근거는 [152개 통과 기록](../stage4-test-drives/checks.json)과 현재 소스 해시 일치다.

### V05·V06: 전체 이벤트 실패에서도 원래 업무 유지

`all_events_503_preserves_application_and_original_post`는 context 전체의 `/api/events` 응답만 503으로 주입한다. `cta_shown`, `cta_clicked`, `landing_viewed`가 각각 동일 payload로 세 번 전송되어 **총 9건 모두 503**, 접수된 클라이언트 이벤트는 0건이다.

그동안 실제 인증과 신청 API는 정상 사용한다. 새 탭 신청은 201로 완료되고, 원래 탭으로 돌아와 모달을 닫고 재열어도 같은 clickId·10P를 유지한다. 새로운 시작·검증 없이 계속하기로 글 한 건을 등록한다. 노출 재시도는 같은 eventId이며 새로운 노출로 세지 않았다. 서버 로그에는 이 clickId의 최초 인증·신청 완료만 있고 클라이언트 이벤트 접수 로그는 없다.

기존 `native_popup_and_independent_application`은 클릭 이벤트를 서버에 전달하기 전부터 보류한 상태에서도 새 탭이 즉시 열리고, 원래 탭의 글 등록·탭 종료 후 신청이 가능함을 별도로 확인했다.

## 3. 실제 재시작과 두 번의 시연

최종 실행에서는 실제 Uvicorn 프로세스 **80368 → 81043**으로 바뀌었다. 이전 프로세스 종료, 새 프로세스의 backend 작업 디렉터리·단일 워커 명령·8000 포트·OpenAPI 200과 네 업무 경로를 확인한 뒤 브라우저 검증을 재개했다.

1. 첫 시연: 리어램프 드래그 → 10P → 새 탭 신청 201 → 원래 글 한 건.
2. 신청 탭을 같은 URL로 새로고침하고, 별도 탭에는 아직 검증하지 않은 challenge를 유지했다.
3. 세 탭을 열어 둔 채 실제 서버를 재시작했다.
4. 남은 인증 화면에서 드래그하면 404 `CHALLENGE_NOT_FOUND`, 옛 신청 탭에서 제출하면 404 `CLICK_NOT_FOUND`와 복귀 안내가 표시됐다. 자동 재시도나 거짓 완료는 없었다.
5. 이미 완료했던 인증 요청과 접수됐던 이벤트 원문도 직접 재전송해 404를 확인했다.
6. 원래 커뮤니티를 새로고침하자 빈 초안·0P·글 0건이 됐다.
7. 새로 시작한 두 번째 전체 시연은 새 challengeId·completionId·clickId·leadId로 10P·글 한 건·신청 201을 완료했다.

서버 재시작만으로 열려 있는 커뮤니티의 10P·글이 지워지지는 않았다. 클라이언트 상태는 새로고침 때 초기화된다. 예전 신청 탭을 새로고침하는 것만으로는 URL의 clickId가 바뀌지 않아 새 인증의 CTA로 다시 열어야 한다.

[restart-results.json](restart-results.json)은 11개 확인 항목과 실제 요청/응답, 포인트 이력, 전후 ID, 재시작 메타데이터를 담는다. 브라우저 요청은 변경 없이 서버로 전달했다. 예상한 404 리소스 메시지는 console 진단에 남기고, 처리되지 않은 `pageerror`는 0인지 별도로 검사했다.

첫 실행에서 검증용 포인트 관찰 코드가 새 탭에 중복 주입되어 초기화 오류 두 건이 발생했다. Document별 초기화 가드로 검증 코드를 수정하고 실제 재시작을 다시 수행했다. 최종 기록은 11/11·page error 0이며 제품 코드는 수정하지 않았다.

## 4. 실행과 초기화

일반 시연의 설치·서버 실행은 [프로젝트 README](../../../README.md#실행)를 따른다. 서버는 `--workers 1`로 실행하고 시연 중 `--reload`를 사용하지 않는다.

| 원하는 초기화 | 수행할 일 | 유지되는 것 |
| --- | --- | --- |
| 같은 페이지에서 다음 글 | 등록 뒤 **새 글 쓰기** | 누적 포인트·이미 등록한 글·서버 기록 |
| 커뮤니티 클라이언트만 처음으로 | `/` 탭 새로고침 | 서버 인증·연결·이벤트·신청 |
| 모든 서버 기록도 처음으로 | 백엔드 재시작 → `/` 탭 새로고침 → 옛 신청 탭 닫기 → 새 인증 CTA로 신청 탭 열기 | 실행 파일과 소재만 유지. 서버·해당 페이지의 시연 상태 초기화 |

### 추가 검증 스크립트 재실행

```bash
cd /Users/jungle/dev/missions/final_mission
python3 docs/verification/stage5/verify.concurrent-verify.py

CAPTCHAVATYE_PLAYWRIGHT_MODULE=/Users/jungle/.npm/_npx/31e32ef8478fbf80/node_modules/playwright \
  node docs/verification/stage5/verify.edges.cjs
```

이 명령은 실행 중인 서버 메모리에 모의 기록을 추가한다. 다른 Mac에서는 설치된 Playwright 모듈 경로를 환경 변수로 지정한다. 특정 경계 사례는 `--case <사례 이름>`으로 선택할 수 있다.

재시작 검증은 운영자가 서버 수명을 제어하도록 분리했다. runner 자체에는 프로세스 종료·시작 코드가 없다.

1. 저장소 루트에서 `mktemp -d "$PWD/.git/stage5-restart-XXXXXX"`로 새 빈 gate 디렉터리를 만든다.
2. 그 절대 경로를 `CAPTCHAVATYE_RESTART_GATE`에 지정하고 같은 Playwright 환경 변수와 함께 `node docs/verification/stage5/verify.restart.cjs`를 실행한다.
3. `restart_ready` 출력 뒤 다른 터미널에서 같은 gate를 지정한 `node docs/verification/stage5/verify.restart.cjs --read-ready`로 runId와 기존 ID를 확인한다.
4. 현재 백엔드를 종료하고 README의 동일한 단일 워커 명령으로 다시 실행한다. 이전 PID가 사라지고 새 PID의 8000 포트와 API가 정상인지 확인한다.
5. gate의 `restarted.json`에 실제 `oldPid`, `newPid`, UTC ISO `restartedAt`, 해당 `runId`를 기록한다. runner가 이어서 검사한다.

대기는 최대 180초이며 새 실행에는 새 빈 gate가 필요하다. 최종 결과는 같은 폴더의 JSON과 네 캡처로 저장한다.

## 5. API 경계와 확인 범위

원본의 X/Y 각 축 허용 오차 안·정확한 경계·밖, NaN/Infinity·범위 밖·누락·잘못된 타입, 없는 ID, 금지된 클라이언트 `test_drive_requested`, 잘못된 지점·시간은 기존 백엔드 152개 테스트에 포함된다. 관련 이름은 `test_each_axis_has_inclusive_tolerance`, `test_non_finite_json_is_serializable_422`, `test_bad_coordinates_are_422_and_do_not_mutate`, `test_schema_validation_precedes_link_and_existing_lead_checks` 등이며 해당 소스의 해시를 확인했다.

이번 완료는 설계된 메모리 기반 로컬 PoC의 범위다. 모바일 크기는 브라우저 viewport 검증이며 실기기·Safari 검증을 의미하지 않는다. 실제 봇 탐지·포인트 원장·예약·DB·다중 워커·배포는 포함하지 않는다. 이벤트는 페이지 종료 이후 전달을 보장하지 않고, 생성한 파생 이미지의 픽셀 단위 원본 동일성도 보장하지 않는다. 새로운 조회 API·대시보드는 추가하지 않았다.
