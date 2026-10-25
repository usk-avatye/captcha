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
  keepalive?: boolean;
};
type TrackerOptions = DeliveryOptions & {
  uuid?: () => string;
  now?: () => string;
};

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const retryDelays = [500, 1500] as const;

/** 재시도마다 최초 JSON 본문을 재사용하고 수집 결과를 반환한다. */
export async function deliverRecord(url: string, record: unknown, options: DeliveryOptions = {}): Promise<boolean> {
  const transport = options.transport ?? fetch;
  const pause = options.pause ?? sleep;
  const payload = JSON.stringify(record);

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
        keepalive: options.keepalive,
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
      // 본문 수신의 연결 실패와 시간 초과도 재시도한다.
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

export function deliverEvent(url: string, event: Readonly<ClientEvent>, options: DeliveryOptions = {}) {
  return deliverRecord(url, event, options);
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
