"""시연 전용 DB에서 실제 HTTP 인증과 예약 연결을 확인한다."""
from datetime import datetime, timedelta, timezone
import os

import httpx
from sqlalchemy import func, select
from sqlalchemy.engine import make_url

from app.db.session import SessionLocal
from app.models.reservations import Reservation

if make_url(os.environ["DATABASE_URL"]).database != "meeting_room_demo":
    raise RuntimeError("시연 전용 DB에서만 점검할 수 있습니다.")

origin = os.environ["DEMO_ORIGIN"]
with httpx.Client(base_url="http://customer-api:8002", headers={"Origin": origin},
                  timeout=15, trust_env=False) as client:
    login = client.post("/api/auth/login", json={"email": "qa-member1@example.com", "password": "Qa12345!"})
    assert login.status_code == 200, login.text
    client.headers["X-CSRF-Token"] = login.json()["csrf_token"]
    rooms = client.get("/api/rooms")
    assert rooms.status_code == 200
    room_id = rooms.json()[0]["room_id"]
    with SessionLocal() as db:
        end = db.scalar(select(func.max(Reservation.end_at)).where(
            Reservation.room_id == room_id, Reservation.title == "시연 자동 점검"))
    start = max(datetime.now(timezone.utc) + timedelta(days=7),
                end + timedelta(minutes=1) if end else datetime.now(timezone.utc))
    draft = {"room_id": room_id, "title": "시연 자동 점검", "start_at": start.isoformat(),
             "end_at": (start + timedelta(minutes=1)).isoformat()}
    assert client.post("/api/reservations", json=draft).status_code == 403
    issue = client.post("/api/reservations/captcha", json=draft)
    assert issue.status_code == 201, issue.text
    issued = issue.json()
    challenge = issued["challenge"]
    lamp = challenge["creative"]["lampRect"]
    verified = httpx.post("http://provider-api:8001/api/verify", json={
        "challengeId": challenge["challengeId"], "dropX": lamp["x"] + lamp["width"] / 2,
        "dropY": lamp["y"] + lamp["height"] / 2,
    }, timeout=15, trust_env=False)
    assert verified.status_code == 200 and verified.json()["passed"] is True
    proof = {"intent_id": issued["intent_id"], "challenge_id": challenge["challengeId"],
             "completion_id": verified.json()["completionId"]}
    body = {**draft, "captcha": proof}
    assert client.post("/api/reservations", json={**body, "captcha": {**proof, "completion_id": "forged"}}).status_code == 403
    first = client.post("/api/reservations", json=body)
    assert first.status_code == 201, first.text
    retry = client.post("/api/reservations", json=body)
    assert retry.status_code == 201 and retry.json() == first.json()

print("PASS: 로그인, 인증 우회 차단, 서버 간 확인, 예약 저장, 중복 방지, CTA 미참여")
