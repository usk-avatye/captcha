from datetime import datetime, timezone
import logging

from app.schemas.events import EventRequest, EventResponse
from app.store import EventRecord, Store
from app.persistence import PostgresStore

logger = logging.getLogger("uvicorn.error")


class EventRejected(Exception):
    def __init__(self, status_code: int, code: str, message: str):
        self.status_code = status_code
        self.code = code
        self.message = message
        super().__init__(message)


def collect_event(store: Store | PostgresStore, request: EventRequest) -> EventResponse:
    if isinstance(store, PostgresStore):
        return store.collect_event(request, datetime.now(timezone.utc))
    with store.lock:
        existing = store.events.get(request.eventId)
        if existing is not None:
            if (existing.event_name, existing.click_id, existing.occurred_at) != (
                request.eventName, request.clickId, request.occurredAt,
            ):
                raise EventRejected(409, "EVENT_ID_CONFLICT", "같은 이벤트 ID에 다른 내용이 이미 저장되어 있습니다.")
            return EventResponse(duplicate=True)

        # 기존 ID의 중복·충돌 판정을 마친 뒤, 새 이벤트에만 연결 존재를 확인한다.
        if request.clickId not in store.click_links:
            raise EventRejected(404, "CLICK_NOT_FOUND", "인증 연결이 없습니다. 데모를 처음부터 시작해 주세요.")
        store.events[request.eventId] = EventRecord(
            event_name=request.eventName,
            click_id=request.clickId,
            occurred_at=request.occurredAt,
            received_at=datetime.now(timezone.utc),
        )

    # 실제로 추가한 이벤트만 잠금 밖에서 기록한다. 재전송은 새 건수를 만들지 않는다.
    logger.info("event_accepted eventId=%s eventName=%s clickId=%s",
                request.eventId, request.eventName, request.clickId)
    return EventResponse(duplicate=False)
