"""전용 PostgreSQL 테스트 DB에서 재시작과 중복 요청의 영속 경계를 검증한다."""

from concurrent.futures import ThreadPoolExecutor
import os
from pathlib import Path
import secrets
from threading import Barrier

import pytest
from sqlalchemy import create_engine, func, select, text
from sqlalchemy.engine import make_url
from alembic import command
from alembic.config import Config

from app.api.routes import internal as internal_routes
from app.main import create_app
from app.persistence import EventRow, LeadRow, InteractionRow, PostgresStore
from conftest import ApiClient


DATABASE_URL = os.environ.get("CAPTCHAVATYE_TEST_DATABASE_URL", "")
if not DATABASE_URL:
    pytest.skip("CAPTCHAVATYE_TEST_DATABASE_URL is not configured", allow_module_level=True)
if not make_url(DATABASE_URL).database.endswith("_test"):
    raise RuntimeError("CAPTCHAVATYE_TEST_DATABASE_URL must name a dedicated database ending in _test")

SERVICE_KEY = "test-captchavatye-service-key-32-characters-only"
AUTH = {"Authorization": f"Bearer {SERVICE_KEY}"}
CREATIVE = "bmw-m3-v1"


@pytest.fixture(scope="session", autouse=True)
def migrated_database(monkeypatch_session):
    monkeypatch_session.setenv("CAPTCHAVATYE_DATABASE_URL", DATABASE_URL)
    monkeypatch_session.setenv("CAPTCHAVATYE_SERVICE_KEY", SERVICE_KEY)
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    command.upgrade(config, "head")
    store = PostgresStore(DATABASE_URL)
    store.check_ready()
    yield
    if store.engine:
        store.engine.dispose()


@pytest.fixture(scope="session")
def monkeypatch_session():
    patch = pytest.MonkeyPatch()
    yield patch
    patch.undo()


@pytest.fixture(autouse=True)
def clean_dedicated_database(migrated_database):
    engine = create_engine(DATABASE_URL)
    with engine.begin() as connection:
        connection.execute(text(
            "TRUNCATE captcha_interaction_summaries, captcha_events, captcha_demo_leads, captcha_challenges"
        ))
    yield
    engine.dispose()


@pytest.fixture
def client():
    return ApiClient(create_app(store=PostgresStore(DATABASE_URL)))


def start(client, subject="reservation-intent-1"):
    response = client.post("/internal/challenges", headers=AUTH, json={
        "creativeId": CREATIVE, "subject": subject,
    })
    assert response.status_code == 201
    return response.json()


def solve(client, challenge):
    lamp = challenge["creative"]["lampRect"]
    response = client.post("/api/verify", json={
        "challengeId": challenge["challengeId"],
        "dropX": lamp["x"] + lamp["width"] / 2,
        "dropY": lamp["y"] + lamp["height"] / 2,
    })
    assert response.status_code == 200
    assert response.json()["passed"] is True
    return response.json()


def test_parallel_summary_revision_survives_restart(client):
    challenge = start(client)
    base = {'challengeId': challenge['challengeId'], 'revision': 1, 'metrics': {
        'firstInteractionMs': 200, 'solveMs': None, 'missCount': 1, 'path': [],
    }}
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _: client.post('/api/interaction-summaries', json=base).status_code, range(8)))
    assert results.count(201) == 1
    assert results.count(200) == 7
    latest = {**base, 'revision': 3, 'metrics': {**base['metrics'], 'solveMs': 700}}
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda body: client.post('/api/interaction-summaries', json=body).status_code,
            [latest, {**base, 'revision': 2}] * 4))
    assert set(results) <= {200, 201}
    restarted = ApiClient(create_app(store=PostgresStore(DATABASE_URL)))
    assert restarted.post('/api/interaction-summaries', json=latest).status_code == 200
    assert restarted.post('/api/interaction-summaries', json={**base, 'revision': 3}).status_code == 409
    with create_engine(DATABASE_URL).connect() as connection:
        assert connection.scalar(select(func.count()).select_from(InteractionRow)) == 1
        assert connection.scalar(select(InteractionRow.metrics))['solveMs'] == 700
    from app.inspect_interactions import recent_interactions
    records = recent_interactions(PostgresStore(DATABASE_URL))
    assert len(records) == 1
    assert records[0]['challengeId'] == challenge['challengeId']
    assert records[0]['status'] == 'pending'
    assert records[0]['metrics'] == latest['metrics']


@pytest.mark.parametrize("size", [121, 5000])
def test_external_event_id_longer_than_120_characters_keeps_public_contract(client, size):
    completed = solve(client, start(client))
    event = {"eventId": secrets.token_urlsafe(size), "eventName": "cta_clicked", "clickId": completed["clickId"],
             "occurredAt": "2026-10-25T00:00:00Z"}
    assert client.post("/api/events", json=event).status_code == 201
    assert client.post("/api/events", json=event).status_code == 200
    assert client.post("/api/events", json={**event, "eventName": "landing_viewed"}).status_code == 409


def test_public_demo_challenge_cannot_be_used_as_customer_proof(client):
    challenge = client.post("/api/challenges", json={"creativeId": CREATIVE})
    assert challenge.status_code == 201
    completed = solve(client, challenge.json())
    response = client.post("/internal/completions/verify", headers=AUTH, json={
        "challengeId": challenge.json()["challengeId"], "completionId": completed["completionId"],
        "subject": "reservation-intent-1",
    })
    assert response.status_code == 403


def test_new_app_reads_challenge_event_and_conversion_after_restart(client):
    challenge = start(client)
    completed = solve(client, challenge)
    click_id = completed["clickId"]
    event = {
        "eventId": "browser-action-persisted",
        "eventName": "cta_clicked",
        "clickId": click_id,
        "occurredAt": "2026-10-25T00:00:00Z",
    }
    assert client.post("/api/events", json=event).status_code == 201
    application = {"clickId": click_id, "locationId": "demo-center-a", "slotId": "demo-slot-1"}
    lead = client.post("/api/demo/test-drives", json=application)
    assert lead.status_code == 201

    restarted = ApiClient(create_app(store=PostgresStore(DATABASE_URL)))
    assert restarted.post("/api/verify", json={
        "challengeId": challenge["challengeId"],
        "dropX": challenge["creative"]["lampRect"]["x"] + challenge["creative"]["lampRect"]["width"] / 2,
        "dropY": challenge["creative"]["lampRect"]["y"] + challenge["creative"]["lampRect"]["height"] / 2,
    }).json() == completed
    assert restarted.post("/api/events", json=event).status_code == 200
    assert restarted.post("/api/demo/test-drives", json=application).json() == lead.json()
    assert restarted.post("/internal/completions/verify", headers=AUTH, json={
        "challengeId": challenge["challengeId"],
        "completionId": completed["completionId"],
        "subject": "reservation-intent-1",
    }).status_code == 200

    with create_engine(DATABASE_URL).connect() as connection:
        assert connection.scalar(select(func.count()).select_from(EventRow)) == 2
        assert connection.scalar(select(func.count()).select_from(LeadRow)) == 1


def test_parallel_verification_returns_one_durable_completion(client):
    challenge = start(client)
    lamp = challenge["creative"]["lampRect"]
    payload = {
        "challengeId": challenge["challengeId"],
        "dropX": lamp["x"] + lamp["width"] / 2,
        "dropY": lamp["y"] + lamp["height"] / 2,
    }
    barrier = Barrier(12)

    def verify(_):
        barrier.wait(timeout=5)
        result = client.post("/api/verify", json=payload)
        assert result.status_code == 200
        return result.json()

    with ThreadPoolExecutor(max_workers=12) as workers:
        values = list(workers.map(verify, range(12)))
    assert all(value == values[0] for value in values)
    assert values[0]["passed"] is True


def test_parallel_duplicate_events_are_idempotent_and_changed_ids_conflict(client):
    completed = solve(client, start(client))
    event = {
        "eventId": "browser-action-concurrent",
        "eventName": "cta_clicked",
        "clickId": completed["clickId"],
        "occurredAt": "2026-10-25T00:00:00Z",
    }
    barrier = Barrier(12)

    def submit(_):
        barrier.wait(timeout=5)
        return client.post("/api/events", json=event)

    with ThreadPoolExecutor(max_workers=12) as workers:
        responses = list(workers.map(submit, range(12)))
    assert sum(response.status_code == 201 for response in responses) == 1
    assert sum(response.status_code == 200 for response in responses) == 11
    conflict = client.post("/api/events", json={**event, "eventName": "landing_viewed"})
    assert conflict.status_code == 409
    with create_engine(DATABASE_URL).connect() as connection:
        assert connection.scalar(select(func.count()).select_from(EventRow)) == 1


def test_parallel_duplicate_conversions_create_one_lead_and_event(client):
    completed = solve(client, start(client))
    application = {"clickId": completed["clickId"], "locationId": "demo-center-a", "slotId": "demo-slot-1"}
    barrier = Barrier(12)

    def submit(_):
        barrier.wait(timeout=5)
        return client.post("/api/demo/test-drives", json=application)

    with ThreadPoolExecutor(max_workers=12) as workers:
        responses = list(workers.map(submit, range(12)))
    assert sum(response.status_code == 201 for response in responses) == 1
    assert sum(response.status_code == 200 for response in responses) == 11
    assert all(response.json() == responses[0].json() for response in responses)
    with create_engine(DATABASE_URL).connect() as connection:
        assert connection.scalar(select(func.count()).select_from(LeadRow)) == 1
        assert connection.scalar(select(func.count()).select_from(EventRow)) == 1


def test_private_expiration_and_subject_binding_are_read_from_postgres(client, monkeypatch):
    challenge = start(client)
    completed = solve(client, challenge)
    body = {
        "challengeId": challenge["challengeId"],
        "completionId": completed["completionId"],
        "subject": "another-reservation-intent",
    }
    assert client.post("/internal/completions/verify", headers=AUTH, json=body).status_code == 403

    from app.persistence import ChallengeRow
    store = client.app.state.store
    with store.sessions.begin() as session:
        row = session.get(ChallengeRow, challenge["challengeId"])
        from datetime import datetime, timedelta, timezone
        row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    body["subject"] = "reservation-intent-1"
    expired = client.post("/internal/completions/verify", headers=AUTH, json=body)
    assert expired.status_code == 403
    assert expired.json()["detail"]["code"] == "CAPTCHA_INVALID"
