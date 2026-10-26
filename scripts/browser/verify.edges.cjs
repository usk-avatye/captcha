const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

// Run against the current community UI and the real local API. Successful API
// responses and image decoding are never fabricated. The two lifetime probes
// delay delivery of real fetch/decode results, including after cancellation.
// No production modules, fixtures, browser profiles, or package installs change.
const origin = 'http://127.0.0.1:5173';
const output = __dirname;
const tests = [], results = [], pageErrors = [];
let browser, browserVersion, runnerError, selectedCases = [];
const test = (name, body, options = {}) => tests.push({ name, body, options });
const calls = (requests, pathname) => requests.filter(item => item.path === pathname);
const starts = requests => calls(requests, '/api/challenges');
const verifies = requests => calls(requests, '/api/verify');
const eventCalls = (requests, name) => calls(requests, '/api/events').filter(item => !name || item.body.eventName === name);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function until(predicate, message, timeout = 6500) {
  const deadline = Date.now() + timeout;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error(message);
    await pause(25);
  }
}
async function frames(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function phase(page, value) {
  await page.locator('.car-stage[data-phase="' + value + '"]').waitFor({ state: 'attached' });
}
async function points(page, value) {
  await page.waitForFunction(expected => document.querySelector('[data-points]')?.textContent.trim() === expected, value + 'P');
}
async function visitDraft(page) {
  await page.goto(origin);
  await page.locator('[data-points]').waitFor();
  assert.equal(await page.locator('dialog').evaluate(dialog => dialog.open), false);
  const draft = { title: '현재 화면의 드래그와 수명 검증', body: '닫았다 열어도 이 글을 유지합니다.\n원래 작업은 계속하기로 한 번 등록합니다.' };
  await page.getByLabel('제목', { exact: true }).fill(draft.title);
  await page.getByLabel('본문', { exact: true }).fill(draft.body);
  return draft;
}
async function open(page) {
  await page.getByRole('button', { name: /^(인증하고 등록하기|인증 결과 이어보기)$/ }).click();
  await page.waitForFunction(() => document.querySelector('dialog').open);
}
async function close(page) {
  await page.getByRole('button', { name: '인증 화면 닫기', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('dialog').open);
}
async function untouched(page, draft, dialogOpen) {
  assert.equal(await page.getByLabel('제목', { exact: true }).inputValue(), draft.title);
  assert.equal(await page.getByLabel('본문', { exact: true }).inputValue(), draft.body);
  assert.equal(await page.locator('dialog').evaluate(dialog => dialog.open), dialogOpen);
  await points(page, 0);
  assert.equal(await page.locator('.community-post').count(), 0);
  assert.equal(await page.locator('a.brand-cta').count(), 0);
}
async function ready(page) {
  const draft = await visitDraft(page);
  const pending = page.waitForResponse(response => new URL(response.url()).pathname === '/api/challenges');
  await open(page);
  const response = await pending;
  assert.equal(response.status(), 201);
  const challenge = await response.json();
  await phase(page, 'challenge');
  return { draft, challenge };
}
async function boxes(page) {
  const value = {
    piece: await page.locator('[data-piece]').boundingBox(),
    socket: await page.locator('[data-socket]').boundingBox(),
    image: await page.locator('.vehicle-image').boundingBox(),
  };
  assert.ok(value.piece && value.socket && value.image, 'The real puzzle geometry must be measurable');
  return value;
}
const center = box => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
const normalized = (point, image) => ({ dropX: (point.x - image.x) / image.width, dropY: (point.y - image.y) / image.height });
const answer = challenge => ({
  dropX: challenge.creative.lampRect.x + challenge.creative.lampRect.width / 2,
  dropY: challenge.creative.lampRect.y + challenge.creative.lampRect.height / 2,
});
function sameCoordinates(actual, expected) {
  for (const key of ['dropX', 'dropY']) assert.ok(Math.abs(actual[key] - expected[key]) < .0001,
    key + ' must describe the same original-image center: ' + actual[key] + ' versus ' + expected[key]);
}
function restored(actual, initial) {
  for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(actual[key] - initial[key]) < 1,
    'The piece must return to its initial ' + key);
}
async function beginDrag(page, b, grabX = .5, grabY = .5) {
  await page.mouse.move(b.piece.x + b.piece.width * grabX, b.piece.y + b.piece.height * grabY);
  await page.mouse.down();
  assert.equal(await page.locator('[data-piece]').getAttribute('data-dragging'), 'true');
}
async function drag(page, options = {}) {
  const b = await boxes(page);
  const grabX = options.grabX ?? .5, grabY = options.grabY ?? .5;
  const destination = options.point ? {
    x: b.image.x + options.point.dropX * b.image.width,
    y: b.image.y + options.point.dropY * b.image.height,
  } : center(b.socket);
  await beginDrag(page, b, grabX, grabY);
  await page.mouse.move(destination.x + b.piece.width * (grabX - .5),
    destination.y + b.piece.height * (grabY - .5), { steps: 8 });
  await page.mouse.up();
  return { boxes: b, grab: { x: grabX, y: grabY }, expected: normalized(destination, b.image) };
}
async function verifiedResponse(pending) {
  const response = await pending;
  assert.equal(response.status(), 200);
  const result = await response.json();
  assert.equal(result.passed, true, 'Only a genuine server success may complete the puzzle');
  return result;
}
async function succeed(page, requests, challenge, options = {}) {
  const pending = page.waitForResponse(response => new URL(response.url()).pathname === '/api/verify');
  const geometry = await drag(page, options);
  const result = await verifiedResponse(pending);
  await phase(page, 'completed');
  await points(page, 10);
  assert.equal(await page.locator('.community-post').count(), 0);
  const request = verifies(requests).at(-1).body;
  assert.equal(request.challengeId, challenge.challengeId);
  sameCoordinates(request, answer(challenge));
  return { geometry, request, result };
}
async function pointerIdOnNextDrag(page) {
  await page.locator('[data-piece]').evaluate(element => element.addEventListener('pointerdown', event => {
    window.__stage5PointerId = event.pointerId;
  }, { once: true }));
}

// A cancelled transport can still settle. Hold the first two REAL start results
// and detach only their AbortSignal; release one hidden and one after reopening.
async function installStartDeliveryGate(page, cleanup) {
  await page.addInitScript(() => {
    const original = window.fetch.bind(window), records = [], releases = [];
    window.__stage5StartDelivery = { records, release: index => releases[index]?.(), releaseAll: () => releases.forEach(release => release()) };
    window.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      if (url.pathname !== '/api/challenges') return original(input, init);
      const index = records.length, held = index < 2, signal = init?.signal;
      const record = { index, held, response: null, delivered: false, abortedAtDelivery: false };
      records.push(record);
      let release;
      const delivery = new Promise(resolve => { release = resolve; });
      releases[index] = release;
      const response = await original(input, held ? { ...init, signal: undefined } : init);
      record.status = response.status;
      record.response = await response.clone().json();
      if (held) await delivery;
      record.abortedAtDelivery = !!signal?.aborted;
      record.delivered = true;
      return response;
    };
  });
  cleanup(() => page.evaluate(() => window.__stage5StartDelivery?.releaseAll()));
}
async function startRecord(page, index) {
  await page.waitForFunction(index => !!window.__stage5StartDelivery.records[index]?.response, index);
  const record = await page.evaluate(index => window.__stage5StartDelivery.records[index], index);
  assert.equal(record.status, 201);
  return record;
}
async function releaseStart(page, index) {
  await page.evaluate(index => window.__stage5StartDelivery.release(index), index);
  await page.waitForFunction(index => window.__stage5StartDelivery.records[index].delivered, index);
  await frames(page);
  const record = await page.evaluate(index => window.__stage5StartDelivery.records[index], index);
  assert.equal(record.abortedAtDelivery, true, 'The stale result must actually be delivered after cancellation');
}

// Native decode() still fetches and validates each real asset. Only resolution
// delivery is gated. Epochs encompass StrictMode's additional effect executions.
async function installDecodeDeliveryGate(page, cleanup) {
  await page.addInitScript(() => {
    const original = HTMLImageElement.prototype.decode, records = [], releases = [];
    let epoch = 0;
    window.__stage5DecodeDelivery = {
      records, setEpoch: value => { epoch = value; },
      release: value => releases.filter(slot => slot.epoch === value).forEach(slot => slot.release()),
      releaseAll: () => releases.forEach(slot => slot.release()),
    };
    HTMLImageElement.prototype.decode = function () {
      const record = { index: records.length, epoch, src: this.src, nativeReady: false, delivered: false };
      records.push(record);
      let release;
      const delivery = new Promise(resolve => { release = resolve; });
      releases.push({ epoch, release });
      return original.call(this).then(async () => {
        record.nativeReady = true;
        record.naturalWidth = this.naturalWidth;
        record.naturalHeight = this.naturalHeight;
        await delivery;
        record.delivered = true;
      });
    };
  });
  cleanup(() => page.evaluate(() => window.__stage5DecodeDelivery?.releaseAll()));
}
async function decoded(page, epoch) {
  await page.waitForFunction(epoch => {
    const records = window.__stage5DecodeDelivery.records.filter(record => record.epoch === epoch);
    return records.length >= 3 && records.every(record => record.nativeReady);
  }, epoch);
}
async function releaseDecodes(page, epoch) {
  await page.evaluate(epoch => window.__stage5DecodeDelivery.release(epoch), epoch);
  await page.waitForFunction(epoch => window.__stage5DecodeDelivery.records
    .filter(record => record.epoch === epoch).every(record => record.delivered), epoch);
  await frames(page);
}

test('miss_then_recovery_current_ui', async ({ page, requests }) => {
  const { draft, challenge } = await ready(page), initial = (await boxes(page)).piece;
  const expected = answer(challenge), missPoint = { dropX: expected.dropX - .07, dropY: expected.dropY + .05 };
  const pending = page.waitForResponse(response => new URL(response.url()).pathname === '/api/verify');
  const missGeometry = await drag(page, { point: missPoint });
  const response = await pending;
  assert.equal(response.status(), 200);
  assert.deepEqual(await response.json(), { passed: false });
  await phase(page, 'challenge');
  assert.match(await page.locator('#captcha-description').textContent(), /아직 위치가 맞지 않아요/);
  const afterMiss = (await boxes(page)).piece;
  restored(afterMiss, initial);
  await untouched(page, draft, true);
  assert.equal(verifies(requests).length, 1);
  sameCoordinates(verifies(requests)[0].body, missPoint);
  const recovery = await succeed(page, requests, challenge);
  assert.equal(verifies(requests).length, 2);
  assert.ok(verifies(requests).every(request => request.body.challengeId === challenge.challengeId));
  return { initial, afterMiss, missGeometry, recovery };
});

test('outside_image_drop_no_clamp_or_verify', async ({ page, requests }) => {
  const { draft, challenge } = await ready(page), b = await boxes(page);
  const destination = { x: b.image.x + b.image.width + 80, y: b.image.y + b.image.height + 80 };
  await beginDrag(page, b);
  await page.mouse.move(destination.x, destination.y, { steps: 8 });
  const moved = await page.locator('[data-piece]').boundingBox();
  const actual = center(moved), outside = normalized(actual, b.image);
  assert.ok(Math.abs(actual.x - destination.x) < 1 && Math.abs(actual.y - destination.y) < 1,
    'Dragging beyond the original image must not clamp the piece to a boundary');
  assert.ok(outside.dropX > 1 && outside.dropY > 1);
  await page.mouse.up();
  await frames(page);
  await phase(page, 'challenge');
  assert.equal(verifies(requests).length, 0, 'An outside-image release must never send a clamped verify request');
  const afterOutside = (await boxes(page)).piece;
  restored(afterOutside, b.piece);
  await untouched(page, draft, true);
  const recovery = await succeed(page, requests, challenge);
  assert.equal(verifies(requests).length, 1);
  return { initial: b, destination, outside, afterOutside, recovery };
});

test('pointercancel_restores_without_verify', async ({ page, requests }) => {
  const { draft, challenge } = await ready(page), b = await boxes(page);
  await pointerIdOnNextDrag(page);
  await beginDrag(page, b);
  const target = center(b.socket);
  await page.mouse.move(target.x, target.y, { steps: 8 });
  await page.locator('[data-piece]').dispatchEvent('pointercancel', {
    pointerId: await page.evaluate(() => window.__stage5PointerId), pointerType: 'mouse', isPrimary: true, bubbles: true,
  });
  await page.mouse.up();
  await frames(page);
  assert.equal(await page.locator('[data-piece]').getAttribute('data-dragging'), null);
  assert.equal(verifies(requests).length, 0);
  const afterCancel = (await boxes(page)).piece;
  restored(afterCancel, b.piece);
  await untouched(page, draft, true);
  const recovery = await succeed(page, requests, challenge);
  assert.equal(verifies(requests).length, 1);
  return { initial: b.piece, afterCancel, recovery };
});

test('final_pointerup_coordinates', async ({ page, requests }) => {
  const { challenge } = await ready(page), b = await boxes(page), target = center(b.socket);
  await pointerIdOnNextDrag(page);
  await beginDrag(page, b);
  await page.mouse.move(target.x - 100, target.y + 70, { steps: 5 });
  const pending = page.waitForResponse(response => new URL(response.url()).pathname === '/api/verify');
  // The final release deliberately differs from the last move, as on coalesced input.
  await page.locator('[data-piece]').dispatchEvent('pointerup', {
    pointerId: await page.evaluate(() => window.__stage5PointerId), clientX: target.x, clientY: target.y,
    button: 0, pointerType: 'mouse', isPrimary: true, bubbles: true,
  });
  await page.mouse.up();
  const result = await verifiedResponse(pending);
  await phase(page, 'completed');
  await points(page, 10);
  assert.equal(verifies(requests).length, 1);
  sameCoordinates(verifies(requests)[0].body, answer(challenge));
  return { lastMove: { x: target.x - 100, y: target.y + 70 }, finalPointerup: target, result };
});

test('resize_cancels_drag_and_recovers', async ({ page, requests }) => {
  const { draft, challenge } = await ready(page), b = await boxes(page);
  await beginDrag(page, b, .1, .5);
  const target = center(b.socket);
  await page.mouse.move(target.x, target.y, { steps: 5 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.querySelector('.car-stage').getBoundingClientRect().width < 400
    && !document.querySelector('[data-piece]').hasAttribute('data-dragging'));
  await page.mouse.up();
  await frames(page);
  await phase(page, 'challenge');
  assert.equal(verifies(requests).length, 0, 'Resizing an active drag must cancel it without verifying');
  await untouched(page, draft, true);
  const afterResize = await boxes(page);
  assert.ok(afterResize.piece.width < b.piece.width);
  const recovery = await succeed(page, requests, challenge);
  assert.equal(verifies(requests).length, 1);
  return { beforeResize: b, afterResize, recovery };
});

test('grab_offsets_and_viewports_same_normalized_center', async ({ page, requests }) => {
  const trials = [];
  for (const trial of [
    { width: 1280, height: 900, grabX: .5, grabY: .5 },
    { width: 1280, height: 900, grabX: .06, grabY: .88 },
    { width: 390, height: 844, grabX: .5, grabY: .5 },
    { width: 390, height: 844, grabX: .9, grabY: .15 },
  ]) {
    await page.setViewportSize({ width: trial.width, height: trial.height });
    const { challenge } = await ready(page);
    trials.push({ ...trial, ...(await succeed(page, requests, challenge, trial)) });
  }
  assert.equal(verifies(requests).length, trials.length);
  assert.equal(new Set(trials.map(trial => trial.request.challengeId)).size, trials.length);
  for (const trial of trials) sameCoordinates(trial.request, trials[0].request);
  return { trials, coordinateTolerance: .0001 };
});

test('start_close_ignores_hidden_and_old_responses', async ({ page, requests, cleanup }) => {
  await installStartDeliveryGate(page, cleanup);
  const draft = await visitDraft(page);
  await open(page);
  await startRecord(page, 0);
  await phase(page, 'loading');
  await close(page);
  await releaseStart(page, 0);
  await phase(page, 'loading');
  assert.equal(await page.locator('.vehicle-image').count(), 0, 'A hidden late start must not install its creative');
  await untouched(page, draft, false);

  await open(page);
  await startRecord(page, 1);
  await phase(page, 'loading');
  await close(page);
  await untouched(page, draft, false);
  await open(page);
  const current = await startRecord(page, 2);
  await phase(page, 'challenge');
  await releaseStart(page, 1);
  await phase(page, 'challenge');
  await untouched(page, draft, true);
  assert.equal(starts(requests).length, 3, 'Only starts closed before ID delivery may be restarted');
  const recovery = await succeed(page, requests, current.response);
  assert.equal(verifies(requests).length, 1);
  const deliveries = await page.evaluate(() => window.__stage5StartDelivery.records);
  assert.equal(new Set(deliveries.map(record => record.response.challengeId)).size, 3);
  assert.notEqual(recovery.request.challengeId, deliveries[0].response.challengeId);
  assert.notEqual(recovery.request.challengeId, deliveries[1].response.challengeId);
  return { deliveries, recovery };
});

test('asset_close_ignores_hidden_and_old_decodes', async ({ page, requests, cleanup }) => {
  await installDecodeDeliveryGate(page, cleanup);
  const draft = await visitDraft(page);
  const pending = page.waitForResponse(response => new URL(response.url()).pathname === '/api/challenges');
  await open(page);
  const response = await pending;
  assert.equal(response.status(), 201);
  const challenge = await response.json();
  await decoded(page, 0);
  await phase(page, 'loading');
  await close(page);
  await releaseDecodes(page, 0);
  await phase(page, 'loading');
  await untouched(page, draft, false);

  await page.evaluate(() => window.__stage5DecodeDelivery.setEpoch(1));
  await open(page);
  await decoded(page, 1);
  await close(page);
  await untouched(page, draft, false);
  await page.evaluate(() => window.__stage5DecodeDelivery.setEpoch(2));
  await open(page);
  await decoded(page, 2);
  await releaseDecodes(page, 1);
  await phase(page, 'loading');
  assert.equal(await page.locator('[data-piece]').count(), 0, 'Old asset readiness must not finish the current loading run');
  await untouched(page, draft, true);
  assert.equal(starts(requests).length, 1, 'An already received challenge ID must be reused through asset loading');
  assert.equal(verifies(requests).length, 0);

  await releaseDecodes(page, 2);
  await phase(page, 'challenge');
  const recovery = await succeed(page, requests, challenge);
  assert.equal(starts(requests).length, 1);
  assert.equal(verifies(requests).length, 1);
  const deliveries = await page.evaluate(() => window.__stage5DecodeDelivery.records);
  assert.ok(deliveries.every(record => record.nativeReady && record.delivered && record.naturalWidth > 0 && record.naturalHeight > 0));
  return { challengeId: challenge.challengeId, deliveries, recovery };
});

test('all_events_503_preserves_application_and_original_post', async ({ page, context, requests }) => {
  await context.route('**/api/events', route => route.fulfill({
    status: 503, contentType: 'application/json',
    body: JSON.stringify({ detail: { code: 'STAGE5_EVENT_OUTAGE', message: 'Controlled client-event delivery failure' } }),
  }));
  const { draft, challenge } = await ready(page);
  const completed = await succeed(page, requests, challenge);
  const cta = page.locator('a.brand-cta');
  await cta.waitFor({ state: 'visible' });
  const href = await cta.getAttribute('href');
  const clickId = new URL(href, origin).searchParams.get('clickId');
  assert.equal(clickId, completed.result.clickId);
  const [child] = await Promise.all([context.waitForEvent('page', { timeout: 2500 }), cta.click()]);
  await child.waitForURL('**/demo/test-drive?clickId=*');
  await child.getByLabel('시연 전시장', { exact: true }).waitFor();
  assert.equal(await child.evaluate(() => window.opener), null);
  assert.equal(new URL(child.url()).searchParams.get('clickId'), clickId);
  await child.getByLabel('시연 전시장', { exact: true }).selectOption('demo-center-b');
  await child.getByLabel('시연 시간', { exact: true }).selectOption('demo-slot-2');
  const pending = child.waitForResponse(response => new URL(response.url()).pathname === '/api/demo/test-drives');
  await child.getByRole('button', { name: '모의 시승 신청', exact: true }).click();
  const response = await pending;
  assert.equal(response.status(), 201, 'Application success must come from the actual API despite the event outage');
  const application = await response.json();
  await child.getByRole('heading', { name: '모의 시승 신청 완료', exact: true }).waitFor();
  assert.equal((await child.locator('[data-lead-id]').textContent()).trim(), application.leadId);
  assert.match(application.leadId, /^lead_\S+$/);

  await page.bringToFront();
  await points(page, 10);
  await close(page);
  assert.equal(await page.getByLabel('제목', { exact: true }).inputValue(), draft.title);
  assert.equal(await page.getByLabel('본문', { exact: true }).inputValue(), draft.body);
  await open(page);
  await phase(page, 'completed');
  await points(page, 10);
  assert.equal(await page.locator('a.brand-cta').getAttribute('href'), href);
  assert.equal(starts(requests).length, 1);
  assert.equal(verifies(requests).length, 1);
  await page.getByRole('button', { name: '원래 작업 계속하기', exact: true }).click();
  await page.getByRole('heading', { name: '게시글이 등록됐어요', exact: true }).waitFor();
  await points(page, 10);
  assert.equal(await page.locator('.community-post').count(), 1);
  assert.equal(await page.locator('.community-post h3').textContent(), draft.title);
  assert.equal(await page.locator('.community-post .post-body').textContent(), draft.body);
  assert.equal(await page.locator('dialog').evaluate(dialog => dialog.open), false);

  const names = ['cta_shown', 'cta_clicked', 'landing_viewed'];
  await until(() => names.every(name => eventCalls(requests, name).length >= 3
    && eventCalls(requests, name).every(request => request.status === 503)), 'All three event kinds must exhaust their three bounded attempts', 4500);
  assert.equal(eventCalls(requests).length, 9);
  const deliveryCounts = {};
  for (const name of names) {
    const attempts = eventCalls(requests, name);
    assert.equal(attempts.length, 3);
    assert.equal(new Set(attempts.map(request => request.body.eventId)).size, 1);
    assert.equal(attempts[0].body.clickId, clickId);
    for (const attempt of attempts) assert.deepEqual(attempt.body, attempts[0].body);
    deliveryCounts[name] = { attempts: attempts.length, statuses: attempts.map(request => request.status), eventId: attempts[0].body.eventId };
  }
  assert.equal(eventCalls(requests).filter(request => request.status === 200 || request.status === 201).length, 0);
  assert.equal(calls(requests, '/api/demo/test-drives').length, 1);
  assert.deepEqual(calls(requests, '/api/demo/test-drives')[0].body, { clickId, locationId: 'demo-center-b', slotId: 'demo-slot-2' });
  await points(page, 10);
  return { clickId, application, applicationStatus: response.status(), deliveryCounts, acceptedClientEvents: 0, points: 10, posts: 1 };
}, { allowConversion: true });

async function saveResults() {
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, 'edges-results.json'), JSON.stringify({
    recordedAt: new Date().toISOString(), browser: browserVersion, origin,
    mode: 'Current community UI: missing V02/V04 edges and combined V05/V06 all-client-events outage',
    selectedCases, passed: results.filter(result => result.passed).length,
    failed: results.filter(result => !result.passed).length, results, pageErrors, runnerError,
  }, null, 2) + '\n');
}
async function run(entry) {
  const began = Date.now(), requests = [], casePageErrors = [], cleanups = [], responseJobs = new Set();
  const requestRecords = new Map(), wired = new Set();
  let context, page, detail, failure, failureState;
  try {
    context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR', serviceWorkers: 'block' });
    context.on('page', current => {
      if (wired.has(current)) return;
      wired.add(current);
      current.setDefaultTimeout(6500);
      current.on('pageerror', error => {
        const record = { name: entry.name, pageUrl: current.url(), message: error.message };
        casePageErrors.push(record); pageErrors.push(record);
      });
    });
    context.on('request', request => {
      const url = new URL(request.url());
      if (!url.pathname.startsWith('/api/')) return;
      let body;
      try { body = request.postDataJSON(); } catch { body = request.postData(); }
      const record = { sequence: requests.length + 1, path: url.pathname, method: request.method(), body };
      requests.push(record); requestRecords.set(request, record);
    });
    context.on('response', response => {
      const record = requestRecords.get(response.request());
      if (!record) return;
      record.status = response.status();
      const job = response.json().then(body => { record.response = body; }, error => { record.responseReadError = error.message; });
      responseJobs.add(job);
      void job.finally(() => responseJobs.delete(job));
    });
    context.on('requestfailed', request => {
      const record = requestRecords.get(request);
      if (record) record.failure = request.failure()?.errorText;
    });
    // Context routing and a fresh CDP cache-disabled page avoid warm asset cache
    // making a loading interception disappear. All traffic remains on loopback.
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    detail = await entry.body({ page, context, requests, cleanup: callback => cleanups.push(callback) });
    await frames(page);
    if (!entry.options.allowConversion) {
      assert.equal(calls(requests, '/api/demo/test-drives').length, 0);
      assert.ok(eventCalls(requests).every(request => request.body.eventName === 'cta_shown'));
    }
    assert.deepEqual(casePageErrors, []);
  } catch (error) {
    failure = error;
    if (page && !page.isClosed()) {
      failureState = await page.evaluate(() => ({
        url: location.href, dialogOpen: document.querySelector('dialog')?.open,
        phase: document.querySelector('.car-stage')?.getAttribute('data-phase'),
        points: document.querySelector('[data-points]')?.textContent,
        title: document.querySelector('#post-title')?.value, body: document.querySelector('#post-body')?.value,
        posts: document.querySelectorAll('.community-post').length,
      })).catch(() => null);
      await page.screenshot({ path: path.join(output, 'edges-' + entry.name + '-failed.png'), fullPage: true }).catch(() => {});
    }
  } finally {
    for (const cleanup of cleanups) await cleanup().catch(() => {});
    await Promise.allSettled([...responseJobs]);
    await context?.close().catch(error => { failure ||= error; });
    if (casePageErrors.length && !failure) failure = new Error('Unexpected browser page errors');
    const passed = !failure;
    results.push({
      name: entry.name, status: passed ? 'passed' : 'failed', passed, durationMs: Date.now() - began,
      ...(failure ? { message: failure.message, stack: failure.stack, failureState } : { detail }),
      requestCounts: { starts: starts(requests).length, verifies: verifies(requests).length,
        events: eventCalls(requests).length, applications: calls(requests, '/api/demo/test-drives').length },
      requests, pageErrors: casePageErrors,
    });
    console.log(JSON.stringify({ name: entry.name, status: passed ? 'passed' : 'failed', message: failure?.message }));
    await saveResults();
  }
}

(async () => {
  try {
    await fs.mkdir(output, { recursive: true });
    const args = process.argv.slice(2);
    let selection;
    if (args.length) {
      if (args.length === 2 && args[0] === '--case') selection = args[1];
      else if (args.length === 1 && args[0].startsWith('--case=')) selection = args[0].slice(7);
      else throw new Error('Usage: node verify.edges.cjs [--case NAME]');
      assert.ok(tests.some(entry => entry.name === selection), 'Unknown case: ' + selection);
    }
    const chosen = tests.filter(entry => !selection || entry.name === selection);
    selectedCases = chosen.map(entry => entry.name);
    const { chromium } = require(process.env.CAPTCHAVATYE_PLAYWRIGHT_MODULE || 'playwright');
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    browserVersion = browser.version();
    for (const entry of chosen) await run(entry);
  } catch (error) {
    runnerError = { message: error.message, stack: error.stack };
    console.error(error);
  } finally {
    await browser?.close().catch(error => { runnerError ||= { message: error.message, stack: error.stack }; });
    await saveResults();
    if (runnerError || results.some(result => !result.passed)) process.exitCode = 1;
  }
})();
