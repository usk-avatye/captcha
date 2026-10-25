import assert from 'node:assert/strict';
import { test } from 'node:test';
import { InteractionRecorder } from '../../packages/react/src/interactions.ts';
import type { InteractionSummary } from '../../packages/react/src/interactions.ts';

function setup(rate = 1) {
  let time = 0;
  const sent: InteractionSummary[] = [];
  const recorder = new InteractionRecorder({ now: () => time, random: () => 0.5, pathSampleRate: rate,
    deliver: async body => { sent.push(body); return true; } });
  recorder.setOpen(true);
  recorder.ready('ch_one');
  return { recorder, sent, at: (value: number) => { time = value; } };
}

test('first press and success use active time, pause hidden and closed intervals', async () => {
  const { recorder: r, sent, at } = setup();
  at(200); r.press(.1, .2);
  at(300); r.release(); r.miss(); r.setVisible(false);
  at(1300); r.setVisible(true);
  at(1500); r.setOpen(false);
  at(2500); r.setOpen(true);
  at(2700); r.passed();
  at(4000); r.setOpen(false);
  await r.flush();
  const final = sent.at(-1)!;
  assert.equal(final.metrics.firstInteractionMs, 200);
  assert.equal(final.metrics.solveMs, 700);
  assert.equal(final.metrics.missCount, 1);
  assert.equal(sent.length, 2); // hidden snapshot, then success; close has no new metrics.
});

test('null sample differs from empty sampled path and no press stays null', async () => {
  for (const rate of [0, 1]) {
    const { recorder: r, sent } = setup(rate);
    await r.flush();
    assert.equal(sent[0].metrics.firstInteractionMs, null);
    assert.equal(sent[0].metrics.solveMs, null);
    assert.deepEqual(sent[0].metrics.path, rate ? [] : null);
  }
});

test('sample throttles moves, clamps coordinates, keeps press and endpoint at cap', async () => {
  const { recorder: r, sent, at } = setup();
  r.press(-3, 4);
  at(50); r.move(.2, .3);
  at(100); r.move(.4, .5);
  at(120); r.move(.6, .7); r.release();
  r.press(.1, .1);
  for (let i = 2; i <= 150; i++) { at(i * 100); r.move(.5, .5); }
  at(15001); r.move(2, -1); r.release();
  await r.flush();
  const path = sent[0].metrics.path!;
  assert.equal(path.length, 100);
  assert.deepEqual(path[0], { x: 0, y: 1, t: 0, drag: 1 });
  assert.deepEqual(path[1], { x: .4, y: .5, t: 100, drag: 1 });
  assert.deepEqual(path[2], { x: .6, y: .7, t: 120, drag: 1 });
  assert.deepEqual(path.at(-1), { x: 1, y: 0, t: 15001, drag: 2 });
});

test('snapshots remain immutable and a failed retry uses identical revision', async () => {
  let calls = 0;
  const sent: InteractionSummary[] = [];
  const r = new InteractionRecorder({ now: () => 0, pathSampleRate: 1,
    deliver: async body => { sent.push(structuredClone(body)); return ++calls > 1; } });
  r.setOpen(true); r.ready('ch');
  await r.flush(); await r.flush();
  assert.deepEqual(sent[0], sent[1]);
  r.press(.2, .3); r.release();
  await r.flush();
  assert.equal(sent[2].revision, 2);
  assert.deepEqual(sent[0].metrics.path, []);
});

test('disabled collection and transport exceptions do not affect callers', async () => {
  const disabled = new InteractionRecorder({ enabled: false, deliver: async () => { throw Error('unexpected'); } });
  disabled.setOpen(true); disabled.ready('ch'); disabled.press(0, 0); disabled.passed();
  await disabled.flush();
  const r = new InteractionRecorder({ deliver: () => { throw Error('network'); } });
  r.setOpen(true); r.ready('ch'); r.passed(); await r.flush();
});
