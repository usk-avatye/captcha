import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, TransitionEvent } from 'react';
import { calculatePuzzleLayout, normalizeDrop, pointerPosition } from './geometry';
import { armStageCompletion } from './stageCompletion';
import type { StageCompletion } from './stageCompletion';
import type { Creative, DropPoint, RasterCrop, VisualPhase } from './types';

type Props = {
  creative: Creative;
  pieceCrop: RasterCrop;
  coverCrop: RasterCrop;
  open: boolean;
  phase: VisualPhase;
  run: number;
  loadAttempt: number;
  lastDrop: DropPoint | null;
  onDrop: (point: DropPoint) => void;
  onReady: () => void;
  onError: () => void;
  onStageEnd: (phase: 'snapping' | 'revealing') => void;
  onResize: () => void;
};

function spriteStyle(crop: RasterCrop): CSSProperties {
  return {
    width: crop.canvasWidth / crop.width * 100 + '%',
    height: crop.canvasHeight / crop.height * 100 + '%',
    left: -crop.x / crop.width * 100 + '%',
    top: -crop.y / crop.height * 100 + '%',
  };
}

export function CarPuzzle({
  creative, pieceCrop, coverCrop, open, phase, run, loadAttempt,
  lastDrop, onDrop, onReady, onError, onStageEnd, onResize,
}: Props) {
  const stageElement = useRef<HTMLDivElement>(null);
  const pieceElement = useRef<HTMLDivElement>(null);
  const imageElement = useRef<HTMLImageElement>(null);
  const drag = useRef<{ pointerId: number; offset: { x: number; y: number } } | null>(null);
  const position = useRef({ x: 0, y: 0 });
  const releaseDrag = useCallback(() => {
    const active = drag.current;
    drag.current = null;
    const piece = pieceElement.current;
    piece?.removeAttribute('data-dragging');
    if (active && piece?.hasPointerCapture(active.pointerId)) piece.releasePointerCapture(active.pointerId);
  }, []);
  const applyPosition = useCallback((point: { x: number; y: number }) => {
    position.current = point;
    if (pieceElement.current) {
      pieceElement.current.style.transform = 'translate(' + point.x + 'px, ' + point.y + 'px)';
    }
  }, []);
  const completion = useRef<StageCompletion | null>(null);
  const phaseRef = useRef(phase);
  const [size, setSize] = useState({ width: 672, height: 378 });
  const [startedMotionKey, setStartedMotionKey] = useState<string | null>(null);
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  const loading = phase === 'loading';
  const motionKey = [open, phase, run, size.width, size.height, reducedMotion].join(':');
  const moving = startedMotionKey === motionKey && open;

  useLayoutEffect(() => { phaseRef.current = phase; }, [phase]);

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(preference.matches);
    preference.addEventListener('change', update);
    return () => preference.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!open || !loading) return;
    let active = true;
    let settled = false;
    const done = (ok: boolean) => {
      if (!active || settled) return;
      settled = true;
      clearTimeout(timeout);
      if (ok) onReady();
      else onError();
    };
    const timeout = setTimeout(() => done(false), 10000);
    const sources = [
      [creative.imageUrl, creative.sourceWidth, creative.sourceHeight],
      [creative.coverUrl, coverCrop.canvasWidth, coverCrop.canvasHeight],
      [creative.pieceUrl, pieceCrop.canvasWidth, pieceCrop.canvasHeight],
    ] as const;

    void Promise.all(sources.map(async ([url, width, height]) => {
      const image = new Image();
      image.src = url;
      await image.decode();
      if (image.naturalWidth !== width || image.naturalHeight !== height) {
        throw new Error('소재 파일과 설정의 크기가 다릅니다.');
      }
    })).then(() => done(true), () => done(false));

    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [open, loading, creative, pieceCrop, coverCrop, loadAttempt, onReady, onError]);

  useLayoutEffect(() => {
    const element = stageElement.current;
    if (!element) return;
    let previousWidth = 0;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width <= 0 || height <= 0) return;
      if (previousWidth && Math.abs(previousWidth - width) > 0.5
          && (phaseRef.current === 'snapping' || phaseRef.current === 'revealing')) {
        onResize();
      }
      previousWidth = width;
      setSize((current) => current.width === width && current.height === height
        ? current : { width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [onResize]);

  useLayoutEffect(() => {
    completion.current?.cancel();
    completion.current = null;
    if (!open || (phase !== 'snapping' && phase !== 'revealing')) return;

    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        setStartedMotionKey(motionKey);
        const duration = reducedMotion ? 0
          : phase === 'snapping' ? creative.snapMs : creative.revealMs;
        completion.current = armStageCompletion(duration, () => onStageEnd(phase));
      });
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
      completion.current?.cancel();
      completion.current = null;
    };
  }, [open, phase, motionKey, reducedMotion, creative.snapMs, creative.revealMs, onStageEnd]);

  const layout = calculatePuzzleLayout(creative.lampRect, creative.zoomRect, size);
  const fullView = phase === 'completed' || (phase === 'revealing' && moving);
  const showPiece = phase === 'challenge' || phase === 'verifying' || phase === 'snapping';
  const pieceAtTarget = phase === 'snapping' && moving;
  const initialX = size.width * 0.055;
  const initialY = Math.min(size.height * 0.72, size.height - layout.piece.height - 12);
  const hasDrop = (phase === 'verifying' || phase === 'snapping') && lastDrop;
  const baseX = hasDrop ? layout.scene.x + lastDrop.dropX * size.width * layout.scene.scale - layout.piece.width / 2 : initialX;
  const baseY = hasDrop ? layout.scene.y + lastDrop.dropY * size.height * layout.scene.scale - layout.piece.height / 2 : initialY;

  useLayoutEffect(() => {
    releaseDrag();
    applyPosition({ x: baseX, y: baseY });
    return releaseDrag;
  }, [open, phase, run, size.width, size.height, baseX, baseY, applyPosition, releaseDrag]);

  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!open || phase !== 'challenge' || !drag.current || drag.current.pointerId !== event.pointerId) return;
    const stage = stageElement.current;
    if (stage) applyPosition(pointerPosition(event, stage.getBoundingClientRect(), drag.current.offset));
  };
  const cancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    releaseDrag();
    applyPosition({ x: initialX, y: initialY });
  };
  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!open || phase !== 'challenge' || drag.current || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    drag.current = { pointerId: event.pointerId, offset: { x: event.clientX - bounds.left, y: event.clientY - bounds.top } };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.setAttribute('data-dragging', 'true');
  };
  const pointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!open || phase !== 'challenge' || drag.current?.pointerId !== event.pointerId) return;
    move(event); // 마지막 pointermove를 기다리지 않고 pointerup의 위치를 먼저 반영한다.
    const piece = pieceElement.current;
    const image = imageElement.current;
    const point = piece && image ? normalizeDrop(piece.getBoundingClientRect(), image.getBoundingClientRect()) : null;
    releaseDrag();
    if (point) onDrop(point);
    else applyPosition({ x: initialX, y: initialY });
  };

  const finish = (event: TransitionEvent<HTMLDivElement>, expected: VisualPhase) => {
    if (event.target === event.currentTarget && event.propertyName === 'transform'
        && moving && phase === expected && open) {
      completion.current?.finish(event.timeStamp);
    }
  };

  return (
    <div ref={stageElement} className="car-stage" data-phase={phase} aria-busy={phase === 'loading' || phase === 'verifying'}>
      <div className="car-artwork" style={{ visibility: phase === 'loading' || phase === 'error' ? 'hidden' : 'visible' }}>
        <div
          className="car-scene"
          data-scene
          onTransitionEnd={(event) => finish(event, 'revealing')}
          style={{
            transform: fullView ? 'translate(0px, 0px) scale(1)'
              : 'translate(' + layout.scene.x + 'px, ' + layout.scene.y + 'px) scale(' + layout.scene.scale + ')',
            transition: phase === 'revealing' && moving
              ? 'transform ' + (reducedMotion ? 0 : creative.revealMs) + 'ms cubic-bezier(.22,.72,.16,1)' : 'none',
          }}
        >
          <img ref={imageElement} key={loadAttempt} className="vehicle-image" src={creative.imageUrl} alt="초록색 BMW M3의 후면" draggable={false} />
          {showPiece && (
            <div className="socket-cover sprite-window" data-socket style={{
              left: creative.lampRect.x * 100 + '%',
              top: creative.lampRect.y * 100 + '%',
              width: creative.lampRect.width * 100 + '%',
              height: creative.lampRect.height * 100 + '%',
            }}>
              <img src={creative.coverUrl} className="sprite-image" style={spriteStyle(coverCrop)} alt="" draggable={false} />
            </div>
          )}
        </div>
        {showPiece && (
          <div ref={pieceElement} className="lamp-piece" data-piece data-draggable={open && phase === 'challenge'}
            onPointerDown={pointerDown} onPointerMove={move} onPointerUp={pointerUp}
            onPointerCancel={cancel} onLostPointerCapture={cancel}
            onTransitionEnd={(event) => finish(event, 'snapping')} style={{
            width: layout.piece.width,
            height: layout.piece.height,
            transform: 'translate(' + (pieceAtTarget ? layout.piece.x : baseX) + 'px, '
              + (pieceAtTarget ? layout.piece.y : baseY) + 'px)',
            transition: phase === 'snapping' && moving
              ? 'transform ' + (reducedMotion ? 0 : creative.snapMs) + 'ms ease-out' : 'none',
          }}>
            <div className="sprite-window">
              <img src={creative.pieceUrl} className="sprite-image" style={spriteStyle(pieceCrop)} alt="맞출 리어램프 조각" draggable={false} />
            </div>
          </div>
        )}
        <div className={'brand-panel' + (fullView ? ' brand-panel-visible' : '')} aria-hidden={!fullView}>
          <span className="brand-eyebrow">THE M3</span>
          <h3>{creative.brandTitle}</h3>
          <p>{creative.tagline}</p>
          <div className="cta-slot">
            {phase === 'completed' && (
              <button className="brand-cta" type="button" disabled
                title="시승 신청은 후속 단계에서 연결됩니다."
                aria-label="시승 신청 — 다음 단계에서 연결">
                {creative.ctaLabel}<span aria-hidden="true">↗</span>
              </button>
            )}
          </div>
        </div>
      </div>
      {phase === 'loading' && <div className="stage-message"><span className="loading-dot" />이미지를 준비하고 있어요</div>}
      {phase === 'error' && <div className="stage-message">인증을 진행하지 못했어요.</div>}
    </div>
  );
}
