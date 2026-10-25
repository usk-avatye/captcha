"""고객사 서버 전용 인증 생성과 바인딩된 완료 확인 계약."""

from datetime import datetime, timedelta, timezone

SERVICE_KEY = "test-captchavatye-service-key-32-characters-only"
AUTH = {"Authorization": f"Bearer {SERVICE_KEY}"}


def private_challenge(client, subject="reservation-intent-1", headers=AUTH):
    return client.post("/internal/challenges", headers=headers, json={
        "creativeId": "bmw-m3-v1",
        "subject": subject,
    })


def solve(client, challenge):
    lamp = challenge["creative"]["lampRect"]
    return client.post("/api/verify", json={
        "challengeId": challenge["challengeId"],
        "dropX": lamp["x"] + lamp["width"] / 2,
        "dropY": lamp["y"] + lamp["height"] / 2,
    })


def test_private_completion_is_bound_to_client_subject_and_existing_challenge(client, monkeypatch):
    monkeypatch.setenv("CAPTCHAVATYE_SERVICE_KEY", SERVICE_KEY)
    created = private_challenge(client)
    assert created.status_code == 201
    challenge = created.json()
    assert set(challenge) == {"challengeId", "creative", "expiresAt"}
    assert datetime.fromisoformat(challenge["expiresAt"].replace("Z", "+00:00")) > datetime.now(timezone.utc)

    solved = solve(client, challenge)
    assert solved.status_code == 200 and solved.json()["passed"] is True
    completion_id = solved.json()["completionId"]
    payload = {
        "challengeId": challenge["challengeId"],
        "completionId": completion_id,
        "subject": "reservation-intent-1",
    }

    first = client.post("/internal/completions/verify", headers=AUTH, json=payload)
    retry = client.post("/internal/completions/verify", headers=AUTH, json=payload)
    assert first.status_code == 200
    assert first.json() == {
        "passed": True,
        "challengeId": challenge["challengeId"],
        "completionId": completion_id,
        "subject": "reservation-intent-1",
    }
    assert retry.json() == first.json()

    for changed in (
        {**payload, "subject": "another-user-intent"},
        {**payload, "completionId": "cmp_wrong"},
        {**payload, "challengeId": "ch_unknown"},
    ):
        rejected = client.post("/internal/completions/verify", headers=AUTH, json=changed)
        assert rejected.status_code == 403
        assert rejected.json()["detail"]["code"] == "CAPTCHA_INVALID"


def test_private_verification_rejects_public_challenges_and_pending_challenges(client, monkeypatch):
    monkeypatch.setenv("CAPTCHAVATYE_SERVICE_KEY", SERVICE_KEY)
    public = client.post("/api/challenges", json={"creativeId": "bmw-m3-v1"}).json()
    pending = private_challenge(client).json()
    solved_public = solve(client, public).json()
    private_ids = {"challengeId": pending["challengeId"], "completionId": solved_public["completionId"],
                   "subject": "reservation-intent-1"}
    public_ids = {"challengeId": public["challengeId"], "completionId": solved_public["completionId"],
                  "subject": "reservation-intent-1"}

    for body in (private_ids, public_ids):
        response = client.post("/internal/completions/verify", headers=AUTH, json=body)
        assert response.status_code == 403
        assert response.json()["detail"]["code"] == "CAPTCHA_INVALID"


def test_private_endpoints_require_configured_server_key(client, monkeypatch):
    body = {"creativeId": "bmw-m3-v1", "subject": "reservation-intent-1"}
    monkeypatch.setenv("CAPTCHAVATYE_SERVICE_KEY", SERVICE_KEY)
    for headers in ({}, {"Authorization": "Bearer wrong-key"}):
        response = client.post("/internal/challenges", headers=headers, json=body)
        assert response.status_code == 401

    monkeypatch.delenv("CAPTCHAVATYE_SERVICE_KEY")
    response = client.post("/internal/challenges", json=body)
    assert response.status_code == 503


def test_expired_private_challenge_cannot_be_verified(client, monkeypatch):
    monkeypatch.setenv("CAPTCHAVATYE_SERVICE_KEY", SERVICE_KEY)
    started = private_challenge(client).json()
    assert solve(client, started).json()["passed"] is True
    record = client.app.state.store.challenges[started["challengeId"]]
    client.app.state.store.challenges[started["challengeId"]] = record.__class__(
        **{**record.__dict__, "expires_at": datetime.now(timezone.utc) - timedelta(seconds=1)}
    )
    verified = client.post("/internal/completions/verify", headers=AUTH, json={
        "challengeId": started["challengeId"],
        "completionId": record.completion_id,
        "subject": "reservation-intent-1",
    })
    assert verified.status_code == 403
    assert verified.json()["detail"]["code"] == "CAPTCHA_INVALID"
