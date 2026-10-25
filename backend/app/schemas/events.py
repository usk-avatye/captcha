from typing import Annotated, Literal

from pydantic import AwareDatetime, BaseModel, Field, TypeAdapter, field_validator

from app.schemas.captcha import Identifier

ClientEventName = Literal["cta_shown", "cta_clicked", "landing_viewed"]
_aware_datetime = TypeAdapter(AwareDatetime)


class EventRequest(BaseModel):
    eventId: Identifier
    eventName: ClientEventName
    clickId: Identifier
    occurredAt: Annotated[str, Field(strict=True)]

    @field_validator("occurredAt")
    @classmethod
    def validate_timestamp(cls, value: str) -> str:
        # 숫자 문자열을 Unix 시각으로 받지 않는다. ISO 문자열의 원문은 그대로 저장한다.
        if "T" not in value:
            raise ValueError("occurredAt은 시간대가 있는 ISO 8601 날짜·시각 문자열이어야 합니다.")
        _aware_datetime.validate_python(value)
        return value


class EventResponse(BaseModel):
    accepted: Literal[True] = True
    duplicate: bool
