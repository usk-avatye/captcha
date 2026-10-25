from fastapi import APIRouter, HTTPException, Request, Response

from app.schemas.events import EventRequest, EventResponse
from app.services.events import EventRejected, collect_event

router = APIRouter(prefix="/api")


@router.post(
    "/events", status_code=201, response_model=EventResponse,
    responses={200: {"model": EventResponse, "description": "이미 저장한 동일 이벤트"}},
)
def create_event(body: EventRequest, request: Request, response: Response):
    try:
        result = collect_event(request.app.state.store, body)
    except EventRejected as error:
        raise HTTPException(
            error.status_code, detail={"code": error.code, "message": error.message},
        ) from error
    response.status_code = 200 if result.duplicate else 201
    return result
