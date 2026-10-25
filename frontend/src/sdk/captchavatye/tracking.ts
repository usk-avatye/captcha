export type ClientEventName = 'cta_shown' | 'cta_clicked' | 'landing_viewed';

export type ClientEvent = {
  eventId: string;
  eventName: ClientEventName;
  clickId: string;
  occurredAt: string;
};

type DeliveryOptions = {
  transport?: typeof fetch;
  pause?: (ms: number) => Promise<void>;
  timeoutMs?: number;
};
type TrackerOptions = DeliveryOptions & {
  uuid?: () => string;
  now?: () => string;
};

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const retryDelays = [500, 1500] as const;

/**
 * 분석 이벤트만 전송한다. 수집 실패는 인증·보상·신청 처리의 성공 여부가 아니다.
 * 재시도는 최초 생성한 payload 전체를 재사용하고, 페이지 종료 뒤 전송을 보장하지 않는다.
 */
export async function deliverEvent(url: string, event: Readonly<ClientEvent>, options: DeliveryOptions = {}): Promise<boolean> {
  const transport = options.transport ?? fetch;
  const pause = options.pause ?? sleep;
  const payload = JSON.stringify(event);

  for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10000);
    let receivedResponse = false;
    let shouldRetry = false;
    try {
      const response = await transport(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        signal: controller.signal,
      });
      receivedResponse = true;
      if (response.status === 200 || response.status === 201) {
        const body: unknown = await response.json();
        if (typeof body === 'object' && body !== null && 'accepted' in body && 'duplicate' in body
            && body.accepted === true && body.duplicate === (response.status === 200)) return true;
      } else {
        shouldRetry = response.status >= 500 && response.status < 600;
      }
    } catch (error) {
      // 2xx의 잘못된 JSON은 재시도하지 않는다. 본문 수신의 연결 실패·시간 초과는 재시도한다.
      shouldRetry = !receivedResponse || controller.signal.aborted || error instanceof TypeError;
    } finally {
      clearTimeout(timeout);
    }
    if (!shouldRetry || attempt === retryDelays.length) return false;
    try { await pause(retryDelays[attempt]); }
    catch { return false; }
  }
  return false;
}

export function createEventTracker(apiBaseUrl = '/api', options: TrackerOptions = {}) {
  const url = apiBaseUrl.replace(/\/+$/, '') + '/events';
  return async (eventName: ClientEventName, clickId: string): Promise<boolean> => {
    try {
      const event: Readonly<ClientEvent> = Object.freeze({
        eventId: 'ev_' + (options.uuid?.() ?? crypto.randomUUID()),
        eventName,
        clickId,
        occurredAt: options.now?.() ?? new Date().toISOString(),
      });
      return await deliverEvent(url, event, options);
    } catch {
      // 이벤트 생성과 전송 실패는 호출한 화면이나 링크 동작에 전파하지 않는다.
      return false;
    }
  };
}
