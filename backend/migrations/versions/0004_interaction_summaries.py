"""인증별 누적 상호작용 요약을 저장한다."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = '0004_interaction_summaries'
down_revision = '0003_event_keys'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('captcha_interaction_summaries',
        sa.Column('challenge_id', sa.String(100), sa.ForeignKey('captcha_challenges.challenge_id', ondelete='RESTRICT'), primary_key=True),
        sa.Column('revision', sa.Integer(), nullable=False),
        sa.Column('metrics', JSONB(), nullable=False),
        sa.Column('received_at', sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table('captcha_interaction_summaries')
