from dataclasses import replace
from datetime import datetime, timezone
import logging
import secrets

from app.demo_config import CREATIVE, TOLERANCE_X, TOLERANCE_Y
from app.schemas.captcha import StartResponse, VerifyMiss, VerifyPassed, VerifyRequest
from app.store import Challenge, ClickLink, Store

logger = logging.getLogger("uvicorn.error")


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


def start_challenge(store: Store, creative_id: str) -> StartResponse:
    if creative_id != CREATIVE.creativeId:
        raise CaptchaNotFound("CREATIVE_NOT_FOUND", "요청한 광고 소재가 없습니다.")
    with store.lock:
        challenge_id = unique_id("ch_", store.challenges)
        store.challenges[challenge_id] = Challenge(
            creative_id=creative_id, created_at=datetime.now(timezone.utc),
        )
        response = StartResponse(challengeId=challenge_id, creative=CREATIVE)
    return response


def verify_challenge(store: Store, request: VerifyRequest) -> VerifyMiss | VerifyPassed:
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

