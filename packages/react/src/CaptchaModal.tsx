import { useCallback, useEffect, useLayoutEffect, useRef, useState, useId } from 'react';
import { CarPuzzle } from './CarPuzzle';
import { coverCrop, pieceCrop } from './creativeAssets';
import { useCaptchaFlow } from './useCaptchaFlow';
import { createEventTracker } from './tracking';
import type { CaptchaModalProps } from './types';
import { createCtaHref } from './urls';

export function CaptchaModal(props: CaptchaModalProps) {
  const { open, onClose, continueLabel = '원래 작업 계속하기' } = props;
  const id = useId();
  const titleId = id + '-title';
  const descriptionId = id + '-description';
  const dialog = useRef<HTMLDialogElement>(null);
  const { state, flow, interaction } = useCaptchaFlow(props);
  const { phase, creative, run, error } = state;
  const [trackEvent] = useState(() => createEventTracker(props.apiBaseUrl ?? '/api'));
  const shownClickId = useRef<string | null>(null);
  const clickId = state.result?.clickId ?? null;
  const ctaHref = creative && clickId ? createCtaHref(creative.landingPath, clickId) : null;
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
    flow.close(); // 부모의 다음 렌더 전에 요청과 완료 실행을 무효화한다.
    onClose();
  };

  const title = phase === 'completed' ? '인증 완료'
    : phase === 'error' ? '인증할 수 없습니다'
    : phase === 'loading' ? '불러오는 중…'
    : phase === 'verifying' || animating ? '확인 중…'
    : '램프를 빈칸으로 옮겨주세요.';
  const description = phase === 'error' ? error?.message
    : phase === 'challenge' && state.notice === 'miss' ? '위치가 맞지 않습니다.'
    : null;

  return (
    <dialog ref={dialog} className="cv-captcha-modal" aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined} onCancel={(event) => { event.preventDefault(); close(); }}>
      <header className="cv-captcha-header">
        <div className="cv-captcha-wordmark"><span className="cv-brand-symbol" aria-hidden="true">C</span>CAPTCHAvatye</div>
        <div className="cv-header-actions"><span className="cv-ad-label">광고</span>
          <button className="cv-icon-button" type="button" aria-label="인증 화면 닫기" onClick={close}>×</button>
        </div>
      </header>
      <div className="cv-captcha-content">
        <div className="cv-captcha-intro" aria-live="polite" aria-atomic="true">
          <h2 id={titleId}>{title}</h2>
          {description && <p id={descriptionId}>{description}</p>}
        </div>
        {creative ? <CarPuzzle creative={creative} pieceCrop={pieceCrop} coverCrop={coverCrop}
          open={open} phase={phase} run={run} loadAttempt={state.loadAttempt} lastDrop={state.lastVerify}
          onDrop={flow.drop} onReady={handleReady} onError={handleError}
          interaction={interaction}
          onStageEnd={handleStageEnd} onResize={flow.resize} ctaHref={ctaHref} onCtaClick={handleCtaClick} />
          : <div className="cv-car-stage" data-phase={phase} aria-busy={phase === 'loading'}>
              {phase === 'loading' && <div className="cv-stage-message" aria-hidden="true"><span className="cv-loading-dot" /></div>}
            </div>}
      </div>
      <footer className="cv-captcha-footer">
        <div className="cv-preview-controls">
          {phase === 'completed'
            ? <button className="cv-primary-button" type="button" onClick={flow.continue}>{continueLabel}</button>
            : phase === 'error'
              ? error?.retryable
                ? <button className="cv-primary-button" type="button" onClick={flow.retry}>다시 시도</button>
                : <button className="cv-primary-button" type="button" onClick={close}>닫기</button>
              : null}
        </div>
      </footer>
    </dialog>
  );
}
