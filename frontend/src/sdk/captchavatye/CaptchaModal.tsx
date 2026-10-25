import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CarPuzzle } from './CarPuzzle';
import { coverCrop, pieceCrop } from './creativeAssets';
import { useCaptchaFlow } from './useCaptchaFlow';
import { createEventTracker } from './tracking';
import type { CaptchaModalProps } from './types';
import './captchavatye.css';

export function CaptchaModal(props: CaptchaModalProps) {
  const { open, onClose } = props;
  const dialog = useRef<HTMLDialogElement>(null);
  const { state, flow } = useCaptchaFlow(props);
  const { phase, creative, run, error } = state;
  const [trackEvent] = useState(() => createEventTracker(props.apiBaseUrl ?? '/api'));
  const shownClickId = useRef<string | null>(null);
  const clickId = state.result?.clickId ?? null;
  let ctaHref: string | null = null;
  if (creative && clickId) {
    const landing = new URL(creative.landingPath, window.location.origin);
    if (landing.origin === window.location.origin) {
      landing.searchParams.set('clickId', clickId);
      ctaHref = landing.pathname + landing.search + landing.hash;
    }
  }
  const animating = phase === 'snapping' || phase === 'revealing';

  useLayoutEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  useEffect(() => {
    if (!open || phase !== 'completed' || !clickId || !ctaHref || shownClickId.current === clickId) return;
    shownClickId.current = clickId; // 재열기에 동일 노출을 재수집하지 않는다.
    void trackEvent('cta_shown', clickId).catch(() => {});
  }, [open, phase, clickId, ctaHref, trackEvent]);

  const handleCtaClick = useCallback(() => {
    if (!open || phase !== 'completed' || !clickId) return;
    // 링크 기본 동작을 막거나 이벤트 API 응답을 기다리지 않는다.
    void trackEvent('cta_clicked', clickId).catch(() => {});
  }, [open, phase, clickId, trackEvent]);

  const handleReady = useCallback(() => flow.assetsReady(run), [flow, run]);
  const handleError = useCallback(() => flow.assetsError(run), [flow, run]);
  const handleStageEnd = useCallback((stage: 'snapping' | 'revealing') => flow.stageEnd(stage, run), [flow, run]);
  const close = () => {
    flow.close(); // 부모의 다음 렌더 전에 요청·완료 실행을 무효화한다.
    onClose();
  };

  const title = phase === 'completed' ? '인증이 완료됐어요'
    : phase === 'error' ? '인증을 진행하지 못했어요'
    : phase === 'verifying' ? '램프 위치를 확인하고 있어요'
    : '리어램프를 제자리에 맞춰주세요';
  const description = phase === 'completed' ? '모의 포인트 10P가 반영됐어요. 원래 작업을 계속해 주세요.'
    : phase === 'error' ? error?.message
    : phase === 'verifying' ? '잠시만 기다려 주세요.'
    : state.notice === 'miss' ? '아직 위치가 맞지 않아요. 램프를 다시 옮겨 주세요.'
    : '아래 램프 조각을 빈 소켓으로 드래그해 주세요.';

  return (
    <dialog ref={dialog} className="captcha-modal" aria-labelledby="captcha-title"
      aria-describedby="captcha-description" onCancel={(event) => { event.preventDefault(); close(); }}>
      <header className="captcha-header">
        <div className="captcha-wordmark"><span className="brand-symbol" aria-hidden="true">C</span>CAPTCHAvatye</div>
        <div className="header-actions"><span className="ad-label">광고</span>
          <button className="icon-button" type="button" aria-label="인증 화면 닫기" onClick={close}>×</button>
        </div>
      </header>
      <div className="captcha-content">
        <div className="captcha-intro" aria-live="polite">
          <span className="eyebrow">INTERACTIVE EXPERIENCE</span>
          <h2 id="captcha-title">{title}</h2>
          <p id="captcha-description">{description}</p>
        </div>
        {creative ? <CarPuzzle creative={creative} pieceCrop={pieceCrop} coverCrop={coverCrop}
          open={open} phase={phase} run={run} loadAttempt={state.loadAttempt} lastDrop={state.lastVerify}
          onDrop={flow.drop} onReady={handleReady} onError={handleError}
          onStageEnd={handleStageEnd} onResize={flow.resize} ctaHref={ctaHref} onCtaClick={handleCtaClick} />
          : <div className="car-stage" data-phase={phase} aria-busy={phase === 'loading'}>
              <div className="stage-message">
                {phase === 'loading' && <span className="loading-dot" />}
                {phase === 'loading' ? '인증을 준비하고 있어요' : '서버 연결을 확인해 주세요'}
              </div>
            </div>}
        <div className="preview-status" role="status">
          <span className={'status-mark' + (phase === 'completed' ? ' status-complete' : '')} aria-hidden="true">
            {phase === 'completed' ? '✓' : '·'}
          </span>
          <span>{phase === 'completed' ? '인증 완료' : animating ? '차량을 공개하고 있어요'
            : phase === 'verifying' ? '위치 확인 중' : '램프를 드래그해 주세요'}</span>
          <span className="preview-note">시연용 모의 포인트</span>
        </div>
      </div>
      <footer className="captcha-footer">
        <div className="benefit"><span className="point-icon" aria-hidden="true">P</span>
          <div><strong>{phase === 'completed' ? '10P 반영 완료' : '완성 혜택 10P'}</strong><small>실제 보상이 아닌 모의 포인트</small></div>
        </div>
        <div className="preview-controls">
          {phase === 'completed'
            ? <button className="primary-button" type="button" onClick={flow.continue}>원래 작업 계속하기</button>
            : phase === 'error'
              ? error?.retryable
                ? <button className="primary-button" type="button" onClick={flow.retry}>다시 시도</button>
                : <button className="primary-button" type="button" onClick={close}>닫기</button>
              : <button className="primary-button" type="button" disabled>
                  {phase === 'loading' ? '준비 중…' : phase === 'verifying' ? '확인 중…' : animating ? '연출 중…' : '드래그하여 완성'}
                </button>}
        </div>
      </footer>
    </dialog>
  );
}
