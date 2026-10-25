import assert from 'node:assert/strict';
import test from 'node:test';
import { createEventTracker, deliverEvent } from '../src/sdk/captchavatye/tracking.ts';

const accepted = (status = 201) => new Response(JSON.stringify({
  accepted: true, duplicate: status === 200,
}), { status, headers: { 'Content-Type': 'application/json' } });

test('동일 이벤트의 실패 재전송은 eventId와 occurredAt을 바꾸지 않는다', async () => {
  const sent: string[] = [];
  const slept: number[] = [];
  const event = { eventId: 'ev_test', eventName: 'cta_clicked' as const, clickId: 'clk_test', occurredAt: '2026-10-25T00:00:00Z' };
  const ok = await deliverEvent('/api/events', event, {
    transport: async (_url, init) => {
      sent.push(String(init?.body));
      return sent.length === 1 ? new Response('{}', { status: 503 }) : accepted();
    },
    pause: async ms => { slept.push(ms); },
  });
  assert.equal(ok, true);
  assert.equal(sent.length, 2);
  assert.equal(sent[0], sent[1]);
  assert.deepEqual(slept, [500]);
});

test('네트워크 실패는 최대 두 번 재시도하고 종료한다', async () => {
  let count = 0;
  const pauses: number[] = [];
  const event = { eventId: 'ev_test', eventName: 'cta_shown' as const, clickId: 'clk_test', occurredAt: '2026-10-25T00:00:00Z' };
  const ok = await deliverEvent('/api/events', event, {
    transport: async () => { count++; throw new Error('offline'); },
    pause: async ms => { pauses.push(ms); },
  });
  assert.equal(ok, false);
  assert.equal(count, 3);
  assert.deepEqual(pauses, [500, 1500]);
});

test('업무 오류 409는 재시도하지 않고 200 중복 응답은 성공이다', async () => {
  const event = { eventId: 'ev_test', eventName: 'landing_viewed' as const, clickId: 'clk_test', occurredAt: '2026-10-25T00:00:00Z' };
  let count = 0;
  const conflict = await deliverEvent('/api/events', event, {
    transport: async () => { count++; return new Response('{}', { status: 409 }); },
    pause: async () => { throw new Error('must not retry'); },
  });
  assert.equal(conflict, false);
  assert.equal(count, 1);
  assert.equal(await deliverEvent('/api/events', event, { transport: async () => accepted(200) }), true);
});

test('새 행동은 다른 eventId를 만들고 같은 clickId를 사용한다', async () => {
  const sent: Array<{ eventId: string; clickId: string; occurredAt: string; eventName: string }> = [];
  let i = 0;
  const track = createEventTracker('/api', {
    uuid: () => String(++i),
    now: () => '2026-10-25T00:00:00Z',
    transport: async (_url, init) => {
      sent.push(JSON.parse(String(init?.body)));
      return accepted();
    },
  });
  assert.equal(await track('cta_clicked', 'clk_same'), true);
  assert.equal(await track('cta_clicked', 'clk_same'), true);
  assert.deepEqual(sent.map(item => item.eventId), ['ev_1', 'ev_2']);
  assert.deepEqual(sent.map(item => item.clickId), ['clk_same', 'clk_same']);
  assert.deepEqual(sent.map(item => item.eventName), ['cta_clicked', 'cta_clicked']);
});
