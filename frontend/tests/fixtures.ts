import type { Creative } from '../../packages/react/src/types.ts';

export const creative: Creative = {
  creativeId: 'bmw-m3-v1', version: '1',
  imageUrl: '/creatives/bmw-m3/vehicle.webp',
  coverUrl: '/creatives/bmw-m3/socket-cover.png',
  pieceUrl: '/creatives/bmw-m3/lamp.png',
  sourceWidth: 1672, sourceHeight: 941,
  lampRect: { x: 347 / 1672, y: 373 / 941, width: 223 / 1672, height: 70 / 941 },
  zoomRect: { x: .13422248803827747, y: .29358129649309245, width: .28, height: .28 },
  brandTitle: 'BMW M3', tagline: 'Sheer Driving Pleasure',
  ctaLabel: '시승 신청', landingPath: '/demo/test-drive', snapMs: 180, revealMs: 650,
};

