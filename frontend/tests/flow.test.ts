import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CaptchaFlow } from '../src/sdk/captchavatye/flow.ts';
import { ApiError } from '../src/sdk/captchavatye/api.ts';
import type { ChallengeResponse, VerifyRequest, VerifyResult } from '../src/sdk/captchavatye/types.ts';
import { creative } from './fixtures.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup() {
  const starts: Array<ReturnType<typeof deferred<ChallengeResponse>> & { signal: AbortSignal }> = [];
  const verifies: Array<ReturnType<typeof deferred<VerifyResult>> & { request: VerifyRequest; signal: AbortSignal }> = [];
  const flow = new CaptchaFlow('bmw-m3-v1', {
    start: (_id: string, signal: AbortSignal) => {
      const pending = { ...deferred<ChallengeResponse>(), signal };
      starts.push(pending); return pending.promise;
    },
    verify: (request: VerifyRequest, signal: AbortSignal) => {
      const pending = { ...deferred<VerifyResult>(), request: { ...request }, signal };
      verifies.push(pending); return pending.promise;
    },
  });
  return { flow, starts, verifies };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
async function ready() {
  const fixture = setup();
  fixture.flow.setOpen(true);
  fixture.starts[0].resolve({ challengeId: 'ch_one', creative });
  await flush();
  fixture.flow.assetsReady(fixture.flow.getSnapshot().run);
  return fixture;
}
const success = { passed: true, completionId: 'cmp_one', clickId: 'clk_one' } as const;

test('첫 열기 전에는 시작하지 않고, 받은 ID로 이미지 준비만 수행한다', async () => {
  const { flow, starts } = setup();
  assert.equal(starts.length, 0);
  flow.setOpen(true);
  assert.equal(starts.length, 1);
  starts[0].resolve({ challengeId: 'ch_one', creative });
  await flush();
  assert.equal(flow.getSnapshot().phase, 'loading');
  assert.equal(flow.getSnapshot().challengeId, 'ch_one');
  flow.assetsReady(flow.getSnapshot().run);
  assert.equal(flow.getSnapshot().phase, 'challenge');
});

test('검증 중 추가 드롭을 차단하고 false는 오류가 아닌 재도전으로 복귀한다', async () => {
  const { flow, verifies } = await ready();
  flow.drop({ dropX: .2, dropY: .2 });
  flow.drop({ dropX: .3, dropY: .4 });
  assert.equal(verifies.length, 1);
  assert.equal(flow.getSnapshot().phase, 'verifying');
  assert.equal(flow.getSnapshot().result, null);
  verifies[0].resolve({ passed: false });
  await flush();
  assert.equal(flow.getSnapshot().phase, 'challenge');
  assert.equal(flow.getSnapshot().error, null);
  assert.equal(flow.getSnapshot().notice, 'miss');
});

test('서버 성공 뒤에만 연출하며 ID와 현재 연출 번호를 보존한다', async () => {
  const { flow, verifies } = await ready();
  flow.drop({ dropX: .274, dropY: .433 });
  flow.stageEnd('revealing', flow.getSnapshot().run);
  assert.equal(flow.getSnapshot().phase, 'verifying');
  verifies[0].resolve(success);
  await flush();
  const run = flow.getSnapshot().run;
  assert.equal(flow.getSnapshot().phase, 'snapping');
  assert.deepEqual(flow.getSnapshot().result, {
    challengeId: 'ch_one', creativeId: 'bmw-m3-v1', completionId: 'cmp_one', clickId: 'clk_one',
  });
  flow.stageEnd('snapping', run);
  flow.stageEnd('revealing', run);
  assert.equal(flow.getSnapshot().phase, 'completed');
});

test('검증 중 닫아도 스냅샷을 보존하고 늦은 응답은 무시한다', async () => {
  const { flow, verifies } = await ready();
  const drop = { dropX: .274222488, dropY: .433581296 };
  flow.drop(drop);
  flow.close();
  assert.equal(verifies[0].signal.aborted, true);
  verifies[0].resolve(success);
  await flush();
  assert.equal(flow.getSnapshot().phase, 'verifying');
  assert.equal(flow.getSnapshot().result, null);
  flow.setOpen(true);
  assert.equal(verifies.length, 2);
  assert.deepEqual(verifies[1].request, { challengeId: 'ch_one', ...drop });
  verifies[1].resolve(success);
  await flush();
  assert.equal(flow.getSnapshot().phase, 'snapping');
});

test('이전 시작 응답은 재열기 요청의 ID와 소재를 덮어쓰지 않는다', async () => {
  const { flow, starts } = setup();
  flow.setOpen(true);
  flow.close();
  flow.setOpen(true);
  starts[1].resolve({ challengeId: 'ch_new', creative });
  await flush();
  starts[0].resolve({ challengeId: 'ch_old', creative });
  await flush();
  assert.equal(flow.getSnapshot().challengeId, 'ch_new');
});

test('통신 오류 재열기는 오류를 보존하고 명시 재시도는 동일 verify 내용을 사용한다', async () => {
  const { flow, verifies } = await ready();
  flow.drop({ dropX: .27123456789, dropY: .4323456789 });
  verifies[0].reject(new ApiError('NETWORK', '연결 실패'));
  await flush();
  assert.equal(flow.getSnapshot().phase, 'error');
  assert.equal(flow.getSnapshot().error?.operation, 'verify');
  flow.close();
  flow.setOpen(true);
  assert.equal(verifies.length, 1);
  flow.retry();
  assert.equal(verifies.length, 2);
  assert.deepEqual(verifies[1].request, verifies[0].request);
});

test('이미지 실패 재시도는 새 인증을 만들지 않으며 이전 준비 완료는 무시한다', async () => {
  const { flow, starts } = setup();
  flow.setOpen(true);
  starts[0].resolve({ challengeId: 'ch_one', creative });
  await flush();
  const oldRun = flow.getSnapshot().run;
  flow.assetsError(oldRun);
  flow.retry();
  flow.assetsReady(oldRun);
  assert.equal(flow.getSnapshot().phase, 'loading');
  flow.assetsReady(flow.getSnapshot().run);
  assert.equal(flow.getSnapshot().phase, 'challenge');
  assert.equal(starts.length, 1);
});

test('연출 중 닫기는 스냅부터 복원하고 완료 재열기는 재검증하지 않는다', async () => {
  const { flow, starts, verifies } = await ready();
  flow.drop({ dropX: .274, dropY: .433 });
  verifies[0].resolve(success);
  await flush();
  const oldRun = flow.getSnapshot().run;
  flow.stageEnd('snapping', oldRun);
  flow.close();
  flow.stageEnd('revealing', oldRun);
  assert.equal(flow.getSnapshot().phase, 'snapping');
  flow.setOpen(true);
  flow.stageEnd('revealing', oldRun);
  assert.equal(flow.getSnapshot().phase, 'snapping');
  const newRun = flow.getSnapshot().run;
  flow.stageEnd('snapping', newRun);
  flow.stageEnd('revealing', newRun);
  flow.close();
  flow.setOpen(true);
  assert.equal(flow.getSnapshot().phase, 'completed');
  assert.equal(starts.length, 1);
  assert.equal(verifies.length, 1);
});

test('사라진 인증은 무의미한 동일 요청 재시도를 제공하지 않는다', async () => {
  const { flow, verifies } = await ready();
  flow.drop({ dropX: .274, dropY: .433 });
  verifies[0].reject(new ApiError('CHALLENGE_NOT_FOUND', '데모를 초기화해 주세요.', false));
  await flush();
  flow.retry();
  assert.equal(verifies.length, 1);
  assert.equal(flow.getSnapshot().phase, 'error');
});

test('리사이즈로 연출을 다시 시작하면 이전 실행의 종료가 적용되지 않는다', async () => {
  const { flow, verifies } = await ready();
  flow.drop({ dropX: .274, dropY: .433 });
  verifies[0].resolve(success);
  await flush();
  const oldRun = flow.getSnapshot().run;
  flow.stageEnd('snapping', oldRun);
  flow.resize();
  flow.stageEnd('revealing', oldRun);
  assert.equal(flow.getSnapshot().phase, 'snapping');
  assert.ok(flow.getSnapshot().run > oldRun);
});

async function snapped(onComplete: (result: import('../src/sdk/captchavatye/types.ts').CompletionResult) => void, onContinue = () => {}) {
  const fixture = await ready();
  fixture.flow.setCallbacks({ onComplete, onContinue });
  fixture.flow.drop({ dropX: .274, dropY: .433 });
  fixture.verifies[0].resolve(success);
  await flush();
  return fixture;
}

test('완료 콜백은 서버 true나 스냅 종료가 아니라 유효한 reveal 종료 뒤 ID 네 개를 전달한다', async () => {
  const delivered: unknown[] = [];
  const { flow } = await snapped(result => delivered.push(result));
  const run = flow.getSnapshot().run;
  assert.deepEqual(delivered, []);
  flow.stageEnd('revealing', run);
  assert.deepEqual(delivered, []);
  flow.stageEnd('snapping', run);
  assert.deepEqual(delivered, []);
  flow.stageEnd('revealing', run);
  assert.equal(flow.getSnapshot().phase, 'completed');
  assert.deepEqual(delivered, [{
    challengeId: 'ch_one', creativeId: 'bmw-m3-v1', completionId: 'cmp_one', clickId: 'clk_one',
  }]);
});

test('완료 가드는 재진입과 닫기·재열기 전에 세우며 전달 객체 변경은 저장 결과를 바꾸지 않는다', async () => {
  let count = 0;
  const { flow } = await snapped(result => {
    count += 1;
    assert.equal(flow.getSnapshot().phase, 'completed');
    flow.stageEnd('revealing', flow.getSnapshot().run);
    flow.close();
    flow.setOpen(true);
    result.completionId = 'changed_by_host';
  });
  const run = flow.getSnapshot().run;
  flow.stageEnd('snapping', run);
  flow.stageEnd('revealing', run);
  flow.stageEnd('revealing', run);
  flow.close();
  flow.setOpen(true);
  assert.equal(count, 1);
  assert.equal(flow.getSnapshot().result?.completionId, 'cmp_one');
});

test('숨긴 연출과 이전 run은 완료 콜백을 주지 않고 재열기의 새 연출만 한 번 전달한다', async () => {
  let count = 0;
  const { flow, starts, verifies } = await snapped(() => { count += 1; });
  const oldRun = flow.getSnapshot().run;
  flow.stageEnd('snapping', oldRun);
  flow.close();
  flow.stageEnd('revealing', oldRun);
  assert.equal(count, 0);
  flow.setOpen(true);
  flow.stageEnd('revealing', oldRun);
  assert.equal(count, 0);
  const run = flow.getSnapshot().run;
  flow.stageEnd('snapping', run);
  flow.stageEnd('revealing', run);
  assert.equal(count, 1);
  assert.equal(starts.length, 1);
  assert.equal(verifies.length, 1);
});

test('콜백 교체는 진행을 초기화하지 않고 완료 때의 최신 콜백을 사용한다', async () => {
  const delivered: string[] = [];
  const { flow, starts, verifies } = await snapped(() => delivered.push('old'));
  const run = flow.getSnapshot().run;
  flow.stageEnd('snapping', run);
  flow.setCallbacks({
    onComplete: () => delivered.push('new'),
    onContinue: () => delivered.push('continue-new'),
  });
  assert.equal(flow.getSnapshot().phase, 'revealing');
  assert.equal(flow.getSnapshot().run, run);
  flow.stageEnd('revealing', run);
  flow.continue();
  assert.deepEqual(delivered, ['new', 'continue-new']);
  flow.setCallbacks({ onComplete: () => delivered.push('too-late'), onContinue: () => {} });
  flow.close();
  flow.setOpen(true);
  assert.deepEqual(delivered, ['new', 'continue-new']);
  assert.equal(starts.length, 1);
  assert.equal(verifies.length, 1);
});

test('계속하기는 열린 completed에서만 전달하고 완료 자체가 계속하기를 실행하지 않는다', async () => {
  let count = 0;
  const { flow, verifies } = await ready();
  flow.setCallbacks({ onComplete: () => {}, onContinue: () => { count += 1; } });
  flow.continue();
  flow.drop({ dropX: .274, dropY: .433 });
  flow.continue();
  verifies[0].resolve(success);
  await flush();
  const run = flow.getSnapshot().run;
  flow.continue();
  flow.stageEnd('snapping', run);
  flow.continue();
  flow.stageEnd('revealing', run);
  assert.equal(count, 0);
  flow.close();
  flow.continue();
  assert.equal(count, 0);
  flow.setOpen(true);
  flow.continue();
  assert.equal(count, 1);
});

test('호스트 완료 콜백이 예외를 내도 인증 오류로 바꾸거나 다시 전달하지 않는다', async () => {
  let count = 0;
  const failure = new Error('host failure');
  const { flow } = await snapped(() => { count += 1; throw failure; });
  const run = flow.getSnapshot().run;
  flow.stageEnd('snapping', run);
  assert.throws(() => flow.stageEnd('revealing', run), failure);
  assert.equal(flow.getSnapshot().phase, 'completed');
  assert.equal(flow.getSnapshot().error, null);
  flow.close();
  flow.setOpen(true);
  flow.stageEnd('revealing', run);
  assert.equal(count, 1);
});

test('별도 SDK 시도의 완료 전달 가드는 독립적이다', async () => {
  let count = 0;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { flow } = await snapped(() => { count += 1; });
    const run = flow.getSnapshot().run;
    flow.stageEnd('snapping', run);
    flow.stageEnd('revealing', run);
    flow.close();
  }
  assert.equal(count, 2);
});

