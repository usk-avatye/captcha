"""CAPTCHAvatye 고객사 서버 전용 API."""

import hmac
import os

from fastapi import APIRouter, HTTPException, Request

from app.schemas.captcha import (
    InternalStartRequest,
    InternalStartResponse,
    InternalVerifyRequest,
    InternalVerifyResponse,
)
from app.services.captcha import (
    CaptchaNotFound,
    start_private_challenge,
    verify_bound_completion,
)

router = APIRouter(prefix="/internal")
MINIMUM_KEY_LENGTH = 32


def _authorize(request: Request) -> None:
    configured = os.environ.get("CAPTCHAVATYE_SERVICE_KEY", "")
    if len(configured) < MINIMUM_KEY_LENGTH:
        raise HTTPException(503, detail={
            "code": "SERVICE_AUTH_NOT_CONFIGURED",
            "message": "고객사 서버 인증 설정이 필요합니다.",
        })
    authorization = request.headers.get("Authorization", "")
    scheme, _, supplied = authorization.partition(" ")
    if scheme.lower() != "bearer" or not hmac.compare_digest(supplied, configured):
        raise HTTPException(401, detail={
            "code": "SERVICE_AUTH_REQUIRED",
            "message": "고객사 서버 인증이 필요합니다.",
        })


@router.post("/challenges", status_code=201, response_model=InternalStartResponse)
def create_private_challenge(body: InternalStartRequest, request: Request):
    _authorize(request)
    try:
        return start_private_challenge(request.app.state.store, body.creativeId, body.subject)
    except CaptchaNotFound as error:
        raise HTTPException(404, detail={"code": error.code, "message": error.message}) from error


@router.post("/completions/verify", response_model=InternalVerifyResponse)
def verify_private_completion(body: InternalVerifyRequest, request: Request):
    _authorize(request)
    if not verify_bound_completion(
        request.app.state.store, body.challengeId, body.completionId, body.subject,
    ):
        raise HTTPException(403, detail={
            "code": "CAPTCHA_INVALID",
            "message": "인증 완료 정보가 유효하지 않거나 만료되었습니다.",
        })
    return InternalVerifyResponse(
        challengeId=body.challengeId, completionId=body.completionId, subject=body.subject,
    )
