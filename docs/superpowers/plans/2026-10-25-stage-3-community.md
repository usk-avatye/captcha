# 3단계 고객사 연결 실행 기록

기준: `DESIGN.md` §3, §6.4, §7.1–7.2. 작업 위치: /Users/jungle/dev/missions/final_mission
작성일: 2026-10-25 KST. 단계 0~2 완료 상태에서 이어간다.

## 범위와 완료 조건

- SDK 공개 진입점/입력, 완료/계속하기/닫기 콜백과 커뮤니티 글쓰기 화면을 연결한다.
- 열린 유효 연출 완료 뒤 onComplete 한 번, completionId 적용 Set으로 모의 10P 한 번.
- 별도 등록 가드로 원래 글을 한 번 등록. CTA 사용 없이 완료.
- 같은 글 시도는 SDK를 계속 마운트하고 open만 변경. 등록 후 새 글에서만 key 변경.
- 기존 7개 상태, 시작/검증 API 및 서버 ID 계약 유지. 4단계 이벤트·신청·CTA 활성화는 포함하지 않는다.

## 시작 상태

- DESIGN.md SHA-256: 6dc2bb74265fe7712be817ecc3b4d6536d7696055caf4426601e20f9081c9342
- 적용 AGENTS.md 및 Git 저장소 없음. 지정 Mac 폴더에서 작업하며 Git 작업 트리/커밋 도구는 적용하지 않는다.
- 기존 5173/8000 서버가 실제 HTTP 200 응답. 의존성 추가 불필요.
- 단계 2: frontend 27개, backend 43개 테스트, Chrome 16개 시나리오 기록 존재. 이번 완료 판단에는 새 실행 결과를 사용한다.

## 공유 경계 사전 확인

| 생산 → 소비 | 계약과 판단 |
| --- | --- |
| CaptchaFlow → hook → onComplete | 서버 결과를 보존하고 현재 열린 reveal 종료에만 전달. 호출 전 가드. 콜백 identity 변경과 open 수명 effect를 분리 |
| SDK → 커뮤니티 | 공개 index와 공개 타입만 import. 게시글/포인트는 호스트가 소유 |
| 호스트 → SDK open/key | 닫기는 open=false, 같은 시도 유지. 등록 후 새 글에서 key 증가 |
| onComplete → 포인트 → onContinue | completionId Set 삽입 뒤 +10P. 별도 등록 ref를 먼저 세운 후 글 상태 갱신. CTA 의존 없음 |

Ruling: 닫고 수정한 글은 계속하기 시점의 제목·본문을 등록한다. 제목과 본문의 공백만 있는 입력은 막는다 — 글 스냅샷을 별도로 고정할 요구가 없고 모달 밖 수정이 가능해야 함 — 잘못된 선택이면 제출 전 스냅샷 정책을 별도 합의해야 한다.

## Task 1: SDK 공개 콜백

파일: types.ts, index.ts, flow.ts, useCaptchaFlow.ts, CaptchaModal.tsx, flow.test.ts.
1. 기존 flow 테스트에 콜백 시점/인자, 중복, 재진입, 닫힘·오래된 run, 최신 콜백, 계속하기 조건 테스트를 추가한다.
2. 미구현 콜백으로 assertion 실패를 확인한다.
3. flow가 완료 가드를 갖고 hook은 최신 커밋된 콜백을 별도 layout effect로 전달한다.
4. 완료 화면의 계속하기와 닫기를 구분한다. onContinue는 completed에서만 허용하며 호스트가 등록 중복을 방어한다.
5. npm test: 전체 통과가 Expected.

## Task 2: 커뮤니티 호스트

파일: pages/DemoCommunityPage.tsx, pages/useCommunityDraft.ts, App.tsx, App.css.
- 페이지 전용 hook은 React 상태와 ref를 소유한다. SDK/서버에 글 내용을 전달하지 않는다.
- ref의 적용 Set/현재 글 시도/등록 여부를 동기 갱신한다. state updater는 순수하게 유지한다.
- 이전 시도에 묶인 콜백은 무시한다. 새 글에서도 누적 포인트·적용 Set·등록 목록은 유지한다.
- 실제 React StrictMode 테스트 fixture에서 중복 완료/등록, 늦은 시도, 수정한 초안, 새 글을 확인한다.
- 최소 hook 계약을 둔 상태의 실패를 먼저 확인하고 구현한다.
- 사용자 글은 React 텍스트로 렌더링한다. 브라우저 영속 저장·서버 게시글 API 없음.

## Task 3: 실제 통합 검증

기존 Mac Chrome/Playwright 캐시를 사용하고 개인 프로필을 열지 않는다.
- 실제 폼 작성 → 서버 검증 → 연출 → 10P → 계속하기 → 글 한 건.
- true 응답 전/연출 중/숨긴 동안 포인트 없음.
- 검증·스냅·줌아웃 중 닫기와 재열기, 완료 후 닫고 글 수정, 완료 재열기.
- 성공 응답 유실 후 동일 요청 재시도, 포인트 한 번.
- 두 번째 글은 새 challenge/완료 ID, 총 20P와 두 글.
- 공개 SDK fixture: 부모 재렌더·콜백 identity 변경이 인증을 초기화하지 않고 최신 callback 사용.
- 호스트 fixture: 같은 callback을 같은 이벤트 루프에서 여러 번 호출하고 stale 시도도 전달하여 중복 가드를 검증.
- 작은 화면/동작 줄이기 및 서버/CTA 의존 없는 계속하기 확인.
- frontend 전체 테스트, backend 전체 회귀, lint, production build. 실행 결과와 화면 캡처 저장.

## Review Focus

- React StrictMode의 effect/updater 반복과 최신 커밋된 callback 참조
- 콜백 재진입/예외 및 onClose와 onContinue의 구분
- 완료 전·숨김·이전 run/이전 글 시도에서 보상·등록이 발생하지 않는지
- 새 글 key 변경 시 기존 포인트와 Set은 유지되는지
- 입력 검증/초안 수정과 계속하기의 결합, 사용자 텍스트 표시
- 공개 SDK 경계를 통한 호스트 연결, 서버 계약 변경 여부
- 테스트 fixture가 제품 경로에 시험용 상태/메서드를 추가하지 않는지

## 진행 기록

- 사전 확인 완료. 계약 검토 에이전트가 같은 수명 계약과 최신 callback 연결 위험을 독립 확인.
- Task 1: 완료. 신규 콜백 7개 assertion 실패(기존 27개 통과) 확인 후 구현. npm test 34/34 통과.
- Task 2: 완료. 실제 React StrictMode 호스트 경계 6개 실패 확인 후 구현. verify.host.cjs 6/6, page error 0.
- Task 3: 완료. 실제 서버·Chrome 통합 12/12, page error 0. TypeScript/Vite build 통과, npm test 34/34, pytest 43/43, lint 경고 0·오류 0. 테스트 fixture의 Fast Refresh export 경고 2개는 export 선언으로 정리했다.
- 구현 분리: 페이지 전용 useCommunityDraft.ts가 React 상태/ref를 소유하고 DemoCommunityPage.tsx가 렌더링한다. 호스트는 SDK 공개 index만 import한다.
- SDK의 onContinue는 열린 completed 조건을 검사하고 호스트가 중복 등록을 방어한다. 호스트 검증 실패 뒤 같은 완료 화면에서 다시 계속할 수 있도록 SDK에 영구적인 계속하기 소진 가드는 두지 않는다.

## 최종 검토와 증거

- 독립 정적 코드 검토: Critical 0 / Important 0 / Minor 0, 단계 3 승인. 검토자는 테스트 실행을 주장하지 않았고 작성자가 실제 Mac에서 실행했다.
- Chrome 155.0.8059.85. 1280×900 모달 720×674, 390×844 모달 366×483.875. 인증 전후 크기 유지, stage 16:9, 가로 넘침 없음.
- 작성/완료/등록 데스크톱 3개와 작은 화면 작성/완료 2개 캡처를 직접 확인했다.
- 완료 전 각 단계 0P, completed에서 10P. 검증 응답 유실·닫기 후 동일 요청은 같은 완료 ID를 재사용했다.
- 두 번째 글: 다른 challengeId/completionId/clickId, 총 20P와 글 두 건.
- DESIGN.md와 세 이미지 해시 일치. 백엔드 13개 파일은 이전 검토 복사본이 추가한 마지막 LF를 제외한 전체 내용 일치. 백엔드 파일을 수정하지 않았다.
- 결과: docs/verification/stage3/{checks.json,host-results.json,integration-results.json,review.md}. 코드·브라우저 변경을 위한 미해결 항목 없음.
- Final: Ruling 항목 1~9는 review.md 표에 판단·한계를 모두 기록. 호스트 입력의 최소 가정은 위 Ruling을 유지.
- Final: minor (deferred): 없음.
- 다음 범위는 단계 4이며 이번 구현에서는 수행하지 않았다. 서버 둘은 로컬 시연을 위해 계속 실행한다.
