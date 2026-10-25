"""HTTP 계약, 서버 상태 및 응답 유실/동시 요청의 멱등성을 검증한다."""
from concurrent.futures import ThreadPoolExecutor
import math
import threading

import asyncio
import httpx
import pytest

from app.main import create_app

TARGET_X = 0.2742224880382775  # 공개 lampRect의 x + width/2, binary64 경계
TARGET_Y = 408 / 941
TOLERANCE_X = 12 / 1672
TOLERANCE_Y = 8 / 941


class ApiClient:
    def __init__(self, app):
        self.app = app

    def post(self, path, **kwargs):
        async def send():
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=self.app), base_url="http://test",
            ) as client:
                return await client.post(path, **kwargs)
        return asyncio.run(send())


@pytest.fixture
def client():
    return ApiClient(create_app())


def start(client):
    response = client.post("/api/challenges", json={"creativeId": "bmw-m3-v1"})
    assert response.status_code == 201
    return response.json()


def verify(client, challenge_id, x=TARGET_X, y=TARGET_Y):
    return client.post("/api/verify", json={"challengeId": challenge_id, "dropX": x, "dropY": y})


def test_start_publishes_render_contract_without_tolerance(client):
    data = start(client)
    creative = data["creative"]
    assert data["challengeId"].startswith("ch_")
    assert set(creative) == {
        "creativeId", "version", "imageUrl", "coverUrl", "pieceUrl",
        "sourceWidth", "sourceHeight", "lampRect", "zoomRect",
        "brandTitle", "tagline", "ctaLabel", "landingPath", "snapMs", "revealMs",
    }
    assert creative["sourceWidth"] == 1672
    assert creative["sourceHeight"] == 941
    assert creative["lampRect"]["x"] == 347 / 1672
    assert creative["zoomRect"]["width"] == creative["zoomRect"]["height"]
    record = client.app.state.store.challenges[data["challengeId"]]
    assert record.status == "pending"
    assert record.created_at.tzinfo is not None
    assert record.completion_id is None and record.click_id is None
    assert start(client)["challengeId"] != data["challengeId"]


def test_miss_then_success_stores_both_ids_and_link_before_return(client):
    challenge_id = start(client)["challengeId"]
    assert verify(client, challenge_id, 0, 0).json() == {"passed": False}
    store = client.app.state.store
    assert store.challenges[challenge_id].status == "pending"
    assert len(store.click_links) == 0
    response = verify(client, challenge_id)
    assert response.status_code == 200
    result = response.json()
    assert result["passed"] is True
    assert result["completionId"].startswith("cmp_")
    assert result["clickId"].startswith("clk_")
    record = store.challenges[challenge_id]
    link = store.click_links[result["clickId"]]
    assert record.status == "passed"
    assert (record.completion_id, record.click_id) == (result["completionId"], result["clickId"])
    assert (link.challenge_id, link.completion_id) == (challenge_id, result["completionId"])


def test_retry_or_other_valid_coordinates_reuse_success_ids(client):
    challenge_id = start(client)["challengeId"]
    first = verify(client, challenge_id).json()
    assert verify(client, challenge_id).json() == first
    assert verify(client, challenge_id, 1, 0).json() == first
    assert len(client.app.state.store.click_links) == 1
    invalid = verify(client, challenge_id, "0.5", 0)
    assert invalid.status_code == 422
    assert verify(client, challenge_id).json() == first


@pytest.mark.parametrize("axis", ["x", "y"])
@pytest.mark.parametrize("direction", [-1, 1])
@pytest.mark.parametrize("position", ["inside", "boundary", "outside"])
def test_each_axis_has_inclusive_tolerance(client, axis, direction, position):
    target, tolerance = (TARGET_X, TOLERANCE_X) if axis == "x" else (TARGET_Y, TOLERANCE_Y)
    boundary = target + direction * tolerance
    coordinate = boundary if position == "boundary" else math.nextafter(
        boundary, target if position == "inside" else (-math.inf if direction < 0 else math.inf)
    )
    x, y = (coordinate, TARGET_Y) if axis == "x" else (TARGET_X, coordinate)
    response = verify(client, start(client)["challengeId"], x, y)
    assert response.status_code == 200
    assert response.json()["passed"] is (position != "outside")


@pytest.mark.parametrize("coordinate", [-0.01, 1.01, "0.5", True, False, None, [], {}])
@pytest.mark.parametrize("axis", ["dropX", "dropY"])
def test_bad_coordinates_are_422_and_do_not_mutate(client, coordinate, axis):
    challenge_id = start(client)["challengeId"]
    body = {"challengeId": challenge_id, "dropX": TARGET_X, "dropY": TARGET_Y, axis: coordinate}
    response = client.post("/api/verify", json=body)
    assert response.status_code == 422
    assert isinstance(response.json()["detail"], list)
    assert client.app.state.store.challenges[challenge_id].status == "pending"
    assert len(client.app.state.store.click_links) == 0


@pytest.mark.parametrize("token", ["NaN", "Infinity", "-Infinity", "1e999"])
def test_non_finite_json_is_serializable_422(client, token):
    challenge_id = start(client)["challengeId"]
    body = '{"challengeId":"' + challenge_id + '","dropX":' + token + ',"dropY":0.4}'
    response = client.post("/api/verify", content=body, headers={"Content-Type": "application/json"})
    assert response.status_code == 422
    assert isinstance(response.json()["detail"], list)
    assert len(client.app.state.store.click_links) == 0


@pytest.mark.parametrize("payload", [{}, {"creativeId": ""}, {"creativeId": "  "}, {"creativeId": 1}, {"creativeId": True}])
def test_start_rejects_malformed_request(client, payload):
    response = client.post("/api/challenges", json=payload)
    assert response.status_code == 422
    assert len(client.app.state.store.challenges) == 0


def test_missing_resources_and_missing_verify_fields(client):
    missing_creative = client.post("/api/challenges", json={"creativeId": "missing"})
    assert missing_creative.status_code == 404
    assert missing_creative.json()["detail"]["code"] == "CREATIVE_NOT_FOUND"
    missing_challenge = verify(client, "old-or-unknown")
    assert missing_challenge.status_code == 404
    assert missing_challenge.json()["detail"]["code"] == "CHALLENGE_NOT_FOUND"
    for body in ({}, {"challengeId": "", "dropX": 0, "dropY": 0},
                 {"challengeId": 1, "dropX": 0, "dropY": 0},
                 {"challengeId": "ch_x", "dropY": 0}):
        assert client.post("/api/verify", json=body).status_code == 422


def test_simultaneous_success_produces_one_id_pair(client):
    challenge_id = start(client)["challengeId"]
    barrier = threading.Barrier(12)
    def submit(_):
        barrier.wait(timeout=5)
        response = verify(client, challenge_id)
        assert response.status_code == 200
        return response.json()
    with ThreadPoolExecutor(max_workers=12) as executor:
        results = list(executor.map(submit, range(12)))
    assert all(value == results[0] for value in results)
    assert results[0]["passed"] is True
    assert len(client.app.state.store.click_links) == 1


def test_new_server_store_does_not_recognize_old_challenge(client):
    challenge_id = start(client)["challengeId"]
    restarted = ApiClient(create_app())
    response = verify(restarted, challenge_id)
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "CHALLENGE_NOT_FOUND"

