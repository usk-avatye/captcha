# CAPTCHAvatye 기술 설계

드래그 퍼즐로 광고 제품을 조작하고, 인증을 마친 뒤 원래 서비스의 작업을 이어가는 React SDK다. 인증 판정은 서버가, 화면 연출과 결과 전달은 SDK가, 예약과 보상 같은 업무 처리는 고객사 서비스가 담당한다.

## 구성

| 경로 | 책임 |
| --- | --- |
| `packages/react` | 인증 모달, 퍼즐 입력, 성공 연출, 콜백과 이벤트 전송 |
| `backend` | 인증 발급과 판정, 고객사 서버의 결과 확인, PostgreSQL 저장 |
| `frontend` | SDK를 사용하는 포인트 샘플과 모의 시승 신청 화면 |
| `examples/react-consumer` | 독립 React 앱에서 패키지를 설치하는 예제 |
| `docs/assets` | 소재 규격, 좌표와 생성 기록 |
| `scripts` | SDK 패키징과 패키지 계약 및 브라우저 점검 |

SDK는 ESM JavaScript, TypeScript 선언과 별도 CSS로 배포한다. React와 React DOM 19는 peer dependency다. 클래스와 애니메이션 이름은 `cv-` 접두사를 사용한다.

## 인증과 업무 처리

1. 고객사 백엔드가 `POST /internal/challenges`로 업무 대상에 연결된 인증을 발급한다.
2. 고객사 화면이 발급 결과를 `CaptchaModal`의 `challenge` 입력에 전달한다. 공개 시작 방식을 사용하면 SDK가 `POST /api/challenges`를 호출한다.
3. SDK는 소재 이미지를 준비하고 램프 드래그의 최종 좌표를 `POST /api/verify`로 전송한다.
4. 서버는 위치를 판정하고 성공 시 `completionId`와 `clickId`를 발급한다. 같은 인증의 성공 요청을 다시 받아도 기존 결과를 반환한다.
5. SDK는 스냅과 줌아웃 연출을 마친 뒤 `onComplete`로 결과를 전달한다. 계속하기를 선택하면 `onContinue`를 호출한다.
6. 고객사 백엔드는 `POST /internal/completions/verify`로 결과를 확인한 뒤 업무를 처리한다.

서버 전용 API는 공유 비밀키로 인증한다. 업무 대상, 인증 ID, 완료 ID와 만료 시각을 확인하며, 비공개 발급 인증의 유효 시간은 10분이다. 고객사 서비스는 같은 완료 결과가 업무에 중복 적용되지 않도록 처리한다.

광고 CTA는 새 탭에서 열리고 인증 이후에 선택할 수 있다. 원래 업무는 계속하기 콜백으로 재개한다.

## SDK 상태와 수명

기본 상태 흐름은 `loading → challenge → verifying → snapping → revealing → completed`다. 요청이나 이미지 준비에 실패하면 `error`에서 해당 작업을 재시도한다. 위치 불일치는 `challenge`로 돌아간다.

같은 인증에서는 SDK 컴포넌트를 유지하고 `open`으로 표시만 바꾼다. 닫았다 열어도 인증 결과와 완료 콜백 전달 여부를 유지한다. 새 인증은 React `key`를 바꿔 시작한다. 소재, API 주소와 계측 설정은 한 인증 동안 고정한다.

드롭 좌표는 퍼즐 영역을 기준으로 정규화한다. 포인터 입력과 화면 연출은 SDK가 처리하고 정답 판정은 서버의 소재 설정을 사용한다. API 주소, 이미지 주소와 랜딩 주소는 각각 `apiBaseUrl`, `assetBaseUrl`, `landingBaseUrl`로 설정한다.

## 식별자와 저장

| 식별자 | 의미 |
| --- | --- |
| `challengeId` | 인증 시도 |
| `completionId` | 서버가 확정한 인증 성공 결과 |
| `clickId` | 인증 결과와 CTA 및 랜딩 이벤트를 연결하는 키 |
| `eventId` | 개별 이벤트의 중복 판정 키 |
| `leadId` | 모의 시승 신청 완료 기록 |

`clickId`는 인증 성공 시 발급한다. CTA 클릭 여부는 `cta_clicked` 이벤트로 확인한다.

| PostgreSQL 테이블 | 저장 내용 |
| --- | --- |
| `captcha_challenges` | 인증 상태, 완료 결과, 고객사 연결과 만료 시각 |
| `captcha_events` | CTA 표시, 클릭, 랜딩 방문과 모의 신청 완료 이벤트 |
| `captcha_demo_leads` | 모의 시승 신청 결과 |
| `captcha_interaction_summaries` | 인증별 시간, 실패 횟수와 드래그 경로 표본 |

Alembic으로 스키마를 관리한다. 중복과 동시 요청의 결과는 트랜잭션에서 처리한다. API 경로와 실행 설정은 [백엔드 문서](backend/README.md)를 참고한다.

## 광고 관측

`cta_shown`은 인증 완료 화면의 CTA 표시, `cta_clicked`는 링크 활성화, `landing_viewed`는 연동된 랜딩 방문을 기록한다. 모의 신청을 완료하면 서버가 `test_drive_requested`를 저장한다.

외부 광고주 페이지의 신청 완료를 집계하려면 광고주 측의 완료 이벤트나 서버 연동이 필요하다. 현재 모의 랜딩의 신청 완료 기록은 자체 신청 API에서 생성한다.

첫 조작 시간, 풀이 시간, 실패 횟수와 경로 표본의 정의 및 저장 규칙은 [상호작용 계측 설계](docs/interaction-telemetry.md)에 있다.

## 관련 문서

- [SDK 설치와 연결](README.md)
- [React SDK 설정과 콜백](packages/react/README.md)
- [인증 서버와 API](backend/README.md)
- [소재 규격과 좌표](docs/assets/asset-manifest.json)
