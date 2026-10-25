"""V03: synchronize two real HTTP verification requests and reuse the stored result."""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
from pathlib import Path
import threading
import urllib.error
import urllib.request

def now() -> str:
    return datetime.now(timezone.utc).isoformat()

def post(base: str, path: str, payload: dict) -> dict:
    started = now()
    request = urllib.request.Request(
        base.rstrip("/") + path,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            status, body = response.status, response.read()
    except urllib.error.HTTPError as error:
        status, body = error.code, error.read()
    return {
        "startedAt": started, "completedAt": now(),
        "request": payload, "status": status, "response": json.loads(body),
    }

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:5173/api")
    args = parser.parse_args()
    report = {"recordedAt": now(), "baseUrl": args.base_url, "case": "parallel_verification_reuses_one_result"}
    failure = None
    try:
        started = post(args.base_url, "/challenges", {"creativeId": "bmw-m3-v1"})
        report["start"] = started
        assert started["status"] == 201, started
        challenge = started["response"]
        lamp = challenge["creative"]["lampRect"]
        payload = {
            "challengeId": challenge["challengeId"],
            "dropX": lamp["x"] + lamp["width"] / 2,
            "dropY": lamp["y"] + lamp["height"] / 2,
        }
        barrier = threading.Barrier(2)
        def verify(_: int) -> dict:
            barrier.wait(timeout=5)
            return post(args.base_url, "/verify", payload)
        with ThreadPoolExecutor(max_workers=2) as pool:
            attempts = list(pool.map(verify, range(2)))
        report["concurrentRequests"] = attempts
        assert all(item["status"] == 200 for item in attempts), attempts
        expected = attempts[0]["response"]
        assert expected["passed"] is True and expected["completionId"] and expected["clickId"], expected
        assert attempts[1]["response"] == expected, attempts
        other = post(args.base_url, "/verify", {
            "challengeId": challenge["challengeId"], "dropX": 1, "dropY": 0,
        })
        report["differentValidCoordinateRetry"] = other
        assert other["status"] == 200 and other["response"] == expected, other
        report["status"] = "passed"
    except Exception as error:
        report["status"] = "failed"
        report["error"] = repr(error)
        failure = error
    output = Path(__file__).with_name("concurrent-verify-results.json")
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"case": report["case"], "status": report["status"], "output": str(output)}, ensure_ascii=False))
    if failure is not None:
        raise failure

if __name__ == "__main__":
    main()
