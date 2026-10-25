# CAPTCHAvatye 구현 전 설계

작성일: 2026년 10월 25일  
프로젝트: `/Users/jungle/dev/missions/final_mission`  
정본: 첨부 「CAPTCHAvatye_구현_상세_기획서.docx」 1~13장과 이번 작업 지시

리어램프 드래그를 서버에서 판정하고, 같은 차량 이미지의 스냅·줌아웃이 끝나면 고객사 화면에 모의 포인트를 반영한다. 원래 게시글 등록은 계속하기로 마치며, 시승 신청은 별도 탭에서 선택적으로 수행한다. 이 문서는 구현할 경계와 데이터 계약을 정한다. 현재 산출물은 이 파일 하나이며, 아래 파일·검증 항목은 앞으로 구현할 계획이다.

**표기:** `[확정]`은 기획서 또는 사용자 지시다. `[가정]`은 미정 부분을 채운 최소 구현 결정이며 해당 위치에 근거를 적는다. 이미지 측정값은 임의 수치를 확정값으로 쓰지 않고 소재 준비 단계의 산출물로 정한다. 목표·범위를 변경해야 하는 충돌은 발견하지 못했다.

## 1. PoC 목표와 구현 경계

### 1.1 목표와 완료 기준

`[확정 · 기획서 1~2, 4, 10장]`

| 목표 | 완료 기준 | 판정의 주체 |
| --- | --- | --- |
| 광고 인증 경험 | 서버 정답 응답 뒤 램프가 스냅되고 같은 원본 차량이 줌아웃된다. 차량 왼쪽·브랜드 문구 오른쪽·문구 아래 CTA를 표시한다. | 서버는 위치 판정, SDK는 연출 완료를 담당 |
| 고객사 연결 | 연출 완료 콜백으로 10P가 한 번 반영되고, 계속하기로 글 등록이 한 번 완료된다. | 커뮤니티 페이지의 React 상태 |
| 선택적 전환 | CTA로 연 새 탭에서 모의 신청을 마치고 `challengeId → clickId → leadId`를 확인한다. | 모의 신청 API와 서버 메모리 |
| 실패와 중복 처리 | 닫기·재열기, 응답 유실, 중복·동시 요청에서도 기존 결과를 유지한다. CTA 미참여·이벤트 전송 실패가 포인트와 글 등록을 막지 않는다. | 7절의 검증 시나리오 |

인증 성공, SDK 연출 완료, 포인트 반영, 게시글 등록, 모의 신청 완료는 각각 다른 사실이다. `passed: true`만으로 포인트나 글 등록을 처리하지 않는다. `onComplete`와 `onContinue`는 CTA 클릭·신청 결과를 기다리지 않는다.

### 1.2 범위

`[확정]` React + TypeScript + Vite + CSS 프론트엔드 하나에 커뮤니티·SDK·모의 신청 화면을 둔다. Python + FastAPI 백엔드는 아래 네 업무 API만 제공한다. BMW 소재 한 개, 데스크톱 글쓰기 화면 한 개, 고정 크기 인증 모달, 서버 메모리와 React 상태로 시연한다.

- `POST /api/challenges`
- `POST /api/verify`
- `POST /api/events`
- `POST /api/demo/test-drives`

실제 봇 탐지, 회원 인증, 실제 보상·포인트 원장, 실제 게시글 서버, 실제 시승 예약, 광고 계약·과금·정산, DB·Redis·다중 워커·배포 인프라 확장, 관리자·분석 대시보드는 포함하지 않는다. 이름·연락처도 수집하지 않는다. BMW 소재는 시연용이며 실제 제휴를 전제로 하지 않는다.

`[가정]` 커뮤니티의 게시글 등록은 작성 내용을 화면의 등록 완료 상태에 반영하는 로컬 동작으로 끝낸다. 로그인한 사용자라는 상황만 가정하고 로그인 기능은 만들지 않는다. 네 API와 모의 고객사 연동이라는 범위를 유지하기 위한 선택이다.

### 1.3 데이터가 이동하는 경계

| 생성 위치와 데이터 | 전달 대상 | 성공을 확정하는 순간 | 실패 시 유지할 것 |
| --- | --- | --- | --- |
| 커뮤니티의 제목·본문·글 시도 | SDK에는 설정과 콜백만 전달 | 계속하기 처리 시 로컬 글 등록 | 작성 내용·현재 글 시도 |
| 서버의 `challengeId`·소재 설정 | SDK | 시작 응답을 받아 같은 시도에 저장 | 받은 ID·설정, 아직 없으면 시작 재시도 |
| SDK의 조각 중심 좌표 | 검증 API | 서버가 `passed`와 완료 ID를 저장 | 마지막 검증 요청 전체 |
| 서버의 완료 ID들 | SDK → `onComplete` → 커뮤니티 | 열린 모달에서 연출을 끝내고 콜백 전달 | 성공 결과·콜백 전달 여부·적용한 ID |
| SDK의 CTA 링크·이벤트 | 새 탭·이벤트 API | 링크 이동과 이벤트 접수는 독립 | 동일 이벤트의 재전송 정보 |
| 새 탭의 지점·시간 선택 | 모의 신청 API | 서버가 신청과 내부 전환 기록을 함께 저장 | 마지막 신청 요청 전체 |

## 2. 폴더와 파일 책임

`[확정 · 기획서 3, 11장]` `frontend`와 `backend`를 분리하고 SDK는 `frontend/src/sdk/captchavatye`에 둔다. 설계 시 확인한 Mac 대상 폴더는 존재하지 않았고, 해당 경로와 상위 경로에 적용할 `AGENTS.md`도 없었다. 아래 구조를 실제로 생성하는 작업은 다음 구현 단계다.

### 2.1 프로젝트와 프론트엔드

| 경로 | 책임 |
| --- | --- |
| `DESIGN.md` | 현재 설계와 계약의 기준 |
| `README.md` | 구현 후 실행·초기화 방법, 소재 실측값의 위치, V01~V08 실제 확인 결과 기록 |
| `frontend/package.json`, `package-lock.json` | 프론트엔드 의존성과 실행 명령, 설치 버전 고정 |
| `frontend/index.html` | React가 마운트될 문서 |
| `frontend/vite.config.ts` | 프론트엔드 5173 포트와 `/api` 프록시 |
| `frontend/tsconfig*.json` | Vite React + TypeScript 기본 타입 검사 설정 |
| `frontend/src/main.tsx` | React 진입점 |
| `frontend/src/App.tsx` | `/`와 `/demo/test-drive` 화면 선택 |
| `frontend/src/pages/DemoCommunityPage.tsx` | 작성 내용·모달 표시·10P·적용 ID Set·글 등록 여부·새 글 시도 소유 |
| `frontend/src/pages/TestDrivePage.tsx` | URL의 `clickId`, 선택지, 신청 스냅샷·요청·오류·완료 결과, `landing_viewed` 전송 |
| `frontend/src/demo/testDriveOptions.ts` | 두 지점·두 시간의 시연 선택지와 표시 이름 |
| `frontend/src/sdk/captchavatye/index.ts` | `CaptchaModal`과 외부 공개 입력·결과 타입만 내보내는 SDK 진입점 |
| `frontend/src/sdk/captchavatye/CaptchaModal.tsx` | 모달 틀, 광고 표시, 안내, 닫기·계속하기·CTA, 완료 화면의 최초 노출 통지 |
| `frontend/src/sdk/captchavatye/CarPuzzle.tsx` | 이미지 로딩·레이어·좌표·포인터·스냅·줌아웃, 준비·드롭·연출 완료를 흐름 훅에 통지 |
| `frontend/src/sdk/captchavatye/useCaptchaFlow.ts` | 인증 요청·진행 상태·재시도·닫기/재열기·늦은 응답 차단·완료 콜백 한 번 전달 |
| `frontend/src/sdk/captchavatye/api.ts` | SDK의 시작·검증·이벤트 HTTP 요청, 오류 정규화, 취소·기한·이벤트 재전송 |
| `frontend/src/sdk/captchavatye/types.ts` | SDK 입력·완료 결과·소재·진행 상태·시작/검증/이벤트 계약 타입 |
| `frontend/src/sdk/captchavatye/captcha.css` | 고정 모달, 16:9 광고 창, 오버레이, 연출 스타일 |
| `frontend/public/creatives/bmw-m3/vehicle.webp` | 정상 램프가 포함된 차량 전체 원본 |
| `frontend/public/creatives/bmw-m3/socket-cover.png` | 원본의 램프를 빈 소켓처럼 가리는 커버 |
| `frontend/public/creatives/bmw-m3/lamp.png` | 같은 원본에서 분리한 투명 램프 조각 |

`[가정]` `App.tsx`는 경로 두 개를 직접 선택한다. 모의 신청의 HTTP 호출·작은 오류 처리는 `TestDrivePage.tsx` 안에서 수행하며 SDK 내부 상태를 가져오지 않는다. 별도 라우팅·전역 상태·드래그·애니메이션 라이브러리나 SDK 패키지 배포는 필요하지 않다. 커뮤니티는 SDK 공개 진입점만 사용한다.

### 2.2 백엔드

| 경로 | 책임 |
| --- | --- |
| `backend/pyproject.toml` | Python 의존성·프로젝트 설정. 구현 때 확인한 설치 버전을 기록 |
| `backend/app/main.py` | FastAPI 앱, 하나의 Store 생성·주입, `/api` 라우터 연결 |
| `backend/app/api/routes/captcha.py` | 시작·검증의 두 HTTP 진입점과 상태 코드 변환 |
| `backend/app/api/routes/events.py` | 이벤트 접수의 HTTP 진입점 |
| `backend/app/api/routes/demo.py` | 모의 신청의 HTTP 진입점 |
| `backend/app/schemas/captcha.py` | 시작·검증·소재 요청/응답 스키마와 좌표 검증 |
| `backend/app/schemas/events.py` | 허용된 세 클라이언트 이벤트와 시각·응답 스키마 |
| `backend/app/schemas/demo.py` | 허용된 지점·시간, 신청 요청/응답 스키마 |
| `backend/app/services/captcha.py` | 소재 선택, 인증 생성, 위치 판정, 기존 성공 결과 재사용 |
| `backend/app/services/events.py` | 이벤트 내용 비교·중복 제거·클릭 연결 확인 |
| `backend/app/services/demo.py` | 신청 중복·충돌 판단, 신청과 서버 전환 이벤트 저장 |
| `backend/app/store.py` | 네 메모리 맵·공통 잠금·내부 레코드 타입. 도메인 처리 순서는 각 서비스가 소유 |
| `backend/app/demo_config.py` | 고정 소재·이미지 크기·두 Rect·허용 오차·문구·연출 시간·시연 선택지 |

Python 패키지 디렉터리에 필요한 `__init__.py`는 패키지 표시만 담당한다. 요청 모델 검증은 schemas, 업무 규칙은 services, HTTP 상태 코드는 routes로 나눈다. 프론트엔드 선택지와 서버 허용 목록의 일치는 구현 검증 항목으로 둔다.

## 3. SDK 계약과 상태 수명

### 3.1 공개 입력과 콜백

`[확정 · 기획서 4장]`

| 항목 | 형식과 계약 |
| --- | --- |
| `open` | boolean. 모달 표시 여부이며 진행 상태와 독립 |
| `creativeId` | string. 이번 값은 `bmw-m3-v1` |
| `apiBaseUrl` | string, 기본값 `/api` |
| `onComplete(result)` | `{challengeId, completionId, creativeId, clickId}`를 연출 완료 후 한 번 전달 |
| `onContinue()` | `completed`에서만 호출. 호스트가 게시글 등록을 한 번 처리하고 닫음 |
| `onClose()` | 호스트가 `open=false`로 변경. 작성 내용·인증 상태 보존. 글 등록을 실행하지 않음 |

같은 글 시도에서 SDK를 계속 마운트하고 `open`만 바꾼다. 닫을 때 SDK를 조건부 제거하지 않는다. 첫 열기 전에는 시작 API를 호출하지 않는다.

`[가정]` 커뮤니티 내부의 글 시도 번호를 React `key`로 사용한다. 글 등록을 마친 뒤 새 글을 시작할 때만 번호를 바꿔 SDK를 초기화한다. `attemptId`나 `reset`을 SDK 공개 입력·서버 필드에 추가하지 않는다. `creativeId`와 `apiBaseUrl`은 한 시도 동안 고정한다.

호스트의 `onComplete`는 동기적으로 `completionId`가 적용 Set에 있는지 확인한다. 처음이면 Set에 먼저 넣고 포인트를 10 늘린다. 콜백에서 서버 포인트 API를 부르지 않는다. `onContinue`는 별도의 글 등록 가드로 제목·본문을 한 번 반영한다. SDK의 중복 전달 방어와 호스트의 중복 적용 방어를 모두 유지하며, 닫기로 이미 지급한 포인트를 되돌리지 않는다.

### 3.2 진행 상태

`[확정]` 아래 일곱 상태명을 유지한다. 드래그 여부·요청 오류 종류·표시 여부는 보조 데이터이며 새로운 진행 상태로 만들지 않는다.

| 상태 | 실행과 허용 입력 | 다음 상태 |
| --- | --- | --- |
| `loading` | ID가 없으면 시작 요청. ID가 있으면 세 이미지 준비만 수행 | 모두 준비 → `challenge`; 실패 → `error` |
| `challenge` | 램프 드래그. 취소·이미지 밖 드롭은 조각 복귀 | 이미지 안의 유효 드롭 → `verifying` |
| `verifying` | 마지막 요청을 보관하고 추가 드래그 차단 | 정답 → `snapping`; 오배치 → 조각 복귀 후 `challenge`; 요청 실패 → `error` |
| `snapping` | 정답 위치로 조각 이동, 스냅 완료 후 커버·조각 숨김 | `revealing` |
| `revealing` | 동일 scene을 전체 구도로 전환하고 브랜드 표시 | 열린 상태에서 연출 완료 → `completed`, `onComplete` 전달 |
| `completed` | 전체 차량·포인트 완료 안내·CTA·계속하기. 재열기로 재보상하지 않음 | 계속하기 또는 닫기는 표시만 닫음 |
| `error` | 실패 작업과 재시도 안내 | 시작/이미지 재시도 → `loading`; 검증 재시도 → `verifying` |

오류에는 `failedOperation = start | assets | verify`와 해당 재시도 입력을 보관한다. HTTP 200의 `passed:false`는 통신 오류가 아니다. 404로 사라진 인증은 반복 검증으로 복구되지 않으므로 데모 초기화를 안내한다. 모의 신청 오류·이벤트 실패는 SDK를 `error`로 바꾸지 않는다.

### 3.3 닫기와 재열기

`[확정]` 닫기에는 포인터 해제, 진행 중 인증 요청의 취소 시도, 연출 타이머 제거, 비동기 실행의 무효화를 포함한다. 취소가 서버의 저장을 되돌린다고 가정하지 않는다.

| 닫을 당시 | 보관하는 데이터 | 재열기 처리 |
| --- | --- | --- |
| 시작 응답 전 | 글 시도·소재 입력. 아직 ID는 없음 | 시작 요청 재실행 |
| ID를 받은 뒤 이미지 준비 중 | `challengeId`, `creative` | 받은 설정으로 이미지 준비만 재실행 |
| `challenge` 또는 드래그 중 | ID·설정 | 조각 초기 위치에서 같은 인증 계속 |
| `verifying` 또는 검증 결과 불확실 | ID·마지막 `dropX/dropY` | 같은 요청을 다시 보내 서버 결과 확인 |
| `snapping`·`revealing` | 성공 결과·마지막 드롭, 콜백 미전달 | 재검증 없이 `snapping`부터 성공 연출 재실행 |
| `completed` | 성공 결과·콜백 전달 여부·최초 CTA 노출 정보 | 완성 화면 즉시 복원. 연출·포인트·노출을 추가하지 않음 |
| `error` | 실패 작업·요청 스냅샷 | 오류 화면 복원 후 해당 작업만 재시도 |

`[가정]` 중간 연출의 프레임 위치를 저장하지 않고 스냅부터 다시 실행한다. 정답 결과는 보존하면서 애니메이션 재생 위치 관리만 줄인다. 반면 이미 완료한 연출은 재생하지 않는다.

`[가정]` 시작 응답 유실로 ID를 받지 못했다면 새 시작 요청을 허용한다. 시작 API에 멱등 키·조회 기능이 없으므로 이전 `pending` 인증이 메모리에 남을 수 있다. 시작 API의 정확히 한 번 생성은 보장하지 않는다. ID를 받은 뒤의 재열기에는 이 예외를 적용하지 않는다.

### 3.4 늦은 응답과 콜백 방어

`[가정]` 훅은 내부 시도 식별값, 실행 세대 번호, 요청 순번, 연출 실행 번호를 보관한다. 닫기·새 시도·새 요청에서 해당 번호를 갱신한다. 응답 처리뿐 아니라 오류 처리와 `finally`도 캡처한 번호가 현재 값과 일치할 때만 상태를 바꾼다. 숨겨진 이전 실행의 응답은 무시하고, 필요한 서버 결과는 재열기 시 같은 검증 요청으로 확인한다.

연출 완료 함수는 현재 시도·연출 번호·진행 단계·`open`을 확인한다. 유효한 실행에서만 한 번 완료 처리하며 콜백 전달 가드를 호출 전에 세운다. 닫기 이벤트는 부모의 다음 렌더를 기다리지 않고 내부 실행을 먼저 무효화한다. 숨겨진 모달의 타이머나 늦은 `transitionend`가 포인트를 지급할 수 없게 하기 위함이다.

SDK 내부에 보관할 데이터는 `challengeId`, `creative`, 진행 상태, 마지막 검증 요청, 성공 결과, 실패 작업, 콜백 전달 여부, 최초 노출 이벤트, 위 실행 가드와 취소 핸들이다. 게시글·포인트·모의 신청 결과는 SDK가 소유하지 않는다.

## 4. 이미지와 좌표 설계

### 4.1 소재와 레이어

`[확정 · 기획서 5~6장]` 광고 영역은 16:9, 모달 너비 시작값은 720px이다. 작은 창에서는 가용 너비로 줄이고 조작 전후 모달 크기는 유지한다. 원본은 16:9 구도에 차량을 왼쪽, HTML 문구 공간을 오른쪽에 확보한다. 기획서의 두 콘셉트 화면을 각각 잘라 교체하는 방식으로 구현하지 않는다.

1. 광고 창은 크기를 고정하고 `overflow: hidden`으로 자른다.
2. 내부 `scene`에 `vehicle.webp`와 `socket-cover.png`를 함께 둔다. 커버의 위치·크기는 `lampRect`다.
3. `scene` 밖의 같은 광고 창 오버레이에 `lamp.png`를 둔다. 조각은 scene의 배율을 직접 상속하지 않고 원본 좌표에 맞는 화면 크기를 계산한다.
4. 브랜드 문구·CTA도 scene 밖의 HTML 오버레이다. CTA는 `completed`에서만 표시·활성화한다.

이미지에 padding·border·object-fit 빈 공간을 만들지 않는다. `lamp.png`의 캔버스 여백을 제거하고 커버·조각을 동일한 `lampRect` 비율에 맞춘다. 세 이미지를 모두 로드·디코드하고 원본의 실제 크기가 설정과 맞는지 확인한 뒤 드래그를 허용한다. 이미지 실패나 크기 불일치는 소재 준비 오류로 처리하고 인증·보상을 진행하지 않는다.

`[가정]` 조각의 초기 자리는 광고 창 하단 왼쪽으로 정하고 목표 영역과 겹치지 않도록 소재 준비 때 확정한다. 별도의 API 필드를 만들지 않고 `CarPuzzle` 내부 배치값으로 둔다.

### 4.2 원본 좌표와 확대 변환

전체 원본 너비·높이를 `Sw, Sh`, 광고 창의 CSS 픽셀 크기를 `W, H`로 둔다. `lampRect = (lx, ly, lw, lh)`와 `zoomRect = (zx, zy, zw, zh)`는 원본 전체에 대한 0~1 비율이며, x·y는 좌상단이다. 두 Rect는 양의 크기이고 원본 경계 안에 있어야 한다.

`[확정]` 확대 영역의 실제 픽셀 종횡비는 광고 창과 같아야 한다. 원본과 창이 모두 16:9인 이번 소재에서는 `zw = zh`다.

`[가정]` 기본 scene 크기는 `W × H`, `transform-origin`은 `0 0`으로 정한다. 다음 변환으로 확대 영역을 광고 창에 맞춘다.

```text
scale = 1 / zw = 1 / zh
translateX = -zx × W × scale
translateY = -zy × H × scale
scene transform = translate(translateX, translateY) scale(scale)
전체 공개 = translate(0, 0) scale(1)
```

커버는 변환 전 scene에서 `(lx×W, ly×H)`에 `(lw×W, lh×H)` 크기로 배치한다. 차량과 커버가 같은 부모 변환을 받아 계속 정렬된다. 드래그 중에는 scene의 위치·배율을 바꾸지 않는다.

### 4.3 드래그와 서버에 보낼 좌표

`[확정]` Pointer Events를 사용하고 `pointerdown`에서 잡은 위치의 오프셋·`pointerId`를 저장한 뒤 `setPointerCapture`로 같은 조작을 추적한다. `pointercancel`은 검증하지 않고 초기 위치로 돌린다. 포인터 캡처와 취소 동작의 근거는 [MDN Pointer events](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events)다.

`[가정]` 한 번에 포인터 하나만 처리한다. 조각 위치는 ref에 보관하고 실제 transform에 반영한다. `pointerup`의 마지막 위치까지 반영한 뒤 경계를 읽어 React의 다음 렌더를 기다리는 이전 프레임 좌표를 보내지 않는다. 브라우저 기본 이미지 끌기를 끄고, 조작 중 창 크기가 바뀌면 드래그를 취소한 뒤 새 크기로 재배치한다.

드롭 순간의 `imageRect`는 **확대된 전체 원본 이미지**의 `getBoundingClientRect()`다. `pieceRect`는 조각의 경계다. 광고 창의 잘린 경계나 커서 위치를 판정 기준으로 사용하지 않는다.

```text
pieceCenterX = pieceRect.left + pieceRect.width / 2
pieceCenterY = pieceRect.top  + pieceRect.height / 2
dropX = (pieceCenterX - imageRect.left) / imageRect.width
dropY = (pieceCenterY - imageRect.top)  / imageRect.height
```

두 값이 유한하고 `[0, 1]` 안일 때만 마지막 검증 요청을 저장하고 서버로 전송한다. 범위 밖은 값을 0이나 1로 보정하지 않고 로컬 오배치로 복귀한다. 좌표는 반올림하지 않으며 모두 CSS 픽셀끼리 계산하므로 기기 픽셀 배율을 별도로 곱하지 않는다. 경계가 뷰포트 기준이고 padding·border를 포함한다는 점은 [MDN getBoundingClientRect](https://developer.mozilla.org/en-US/docs/Web/API/Element/getBoundingClientRect)를 따른다.

목표 중심과 조각 화면 크기도 같은 `imageRect`를 사용한다.

```text
targetX = imageRect.left + imageRect.width  × (lx + lw / 2)
targetY = imageRect.top  + imageRect.height × (ly + lh / 2)
pieceWidth  = imageRect.width  × lw
pieceHeight = imageRect.height × lh
```

조각을 오버레이 안에 배치할 때만 오버레이의 화면 좌상단을 빼고, 중심에서 조각 반너비·반높이를 뺀다. 클릭한 위치와 관계없이 조각 중심이 목표에 맞아야 정답이다.

### 4.4 스냅과 줌아웃

`[확정]` `passed:true`와 두 완료 ID를 먼저 저장한 뒤 `snapping`으로 이동한다. 목표점으로 180ms 스냅 → 커버·조각 숨김 → 원본의 정상 램프 노출 → 동일 scene을 650ms 줌아웃 → 연출 완료 순서다. 두 시간은 조정 가능한 초기 작업값이다.

`transitionend`는 해당 단계 요소의 `transform`만 확인한다. 자식에서 올라온 이벤트·다른 속성·이전 실행은 무시한다. 종료 이벤트와 우회 타이머는 같은 완료 가드를 통과한다. 전환 시간이 0이거나 취소되면 종료 이벤트가 발생하지 않을 수 있다. [MDN transitionend](https://developer.mozilla.org/en-US/docs/Web/API/Element/transitionend_event)

`[가정]` 우회 타이머는 해당 단계 시간 + 100ms에 최종 transform을 확정한 뒤 완료를 시도한다. 0ms 전환은 최종 스타일을 반영한 다음 완료한다. 이 여유 시간은 시연용 값이며 성능 측정값이 아니다. 닫힌 실행의 타이머는 폐기한다. 연출 중 리사이즈는 기존 실행을 무효화하고, 열린 상태이면 새 크기에서 스냅부터 재시작한다.

### 4.5 소재 준비 단계에서 확정할 값

`[확정]` 현재 첨부에는 콘셉트 시안이 있고 최종 세 이미지의 실측 좌표는 없다. 아래 값은 첫 연출 단계에서 측정해 `demo_config.py`에 기록한다. 요청 예시의 `0.52, 0.47`을 실제 정답으로 사용하지 않는다.

| 값 | 정하는 방법과 통과 기준 |
| --- | --- |
| `sourceWidth/sourceHeight` | 최종 `vehicle.webp` 실제 픽셀 크기. 16:9 원본과 설정이 일치 |
| `lampRect` | 커버·조각의 공통 픽셀 사각형을 측정해 x·width는 `Sw`, y·height는 `Sh`로 나눔 |
| `zoomRect` | 램프와 조각의 초기 자리를 확보하는 정사각 비율 영역 `zw=zh`를 정함. 램프가 보이고 Rect 전체가 원본 안에 있음 |
| `toleranceX/Y` | 허용할 원본 픽셀 오차를 X/Y별로 정하고 각각 `Sw/Sh`로 나눔. 경계 안·밖 검증 후 고정 |
| 조각 초기 위치·연출 시간 | 목표와 겹치지 않고 창을 줄여도 조작 가능. 동일 모달 크기에서 스냅 후 자연스럽게 공개 |

`[가정]` 별도의 소재 편집 도구나 좌표 편집 화면은 만들지 않는다. 실제 소재에서 값을 측정하고 설정 파일에 기록하면 이 PoC에는 충분하다.

## 5. 네 API의 계약과 처리 순서

### 5.1 공통 규칙

`[확정 · 기획서 6~9, 12장]` JSON 요청·응답의 필드는 camelCase다. 요청 스키마 검증을 먼저 수행한다. 업무 오류는 `{"detail":{"code":"…","message":"…"}}`, FastAPI의 입력 검증 422는 기본 `detail` 배열을 유지한다. SDK의 `api.ts`와 모의 신청 화면은 두 오류 형식을 구분해 표시한다.

`[가정]` ID는 비어 있지 않은 문자열로 받으며 아래 예시 접두사는 설명·로그 구분용이다. 좌표는 문자열·boolean이 아닌 유한한 숫자만 받는다. `occurredAt`은 시간대가 있는 ISO 8601 문자열로 검증하고 원문 문자열을 보존한다. 업무 HTTP 요청 제한 시간은 우선 10초로 두며, 시간 초과·연결 실패·5xx는 결과가 불확실할 수 있는 요청 실패다. 성공 JSON이 계약과 다르면 성공 처리하지 않는다.

### 5.2 인증 시작 `POST /api/challenges`

**요청:** `{"creativeId":"bmw-m3-v1"}`  
**성공:** HTTP 201, `{challengeId: string, creative: Creative}`

| Creative 필드 | 형식·값 |
| --- | --- |
| `creativeId`, `version` | `"bmw-m3-v1"`, `"1"` |
| `imageUrl` | `/creatives/bmw-m3/vehicle.webp` |
| `coverUrl` | `/creatives/bmw-m3/socket-cover.png` |
| `pieceUrl` | `/creatives/bmw-m3/lamp.png` |
| `sourceWidth`, `sourceHeight` | 실제 원본 크기의 양의 정수 |
| `lampRect`, `zoomRect` | `{x, y, width, height}`. 4절의 원본 정규화 좌표 |
| `brandTitle`, `tagline` | `BMW M3`, `Sheer Driving Pleasure` |
| `ctaLabel`, `landingPath` | `시승 신청`, `/demo/test-drive` |
| `snapMs`, `revealMs` | 초기 180, 650 |

허용 오차 `toleranceX/Y`는 응답에 포함하지 않고 서버 설정에 둔다. 반환하는 Rect는 그리기용 설정이며 이 API를 실제 봇 방어 수단으로 해석하지 않는다.

**서버 순서:** 요청 검증 → 허용 소재 확인 → 공통 잠금 안에서 임의 `challengeId` 생성·충돌 확인·`pending` 레코드와 생성 시각 저장 → 잠금 해제 후 공개 설정과 ID를 201로 반환한다. 소재 설정은 한 서버 실행 중 고정한다.

**오류:** 없는 소재는 404 `CREATIVE_NOT_FOUND`, 누락·잘못된 형식은 422. 시작 응답을 받은 뒤 이미지 실패는 동일 ID의 이미지 준비만 재시도한다. ID를 못 받은 응답 유실은 3.3절의 시작 재시도 예외를 적용한다.

### 5.3 위치 검증 `POST /api/verify`

**요청:** `{"challengeId":"ch_demo_01","dropX":0.52,"dropY":0.47}`. 숫자는 형식 예시다.

| 경우 | 응답 |
| --- | --- |
| 정상 오배치 | HTTP 200, `{"passed":false}` |
| 첫 정답·이미 성공한 인증 | HTTP 200, `{"passed":true,"completionId":"cmp_demo_01","clickId":"clk_demo_01"}` |

**서버 순서:**

1. 좌표가 유한하고 `0 ≤ dropX, dropY ≤ 1`인지 스키마에서 검증한다.
2. 공통 잠금 안에서 인증을 찾는다. 없으면 404. 이미 `passed`이면 좌표를 다시 판정하지 않고 기존 두 ID를 반환한다.
3. `targetX = lampRect.x + lampRect.width/2`, Y도 같은 방식으로 계산한다. `abs(dropX-targetX) ≤ toleranceX`와 Y 조건을 **둘 다** 만족해야 정답이다.
4. 오배치는 `pending`을 유지하고 `passed:false`를 반환한다. 첫 정답이면 `completionId`, `clickId`를 만들고 `passed` 상태와 `clickLinks` 연결을 같은 잠금 안에서 저장한다.
5. 저장한 결과를 복사해 잠금을 해제하고 200으로 반환한다. 응답보다 성공 기록이 먼저 존재해야 한다.

**오류:** 없는 인증은 404, 잘못된 입력은 422다. `[가정]` 인증 없음의 코드 문자열은 공통 NOT_FOUND 규칙에 맞춰 `CHALLENGE_NOT_FOUND`로 정한다. 이미 성공한 인증에도 입력 검증은 적용하므로 잘못된 좌표는 422, 유효한 다른 좌표는 기존 성공 응답이다.

**클라이언트 실패 처리:** 통신 실패를 오배치로 표시하지 않는다. 마지막 `{challengeId, dropX, dropY}`를 그대로 재전송한다. 재시도 중 새 드래그로 요청 내용을 바꾸지 않는다.

### 5.4 이벤트 수집 `POST /api/events`

**요청:** `{"eventId":"ev_demo_01","eventName":"cta_clicked","clickId":"clk_demo_01","occurredAt":"2026-10-25T00:00:00Z"}`

허용 이름은 `cta_shown`, `cta_clicked`, `landing_viewed`뿐이다. `test_drive_requested`는 클라이언트 요청에서 422로 거절한다.

| 경우 | 응답 |
| --- | --- |
| 새 이벤트 | HTTP 201, `{"accepted":true,"duplicate":false}` |
| 같은 ID·같은 내용 재전송 | HTTP 200, `{"accepted":true,"duplicate":true}` |
| 같은 ID·다른 내용 | HTTP 409, `EVENT_ID_CONFLICT` |

`[가정]` 중복 응답에도 `accepted:true`를 유지한다. 같은 내용은 `eventName`, `clickId`, **보존한 `occurredAt` 문자열**이 모두 같은 경우다. 필드 순서는 상관없고 `receivedAt`은 비교하지 않는다. 동일한 시각이라도 다른 문자열로 재작성하지 않고 재시도에서 최초 요청을 그대로 사용한다.

**서버 순서:** 스키마 검증 → 잠금 획득 → 기존 `eventId`가 있으면 내용 비교 후 중복 또는 409 → 새 ID라면 `clickLinks` 존재 확인 → 서버 `receivedAt`을 붙여 한 번 저장 → 잠금 해제 후 201이다. 중복 수신으로 최초 `receivedAt`을 바꾸지 않는다.

**오류:** `[가정]` 새 이벤트의 없는 연결은 404 `CLICK_NOT_FOUND`, 잘못된 이벤트 이름·시각·필수 필드는 422로 처리한다. 스키마가 유효한 기존 ID의 다른 내용은 연결 조회보다 먼저 409로 판정한다.

이 API는 인증 성공·포인트·신청 완료를 만들지 않는다. 로그 전송 실패는 사용자 업무를 실패로 바꾸지 않는다.

### 5.5 모의 신청 `POST /api/demo/test-drives`

**요청:** `{"clickId":"clk_demo_01","locationId":"demo-center-a","slotId":"demo-slot-1"}`

허용 지점은 `demo-center-a`(시연 전시장 A), `demo-center-b`(시연 전시장 B), 허용 시간은 `demo-slot-1`(시연 시간 1), `demo-slot-2`(시연 시간 2)다. 네 조합을 모두 허용한다.

**성공 응답:** `{"leadId":"lead_demo_01","clickId":"clk_demo_01","locationId":"demo-center-a","slotId":"demo-slot-1","status":"completed","isDemo":true}`

| 경우 | HTTP·결과 |
| --- | --- |
| 해당 연결의 첫 신청 | 201, 새 결과 |
| 같은 `clickId`·같은 지점/시간 | 200, 기존 `leadId`와 기존 결과 |
| 같은 `clickId`·다른 유효 지점/시간 | 409 `LEAD_CONFLICT`, 기존 결과 보존 |
| 존재하지 않는 연결 | 404 `CLICK_NOT_FOUND` |
| 잘못된 선택지·형식 | 422, 신청 생성 없음 |

**서버 순서:**

1. 스키마와 고정 선택지를 검증한다.
2. 공통 잠금 안에서 `clickId → challengeId/completionId` 연결과 해당 인증의 `passed`를 확인한다. 클릭·랜딩 이벤트 수신 여부는 확인 조건에 넣지 않는다.
3. 기존 신청이 있으면 선택지를 비교해 200 또는 409를 반환한다.
4. 없으면 `leadId`와 완료 시각을 만들고 `leads[clickId]`와 내부 `test_drive_requested` 이벤트를 같은 임계 구역에서 한 번 저장한다.
5. 잠금을 해제하고 결과를 201로 반환한다. 중복 신청에서는 내부 전환 이벤트를 다시 만들지 않는다.

**새 탭 처리:** URL의 `clickId`가 없거나 빈 값이면 신청을 막고 광고 데모에서 다시 시작하도록 안내한다. 페이지에는 BMW M3, 두 선택 항목, 신청 버튼과 “시연용 페이지이며 실제 예약되지 않습니다”를 표시한다. 요청 중 버튼을 비활성화하고, 201 또는 200 성공 응답을 받은 뒤에만 완료 화면과 `leadId`를 표시한다.

`[가정]` 제출 순간 요청 전체를 고정한다. 응답 유실·5xx 동안에는 선택지를 잠시 고정하고 같은 내용으로 재시도하게 한다. 422처럼 처리되지 않았음이 확정되면 선택지를 수정할 수 있다. 409는 기존 신청이 있어 변경할 수 없다고 안내하며 성공 화면으로 꾸미지 않는다. 새로고침 뒤에는 React 상태가 사라지므로 선택지를 다시 입력해야 하고, 같은 내용으로 제출하면 서버의 기존 결과를 받는다. 신청 조회·수정 API나 브라우저 영속 저장은 추가하지 않는다.

## 6. 메모리 데이터와 중복 처리

### 6.1 저장 구조와 ID 관계

`[확정 · 기획서 7~10장]`

| 메모리 | 키 | 값과 불변식 |
| --- | --- | --- |
| `challenges` | `challengeId` | `creativeId`, `status: pending 또는 passed`, `createdAt`, 선택적 `completionId/clickId`. passed에서는 두 ID가 모두 존재 |
| `clickLinks` | `clickId` | `challengeId`, `completionId`. 최초 검증 성공에서 생성하고 해당 인증과 일치 |
| `events` | `eventId` | `eventName`, `clickId`, `occurredAt`, `receivedAt`. 기존 ID를 다른 내용으로 덮어쓰지 않음 |
| `leads` | `clickId` | `leadId`, `clickId`, `locationId`, `slotId`, `status: completed`, `isDemo: true`, `completedAt`. 연결당 최대 한 건 |

성공 인증 하나에는 `completionId` 하나와 `clickId` 하나가 있다. `clickId`에는 이벤트 여러 개와 신청 최대 한 개가 연결된다. `completionId`는 호스트 포인트 적용의 키, `clickId`는 CTA·랜딩·신청 연결의 키다. 둘을 대체해서 사용하지 않는다.

`[가정]` 서버 ID는 Python `secrets`로 임의 토큰을 만들고 `ch_`, `cmp_`, `clk_`, `lead_` 접두사를 붙인다. 클라이언트 새 행동의 `eventId`는 `crypto.randomUUID()` 기반으로 만든다. 생성 충돌은 저장 전에 확인한다. 재전송에는 기존 ID를 사용한다. 접두사 자체를 인증·권한 증거로 삼지 않는다.

`[가정]` 서버의 `test_drive_requested`도 `events`에 내부 레코드로 저장한다. 서버가 별도 이벤트 ID를 만들고 `occurredAt`과 `receivedAt`을 신청 완료 시각으로 둔다. 요청 스키마의 허용 이벤트는 여전히 세 개다. 서버 이벤트의 `clickId`로 `leads`와 `clickLinks`를 따라가면 `leadId`와 인증을 확인할 수 있어 별도 전환 저장소는 필요하지 않다.

### 6.2 잠금과 동시 요청

`[확정]` Store의 **공통 잠금 하나**가 중복 확인과 결과 저장을 함께 보호한다. 잠금 밖에서 “없음”을 확인한 다음 따로 저장하지 않는다. 한 워커라는 조건만으로 중복 요청이 사라진다고 가정하지 않는다.

`[가정]` 이번 서버는 동기 `def` 라우트·서비스와 `threading.Lock` 한 개를 사용한다. 동기 라우트는 FastAPI의 스레드풀에서 실행되므로 여러 요청이 같은 Store에 접근할 수 있다. 이 선택의 근거는 [FastAPI의 동기 경로 처리](https://fastapi.tiangolo.com/async/#path-operation-functions)와 [Python Lock](https://docs.python.org/3/library/threading.html#lock-objects)이다. GIL에 중복 방지를 맡기지 않는다.

| 처리 | 하나의 잠금 안에서 함께 할 일 | 동시 요청 결과 |
| --- | --- | --- |
| 시작 | ID 충돌 확인·pending 저장 | 요청별 별도 인증. 시작 응답 유실은 3.3절 제한 적용 |
| 검증 | 인증 조회·기존 성공 확인·판정·두 ID 생성·passed 저장·clickLinks 저장 | 정답 요청이 겹쳐도 완료 ID 쌍 하나 |
| 이벤트 | eventId 조회·내용 비교·연결 확인·새 이벤트 저장 | 동일 전송은 201 한 건, 나머지 200. 다른 내용은 409 |
| 신청 | 연결·기존 신청 확인·내용 비교·lead 및 내부 이벤트 저장 | 같은 선택은 201 한 건, 나머지 200. 다른 선택 중 뒤에 처리한 요청은 409 |

ID·레코드 생성과 저장 사이에 외부 요청·이미지 로딩·대기를 넣지 않는다. 중첩 서비스 호출로 같은 잠금을 다시 획득하지 않는다. 신청 서비스는 잠금을 가진 상태에서 내부 전환 레코드를 직접 함께 저장한다. 응답용 스냅샷을 만든 뒤 잠금을 해제하며 로그 출력은 밖에서 수행한다. 동시 오배치와 정답이 겹친 경우에는 잠금 획득 순서대로 처리하므로 정답 저장 전의 오배치는 false, 저장 후의 유효한 요청은 기존 true를 받는다.

### 6.3 이벤트 발생과 전송

| 이벤트 | 생성 시점 | 중복 처리 단위 |
| --- | --- | --- |
| `cta_shown` | 열린 `completed` 화면에 CTA가 실제 렌더된 최초 시점 | 같은 인증의 재열기에는 새 이벤트를 만들지 않음 |
| `cta_clicked` | 사용자가 CTA 링크를 활성화할 때 | 새로운 클릭은 새 eventId, 같은 clickId |
| `landing_viewed` | clickId가 있는 모의 신청 화면을 준비했을 때 | 새 페이지 로드·새로고침은 새 eventId, 같은 clickId |
| `test_drive_requested` | 서버가 최초 모의 신청 결과를 저장할 때 | clickId당 한 번, 서버만 생성 |

`[확정]` CTA는 `landingPath`에 `clickId`를 쿼리로 붙인 실제 새 탭 링크다. 예: `/demo/test-drive?clickId=clk_demo_01`. 새 탭 안내를 표시하고 사용자 클릭에 직접 연결한다. 이벤트 응답을 기다린 뒤 `window.open`을 부르지 않는다. 새 탭은 URL과 서버만 사용하며 원래 탭의 React 상태·`window.opener`에 의존하지 않는다.

`[가정]` 링크에 `target="_blank"`, `rel="noopener noreferrer"`를 사용한다. 이벤트 핸들러는 링크 기본 동작을 취소하지 않고 전송만 시작한다. 이벤트 자동 재시도는 연결 실패·시간 초과·5xx에 한해 최초 전송 뒤 최대 두 번, 500ms·1500ms 간격으로 실행한다. 4xx는 재시도하지 않는다. 횟수·간격은 시연용 작업값이다.

재시도는 최초 `eventId`·내용·`occurredAt`을 그대로 사용한다. 메모리에서만 보관하며 페이지 종료를 넘어 전송을 보장하지 않는다. 모달을 닫아도 이미 생성한 이벤트 전송은 인증 UI를 변경하지 않고 유한한 재시도 후 끝난다. 수집기 상태·전송용 버튼을 사용자 화면에 추가하지 않는다.

클릭 이벤트보다 랜딩·신청이 먼저 도착해도 미리 저장한 `clickLinks`로 처리한다. 이벤트 시각·도착 순서를 업무 상태의 순서로 사용하지 않는다.

### 6.4 보존 범위와 기록 확인

`[확정]` 한 서버 실행·한 워커에서만 메모리가 유지된다. 워커별 메모리는 일반적으로 공유되지 않으므로 `--workers 1`로 실행한다. [FastAPI 프로세스와 메모리](https://fastapi.tiangolo.com/deployment/concepts/#memory-per-process)

`[가정]` 이 짧은 로컬 시연에서는 만료·청소 워커를 두지 않는다. 글 등록이나 모달 닫기를 이유로 서버 인증·연결·신청을 삭제하지 않고 서버 재시작 때 함께 초기화한다. 이미 열린 시승 탭이 나중에 신청할 수 있어야 하기 때문이다.

커뮤니티의 글·포인트·적용 Set은 페이지 메모리만 사용한다. 새로고침 후 복원하지 않는다. 서버 재시작 후 남아 있는 탭은 오래된 ID로 404가 날 수 있으므로 탭을 초기화하고 처음부터 시연한다. 완료 상태를 이미 가진 UI가 서버 재시작을 자동 감지한다고 가정하지 않는다.

서버 로그에는 최초 인증 성공의 `challengeId/completionId/clickId`, 수신 이벤트의 `eventId/eventName/clickId`, 최초 신청의 `challengeId/clickId/leadId`를 구분해 남긴다. 중복 응답은 신규 성공 건수로 집계하지 않는다. 로그와 메모리 연결 확인으로 검증하고 추가 조회 API·대시보드를 만들지 않는다.

### 6.5 지표의 정의

`[확정]` 수신한 `cta_shown`의 고유 clickId 집합을 S, `cta_clicked`를 C, `leads`의 키를 L로 둔다.

| 지표 | 계산 |
| --- | --- |
| CTA 관측 클릭률 | S와 C의 교집합 원소 수 / S의 원소 수 |
| 관측 클릭 후 신청 완료율 | C와 L의 교집합 원소 수 / C의 원소 수 |
| 모의 신청 완료 수 | 고유 `leadId` 수 |

분모가 0이면 비율을 표시하지 않는다. clickId 발급은 노출·클릭이 아니며, 누락된 클릭 이벤트를 신청 결과로 보충해 클릭률 분자에 넣지 않는다. 서버 신청 완료 수는 이벤트 누락과 별도로 확인한다. 개발자 시연 기록으로 실제 봇 차단율·실제 시승 전환·광고 효과 개선을 주장하지 않는다.

## 7. 구현 순서와 검증 계획

### 7.1 단계별 산출물

`[확정 · 기획서 11~13장]` 현재는 설계 작성까지다. 아래 순서는 구현을 시작할 때 적용하며, 임시 성공 버튼을 실제 검증보다 먼저 만들어 연출을 확인한다.

| 단계 | 산출물 | 다음 단계로 넘어갈 기준 |
| --- | --- | --- |
| 0. 실행 뼈대 | Vite React + TypeScript 기본 프로젝트와 진입점 | `index.html → main.tsx → App.tsx` 기본 화면 실행 |
| 1. 광고 연출 | 세 이미지, 측정한 소재 설정, `CarPuzzle`, `CaptchaModal`, CSS. App에서 임시 모달·성공 버튼 연결 | 같은 크기 모달에서 램프 스냅 → 같은 차량 전체 공개 → 브랜드·CTA 표시. 두 창 크기에서 정렬 확인 |
| 2. 드래그와 검증 | SDK 타입·API·흐름 훅, FastAPI 시작/검증 경로·스키마·서비스·Store | 조각 중심 좌표를 전송하고 서버 true 이후에만 연출. 오배치·통신 실패 구분. 임시 성공 버튼 제거 |
| 3. 고객사 연결 | 커뮤니티 글쓰기·SDK 공개 입력·콜백·적용 Set·등록 가드 | 닫기/재열기 시 글 유지, 10P 한 번, 계속하기 한 번. CTA 없이도 완료 |
| 4. 모의 전환 | 이벤트·신청 API, `TestDrivePage`, 시연 선택지, 새 탭 CTA, 서버 내부 전환 기록 | 이벤트 순서·누락과 무관하게 신청 가능. 동일 ID 재시도 결과 유지, 다른 내용은 충돌 |
| 5. 재현과 기록 | README의 실행·초기화·소재 측정 위치·브라우저/창 크기·실제 검증 결과 | V01~V08을 직접 확인하고 두 번째 시연도 처음부터 재현 |

단계 1의 임시 성공 버튼은 시각 연출 검사용이다. 서버 검증·포인트·전환이 검증됐다는 근거로 사용하지 않는다. 실제 서버를 연결한 뒤 시연 화면에서 제거한다.

### 7.2 필수 검증 시나리오

아래는 **미실행 검증 계획**이다. 구현 후 실제 확인 날짜와 결과를 기록하기 전에는 통과로 표시하지 않는다. 브라우저 조작으로 화면·좌표·수명을 확인하고, 직접 HTTP 요청으로 API 계약·동시성을 확인한다.

| ID | 재현 방법 | 확인할 결과 |
| --- | --- | --- |
| V01 | 글 작성 → 정답 → 연출 완료 → 계속하기. 완료 콜백·계속하기를 중복 전달하는 경우도 확인 | 서버 true 전에 연출·보상 없음. 완료 후 10P 한 번·글 등록 한 번 |
| V02 | 정상 오배치, 이미지 밖 드롭, `pointercancel`, 드래그 중 리사이즈. 조각 가장자리/중심을 잡아 같은 위치에 배치 | 취소·범위 밖은 검증 요청 없음. 오배치는 false 후 복귀. 잡은 위치와 무관하게 같은 중심 좌표 |
| V03 | 서버 성공 후 응답만 버리고 같은 검증을 재전송. 같은 인증의 정답 요청 두 개도 동시에 전송 | 같은 completionId·clickId. passed 인증에 다른 유효 좌표도 기존 성공. 완료 ID 쌍은 하나 |
| V04 | 시작·이미지 로딩·검증·스냅·줌아웃 각 시점에서 닫고 재열기. 이전 실행 응답·타이머를 늦게 전달 | 글 유지, 숨김 중 콜백 없음. 받은 ID 재사용, 불확실한 검증은 같은 요청 재전송. 오래된 실행이 현재 화면을 덮지 않음 |
| V05 | CTA 없이 계속하기. 별도 시도에서는 CTA로 새 탭 이동 후 원래 탭 복귀·재열기 | 미참여해도 포인트·글 등록 가능. 복귀 시 완료 상태·기존 포인트 유지. CTA 노출 중복 없음 |
| V06 | 클릭 이벤트를 지연/실패시키고 랜딩·신청 먼저 실행. 이벤트 API 전체가 실패하는 경우도 확인 | 신청 가능, lead와 서버 전환 기록 각 하나. 원래 탭 업무 영향 없음 |
| V07 | 동일 이벤트·동일 신청의 순차/동시 재전송. 같은 eventId의 다른 내용, 같은 clickId의 다른 유효 선택도 전송 | 신규 201 한 번, 동일 재전송 200. 다른 내용 409, 기존 데이터 불변. lead·전환 이벤트 증가 없음 |
| V08 | 서버 재시작 뒤 남은 ID로 검증·신청. 이후 탭을 초기화해 재시연 | 오래된 ID는 404 안내. 탭 초기화 뒤 처음부터 정상 진행 |

API 경계 검증은 실제 소재의 정답 중심과 허용 오차에서 계산한다. X/Y 각각 경계 **안·정확히 경계·밖**, NaN/무한대·범위 밖·누락·잘못된 타입, 존재하지 않는 ID, 금지된 `test_drive_requested` 클라이언트 전송, 잘못된 지점·시간을 확인한다. 브라우저 화면 크기를 바꿔도 동일 원본 위치는 같은 정규화 좌표가 나와야 한다.

새 탭 링크가 이벤트 응답을 기다리지 않는지, CTA 누르기 전에도 clickLinks가 존재하는지, 원래 글 등록 후에도 이미 열린 시승 탭에서 신청할 수 있는지 확인한다. 애니메이션은 정상 종료뿐 아니라 0ms·종료 이벤트 누락 우회·닫기로 무효화된 타이머를 확인한다.

### 7.3 실행과 초기화 기준

`[확정]` 프론트엔드 5173, 백엔드 8000을 사용한다. Vite의 `/api`를 `http://127.0.0.1:8000`으로 프록시한다. 이미지와 `/demo/test-drive`는 프론트엔드가 제공한다. 별도 도메인·CORS 구성·인프라를 추가할 필요가 없다.

```text
backend 디렉터리:
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1

frontend 디렉터리:
npm run dev
```

발표 중에는 백엔드 자동 재시작 옵션을 사용하지 않는다. 처음부터 재시연할 때는 백엔드를 재시작하고 커뮤니티·시승 탭을 함께 초기화한다. 구현한 버전과 실행 결과는 README에 기록한다.

**첫 구현 작업:** Vite 기본 화면을 띄운 뒤 최종 세 이미지·좌표를 준비하고 `CarPuzzle`·`CaptchaModal`에서 임시 성공 버튼으로 스냅과 줌아웃을 확인한다. 실제 검증·보상·모의 신청 연결은 그 다음이다.
