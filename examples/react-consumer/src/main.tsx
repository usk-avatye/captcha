import { StrictMode, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CaptchaModal } from '@captchavatye/react';
import type { CompletionResult } from '@captchavatye/react';
import '@captchavatye/react/style.css';
import './host.css';

function App() {
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<CompletionResult | null>(null);
  const [completed, setCompleted] = useState(0);
  const [continued, setContinued] = useState(0);
  const continuedAttempt = useRef<number | null>(null);
  const invalid = new URLSearchParams(location.search).has('invalid-assets');
  return <>
    <main className="host-page">
      <h1>SDK 설치 확인</h1>
      <p>인증 UI 연결 예시입니다. 실제 예약을 생성하지 않습니다.</p>
      <button id="host-open" className="primary-button" onClick={() => setOpen(true)}>인증 열기</button>
      <button id="host-new" onClick={() => { setAttempt(value => value + 1); setResult(null); setOpen(true); }}>새 인증</button>
      <p>완료 콜백 <output id="complete-count">{completed}</output>회</p>
      <p>계속하기 처리 <output id="continue-count">{continued}</output>회</p>
      <pre id="completion-result">{JSON.stringify(result, null, 2)}</pre>
    </main>
    <CaptchaModal key={attempt} open={open} creativeId="bmw-m3-v1"
      apiBaseUrl="/captcha-api" assetBaseUrl={invalid ? 'javascript:invalid' : 'http://127.0.0.1:5173/'}
      landingBaseUrl="http://127.0.0.1:5173/" continueLabel="예약 계속하기"
      onComplete={value => { setResult(value); setCompleted(count => count + 1); }}
      onContinue={() => {
        if (result && continuedAttempt.current !== attempt) {
          continuedAttempt.current = attempt;
          setContinued(count => count + 1);
        }
        setOpen(false);
      }}
      onClose={() => setOpen(false)} />
  </>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
