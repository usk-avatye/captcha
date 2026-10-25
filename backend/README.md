# CAPTCHAvatye backend

실행 서버는 인증, CTA 이벤트, 모의 전환을 PostgreSQL에 저장한다. 서버 시작 전에 별도 데이터베이스를 만들고 마이그레이션을 적용한다. 서비스는 DB 테이블을 자동 생성하거나 초기화하지 않는다.

프로젝트 루트에서 실행한다.

```bash
export CAPTCHAVATYE_DATABASE_URL='postgresql+psycopg://USER:PASSWORD@127.0.0.1:5432/captchavatye'
export CAPTCHAVATYE_SERVICE_KEY='여기에_32자_이상의_공유_비밀키'
python -m alembic -c backend/alembic.ini upgrade head
python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8001
```

`CAPTCHAVATYE_SERVICE_KEY`는 CAPTCHAvatye 서버와 고객사 백엔드에 같은 값으로 설정한다. 브라우저에 전달하지 않는다. 고객사 백엔드만 이 키를 사용해 `/internal/challenges`와 `/internal/completions/verify`를 호출한다.

`CAPTCHAVATYE_TEST_DATABASE_URL`은 이름이 `_test`로 끝나는 별도 PostgreSQL 데이터베이스에만 사용한다. PostgreSQL 통합 테스트는 그 데이터베이스의 CAPTCHAvatye 전용 테이블을 초기화한다.
