from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.captcha import Identifier

Milliseconds = Annotated[int, Field(strict=True, ge=0, le=86_400_000)]
Coordinate = Annotated[float, Field(strict=True, ge=0, le=1, allow_inf_nan=False)]


class PathPoint(BaseModel):
    model_config = ConfigDict(extra='forbid')
    x: Coordinate
    y: Coordinate
    t: Milliseconds
    drag: Annotated[int, Field(strict=True, ge=1, le=1000)]


class InteractionMetrics(BaseModel):
    model_config = ConfigDict(extra='forbid')
    firstInteractionMs: Milliseconds | None
    solveMs: Milliseconds | None
    missCount: Annotated[int, Field(strict=True, ge=0, le=1000)]
    path: Annotated[list[PathPoint], Field(max_length=100)] | None

    @model_validator(mode='after')
    def ordered_path(self):
        if self.path and any(a.t > b.t or a.drag > b.drag for a, b in zip(self.path, self.path[1:])):
            raise ValueError('경로는 시간과 드래그 순서대로 보내야 합니다.')
        return self


class InteractionSummaryRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    challengeId: Identifier
    revision: Annotated[int, Field(strict=True, ge=1, le=2_147_483_647)]
    metrics: InteractionMetrics
