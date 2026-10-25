"""고객사 backend를 PYTHONPATH로 지정해 새 전용 테스트 DB에만 계정을 만든다."""
from datetime import datetime, timezone
import json
import os
from uuid import uuid4

from sqlalchemy import text
from sqlalchemy.engine import make_url

database = make_url(os.environ["DATABASE_URL"]).database
if not database or not database.endswith("_test"):
    raise RuntimeError("DATABASE_URL must refer to a dedicated _test database")

from app.db.session import SessionLocal
from app.models.users import User, Team
from app.models.rooms import Room
from app.core.security import hash_password

with SessionLocal() as db:
    assert db.scalar(text("SELECT current_database()")) == database
    email = "captcha-e2e-" + uuid4().hex[:8] + "@example.com"
    password = "CaptchaVerify123!"
    user = User(email=email, name="인증 연동 검증", password_hash=hash_password(password),
                team=Team.AVATYE, approved_at=datetime.now(timezone.utc))
    room = Room(name="CAPTCHAvatye 연동 검증 " + uuid4().hex[:6], capacity=6)
    db.add_all([user, room])
    db.commit()
    print(json.dumps({"email": email, "password": password, "room_id": str(room.room_id),
                      "user_id": str(user.user_id), "database": database}))
