import { useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { createCaptchaApi } from './api';
import { CaptchaFlow } from './flow';
import type { CaptchaModalProps } from './types';

export function useCaptchaFlow({
  open, creativeId, apiBaseUrl = '/api', onComplete, onContinue,
}: CaptchaModalProps) {
  // 한 시도에서 creativeId/apiBaseUrl은 고정. 새 시도는 호스트의 React key로 만든다.
  const [flow] = useState(() => new CaptchaFlow(creativeId, createCaptchaApi(apiBaseUrl)));
  const state = useSyncExternalStore(flow.subscribe, flow.getSnapshot);

  // 최신 커밋된 콜백만 사용한다. 호스트 재렌더는 open 수명을 종료하지 않는다.
  useLayoutEffect(() => {
    flow.setCallbacks({ onComplete, onContinue });
  }, [flow, onComplete, onContinue]);

  useLayoutEffect(() => {
    flow.setOpen(open);
    return () => flow.close();
  }, [flow, open]);
  return { state, flow };
}
