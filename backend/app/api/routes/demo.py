from fastapi import APIRouter, HTTPException, Request, Response

from app.schemas.demo import TestDriveRequest, TestDriveResponse
from app.services.demo import DemoRejected, request_test_drive

router = APIRouter(prefix="/api/demo")


@router.post(
    "/test-drives", status_code=201, response_model=TestDriveResponse,
    responses={200: {"model": TestDriveResponse, "description": "이미 완료한 동일 모의 신청"}},
)
def create_test_drive(body: TestDriveRequest, request: Request, response: Response):
    try:
        result, created = request_test_drive(request.app.state.store, body)
    except DemoRejected as error:
        raise HTTPException(
            error.status_code, detail={"code": error.code, "message": error.message},
        ) from error
    response.status_code = 201 if created else 200
    return result
