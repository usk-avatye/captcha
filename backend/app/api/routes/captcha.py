from fastapi import APIRouter, HTTPException, Request

from app.schemas.captcha import StartRequest, StartResponse, VerifyMiss, VerifyPassed, VerifyRequest
from app.services.captcha import CaptchaNotFound, start_challenge, verify_challenge

router = APIRouter(prefix="/api")


@router.post("/challenges", status_code=201, response_model=StartResponse)
def start(body: StartRequest, request: Request):
    try:
        return start_challenge(request.app.state.store, body.creativeId)
    except CaptchaNotFound as error:
        raise HTTPException(404, detail={"code": error.code, "message": error.message}) from error


@router.post("/verify", response_model=VerifyMiss | VerifyPassed)
def verify(body: VerifyRequest, request: Request):
    try:
        return verify_challenge(request.app.state.store, body)
    except CaptchaNotFound as error:
        raise HTTPException(404, detail={"code": error.code, "message": error.message}) from error

