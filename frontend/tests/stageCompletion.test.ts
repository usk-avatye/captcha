import assert from 'node:assert/strict';
import { test } from 'node:test';
import { armStageCompletion } from '../../packages/react/src/stageCompletion.ts';

test('종료 이벤트와 우회 타이머가 겹쳐도 다음 단계는 한 번만 실행한다', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const stage = armStageCompletion(180, () => { calls += 1; });
  stage.finish();
  stage.finish();
  t.mock.timers.tick(1000);
  assert.equal(calls, 1);
});

test('닫기로 취소한 연출은 타이머와 늦은 종료 이벤트 모두 무시한다', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls: string[] = [];
  armStageCompletion(180, () => calls.push('active'));
  const cancelled = armStageCompletion(180, () => calls.push('closed'));
  cancelled.cancel();
  t.mock.timers.tick(1000);
  cancelled.finish();
  assert.deepEqual(calls, ['active']);
});

test('종료 이벤트가 누락되면 공개 시간과 여유 시간이 지난 뒤 완료한다', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  armStageCompletion(650, () => { calls += 1; });
  t.mock.timers.tick(749);
  assert.equal(calls, 0);
  t.mock.timers.tick(1);
  assert.equal(calls, 1);
});

test('0ms 연출은 transitionend 없이도 완료한다', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  armStageCompletion(0, () => { calls += 1; });
  t.mock.timers.tick(0);
  assert.equal(calls, 1);
});

test('이전 연출의 늦은 종료 이벤트는 새 연출을 일찍 끝내지 않는다', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let completed = 0;
  const previousEventTime = performance.now();
  const current = armStageCompletion(650, () => { completed += 1; });
  current.finish(previousEventTime);
  assert.equal(completed, 0);
  t.mock.timers.tick(750);
  assert.equal(completed, 1);
});
