"""실행 중인 단일 워커와 Vite 프록시를 HTTP로 확인한다. 모의 인증·이벤트가 생성된다."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
from pathlib import Path
import threading
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from uuid import uuid4


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--proxy-url", default="http://127.0.0.1:5173")
    args = parser.parse_args()
    checks = []

    def post(path, body, origin=None):
        request = Request(
            (origin or args.base_url) + path,
            data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            response = urlopen(request, timeout=10)
        except HTTPError as error:
            response = error
        with response:
            return response.status, json.load(response)

    def checked(name, **details):
        checks.append({"name": name, "passed": True, **details})

    def concurrent(bodies):
        barrier = threading.Barrier(len(bodies))

        def send(body):
            barrier.wait(timeout=5)
            return body, post("/api/events", body)

        with ThreadPoolExecutor(max_workers=len(bodies)) as executor:
            return list(executor.map(send, bodies))

    with urlopen(args.base_url + "/openapi.json", timeout=10) as response:
        paths = sorted(json.load(response)["paths"])
    required_paths = {"/api/challenges", "/api/events", "/api/verify"}
    assert required_paths <= set(paths), paths
    checked("event_and_auth_routes_published", paths=paths)

    status, challenge = post("/api/challenges", {"creativeId": "bmw-m3-v1"})
    assert status == 201
    lamp = challenge["creative"]["lampRect"]
    verify_body = {
        "challengeId": challenge["challengeId"],
        "dropX": lamp["x"] + lamp["width"] / 2,
        "dropY": lamp["y"] + lamp["height"] / 2,
    }
    status, passed = post("/api/verify", verify_body)
    assert status == 200 and passed["passed"] is True

    base_event = {
        "eventId": str(uuid4()),
        "eventName": "landing_viewed",
        "clickId": passed["clickId"],
        "occurredAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
    statuses = []
    for name in ["landing_viewed", "cta_clicked", "cta_shown"]:
        body = {**base_event, "eventName": name}
        if name != "landing_viewed":
            body["eventId"] = str(uuid4())
        status, data = post("/api/events", body)
        assert status == 201 and data == {"accepted": True, "duplicate": False}
        statuses.append(status)
    checked("allowed_names_without_arrival_order_requirement", statuses=statuses)

    status, data = post("/api/events", dict(reversed(list(base_event.items()))), args.proxy_url)
    assert status == 200 and data == {"accepted": True, "duplicate": True}
    checked("identical_retry_through_vite_proxy", status=status)

    for change in [
        {"occurredAt": base_event["occurredAt"].replace("Z", "+00:00")},
        {"clickId": "unknown-click"},
    ]:
        status, data = post("/api/events", {**base_event, **change})
        assert status == 409 and data["detail"]["code"] == "EVENT_ID_CONFLICT"
    checked("raw_timestamp_conflict_and_conflict_before_click_lookup", status=409)

    status, data = post("/api/events", {
        **base_event, "eventId": str(uuid4()), "clickId": "unknown-click",
    })
    assert status == 404 and data["detail"]["code"] == "CLICK_NOT_FOUND"
    checked("new_unknown_click", status=status)

    for change in [
        {"eventName": "test_drive_requested"},
        {"occurredAt": "2026-10-25T00:00:00"},
        {"occurredAt": "1792886400"},
    ]:
        status, data = post("/api/events", {**base_event, **change})
        assert status == 422 and isinstance(data["detail"], list)
    checked("forbidden_event_and_invalid_timestamps", status=422)

    identical = {**base_event, "eventId": str(uuid4())}
    results = concurrent([identical.copy() for _ in range(12)])
    statuses = [result[0] for _, result in results]
    assert statuses.count(201) == 1 and statuses.count(200) == 11, statuses
    checked("twelve_identical_requests", created=statuses.count(201), duplicates=statuses.count(200))

    conflicting = {**base_event, "eventId": str(uuid4())}
    results = concurrent([
        {**conflicting, "occurredAt": f"2026-10-25T00:00:{index:02d}Z"}
        for index in range(12)
    ])
    statuses = [result[0] for _, result in results]
    assert statuses.count(201) == 1 and statuses.count(409) == 11, statuses
    winner = next(body for body, result in results if result[0] == 201)
    status, data = post("/api/events", winner)
    assert status == 200 and data == {"accepted": True, "duplicate": True}
    checked("twelve_conflicting_requests", created=statuses.count(201), conflicts=statuses.count(409))

    status, repeated = post("/api/verify", verify_body)
    assert status == 200 and repeated == passed
    checked("authentication_result_unchanged")

    report = {
        "checkedAt": datetime.now(timezone.utc).isoformat(),
        "baseUrl": args.base_url,
        "proxyUrl": args.proxy_url,
        "passed": len(checks),
        "failed": 0,
        "challengeId": challenge["challengeId"],
        "clickId": passed["clickId"],
        "checks": checks,
    }
    output = Path(__file__).with_name("http-results.json")
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
