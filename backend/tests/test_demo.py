"""모의 신청의 HTTP 계약, 인증 연결, 단일 전환 저장과 동시 재전송을 검증한다."""
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import datetime, timezone
from itertools import product
import logging
import secrets
import threading

import pytest


LOCATIONS = ["demo-center-a", "demo-center-b"]
SLOTS = ["demo-slot-1", "demo-slot-2"]
PATH = "/api/demo/test-drives"


def completed_challenge(client):
    started = client.post("/api/challenges", json={"creativeId": "bmw-m3-v1"})
    assert started.status_code == 201
    challenge = started.json()
    lamp = challenge["creative"]["lampRect"]
    verified = client.post("/api/verify", json={
        "challengeId": challenge["challengeId"],
        "dropX": lamp["x"] + lamp["width"] / 2,
        "dropY": lamp["y"] + lamp["height"] / 2,
    })
    assert verified.status_code == 200
    assert verified.json()["passed"] is True
    return {"challengeId": challenge["challengeId"], **verified.json()}


@pytest.fixture
def passed(client):
    return completed_challenge(client)


@pytest.fixture
def application(passed):
    return {"clickId": passed["clickId"], "locationId": LOCATIONS[0], "slotId": SLOTS[0]}


def assert_business_error(response, status, code):
    assert response.status_code == status
    assert response.json()["detail"]["code"] == code
    assert isinstance(response.json()["detail"]["message"], str)


def internal_events(store, click_id):
    return {
        event_id: record for event_id, record in store.events.items()
        if record.event_name == "test_drive_requested" and record.click_id == click_id
    }


@pytest.mark.parametrize("location,slot", list(product(LOCATIONS, SLOTS)))
def test_all_four_choices_create_one_lead_and_conversion_without_client_events(
    client, passed, application, location, slot,
):
    application.update(locationId=location, slotId=slot)
    store = client.app.state.store
    challenges_before = store.challenges.copy()
    links_before = store.click_links.copy()
    assert not store.events
    before = datetime.now(timezone.utc)

    response = client.post(PATH, json=application)

    assert response.status_code == 201
    data = response.json()
    assert data == {**application, "leadId": data["leadId"], "status": "completed", "isDemo": True}
    assert data["leadId"].startswith("lead_") and len(data["leadId"]) > 5
    assert len(store.leads) == 1 and len(store.events) == 1
    lead = store.leads[application["clickId"]]
    assert (lead.lead_id, lead.click_id, lead.location_id, lead.slot_id) == (
        data["leadId"], application["clickId"], location, slot,
    )
    assert lead.status == "completed" and lead.is_demo is True
    assert before <= lead.completed_at <= datetime.now(timezone.utc)
    assert lead.completed_at.utcoffset().total_seconds() == 0
    event_id, conversion = next(iter(internal_events(store, application["clickId"]).items()))
    assert event_id and event_id != data["leadId"]
    assert conversion.received_at == lead.completed_at
    assert conversion.occurred_at == lead.completed_at.isoformat()
    assert store.challenges == challenges_before and store.click_links == links_before
    link = store.click_links[application["clickId"]]
    assert (link.challenge_id, link.completion_id) == (passed["challengeId"], passed["completionId"])


def test_identical_retry_preserves_response_lead_time_and_conversion(client, application):
    first = client.post(PATH, json=application)
    assert first.status_code == 201
    store = client.app.state.store
    lead = store.leads[application["clickId"]]
    events = store.events.copy()

    repeated = client.post(PATH, json=dict(reversed(list(application.items()))))

    assert repeated.status_code == 200 and repeated.json() == first.json()
    assert store.leads == {application["clickId"]: lead}
    assert store.leads[application["clickId"]] is lead
    assert store.events == events
    assert all(store.events[key] is value for key, value in events.items())


@pytest.mark.parametrize("changes", [
    {"locationId": LOCATIONS[1]},
    {"slotId": SLOTS[1]},
    {"locationId": LOCATIONS[1], "slotId": SLOTS[1]},
])
def test_different_valid_choices_conflict_and_preserve_first(client, application, changes):
    first = client.post(PATH, json=application)
    assert first.status_code == 201
    store = client.app.state.store
    lead = store.leads[application["clickId"]]
    events = store.events.copy()

    response = client.post(PATH, json={**application, **changes})

    assert_business_error(response, 409, "LEAD_CONFLICT")
    assert store.leads[application["clickId"]] is lead
    assert store.events == events
    assert all(store.events[key] is value for key, value in events.items())
    repeated = client.post(PATH, json=application)
    assert repeated.status_code == 200 and repeated.json() == first.json()


@pytest.mark.parametrize("field", ["clickId", "locationId", "slotId"])
def test_missing_fields_do_not_create_application(client, application, field):
    del application[field]
    response = client.post(PATH, json=application)
    assert response.status_code == 422 and isinstance(response.json()["detail"], list)
    assert not client.app.state.store.leads and not client.app.state.store.events


@pytest.mark.parametrize("value", ["", " \t", 1, True, None])
def test_click_id_must_be_nonempty_strict_string(client, application, value):
    response = client.post(PATH, json={**application, "clickId": value})
    assert response.status_code == 422 and isinstance(response.json()["detail"], list)
    assert not client.app.state.store.leads and not client.app.state.store.events


@pytest.mark.parametrize("field", ["locationId", "slotId"])
@pytest.mark.parametrize("value", ["unknown-option", "", " ", 1, True, None, [], {}])
def test_invalid_choices_are_422_without_records(client, application, field, value):
    response = client.post(PATH, json={**application, field: value})
    assert response.status_code == 422 and isinstance(response.json()["detail"], list)
    assert not client.app.state.store.leads and not client.app.state.store.events


@pytest.mark.parametrize("unknown_click", [False, True])
def test_schema_validation_precedes_link_and_existing_lead_checks(client, application, unknown_click):
    assert client.post(PATH, json=application).status_code == 201
    store = client.app.state.store
    leads_before, events_before = store.leads.copy(), store.events.copy()
    body = {**application, "locationId": "invalid"}
    if unknown_click:
        body["clickId"] = "unknown-click"

    response = client.post(PATH, json=body)

    assert response.status_code == 422 and isinstance(response.json()["detail"], list)
    assert store.leads == leads_before and store.events == events_before


def test_unknown_click_is_404_without_records(client, application):
    response = client.post(PATH, json={**application, "clickId": "unknown-click"})
    assert_business_error(response, 404, "CLICK_NOT_FOUND")
    assert not client.app.state.store.leads and not client.app.state.store.events


@pytest.mark.parametrize("problem", [
    "missing_challenge", "pending_challenge", "wrong_completion", "wrong_click",
])
def test_broken_authentication_link_is_404(client, passed, application, problem):
    store = client.app.state.store
    challenge = store.challenges[passed["challengeId"]]
    # 외부 API로 만들 수 없는 불완전한 저장소를 구성해 인증 연결 검사를 검증한다.
    if problem == "missing_challenge":
        del store.challenges[passed["challengeId"]]
    elif problem == "pending_challenge":
        store.challenges[passed["challengeId"]] = replace(challenge, status="pending")
    elif problem == "wrong_completion":
        store.challenges[passed["challengeId"]] = replace(challenge, completion_id="other-completion")
    else:
        store.challenges[passed["challengeId"]] = replace(challenge, click_id="other-click")

    response = client.post(PATH, json=application)

    assert_business_error(response, 404, "CLICK_NOT_FOUND")
    assert not store.leads and not store.events


@pytest.mark.parametrize("changed_choice", [False, True])
def test_link_validation_precedes_existing_lead_comparison(client, passed, application, changed_choice):
    assert client.post(PATH, json=application).status_code == 201
    store = client.app.state.store
    lead = store.leads[application["clickId"]]
    events = store.events.copy()
    del store.click_links[application["clickId"]]
    body = {**application, "slotId": SLOTS[1]} if changed_choice else application

    response = client.post(PATH, json=body)

    assert_business_error(response, 404, "CLICK_NOT_FOUND")
    assert store.leads[application["clickId"]] is lead and store.events == events


def test_same_choices_for_different_clicks_create_independent_leads(client, application):
    first = client.post(PATH, json=application)
    assert first.status_code == 201
    other = {**application, "clickId": completed_challenge(client)["clickId"]}
    second = client.post(PATH, json=other)
    assert second.status_code == 201
    assert first.json()["leadId"] != second.json()["leadId"]
    store = client.app.state.store
    assert len(store.leads) == 2 and len(store.events) == 2
    assert len(internal_events(store, application["clickId"])) == 1
    assert len(internal_events(store, other["clickId"])) == 1


def concurrent_requests(client, requests):
    barrier = threading.Barrier(len(requests))

    def send(item):
        path, body = item
        barrier.wait(timeout=5)
        return body, client.post(path, json=body)

    with ThreadPoolExecutor(max_workers=len(requests)) as executor:
        return list(executor.map(send, requests))


def test_twelve_identical_applications_create_one_lead_and_conversion(client, application):
    results = concurrent_requests(client, [(PATH, application.copy()) for _ in range(12)])
    statuses = [response.status_code for _, response in results]
    assert statuses.count(201) == 1 and statuses.count(200) == 11
    assert all(response.json() == results[0][1].json() for _, response in results)
    store = client.app.state.store
    assert len(store.leads) == 1 and len(store.events) == 1
    assert len(internal_events(store, application["clickId"])) == 1


def test_four_distinct_choices_preserve_only_the_winner(client, application):
    requests = [
        (PATH, {**application, "locationId": location, "slotId": slot})
        for location, slot in product(LOCATIONS, SLOTS)
    ]
    results = concurrent_requests(client, requests)
    statuses = [response.status_code for _, response in results]
    assert statuses.count(201) == 1 and statuses.count(409) == 3
    winner, created = next((body, response) for body, response in results if response.status_code == 201)
    for _, response in results:
        if response.status_code == 409:
            assert_business_error(response, 409, "LEAD_CONFLICT")
    store = client.app.state.store
    lead = store.leads[application["clickId"]]
    assert (lead.location_id, lead.slot_id) == (winner["locationId"], winner["slotId"])
    assert len(store.leads) == 1 and len(store.events) == 1
    retried = client.post(PATH, json=winner)
    assert retried.status_code == 200 and retried.json() == created.json()
    assert store.leads[application["clickId"]] is lead


@pytest.mark.parametrize("collision_kind", ["client_event", "internal_event"])
def test_generated_ids_avoid_existing_lead_values_and_all_event_keys(
    client, application, monkeypatch, collision_kind,
):
    first = client.post(PATH, json=application)
    assert first.status_code == 201
    store = client.app.state.store
    first_lead = store.leads[application["clickId"]]
    old_internal_id = next(iter(internal_events(store, application["clickId"])))
    client_event_id = "ev_client-collision"
    accepted = client.post("/api/events", json={
        "eventId": client_event_id, "eventName": "landing_viewed",
        "clickId": application["clickId"], "occurredAt": "2026-10-25T00:00:00Z",
    })
    assert accepted.status_code == 201
    other = {**application, "clickId": completed_challenge(client)["clickId"]}
    old_events = store.events.copy()
    colliding_event_id = client_event_id if collision_kind == "client_event" else old_internal_id
    tokens = iter([
        first_lead.lead_id.removeprefix("lead_"), "fresh-lead",
        colliding_event_id.removeprefix("ev_"), "fresh-conversion",
    ])
    # 난수 공급만 고정하여 충돌을 재현한다. 실제 ID 생성·저장 서비스는 실행한다.
    monkeypatch.setattr(secrets, "token_urlsafe", lambda _size: next(tokens))

    response = client.post(PATH, json=other)

    assert response.status_code == 201 and response.json()["leadId"] == "lead_fresh-lead"
    assert store.leads[application["clickId"]] is first_lead
    assert len(store.leads) == 2 and len(store.events) == len(old_events) + 1
    assert all(store.events[key] is value for key, value in old_events.items())
    assert set(internal_events(store, other["clickId"])) == {"ev_fresh-conversion"}


def test_id_generation_failure_leaves_no_partial_application(client, application, monkeypatch):
    calls = 0

    def fail_on_second_id(_size):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("test entropy failure")
        return "unused-lead"

    with monkeypatch.context() as patch:
        patch.setattr(secrets, "token_urlsafe", fail_on_second_id)
        # ASGI 테스트 transport는 처리되지 않은 서버 예외를 다시 발생시킨다.
        with pytest.raises(RuntimeError, match="test entropy failure"):
            client.post(PATH, json=application)
    store = client.app.state.store
    assert not store.leads and not store.events
    retried = client.post(PATH, json=application)
    assert retried.status_code == 201
    assert len(store.leads) == 1 and len(store.events) == 1


def test_client_event_and_internal_event_share_collision_protection(client, application, monkeypatch):
    # 두 HTTP 경로가 같은 eventId를 두고 경쟁해도 어느 레코드도 덮어쓰지 않아야 한다.
    tokens = iter(["race-lead", "shared-candidate", "fallback-conversion"])
    monkeypatch.setattr(secrets, "token_urlsafe", lambda _size: next(tokens))
    client_event = {
        "eventId": "ev_shared-candidate", "eventName": "landing_viewed",
        "clickId": application["clickId"], "occurredAt": "2026-10-25T00:00:00Z",
    }
    results = concurrent_requests(client, [(PATH, application), ("/api/events", client_event)])
    application_response, event_response = results[0][1], results[1][1]
    assert application_response.status_code == 201
    assert event_response.status_code in (201, 409)
    store = client.app.state.store
    assert len(store.leads) == 1 and len(internal_events(store, application["clickId"])) == 1
    if event_response.status_code == 201:
        assert len(store.events) == 2
        assert store.events[client_event["eventId"]].event_name == "landing_viewed"
        assert "ev_fallback-conversion" in store.events
    else:
        assert_business_error(event_response, 409, "EVENT_ID_CONFLICT")
        assert len(store.events) == 1
        assert store.events[client_event["eventId"]].event_name == "test_drive_requested"


def test_client_cannot_replace_or_submit_internal_conversion(client, application):
    assert client.post(PATH, json=application).status_code == 201
    store = client.app.state.store
    event_id, original = next(iter(internal_events(store, application["clickId"]).items()))
    body = {
        "eventId": event_id, "eventName": "landing_viewed",
        "clickId": application["clickId"], "occurredAt": original.occurred_at,
    }
    assert_business_error(client.post("/api/events", json=body), 409, "EVENT_ID_CONFLICT")
    forbidden = client.post("/api/events", json={**body, "eventName": "test_drive_requested"})
    assert forbidden.status_code == 422 and isinstance(forbidden.json()["detail"], list)
    assert store.events == {event_id: original} and store.events[event_id] is original


def test_first_success_is_logged_once_outside_lock(client, passed, application, caplog):
    store = client.app.state.store
    lock_states = []

    class LockProbe(logging.Handler):
        def emit(self, record):
            if record.getMessage().startswith("test_drive_completed "):
                lock_states.append(store.lock.locked())

    logger = logging.getLogger("uvicorn.error")
    probe = LockProbe()
    logger.addHandler(probe)
    try:
        with caplog.at_level(logging.INFO, logger="uvicorn.error"):
            first = client.post(PATH, json=application)
            assert first.status_code == 201
            assert client.post(PATH, json=application).status_code == 200
            assert client.post(PATH, json={**application, "slotId": SLOTS[1]}).status_code == 409
    finally:
        logger.removeHandler(probe)
    messages = [record.getMessage() for record in caplog.records if "leadId=" in record.getMessage()]
    assert len(messages) == 1 and lock_states == [False]
    assert "challengeId=" + passed["challengeId"] in messages[0]
    assert "clickId=" + application["clickId"] in messages[0]
    assert "leadId=" + first.json()["leadId"] in messages[0]


def test_restart_forgets_old_click_and_application(client, application, client_factory):
    assert client.post(PATH, json=application).status_code == 201
    restarted = client_factory()
    response = restarted.post(PATH, json=application)
    assert_business_error(response, 404, "CLICK_NOT_FOUND")
    assert not restarted.app.state.store.leads and not restarted.app.state.store.events
