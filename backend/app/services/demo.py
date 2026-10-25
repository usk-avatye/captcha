from datetime import datetime, timezone
import logging

from app.schemas.demo import TestDriveRequest, TestDriveResponse
from app.services.captcha import unique_id
from app.store import EventRecord, LeadRecord, Store
from app.persistence import PostgresStore

logger = logging.getLogger("uvicorn.error")


class DemoRejected(Exception):
    def __init__(self, status_code: int, code: str, message: str):
        self.status_code = status_code
        self.code = code
        self.message = message
        super().__init__(message)


def _response(lead: LeadRecord) -> TestDriveResponse:
    return TestDriveResponse(
        leadId=lead.lead_id, clickId=lead.click_id,
        locationId=lead.location_id, slotId=lead.slot_id,
        status=lead.status, isDemo=lead.is_demo,
    )


def request_test_drive(store: Store | PostgresStore, request: TestDriveRequest) -> tuple[TestDriveResponse, bool]:
    """완료 응답과 신규 생성 여부를 반환한다. 재전송은 기존 결과를 그대로 사용한다."""
    if isinstance(store, PostgresStore):
        result = store.request_test_drive(request, datetime.now(timezone.utc))
        if result[1]:
            logger.info("test_drive_completed clickId=%s leadId=%s", request.clickId, result[0].leadId)
        return result
    with store.lock:
        link = store.click_links.get(request.clickId)
        challenge = store.challenges.get(link.challenge_id) if link is not None else None
        if (link is None or challenge is None or challenge.status != "passed"
                or not challenge.completion_id or challenge.completion_id != link.completion_id
                or challenge.click_id != request.clickId):
            raise DemoRejected(404, "CLICK_NOT_FOUND", "유효한 인증 연결이 없습니다. 데모를 처음부터 시작해 주세요.")

        existing = store.leads.get(request.clickId)
        if existing is not None:
            if (existing.location_id, existing.slot_id) != (request.locationId, request.slotId):
                raise DemoRejected(409, "LEAD_CONFLICT", "이미 완료된 모의 신청의 지점과 시간은 변경할 수 없습니다.")
            return _response(existing), False

        lead_id = unique_id("lead_", {lead.lead_id for lead in store.leads.values()})
        event_id = unique_id("ev_", store.events)
        completed_at = datetime.now(timezone.utc)
        lead = LeadRecord(
            lead_id=lead_id, click_id=request.clickId,
            location_id=request.locationId, slot_id=request.slotId,
            completed_at=completed_at,
        )
        conversion = EventRecord(
            event_name="test_drive_requested", click_id=request.clickId,
            occurred_at=completed_at.isoformat(), received_at=completed_at,
        )
        response = _response(lead)
        # 두 ID·레코드·응답 준비가 끝난 뒤 같은 잠금 안에서 함께 저장한다.
        # 클라이언트 이벤트 서비스 호출로 잠금을 다시 획득하지 않는다.
        store.leads[request.clickId] = lead
        store.events[event_id] = conversion

    logger.info("test_drive_completed challengeId=%s clickId=%s leadId=%s",
                link.challenge_id, request.clickId, lead_id)
    return response, True
