# React SDK 0.1.0 설치 검증

## 확인 범위

`ca04d17` 이후 `packages/react`로 SDK를 분리했다. API·상태·ID 계약은 유지하고 포인트 UI만 제거했다. 보상은 기존 커뮤니티 hook이 처리한다. `assetBaseUrl`, `landingBaseUrl`, `continueLabel`을 추가하고 CSS를 SDK 모달 안으로 한정했다. React는 외부 peer dependency다.

SDK의 npm 공개, PostgreSQL 도입, 실제 회의실 예약 서비스 변경은 수행하지 않았다. 별도 소비 앱은 인증 UI 설치를 검증하는 예시이며 예약 권한을 부여하지 않는다.

## 실제 결과

| 검사 | 결과 |
| --- | --- |
| 기존 프런트엔드 + URL 검증 | 53/53 |
| 백엔드 회귀 | 152/152 |
| tarball 설치본 브라우저 | 5/5 |
| 기존 데모 인증·글 등록 최종 재실행 | 12/12 |
| 기존 시승·이벤트 흐름 | 16/16 |
| React 호스트 경계 | 6/6 |
| 독립 앱 strict 타입 검사·production build | 통과 |
| 빈 설치 폴더의 npm ci·build·test·lint | 통과 |
| React 중복·소스 symlink·출판 내용 검사 | 통과 |

브라우저 성공 기록의 pageErrors는 모두 비어 있다. 검사 환경은 Mac Chrome headless, 1280×900와 390×844다. 실제 모바일 기기와 Safari는 사용하지 않았다.

## 발견과 재검증

URL 기준 주소 4개, 패키지 부재, 모달의 고정 10P에 대한 실패를 먼저 확인했다. 구현 후 테스트와 UI 검증을 통과했다.

처음 설치한 앱에서는 호스트 `h2 { color: ... }`가 모달 제목에 적용됐다. 루트 상속만으로 막을 수 없는 직접 색상 선언이 원인이었고, SDK 내부 제목·본문에 상속을 명시한 뒤 새 tarball 설치본에서 확인했다. 같은 최초 실행의 소재/랜딩 실패는 5173 개발 서버 중단에서 발생했으며 서버를 복구하고 전체를 재실행했다. [최초 설치본 결과](consumer-red.json)를 남겼다.

기존 모바일 동작 줄이기 시나리오는 첫 실행에서 드래그 후 완료를 기다리다가 1회 timeout이 발생했다. 오류 캡처에는 헤더 텍스트 선택이 보였다. 별도 좌표·hit-test·pointerdown 진단 4회는 모두 정상 위치에서 요청하고 완료했으며, **제품 코드와 검증 조건을 수정하지 않은** 전체 12개 재실행도 통과했다. 이 현상의 원인은 확정하지 않았고 첫 실행 로그와 [진단 결과](mobile-diagnostics.json)를 보존했다. 지속적인 결함이 없다고 단정하지 않는다.

## 재현

루트에서 `npm ci`, `npm run build`, `npm test`, `npm run lint`, `npm run pack:sdk`, `npm run verify:package`를 실행한다.

`node scripts/verify-sdk-install.mjs`는 루트 workspace 밖에 소비 앱을 만들고 실제 `.tgz`를 설치한다. `--offline`은 캐시가 준비된 환경에 한해 사용한다. 출력된 `CONSUMER` 경로에서 `npm run preview`를 실행하면 5190 포트를 사용한다.

API 8000과 소재/랜딩 5173이 실행 중인 상태에서 Playwright 모듈 경로를 `CAPTCHAVATYE_PLAYWRIGHT_MODULE`에 지정하고 `node scripts/verify-sdk-consumer.cjs`를 실행한다. `node scripts/verify-demo-regression.cjs`는 예전 검증 파일을 복사해 현재 문구와 클래스 이름만 맞춘 후 실행한다. 과거 결과는 덮어쓰지 않는다.

## 근거와 검토

[checks.json](checks.json)은 소스와 설치 파일의 SHA-256을 기록한다. [설치 결과](install-results.json), [clean 설치](clean-install.json), [소비 앱](consumer-results.json), [데모 회귀](regression-results.json), [시승](conversion-results.json), [호스트](host-results.json)에서 실행 내용을 확인할 수 있다. 생성된 tarball은 Git에 넣지 않으며 `npm run pack:sdk`로 다시 만든다.

검토는 실행자가 소스 차이·공개 계약·빌드 산출물·실행 결과를 대조하는 방식으로 했다. 별도의 독립 검토자가 있었다고 주장하지 않는다. 새 SDK props를 제외한 인증 흐름·좌표·연출 종료·분석 전송의 핵심 구현, 백엔드와 소재를 보존했다.
