from dataclasses import replace
from datetime import datetime, timedelta, timezone
import logging
import secrets

from app.demo_config import CREATIVE, TOLERANCE_X, TOLERANCE_Y
from app.schemas.captcha import InternalStartResponse, StartResponse, VerifyMiss, VerifyPassed, VerifyRequest
from app.persistence import PostgresStore
from app.store import Challenge, ClickLink, Store

logger = logging.getLogger("uvicorn.error")
PRIVATE_CLIENT_ID = "meeting-room"


class CaptchaNotFound(Exception):
    def __init__(self, code: str, message: str):
        self.code = code
        self.message = message
        super().__init__(message)


def unique_id(prefix: str, occupied: set[str] | dict) -> str:
    while True:
        candidate = prefix + secrets.token_urlsafe(18)
        if candidate not in occupied:
            return candidate


def start_challenge(store: Store | PostgresStore, creative_id: str, *, subject: str | None = None) -> StartResponse:
    if creative_id != CREATIVE.creativeId:
        raise CaptchaNotFound("CREATIVE_NOT_FOUND", "요청한 광고 소재가 없습니다.")
    now = datetime.now(timezone.utc)
    if isinstance(store, PostgresStore):
        challenge_id = unique_id("ch_", set())
        expires_at = store.start_challenge(
            challenge_id, creative_id, now,
            PRIVATE_CLIENT_ID if subject is not None else None, subject,
        )
    else:
        with store.lock:
            challenge_id = unique_id("ch_", store.challenges)
            expires_at = now + timedelta(minutes=10) if subject is not None else None
            store.challenges[challenge_id] = Challenge(
                creative_id=creative_id, created_at=now,
                client_id=PRIVATE_CLIENT_ID if subject is not None else None,
                subject=subject, expires_at=expires_at,
            )
    response = StartResponse(challengeId=challenge_id, creative=CREATIVE)
    return response


def start_private_challenge(store: Store | PostgresStore, creative_id: str,
                            subject: str) -> InternalStartResponse:
    if creative_id != CREATIVE.creativeId:
        raise CaptchaNotFound("CREATIVE_NOT_FOUND", "요청한 광고 소재가 없습니다.")
    now = datetime.now(timezone.utc)
    challenge_id = unique_id("ch_", set())
    expires_at = now + timedelta(minutes=10)
    if isinstance(store, PostgresStore):
        store.start_challenge(challenge_id, creative_id, now, PRIVATE_CLIENT_ID, subject)
    else:
        with store.lock:
            challenge_id = unique_id("ch_", store.challenges)
            store.challenges[challenge_id] = Challenge(
                creative_id=creative_id, created_at=now, client_id=PRIVATE_CLIENT_ID,
                subject=subject, expires_at=expires_at,
            )
    return InternalStartResponse(
        challengeId=challenge_id, creative=CREATIVE, expiresAt=expires_at,
    )


def verify_challenge(store: Store | PostgresStore, request: VerifyRequest) -> VerifyMiss | VerifyPassed:
    if isinstance(store, PostgresStore):
        challenge_id = request.challengeId
        candidate_completion_id = unique_id("cmp_", set())
        candidate_click_id = unique_id("clk_", set())
        result = store.verify_challenge(request, candidate_completion_id, candidate_click_id)
        if result is None:
            raise CaptchaNotFound("CHALLENGE_NOT_FOUND", "인증 정보가 없습니다. 데모를 처음부터 시작해 주세요.")
        if result.passed and result.completionId == candidate_completion_id:
            logger.info("captcha_passed challengeId=%s completionId=%s clickId=%s",
                        challenge_id, candidate_completion_id, candidate_click_id)
        return result

    with store.lock:
        challenge = store.challenges.get(request.challengeId)
        if challenge is None:
            raise CaptchaNotFound("CHALLENGE_NOT_FOUND", "인증 정보가 없습니다. 데모를 처음부터 시작해 주세요.")
        if challenge.status == "passed":
            return VerifyPassed(completionId=challenge.completion_id, clickId=challenge.click_id)

        lamp = CREATIVE.lampRect
        target_x = lamp.x + lamp.width / 2
        target_y = lamp.y + lamp.height / 2
        # abs(delta) <= tolerance와 같은 구간 판정. 부동소수점 경계는 포함한다.
        if not (target_x - TOLERANCE_X <= request.dropX <= target_x + TOLERANCE_X
                and target_y - TOLERANCE_Y <= request.dropY <= target_y + TOLERANCE_Y):
            return VerifyMiss()

        completion_id = unique_id("cmp_", {c.completion_id for c in store.challenges.values() if c.completion_id})
        click_id = unique_id("clk_", store.click_links)
        store.challenges[request.challengeId] = replace(
            challenge, status="passed", completion_id=completion_id, click_id=click_id,
        )
        store.click_links[click_id] = ClickLink(request.challengeId, completion_id)
        response = VerifyPassed(completionId=completion_id, clickId=click_id)

    # 신규 성공만 남긴다. 중복 응답은 성공 건수를 늘리지 않는다.
    logger.info("captcha_passed challengeId=%s completionId=%s clickId=%s",
                request.challengeId, completion_id, click_id)
    return response


def verify_bound_completion(store: Store | PostgresStore, challenge_id: str,
                            completion_id: str, subject: str) -> bool:
    now = datetime.now(timezone.utc)
    if isinstance(store, PostgresStore):
        return store.verify_bound_completion(
            challenge_id, completion_id, PRIVATE_CLIENT_ID, subject, now,
        )
    with store.lock:
        challenge = store.challenges.get(challenge_id)
        return bool(
            challenge is not None
            and challenge.client_id == PRIVATE_CLIENT_ID
            and challenge.subject == subject
            and challenge.status == "passed"
            and challenge.completion_id == completion_id
            and challenge.expires_at is not None
            and challenge.expires_at > now
        )

