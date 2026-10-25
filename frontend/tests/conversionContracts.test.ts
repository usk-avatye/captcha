import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createEventTracker, deliverEvent } from '../src/sdk/captchavatye/tracking.ts';
import { DemoApiError, submitTestDrive } from '../src/demo/testDriveApi.ts';

const event = { eventId: 'ev_contract', eventName: 'cta_clicked' as const, clickId: 'clk_contract', occurredAt: '2026-10-25T00:00:00Z' };
const request = { clickId: 'clk_contract', locationId: 'demo-center-a' as const, slotId: 'demo-slot-1' as const };
const completed = { ...request, leadId: 'lead_contract', status: 'completed', isDemo: true };
const accepted = () => new Response(JSON.stringify({ accepted: true, duplicate: false }), { status: 201 });

test('잘못된 이벤트 성공 본문은 네트워크 실패처럼 자동 재시도하지 않는다', async () => {
  for (const [status, body] of [
    [200, '{"accepted":true,"duplicate":false}'],
    [201, '{"accepted":true,"duplicate":true}'],
    [201, '{"accepted":false,"duplicate":false}'],
    [200, '{}'],
    [201, '<html>invalid success</html>'],
  ] as const) {
    let calls = 0;
    const pauses: number[] = [];
    const result = await deliverEvent('/api/events', event, {
      transport: async () => { calls++; return new Response(body, { status }); },
      pause: async ms => { pauses.push(ms); },
    });
    assert.equal(result, false);
    assert.equal(calls, 1, 'Invalid success HTTP ' + status + ' must not be retried');
    assert.deepEqual(pauses, []);
  }
});

test('이벤트 ID나 시각 생성 실패도 호출한 화면으로 예외를 전파하지 않는다', async () => {
  for (const fault of ['uuid', 'now'] as const) {
    let calls = 0;
    const tracker = createEventTracker('/api', {
      uuid: () => { if (fault === 'uuid') throw new Error('ID source unavailable'); return 'test'; },
      now: () => { if (fault === 'now') throw new Error('Clock unavailable'); return event.occurredAt; },
      transport: async () => { calls++; return accepted(); },
    });
    await assert.doesNotReject(async () => assert.equal(await tracker('cta_clicked', event.clickId), false));
    assert.equal(calls, 0);
  }
});

test('성공 헤더 이후 본문 수신 중 시간 초과는 같은 이벤트로 재시도한다', { timeout: 10000 }, async () => {
  const received: string[] = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    received.push(body);
    res.writeHead(201, { 'Content-Type': 'application/json' });
    if (received.length === 1) {
      res.write('{"accepted":');
      return; // 실제 소켓의 본문 수신 중 AbortSignal 기한을 검사한다.
    }
    res.end('{"accepted":true,"duplicate":false}');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/api/events';
    assert.equal(await deliverEvent(url, event, { timeoutMs: 200, pause: async () => {} }), true);
    assert.equal(received.length, 2);
    assert.equal(received[0], received[1]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('신청 5xx는 detail 배열이어도 결과 불확실 상태로 분류한다', async () => {
  await assert.rejects(submitTestDrive(request, {
    transport: async () => new Response(JSON.stringify({ detail: [{ msg: 'upstream unavailable' }] }), { status: 503 }),
  }), (error: unknown) => error instanceof DemoApiError && error.retryable && error.status === 503);
});

test('본문을 해석할 수 없는 신청 422도 실제 HTTP 상태를 보존한다', async () => {
  await assert.rejects(submitTestDrive(request, {
    transport: async () => new Response('<h1>invalid request</h1>', { status: 422 }),
  }), (error: unknown) => error instanceof DemoApiError && !error.retryable && error.status === 422);
});

test('신청 응답은 전달받은 객체의 나중 변경이 아니라 제출 스냅샷과 비교한다', async () => {
  const mutable = { clickId: request.clickId, locationId: request.locationId, slotId: request.slotId as 'demo-slot-1' | 'demo-slot-2' };
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let sent: unknown;
  const pending = submitTestDrive(mutable, {
    transport: async (_url, init) => {
      sent = JSON.parse(String(init?.body));
      await gate;
      return new Response(JSON.stringify(completed), { status: 201 });
    },
  });
  mutable.slotId = 'demo-slot-2';
  release();
  assert.deepEqual(await pending, completed);
  assert.deepEqual(sent, request);
});

test('신청 완료의 필드와 연결·선택지 또는 성공 상태가 다르면 완료로 받지 않는다', async () => {
  for (const body of [
    { ...completed, leadId: '' }, { ...completed, isDemo: false },
    { ...completed, status: 'pending' }, { ...completed, clickId: 'other' },
    { ...completed, locationId: 'demo-center-b' }, { ...completed, slotId: 'demo-slot-2' },
  ]) {
    await assert.rejects(submitTestDrive(request, {
      transport: async () => new Response(JSON.stringify(body), { status: 201 }),
    }), (error: unknown) => error instanceof DemoApiError && error.code === 'INVALID_RESPONSE' && error.retryable);
  }
  await assert.rejects(submitTestDrive(request, {
    transport: async () => new Response(JSON.stringify(completed), { status: 202 }),
  }), (error: unknown) => error instanceof DemoApiError && error.code === 'INVALID_RESPONSE');
});
