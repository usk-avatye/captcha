"""PostgreSQL 저장소. 프로세스 메모리 대신 요청별 SQL 트랜잭션을 사용한다."""

from datetime import datetime, timedelta, timezone
from hashlib import sha256

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    inspect,
    String,
    Text,
    UniqueConstraint,
    create_engine,
    select,
    text,
)
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

from app.demo_config import CREATIVE, TOLERANCE_X, TOLERANCE_Y
from app.schemas.captcha import StartResponse, VerifyMiss, VerifyPassed, VerifyRequest
from app.schemas.demo import TestDriveRequest, TestDriveResponse
from app.schemas.events import EventRequest, EventResponse
from app.store import EventRecord, LeadRecord


class Base(DeclarativeBase):
    pass


class ChallengeRow(Base):
    __tablename__ = "captcha_challenges"
    __table_args__ = (
        CheckConstraint(
            "(status = 'pending' AND completion_id IS NULL AND click_id IS NULL) OR "
            "(status = 'passed' AND completion_id IS NOT NULL AND click_id IS NOT NULL)",
            name="captcha_challenges_result_state",
        ),
        CheckConstraint(
            "(client_id IS NULL AND subject IS NULL AND expires_at IS NULL) OR "
            "(client_id IS NOT NULL AND subject IS NOT NULL AND expires_at IS NOT NULL)",
            name="captcha_challenges_private_binding",
        ),
    )

    challenge_id: Mapped[str] = mapped_column(String(100), primary_key=True)
    creative_id: Mapped[str] = mapped_column(String(100), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    completion_id: Mapped[str | None] = mapped_column(String(100), unique=True)
    click_id: Mapped[str | None] = mapped_column(String(100), unique=True)
    client_id: Mapped[str | None] = mapped_column(String(100))
    subject: Mapped[str | None] = mapped_column(String(255))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class EventRow(Base):
    __tablename__ = "captcha_events"

    # 외부 ID 원문은 보존하고 길이가 고정된 해시로 중복을 조회한다.
    event_key: Mapped[str] = mapped_column(String(64), primary_key=True)
    event_id: Mapped[str] = mapped_column(Text, nullable=False)
    event_name: Mapped[str] = mapped_column(String(64), nullable=False)
    click_id: Mapped[str] = mapped_column(
        ForeignKey("captcha_challenges.click_id", ondelete="RESTRICT"), nullable=False,
    )
    occurred_at: Mapped[str] = mapped_column(Text, nullable=False)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class LeadRow(Base):
    __tablename__ = "captcha_demo_leads"

    lead_id: Mapped[str] = mapped_column(String(120), primary_key=True)
    click_id: Mapped[str] = mapped_column(
        ForeignKey("captcha_challenges.click_id", ondelete="RESTRICT"), unique=True, nullable=False,
    )
    location_id: Mapped[str] = mapped_column(String(64), nullable=False)
    slot_id: Mapped[str] = mapped_column(String(64), nullable=False)
    completed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    is_demo: Mapped[bool] = mapped_column(nullable=False)


def _lead_response(row: LeadRow) -> TestDriveResponse:
    return TestDriveResponse(
        leadId=row.lead_id, clickId=row.click_id,
        locationId=row.location_id, slotId=row.slot_id,
        status="completed", isDemo=True,
    )


class PostgresStore:
    """각 업무 변경을 PostgreSQL 트랜잭션과 행 잠금으로 원자 처리한다."""

    def __init__(self, database_url: str | None):
        self.engine = create_engine(database_url, pool_pre_ping=True) if database_url else None
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False) if self.engine else None

    def _sessions(self) -> sessionmaker[Session]:
        if self.sessions is None:
            raise RuntimeError("CAPTCHAVATYE_DATABASE_URL을 설정해야 합니다.")
        return self.sessions

    def check_ready(self) -> None:
        sessions = self._sessions()
        with sessions() as session:
            names = set(inspect(session.bind).get_table_names())
            required = {"alembic_version", "captcha_challenges", "captcha_events", "captcha_demo_leads"}
            if not required <= names:
                missing = ", ".join(sorted(required - names))
                raise RuntimeError(f"CAPTCHAvatye DB migration is missing: {missing}")
            revision = session.execute(text("SELECT version_num FROM alembic_version")).scalar_one_or_none()
            if revision != "0003_event_keys":
                raise RuntimeError("CAPTCHAvatye DB is not at the required Alembic revision")
            session.execute(select(1))

    def start_challenge(self, challenge_id: str, creative_id: str, created_at: datetime,
                        client_id: str | None, subject: str | None) -> datetime | None:
        expires_at = created_at + timedelta(minutes=10) if client_id else None
        with self._sessions()() as session, session.begin():
            session.add(ChallengeRow(
                challenge_id=challenge_id, creative_id=creative_id, created_at=created_at,
                status="pending", client_id=client_id, subject=subject, expires_at=expires_at,
            ))
        return expires_at

    def verify_challenge(self, request: VerifyRequest, completion_id: str, click_id: str) -> VerifyMiss | VerifyPassed | None:
        """행을 잠근 동안 확인한다. None은 미등록 인증을 뜻한다."""
        lamp = CREATIVE.lampRect
        target_x, target_y = lamp.x + lamp.width / 2, lamp.y + lamp.height / 2
        with self._sessions()() as session:
            with session.begin():
                challenge = session.scalar(
                    select(ChallengeRow).where(
                        ChallengeRow.challenge_id == request.challengeId,
                    ).with_for_update()
                )
                if challenge is None:
                    return None
                if challenge.status == "passed":
                    return VerifyPassed(
                        completionId=challenge.completion_id, clickId=challenge.click_id,
                    )
                if not (target_x - TOLERANCE_X <= request.dropX <= target_x + TOLERANCE_X
                        and target_y - TOLERANCE_Y <= request.dropY <= target_y + TOLERANCE_Y):
                    return VerifyMiss()
                challenge.status = "passed"
                challenge.completion_id = completion_id
                challenge.click_id = click_id
                result = VerifyPassed(completionId=completion_id, clickId=click_id)
            return result

    def verify_bound_completion(self, challenge_id: str, completion_id: str,
                                client_id: str, subject: str, now: datetime) -> bool:
        with self._sessions()() as session:
            row = session.scalar(select(ChallengeRow).where(
                ChallengeRow.challenge_id == challenge_id,
                ChallengeRow.completion_id == completion_id,
                ChallengeRow.client_id == client_id,
                ChallengeRow.subject == subject,
                ChallengeRow.status == "passed",
                ChallengeRow.expires_at > now,
            ))
            return row is not None

    def collect_event(self, request: EventRequest, received_at: datetime) -> EventResponse:
        expected = (request.eventId, request.eventName, request.clickId, request.occurredAt)
        event_key = sha256(request.eventId.encode()).hexdigest()
        with self._sessions()() as session:
            try:
                with session.begin():
                    existing = session.get(EventRow, event_key)
                    if existing is not None:
                        actual = (existing.event_id, existing.event_name, existing.click_id, existing.occurred_at)
                        if actual != expected:
                            from app.services.events import EventRejected
                            raise EventRejected(409, "EVENT_ID_CONFLICT", "같은 이벤트 ID에 다른 내용이 이미 저장되어 있습니다.")
                        return EventResponse(duplicate=True)
                    if session.scalar(select(ChallengeRow.click_id).where(
                        ChallengeRow.click_id == request.clickId,
                    )) is None:
                        from app.services.events import EventRejected
                        raise EventRejected(404, "CLICK_NOT_FOUND", "인증 연결이 없습니다. 데모를 처음부터 시작해 주세요.")
                    session.add(EventRow(
                        event_key=event_key,
                        event_id=request.eventId, event_name=request.eventName,
                        click_id=request.clickId, occurred_at=request.occurredAt,
                        received_at=received_at,
                    ))
                    session.flush()
                return EventResponse(duplicate=False)
            except IntegrityError:
                session.rollback()
                # 같은 이벤트 ID 요청이 먼저 commit한 결과를 다시 읽는다.
                winner = session.get(EventRow, event_key)
                if winner is None:
                    raise
                if (winner.event_id, winner.event_name, winner.click_id, winner.occurred_at) != expected:
                    from app.services.events import EventRejected
                    raise EventRejected(409, "EVENT_ID_CONFLICT", "같은 이벤트 ID에 다른 내용이 이미 저장되어 있습니다.")
                return EventResponse(duplicate=True)

    def request_test_drive(self, request: TestDriveRequest, now: datetime) -> tuple[TestDriveResponse, bool]:
        with self._sessions()() as session:
            try:
                with session.begin():
                    challenge = session.scalar(select(ChallengeRow).where(
                        ChallengeRow.click_id == request.clickId,
                    ).with_for_update())
                    if challenge is None or challenge.status != "passed" or not challenge.completion_id:
                        from app.services.demo import DemoRejected
                        raise DemoRejected(404, "CLICK_NOT_FOUND", "유효한 인증 연결이 없습니다. 데모를 처음부터 시작해 주세요.")
                    existing = session.scalar(select(LeadRow).where(
                        LeadRow.click_id == request.clickId,
                    ))
                    if existing is not None:
                        if (existing.location_id, existing.slot_id) != (request.locationId, request.slotId):
                            from app.services.demo import DemoRejected
                            raise DemoRejected(409, "LEAD_CONFLICT", "이미 완료된 모의 신청의 지점과 시간은 변경할 수 없습니다.")
                        return _lead_response(existing), False

                    from app.services.captcha import unique_id
                    lead_id = unique_id("lead_", set())
                    event_id = unique_id("ev_", set())
                    lead = LeadRow(
                        lead_id=lead_id, click_id=request.clickId,
                        location_id=request.locationId, slot_id=request.slotId,
                        completed_at=now, status="completed", is_demo=True,
                    )
                    session.add(lead)
                    session.add(EventRow(
                        event_key=sha256(event_id.encode()).hexdigest(),
                        event_id=event_id, event_name="test_drive_requested",
                        click_id=request.clickId, occurred_at=now.isoformat(), received_at=now,
                    ))
                    session.flush()
                    response = _lead_response(lead)
                return response, True
            except IntegrityError:
                session.rollback()
                existing = session.scalar(select(LeadRow).where(LeadRow.click_id == request.clickId))
                if existing is None:
                    raise
                if (existing.location_id, existing.slot_id) != (request.locationId, request.slotId):
                    from app.services.demo import DemoRejected
                    raise DemoRejected(409, "LEAD_CONFLICT", "이미 완료된 모의 신청의 지점과 시간은 변경할 수 없습니다.")
                return _lead_response(existing), False
