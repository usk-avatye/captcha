import type { RasterCrop } from './types';

// 생성된 PNG의 여백만 CSS에서 제외한다. 공개 Creative API와 원본 파일은 유지한다.
const crop = { x: 276, y: 311, width: 1172, height: 350 };
export const pieceCrop: RasterCrop = { canvasWidth: 1672, canvasHeight: 941, ...crop };
export const coverCrop: RasterCrop = { canvasWidth: 1671, canvasHeight: 941, ...crop };
