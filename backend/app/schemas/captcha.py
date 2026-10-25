from typing import Annotated, Literal
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field

Identifier = Annotated[str, Field(strict=True, min_length=1, pattern=r"\S")]
Coordinate = Annotated[float, Field(strict=True, ge=0, le=1, allow_inf_nan=False)]
Subject = Annotated[str, Field(strict=True, min_length=1, max_length=255, pattern=r"\S")]


class StartRequest(BaseModel):
    creativeId: Identifier


class VerifyRequest(BaseModel):
    challengeId: Identifier
    dropX: Coordinate
    dropY: Coordinate


class NormalizedRect(BaseModel):
    model_config = ConfigDict(frozen=True)
    x: Coordinate
    y: Coordinate
    width: Annotated[float, Field(gt=0, le=1)]
    height: Annotated[float, Field(gt=0, le=1)]


class Creative(BaseModel):
    model_config = ConfigDict(frozen=True)
    creativeId: str
    version: str
    imageUrl: str
    coverUrl: str
    pieceUrl: str
    sourceWidth: int
    sourceHeight: int
    lampRect: NormalizedRect
    zoomRect: NormalizedRect
    brandTitle: str
    tagline: str
    ctaLabel: str
    landingPath: str
    snapMs: int
    revealMs: int


class StartResponse(BaseModel):
    challengeId: str
    creative: Creative


class VerifyMiss(BaseModel):
    passed: Literal[False] = False


class VerifyPassed(BaseModel):
    passed: Literal[True] = True
    completionId: str
    clickId: str


class InternalStartRequest(StartRequest):
    subject: Subject


class InternalStartResponse(StartResponse):
    expiresAt: AwareDatetime


class InternalVerifyRequest(BaseModel):
    challengeId: Identifier
    completionId: Identifier
    subject: Subject


class InternalVerifyResponse(BaseModel):
    passed: Literal[True] = True
    challengeId: str
    completionId: str
    subject: str

