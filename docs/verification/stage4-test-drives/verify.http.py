"""실행 중인 신청 API와 Vite 프록시를 검증한다. 모의 인증·신청·이벤트를 생성한다."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from itertools import product
import json
from pathlib import Path
import threading
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from uuid import uuid4

PATH = "/api/demo/test-drives"
LOCATIONS = ["demo-center-a", "demo-center-b"]
SLOTS = ["demo-slot-1", "demo-slot-2"]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--proxy-url", default="http://127.0.0.1:5173")
    parser.add_argument("--stale-click-id", help="재시작 직전 발급해 둔 연결 ID. 제공하면 404도 확인한다.")
    args = parser.parse_args()
    checks = []
    created_results = []

    def post(path, body, origin=None):
        request = Request(
            (origin or args.base_url) + path,
            data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json"}, method="POST",
        )
        try:
            response = urlopen(request, timeout=10)
        except HTTPError as error:
            response = error
        with response:
            return response.status, json.load(response)

    def checked(name, **details):
        checks.append({"name": name, "passed": True, **details})

    def completed_challenge():
        status, started = post("/api/challenges", {"creativeId": "bmw-m3-v1"})
        assert status == 201
        lamp = started["creative"]["lampRect"]
        verify_body = {
            "challengeId": started["challengeId"],
            "dropX": lamp["x"] + lamp["width"] / 2,
            "dropY": lamp["y"] + lamp["height"] / 2,
        }
        status, verified = post("/api/verify", verify_body)
        assert status == 200 and verified["passed"] is True
        return verified, verify_body

    def new_application(click_id, location=LOCATIONS[0], slot=SLOTS[0]):
        return {"clickId": click_id, "locationId": location, "slotId": slot}

    def assert_result(data, body):
        assert data == {**body, "leadId": data["leadId"], "status": "completed", "isDemo": True}
        assert data["leadId"].startswith("lead_") and len(data["leadId"]) > 5

    def concurrent(bodies):
        barrier = threading.Barrier(len(bodies))

        def send(body):
            barrier.wait(timeout=5)
            return body, post(PATH, body)

        with ThreadPoolExecutor(max_workers=len(bodies)) as executor:
            return list(executor.map(send, bodies))

    with urlopen(args.base_url + "/openapi.json", timeout=10) as response:
        paths = sorted(json.load(response)["paths"])
    assert paths == ["/api/challenges", "/api/demo/test-drives", "/api/events", "/api/verify"]
    checked("four_business_routes_published", paths=paths)

    if args.stale_click_id:
        status, data = post(PATH, new_application(args.stale_click_id))
        assert status == 404 and data["detail"]["code"] == "CLICK_NOT_FOUND"
        checked("old_click_rejected_after_server_restart", status=status)

    applications = []
    for location, slot in product(LOCATIONS, SLOTS):
        verified, verify_body = completed_challenge()
        body = new_application(verified["clickId"], location, slot)
        status, data = post(PATH, body)
        assert status == 201
        assert_result(data, body)
        created_results.append(data)
        applications.append((body, data, verified, verify_body))
    checked("all_four_choices_without_client_events", created=len(applications))

    body, first, verified, verify_body = applications[0]
    status, data = post(PATH, dict(reversed(list(body.items()))), args.proxy_url)
    assert status == 200 and data == first
    checked("identical_retry_through_vite_proxy", status=status)

    for location, slot in list(product(LOCATIONS, SLOTS))[1:]:
        status, data = post(PATH, new_application(body["clickId"], location, slot))
        assert status == 409 and data["detail"]["code"] == "LEAD_CONFLICT"
    checked("other_valid_choices_conflict", status=409, choices=3)

    status, data = post(PATH, new_application("unknown-click"))
    assert status == 404 and data["detail"]["code"] == "CLICK_NOT_FOUND"
    checked("unknown_click", status=status)

    for invalid in [
        {**body, "locationId": "invalid"}, {**body, "slotId": "invalid"},
        {**body, "clickId": True}, {"locationId": LOCATIONS[0], "slotId": SLOTS[0]},
        {**body, "clickId": "unknown-click", "slotId": "invalid"},
    ]:
        status, data = post(PATH, invalid)
        assert status == 422 and isinstance(data["detail"], list)
    checked("schema_validation_precedes_business_checks", status=422)

    status, data = post("/api/events", {
        "eventId": str(uuid4()), "eventName": "test_drive_requested",
        "clickId": body["clickId"], "occurredAt": "2026-10-25T00:00:00Z",
    })
    assert status == 422 and isinstance(data["detail"], list)
    checked("client_cannot_submit_server_conversion", status=status)

    status, data = post(PATH, body)
    assert status == 200 and data == first
    checked("first_application_preserved_after_errors")

    for name in ["landing_viewed", "cta_clicked"]:
        status, data = post("/api/events", {
            "eventId": str(uuid4()), "eventName": name, "clickId": body["clickId"],
            "occurredAt": "2026-10-25T00:00:00Z",
        })
        assert status == 201 and data == {"accepted": True, "duplicate": False}
    status, data = post(PATH, body)
    assert status == 200 and data == first
    checked("late_client_events_do_not_change_application")

    same_verified, _ = completed_challenge()
    same = new_application(same_verified["clickId"])
    results = concurrent([same.copy() for _ in range(12)])
    statuses = [result[0] for _, result in results]
    assert statuses.count(201) == 1 and statuses.count(200) == 11, statuses
    winner = next(data for _, (status, data) in results if status == 201)
    assert_result(winner, same)
    assert all(data == winner for _, (_, data) in results)
    created_results.append(winner)
    checked("twelve_identical_applications", created=1, duplicates=11)

    different_verified, _ = completed_challenge()
    bodies = [
        new_application(different_verified["clickId"], location, slot)
        for location, slot in product(LOCATIONS, SLOTS)
    ]
    results = concurrent(bodies)
    statuses = [result[0] for _, result in results]
    assert statuses.count(201) == 1 and statuses.count(409) == 3, statuses
    winner_body, (_, winner) = next(item for item in results if item[1][0] == 201)
    assert_result(winner, winner_body)
    for _, (status, data) in results:
        if status == 409:
            assert data["detail"]["code"] == "LEAD_CONFLICT"
    status, retried = post(PATH, winner_body)
    assert status == 200 and retried == winner
    created_results.append(winner)
    checked("four_conflicting_applications", created=1, conflicts=3)

    status, unchanged = post("/api/verify", verify_body)
    assert status == 200 and unchanged == verified
    checked("original_authentication_result_unchanged")

    report = {
        "checkedAt": datetime.now(timezone.utc).isoformat(),
        "baseUrl": args.base_url, "proxyUrl": args.proxy_url,
        "passed": len(checks), "failed": 0,
        "createdApplications": created_results,
        "checks": checks,
    }
    Path(__file__).with_name("http-results.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
    )
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
