const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.CAPTCHAVATYE_PLAYWRIGHT_MODULE || 'playwright');

// Actual stage 3 page/SDK integration against the running local servers.
// All successful verify responses come from FastAPI; only their delivery is delayed/lost.
const origin = 'http://127.0.0.1:5173';
const output = __dirname;
const results = [];
const errors = [];
let browser;

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function bounded(promise) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Test gate timed out')), 8000);
  })]).finally(() => clearTimeout(timer));
}
async function phase(page, value) {
  await page.locator('.car-stage[data-phase="' + value + '"]').waitFor({ state: 'attached', timeout: 6000 });
}
async function points(page, value) {
  await page.waitForFunction(expected => document.querySelector('[data-points]')?.textContent.trim() === expected, value + 'P');
  assert.equal((await page.locator('[data-points]').textContent()).trim(), value + 'P');
}
async function draft(page, title = '오늘의 드라이브 기록', body = '리어램프를 맞추고 원래 글쓰기를 이어갑니다.\n둘째 줄도 그대로 보관합니다.') {
  await page.getByLabel('제목', { exact: true }).fill(title);
  await page.getByLabel('본문', { exact: true }).fill(body);
  return { title, body };
}
async function open(page) {
  await page.getByRole('button', { name: /^(인증하고 등록하기|인증 결과 이어보기)$/ }).click();
}
async function visit(page) {
  await page.goto(origin);
  await page.locator('[data-points]').waitFor();
  assert.equal(await page.locator('dialog').evaluate(d => d.open), false);
}
async function ready(page) {
  await visit(page);
  const value = await draft(page);
  await open(page);
  await phase(page, 'challenge');
  return value;
}
async function close(page) {
  await page.getByRole('button', { name: '인증 화면 닫기', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('dialog').open);
}
async function continuePost(page) {
  await page.getByRole('button', { name: '원래 작업 계속하기', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('dialog').open);
}
async function drag(page) {
  const piece = await page.locator('[data-piece]').boundingBox();
  const socket = await page.locator('[data-socket]').boundingBox();
  assert.ok(piece && socket, 'A draggable piece and target must be visible');
  await page.mouse.move(piece.x + piece.width / 2, piece.y + piece.height / 2);
  await page.mouse.down();
  await page.mouse.move(socket.x + socket.width / 2, socket.y + socket.height / 2, { steps: 8 });
  await page.mouse.up();
}
async function post(page, expected, index = 0) {
  const item = page.locator('.community-post').nth(index);
  await item.waitFor();
  assert.equal(await item.locator('h3').textContent(), expected.title);
  assert.equal(await item.locator('.post-body').textContent(), expected.body);
}
async function postCount(page, count) {
  await page.waitForFunction(value => document.querySelectorAll('.community-post').length === value, count);
  assert.equal(await page.locator('.community-post').count(), count);
}
async function metrics(page) {
  return page.evaluate(() => {
    const rect = element => {
      const r = element.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    return {
      dialog: rect(document.querySelector('dialog')),
      stage: rect(document.querySelector('.car-stage')),
      viewport: { width: innerWidth, height: innerHeight },
      overflow: document.documentElement.scrollWidth > innerWidth,
      source: document.querySelector('.vehicle-image')?.currentSrc,
      controls: [...document.querySelectorAll('dialog button')].map(rect),
    };
  });
}
function frame(value) {
  assert.equal(value.overflow, false);
  assert.ok(Math.abs(value.stage.width / value.stage.height - 16 / 9) < .001);
  assert.ok(value.dialog.x >= 0 && value.dialog.x + value.dialog.width <= value.viewport.width + 1);
  for (const control of value.controls) {
    assert.ok(control.x >= value.dialog.x - 1 && control.x + control.width <= value.dialog.x + value.dialog.width + 1);
  }
}
async function recordPhases(page) {
  await page.evaluate(() => {
    const stage = document.querySelector('.car-stage');
    const read = () => ({ phase: stage.dataset.phase, points: document.querySelector('[data-points]').textContent.trim() });
    window.__recordedPhases = [read()];
    new MutationObserver(() => {
      if (window.__recordedPhases.at(-1).phase !== stage.dataset.phase) window.__recordedPhases.push(read());
    }).observe(stage, { attributes: true, attributeFilter: ['data-phase'] });
  });
}
async function sdkState(page) {
  return JSON.parse(await page.locator('pre#state').textContent());
}
async function fulfill(route, response) {
  try {
    await route.fulfill({ response });
  } catch (error) {
    if (!/closed|abort|already handled/i.test(error.message)) throw error;
  }
}
const starts = requests => requests.filter(request => request.path === '/api/challenges');
const verifies = requests => requests.filter(request => request.path === '/api/verify');
const events = requests => requests.filter(request => request.path === '/api/events');

async function run(name, body, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR', ...options });
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  const requests = [];
  const releases = [];
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  page.on('pageerror', error => errors.push({ name, message: error.message }));
  page.on('request', request => {
    if (request.url().includes('/api/')) requests.push({ path: new URL(request.url()).pathname, body: request.postDataJSON() });
  });
  const gate = () => { const value = deferred(); releases.push(value.resolve); return value; };
  try {
    const detail = await body({ page, context, requests, gate });
    results.push({ name, status: 'passed', ...detail });
    console.log(JSON.stringify({ name, status: 'passed' }));
  } catch (error) {
    await page.screenshot({ path: path.join(output, name + '-failed.png'), fullPage: true }).catch(() => {});
    results.push({ name, status: 'failed', message: error.message, stack: error.stack });
    throw error;
  } finally {
    releases.forEach(release => release());
    await context.close();
  }
}

(async () => {
  await fs.mkdir(output, { recursive: true });
  browser = await chromium.launch({ headless: true, channel: 'chrome' });

  await run('desktop_flow_without_cta', async ({ page, context, requests }) => {
    await visit(page);
    await points(page, 0);
    assert.equal(starts(requests).length, 0, 'First mount must not start a closed SDK');
    const value = await draft(page);
    await page.screenshot({ path: path.join(output, 'desktop-community.png'), fullPage: true });
    await open(page);
    await phase(page, 'challenge');
    const before = await metrics(page); frame(before);
    await drag(page);
    await phase(page, 'completed');
    await points(page, 10);
    await postCount(page, 0);
    assert.equal(await page.locator('.brand-cta').isDisabled(), true);
    assert.equal(events(requests).length, 0);
    assert.equal(context.pages().length, 1);
    const after = await metrics(page); frame(after);
    assert.equal(after.source, before.source);
    assert.ok(Math.abs(after.dialog.height - before.dialog.height) < 1);
    await page.screenshot({ path: path.join(output, 'desktop-completed.png'), animations: 'disabled' });
    // Consecutive activations use the actual public continue control.
    await page.getByRole('button', { name: '원래 작업 계속하기', exact: true }).evaluate(button => { button.click(); button.click(); });
    await page.waitForFunction(() => !document.querySelector('dialog').open);
    await postCount(page, 1);
    await post(page, value);
    await points(page, 10);
    assert.equal(verifies(requests).length, 1);
    await page.screenshot({ path: path.join(output, 'desktop-post.png'), fullPage: true });
    return { before, after, verify: verifies(requests)[0].body };
  });

  await run('server_and_animation_reward_gate', async ({ page, requests, gate }) => {
    const saved = gate(), release = gate();
    await page.route('**/api/verify', async route => {
      const response = await route.fetch();
      saved.resolve(await response.json());
      await release.promise;
      await fulfill(route, response);
    });
    await ready(page);
    await recordPhases(page);
    await drag(page);
    assert.equal((await bounded(saved.promise)).passed, true);
    await phase(page, 'verifying');
    await points(page, 0);
    await postCount(page, 0);
    assert.equal(await page.getByRole('button', { name: '원래 작업 계속하기', exact: true }).count(), 0);
    release.resolve();
    await phase(page, 'revealing');
    await points(page, 0);
    await phase(page, 'completed');
    await points(page, 10);
    const phases = await page.evaluate(() => window.__recordedPhases);
    assert.deepEqual(phases.map(item => item.phase), ['challenge', 'verifying', 'snapping', 'revealing', 'completed']);
    for (const item of phases.filter(item => item.phase !== 'completed')) assert.equal(item.points, '0P');
    assert.equal(verifies(requests).length, 1);
    return { phases };
  });

  await run('close_challenge_keeps_draft_and_id', async ({ page, requests }) => {
    const value = await ready(page);
    const startCount = starts(requests).length;
    await close(page);
    assert.equal(await page.getByLabel('제목', { exact: true }).inputValue(), value.title);
    assert.equal(await page.getByLabel('본문', { exact: true }).inputValue(), value.body);
    await points(page, 0);
    await postCount(page, 0);
    await open(page);
    await phase(page, 'challenge');
    assert.equal(starts(requests).length, startCount);
    await drag(page);
    await phase(page, 'completed');
    await points(page, 10);
    await continuePost(page);
    await postCount(page, 1);
    await post(page, value);
  });

  await run('close_verifying_preserves_snapshot', async ({ page, requests, gate }) => {
    const saved = gate(), release = gate();
    const attempts = [];
    await page.route('**/api/verify', async route => {
      const response = await route.fetch();
      attempts.push({ request: route.request().postDataJSON(), result: await response.json() });
      if (attempts.length === 1) { saved.resolve(); await release.promise; }
      await fulfill(route, response);
    });
    const value = await ready(page);
    const startCount = starts(requests).length;
    await drag(page);
    await bounded(saved.promise);
    await phase(page, 'verifying');
    await close(page);
    release.resolve();
    await page.waitForTimeout(150);
    await points(page, 0);
    await postCount(page, 0);
    assert.equal(await page.locator('.car-stage').getAttribute('data-phase'), 'verifying');
    await open(page);
    await phase(page, 'completed');
    await points(page, 10);
    assert.equal(attempts.length, 2);
    assert.deepEqual(attempts[1], attempts[0]);
    assert.equal(starts(requests).length, startCount);
    await continuePost(page);
    await postCount(page, 1);
    await post(page, value);
    return { attempts };
  });

  for (const target of ['snapping', 'revealing']) {
    await run('close_' + target + '_defers_reward', async ({ page, requests }) => {
      await ready(page);
      const closed = page.evaluate(target => new Promise(resolve => {
        const stage = document.querySelector('.car-stage');
        const observer = new MutationObserver(() => {
          if (stage.dataset.phase === target) {
            observer.disconnect();
            document.querySelector('[aria-label="인증 화면 닫기"]').click();
            resolve(target);
          }
        });
        observer.observe(stage, { attributes: true, attributeFilter: ['data-phase'] });
      }), target);
      await drag(page);
      assert.equal(await bounded(closed), target);
      await page.waitForTimeout(1100);
      assert.equal(await page.locator('dialog').evaluate(dialog => dialog.open), false);
      assert.equal(await page.locator('.car-stage').getAttribute('data-phase'), 'snapping');
      await points(page, 0);
      await postCount(page, 0);
      const requestCount = requests.length;
      await open(page);
      await phase(page, 'completed');
      await points(page, 10);
      assert.equal(requests.length, requestCount, 'Stored success must replay without another API request');
      await close(page);
      await open(page);
      await phase(page, 'completed');
      await points(page, 10);
      assert.equal(verifies(requests).length, 1);
    });
  }

  await run('completed_close_edit_reopen_uses_current_draft', async ({ page, requests }) => {
    await ready(page);
    await drag(page);
    await phase(page, 'completed');
    await points(page, 10);
    await close(page);
    await postCount(page, 0);
    await points(page, 10);
    const edited = await draft(page, '인증 뒤에 수정한 제목', '수정한 본문을 등록합니다.\n두 번째 줄과 <b>문자</b>도 보존합니다.');
    const requestCount = requests.length;
    await open(page);
    await phase(page, 'completed');
    await points(page, 10);
    assert.equal(requests.length, requestCount);
    await continuePost(page);
    await postCount(page, 1);
    await post(page, edited);
    assert.equal(await page.locator('.post-body b').count(), 0, 'Draft must render as text');
    await points(page, 10);
  });

  await run('lost_response_retry_rewards_once', async ({ page, requests }) => {
    const attempts = [];
    await page.route('**/api/verify', async route => {
      const response = await route.fetch();
      attempts.push({ request: route.request().postDataJSON(), result: await response.json() });
      if (attempts.length === 1) await route.abort('failed');
      else await fulfill(route, response);
    });
    await ready(page);
    await drag(page);
    await phase(page, 'error');
    await points(page, 0);
    await postCount(page, 0);
    assert.equal(attempts[0].result.passed, true);
    await close(page);
    await open(page);
    await phase(page, 'error');
    assert.equal(attempts.length, 1);
    await page.getByRole('button', { name: '다시 시도', exact: true }).click();
    await phase(page, 'completed');
    await points(page, 10);
    assert.deepEqual(attempts[1], attempts[0]);
    await continuePost(page);
    await postCount(page, 1);
    await points(page, 10);
    assert.equal(events(requests).length, 0);
    return { attempts };
  });

  await run('new_post_starts_new_attempt_and_preserves_rewards', async ({ page, requests }) => {
    const first = await ready(page);
    const response1 = page.waitForResponse(response => response.url().endsWith('/api/verify'));
    await drag(page);
    const result1 = await (await response1).json();
    await phase(page, 'completed');
    await points(page, 10);
    await continuePost(page);
    await postCount(page, 1);
    const firstStartCount = starts(requests).length;
    await page.getByRole('button', { name: '새 글 쓰기', exact: true }).click();
    assert.equal(await page.getByLabel('제목', { exact: true }).inputValue(), '');
    assert.equal(await page.getByLabel('본문', { exact: true }).inputValue(), '');
    assert.equal(await page.locator('dialog').evaluate(dialog => dialog.open), false);
    assert.equal(starts(requests).length, firstStartCount);
    await points(page, 10);
    await postCount(page, 1);
    const second = await draft(page, '두 번째 글', '다른 인증을 완료한 두 번째 작성 내용입니다.');
    await open(page);
    await phase(page, 'challenge');
    await points(page, 10);
    const response2 = page.waitForResponse(response => response.url().endsWith('/api/verify'));
    await drag(page);
    const result2 = await (await response2).json();
    await phase(page, 'completed');
    await points(page, 20);
    await continuePost(page);
    await postCount(page, 2);
    const actual = await page.locator('.community-post').evaluateAll(items => items.map(item => ({
      title: item.querySelector('h3').textContent, body: item.querySelector('.post-body').textContent,
    })));
    assert.deepEqual(actual.sort((a, b) => a.title.localeCompare(b.title)), [first, second].sort((a, b) => a.title.localeCompare(b.title)));
    assert.notEqual(verifies(requests)[0].body.challengeId, verifies(requests)[1].body.challengeId);
    assert.notEqual(result1.completionId, result2.completionId);
    assert.notEqual(result1.clickId, result2.clickId);
    assert.ok(starts(requests).length > firstStartCount);
    return { challengeIds: verifies(requests).map(request => request.body.challengeId), completions: [result1, result2] };
  });

  await run('mobile_reduced_motion_completes_original_work', async ({ page }) => {
    await visit(page);
    const value = await draft(page, '작은 화면의 기록', '작은 화면과 동작 줄이기 설정에서도 같은 글을 등록합니다.');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: path.join(output, 'mobile-community.png'), fullPage: true });
    await open(page);
    await phase(page, 'challenge');
    const before = await metrics(page); frame(before);
    await drag(page);
    await phase(page, 'completed');
    await points(page, 10);
    const after = await metrics(page); frame(after);
    assert.ok(Math.abs(before.dialog.height - after.dialog.height) < 1);
    assert.equal(await page.locator('[data-scene]').evaluate(element => getComputedStyle(element).transform), 'matrix(1, 0, 0, 1, 0, 0)');
    await page.screenshot({ path: path.join(output, 'mobile-completed.png'), animations: 'disabled' });
    await continuePost(page);
    await postCount(page, 1);
    await post(page, value);
    return { before, after };
  }, { viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });

  await run('blank_draft_does_not_create_challenge', async ({ page, requests }) => {
    await visit(page);
    await draft(page, '   ', '본문은 있지만 제목이 비었습니다.');
    await open(page);
    await page.waitForTimeout(100);
    assert.equal(await page.locator('dialog').evaluate(dialog => dialog.open), false);
    await draft(page, '제목만 있는 글', '   \n   ');
    await open(page);
    await page.waitForTimeout(100);
    assert.equal(await page.locator('dialog').evaluate(dialog => dialog.open), false);
    assert.equal(starts(requests).length, 0);
    await points(page, 0);
    await postCount(page, 0);
  });

  await run('public_sdk_uses_latest_callbacks_without_restarting', async ({ page, requests, gate }) => {
    const saved = gate(), release = gate();
    await page.route('**/api/verify', async route => {
      const response = await route.fetch();
      saved.resolve(await response.json());
      await release.promise;
      await fulfill(route, response);
    });
    await page.goto(origin + '/tests/stage3.html?mode=sdk');
    await page.locator('pre#state').waitFor();
    assert.deepEqual((await sdkState(page)).calls, []);
    assert.equal(starts(requests).length, 0);
    await page.evaluate(() => window.__stage3.open());
    await phase(page, 'challenge');
    const startCount = starts(requests).length;
    await drag(page);
    const result = await bounded(saved.promise);
    assert.equal(result.passed, true);
    await phase(page, 'verifying');
    await page.evaluate(() => window.__stage3.rerender());
    await page.waitForFunction(() => JSON.parse(document.querySelector('pre#state').textContent).revision === 1);
    assert.equal(await page.locator('.car-stage').getAttribute('data-phase'), 'verifying');
    assert.deepEqual((await sdkState(page)).calls, []);
    release.resolve();
    await phase(page, 'revealing');
    await page.evaluate(() => window.__stage3.rerender());
    await page.waitForFunction(() => JSON.parse(document.querySelector('pre#state').textContent).revision === 2);
    assert.equal(await page.locator('.car-stage').getAttribute('data-phase'), 'revealing');
    assert.deepEqual((await sdkState(page)).calls, []);
    await phase(page, 'completed');
    await page.waitForFunction(() => JSON.parse(document.querySelector('pre#state').textContent).calls.length === 1);
    let state = await sdkState(page);
    assert.deepEqual(state.calls, [{
      name: 'complete', revision: 2, result: {
        challengeId: verifies(requests)[0].body.challengeId, creativeId: 'bmw-m3-v1',
        completionId: result.completionId, clickId: result.clickId,
      },
    }]);
    await close(page);
    state = await sdkState(page);
    assert.deepEqual(state.calls.map(call => call.name), ['complete', 'close']);
    await page.evaluate(() => window.__stage3.open());
    await phase(page, 'completed');
    await page.evaluate(() => window.__stage3.rerender());
    await page.waitForFunction(() => JSON.parse(document.querySelector('pre#state').textContent).revision === 3);
    await continuePost(page);
    state = await sdkState(page);
    assert.deepEqual(state.calls.map(call => call.name), ['complete', 'close', 'continue']);
    assert.equal(state.calls.at(-1).revision, 3);
    assert.equal(state.open, false);
    assert.equal(starts(requests).length, startCount);
    assert.equal(verifies(requests).length, 1);
    return { calls: state.calls };
  });

  assert.deepEqual(errors, []);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  const version = browser?.version();
  await browser?.close();
  await fs.writeFile(path.join(output, 'integration-results.json'), JSON.stringify({
    recordedAt: new Date().toISOString(), browser: version, origin, results, pageErrors: errors,
  }, null, 2) + '\n');
});
