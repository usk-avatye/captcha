import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CaptchaFlow } from '../../packages/react/src/flow.ts';
import { InteractionRecorder } from '../../packages/react/src/interactions.ts';
import type { InteractionSummary } from '../../packages/react/src/interactions.ts';
import { creative } from './fixtures.ts';

test('closing during image loading or image failure still stores an unmeasured summary', async () => {
  for (const fail of [false, true]) {
    const sent: InteractionSummary[] = [];
    const recorder = new InteractionRecorder({ pathSampleRate: 1,
      deliver: async body => { sent.push(body); return true; } });
    const flow = new CaptchaFlow('bmw-m3-v1', {
      start: async () => ({challengeId: 'ch_loading', creative}),
      verify: async () => ({passed: false}),
    }, recorder);
    flow.setOpen(true); await Promise.resolve();
    if (fail) flow.assetsError(flow.getSnapshot().run);
    flow.close(); await recorder.flush();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].challengeId, 'ch_loading');
    assert.deepEqual(sent[0].metrics, {firstInteractionMs: null, solveMs: null, missCount: 0, path: []});
  }
});

test('real flow counts server misses and response time before animations, ignores stale responses', async () => {
  let time = 0;
  let resolve!: (result: {passed: false} | {passed: true; completionId: string; clickId: string}) => void;
  const sent: InteractionSummary[] = [];
  const recorder = new InteractionRecorder({ now: () => time, deliver: async body => { sent.push(body); return true; } });
  const flow = new CaptchaFlow('bmw-m3-v1', {
    start: async () => ({challengeId: 'ch', creative}),
    verify: () => new Promise(done => { resolve = done; }),
  }, recorder);
  flow.setOpen(true); await Promise.resolve();
  time = 100; flow.assetsReady(flow.getSnapshot().run);
  time = 300; recorder.press(.1, .2); recorder.release();
  flow.drop({dropX: .1, dropY: .2}); resolve({passed: false}); await Promise.resolve();
  flow.drop({dropX: .1, dropY: .2}); flow.close();
  resolve({passed: false}); await Promise.resolve();
  time = 1300; flow.setOpen(true);
  time = 1800; resolve({passed: true, completionId: 'cmp', clickId: 'clk'}); await Promise.resolve();
  assert.equal(flow.getSnapshot().phase, 'snapping');
  time = 5000; flow.close(); await recorder.flush();
  assert.equal(sent.at(-1)!.metrics.firstInteractionMs, 200);
  assert.equal(sent.at(-1)!.metrics.solveMs, 700);
  assert.equal(sent.at(-1)!.metrics.missCount, 1);
});

test('observer exception cannot interrupt authentication', async () => {
  const broken = () => { throw Error('analytics'); };
  const flow = new CaptchaFlow('bmw-m3-v1', {
    start: async () => ({challengeId: 'ch', creative}),
    verify: async () => ({passed: true, completionId: 'cmp', clickId: 'clk'}),
  }, {ready: broken, miss: broken, passed: broken, setOpen: broken});
  flow.setOpen(true); await Promise.resolve(); flow.assetsReady(0);
  flow.drop({dropX: .1, dropY: .2}); await Promise.resolve();
  assert.equal(flow.getSnapshot().phase, 'snapping');
});
