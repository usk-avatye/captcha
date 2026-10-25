"""별도 테스트 DB의 실제 두 서버를 검증한다. 서버 재시작 전후에 각각 실행한다.

환경변수: RESERVATION_E2E_ACCOUNT, RESERVATION_E2E_STATE, CAPTCHAVATYE_SERVICE_KEY.
기존 DB를 초기화하지 않는다. 계정 파일은 새 전용 테스트 DB에 만든 계정이어야 한다.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
from uuid import uuid4

import httpx

parser = argparse.ArgumentParser()
parser.add_argument("phase", choices=["before", "after"])
args = parser.parse_args()
account = json.loads(Path(os.environ["RESERVATION_E2E_ACCOUNT"]).read_text())
state_path = Path(os.environ["RESERVATION_E2E_STATE"])
provider = os.environ.get("CAPTCHAVATYE_API_URL", "http://127.0.0.1:8001")
customer = os.environ.get("RESERVATION_API_URL", "http://127.0.0.1:8002")
service_headers = {"Authorization": "Bearer " + os.environ["CAPTCHAVATYE_SERVICE_KEY"]}
client = httpx.Client(base_url=customer, headers={"Origin": "http://127.0.0.1:5175"}, trust_env=False, timeout=10)
login = client.post("/api/auth/login", json={"email": account["email"], "password": account["password"]})
assert login.status_code == 200, login.text
client.headers["X-CSRF-Token"] = login.json()["csrf_token"]
results = {}


def post_provider(path, body, headers=None):
    return httpx.post(provider + path, json=body, headers=headers, timeout=10, trust_env=False)


def solve(issued):
    lamp = issued["challenge"]["creative"]["lampRect"]
    body = {"challengeId": issued["challenge"]["challengeId"],
            "dropX": lamp["x"] + lamp["width"] / 2, "dropY": lamp["y"] + lamp["height"] / 2}
    with ThreadPoolExecutor(max_workers=8) as pool:
        replies = list(pool.map(lambda _: post_provider("/api/verify", body), range(8)))
    assert all(r.status_code == 200 and r.json()["passed"] is True for r in replies)
    assert len({json.dumps(r.json(), sort_keys=True) for r in replies}) == 1
    return body, replies[0].json()


if args.phase == "before":
    start = datetime.now(timezone.utc) + timedelta(days=1)
    draft = {"room_id": account["room_id"], "title": "인증 연동 HTTP 검증",
             "start_at": start.isoformat(), "end_at": (start + timedelta(hours=1)).isoformat()}
    assert client.post("/api/reservations", json=draft).status_code == 403
    issued_response = client.post("/api/reservations/captcha", json=draft)
    assert issued_response.status_code == 201, issued_response.text
    issued = issued_response.json()
    check = {"challengeId": issued["challenge"]["challengeId"], "completionId": "forged", "subject": issued["intent_id"]}
    assert post_provider("/internal/completions/verify", check).status_code == 401
    assert post_provider("/internal/completions/verify", check, service_headers).status_code == 403
    request, completed = solve(issued)
    proof = {"intent_id": issued["intent_id"], "challenge_id": request["challengeId"],
             "completion_id": completed["completionId"]}
    body = {**draft, "captcha": proof}
    assert client.post("/api/reservations", json={**body, "title": "바꿔치기"}).status_code == 403
    assert client.post("/api/reservations", json={**body, "captcha": {**proof, "completion_id": "forged"}}).status_code == 403
    with ThreadPoolExecutor(max_workers=8) as pool:
        replies = list(pool.map(lambda _: client.post("/api/reservations", json=body), range(8)))
    assert all(r.status_code == 201 for r in replies), [r.text for r in replies]
    assert len({r.json()["reservation_id"] for r in replies}) == 1
    saved = replies[0].json()
    # 예약 시점에 CTA 클릭이나 시승 신청을 보내지 않았다.
    results["booking_without_cta_and_concurrent_retry"] = "PASS"
    assert client.post("/api/reservations", json=body).json() == saved
    results["forgery_payload_binding_and_service_key"] = "PASS"
    results["provider_multiworker_concurrent_verify"] = "PASS"

    # 같은 완료 ID를 다른 intent에 넣어도 provider의 subject 연결 확인에서 거부한다.
    next_draft = {**draft, "start_at": (start + timedelta(hours=2)).isoformat(),
                  "end_at": (start + timedelta(hours=3)).isoformat()}
    second = client.post("/api/reservations/captcha", json=next_draft).json()
    replay = {**next_draft, "captcha": {"intent_id": second["intent_id"],
              "challenge_id": second["challenge"]["challengeId"], "completion_id": completed["completionId"]}}
    assert client.post("/api/reservations", json=replay).status_code == 403
    results["cross_intent_completion_replay"] = "PASS"
    event = {"eventId": "e2e_" + uuid4().hex, "eventName": "cta_clicked",
             "clickId": completed["clickId"], "occurredAt": datetime.now(timezone.utc).isoformat()}
    assert post_provider("/api/events", event).status_code == 201
    assert post_provider("/api/events", event).status_code == 200
    assert post_provider("/api/events", {**event, "eventName": "landing_viewed"}).status_code == 409
    lead = {"clickId": completed["clickId"], "locationId": "demo-center-a", "slotId": "demo-slot-1"}
    lead_response = post_provider("/api/demo/test-drives", lead)
    assert lead_response.status_code == 201
    state_path.write_text(json.dumps({"body": body, "saved": saved, "request": request,
        "completed": completed, "event": event, "lead": lead, "lead_saved": lead_response.json(),
        "pending": second, "next_draft": next_draft, "before": results}, ensure_ascii=False, indent=2))
else:
    state = json.loads(state_path.read_text())
    assert client.post("/api/reservations", json=state["body"]).json() == state["saved"]
    assert post_provider("/api/verify", state["request"]).json() == state["completed"]
    duplicate_event = post_provider("/api/events", state["event"])
    assert duplicate_event.status_code == 200 and duplicate_event.json()["duplicate"] is True
    duplicate_lead = post_provider("/api/demo/test-drives", state["lead"])
    assert duplicate_lead.status_code == 200 and duplicate_lead.json() == state["lead_saved"]
    # 재시작 전 미완료 challenge도 복원한다.
    request, completed = solve(state["pending"])
    body = {**state["next_draft"], "captcha": {"intent_id": state["pending"]["intent_id"],
            "challenge_id": request["challengeId"], "completion_id": completed["completionId"]}}
    response = client.post("/api/reservations", json=body)
    assert response.status_code == 201, response.text
    results["both_processes_restarted_exact_booking_retry"] = "PASS"
    results["durable_challenge_event_lead_conversion"] = "PASS"
    results["pending_challenge_resumed_after_restart"] = "PASS"
    state["after"] = results
    state_path.write_text(json.dumps(state, ensure_ascii=False, indent=2))
print(json.dumps({"phase": args.phase, "checks": results}, ensure_ascii=False, indent=2))
client.close()
