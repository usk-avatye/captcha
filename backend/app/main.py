import math

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.api.routes.captcha import router as captcha_router
from app.api.routes.events import router as events_router
from app.api.routes.demo import router as demo_router
from app.store import Store


def create_app() -> FastAPI:
    app = FastAPI(title="CAPTCHAvatye PoC")
    app.state.store = Store()
    app.include_router(captcha_router)
    app.include_router(events_router)
    app.include_router(demo_router)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_request: Request, error: RequestValidationError):
        # 422 detail 배열은 유지한다. 비유한 입력값만 JSON이 표현할 수 있는 문자열로 바꾼다.
        detail = jsonable_encoder(error.errors(), custom_encoder={
            float: lambda value: value if math.isfinite(value) else str(value),
        })
        return JSONResponse(status_code=422, content={"detail": detail})

    return app


app = create_app()

