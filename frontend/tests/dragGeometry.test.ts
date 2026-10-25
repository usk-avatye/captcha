import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeDrop, pointerPosition } from '../../packages/react/src/geometry.ts';

test('조각 중심을 확대된 전체 원본 경계로 정규화한다', () => {
  assert.deepEqual(normalizeDrop(
    { left: 100, top: 140, width: 100, height: 60 },
    { left: -200, top: -100, width: 1000, height: 600 },
  ), { dropX: 0.35, dropY: 0.45 });
});

test('CSS 크기가 절반이면 같은 원본 위치의 드롭 좌표는 유지된다', () => {
  assert.deepEqual(normalizeDrop(
    { left: 50, top: 70, width: 50, height: 30 },
    { left: -100, top: -50, width: 500, height: 300 },
  ), { dropX: 0.35, dropY: 0.45 });
});

test('원본 밖 조각 중심과 유효하지 않은 경계는 clamp하지 않고 거절한다', () => {
  const image = { left: 0, top: 0, width: 100, height: 100 };
  for (const x of [-11, 91, NaN, Infinity]) {
    assert.equal(normalizeDrop({ left: x, top: 40, width: 20, height: 20 }, image), null);
  }
  assert.equal(normalizeDrop({ left: 0, top: 0, width: 10, height: 10 }, { ...image, width: 0 }), null);
});

test('grab 오프셋과 마지막 포인터 좌표로 조각 좌상단을 계산한다', () => {
  assert.deepEqual(pointerPosition(
    { clientX: 410, clientY: 330 },
    { left: 100, top: 80 },
    { x: 10, y: 50 },
  ), { x: 300, y: 200 });
});

