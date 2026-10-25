"""큰 외부 이벤트 ID도 원문을 보존하고 고정 길이 키로 조회한다."""
from alembic import op
import sqlalchemy as sa

revision = "0003_event_keys"
down_revision = "0002_event_id_text"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("captcha_events", sa.Column("event_key", sa.String(64)))
    op.execute("UPDATE captcha_events SET event_key = encode(sha256(convert_to(event_id, 'UTF8')), 'hex')")
    op.alter_column("captcha_events", "event_key", nullable=False)
    op.drop_constraint("captcha_events_pkey", "captcha_events", type_="primary")
    op.create_primary_key("captcha_events_pkey", "captcha_events", ["event_key"])


def downgrade() -> None:
    raise RuntimeError("긴 이벤트 ID의 원문을 보존하기 위해 자동 축소하지 않습니다.")
