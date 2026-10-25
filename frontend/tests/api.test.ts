import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createCaptchaApi, ApiError } from '../src/sdk/captchavatye/api.ts';
import { creative } from './fixtures.ts';

let origin = '';
let reply: { status: number; body: unknown } = { status: 200, body: {} };
let received: { path: string; body: unknown } | null = null;
const server = createServer(async (req, res) => {
  let text = '';
  for await (const chunk of req) text += chunk;
  received = { path: req.url!, body: JSON.parse(text) };
  res.writeHead(reply.status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(reply.body));
});
before(async () => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/api';
});
after(async () => {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
});

test('시작 계약과 검증 payload를 그대로 전송한다', async () => {
  const api = createCaptchaApi(origin + '/');
  reply = { status: 201, body: { challengeId: 'ch_real', creative } };
  assert.deepEqual(await api.start('bmw-m3-v1', new AbortController().signal), reply.body);
  assert.deepEqual(received, { path: '/api/challenges', body: { creativeId: 'bmw-m3-v1' } });
  const request = { challengeId: 'ch_real', dropX: .274, dropY: .433 };
  reply = { status: 200, body: { passed: true, completionId: 'cmp_real', clickId: 'clk_real' } };
  assert.deepEqual(await api.verify(request, new AbortController().signal), reply.body);
  assert.deepEqual(received, { path: '/api/verify', body: request });
});

test('ID가 없거나 잘못된 passed 응답은 성공으로 처리하지 않는다', async () => {
  const api = createCaptchaApi(origin);
  for (const body of [
    { passed: true }, { passed: 'true', completionId: 'x', clickId: 'y' },
    { passed: true, completionId: '', clickId: 'clk_1' },
    { passed: true, completionId: 'cmp_1', clickId: null },
  ]) {
    reply = { status: 200, body };
    await assert.rejects(api.verify({ challengeId: 'ch_x', dropX: .5, dropY: .5 }, new AbortController().signal),
      (error: unknown) => error instanceof ApiError && error.code === 'INVALID_RESPONSE');
  }
  reply = { status: 200, body: { passed: false } };
  assert.deepEqual(await api.verify({ challengeId: 'ch_x', dropX: 0, dropY: 0 }, new AbortController().signal), { passed: false });
});

test('잘못된 소재 rect와 다른 creative 응답은 이미지 준비로 넘기지 않는다', async () => {
  const api = createCaptchaApi(origin);
  for (const bad of [
    { ...creative, creativeId: 'other' },
    { ...creative, lampRect: { x: .9, y: .1, width: .2, height: .1 } },
    { ...creative, zoomRect: { x: 0, y: 0, width: .3, height: .4 } },
    { ...creative, sourceWidth: 0 },
  ]) {
    reply = { status: 201, body: { challengeId: 'ch_x', creative: bad } };
    await assert.rejects(api.start('bmw-m3-v1', new AbortController().signal),
      (error: unknown) => error instanceof ApiError && error.code === 'INVALID_RESPONSE');
  }
});

test('업무 404와 배열 422를 다른 오류로 정규화한다', async () => {
  const api = createCaptchaApi(origin);
  reply = { status: 404, body: { detail: { code: 'CHALLENGE_NOT_FOUND', message: '사라진 인증' } } };
  await assert.rejects(api.verify({ challengeId: 'old', dropX: 0, dropY: 0 }, new AbortController().signal),
    (error: unknown) => error instanceof ApiError && error.code === 'CHALLENGE_NOT_FOUND' && !error.retryable);
  reply = { status: 422, body: { detail: [{ loc: ['body', 'dropX'], msg: 'Invalid number', type: 'float_type' }] } };
  await assert.rejects(api.verify({ challengeId: 'x', dropX: 0, dropY: 0 }, new AbortController().signal),
    (error: unknown) => error instanceof ApiError && error.code === 'VALIDATION_ERROR');
});

test('닫혀서 취소된 요청은 전송하지 않는다', async () => {
  const abort = new AbortController();
  abort.abort();
  received = null;
  await assert.rejects(createCaptchaApi(origin).start('bmw-m3-v1', abort.signal), { name: 'AbortError' });
  assert.equal(received, null);
});

