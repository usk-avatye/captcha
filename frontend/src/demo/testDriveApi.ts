import type { LocationId, SlotId } from './testDriveOptions.ts';

export type TestDriveRequest = { clickId: string; locationId: LocationId; slotId: SlotId };
export type TestDriveResult = TestDriveRequest & { leadId: string; status: 'completed'; isDemo: true };

export class DemoApiError extends Error {
  code: string;
  retryable: boolean;
  status?: number;
  constructor(code: string, message: string, retryable: boolean, status?: number) {
    super(message);
    this.name = 'DemoApiError';
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

type Options = {
  apiBaseUrl?: string;
  signal?: AbortSignal;
  transport?: typeof fetch;
  timeoutMs?: number;
};

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function failure(status: number, body: unknown): DemoApiError {
  const detail = object(body) ? body.detail : null;
  if (status === 422) return new DemoApiError(
    'VALIDATION_ERROR', '지점이나 시간을 다시 선택해 주세요.', false, status,
  );
  if (object(detail) && typeof detail.code === 'string' && typeof detail.message === 'string')
    return new DemoApiError(detail.code, detail.message, status >= 500, status);
  return new DemoApiError('HTTP_' + status,
    status >= 500 ? '서버 응답을 확인하지 못했어요. 같은 신청으로 다시 시도해 주세요.'
      : '요청을 처리할 수 없어요. 처음부터 다시 시도해 주세요.', status >= 500, status);
}

export async function submitTestDrive(request: TestDriveRequest, options: Options = {}): Promise<TestDriveResult> {
  const snapshot = Object.freeze({ ...request });
  if (options.signal?.aborted) throw new DOMException('Request aborted', 'AbortError');
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs ?? 10000);
  try {
    const response = await (options.transport ?? fetch)(
      (options.apiBaseUrl ?? '/api').replace(/\/+$/, '') + '/demo/test-drives', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(snapshot), signal: controller.signal,
      },
    );
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) throw failure(response.status, body);
    if ((response.status === 201 || response.status === 200) && object(body)
        && typeof body.leadId === 'string' && body.leadId.trim()
        && body.clickId === snapshot.clickId && body.locationId === snapshot.locationId
        && body.slotId === snapshot.slotId && body.status === 'completed' && body.isDemo === true)
      return { ...snapshot, leadId: body.leadId, status: 'completed', isDemo: true };
    throw new DemoApiError('INVALID_RESPONSE', '완료 응답을 확인하지 못했어요. 같은 신청으로 다시 시도해 주세요.', true, response.status);
  } catch (error) {
    if (options.signal?.aborted) throw new DOMException('Request aborted', 'AbortError');
    if (timedOut) throw new DemoApiError('TIMEOUT', '신청 결과를 확인하지 못했어요. 같은 신청으로 다시 시도해 주세요.', true);
    if (error instanceof DemoApiError) throw error;
    throw new DemoApiError('NETWORK', '연결이 끊겼어요. 같은 신청으로 다시 시도해 주세요.', true);
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abort);
  }
}
