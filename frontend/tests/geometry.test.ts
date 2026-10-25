import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculatePuzzleLayout } from '../../packages/react/src/geometry.ts';

const lamp = { x: 0.5, y: 0.375, width: 0.125, height: 0.125 };
const zoom = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };

test('확대한 원본의 램프와 별도 오버레이 조각이 같은 위치를 사용한다', () => {
  assert.deepEqual(calculatePuzzleLayout(lamp, zoom, { width: 800, height: 450 }), {
    scene: { scale: 2, x: -400, y: -225 },
    piece: { x: 400, y: 112.5, width: 200, height: 112.5 },
  });
});

test('창 너비가 반으로 줄어도 램프 위치와 조각 크기가 함께 줄어든다', () => {
  assert.deepEqual(calculatePuzzleLayout(lamp, zoom, { width: 400, height: 225 }), {
    scene: { scale: 2, x: -200, y: -112.5 },
    piece: { x: 200, y: 56.25, width: 100, height: 56.25 },
  });
});

test('폭이 없는 확대 영역은 무한대 transform 대신 오류로 거절한다', () => {
  assert.throws(() => calculatePuzzleLayout(lamp, { ...zoom, width: 0 }, { width: 800, height: 450 }), RangeError);
});
