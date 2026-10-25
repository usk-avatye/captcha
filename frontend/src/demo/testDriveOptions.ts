// 실제 예약 지점이나 재고가 아닌 PoC 고정 선택지. 서버 demo_config.py와 일치한다.
export const locations = [
  { id: 'demo-center-a', label: '시연 전시장 A' },
  { id: 'demo-center-b', label: '시연 전시장 B' },
] as const;

export const slots = [
  { id: 'demo-slot-1', label: '시연 시간 1' },
  { id: 'demo-slot-2', label: '시연 시간 2' },
] as const;

export type LocationId = (typeof locations)[number]['id'];
export type SlotId = (typeof slots)[number]['id'];
