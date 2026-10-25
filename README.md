# CAPTCHAvatye

## 회사 맥북에서 시연

GitHub에서 SDK와 고객사 저장소를 나란히 clone하고 Docker Desktop으로 실행한다. [시연 시작 안내](demo/README.md)의 clone 명령을 따른 뒤 `bash demo/start.command`를 실행한다. Node나 Python을 따로 설치하지 않아도 된다. 시연 전용 DB, 마이그레이션, 로그인 계정을 자동으로 준비한다. 시연 화면은 `http://127.0.0.1:55175`이다.

[DESIGN.md](DESIGN.md)의 **0~5단계 구현·검증을 완료했다.** 커뮤니티에서 글을 작성하고 리어램프를 맞추면 서버 판정 → 스냅·줌아웃 → 모의 10P 반영이 이어진다. **원래 작업 계속하기**로 글을 한 번 등록한다. 선택적인 **시승 신청**은 새 탭에서 서버에 모의 신청 완료를 기록한다. 보상·글 등록은 CTA나 신청 여부에 의존하지 않는다. 실제 서버 재시작과 초기화 후 두 번째 시연까지 확인했으며, [V01~V08 최종 완료 표](docs/verification/stage5/coverage.md)에 실행 근거와 확인 범위를 기록했다.

## 예약 서비스 연동

PostgreSQL 영속화, 고객사 서버 간 인증 확인, 회의실 예약 연동을 추가했다. 실행 및 검증 범위는 [예약 연동 기록](docs/verification/reservation-integration/README.md)에 있다. 아래 0~5단계 시연 결과는 초기 메모리 PoC의 이력이며 현재 저장소는 재시작 후에도 기록을 유지한다.

## 실행

터미널 두 개에서 각각 실행한다. 이미 해당 포트에서 실행 중이면 같은 서버를 사용한다.

### 백엔드

```bash
cd /Users/jungle/dev/missions/final_mission/backend
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e '.[test]'
export CAPTCHAVATYE_DATABASE_URL='postgresql+psycopg://USER:PASSWORD@127.0.0.1:5433/captchavatye'
export CAPTCHAVATYE_SERVICE_KEY='32자_이상의_공유_비밀키'
python -m alembic upgrade head
python -m uvicorn app.main:app --host 127.0.0.1 --port 8001 --workers 2
```

### 프론트엔드

```bash
cd /Users/jungle/dev/missions/final_mission
npm ci
npm run dev
```

브라우저에서 **http://127.0.0.1:5173/** 를 연다. Vite가 `/api`를 `127.0.0.1:8001`로 전달한다. 이미지와 화면은 Vite에서 제공한다. 포트가 사용 중이면 다른 포트로 자동 이동하지 않는다.

확인한 환경: Python **3.14.6**, FastAPI **0.162.0**, Pydantic **2.14.1**, Uvicorn **0.54.0**; Node.js **26.7.0**, npm **11.19.0**, React **19.3.1**, Vite **8.3.5**, TypeScript **6.0.3**. 프론트엔드와 SDK 버전은 루트 package-lock.json, 백엔드 직접 의존성은 pyproject.toml에 고정했다.

## 설치 가능한 React SDK

`@captchavatye/react@0.1.0`을 로컬 tarball로 설치할 수 있다. npm 공개 발행은 하지 않았고 `private: true`로 막았다. 사용 계약은 [SDK README](packages/react/README.md)에 있다.

```sh
# SDK 저장소 루트
npm ci
npm run pack:sdk

# 고객사 React 앱 폴더에서
npm install /Users/jungle/dev/missions/final_mission/artifacts/captchavatye-react-0.1.0.tgz
```

```tsx
import { CaptchaModal } from '@captchavatye/react';
import '@captchavatye/react/style.css';
```

`packages/react`는 SDK, `frontend`는 공개 패키지를 사용하는 커뮤니티/시승 데모다. 루트 npm workspaces와 lockfile 하나로 관리한다. SDK 개발 변경 후에는 `npm run build:sdk`로 다시 빌드한다. `npm run dev`와 `npm run build`는 SDK 빌드를 먼저 실행한다.

[독립 소비 앱](examples/react-consumer/README.md)은 저장소 내부 소스를 import하지 않고 `.tgz`를 설치한다. 회의실 서비스의 실제 예약 연동이 아니라 UI 설치 예시이며, 서버 확인 없이 예약이나 보상을 생성하지 않는다. API는 `/captcha-api`로 프록시하고 이미지·CTA는 별도 서비스 주소로 연결한다.

```sh
npm run verify:package
node scripts/verify-sdk-install.mjs          # 임시 폴더에 실제 설치·타입 검사·빌드
# 해당 출력의 CONSUMER 폴더에서 npm run preview 실행 후:
CAPTCHAVATYE_PLAYWRIGHT_MODULE=/absolute/path/to/playwright node scripts/verify-sdk-consumer.cjs
# 기존 데모가 5173에서 실행 중일 때:
CAPTCHAVATYE_PLAYWRIGHT_MODULE=/absolute/path/to/playwright node scripts/verify-demo-regression.cjs
```

SDK 소비 앱의 검증은 React 19.3.1, Vite, Chrome으로 수행했다. React 19 peer 범위이며 다른 버전 조합, SSR, 모바일 실기기는 확인하지 않았다. SDK는 실제 봇 탐지를 제공하지 않는다. 현재 인증 서버는 PostgreSQL을 사용하며 고객사 백엔드가 완료 결과를 확인한다. 이전 패키지화 검증 기록은 당시 범위를 설명한다.

패키지화 검증과 한계는 [검증 기록](docs/verification/sdk-package/README.md)에 있다.

## 시연 순서

1. 제목과 본문을 쓰고 **등록**을 누른다. 첫 열기 전에는 시작 API를 호출하지 않는다.
2. 램프 조각을 빈 소켓으로 드래그한다. 조각 중심을 확대된 전체 원본 기준 0~1 좌표로 서버에 전송한다.
3. 서버의 true 뒤에만 180ms 스냅 → 650ms 줌아웃을 실행한다. 열린 유효 연출이 끝나면 **모의 10P**가 한 번 반영된다.
4. **원래 작업 계속하기**를 누르면 작성한 제목·본문이 아래 등록 목록에 한 번 표시된다. 시승 CTA를 누를 필요가 없다.
5. 완료 화면에서 × 또는 Esc로 닫으면 포인트는 유지되고 글은 등록되지 않는다. 글을 수정한 뒤 **등록**을 누르면 같은 완료 화면으로 돌아온다. 계속하기 시점의 제목·본문을 등록한다.
6. 등록 후 **새 글 쓰기**를 누르면 빈 초안과 새 인증 시도를 만든다. 누적 포인트·등록 목록은 유지한다. 두 번째 정상 등록을 마치면 총 20P·글 두 건이다.

제목이나 본문이 공백뿐이면 인증을 열지 않는다. 글과 포인트는 페이지 메모리만 사용하고 새로고침하면 초기화된다. 제목·본문은 SDK 또는 서버에 전송하지 않는다.

완료 화면의 **시승 신청**은 선택 사항이다. 링크가 즉시 새 탭의 `/demo/test-drive?clickId=…`를 연다. 그 탭에서 **전시장·시간**을 고르고 **신청**을 누르면 완료 결과와 신청 ID가 표시된다. 원래 탭으로 돌아가 글을 등록하거나 원래 탭을 닫아도 이미 열린 신청 탭은 독립적으로 동작한다. 이름·연락처와 실제 예약 정보는 받지 않는다.

## SDK 공개 경계와 데이터 처리

커뮤니티는 `@captchavatye/react`에서 `CaptchaModal`과 공개 타입을 가져오고 앱 진입점에서 `@captchavatye/react/style.css`를 불러온다. SDK 구현은 `packages/react/src`에 있다. 모달은 포인트를 표시하거나 지급하지 않으며, 아래 10P 정책은 샘플 커뮤니티가 소유한다.

| 입력·콜백 | 처리 |
| --- | --- |
| `open` | 같은 글 시도에서 표시만 바꾼다. SDK는 계속 마운트 |
| `creativeId`, `apiBaseUrl` | 한 시도 동안 고정. 소재는 bmw-m3-v1, 기본 API 경로 /api |
| `assetBaseUrl`, `landingBaseUrl` | 한 시도 동안 고정. 상대 이미지·시승 URL의 기준 절대 HTTP(S) 주소. 기본 현재 origin |
| `continueLabel` | 계속하기 버튼 문구. 기본 `원래 작업 계속하기` |
| `onComplete(result)` | 열린 현재 reveal 종료 뒤 challengeId/completionId/creativeId/clickId를 한 번 전달 |
| `onContinue()` | 열린 completed에서만 허용. 호스트가 별도 등록 가드로 글을 등록하고 닫음 |
| `onClose()` | 표시만 닫음. 초안·진행·이미 반영한 포인트 보존 |

SDK는 완료 가드를 호스트 호출 **전에** 세운다. 호스트는 completionId를 적용 Set에 **먼저** 넣고 +10P를 수행한다. 글 등록에는 별도의 동기 ref 가드를 사용하고, React state updater 안에서 Set/가드를 변경하지 않는다.

최신 커밋된 콜백 참조는 open을 처리하는 effect와 별도로 갱신한다. 호스트 재렌더로 인증 요청·연출이 재시작되지 않는다. 콜백 자체의 예외는 인증 HTTP 오류로 바꾸거나 자동 재전달하지 않는다.

글 등록 뒤 새 글을 시작할 때만 내부 시도 번호를 증가시켜 SDK의 React key를 바꾼다. 공개 attemptId/reset 입력이나 서버 필드를 추가하지 않았다. 이전 글 시도에 묶인 늦은 콜백은 호스트에서도 무시한다.

구현 가정: 닫고 수정한 경우 **계속하기 시점의 현재 글**을 등록하며, 공백만 있는 제목·본문을 막는다. 등록 실패를 고친 뒤 다시 계속할 수 있도록 SDK의 계속하기에 영구 소진 가드를 두지 않고 호스트의 등록 가드로 중복을 막는다.

### 실패·닫기·재열기

| 상황 | 처리 |
| --- | --- |
| 이미지 준비 실패 | 받은 인증 ID를 유지하고 이미지만 다시 준비한다 |
| 시작 응답 전 닫기 | 이전 응답을 무시하고 재열기에 시작을 재실행한다. 이전 pending 인증은 남을 수 있다 |
| 조작 중 닫기·포인터 취소·리사이즈 | 포인터 캡처를 해제하고 초기 위치로 돌린다 |
| 조각 중심이 전체 원본 밖 | 좌표를 보정하거나 전송하지 않고 복귀한다 |
| 검증 중 닫기 | 요청 취소를 시도하고 응답을 무효화한다. 재열기에 동일 스냅샷으로 확인한다 |
| 스냅·줌아웃 중 닫기 | 성공 ID를 보존하고 재열기에 스냅부터 연출한다 |
| 완료 후 재열기 | 재검증·연출 재실행·추가 보상 없음. 계속하기로 글 등록 가능 |
| 통신 오류·10초 초과·응답 형식 오류 | 오류 화면에서 같은 작업만 재시도한다 |
| 서버에 인증이 없음(404) | 반복 검증 대신 화면 초기화를 안내한다 |

진행 상태는 설계의 `loading → challenge → verifying → snapping → revealing → completed`와 `error`를 사용한다. 표시 여부는 상태와 별개다. 닫기 시 실행 세대를 즉시 바꿔 이전 응답·오류·finally·연출 완료가 새 실행을 변경하지 못하게 한다.

## 서버 계약과 기록

| API | 입력 | 결과 |
| --- | --- | --- |
| `POST /api/challenges` | `{creativeId:"bmw-m3-v1"}` | 201 `{challengeId, creative}`; 없는 소재 404 |
| `POST /api/verify` | `{challengeId, dropX, dropY}` | 200 `{passed:false}` 또는 `{passed:true, completionId, clickId}`; 없는 인증 404 |
| `POST /api/events` | `{eventId, eventName, clickId, occurredAt}` | 신규 201 `{accepted:true, duplicate:false}`; 동일 재전송 200 `{accepted:true, duplicate:true}` |
| `POST /api/demo/test-drives` | `{clickId, locationId, slotId}` | 최초 201; 같은 선택의 재전송 200과 기존 `{leadId, clickId, locationId, slotId, status:"completed", isDemo:true}` |

문자열·boolean·비유한 값·범위 밖 좌표는 422다. 422의 `detail` 배열을 유지하며, NaN/Infinity가 오류 응답 JSON을 깨뜨리지 않도록 해당 입력값만 문자열로 표현한다.

동기 경로가 사용하는 Store의 공통 `threading.Lock` 안에서 인증 조회, 성공 여부 확인, 위치 판정, ID 생성, `passed`와 `click_links` 저장까지 처리한다. 결과를 저장한 뒤 응답한다. 이미 성공한 인증은 입력 검증을 통과한 다른 좌표에도 기존 ID 쌍을 반환한다. 최초 성공만 `captcha_passed challengeId=… completionId=… clickId=…` 로그를 남긴다.

서버가 `secrets`로 생성하는 `ch_`, `cmp_`, `clk_` ID는 충돌을 확인한다. 프론트엔드는 성공 ID를 만들지 않는다. Store에는 인증·클릭 연결·이벤트·신청의 네 메모리 맵이 있다.

### 이벤트 수집과 실패 처리

클라이언트가 보내는 이름은 `cta_shown`, `cta_clicked`, `landing_viewed` 세 개다. `test_drive_requested`는 서버 전용이므로 요청으로 보내면 422다. ID 접두사는 제한하지 않으며, `eventId`와 `clickId`는 공백뿐인 값이 아닌 문자열이어야 한다.

`occurredAt`은 시간대가 있는 ISO 날짜·시각 문자열을 받는다. 이 PoC의 입력 형식은 `T`로 날짜와 시각을 구분하는 일반적인 달력 날짜 표기이며, UTC `Z`·숫자 시간대 오프셋·소수 초를 허용한다. 날짜 유효성과 시간대는 기존 Pydantic 검증기를 사용해 확인하고 원문을 그대로 저장한다. 숫자·Unix 시각 문자열·날짜만 있는 값·시간대 없는 값은 422다. 과거·미래 시각이나 이벤트 도착 순서로 업무 상태를 제한하지 않는다.

스키마 검증 뒤 기존 공통 잠금을 획득한다. 기존 `eventId`가 있으면 `eventName`, `clickId`, 원문 `occurredAt`만 비교한다. JSON 필드 순서는 무관하고, 같은 시각의 `Z`와 `+00:00`도 문자열이 다르면 **409 `EVENT_ID_CONFLICT`**다. 최초 레코드와 서버 UTC `receivedAt`을 바꾸지 않는다.

새 ID에서만 `click_links`를 확인한다. 연결이 없으면 **404 `CLICK_NOT_FOUND`**, 있으면 `events[eventId]`에 한 번 저장한다. 기존 ID의 다른 유효 내용은 연결이 없어도 404보다 409가 우선한다. 업무 오류는 `{detail:{code,message}}`, 입력 오류는 422 `detail` 배열이다.

같은 클릭에 서로 다른 이벤트 ID를 여러 개 저장할 수 있다. 새로 저장된 건만 잠금 해제 후 `event_accepted eventId=… eventName=… clickId=…` 로그를 남긴다. 이 API는 인증 상태·포인트·글 등록·신청 완료를 변경하지 않는다.

### 클라이언트 이벤트와 신청 화면

`tracking.ts`는 각 행동 시점에 `ev_` + UUID와 ISO 시각을 한 번 생성하고, 동결한 payload를 직렬화해 전송한다. 모달이 열린 `completed`에서 실제 CTA가 표시될 때 같은 clickId의 `cta_shown`을 한 번 만든다. 닫기·재열기·부모 재렌더는 노출을 추가하지 않는다. 링크의 기본 클릭·Enter·마우스 가운데 버튼 활성화는 매번 새 `cta_clicked`를 만든다. 오른쪽 버튼은 클릭으로 기록하지 않는다.

새 탭은 URL의 clickId만 읽어 `landing_viewed`를 보낸다. StrictMode 초기 effect 반복은 가드로 막고, 새 탭이나 새로고침은 새 이벤트를 만든다. ID는 공백뿐인지 확인할 때만 trim을 사용하며 원문은 변경하지 않는다. 부모 탭·window.opener·localStorage·신청 조회 API에 의존하지 않는다.

이벤트는 요청마다 10초 기한을 적용한다. 네트워크 실패·시간 초과·실제 5xx만 500ms, 1500ms 뒤 최대 두 번 재시도한다. 최초 eventId·시각·내용을 재사용한다. 4xx와 잘못된 200/201 본문은 재시도하지 않는다. 이벤트 생성·전송 실패는 호출한 화면에 예외를 전달하지 않으며 포인트·글 등록·신청을 막지 않는다. 모달을 닫아도 이미 생성한 이벤트의 유한 재시도는 이어가지만 페이지 종료 후 전달은 보장하지 않는다.

신청 화면의 상태는 `editing → sending → completed`, 불확실한 결과의 `retry`, 복구가 필요한 `blocked`다. SDK의 일곱 상태와 별도로 소유한다. 제출 순간 clickId·locationId·slotId를 동결하고, 동기 ref 가드로 동일 이벤트 루프의 이중 제출을 막는다.

| 신청 결과 | 화면 처리 |
| --- | --- |
| 정상 200/201 | 반환된 연결·선택지가 제출 스냅샷과 같고 leadId·completed·isDemo가 유효할 때만 완료 |
| 연결 유실·10초 초과·5xx·잘못된 성공 본문 | 선택지 잠금 유지. **다시 시도**만 제공 |
| 실제 HTTP 422 | 서버가 거절한 요청으로 판단하고 선택지를 다시 편집 가능하게 함 |
| 404·409 | 완료로 표시하지 않고 오류와 **처음으로** 제공 |
| 화면 종료 | 요청 취소를 시도하고 이전 실행의 늦은 응답을 무시 |

신청 HTTP 클라이언트는 상태 코드를 보존한다. 503의 detail 배열을 422로 오인하지 않고, HTML 형태의 422도 편집 가능한 오류로 분류한다. 응답 유실 뒤 동일 선택을 재시도하면 서버의 기존 leadId를 받는다. 새로고침은 폼과 완료 표시를 초기화하지만 서버 신청은 유지되므로 같은 선택은 200, 다른 유효 선택은 409다.

**구현 최소안:** 지점·시간의 초기 선택은 빈 placeholder로 둔다. 단순한 두 경로이므로 기존 App에서 pathname으로 분기하고 라우터 의존성은 추가하지 않았다. 이벤트 수집기는 SDK 내부 모듈을 신청 페이지가 재사용하며 공개 SDK 입력·콜백을 늘리지 않는다.

### 모의 시승 신청과 내부 전환

`locationId`는 `demo-center-a`(시연 전시장 A)·`demo-center-b`(시연 전시장 B), `slotId`는 `demo-slot-1`(시연 시간 1)·`demo-slot-2`(시연 시간 2)를 받는다. 네 조합을 모두 허용한다. 실제 예약 재고나 이름·연락처를 받지 않는다.

요청 스키마를 검증한 뒤 공통 잠금 안에서 `click_links[clickId]`와 연결된 인증을 확인한다. 인증은 `passed`여야 하고 `completionId`·`clickId`가 연결과 일치해야 한다. **구현 최소안:** 연결 누락·인증 누락·미통과·ID 불일치는 모두 기존 오류 **404 `CLICK_NOT_FOUND`**로 처리한다. 새로운 오류 코드를 추가하지 않고 유효한 성공 연결만 신청에 사용하기 위한 결정이다.

연결 검증을 마친 뒤 `leads[clickId]`를 확인한다. 같은 지점·시간이면 기존 결과를 **200**, 다른 유효 선택이면 **409 `LEAD_CONFLICT`**로 반환한다. 잘못된 선택지·필드·타입은 이 조회보다 먼저 **422**가 된다. 중복·충돌은 최초 신청·완료 시각·전환 레코드를 바꾸지 않는다. 서로 다른 clickId가 같은 지점·시간을 고르는 것은 별도 신청이다.

최초 신청은 기존 `secrets` 기반 생성기를 재사용한다. leadId는 기존 신청 값들의 ID와, 내부 eventId는 모든 클라이언트·서버 이벤트 키와 충돌을 검사한다. **구현 최소안:** 내부 이벤트 ID의 접두사는 `ev_`로 둔다. 접두사에 의존하지 않고 공유 이벤트 맵 전체에서 충돌을 확인한다.

서버 UTC 완료 시각을 한 번 생성해 신청의 `completed_at`, 내부 이벤트의 `received_at`, 그 시각을 ISO 문자열로 표현한 `occurred_at`에 함께 사용한다. 두 ID·레코드·응답을 먼저 준비한 뒤 같은 임계 구역에서 신청과 `test_drive_requested`를 한 번 저장한다. ID 생성 실패 시 일부 레코드만 남지 않는다. 내부 전환은 잠금을 다시 획득하는 클라이언트 이벤트 서비스를 호출하지 않고 직접 저장한다.

공개 성공 응답은 설계의 여섯 필드만 사용한다. 내부 eventId·완료 시각·중복 판단값은 추가하지 않는다. 잠금 해제 후 최초 신청만 `test_drive_completed challengeId=… clickId=… leadId=…`로 기록한다.

신청은 클릭·랜딩 이벤트 수신을 기다리지 않는다. 늦게 도착한 이벤트도 기존 신청을 변경하지 않으며, 신청 처리 자체가 포인트나 원래 글 등록을 조건으로 삼지 않는다.

이 PoC는 위치 맞추기 흐름을 검증한다. 실제 봇 탐지·실제 보상·예약·DB·다중 워커는 구현 범위가 아니다.

## 파일 책임

| 경로 | 책임 |
| --- | --- |
| `frontend/src/App.tsx` | 커뮤니티와 `/demo/test-drive` 진입점 분기 |
| `frontend/src/pages/DemoCommunityPage.tsx` | 글쓰기·등록 목록·포인트 표시, 공개 SDK 연결 |
| `frontend/src/pages/useCommunityDraft.ts` | 페이지의 React 상태와 적용 ID Set·시도/등록 ref 가드 |
| `frontend/src/pages/TestDrivePage.tsx`, `TestDrivePage.css` | URL ID, 랜딩 이벤트, 선택·신청 스냅샷, 오류·완료 화면과 반응형 배치 |
| `frontend/src/demo/testDriveApi.ts` | 신청 HTTP, 10초 기한·취소, 실제 상태 코드와 요청/응답 일치 검사 |
| `frontend/src/demo/testDriveOptions.ts` | 서버와 동일한 두 지점·두 시간 ID 및 표시 이름 |
| `packages/react/src/index.ts`, `types.ts` | 공개 컴포넌트와 입력/결과 타입 |
| `packages/react/src/api.ts` | 시작·검증 HTTP, 10초 기한·취소, 응답 계약 검사·오류 정규화 |
| `packages/react/src/flow.ts` | 한 인증 시도의 상태·요청·성공 ID·재시도·실행 세대·완료 전달 가드 |
| `packages/react/src/useCaptchaFlow.ts` | 흐름 구독, 표시/마운트 수명과 최신 콜백 참조를 분리해 연결 |
| `packages/react/src/CaptchaModal.tsx` | 안내·닫기·재시도·계속하기, 완료 CTA URL과 노출/클릭 이벤트 연결 |
| `packages/react/src/tracking.ts` | 클라이언트 이벤트 생성·동일 payload 재시도·실패 격리 |
| `packages/react/src/CarPuzzle.tsx` | 이미지 준비, Pointer Events, 캡처/취소, scene·조각, 스냅·줌아웃 |
| `packages/react/src/geometry.ts` | 확대 변환, 조각 중심 정규화, 포인터 오프셋 계산 |
| `packages/react/src/stageCompletion.ts` | 종료 이벤트·우회 타이머의 한 번 완료와 늦은 이벤트 방어 |
| `packages/react/src/creativeAssets.ts` | 기존 투명 PNG의 내부 CSS crop. 공개 API에는 새 필드를 추가하지 않음 |
| `backend/app/main.py` | 앱별 Store 한 개, 라우트와 422 직렬화 처리 |
| `backend/app/api/routes/captcha.py` | 두 HTTP 진입점과 업무 오류의 상태 코드 변환 |
| `backend/app/schemas/captcha.py` | camelCase 요청/응답 계약과 엄격한 좌표 검증 |
| `backend/app/services/captcha.py` | 인증 생성·위치 판정·성공 ID 재사용 |
| `backend/app/api/routes/events.py` | 이벤트 HTTP 진입점, 신규/중복의 201/200과 업무 오류 변환 |
| `backend/app/schemas/events.py` | 허용 이벤트·엄격한 문자열·시간대 검증, 원문 시각 보존 |
| `backend/app/services/events.py` | 공통 잠금 안의 중복/충돌·연결 확인·단일 저장, 신규 로그 |
| `backend/app/api/routes/demo.py` | 모의 신청 진입점과 신규/재전송 201/200, 업무 오류 변환 |
| `backend/app/schemas/demo.py` | 고정 지점·시간 요청 검증과 여섯 필드의 완료 응답 |
| `backend/app/services/demo.py` | 성공 인증 연결 확인, 신청 중복·충돌 처리, 내부 전환과 함께 저장 |
| `backend/app/store.py` | 네 메모리 맵, 불변 인증·연결·이벤트·신청 레코드와 공통 잠금 |
| `backend/app/demo_config.py` | 공개 소재 설정·서버 전용 허용 오차·시연 지점/시간 ID |
| `frontend/tests/`, `backend/tests/` | API·좌표·흐름·동시성·연출 회귀 검증 |
| `frontend/tests/stage3.html`, `stage3Harness.tsx` | 제품 App에서 참조하지 않는 실제 React/공개 SDK 검증 fixture |
| `docs/verification/stage3/` | 호스트 경계·통합 Chrome 검증 스크립트·결과·캡처 |
| `docs/verification/stage4-events/` | 이벤트 API의 실제 HTTP 스크립트·결과, 테스트와 리뷰 기록 |
| `docs/verification/stage4-test-drives/` | 신청·재전송·동시성·재시작 HTTP 검증, 테스트와 리뷰 기록 |
| `docs/verification/stage4-ui/` | 새 탭 전환·기존 흐름·호스트 Chrome 검증, 결과·캡처·리뷰 |
| `docs/verification/stage5/` | V01~V08 완료 표, 현재 UI 경계·동시 인증·실제 재시작/재시연 검증과 초기화 절차 |

## 소재와 허용 오차

원본은 **1672×941px**, 램프 영역은 **(347, 373, 223, 70)px**다. `lampRect`는 원본 크기로 나눈 좌표, `zoomRect`는 x=0.1342224880, y=0.2935812965, width=height=0.28이다.

서버의 첫 허용 오차는 원본 **X ±12px, Y ±8px**다. 램프 223×70px의 중심 부근을 맞추되 작은 손 조작 오차를 허용하는 시연용 결정이다. 각 축의 안·정확한 경계·밖을 테스트한다. 양쪽 축을 모두 만족해야 성공하며 허용 오차는 API 응답에 포함하지 않는다. 좌표를 반올림하지 않는다.

세 이미지와 [asset-manifest.json](docs/assets/asset-manifest.json)은 1단계에서 준비한 파일을 유지한다. 차량 전체 이미지는 정확한 16:9와 약 0.06% 차이가 있어 같은 창 크기로 미세 조정한다. 두 PNG는 원본을 정확히 잘라낸 조각이 아닌 생성된 파생 소재이며, 공통 CSS crop (276, 311, 1172, 350)을 사용한다. 원본과 픽셀 단위 질감의 동일성은 보장하지 않는다. 생성 기록은 [generation-prompts.txt](docs/assets/generation-prompts.txt)에 있다. BMW 소재는 실제 제휴를 전제로 하지 않는 시연용이다.

## 검증 — 2026-10-25 KST

### 화면 문구 정리 후 확인

커뮤니티의 슬로건·보상 카드·기본 동작 설명과 입력 예시를 제거했다. 인증 안내는 상태별 한 곳에 표시하고, 신청 화면은 제목·선택 항목·신청 결과와 실제 예약 아님 고지로 정리했다. API·상태 전이·콜백·ID 처리에는 변경이 없다.

변경 후 `npm run lint`(경고·오류 0), `npm run build`, `npm test`(49개)가 통과했다. 실제 Chrome에서 기존 회귀 12개, 신청 5개(새 탭·응답 유실 재시도·링크 누락·404·모바일), 오배치 복구 1개를 실행해 18개 모두 통과했고 page error는 0이었다. 데스크톱·390px 모바일 화면의 배치와 모달 높이도 확인했다.

아래 단계별 검증 자료는 당시 소스와 문구의 기록으로 보존한다. 이번 브라우저 검증은 stage4-ui의 regression/conversion, stage5의 edges 스크립트를 임시 복사하고 변경된 버튼·라벨·제목·오배치 안내 선택자만 맞춰 실행했다.

### 이전 완료 기록: 5단계 재현·기록

**V01~V08을 모두 확인했다.** 이번 단계는 제품 코드를 변경하지 않고 기존 소스 61개 파일의 해시 일치를 확인한 뒤 부족했던 시나리오를 추가 실행했다. 기존 테스트를 전부 다시 돌린 결과로 합산하지 않는다. DESIGN의 “미실행 검증 계획” 표현은 구현 전 정본으로 보존하며 아래 결과가 실제 완료 기록이다.

| 완료 항목 | 최종 확인 |
| --- | --- |
| V01 서버·연출·보상·글 등록 | 서버 true와 유효한 연출 완료 뒤 10P, 중복 콜백·계속하기에도 글 한 건 |
| V02 드래그 경계 | 오배치 복귀, 범위 밖·취소·리사이즈 시 전송 없음, 잡은 위치·창 크기와 무관한 중심 좌표 |
| V03 인증 재시도·동시 요청 | 실제 HTTP 동시 두 건과 다른 유효 좌표 재전송이 같은 완료 ID 쌍 |
| V04 닫기·재열기·이전 결과 | 초안·받은 ID 보존, 숨김 중 보상 없음, 이전 응답·이미지 준비·연출 무효화 |
| V05 선택적 CTA | CTA 없이 완료 가능, 새 탭 복귀·재열기 후 같은 완료와 포인트·노출 ID 유지 |
| V06 이벤트 독립성 | 세 이벤트 모두 503인 동안에도 실제 신청 201·10P·글 한 건 |
| V07 이벤트·신청 중복/충돌 | 신규 201, 같은 내용 200, 다른 내용 409, 최초 기록·내부 전환 개수 유지 |
| V08 실제 재시작·재시연 | 기존 ID는 404, 커뮤니티 초기화 후 새 ID로 두 번째 전체 시연 성공 |

추가 실행은 **UI 경계 9/9**, **실제 동시 인증 HTTP 1개 시나리오**, **실제 재시작·재시연 11/11 확인 항목**이 통과했다. 두 브라우저 실행의 page error는 0이었다. 실제 프로세스 교체, 404 오류 화면, 초기화의 0P·글 0건, 재시연의 10P·글 한 건·새 신청 ID를 기록했다. 검증용 새 탭 관찰 코드의 중복 초기화 오류는 수정 후 재실행했으며 제품 소스에는 변경이 없다.

재사용한 기존 통과 증거는 프론트엔드 단위 49개·백엔드 152개·브라우저 34개와 린트/빌드다. 브라우저에서는 UI·요청·응답을, 정확한 내부 lead/전환 개수와 최초 객체 보존은 백엔드 Store assertion을 확인했다. 서버 메모리를 읽는 새 API는 추가하지 않았다.

- [coverage.md](docs/verification/stage5/coverage.md): V01~V08과 정확한 사례 이름, 실행·초기화 절차.
- [checks.json](docs/verification/stage5/checks.json): 새 실행과 기존 결과 재사용, 소스·실행 자료의 해시.
- [edges-results.json](docs/verification/stage5/edges-results.json): 드래그·로딩·전체 이벤트 실패 9개.
- [concurrent-verify-results.json](docs/verification/stage5/concurrent-verify-results.json): 실제 동시 인증 요청·ID 재사용.
- [restart-results.json](docs/verification/stage5/restart-results.json): 실제 서버 재시작, 열린 탭의 404, 초기화와 두 시연의 전후 ID.
- [server-observation.json](docs/verification/stage5/server-observation.json): 실제 서버 로그의 최초 성공·신청과 ID 연결.
- [review.md](docs/verification/stage5/review.md): 독립 증거 검토와 검증 코드 검토.

확인 환경은 Mac Chrome 155.0.8059.85의 격리된 headless context, 1280×900·390×844다. 모바일 실기기·Safari나 실제 봇 탐지·보상·예약·배포의 완료를 의미하지 않는다.

### 이전 완료 기록: 4단계 선택적 CTA·새 탭 신청 화면·클라이언트 이벤트

| 검증 | 결과 |
| --- | --- |
| 프론트엔드 단위 검증 | **49/49 통과**. 기존 34개 + 이벤트·신청 15개 |
| 백엔드 회귀 | **152/152 통과**. 이번 작업에서 백엔드 변경 없음 |
| 새 탭·신청·이벤트 브라우저 검증 | **16/16 통과**, page error 0 |
| 기존 인증·커뮤니티 브라우저 회귀 | **12/12 통과**, page error 0 |
| 실제 React 호스트 경계 | **6/6 통과**, page error 0 |
| 린트·빌드 | 경고 0·오류 0, TypeScript 검사·Vite production build 통과 |
| 화면 | Chrome 155.0.8059.85, 1280×900·390×844. CTA·신청·완료·불확실한 요청 화면 확인, 가로 넘침 없음 |
| 독립 코드 리뷰 | 가운데 버튼 CTA 이벤트 누락 1건 발견 → 실제 실패 재현 → 수정·통과. 잔여 지적 없음 |
| 보존 | DESIGN.md·세 소재·백엔드·SDK 공개 타입·인증 흐름·의존성 유지 |

실제 단일 워커 FastAPI와 Vite 프록시를 사용했다. 클릭 이벤트가 서버에 도착하기 전에도 새 탭이 바로 열리며, 원래 탭에서 글 등록 후 그 탭을 닫아도 신청을 완료했다. 기본 클릭·가운데 버튼·Enter 활성화를 확인했고 새 탭의 `window.opener`는 null이었다. 모달 닫기 뒤 이벤트 재시도, 완료 재열기의 노출 1회, StrictMode·새로고침의 랜딩 이벤트, 실제 404·409, 422 이후 수정, 동일 이벤트 루프의 중복 제출도 확인했다.

첫 신청은 실제 서버에 저장하고 응답 전달만 유실시켰다. 선택지 잠금과 같은 payload 재시도 뒤 기존 leadId의 200 완료를 확인했다. 503 HTML·잘못된 성공 본문도 같은 스냅샷을 유지한다. 이벤트 4xx는 한 번에 종료하고 5xx는 동일 내용으로 총 세 번 전송한다. 두 실패 모두 포인트·원래 글 등록을 바꾸지 않는다.

추가 경계 테스트에서는 잘못된 2xx 이벤트 재시도, 이벤트 생성 예외, 신청 오류 분류·스냅샷의 다섯 실패를 먼저 확인했다. URL ID 원문 보존과 가운데 버튼 클릭 기록도 브라우저에서 실패를 재현한 뒤 고쳤다. 실패 기록은 `red-*.json`, 해당 시점 캡처는 `*-failed.png`로 보존했으며 현재 결과와 구분한다.

- [checks.json](docs/verification/stage4-ui/checks.json): 실행 결과, 검토·검증한 소스 SHA-256, 보존 범위.
- [conversion-results.json](docs/verification/stage4-ui/conversion-results.json): 새 탭·신청·이벤트 16개.
- [regression-results.json](docs/verification/stage4-ui/regression-results.json): 기존 인증·글 등록 12개.
- [host-results.json](docs/verification/stage4-ui/host-results.json): React 호스트 경계 6개.
- [review.md](docs/verification/stage4-ui/review.md): 독립 검토의 발견 사항·해결·한계.

```bash
cd /Users/jungle/dev/missions/final_mission
CAPTCHAVATYE_PLAYWRIGHT_MODULE=/Users/jungle/.npm/_npx/31e32ef8478fbf80/node_modules/playwright \
  node docs/verification/stage4-ui/verify.conversion.cjs
```

두 개발 서버가 필요하며 스크립트 실행 시 메모리에 모의 인증·이벤트·신청이 추가된다. 각 사례는 격리된 headless Chrome context에서 실행한다. 이 4단계 기록은 모바일 실기기·Safari 실행을 포함하지 않는다. 당시 남아 있던 현재 UI의 서버 재시작·초기화 재시연은 위의 5단계 최종 기록에서 완료했다.

### 이전 완료 기록: 모의 시승 신청 API

| 검증 | 결과 |
| --- | --- |
| 변경 전 회귀 | 기존 백엔드 **101/101 통과** |
| 구현 전 실패 | 신규 51개 실패. 네 조합이 미구현 경로의 404로 실패함을 별도로 확인 |
| 구현 후 전체 | **152/152 통과**: 기존 101개 + 신청 51개. 경고 없음 |
| 실제 신청 HTTP | **13/13 통과**: 실제 단일 워커·Vite 프록시·서버 재시작 전 ID 포함 |
| 기존 이벤트 HTTP 회귀 | **9/9 통과**: 네 번째 API 추가 후에도 동작하도록 경로 존재 검증을 유지 |
| 동시 신청 | 동일 12건은 201 한 건·200 열한 건, 다른 네 조합은 201 한 건·409 세 건 |
| ID·기록 보존 | lead 값과 모든 이벤트 키의 충돌 회피, 내부 이벤트 덮어쓰기 방지, 생성 중 오류 시 미저장 |
| 서버 로그 | HTTP 검증에서 새 신청 6건의 최초 완료 로그가 각각 한 번만 기록 |
| 독립 정적 리뷰 | 수정이 필요한 결함 0건. 연결·잠금·응답·ID 충돌과 신규 테스트 검토 |

이 API 작업 당시에는 프론트엔드를 변경하지 않았다. 이후 CTA·신청 화면·클라이언트 이벤트 연결을 완료했으며 결과는 위의 최신 검증 기록에 있다.

- [checks.json](docs/verification/stage4-test-drives/checks.json): 기준·미구현 실패·152개 통과·검토한 소스 해시.
- [http-results.json](docs/verification/stage4-test-drives/http-results.json): 실제 신청 HTTP 13개 결과.
- [review.md](docs/verification/stage4-test-drives/review.md): 독립 리뷰의 범위·결과·실행 제한.
- [verify.http.py](docs/verification/stage4-test-drives/verify.http.py): 실제 서버 재검증 스크립트. 모의 인증·신청·이벤트가 추가된다.

```bash
cd /Users/jungle/dev/missions/final_mission
python3 docs/verification/stage4-test-drives/verify.http.py
python3 docs/verification/stage4-events/verify.http.py
```

신청 스크립트의 기본 실행은 12개 항목을 검사한다. 재시작 직전에 발급한 ID를 `--stale-click-id <ID>`로 전달하면 재시작 후 404 항목이 추가되어 13개다. 이번 실행은 해당 항목까지 확인했다.

### 이전 완료 기록: 이벤트 수집 API

| 검증 | 결과 |
| --- | --- |
| 변경 전 회귀 | 기존 백엔드 **43/43 통과** |
| 구현 전 실패 | 기존 43개 통과 뒤 첫 신규 이벤트 테스트가 미구현 경로의 404로 실패 |
| 구현 후 전체 | **101/101 통과**: 기존 43개 + 이벤트 58개 |
| 실제 HTTP | **9/9 통과**: 단일 Uvicorn 워커와 Vite 프록시 사용 |
| 동시 요청 | 동일 12건은 201 한 건·200 열한 건, 다른 내용 12건은 201 한 건·409 열한 건 |
| 기록 보존 | 동일 재전송·충돌에서 최초 객체와 receivedAt 유지, 같은 순간의 다른 시각 문자열은 충돌 |
| 서버 로그 | HTTP 검증에서 실제 새 이벤트 5건만 신규 로그로 기록 |
| 독립 정적 리뷰 | 수정이 필요한 결함 0건. 스키마·잠금·HTTP 상태·기존 테스트 변경을 검토 |

이벤트 API 작업에서는 프론트엔드 파일과 의존성을 변경하지 않았다. 아래 3단계의 화면·빌드 검증은 이전 실행 기록이다. 이벤트 API 단독 완료 시점에는 전체 PoC의 V01~V08 완료가 아니었으며, 최종 결과는 5단계 표에 기록했다.

- [checks.json](docs/verification/stage4-events/checks.json): 기준 테스트·미구현 실패·최종 통과와 소스 해시.
- [http-results.json](docs/verification/stage4-events/http-results.json): 실행 서버의 9개 검증 결과.
- [review.md](docs/verification/stage4-events/review.md): 독립 리뷰의 범위·결과·제한.
- [verify.http.py](docs/verification/stage4-events/verify.http.py): 실제 서버 재검증 스크립트. 실행하면 모의 인증·이벤트가 추가된다.

두 개발 서버가 실행 중일 때 다음 명령으로 HTTP 검증을 반복할 수 있다.

```bash
cd /Users/jungle/dev/missions/final_mission
python3 docs/verification/stage4-events/verify.http.py
```

### 이전 완료 기록: 3단계 고객사 연결

| 검증 | 결과 |
| --- | --- |
| 백엔드 전체 회귀 | **43/43 통과**. 기존 API·스키마·허용 오차·동시성 유지 |
| 프론트엔드 전체 | **34/34 통과**. 기존 27개 + 완료 콜백 시점/인자/재진입/예외/수명/최신 참조/계속하기 조건 |
| 실제 React 호스트 경계 | **6/6 통과**. 동일 이벤트 루프의 중복 완료·등록, 최신 초안, 이전 시도, 페이지 전체 적용 Set, 공백 입력 |
| 실제 서버·화면 통합 | **12/12 통과**, page error 0. Mac Chrome 155.0.8059.85 (headless), 1280×900·390×844 |
| 린트 | 경고 0·오류 0 |
| 빌드 | TypeScript 검사·Vite production build 통과 |
| 화면 확인 | 데스크톱 작성/완료/등록 및 작은 화면 작성/완료 캡처 확인. 모달 크기·16:9·가로 넘침 확인 |
| 보존 확인 | DESIGN.md·세 이미지 SHA-256 동일. 백엔드 13개 파일은 이전 검토 복사본의 마지막 줄바꿈 차이를 제외한 전체 내용 동일 |
| 독립 코드 검토 | Critical·Important·Minor 각 0건. 정적 검토와 판단은 review.md에 기록 |

통합 테스트는 실제 FastAPI가 저장한 성공 응답의 **전달만** 지연하거나 유실시켜 실행했다. 검증·스냅·줌아웃 동안 0P, 유효한 완료 뒤 10P를 확인했다. 검증/연출 중 닫기·재열기, 완료 후 수정, 동일 재시도, 새 글의 다른 인증 ID와 총 20P·두 글, 동작 줄이기, HTML 형태의 사용자 문자열이 텍스트로 표시되는 경우를 포함한다.

공개 SDK fixture는 React StrictMode에서 부모를 검증·줌아웃 중 재렌더하고 콜백 참조를 바꾼다. 같은 인증을 유지하면서 최신 콜백을 한 번 호출하는지 확인한다. 호스트 fixture는 실제 페이지 hook에 완료/계속하기를 각각 같은 이벤트 루프에서 다섯 번 전달하여 중복 가드를 검사한다. 이 fixture에서 사용하는 ID는 콜백 경계 시험용이며 실제 서버 통합 시험과 구분한다. 제품 App이나 SDK에는 시험용 메서드를 추가하지 않았다.

신규 콜백 7개 및 호스트 6개 시험의 미구현 실패를 먼저 확인한 뒤 구현했다. 스마트폰 실기기·Safari 시험이나 전체 PoC V01~V08 완료를 주장하지 않는다. 이 기록은 3단계 완료 시점의 범위다. 이벤트·신청 UI 검증은 위의 4단계 기록에 추가했다.

결과:

- [integration-results.json](docs/verification/stage3/integration-results.json): 실제 서버·브라우저 12개 결과, 단계별 포인트·요청/ID·화면 크기.
- [host-results.json](docs/verification/stage3/host-results.json): 실제 React 호스트 경계 6개 결과.
- [checks.json](docs/verification/stage3/checks.json): 단위·빌드·린트와 테스트 실패→통과 기록.
- [review.md](docs/verification/stage3/review.md): 독립 정적 검토와 판단.
- [3단계 실행 기록](docs/superpowers/plans/2026-10-25-stage-3-community.md): 범위·결정·실행 결과.

```bash
cd /Users/jungle/dev/missions/final_mission/backend
.venv/bin/python -m pytest -q

cd /Users/jungle/dev/missions/final_mission/frontend
npm test
npm run lint
npm run build
```

두 서버를 실행한 뒤 Mac의 기존 Playwright 모듈로 검증한다. 별도 headless Chrome의 격리된 context를 사용하며 개인 브라우저 프로필·탭을 열지 않는다. 새 브라우저 테스트 의존성은 설치하지 않았다.

```bash
cd /Users/jungle/dev/missions/final_mission
CAPTCHAVATYE_PLAYWRIGHT_MODULE=/Users/jungle/.npm/_npx/31e32ef8478fbf80/node_modules/playwright \
  node docs/verification/stage4-ui/verify.host.cjs
CAPTCHAVATYE_PLAYWRIGHT_MODULE=/Users/jungle/.npm/_npx/31e32ef8478fbf80/node_modules/playwright \
  node docs/verification/stage4-ui/verify.regression.cjs
```

다른 Mac에서는 설치된 Playwright 모듈 경로를 위 환경 변수에 지정한다. 위 명령은 현재 CTA 동작에 맞춘 회귀·호스트 검증이며 결과와 캡처를 stage4-ui 폴더에 저장한다. stage1~stage3의 스크립트·기록은 당시 화면 기준의 보존 자료다.

## 시연 반복과 기록 보존

현재 서버 기록은 PostgreSQL에 남는다. 서버 재시작이나 다중 워커 실행으로 인증, 이벤트, 전환을 초기화하지 않는다. 공개 데모 인증은 기존 계약에 따라 재조회할 수 있고, 고객사 인증은 미사용 상태에서 10분이 지나면 새로 발급해야 한다. 고객사가 이미 저장한 예약의 동일 요청 재전송은 만료 후에도 기존 예약을 반환한다.

커뮤니티에서 새 글을 쓰거나 페이지를 새로고침하면 로컬 초안과 화면 상태만 바뀐다. 기존 DB를 초기화하는 명령은 제공하지 않는다. 초기 메모리 PoC의 재시작 및 404 검증은 stage5의 역사적 기록이다.
