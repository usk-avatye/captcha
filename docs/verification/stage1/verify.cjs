const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.CAPTCHAVATYE_PLAYWRIGHT_MODULE || 'playwright');

const origin = 'http://127.0.0.1:5173';
const output = path.resolve(__dirname);
const results = [];
const errors = [];
let browser;
const record = (name, detail) => { results.push({ name, status: 'passed', ...detail }); console.log(JSON.stringify({ name, status: 'passed' })); };
async function createPage(viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport, locale: 'ko-KR', reducedMotion: 'no-preference' });
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  return { context, page };
}
async function phase(page, value) {
  await page.locator('.car-stage[data-phase="' + value + '"]').waitFor({ state: 'attached', timeout: 5000 });
}
async function ready(page) {
  await page.goto(origin, { waitUntil: 'networkidle' });
  await phase(page, 'challenge');
}
async function metrics(page) {
  return page.evaluate(() => {
    const rect = element => {
      const r = element.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const dialog = document.querySelector('dialog');
    const stage = document.querySelector('.car-stage');
    const image = document.querySelector('.vehicle-image');
    return {
      viewport: { width: innerWidth, height: innerHeight }, dialog: rect(dialog), stage: rect(stage),
      phase: stage.dataset.phase, source: image.currentSrc, naturalWidth: image.naturalWidth,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      controls: [...dialog.querySelectorAll('button')].filter(b => b.getBoundingClientRect().width > 0).map(b => ({ text: b.textContent, disabled: b.disabled, ...rect(b) })),
      pieceCount: document.querySelectorAll('[data-piece]').length,
      socketCount: document.querySelectorAll('[data-socket]').length,
      sceneTransform: getComputedStyle(document.querySelector('[data-scene]')).transform,
    };
  });
}
function assertFrame(value) {
  assert.equal(value.horizontalOverflow, false);
  assert.ok(Math.abs(value.stage.width / value.stage.height - 16 / 9) < 0.001);
  assert.ok(value.dialog.x >= 0 && value.dialog.x + value.dialog.width <= value.viewport.width + 1);
  for (const control of value.controls) assert.ok(control.x >= value.dialog.x - 1 && control.x + control.width <= value.dialog.x + value.dialog.width + 1, 'Control outside dialog: ' + control.text);
}
function watchCompletion(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const stage = document.querySelector('.car-stage');
    const phases = [{ phase: stage.dataset.phase, at: performance.now() }];
    const transitions = [];
    const box = element => {
      if (!element) return null;
      const r = element.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const onTransition = event => {
      if (event.propertyName !== 'transform') return;
      if (event.target.matches('[data-piece], [data-scene]')) transitions.push({
        kind: event.target.hasAttribute('data-piece') ? 'piece' : 'scene',
        at: event.timeStamp, elapsed: event.elapsedTime,
        bounds: box(event.target), target: box(document.querySelector('[data-socket]')),
      });
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Animation did not complete')); }, 5000);
    const cleanup = () => { observer.disconnect(); document.removeEventListener('transitionend', onTransition, true); clearTimeout(timer); };
    const observer = new MutationObserver(() => {
      const value = stage.dataset.phase;
      if (phases.at(-1).phase !== value) phases.push({ phase: value, at: performance.now() });
      if (value === 'completed') { cleanup(); resolve({ phases, transitions }); }
    });
    document.addEventListener('transitionend', onTransition, true);
    observer.observe(stage, { attributes: true, attributeFilter: ['data-phase'] });
  }));
}
async function reveal(page) {
  const completed = watchCompletion(page);
  await page.getByRole('button', { name: '임시 성공', exact: true }).click();
  return completed;
}
async function closeAndCheck(page, method) {
  if (method === 'escape') await page.keyboard.press('Escape');
  else await page.getByRole('button', { name: '미리보기 닫기', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('dialog').open);
}
(async () => {
  await fs.mkdir(output, { recursive: true });
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const { context, page } = await createPage();
  await ready(page);
  const before = await metrics(page);
  assertFrame(before);
  await page.screenshot({ path: path.join(output, 'desktop-challenge.png') });
  const trace = await reveal(page);
  const after = await metrics(page);
  assertFrame(after);
  assert.deepEqual(trace.phases.map(v => v.phase), ['challenge', 'snapping', 'revealing', 'completed']);
  assert.equal(after.source, before.source);
  assert.equal(after.naturalWidth, 1672);
  assert.ok(Math.abs(before.dialog.height - after.dialog.height) < 1);
  assert.equal(after.pieceCount, 0);
  assert.equal(after.socketCount, 0);
  assert.equal(after.sceneTransform, 'matrix(1, 0, 0, 1, 0, 0)');
  const pieceEnd = trace.transitions.find(v => v.kind === 'piece');
  // DESIGN allows transitionend to be absent; the fallback must still complete.
  // When the browser delivers the event, measure the actual rendered alignment.
  if (pieceEnd) {
    assert.ok(pieceEnd.target);
    for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(pieceEnd.bounds[key] - pieceEnd.target[key]) < 1, 'Snap alignment ' + key);
  }
  assert.equal(await page.getByRole('button', { name: '시승 신청 — 연출 미리보기에서는 이용할 수 없음' }).isDisabled(), true);
  assert.equal(context.pages().length, 1);
  await page.screenshot({ path: path.join(output, 'desktop-completed.png'), animations: 'disabled' });
  record('desktop_reveal', { before, after, trace });

  await closeAndCheck(page, 'button');
  await page.getByRole('button', { name: '인증 화면 열기' }).click();
  await phase(page, 'completed');
  await page.getByRole('button', { name: '다시 보기', exact: true }).click();
  await phase(page, 'challenge');
  assert.equal(await page.locator('.brand-panel').evaluate(element => getComputedStyle(element).opacity), '0', 'Brand text remained visible immediately after replay');
  record('completed_reopen_and_replay', { phase: 'challenge', brandHiddenImmediately: true });

  for (const target of ['snapping', 'revealing']) {
    await page.getByRole('button', { name: '임시 성공', exact: true }).click();
    await phase(page, target);
    const observed = await page.locator('.car-stage').getAttribute('data-phase');
    assert.equal(observed, target);
    await closeAndCheck(page, target === 'snapping' ? 'escape' : 'button');
    await page.waitForTimeout(1100);
    assert.equal(await page.locator('.car-stage').getAttribute('data-phase'), 'snapping');
    const restarted = watchCompletion(page);
    await page.getByRole('button', { name: '인증 화면 열기' }).click();
    const reopenedTrace = await restarted;
    assert.deepEqual(reopenedTrace.phases.map(v => v.phase), ['snapping', 'revealing', 'completed']);
    record('close_during_' + target, { trace: reopenedTrace });
    await page.getByRole('button', { name: '다시 보기', exact: true }).click();
    await phase(page, 'challenge');
  }

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileBefore = await metrics(page);
  assertFrame(mobileBefore);
  await page.screenshot({ path: path.join(output, 'mobile-challenge.png') });
  const mobileTrace = await reveal(page);
  const mobileAfter = await metrics(page);
  assertFrame(mobileAfter);
  assert.ok(Math.abs(mobileBefore.dialog.height - mobileAfter.dialog.height) < 1);
  await page.screenshot({ path: path.join(output, 'mobile-completed.png'), animations: 'disabled' });
  record('mobile_reveal', { before: mobileBefore, after: mobileAfter, trace: mobileTrace });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('button', { name: '다시 보기', exact: true }).click();
  const resized = watchCompletion(page);
  await page.getByRole('button', { name: '임시 성공', exact: true }).click();
  await phase(page, 'revealing');
  await page.setViewportSize({ width: 390, height: 844 });
  const resizeTrace = await resized;
  const resizedMetrics = await metrics(page);
  assertFrame(resizedMetrics);
  assert.equal(resizedMetrics.phase, 'completed');
  assert.ok(resizeTrace.phases.filter(v => v.phase === 'snapping').length >= 2);
  record('resize_during_reveal', { trace: resizeTrace });

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: '다시 보기', exact: true }).click();
  const startedAt = Date.now();
  const reducedTrace = await reveal(page);
  record('reduced_motion', { elapsedMs: Date.now() - startedAt, trace: reducedTrace });
  await context.close();

  const failure = await createPage();
  let failImage = true;
  await failure.page.route('**/creatives/bmw-m3/vehicle.webp', route => failImage ? route.abort('failed') : route.continue());
  await failure.page.goto(origin, { waitUntil: 'networkidle' });
  await phase(failure.page, 'error');
  await failure.page.screenshot({ path: path.join(output, 'image-error.png') });
  failImage = false;
  await failure.page.getByRole('button', { name: '다시 불러오기', exact: true }).click();
  await phase(failure.page, 'challenge');
  const recovered = await metrics(failure.page);
  await failure.page.screenshot({ path: path.join(output, 'image-recovered.png') });
  assert.equal(recovered.naturalWidth, 1672, 'Visible image remained broken after retry');
  record('image_failure_retry', { after: recovered });
  await failure.context.close();

  const loading = await createPage();
  let release;
  const hold = new Promise(resolve => { release = resolve; });
  await loading.page.route('**/creatives/bmw-m3/*', async route => { await hold; await route.continue(); });
  await loading.page.goto(origin, { waitUntil: 'domcontentloaded' });
  await phase(loading.page, 'loading');
  await closeAndCheck(loading.page, 'button');
  await loading.page.waitForTimeout(10500);
  assert.equal(await loading.page.locator('.car-stage').getAttribute('data-phase'), 'loading');
  release();
  await loading.page.waitForLoadState('networkidle');
  assert.equal(await loading.page.locator('.car-stage').getAttribute('data-phase'), 'loading');
  await loading.page.getByRole('button', { name: '인증 화면 열기' }).click();
  await phase(loading.page, 'challenge');
  record('loading_close_reopen', { hiddenWaitMs: 10500, recoveredPhase: 'challenge' });
  await loading.context.close();
  assert.deepEqual(errors, []);
})().catch(error => {
  results.push({ name: 'verification_failure', status: 'failed', message: error.message, stack: error.stack });
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  const version = browser?.version();
  await browser?.close();
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ recordedAt: new Date().toISOString(), browser: version, origin, results, pageErrors: errors }, null, 2) + '\n');
});
