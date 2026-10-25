# React SDK 독립 패키지 구현 계획

> 실행: 현재 세션에서 단계별 실패 테스트 → 구현 → 재검증. 사용자 승인: 2026-10-25 대화의 SDK 패키지화 1단계.

**Goal:** 다른 React 앱이 `.tgz`를 설치하고 컴포넌트·CSS·콜백만 연결해 기존 인증 경험을 사용할 수 있게 한다.
**Architecture:** `packages/react`가 SDK 구현을 소유하고 기존 `frontend`는 공개 패키지를 사용하는 데모가 된다. 루트 npm workspaces에서 개발하며, 배포 검증은 workspace 밖의 실제 tarball 설치로 한다.
**Tech Stack:** 기존 React 19, TypeScript 6, Vite 8, Node 테스트 러너. 새 런타임 의존성 없음.
**Spec:** 기존 `DESIGN.md`의 API·ID·상태·콜백 계약을 유지한다. 패키지 배포 제외·SDK 내 모의 포인트 UI는 이번 대화의 승인으로 대체한다.

## 범위와 결정

- `[승인]` SDK에서 보상 문구·포인트 정책 제거. 기존 데모의 10P 처리는 호스트 hook에 남긴다.
- `[승인]` 버튼 문구, 소재 주소, CTA 주소를 호스트에서 설정할 수 있게 한다.
- `[최소안]` 패키지 이름 `@captchavatye/react`, 버전 `0.1.0`. `private: true`, `UNLICENSED`로 공개 발행을 막는다. npm scope의 소유권·공개 라이선스는 결정하지 않는다.
- `[최소안]` ESM JS, TypeScript 선언, 별도 `style.css`만 설치 계약으로 제공한다. React/React DOM은 peer dependency이고 번들에 넣지 않는다.
- `[최소안]` `continueLabel?` 기본값은 기존 `원래 작업 계속하기`. `assetBaseUrl?`, `landingBaseUrl?`는 절대 HTTP(S) URL이며 기본값은 브라우저 origin. 서버의 상대 URL은 표준 URL 규칙으로 해석한다. `/`로 시작하면 base의 경로는 대체된다.
- `[최소안]` SDK의 분석 전송기를 `createEventTracker`로 공개해 별도 랜딩 페이지가 내부 파일을 import하지 않게 한다. 기존 동작·필드는 불변.
- `[최소안]` CSS는 모든 클래스·애니메이션을 `cv-`로 구분하고 reset은 SDK 모달 내부만 대상으로 한다. 이미지 파일과 신청 페이지는 SDK 패키지에 싣지 않는다.
- BMW 한 소재의 래스터 crop은 유지한다. 다중 소재 시스템·npm 공개·DB/서버 검증·실제 예약 서비스 변경은 다음 단계다.
- 클라이언트 완료 콜백은 보안 증명이 아니다. 이 버전의 외부 소비 예시는 인증 UI 연동만 확인하며 예약 생성·보상 지급 권한을 부여하지 않는다.

## Review Focus

- 다른 origin/하위 경로의 소비 앱에서 API 프록시와 소재·CTA의 목적지가 섞이지 않아야 한다.
- URL에 잘못된 프로토콜·자격증명이 있으면 이미지/링크로 사용하지 않는다.
- 호스트의 일반 button/h2 스타일을 바꾸지 않으며 SDK의 버튼 스타일이 빠지지 않는다.
- 포인트가 없는 앱에서도 완료/계속하기/재열기가 동일하게 동작한다.
- 실제 tarball만으로 타입 검사·production build가 가능하고 React를 두 번 설치하지 않는다.

## Task 1 — 패키지와 공개 경계

**Files:** root package.json/package-lock.json, packages/react/{package.json,vite.config.ts,tsconfig.build.json,src/*}, frontend/src/pages/*, frontend/tests/*.
**Produces:** CaptchaModal, CaptchaModalProps, CompletionResult, createEventTracker; `@captchavatye/react/style.css`.

- [x] 기존 49개 테스트 통과 확인.
- [x] 분리된 URL·안전한 CTA·패키지 파일·포인트 없는 모달의 실패를 먼저 재현한다.
- [x] SDK 소스를 이동하고 URL 설정·버튼 문구·CSS 독립화·포인트 UI 제거를 구현한다.
- [x] 기존 데모는 공개 패키지와 CSS import만 사용하도록 변경한다. 상태·서버 코드는 변경하지 않는다.
- [x] 기존+신규 단위 검증, 타입 검사, 라이브러리/데모 빌드와 lint를 실행한다.
- [x] `feat(sdk): React SDK를 독립 설치 패키지로 분리`로 커밋한다.

## Task 2 — tarball 설치와 독립 앱 검증

**Files:** scripts/pack-sdk.mjs, examples/react-consumer/*, scripts/verify-sdk-*.cjs, packages/react/README.md, README.md, docs/verification/sdk-package/*.
**Consumes:** Task 1의 JS·타입·CSS export. workspace 원본 경로를 소비 앱에 전달하지 않는다.

- [x] npm pack으로 artifacts/captchavatye-react-0.1.0.tgz를 생성한다.
- [x] 압축 내용에 소스·테스트·서버·이미지·비밀 설정이 들어 있지 않은지 검사한다.
- [x] workspace 밖 임시 앱에 tgz를 설치하고 타입 검사·빌드·단일 React 설치를 확인한다.
- [x] 다른 origin에서 인증·성공 콜백·계속하기·닫기 재열기·새 탭 CTA·고객사 스타일 보존·포인트 미노출을 Chrome으로 확인한다.
- [x] 기존 데모의 인증/호스트/신청 회귀를 현재 선택자로 재실행한다. 예전 결과는 덮어쓰지 않는다.
- [x] 실행법·검증 근거·브라우저 전용/서버 검증 미구현 한계를 기록하고 `test(sdk): 독립 앱 설치와 연동 검증 추가`로 커밋한다.

## 작업 기록

- 시작점 `ca04d17`, 깨끗한 작업 트리. 기존 프런트엔드 49/49 통과.
- 기존 작업 경로를 유지하고 `feat/react-sdk-package` 브랜치에서 진행한다. 원격 push·main 병합은 하지 않는다.

- 독립 tarball 설치·strict 타입 검사·build·React 단일 설치 확인. 최초 소비 브라우저 검사에서 호스트 `h2`의 직접 color 선언이 SDK의 상속 색보다 우선됨을 재현했다. SDK 내부 제목/본문에 color·font-family 상속을 명시한다. 다른 세 타임아웃은 데모 서버 5173 중단(Connection refused)에서 발생했으므로 복구 후 전체 재실행한다.

- 결과: 프런트엔드53, 백엔드152, tarball 브라우저5, 데모12/시승16/호스트6 최종 통과. clean npm ci/build/test/lint 통과. 독립 리뷰 없이 실행자가 자체 점검했다. 모바일 첫 드래그 1회 불안정은 원인 미확정으로 검증 기록에 보존한다.
