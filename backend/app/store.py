from dataclasses import dataclass, field
from datetime import datetime
from threading import Lock
from typing import Literal


@dataclass(frozen=True)
class Challenge:
    creative_id: str
    created_at: datetime
    status: Literal["pending", "passed"] = "pending"
    completion_id: str | None = None
    click_id: str | None = None


@dataclass(frozen=True)
class ClickLink:
    challenge_id: str
    completion_id: str


@dataclass(frozen=True)
class EventRecord:
    event_name: str
    click_id: str
    occurred_at: str
    received_at: datetime


@dataclass
class Store:
    # 조회, 중복 확인, 성공 결과와 연결 저장까지 같은 잠금으로 보호한다.
    lock: Lock = field(default_factory=Lock)
    challenges: dict[str, Challenge] = field(default_factory=dict)
    click_links: dict[str, ClickLink] = field(default_factory=dict)
    events: dict[str, EventRecord] = field(default_factory=dict)

