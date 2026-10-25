import type { NormalizedRect } from './types.ts';

export function calculatePuzzleLayout(
  lamp: NormalizedRect,
  zoom: NormalizedRect,
  viewport: { width: number; height: number },
) {
  if (
    ![...Object.values(lamp), ...Object.values(zoom), viewport.width, viewport.height].every(Number.isFinite)
    || zoom.width <= 0 || zoom.height <= 0
    || viewport.width <= 0 || viewport.height <= 0
    || Math.abs(zoom.width - zoom.height) > 1e-9
  ) {
    throw new RangeError('소재 좌표와 광고 영역 크기를 확인해 주세요.');
  }

  const scale = 1 / zoom.width;
  return {
    scene: {
      scale,
      x: -zoom.x * viewport.width * scale,
      y: -zoom.y * viewport.height * scale,
    },
    piece: {
      x: (lamp.x - zoom.x) * viewport.width * scale,
      y: (lamp.y - zoom.y) * viewport.height * scale,
      width: lamp.width * viewport.width * scale,
      height: lamp.height * viewport.height * scale,
    },
  };
}

type Box = { left: number; top: number; width: number; height: number };

export function normalizeDrop(piece: Box, image: Box) {
  if (![piece.left, piece.top, piece.width, piece.height, image.left, image.top, image.width, image.height].every(Number.isFinite)
      || image.width <= 0 || image.height <= 0 || piece.width <= 0 || piece.height <= 0) return null;
  const dropX = (piece.left + piece.width / 2 - image.left) / image.width;
  const dropY = (piece.top + piece.height / 2 - image.top) / image.height;
  return dropX >= 0 && dropX <= 1 && dropY >= 0 && dropY <= 1 ? { dropX, dropY } : null;
}

export function pointerPosition(
  pointer: { clientX: number; clientY: number },
  stage: { left: number; top: number },
  offset: { x: number; y: number },
) {
  return { x: pointer.clientX - stage.left - offset.x, y: pointer.clientY - stage.top - offset.y };
}
