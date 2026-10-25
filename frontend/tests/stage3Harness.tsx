// 검증 전용 진입점. 제품 App이나 SDK 공개 API에 시험용 메서드를 추가하지 않는다.
import { StrictMode, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CaptchaModal } from '../src/sdk/captchavatye';
import type { CompletionResult } from '../src/sdk/captchavatye';
import { useCommunityDraft } from '../src/pages/useCommunityDraft';
import '../src/index.css';

export function HostHarness() {
  const state = useCommunityDraft();
  const saved = useRef<Pick<typeof state, 'onComplete' | 'onContinue' | 'onClose'> | null>(null);
  useLayoutEffect(() => {
    Object.assign(window, { __stage3: {
      ...state,
      saveCallbacks: () => { saved.current = {
        onComplete: state.onComplete, onContinue: state.onContinue, onClose: state.onClose,
      }; },
      callSaved: (result: CompletionResult) => {
        saved.current?.onComplete(result);
        saved.current?.onContinue();
        saved.current?.onClose();
      },
    } });
  });
  return <pre id="state">{JSON.stringify(state)}</pre>;
}

type Call = { name: string; revision: number; result?: CompletionResult };
export function SdkHarness() {
  const [open, setOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const [calls, setCalls] = useState<Call[]>([]);
  useLayoutEffect(() => {
    Object.assign(window, { __stage3: {
      open: () => setOpen(true),
      close: () => setOpen(false),
      rerender: () => setRevision(value => value + 1),
    } });
  });
  return <>
    <pre id="state">{JSON.stringify({ open, revision, calls })}</pre>
    <CaptchaModal open={open} creativeId="bmw-m3-v1"
      onComplete={result => setCalls(value => [...value, { name: 'complete', revision, result }])}
      onContinue={() => {
        setCalls(value => [...value, { name: 'continue', revision }]);
        setOpen(false);
      }}
      onClose={() => {
        setCalls(value => [...value, { name: 'close', revision }]);
        setOpen(false);
      }} />
  </>;
}

const mode = new URLSearchParams(location.search).get('mode');
createRoot(document.getElementById('root')!).render(
  <StrictMode>{mode === 'sdk' ? <SdkHarness /> : <HostHarness />}</StrictMode>,
);
