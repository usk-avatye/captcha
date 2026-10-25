from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError

from app.schemas.events import EventResponse
from app.schemas.interactions import InteractionSummaryRequest
from app.services.events import EventRejected
from app.services.interactions import collect_interaction

router = APIRouter(prefix='/api')


async def read_summary(request: Request) -> InteractionSummaryRequest:
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > 16 * 1024:
            raise HTTPException(413, detail='요약 본문은 16KiB까지 전송할 수 있습니다.')
        body.extend(chunk)
    try:
        return InteractionSummaryRequest.model_validate_json(body)
    except ValidationError as error:
        raise RequestValidationError(error.errors(include_input=False)) from error


@router.post('/interaction-summaries', status_code=201, response_model=EventResponse)
def create_summary(request: Request, response: Response, body: InteractionSummaryRequest = Depends(read_summary)):
    try:
        result = collect_interaction(request.app.state.store, body)
    except EventRejected as error:
        raise HTTPException(error.status_code, detail={'code': error.code, 'message': error.message}) from error
    response.status_code = 200 if result.duplicate else 201
    return result
