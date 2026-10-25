import { useCallback, useRef, useState } from 'react';
import type { CompletionResult } from '../sdk/captchavatye';

export type CommunityDraft = { title: string; body: string };
export type LocalPost = CommunityDraft & { number: number };
type Attempt = { key: number; completionId: string | null; submitted: boolean };

export function useCommunityDraft() {
  const [draft, setDraft] = useState<CommunityDraft>({ title: '', body: '' });
  const [open, setOpen] = useState(false);
  const [points, setPoints] = useState(0);
  const [posts, setPosts] = useState<LocalPost[]>([]);
  const [attemptKey, setAttemptKey] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [registered, setRegistered] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const appliedCompletionIds = useRef(new Set<string>());
  const currentAttempt = useRef<Attempt>({ key: 0, completionId: null, submitted: false });

  const updateDraft = (field: keyof CommunityDraft, value: string) => {
    if (currentAttempt.current.key !== attemptKey || currentAttempt.current.submitted) return;
    setDraft(current => ({ ...current, [field]: value }));
    setError(null);
  };

  const requestPublish = () => {
    if (currentAttempt.current.key !== attemptKey || currentAttempt.current.submitted) return;
    if (!draft.title.trim() || !draft.body.trim()) {
      setError('제목과 본문을 모두 입력해 주세요.');
      return;
    }
    setError(null);
    setOpen(true);
  };

  const onComplete = useCallback((result: CompletionResult) => {
    const attempt = currentAttempt.current;
    if (attempt.key !== attemptKey || attempt.submitted
        || (attempt.completionId && attempt.completionId !== result.completionId)) return;
    attempt.completionId = result.completionId;
    setCompleted(true);
    if (appliedCompletionIds.current.has(result.completionId)) return;
    // React updater 안에서 Set을 변경하지 않는다. 같은 이벤트 루프의 중복도 먼저 막는다.
    appliedCompletionIds.current.add(result.completionId);
    setPoints(value => value + 10);
  }, [attemptKey]);

  const onContinue = useCallback(() => {
    const attempt = currentAttempt.current;
    if (attempt.key !== attemptKey || attempt.submitted || !attempt.completionId) return;
    if (!draft.title.trim() || !draft.body.trim()) {
      setError('제목과 본문을 모두 입력해 주세요.');
      setOpen(false);
      return;
    }
    attempt.submitted = true; // 등록 가드는 보상 가드와 독립이며 상태 갱신보다 먼저 설정한다.
    const post = { number: attemptKey + 1, ...draft };
    setPosts(value => [...value, post]);
    setRegistered(true);
    setOpen(false);
  }, [attemptKey, draft]);

  const onClose = useCallback(() => {
    if (currentAttempt.current.key === attemptKey) setOpen(false);
  }, [attemptKey]);

  const newPost = () => {
    const attempt = currentAttempt.current;
    if (attempt.key !== attemptKey || !attempt.submitted) return;
    const nextKey = attempt.key + 1;
    currentAttempt.current = { key: nextKey, completionId: null, submitted: false };
    setAttemptKey(nextKey);
    setDraft({ title: '', body: '' });
    setOpen(false);
    setCompleted(false);
    setRegistered(false);
    setError(null);
    // 누적 포인트·적용 ID·등록 목록은 페이지 수명 동안 유지한다.
  };

  return {
    draft, open, points, posts, attemptKey, completed, registered, error,
    updateDraft, requestPublish, onComplete, onContinue, onClose, newPost,
  };
}
