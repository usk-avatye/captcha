import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { locations, slots } from '../demo/testDriveOptions';
import type { LocationId, SlotId } from '../demo/testDriveOptions';
import { DemoApiError, submitTestDrive } from '../demo/testDriveApi';
import type { TestDriveRequest, TestDriveResult } from '../demo/testDriveApi';
import { createEventTracker } from '../sdk/captchavatye/tracking';
import './TestDrivePage.css';

type Status = 'editing' | 'sending' | 'retry' | 'completed' | 'blocked';

export function TestDrivePage() {
  const [clickId] = useState(() => {
    const value = new URLSearchParams(window.location.search).get('clickId') ?? '';
    return value.trim() ? value : ''; // 비어 있는지만 검사하고 유효한 ID의 원문은 바꾸지 않는다.
  });
  const [trackEvent] = useState(() => createEventTracker('/api'));
  const viewed = useRef(false);
  const [locationId, setLocationId] = useState<LocationId | ''>('');
  const [slotId, setSlotId] = useState<SlotId | ''>('');
  const [status, setStatus] = useState<Status>('editing');
  const [pending, setPending] = useState<TestDriveRequest | null>(null);
  const [result, setResult] = useState<TestDriveResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const generation = useRef(0);

  useEffect(() => {
    if (!clickId || viewed.current) return;
    viewed.current = true;
    void trackEvent('landing_viewed', clickId).catch(() => {});
  }, [clickId, trackEvent]);

  useEffect(() => () => {
    generation.current += 1;
    activeRequest.current?.abort();
  }, []);

  async function send(request: TestDriveRequest) {
    if (inFlight.current) return; // React 상태 업데이트 전 동일 이벤트 루프의 중복 제출 방어
    inFlight.current = true;
    const current = ++generation.current;
    const controller = new AbortController();
    activeRequest.current = controller;
    setStatus('sending');
    setMessage(null);
    try {
      const completed = await submitTestDrive(request, { signal: controller.signal });
      if (generation.current !== current) return;
      setResult(completed);
      setStatus('completed');
    } catch (error) {
      if (generation.current !== current) return;
      const issue = error instanceof DemoApiError ? error
        : new DemoApiError('NETWORK', '연결을 확인할 수 없어요.', true);
      setMessage(issue.message);
      if (issue.retryable) setStatus('retry');
      else if (issue.status === 422) {
        setPending(null);
        setStatus('editing'); // 서버에서 거절됐으므로 선택지 수정 허용
      } else setStatus('blocked'); // 404·409는 성공 화면으로 바꾸지 않는다.
    } finally {
      if (generation.current === current) activeRequest.current = null;
      inFlight.current = false;
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!clickId || !locationId || !slotId || status !== 'editing') return;
    const request = Object.freeze({ clickId, locationId, slotId });
    setPending(request);
    void send(request);
  }

  const locked = status !== 'editing';
  return (
    <div className="drive-page">
      <header className="drive-topbar">
        <a className="drive-wordmark" href="/" aria-label="CAPTCHAvatye 데모 처음으로">CAPTCHAvatye</a>
        <span>BMW M3 · DEMO EXPERIENCE</span>
      </header>
      <main className="drive-main">
        <div className="drive-heading">
          <span className="eyebrow">THE M3 EXPERIENCE</span>
          <h1>당신의 다음 드라이브를<br />상상해 보세요.</h1>
          <p>BMW M3를 선택하고, 시연 전시장과 시간을 골라보세요.</p>
        </div>
        <div className="drive-grid">
          <section className="drive-showcase" aria-label="BMW M3 광고 이미지">
            <img src="/creatives/bmw-m3/vehicle.webp" alt="초록색 BMW M3 후면" />
            <div className="drive-showcase-caption"><strong>BMW M3</strong><span>Sheer Driving Pleasure</span></div>
          </section>
          <section className="drive-card" aria-labelledby="drive-form-heading">
            {status === 'completed' && result
              ? <div className="drive-success" role="status">
                  <span className="drive-success-icon" aria-hidden="true">✓</span>
                  <span className="eyebrow">DEMO COMPLETED</span>
                  <h2 id="drive-form-heading">모의 시승 신청 완료</h2>
                  <p>선택한 전시장과 시간으로 모의 신청을 완료했어요.<br />시연용 신청이며 실제 예약되지 않습니다.</p>
                  <dl>
                    <div><dt>전시장</dt><dd>{locations.find(item => item.id === result.locationId)?.label}</dd></div>
                    <div><dt>시연 시간</dt><dd>{slots.find(item => item.id === result.slotId)?.label}</dd></div>
                    <div className="drive-lead"><dt>신청 ID</dt><dd data-lead-id>{result.leadId}</dd></div>
                  </dl>
                  <p className="drive-back-tip">시승 신청은 선택 사항이며 포인트와 원래 글 등록에 영향을 주지 않아요.</p>
                </div>
              : !clickId
                ? <div className="drive-blocked" role="alert">
                    <h2 id="drive-form-heading">신청 링크를 확인해 주세요</h2>
                    <p>인증 연결 ID가 없어요. 광고 인증 화면에서 다시 시작해 주세요.</p>
                    <a className="drive-link" href="/">광고 데모로 돌아가기</a>
                  </div>
                : <>
                    <span className="eyebrow">TEST DRIVE REQUEST</span>
                    <h2 id="drive-form-heading">모의 시승 신청</h2>
                    <p className="drive-form-description">지점과 시간을 고른 뒤 신청을 완료해 보세요.</p>
                    <form onSubmit={submit}>
                      <label htmlFor="drive-location">시연 전시장</label>
                      <select id="drive-location" name="locationId" required value={locationId}
                        disabled={locked} onChange={event => setLocationId(event.target.value as LocationId | '')}>
                        <option value="">전시장을 선택해 주세요</option>
                        {locations.map(option => <option value={option.id} key={option.id}>{option.label}</option>)}
                      </select>
                      <label htmlFor="drive-slot">시연 시간</label>
                      <select id="drive-slot" name="slotId" required value={slotId}
                        disabled={locked} onChange={event => setSlotId(event.target.value as SlotId | '')}>
                        <option value="">시간을 선택해 주세요</option>
                        {slots.map(option => <option value={option.id} key={option.id}>{option.label}</option>)}
                      </select>
                      {message && <p className="drive-error" role="alert">{message}</p>}
                      {status === 'blocked' && <p className="drive-blocked-tip">
                        새 인증으로 다시 시작할 수 있어요. <a className="drive-link" href="/">광고 데모로 돌아가기</a>
                      </p>}
                      {status === 'retry' && pending
                        ? <button className="drive-submit" type="button" onClick={() => void send(pending)}>
                            같은 내용으로 다시 시도
                          </button>
                        : <button className="drive-submit" type="submit" disabled={locked || !locationId || !slotId}>
                            {status === 'sending' ? '신청 결과 확인 중…' : status === 'blocked' ? '신청할 수 없음' : '모의 시승 신청'}
                          </button>}
                    </form>
                    <p className="drive-privacy">시연용 페이지이며 실제 예약되지 않습니다.<br />이름·연락처를 수집하지 않습니다.</p>
                  </>}
          </section>
        </div>
      </main>
      <footer className="drive-footer">CAPTCHAvatye PoC · 실제 BMW 제휴·예약이 아닌 시연입니다.</footer>
    </div>
  );
}
