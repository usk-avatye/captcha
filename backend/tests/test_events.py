"""이벤트의 HTTP 계약, 최초 기록 보존과 공통 잠금의 동시성 경계를 검증한다."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
import logging
import threading

import pytest


def completed_click(client):
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
    return verified.json()["clickId"]


@pytest.fixture
def event(client):
    return {
        "eventId": "browser-action-01",  # 접두사는 서버 검증 조건이 아니다.
        "eventName": "cta_clicked",
        "clickId": completed_click(client),
        "occurredAt": "2026-10-25T00:00:00Z",
    }


def assert_business_error(response, status, code):
    assert response.status_code == status
    assert response.json()["detail"]["code"] == code
    assert isinstance(response.json()["detail"]["message"], str)


@pytest.mark.parametrize("name", ["cta_shown", "cta_clicked", "landing_viewed"])
def test_each_client_event_is_created_without_preceding_events(client, event, name):
    event["eventName"] = name
    store = client.app.state.store
    challenges_before = store.challenges.copy()
    links_before = store.click_links.copy()
    before = datetime.now(timezone.utc)

    response = client.post("/api/events", json=event)

    assert response.status_code == 201
    assert response.json() == {"accepted": True, "duplicate": False}
    assert len(store.events) == 1
    record = store.events[event["eventId"]]
    assert (record.event_name, record.click_id, record.occurred_at) == (
        name, event["clickId"], event["occurredAt"],
    )
    assert record.received_at.utcoffset().total_seconds() == 0
    assert before <= record.received_at <= datetime.now(timezone.utc)
    assert store.challenges == challenges_before
    assert store.click_links == links_before


@pytest.mark.parametrize("timestamp", [
    "2026-10-25T00:00:00Z",
    "2026-10-25T00:00:00.123456Z",
    "2026-10-25T09:00:00+09:00",
    "2026-10-24T19:00:00.123-05:00",
])
def test_aware_iso_timestamp_is_preserved_exactly(client, event, timestamp):
    event["occurredAt"] = timestamp
    response = client.post("/api/events", json=event)
    assert response.status_code == 201
    assert client.app.state.store.events[event["eventId"]].occurred_at == timestamp


def test_reordered_retry_preserves_first_record_and_received_at(client, event):
    assert client.post("/api/events", json=event).status_code == 201
    store = client.app.state.store
    first = store.events[event["eventId"]]

    retry = client.post("/api/events", json=dict(reversed(list(event.items()))))

    assert retry.status_code == 200
    assert retry.json() == {"accepted": True, "duplicate": True}
    assert len(store.events) == 1
    assert store.events[event["eventId"]] is first


@pytest.mark.parametrize("field,value", [
    ("eventName", "landing_viewed"),
    ("occurredAt", "2026-10-25T00:00:01Z"),
    ("occurredAt", "2026-10-25T00:00:00+00:00"),
])
def test_changed_valid_content_conflicts_without_replacing_first(client, event, field, value):
    assert client.post("/api/events", json=event).status_code == 201
    first = client.app.state.store.events[event["eventId"]]

    response = client.post("/api/events", json={**event, field: value})

    assert_business_error(response, 409, "EVENT_ID_CONFLICT")
    assert client.app.state.store.events == {event["eventId"]: first}
    assert client.app.state.store.events[event["eventId"]] is first


@pytest.mark.parametrize("known_click", [True, False])
def test_existing_id_changed_click_conflicts_before_click_lookup(client, event, known_click):
    assert client.post("/api/events", json=event).status_code == 201
    first = client.app.state.store.events[event["eventId"]]
    other_click = completed_click(client) if known_click else "unknown-click"

    response = client.post("/api/events", json={**event, "clickId": other_click})

    assert_business_error(response, 409, "EVENT_ID_CONFLICT")
    assert client.app.state.store.events[event["eventId"]] is first
    assert len(client.app.state.store.events) == 1


def test_new_event_with_unknown_click_is_not_saved(client, event):
    response = client.post("/api/events", json={**event, "clickId": "unknown-click"})
    assert_business_error(response, 404, "CLICK_NOT_FOUND")
    assert not client.app.state.store.events


def test_same_click_can_have_multiple_events_in_any_order(client, event):
    for index, name in enumerate(["landing_viewed", "cta_clicked", "cta_shown", "cta_clicked"]):
        response = client.post("/api/events", json={
            **event, "eventId": f"action-{index}", "eventName": name,
        })
        assert response.status_code == 201
    assert len(client.app.state.store.events) == 4
    assert {record.click_id for record in client.app.state.store.events.values()} == {event["clickId"]}


@pytest.mark.parametrize("field", ["eventId", "eventName", "clickId", "occurredAt"])
def test_required_fields_are_validated_before_storage(client, event, field):
    del event[field]
    response = client.post("/api/events", json=event)
    assert response.status_code == 422
    assert isinstance(response.json()["detail"], list)
    assert not client.app.state.store.events


@pytest.mark.parametrize("field", ["eventId", "clickId"])
@pytest.mark.parametrize("value", ["", " \t", 1, True, None])
def test_identifiers_are_nonempty_strict_strings(client, event, field, value):
    response = client.post("/api/events", json={**event, field: value})
    assert response.status_code == 422
    assert isinstance(response.json()["detail"], list)
    assert not client.app.state.store.events


@pytest.mark.parametrize("name", ["test_drive_requested", "unknown", "", True, None])
def test_server_only_and_invalid_event_names_are_rejected(client, event, name):
    response = client.post("/api/events", json={**event, "eventName": name})
    assert response.status_code == 422
    assert isinstance(response.json()["detail"], list)
    assert not client.app.state.store.events


@pytest.mark.parametrize("timestamp", [
    "", " ", "not-a-date", "2026-10-25", "2026-10-25T00:00:00",
    "2026-02-30T00:00:00Z", "2026-10-25X00:00:00Z",
    "2026-10-25T00:00:00+09:60", "2026-10-25T00:00:00+24:00",
    "1792886400", 1792886400, True, None, [], {},
])
def test_invalid_or_naive_timestamps_are_serializable_422(client, event, timestamp):
    response = client.post("/api/events", json={**event, "occurredAt": timestamp})
    assert response.status_code == 422
    assert isinstance(response.json()["detail"], list)
    assert not client.app.state.store.events


@pytest.mark.parametrize("token", ["NaN", "Infinity", "-Infinity", "1e999"])
def test_nonfinite_timestamp_input_keeps_422_json_contract(client, event, token):
    payload = json.dumps({**event, "occurredAt": "RAW_NONFINITE"}).replace('"RAW_NONFINITE"', token)
    response = client.post("/api/events", content=payload, headers={"Content-Type": "application/json"})
    assert response.status_code == 422
    assert isinstance(response.json()["detail"], list)
    assert not client.app.state.store.events


def test_schema_validation_precedes_existing_event_lookup(client, event):
    assert client.post("/api/events", json=event).status_code == 201
    first = client.app.state.store.events[event["eventId"]]
    response = client.post("/api/events", json={
        **event, "eventName": "test_drive_requested", "clickId": "unknown-click",
    })
    assert response.status_code == 422
    assert isinstance(response.json()["detail"], list)
    assert client.app.state.store.events[event["eventId"]] is first


def concurrent_posts(client, bodies):
    barrier = threading.Barrier(len(bodies))

    def send(body):
        barrier.wait(timeout=5)
        response = client.post("/api/events", json=body)
        return body, response

    with ThreadPoolExecutor(max_workers=len(bodies)) as executor:
        return list(executor.map(send, bodies))


def test_simultaneous_identical_events_store_once(client, event):
    results = concurrent_posts(client, [event.copy() for _ in range(12)])
    statuses = [response.status_code for _, response in results]
    assert statuses.count(201) == 1
    assert statuses.count(200) == 11
    for _, response in results:
        assert response.json() == {"accepted": True, "duplicate": response.status_code == 200}
    assert len(client.app.state.store.events) == 1


def test_simultaneous_conflicting_events_preserve_the_winner(client, event):
    bodies = [{**event, "occurredAt": f"2026-10-25T00:00:{index:02d}Z"} for index in range(12)]
    results = concurrent_posts(client, bodies)
    statuses = [response.status_code for _, response in results]
    assert statuses.count(201) == 1
    assert statuses.count(409) == 11
    winner = next(body for body, response in results if response.status_code == 201)
    for _, response in results:
        if response.status_code == 409:
            assert_business_error(response, 409, "EVENT_ID_CONFLICT")
    record = client.app.state.store.events[event["eventId"]]
    assert record.occurred_at == winner["occurredAt"]
    assert len(client.app.state.store.events) == 1
    retry = client.post("/api/events", json=winner)
    assert retry.status_code == 200
    assert client.app.state.store.events[event["eventId"]] is record


def test_only_newly_accepted_event_is_logged(client, event, caplog):
    with caplog.at_level(logging.INFO, logger="uvicorn.error"):
        assert client.post("/api/events", json=event).status_code == 201
        assert client.post("/api/events", json=event).status_code == 200
        assert client.post("/api/events", json={**event, "eventName": "landing_viewed"}).status_code == 409
    matching = [record.getMessage() for record in caplog.records if "eventId=" + event["eventId"] in record.getMessage()]
    assert len(matching) == 1
    assert "eventName=" + event["eventName"] in matching[0]
    assert "clickId=" + event["clickId"] in matching[0]


def test_restarted_server_has_no_events_or_old_clicks(client, client_factory, event):
    assert client.post("/api/events", json=event).status_code == 201
    restarted = client_factory()
    response = restarted.post("/api/events", json=event)
    assert_business_error(response, 404, "CLICK_NOT_FOUND")
    assert not restarted.app.state.store.events
    assert not restarted.app.state.store.click_links
