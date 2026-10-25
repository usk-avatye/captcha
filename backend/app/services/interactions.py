from datetime import datetime, timezone

from app.persistence import PostgresStore
from app.schemas.events import EventResponse
from app.schemas.interactions import InteractionSummaryRequest
from app.services.events import EventRejected
from app.store import InteractionRecord, Store


def check_revision(revision: int, metrics: dict, existing_revision: int, existing_metrics: dict) -> bool:
    if revision == existing_revision and metrics != existing_metrics:
        raise EventRejected(409, 'SUMMARY_REVISION_CONFLICT', '같은 revision에 다른 내용이 저장되어 있습니다.')
    return revision <= existing_revision


def collect_interaction(store: Store | PostgresStore, request: InteractionSummaryRequest) -> EventResponse:
    now = datetime.now(timezone.utc)
    if isinstance(store, PostgresStore):
        return store.collect_interaction(request, now)
    metrics = request.metrics.model_dump()
    with store.lock:
        if request.challengeId not in store.challenges:
            raise EventRejected(404, 'CHALLENGE_NOT_FOUND', '인증 ID를 찾을 수 없습니다.')
        existing = store.interactions.get(request.challengeId)
        if existing and check_revision(request.revision, metrics, existing.revision, existing.metrics):
            return EventResponse(duplicate=True)
        store.interactions[request.challengeId] = InteractionRecord(request.revision, metrics, now)
    return EventResponse(duplicate=False)
