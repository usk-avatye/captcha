"""CAPTCHAvatye 인증, 이벤트, 전환 기록."""

from alembic import op
import sqlalchemy as sa

revision = "0001_captcha_records"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "captcha_challenges",
        sa.Column("challenge_id", sa.String(100), primary_key=True),
        sa.Column("creative_id", sa.String(100), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("completion_id", sa.String(100), unique=True),
        sa.Column("click_id", sa.String(100), unique=True),
        sa.Column("client_id", sa.String(100)),
        sa.Column("subject", sa.String(255)),
        sa.Column("expires_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint(
            "(status = 'pending' AND completion_id IS NULL AND click_id IS NULL) OR "
            "(status = 'passed' AND completion_id IS NOT NULL AND click_id IS NOT NULL)",
            name="captcha_challenges_result_state",
        ),
        sa.CheckConstraint(
            "(client_id IS NULL AND subject IS NULL AND expires_at IS NULL) OR "
            "(client_id IS NOT NULL AND subject IS NOT NULL AND expires_at IS NOT NULL)",
            name="captcha_challenges_private_binding",
        ),
    )
    op.create_table(
        "captcha_events",
        sa.Column("event_id", sa.String(120), primary_key=True),
        sa.Column("event_name", sa.String(64), nullable=False),
        sa.Column("click_id", sa.String(100), sa.ForeignKey(
            "captcha_challenges.click_id", ondelete="RESTRICT",
        ), nullable=False),
        sa.Column("occurred_at", sa.Text(), nullable=False),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("captcha_events_click_id_idx", "captcha_events", ["click_id"])
    op.create_table(
        "captcha_demo_leads",
        sa.Column("lead_id", sa.String(120), primary_key=True),
        sa.Column("click_id", sa.String(100), sa.ForeignKey(
            "captcha_challenges.click_id", ondelete="RESTRICT",
        ), nullable=False, unique=True),
        sa.Column("location_id", sa.String(64), nullable=False),
        sa.Column("slot_id", sa.String(64), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("is_demo", sa.Boolean(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("captcha_demo_leads")
    op.drop_index("captcha_events_click_id_idx", table_name="captcha_events")
    op.drop_table("captcha_events")
    op.drop_table("captcha_challenges")
