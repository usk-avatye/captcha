const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.CAPTCHAVATYE_PLAYWRIGHT_MODULE || 'playwright');

// Successful authentication/application results always come from the real local API.
// Interception changes only response delivery or the explicitly named failure case.
// This runner uses isolated Chrome contexts and never opens a personal profile.
const origin = 'http://127.0.0.1:5173';
const output = __dirname;
const applicationPath = '/api/demo/test-drives';
const resultHeading = '모의 시승 신청 완료';
const retryLabel = '같은 내용으로 다시 시도';
const tests = [];
const results = [];
const pageErrors = [];
let browser;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
async function bounded(promise, timeout = 7000) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Test gate timed out')), timeout);
    })]);
  } finally { clearTimeout(timer); }
}
async function until(predicate, message, timeout = 6000) {
  const end = Date.now() + timeout;
  while (!(await predicate())) {
    if (Date.now() >= end) throw new Error(message);
    await delay(25);
  }
}
async function deliver(route, operation) {
  try { await operation(); }
  catch (error) {
    if (!/closed|abort|already handled|Invalid InterceptionId|not found/i.test(error.message)) throw error;
  }
}
const test = (name, body, options = {}) => tests.push({ name, body, options });
const calls = (requests, pathname) => requests.filter(item => item.path === pathname);
const eventCalls = (requests, name) => calls(requests, '/api/events').filter(item => !name || item.body.eventName === name);
const applicationCalls = requests => calls(requests, applicationPath);
const locationSelect = page => page.getByLabel('시연 전시장', { exact: true });
const slotSelect = page => page.getByLabel('시연 시간', { exact: true });
const submitButton = page => page.locator('button[type="submit"]').first();

async function phase(page, value) {
  await page.locator('.car-stage[data-phase="' + value + '"]').waitFor({ state: 'attached' });
}
async function points(page, expected) {
  await page.waitForFunction(value => document.querySelector('[data-points]')?.textContent.trim() === value, expected + 'P');
}
async function startCommunity(page) {
  await page.goto(origin);
  await page.locator('[data-points]').waitFor();
  await page.getByLabel('제목', { exact: true }).fill('선택적 시승 신청과 원래 글 등록');
  await page.getByLabel('본문', { exact: true }).fill('시승 신청 여부와 관계없이 작성 중인 글을 등록합니다.');
  await page.getByRole('button', { name: '인증하고 등록하기', exact: true }).click();
  await phase(page, 'challenge');
}
async function drag(page) {
  const piece = await page.locator('[data-piece]').boundingBox();
  const socket = await page.locator('[data-socket]').boundingBox();
  assert.ok(piece && socket, 'Real puzzle geometry must be visible');
  await page.mouse.move(piece.x + piece.width / 2, piece.y + piece.height / 2);
  await page.mouse.down();
  await page.mouse.move(socket.x + socket.width / 2, socket.y + socket.height / 2, { steps: 8 });
  await page.mouse.up();
}
async function completeCommunity(page) {
  await startCommunity(page);
  await drag(page);
  await phase(page, 'completed');
  await points(page, 10);
  await page.locator('a.brand-cta').waitFor({ state: 'visible' });
}
async function closeModal(page) {
  await page.getByRole('button', { name: '인증 화면 닫기', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('dialog').open);
}
async function reopenModal(page) {
  await page.getByRole('button', { name: '인증 결과 이어보기', exact: true }).click();
  await phase(page, 'completed');
}
async function continuePost(page) {
  await page.getByRole('button', { name: '원래 작업 계속하기', exact: true }).click();
  await page.getByRole('heading', { name: '게시글이 등록됐어요', exact: true }).waitFor();
  await points(page, 10);
  assert.equal(await page.locator('.community-post').count(), 1);
}
async function createPassed(context) {
  const started = await context.request.post(origin + '/api/challenges', { data: { creativeId: 'bmw-m3-v1' } });
  assert.equal(started.status(), 201);
  const challenge = await started.json();
  const lamp = challenge.creative.lampRect;
  const verifyRequest = {
    challengeId: challenge.challengeId,
    dropX: lamp.x + lamp.width / 2,
    dropY: lamp.y + lamp.height / 2,
  };
  const verified = await context.request.post(origin + '/api/verify', { data: verifyRequest });
  assert.equal(verified.status(), 200);
  const result = await verified.json();
  assert.equal(result.passed, true);
  return { challengeId: challenge.challengeId, ...result };
}
async function landing(page, clickId) {
  await page.goto(origin + '/demo/test-drive?clickId=' + encodeURIComponent(clickId));
  await page.getByRole('heading', { name: '모의 시승 신청', exact: true }).waitFor();
  await locationSelect(page).waitFor();
}
async function choose(page, location = 'demo-center-b', slot = 'demo-slot-2') {
  await locationSelect(page).selectOption(location);
  await slotSelect(page).selectOption(slot);
}
async function assertLocked(page, location = 'demo-center-b', slot = 'demo-slot-2') {
  assert.equal(await locationSelect(page).isDisabled(), true);
  assert.equal(await slotSelect(page).isDisabled(), true);
  assert.equal(await locationSelect(page).inputValue(), location);
  assert.equal(await slotSelect(page).inputValue(), slot);
}
async function noSuccess(page) {
  assert.equal(await page.getByRole('heading', { name: resultHeading, exact: true }).count(), 0);
}
async function success(page) {
  await page.getByRole('heading', { name: resultHeading, exact: true }).waitFor();
  const code = page.locator('[data-lead-id]').first();
  await code.waitFor();
  const leadId = (await code.innerText()).trim();
  assert.match(leadId, /^lead_\S+$/);
  return leadId;
}
async function screenshot(page, name) {
  await page.screenshot({ path: path.join(output, name), fullPage: true, animations: 'disabled' });
}
async function layout(page) {
  return page.evaluate(() => ({
    viewport: { width: innerWidth, height: innerHeight },
    width: document.documentElement.scrollWidth,
    overflow: document.documentElement.scrollWidth > innerWidth,
    controls: [...document.querySelectorAll('select, button, a.brand-cta')]
      .filter(element => element.getBoundingClientRect().width > 0)
      .map(element => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x, width: rect.width, tag: element.tagName };
      }),
  }));
}
function assertFits(metrics) {
  assert.equal(metrics.overflow, false);
  for (const control of metrics.controls) {
    assert.ok(control.x >= -1 && control.x + control.width <= metrics.viewport.width + 1,
      'Visible controls must remain within the viewport');
  }
}

test('cta_visibility_and_reopen_once', async ({ page, context, requests, gate }) => {
  const saved = gate(), release = gate();
  await page.route('**/api/verify', async route => {
    const response = await route.fetch();
    saved.resolve(await response.json());
    await release.promise;
    await deliver(route, () => route.fulfill({ response }));
  });
  await startCommunity(page);
  assert.equal(await page.locator('a.brand-cta').count(), 0);
  assert.equal(eventCalls(requests).length, 0);
  await drag(page);
  const verified = await bounded(saved.promise);
  assert.equal(verified.passed, true);
  await phase(page, 'verifying');
  await points(page, 0);
  assert.equal(await page.locator('a.brand-cta').count(), 0);
  assert.equal(eventCalls(requests).length, 0);
  release.resolve();
  await phase(page, 'revealing');
  assert.equal(await page.locator('a.brand-cta').count(), 0);
  assert.equal(eventCalls(requests).length, 0);
  await phase(page, 'completed');
  await points(page, 10);
  const cta = page.locator('a.brand-cta');
  await cta.waitFor({ state: 'visible' });
  assert.equal(await cta.getAttribute('target'), '_blank');
  const rel = (await cta.getAttribute('rel')).split(/\s+/);
  assert.ok(rel.includes('noopener') && rel.includes('noreferrer'));
  const href = new URL(await cta.getAttribute('href'), origin);
  assert.equal(href.pathname, '/demo/test-drive');
  assert.equal(href.searchParams.get('clickId'), verified.clickId);
  await page.getByText('새 탭에서 열립니다', { exact: true }).waitFor();
  await until(() => eventCalls(requests, 'cta_shown').length === 1, 'Completed CTA must emit one exposure');
  assert.equal(eventCalls(requests, 'cta_shown')[0].body.clickId, verified.clickId);
  await screenshot(page, 'desktop-cta.png');
  await closeModal(page);
  await reopenModal(page);
  await delay(200);
  assert.equal(eventCalls(requests, 'cta_shown').length, 1);
  assert.equal(calls(requests, '/api/verify').length, 1);
  await continuePost(page);
  assert.equal(context.pages().length, 1);
  assert.equal(eventCalls(requests, 'cta_clicked').length, 0);
  assert.equal(applicationCalls(requests).length, 0);
  return { clickId: verified.clickId, exposure: eventCalls(requests, 'cta_shown')[0].body };
});

test('middle_and_keyboard_cta_activations_are_recorded', async ({ page, context, requests }) => {
  await completeCommunity(page);
  const cta = page.locator('a.brand-cta');
  const [middleChild] = await Promise.all([
    context.waitForEvent('page', { timeout: 2500 }),
    cta.click({ button: 'middle' }),
  ]);
  await middleChild.waitForURL('**/demo/test-drive?clickId=*');
  await locationSelect(middleChild).waitFor();
  assert.equal(await middleChild.evaluate(() => window.opener), null);
  const clickId = new URL(middleChild.url()).searchParams.get('clickId');
  await until(() => eventCalls(requests, 'cta_clicked').length === 1,
    'A native middle-button CTA activation must record one click', 2500);
  assert.equal(eventCalls(requests, 'cta_clicked')[0].body.clickId, clickId);

  const [keyboardChild] = await Promise.all([
    context.waitForEvent('page', { timeout: 2500 }),
    cta.press('Enter'),
  ]);
  await keyboardChild.waitForURL('**/demo/test-drive?clickId=*');
  await locationSelect(keyboardChild).waitFor();
  assert.equal(await keyboardChild.evaluate(() => window.opener), null);
  await until(() => eventCalls(requests, 'cta_clicked').length === 2, 'Keyboard activation must record a fresh click');
  const clicks = eventCalls(requests, 'cta_clicked').map(item => item.body);
  assert.notEqual(clicks[0].eventId, clicks[1].eventId);
  assert.equal(clicks[1].clickId, clickId);
  await cta.dispatchEvent('auxclick', { button: 2 });
  await delay(100);
  assert.equal(eventCalls(requests, 'cta_clicked').length, 2, 'Right-button auxiliary events must not record a click');
  assert.equal(eventCalls(requests, 'cta_shown').length, 1);
  await middleChild.close();
  await keyboardChild.close();
  await continuePost(page);
  return { clickId, clicks };
});

test('native_popup_and_independent_application', async ({ page, context, requests, gate }) => {
  const clicked = gate(), release = gate();
  let clickResponsesReleased = false;
  await context.route('**/api/events', async route => {
    if (route.request().postDataJSON().eventName !== 'cta_clicked') return route.continue();
    clicked.resolve();
    await release.promise;
    clickResponsesReleased = true;
    await deliver(route, () => route.continue());
  });
  await completeCommunity(page);
  const [child] = await Promise.all([
    context.waitForEvent('page', { timeout: 2500 }),
    page.locator('a.brand-cta').click(),
  ]);
  await bounded(clicked.promise, 2500);
  await child.waitForURL('**/demo/test-drive?clickId=*');
  await locationSelect(child).waitFor();
  assert.equal(clickResponsesReleased, false, 'Native new tab must not wait for click logging');
  assert.equal(await child.evaluate(() => window.opener), null);
  const clickId = new URL(child.url()).searchParams.get('clickId');
  await until(() => eventCalls(requests, 'landing_viewed').length === 1, 'One landing event expected under StrictMode');
  await delay(150);
  assert.equal(eventCalls(requests, 'landing_viewed').length, 1);
  assert.equal(eventCalls(requests, 'landing_viewed')[0].body.clickId, clickId);
  await screenshot(child, 'desktop-test-drive.png');

  // A second real activation has a fresh event ID and opens another independent tab.
  const [secondChild] = await Promise.all([
    context.waitForEvent('page', { timeout: 2500 }),
    page.locator('a.brand-cta').click(),
  ]);
  await secondChild.waitForURL('**/demo/test-drive?clickId=*');
  await locationSelect(secondChild).waitFor();
  assert.equal(await secondChild.evaluate(() => window.opener), null);
  await until(() => eventCalls(requests, 'cta_clicked').length === 2, 'Two distinct click actions must be recorded');
  const clicks = eventCalls(requests, 'cta_clicked').map(item => item.body);
  assert.notEqual(clicks[0].eventId, clicks[1].eventId);
  assert.equal(clicks[0].clickId, clickId);
  assert.equal(clicks[1].clickId, clickId);
  await secondChild.close();
  await continuePost(page);
  await page.close();
  await choose(child);
  await submitButton(child).click();
  const leadId = await success(child);
  assert.equal(clickResponsesReleased, false, 'Application does not require received click events');
  await screenshot(child, 'desktop-application-completed.png');
  const applications = applicationCalls(requests);
  assert.equal(applications.length, 1);
  assert.deepEqual(applications[0].body, { clickId, locationId: 'demo-center-b', slotId: 'demo-slot-2' });
  assert.equal(applications[0].status, 201);
  return { clickId, leadId, clicks, originalTabClosedBeforeApplication: true };
});

test('lost_application_response_reuses_snapshot', async ({ page, context, requests }) => {
  const verified = await createPassed(context);
  const attempts = [];
  await page.route('**/api/demo/test-drives', async route => {
    const response = await route.fetch();
    attempts.push({ body: route.request().postDataJSON(), status: response.status(), result: await response.json() });
    if (attempts.length === 1) await route.abort('failed');
    else await route.fulfill({ response });
  });
  await landing(page, verified.clickId);
  await choose(page);
  await submitButton(page).click();
  await page.getByRole('button', { name: retryLabel, exact: true }).waitFor();
  await assertLocked(page);
  await noSuccess(page);
  assert.equal(attempts[0].status, 201);
  await screenshot(page, 'uncertain-application.png');
  await page.getByRole('button', { name: retryLabel, exact: true }).click();
  const leadId = await success(page);
  assert.equal(attempts.length, 2);
  assert.deepEqual(attempts[1].body, attempts[0].body);
  assert.equal(attempts[1].status, 200);
  assert.deepEqual(attempts[1].result, attempts[0].result);
  assert.equal(leadId, attempts[0].result.leadId);
  assert.equal(applicationCalls(requests).length, 2);
  return { attempts, leadId };
});

for (const mode of ['non_json_503', 'malformed_success']) {
  test(mode + '_keeps_application_snapshot', async ({ page, context }) => {
    const verified = await createPassed(context);
    const attempts = [];
    await page.route('**/api/demo/test-drives', async route => {
      const body = route.request().postDataJSON();
      if (attempts.length === 0 && mode === 'non_json_503') {
        attempts.push({ body, status: 503 });
        return route.fulfill({ status: 503, contentType: 'text/html', body: '<h1>Temporary unavailability</h1>' });
      }
      const response = await route.fetch();
      const result = await response.json();
      attempts.push({ body, status: response.status(), result });
      if (attempts.length === 1) {
        return route.fulfill({ status: response.status(), contentType: 'application/json', body: JSON.stringify({ ...result, isDemo: false }) });
      }
      return route.fulfill({ response });
    });
    await landing(page, verified.clickId);
    await choose(page);
    await submitButton(page).click();
    await page.getByRole('button', { name: retryLabel, exact: true }).waitFor();
    await assertLocked(page);
    await noSuccess(page);
    await page.getByRole('button', { name: retryLabel, exact: true }).click();
    const leadId = await success(page);
    assert.equal(attempts.length, 2);
    assert.deepEqual(attempts[1].body, attempts[0].body);
    assert.equal(attempts[1].status, mode === 'non_json_503' ? 201 : 200);
    assert.equal(leadId, attempts[1].result.leadId);
    if (mode === 'malformed_success') assert.equal(leadId, attempts[0].result.leadId);
    return { attempts, leadId };
  });
}

test('validation_422_allows_new_choices', async ({ page, context }) => {
  const verified = await createPassed(context);
  const attempts = [];
  await page.route('**/api/demo/test-drives', async route => {
    const body = route.request().postDataJSON();
    if (attempts.length === 0) {
      attempts.push({ body, status: 422 });
      return route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ detail: [
        { type: 'literal_error', loc: ['body', 'slotId'], msg: 'Invalid demo choice' },
      ] }) });
    }
    const response = await route.fetch();
    attempts.push({ body, status: response.status(), result: await response.json() });
    return route.fulfill({ response });
  });
  await landing(page, verified.clickId);
  await choose(page, 'demo-center-a', 'demo-slot-1');
  await submitButton(page).click();
  await page.getByRole('alert').waitFor();
  assert.equal(await locationSelect(page).isDisabled(), false);
  assert.equal(await slotSelect(page).isDisabled(), false);
  await noSuccess(page);
  await choose(page);
  await submitButton(page).click();
  const leadId = await success(page);
  assert.equal(attempts.length, 2);
  assert.equal(attempts[1].status, 201);
  assert.deepEqual(attempts[0].body, { clickId: verified.clickId, locationId: 'demo-center-a', slotId: 'demo-slot-1' });
  assert.deepEqual(attempts[1].body, { clickId: verified.clickId, locationId: 'demo-center-b', slotId: 'demo-slot-2' });
  return { attempts, leadId };
});

test('actual_conflict_does_not_show_success', async ({ page, context, requests }) => {
  const verified = await createPassed(context);
  const first = await context.request.post(origin + applicationPath, { data: {
    clickId: verified.clickId, locationId: 'demo-center-a', slotId: 'demo-slot-1',
  } });
  assert.equal(first.status(), 201);
  const original = await first.json();
  await landing(page, verified.clickId);
  await choose(page);
  await submitButton(page).click();
  await until(() => applicationCalls(requests)[0]?.status === 409, 'Real server conflict must be received');
  await page.getByRole('alert').waitFor();
  await page.getByRole('link', { name: '광고 데모로 돌아가기', exact: true }).waitFor();
  await noSuccess(page);
  assert.equal(await page.getByRole('button', { name: retryLabel, exact: true }).count(), 0);
  assert.equal(applicationCalls(requests).length, 1);
  assert.equal(applicationCalls(requests)[0].status, 409);
  const replay = await context.request.post(origin + applicationPath, { data: {
    clickId: verified.clickId, locationId: 'demo-center-a', slotId: 'demo-slot-1',
  } });
  assert.equal(replay.status(), 200);
  assert.deepEqual(await replay.json(), original);
  return { original, conflictRequest: applicationCalls(requests)[0].body };
});

test('missing_click_id_blocks_network_actions', async ({ page, requests }) => {
  for (const suffix of ['', '?clickId=', '?clickId=%20%20']) {
    await page.goto(origin + '/demo/test-drive' + suffix);
    await page.getByRole('link', { name: '광고 데모로 돌아가기', exact: true }).waitFor();
    await noSuccess(page);
    const submit = submitButton(page);
    if (await submit.count()) assert.equal(await submit.isDisabled(), true);
  }
  await delay(250);
  assert.equal(eventCalls(requests).length, 0);
  assert.equal(applicationCalls(requests).length, 0);
  return { urls: ['missing', 'empty', 'whitespace'] };
});

test('unknown_click_404_blocks_application', async ({ page, requests }) => {
  await landing(page, 'unknown-' + Date.now());
  await choose(page);
  await submitButton(page).click();
  await until(() => applicationCalls(requests)[0]?.status === 404, 'Real missing-link response must be received');
  await page.getByRole('alert').waitFor();
  await page.getByRole('link', { name: '광고 데모로 돌아가기', exact: true }).waitFor();
  await noSuccess(page);
  assert.equal(await page.getByRole('button', { name: retryLabel, exact: true }).count(), 0);
  assert.equal(applicationCalls(requests).length, 1);
  assert.equal(applicationCalls(requests)[0].status, 404);
  await delay(2200);
  assert.equal(eventCalls(requests, 'landing_viewed').length, 1, '404 landing log must not retry');
});

test('event_5xx_retries_survive_modal_close', async ({ page, requests }) => {
  await page.route('**/api/events', route => route.fulfill({
    status: 503, contentType: 'text/html', body: '<h1>Collector temporarily unavailable</h1>',
  }));
  await completeCommunity(page);
  await continuePost(page);
  await until(() => eventCalls(requests, 'cta_shown').length === 3, 'Two automatic retries must finish', 7000);
  await delay(1700);
  const attempts = eventCalls(requests, 'cta_shown');
  assert.equal(attempts.length, 3);
  assert.deepEqual(attempts.map(item => item.body), Array(3).fill(attempts[0].body));
  assert.ok(attempts[1].at - attempts[0].at >= 400, 'First retry waits approximately 500 ms');
  assert.ok(attempts[2].at - attempts[1].at >= 1400, 'Second retry waits approximately 1500 ms');
  await points(page, 10);
  assert.equal(await page.locator('.community-post').count(), 1);
  assert.equal(applicationCalls(requests).length, 0);
  return { attempts: attempts.map(({ body, at, status }) => ({ body, at, status })) };
});

test('event_4xx_does_not_retry_or_repeat_on_reopen', async ({ page, requests }) => {
  await page.route('**/api/events', route => route.fulfill({
    status: 422, contentType: 'text/html', body: '<h1>Invalid event</h1>',
  }));
  await completeCommunity(page);
  await closeModal(page);
  await reopenModal(page);
  await continuePost(page);
  await delay(2400);
  assert.equal(eventCalls(requests, 'cta_shown').length, 1);
  await points(page, 10);
  assert.equal(await page.locator('.community-post').count(), 1);
});

test('landing_reload_creates_new_event_and_reuses_lead', async ({ page, context, requests }) => {
  const verified = await createPassed(context);
  await landing(page, verified.clickId);
  await choose(page);
  await submitButton(page).click();
  const firstLeadId = await success(page);
  await until(() => eventCalls(requests, 'landing_viewed').length === 1, 'First page load event');
  await page.reload();
  await locationSelect(page).waitFor();
  assert.equal(await locationSelect(page).inputValue(), '');
  assert.equal(await slotSelect(page).inputValue(), '');
  await until(() => eventCalls(requests, 'landing_viewed').length === 2, 'Reload must create one new landing event');
  await delay(150);
  const landings = eventCalls(requests, 'landing_viewed').map(item => item.body);
  assert.equal(landings.length, 2);
  assert.notEqual(landings[0].eventId, landings[1].eventId);
  assert.equal(landings[0].clickId, verified.clickId);
  assert.equal(landings[1].clickId, verified.clickId);
  await choose(page);
  await submitButton(page).click();
  const replayedLeadId = await success(page);
  assert.equal(replayedLeadId, firstLeadId);
  assert.deepEqual(applicationCalls(requests).map(item => item.status), [201, 200]);
  return { leadId: firstLeadId, landings };
});

test('pending_duplicate_submit_sends_one_application', async ({ page, context, requests, gate }) => {
  const verified = await createPassed(context);
  const stored = gate(), release = gate();
  await page.route('**/api/demo/test-drives', async route => {
    const response = await route.fetch();
    stored.resolve(await response.json());
    await release.promise;
    await deliver(route, () => route.fulfill({ response }));
  });
  await landing(page, verified.clickId);
  await choose(page);
  await page.locator('form').evaluate(form => {
    form.requestSubmit();
    form.requestSubmit();
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  const saved = await bounded(stored.promise);
  await assertLocked(page);
  assert.equal(await submitButton(page).isDisabled(), true);
  await noSuccess(page);
  await delay(150);
  assert.equal(applicationCalls(requests).length, 1);
  release.resolve();
  const leadId = await success(page);
  assert.equal(leadId, saved.leadId);
  assert.equal(applicationCalls(requests).length, 1);
  return { leadId, requests: 1 };
});

test('mobile_landing_and_completion_fit', async ({ page, context }) => {
  const verified = await createPassed(context);
  await landing(page, verified.clickId);
  const before = await layout(page); assertFits(before);
  await choose(page);
  await screenshot(page, 'mobile-test-drive.png');
  await submitButton(page).click();
  const leadId = await success(page);
  const after = await layout(page); assertFits(after);
  return { leadId, before, after };
}, { viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });

test('opaque_click_id_is_not_trimmed', async ({ page, context, requests }) => {
  const verified = await createPassed(context);
  const opaque = ' ' + verified.clickId + ' ';
  await landing(page, opaque);
  await until(() => eventCalls(requests, 'landing_viewed').length === 1, 'Landing event must be generated');
  assert.equal(eventCalls(requests, 'landing_viewed')[0].body.clickId, opaque);
  await choose(page);
  await submitButton(page).click();
  await until(() => applicationCalls(requests)[0]?.status === 404, 'Opaque unknown ID must receive 404');
  assert.equal(applicationCalls(requests)[0].body.clickId, opaque);
  await page.getByRole('alert').waitFor();
  await noSuccess(page);
  return { preservedOpaqueId: true, applicationStatus: 404 };
});

const fields = {
  '/api/challenges': ['creativeId'],
  '/api/verify': ['challengeId', 'dropX', 'dropY'],
  '/api/events': ['clickId', 'eventId', 'eventName', 'occurredAt'],
  '/api/demo/test-drives': ['clickId', 'locationId', 'slotId'],
};
async function run({ name, body, options }) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR', ...options });
  const requests = [];
  const requestEntries = new WeakMap();
  const responseJobs = [];
  const releases = [];
  const errorsBefore = pageErrors.length;
  let nextPageId = 1;
  const pageIds = new WeakMap();
  context.on('page', child => {
    pageIds.set(child, nextPageId++);
    child.setDefaultTimeout(6000);
    child.on('pageerror', error => pageErrors.push({ test: name, page: pageIds.get(child), message: error.message }));
  });
  context.on('request', request => {
    const pathname = new URL(request.url()).pathname;
    if (!pathname.startsWith('/api/')) return;
    let pageId;
    try { pageId = pageIds.get(request.frame().page()); } catch { pageId = null; }
    const entry = { path: pathname, method: request.method(), body: request.postDataJSON(), page: pageId, at: Date.now() };
    requests.push(entry);
    requestEntries.set(request, entry);
  });
  context.on('response', response => {
    const entry = requestEntries.get(response.request());
    if (!entry) return;
    entry.status = response.status();
    responseJobs.push(response.json().then(value => { entry.response = value; }).catch(() => {}));
  });
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const page = await context.newPage();
  const gate = () => { const value = deferred(); releases.push(value.resolve); return value; };
  try {
    const detail = await body({ page, context, requests, gate });
    assert.equal(pageErrors.length, errorsBefore, 'No unhandled page errors');
    for (const request of requests) {
      assert.ok(fields[request.path], 'Only the four planned business APIs are used');
      assert.equal(request.method, 'POST');
      assert.deepEqual(Object.keys(request.body).sort(), fields[request.path]);
      if (request.path === '/api/events') {
        assert.ok(['cta_shown', 'cta_clicked', 'landing_viewed'].includes(request.body.eventName));
        assert.equal(typeof request.body.eventId, 'string');
        assert.ok(request.body.eventId.length > 0);
        assert.equal(typeof request.body.occurredAt, 'string');
        assert.ok(Number.isFinite(Date.parse(request.body.occurredAt)));
      }
    }
    results.push({ name, status: 'passed', ...detail, requests });
    console.log(JSON.stringify({ name, status: 'passed' }));
  } catch (error) {
    const lastPage = context.pages().filter(candidate => !candidate.isClosed()).at(-1);
    await lastPage?.screenshot({ path: path.join(output, name + '-failed.png'), fullPage: true }).catch(() => {});
    results.push({ name, status: 'failed', message: error.message, stack: error.stack, requests });
    throw error;
  } finally {
    releases.forEach(release => release());
    await Promise.race([Promise.allSettled(responseJobs), delay(1000)]);
    await context.close();
  }
}

(async () => {
  const index = process.argv.indexOf('--case');
  const filter = index >= 0 ? process.argv[index + 1] : process.env.CAPTCHAVATYE_CASE;
  const selected = filter ? tests.filter(item => filter.split(',').includes(item.name)) : tests;
  if (process.argv.includes('--list')) {
    console.log(tests.map(item => item.name).join('\n'));
    return;
  }
  assert.ok(selected.length > 0, 'The selected test must exist');
  await fs.mkdir(output, { recursive: true });
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  for (const item of selected) await run(item);
  assert.equal(pageErrors.length, 0);
})().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}).finally(async () => {
  if (!browser) return;
  const version = browser.version();
  await browser.close();
  await fs.writeFile(path.join(output, 'conversion-results.json'), JSON.stringify({
    recordedAt: new Date().toISOString(), browser: version, origin,
    passed: results.filter(item => item.status === 'passed').length,
    failed: results.filter(item => item.status === 'failed').length,
    results, pageErrors,
  }, null, 2) + '\n');
});
