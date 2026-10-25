# CAPTCHAvatye backend

인증 결과, CTA 이벤트, 상호작용 요약과 모의 시승 신청 완료를 PostgreSQL에 저장한다. Python 3.12 이상, uv와 PostgreSQL이 필요하다. 서버 전용 데이터베이스를 준비하고 마이그레이션을 적용한다. Docker 시연에서는 시작 스크립트가 마이그레이션을 실행한다.

프로젝트 루트에서 실행한다.

```bash
uv sync --project backend
export CAPTCHAVATYE_DATABASE_URL='postgresql+psycopg://USER:PASSWORD@127.0.0.1:5432/captchavatye'
export CAPTCHAVATYE_SERVICE_KEY='여기에_32자_이상의_공유_비밀키'
uv run --project backend python -m alembic -c backend/alembic.ini upgrade head
uv run --project backend python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8001
```

`CAPTCHAVATYE_SERVICE_KEY`는 CAPTCHAvatye 서버와 고객사 백엔드에 같은 값으로 설정한다. 브라우저에 전달하지 않는다. 고객사 백엔드만 이 키를 사용해 `/internal/challenges`와 `/internal/completions/verify`를 호출한다.

## API

| 경로 | 용도 |
| --- | --- |
| `POST /api/challenges` | 포인트 샘플의 인증 발급 |
| `POST /api/verify` | 드롭 위치 검증과 완료 결과 발급 |
| `POST /api/events` | CTA 노출, 클릭과 모의 랜딩 방문 수집 |
| `POST /api/interaction-summaries` | 인증별 시간, 실패 횟수와 경로 표본의 누적 요약 |
| `POST /api/demo/test-drives` | 모의 시승 신청 완료 저장 |
| `POST /internal/challenges` | 고객사 서버의 예약 인증 발급 |
| `POST /internal/completions/verify` | 고객사 서버의 완료 결과 확인 |

상호작용 요약은 `captcha_interaction_summaries`에 인증당 한 행을 유지한다. 최신 revision을 반영하고 동일 요청의 재전송과 역순 도착을 처리한다. 본문은 최대 16KiB, 경로는 최대 100개 좌표다. SDK가 보내는 첫 조작 시간과 풀이 시간은 활성 경과 시간이다.

Docker 시연의 조회 명령과 경로 보고서는 [실행 안내](../demo/README.md#상호작용-데이터-확인)를 참고한다.

## 테스트 데이터베이스

`CAPTCHAVATYE_TEST_DATABASE_URL`은 이름이 `_test`로 끝나는 별도 PostgreSQL 데이터베이스에만 사용한다. PostgreSQL 통합 테스트는 그 데이터베이스의 CAPTCHAvatye 전용 테이블을 초기화한다.
