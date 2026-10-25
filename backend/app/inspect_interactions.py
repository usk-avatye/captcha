"""최근 상호작용 요약을 읽어 로컬 점검 도구에 JSON으로 전달한다."""
import json
import os

from sqlalchemy import select

from app.persistence import ChallengeRow, InteractionRow, PostgresStore


def recent_interactions(store: PostgresStore, limit: int = 20) -> list[dict]:
    with store._sessions()() as session:
        rows = session.execute(select(InteractionRow, ChallengeRow).join(
            ChallengeRow, InteractionRow.challenge_id == ChallengeRow.challenge_id,
        ).order_by(InteractionRow.received_at.desc()).limit(limit))
        return [{'challengeId': summary.challenge_id, 'creativeId': challenge.creative_id,
            'status': challenge.status, 'revision': summary.revision,
            'receivedAt': summary.received_at.isoformat(), 'metrics': summary.metrics}
            for summary, challenge in rows]


def main() -> None:
    store = PostgresStore(os.environ.get('CAPTCHAVATYE_DATABASE_URL'))
    try:
        store.check_ready()
        print(json.dumps(recent_interactions(store), ensure_ascii=False, allow_nan=False))
    finally:
        if store.engine:
            store.engine.dispose()


if __name__ == '__main__':
    main()
