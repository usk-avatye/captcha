"""기존 공개 계약의 이벤트 ID 길이를 유지한다."""
from alembic import op
import sqlalchemy as sa

revision = "0002_event_id_text"
down_revision = "0001_captcha_records"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("captcha_events", "event_id", existing_type=sa.String(120), type_=sa.Text())


def downgrade() -> None:
    # 긴 외부 ID를 잘라서 기존 기록을 손상시키지 않는다.
    raise RuntimeError("긴 이벤트 ID가 존재할 수 있어 자동 축소하지 않습니다.")
