import assert from 'node:assert/strict';
import test from 'node:test';
import { DemoApiError, submitTestDrive } from '../src/demo/testDriveApi.ts';

const body = { clickId: 'clk_abc', locationId: 'demo-center-a' as const, slotId: 'demo-slot-1' as const };
const result = { ...body, leadId: 'lead_abc', status: 'completed', isDemo: true };
const mock = (status: number, json: unknown) => async () => new Response(JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } });

test('201 첫 신청과 200 재전송은 동일 완료 결과를 반환한다', async () => {
  for (const status of [201, 200]) {
    const actual = await submitTestDrive(body, { transport: mock(status, result) });
    assert.deepEqual(actual, result);
  }
});

test('불확실한 5xx·잘못된 성공 응답은 재시도 가능한 오류다', async () => {
  for (const [status, response] of [[503, { detail: { code: 'BUSY', message: '다시 시도' } }], [200, { ...result, clickId: 'other' }]] as const) {
    await assert.rejects(submitTestDrive(body, { transport: mock(status, response) }), (error: unknown) =>
      error instanceof DemoApiError && error.retryable);
  }
});

test('404·409 업무 오류와 422 입력 오류를 구분한다', async () => {
  for (const [status, response, code] of [
    [404, { detail: { code: 'CLICK_NOT_FOUND', message: '없음' } }, 'CLICK_NOT_FOUND'],
    [409, { detail: { code: 'LEAD_CONFLICT', message: '변경 불가' } }, 'LEAD_CONFLICT'],
    [422, { detail: [{ loc: ['body', 'slotId'], msg: 'invalid' }] }, 'VALIDATION_ERROR'],
  ] as const) {
    await assert.rejects(submitTestDrive(body, { transport: mock(status, response) }), (error: unknown) =>
      error instanceof DemoApiError && error.code === code && !error.retryable);
  }
});

test('요청에 스냅샷을 전달하고 원래 요청값은 수정하지 않는다', async () => {
  const requests: Array<{ url: string; body: unknown }> = [];
  const response = await submitTestDrive(body, {
    apiBaseUrl: '/api',
    transport: async (input, init) => {
      requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify(result), { status: 201 });
    },
  });
  assert.deepEqual(response, result);
  assert.deepEqual(requests, [{ url: '/api/demo/test-drives', body }]);
});
