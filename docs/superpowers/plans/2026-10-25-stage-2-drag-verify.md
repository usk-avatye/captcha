# 2단계 — 드래그와 서버 위치 판정

기준: [DESIGN.md](../../../DESIGN.md) 3~7절. 작업일: 2026-10-25 KST.

## 범위
- Pointer Events로 조각 중심 좌표를 전달하고 FastAPI의 시작·검증 응답으로 흐름을 진행한다.
- loading, challenge, verifying, snapping, revealing, completed, error 이름과 API/ID 계약 유지.
- 통신 오류와 오배치를 구분하고 닫기·재열기·응답 유실을 복구한다.
- 포인트·게시글·공개 완료 콜백·이벤트 API·시승 신청은 다음 단계에 연결한다.
- DESIGN.md와 소재 파일은 수정하지 않는다. Git 저장소가 없으므로 현재 사용자 지정 폴더에서 작업하고 커밋·worktree는 만들지 않는다.

## 작업과 검증
1. 서버: 요청/응답 스키마, 고정 소재, 한 Store/Lock, 시작·검증 서비스와 라우트.
   - 실제 HTTP TestClient로 201, false, true, 404, 422; X/Y 허용 경계; 성공 후 다른 좌표; 동시 성공 ID 일치.
   - NaN/Infinity도 500이 아닌 detail 배열의 422로 반환해야 한다.
2. 프론트: API 계약 검사, 마지막 요청 스냅샷, 세대/취소 가드, 상태 훅.
   - 성공 JSON이 잘못되면 연출 금지. 타임아웃/닫기 후 오래된 응답은 상태를 바꾸지 않음.
3. 입력: 포인터 오프셋, 마지막 pointerup 좌표, 전체 원본 imageRect 정규화, 취소·리사이즈 복귀.
   - 실제 브라우저에서 잡은 위치와 무관한 중심, verifying 중 추가 요청 차단, 바깥 드롭 검증 없음.
4. 통합: 임시 성공·같은 인증 다시 보기 제거. Vite /api 프록시. 완료 재열기 유지.
   - 시작/이미지/검증/두 연출 단계에서 닫기, 응답 유실 재시도, 모바일·동작 줄이기.
5. 전체 테스트·린트·빌드, 독립 코드 검토, 실제 결과와 실행법 README 기록.

## 결정
- Ruling: 허용 오차는 원본 X 12px, Y 8px로 시작한다. 램프 223×70px의 중심 부근을 맞추게 하되 손 조작 오차를 허용한다. 서버에만 저장하며 경계 안/경계/밖을 검증한다. 시연 시 체감 난이도 조정이 필요할 수 있다.
- 기존 PNG crop은 SDK 내부 소재 메타데이터로 유지하고 Creative API에 새 필드를 추가하지 않는다.
- 시작 응답을 받기 전 닫으면 재시작이 새 pending을 만들 수 있다는 기존 설계 예외를 유지한다.
- Pre-flight: 서버 Creative → SDK 소재/기하 계산, verify 결과 → 흐름 상태/연출. 동일 camelCase 계약 사용. 허용 오차는 서버에만 둔다.

## 진행 기록
- 설계·상위 AGENTS.md·기존 코드 확인 완료. 적용 AGENTS.md 없음.
- 테스트와 실제 실행 결과는 작업 중 아래에 기록한다.

- 서버 TDD: 라우트 없는 앱에서 시작 요청 404(기대 201) 실패 확인 → 구현 후 43/43 통과. strict 숫자·NaN/Infinity 422 직렬화·12개 동시 요청 포함.
- 경계 테스트의 원본 중심은 DESIGN의 공개 lampRect.x + width/2 계산을 따른다. (원본 픽셀 합)/원본 폭과 1 ULP 차이가 있어 고정 기대값을 공개 Rect 기준으로 바로잡았다.
- FastAPI TestClient가 설치된 Starlette에서 HTTPX 사용 중단 예고를 내므로 별도 의존성을 늘리지 않고 HTTPX ASGITransport로 실제 앱 경계를 검증한다.
- 프론트 TDD: 빈 API/좌표/흐름 구현에서 실패 확인 → API/좌표/흐름 + 기존 연출 테스트 27/27 통과.
- Pointer Events 및 모달 연결 후 TypeScript/Vite 빌드 통과, Oxlint 경고·오류 0. 실제 Mac 브라우저 통합 검증 진행 중.
- 실제 Mac Chrome 정상 드래그 smoke 통과: /api/verify 1건, completed, 같은 차량 이미지, page error 0.
- 응답 지연·응답 유실·검증 중 닫기 복구 3개를 별도 Chrome context에서 직접 재현했다. 실제 route.fetch로 서버 성공을 먼저 저장한 뒤 지연/취소했고, 재시도 payload 및 completionId/clickId가 동일했다. 세션 session-0751d9bf5638b24cb8bee809, 오류 0.

- Task 1: complete — backend pytest 43/43. Task 2~3: complete — frontend 27/27, build 통과, lint 0경고/0오류.
- Task 4~5: complete — Mac Chrome 155.0.8059.85 16/16, page error 0. 1280×900·390×844 캡처 확인. 실제 결과는 docs/verification/stage2/results.json과 checks.json.
- Final review: 독립 정적 검토 Critical/Important/Minor 각 0. 리뷰 경계별 Ruling과 근거/제약은 docs/verification/stage2/review.md에 기록.
- README 실행 명령의 backend editable 설치도 실제 통과. 최종 테스트 재실행 후 기록 갱신 완료.
