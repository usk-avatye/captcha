import { resolveCreativeUrls } from './urls.ts';
import type { CreativeUrlBases } from './urls.ts';
import type { ChallengeResponse, Creative, NormalizedRect, VerifyRequest, VerifyResult } from './types.ts';

export class ApiError extends Error {
  code: string;
  retryable: boolean;
  constructor(code: string, message: string, retryable = true) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.retryable = retryable;
  }
}

export type CaptchaApi = {
  start: (creativeId: string, signal: AbortSignal) => Promise<ChallengeResponse>;
  verify: (request: VerifyRequest, signal: AbortSignal) => Promise<VerifyResult>;
};

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function rect(value: unknown): value is NormalizedRect {
  return record(value) && number(value.x) && number(value.y) && number(value.width) && number(value.height)
    && value.x >= 0 && value.y >= 0 && value.width > 0 && value.height > 0
    && value.x + value.width <= 1 && value.y + value.height <= 1;
}

function creative(value: unknown, creativeId: string): value is Creative {
  if (!record(value) || value.creativeId !== creativeId
      || !['version', 'imageUrl', 'coverUrl', 'pieceUrl', 'brandTitle', 'tagline', 'ctaLabel', 'landingPath']
        .every(key => text(value[key]))
      || !number(value.sourceWidth) || !Number.isInteger(value.sourceWidth) || value.sourceWidth <= 0
      || !number(value.sourceHeight) || !Number.isInteger(value.sourceHeight) || value.sourceHeight <= 0
      || !rect(value.lampRect) || !rect(value.zoomRect)
      || Math.abs(value.zoomRect.width - value.zoomRect.height) > 1e-9
      || !number(value.snapMs) || value.snapMs < 0
      || !number(value.revealMs) || value.revealMs < 0) return false;
  return true;
}

function httpError(status: number, body: unknown): ApiError {
  const detail = record(body) ? body.detail : null;
  if (Array.isArray(detail)) return new ApiError('VALIDATION_ERROR', '요청 값을 확인할 수 없어요. 화면을 새로고침해 주세요.', false);
  if (record(detail) && text(detail.code) && text(detail.message)) {
    return new ApiError(detail.code, detail.message, status >= 500);
  }
  return new ApiError('HTTP_' + status,
    status >= 500 ? '서버 응답을 받지 못했어요. 같은 요청으로 다시 시도할 수 있어요.'
      : '요청을 처리할 수 없어요. 화면을 새로고침해 주세요.', status >= 500);
}

async function post<T>(
  url: string, payload: unknown, external: AbortSignal, expectedStatus: number,
  parse: (value: unknown) => T | null,
): Promise<T> {
  if (external.aborted) throw new DOMException('Request aborted', 'AbortError');
  const controller = new AbortController();
  const abort = () => controller.abort();
  external.addEventListener('abort', abort, { once: true });
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 10000);
  try {
    const response = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: controller.signal,
    });
    let body: unknown;
    try { body = await response.json(); }
    catch { throw new ApiError('INVALID_RESPONSE', '서버 응답을 확인하지 못했어요. 다시 시도해 주세요.'); }
    if (!response.ok) throw httpError(response.status, body);
    const parsed = response.status === expectedStatus ? parse(body) : null;
    if (parsed === null) throw new ApiError('INVALID_RESPONSE', '서버 응답을 확인하지 못했어요. 다시 시도해 주세요.');
    return parsed;
  } catch (error) {
    if (external.aborted) throw new DOMException('Request aborted', 'AbortError');
    if (timedOut) throw new ApiError('TIMEOUT', '응답 시간이 초과됐어요. 같은 요청으로 다시 시도할 수 있어요.');
    if (error instanceof ApiError) throw error;
    throw new ApiError('NETWORK', '서버에 연결하지 못했어요. 연결 상태를 확인한 뒤 다시 시도해 주세요.');
  } finally {
    clearTimeout(timeout);
    external.removeEventListener('abort', abort);
  }
}

export function createCaptchaApi(baseUrl = '/api', bases?: CreativeUrlBases): CaptchaApi {
  const base = baseUrl.replace(/\/+$/, '');
  return {
    start: (creativeId, signal) => post(base + '/challenges', { creativeId }, signal, 201, value => {
      if (!record(value) || !text(value.challengeId) || !creative(value.creative, creativeId)) return null;
      try {
        return { challengeId: value.challengeId,
          creative: bases ? resolveCreativeUrls(value.creative, bases) : value.creative };
      } catch {
        throw new ApiError('CREATIVE_URL', '광고 주소 설정을 확인해 주세요.', false);
      }
    }),
    verify: (request, signal) => post<VerifyResult>(base + '/verify', request, signal, 200, value => {
      if (!record(value)) return null;
      if (value.passed === false) return { passed: false };
      if (value.passed === true && text(value.completionId) && text(value.clickId)) {
        return { passed: true, completionId: value.completionId, clickId: value.clickId };
      }
      return null;
    }),
  };
}

