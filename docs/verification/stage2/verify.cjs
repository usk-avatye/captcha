const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.CAPTCHAVATYE_PLAYWRIGHT_MODULE || 'playwright');
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
async function ready(page) {
  await page.goto(origin);
  await phase(page, 'challenge');
}
async function boxes(page) {
  return {
    piece: await page.locator('[data-piece]').boundingBox(),
    socket: await page.locator('[data-socket]').boundingBox(),
    image: await page.locator('.vehicle-image').boundingBox(),
  };
}
async function drag(page, options = {}) {
  const b = await boxes(page);
  const x = options.grabX ?? .5, y = options.grabY ?? .5;
  await page.mouse.move(b.piece.x + b.piece.width * x, b.piece.y + b.piece.height * y);
  await page.mouse.down();
  await page.mouse.move(
    b.socket.x + b.socket.width / 2 + b.piece.width * (x - .5) + (options.dx || 0),
    b.socket.y + b.socket.height / 2 + b.piece.height * (y - .5) + (options.dy || 0),
    { steps: 8 },
  );
  await page.mouse.up();
}
async function close(page) {
  await page.getByRole('button', { name: '인증 화면 닫기', exact: true }).click();
  assert.equal(await page.locator('dialog').evaluate(d => d.open), false);
}
async function reopen(page) {
  await page.getByRole('button', { name: '인증 화면 열기' }).click();
}
async function metrics(page) {
  return page.evaluate(() => {
    const rect = element => {
      const r = element.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    return {
      dialog: rect(document.querySelector('dialog')), stage: rect(document.querySelector('.car-stage')),
      viewport: { width: innerWidth, height: innerHeight },
      overflow: document.documentElement.scrollWidth > innerWidth,
      source: document.querySelector('.vehicle-image')?.currentSrc,
      naturalWidth: document.querySelector('.vehicle-image')?.naturalWidth,
      controls: [...document.querySelectorAll('dialog button')].map(rect),
    };
  });
}
function frame(m) {
  assert.equal(m.overflow, false);
  assert.ok(Math.abs(m.stage.width / m.stage.height - 16 / 9) < .001);
  assert.ok(m.dialog.x >= 0 && m.dialog.x + m.dialog.width <= m.viewport.width + 1);
  for (const c of m.controls) assert.ok(c.x >= m.dialog.x - 1 && c.x + c.width <= m.dialog.x + m.dialog.width + 1);
}
async function watch(page) {
  await page.evaluate(() => {
    const stage = document.querySelector('.car-stage');
    window.testPhases = [stage.dataset.phase];
    new MutationObserver(() => {
      const p = stage.dataset.phase;
      if (window.testPhases.at(-1) !== p) window.testPhases.push(p);
    }).observe(stage, { attributes: true, attributeFilter: ['data-phase'] });
  });
}
async function run(name, body, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR', ...options });
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  const requests = [];
  const releases = [];
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  page.on('pageerror', error => errors.push({ name, message: error.message }));
  page.on('request', r => { if (r.url().includes('/api/')) requests.push({ path: new URL(r.url()).pathname, body: r.postDataJSON() }); });
  const gate = () => { const g = deferred(); releases.push(g.resolve); return g; };
  try {
    const detail = await body({ page, context, requests, gate });
    results.push({ name, status: 'passed', ...detail });
    console.log(JSON.stringify({ name, status: 'passed' }));
  } catch (error) {
    await page.screenshot({ path: path.join(output, name + '-failed.png') }).catch(() => {});
    results.push({ name, status: 'failed', message: error.message, stack: error.stack });
    throw error;
  } finally {
    releases.forEach(release => release());
    await context.close();
  }
}
const verifies = requests => requests.filter(r => r.path === '/api/verify');
const starts = requests => requests.filter(r => r.path === '/api/challenges');

(async () => {
  await fs.mkdir(output, { recursive: true });
  browser = await chromium.launch({ headless: true, channel: 'chrome' });

  await run('desktop_server_gate', async ({ page, requests, gate }) => {
    const saved = gate(), release = gate();
    await page.route('**/api/verify', async route => {
      const response = await route.fetch();
      saved.resolve(await response.json());
      await release.promise;
      await route.fulfill({ response });
    });
    await ready(page);
    assert.equal(await page.getByRole('button', { name: '임시 성공', exact: true }).count(), 0);
    const before = await metrics(page); frame(before);
    await page.screenshot({ path: path.join(output, 'desktop-challenge.png') });
    await watch(page);
    await drag(page);
    assert.equal((await bounded(saved.promise)).passed, true);
    await phase(page, 'verifying');
    assert.equal(await page.locator('[data-socket]').count(), 1);
    assert.equal(await page.locator('[data-piece]').count(), 1);
    await drag(page);
    assert.equal(verifies(requests).length, 1);
    assert.equal(await page.locator('.car-stage').getAttribute('data-phase'), 'verifying');
    release.resolve();
    await phase(page, 'completed');
    const after = await metrics(page); frame(after);
    assert.equal(after.source, before.source);
    assert.equal(after.naturalWidth, 1672);
    assert.ok(Math.abs(after.dialog.height - before.dialog.height) < 1);
    assert.equal(await page.locator('[data-piece], [data-socket]').count(), 0);
    assert.equal(await page.locator('.brand-cta').isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: '다시 보기', exact: true }).count(), 0);
    const phases = await page.evaluate(() => window.testPhases);
    assert.deepEqual(phases, ['challenge', 'verifying', 'snapping', 'revealing', 'completed']);
    await page.screenshot({ path: path.join(output, 'desktop-completed.png'), animations: 'disabled' });
    return { before, after, phases };
  });

  await run('miss_then_success', async ({ page, requests }) => {
    await ready(page);
    const initial = (await boxes(page)).piece;
    const response = page.waitForResponse(r => r.url().endsWith('/api/verify'));
    await drag(page, { dx: -150, dy: 70 });
    assert.deepEqual(await (await response).json(), { passed: false });
    await phase(page, 'challenge');
    const restored = (await boxes(page)).piece;
    assert.ok(Math.abs(initial.x - restored.x) < 1 && Math.abs(initial.y - restored.y) < 1);
    await drag(page);
    await phase(page, 'completed');
    assert.equal(verifies(requests).length, 2);
    assert.equal(verifies(requests)[0].body.challengeId, verifies(requests)[1].body.challengeId);
  });

  await run('grab_offsets_and_mobile', async ({ page, requests }) => {
    const coordinates = [];
    for (const trial of [
      { width: 1280, height: 900, grabX: .5, grabY: .5 },
      { width: 1280, height: 900, grabX: .06, grabY: .88 },
      { width: 390, height: 844, grabX: .9, grabY: .15 },
    ]) {
      await page.setViewportSize({ width: trial.width, height: trial.height });
      await ready(page);
      const before = await metrics(page); frame(before);
      if (trial.width === 390) await page.screenshot({ path: path.join(output, 'mobile-challenge.png') });
      await drag(page, trial);
      await phase(page, 'completed');
      const after = await metrics(page); frame(after);
      assert.ok(Math.abs(before.dialog.height - after.dialog.height) < 1);
      coordinates.push(verifies(requests).at(-1).body);
      if (trial.width === 390) await page.screenshot({ path: path.join(output, 'mobile-completed.png'), animations: 'disabled' });
    }
    for (const c of coordinates) {
      assert.ok(Math.abs(c.dropX - .2742224880382775) < .0001);
      assert.ok(Math.abs(c.dropY - .43358129649309246) < .0001);
    }
    assert.equal(new Set(coordinates.map(c => c.challengeId)).size, 3);
    return { coordinates };
  });

  await run('pointer_cancel_and_outside', async ({ page, requests }) => {
    await ready(page);
    await page.locator('[data-piece]').evaluate(el => el.addEventListener('pointerdown', e => { window.testPointerId = e.pointerId; }));
    let b = await boxes(page);
    await page.mouse.move(b.piece.x + b.piece.width / 2, b.piece.y + b.piece.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.socket.x, b.socket.y, { steps: 5 });
    await page.locator('[data-piece]').dispatchEvent('pointercancel', { pointerId: await page.evaluate(() => window.testPointerId), bubbles: true });
    await page.mouse.up();
    assert.equal(verifies(requests).length, 0);
    const afterCancel = (await boxes(page)).piece;
    assert.ok(Math.abs(afterCancel.x - b.piece.x) < 1 && Math.abs(afterCancel.y - b.piece.y) < 1);
    b = await boxes(page);
    await page.mouse.move(b.piece.x + b.piece.width / 2, b.piece.y + b.piece.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.image.x + b.image.width + 100, b.image.y + b.image.height + 100);
    await page.mouse.up();
    assert.equal(verifies(requests).length, 0);
    assert.equal(await page.locator('.car-stage').getAttribute('data-phase'), 'challenge');
    const afterOutside = (await boxes(page)).piece;
    assert.ok(Math.abs(afterOutside.x - b.piece.x) < 1 && Math.abs(afterOutside.y - b.piece.y) < 1);
  });

  await run('final_pointerup_coordinates', async ({ page, requests }) => {
    await ready(page);
    await page.locator('[data-piece]').evaluate(el => el.addEventListener('pointerdown', e => { window.testPointerId = e.pointerId; }));
    const b = await boxes(page);
    await page.mouse.move(b.piece.x + b.piece.width / 2, b.piece.y + b.piece.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.socket.x - 100, b.socket.y + 80);
    // A different pointerup coordinate proves the handler does not reuse the last pointermove.
    await page.locator('[data-piece]').dispatchEvent('pointerup', {
      pointerId: await page.evaluate(() => window.testPointerId),
      clientX: b.socket.x + b.socket.width / 2, clientY: b.socket.y + b.socket.height / 2,
      button: 0, bubbles: true,
    });
    await page.mouse.up();
    await phase(page, 'completed');
    assert.equal(verifies(requests).length, 1);
    assert.ok(Math.abs(verifies(requests)[0].body.dropX - .2742224880382775) < .0001);
    return { request: verifies(requests)[0].body };
  });

  await run('resize_cancels_drag', async ({ page, requests }) => {
    await ready(page);
    const b = await boxes(page);
    await page.mouse.move(b.piece.x + 10, b.piece.y + 10);
    await page.mouse.down();
    await page.mouse.move(b.socket.x + 10, b.socket.y + 10);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => document.querySelector('.car-stage').getBoundingClientRect().width < 400);
    await page.mouse.up();
    assert.equal(verifies(requests).length, 0);
    await drag(page);
    await phase(page, 'completed');
    frame(await metrics(page));
  });

  await run('lost_response_retry', async ({ page, requests }) => {
    const attempts = [];
    await page.route('**/api/verify', async route => {
      const response = await route.fetch();
      attempts.push({ request: route.request().postDataJSON(), result: await response.json() });
      if (attempts.length === 1) await route.abort('failed');
      else await route.fulfill({ response });
    });
    await ready(page);
    await drag(page);
    await phase(page, 'error');
    await page.screenshot({ path: path.join(output, 'verify-retry.png') });
    await close(page); await reopen(page); await phase(page, 'error');
    assert.equal(attempts.length, 1);
    await page.getByRole('button', { name: '다시 시도', exact: true }).click();
    await phase(page, 'completed');
    assert.deepEqual(attempts[1], attempts[0]);
    assert.equal(attempts[0].result.passed, true);
    const count = requests.length;
    await close(page); await reopen(page); await phase(page, 'completed');
    assert.equal(requests.length, count);
    return { attempts };
  });

  await run('close_during_verify', async ({ page, gate }) => {
    const saved = gate(), release = gate();
    const attempts = [];
    await page.route('**/api/verify', async route => {
      const response = await route.fetch();
      attempts.push({ request: route.request().postDataJSON(), result: await response.json() });
      if (attempts.length === 1) { saved.resolve(); await release.promise; }
      await route.fulfill({ response }).catch(error => { if (!/closed|abort/i.test(error.message)) throw error; });
    });
    await ready(page); await drag(page); await bounded(saved.promise); await phase(page, 'verifying');
    await close(page); release.resolve(); await page.waitForTimeout(150);
    assert.equal(await page.locator('.car-stage').getAttribute('data-phase'), 'verifying');
    await reopen(page); await phase(page, 'completed');
    assert.deepEqual(attempts[1], attempts[0]);
    return { attempts };
  });

  for (const target of ['snapping', 'revealing']) {
    await run('close_during_' + target, async ({ page, requests }) => {
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
      await drag(page); assert.equal(await bounded(closed), target);
      await page.waitForTimeout(1100);
      assert.equal(await page.locator('dialog').evaluate(d => d.open), false);
      assert.equal(await page.locator('.car-stage').getAttribute('data-phase'), 'snapping');
      const count = verifies(requests).length;
      await reopen(page); await phase(page, 'completed');
      assert.equal(verifies(requests).length, count);
    });
  }

  await run('resize_during_reveal', async ({ page }) => {
    await ready(page); await watch(page); await drag(page); await phase(page, 'revealing');
    await page.setViewportSize({ width: 390, height: 844 }); await phase(page, 'completed');
    frame(await metrics(page));
    const phases = await page.evaluate(() => window.testPhases);
    assert.ok(phases.filter(p => p === 'snapping').length >= 2);
    return { phases };
  });

  await run('reduced_motion', async ({ page }) => {
    await ready(page); await drag(page); await phase(page, 'completed');
    assert.equal(await page.locator('[data-scene]').evaluate(el => getComputedStyle(el).transform), 'matrix(1, 0, 0, 1, 0, 0)');
  }, { reducedMotion: 'reduce' });

  await run('image_failure_retry_same_challenge', async ({ page, requests }) => {
    let fail = true;
    await page.route('**/creatives/bmw-m3/vehicle.webp', route => fail ? route.abort('failed') : route.continue());
    await page.goto(origin); await phase(page, 'error');
    const count = starts(requests).length;
    fail = false;
    await page.getByRole('button', { name: '다시 시도', exact: true }).click(); await phase(page, 'challenge');
    assert.equal(starts(requests).length, count);
    assert.equal((await metrics(page)).naturalWidth, 1672);
    await page.screenshot({ path: path.join(output, 'image-recovered.png') });
    await drag(page); await phase(page, 'completed');
  });

  await run('close_during_image_loading', async ({ page, requests, gate }) => {
    const seen = gate(), release = gate();
    await page.route('**/creatives/bmw-m3/vehicle.webp', async route => { seen.resolve(); await release.promise; await route.continue(); });
    await page.goto(origin, { waitUntil: 'domcontentloaded' }); await bounded(seen.promise);
    const count = starts(requests).length;
    await close(page); await page.waitForTimeout(10100);
    assert.equal(await page.locator('.car-stage').getAttribute('data-phase'), 'loading');
    release.resolve(); await page.waitForTimeout(150);
    assert.equal(await page.locator('.car-stage').getAttribute('data-phase'), 'loading');
    await reopen(page); await phase(page, 'challenge');
    assert.equal(starts(requests).length, count);
  });

  await run('close_during_start', async ({ page, requests, gate }) => {
    const seen = gate(), release = gate();
    const ids = [];
    await page.route('**/api/challenges', async route => {
      const response = await route.fetch();
      ids.push((await response.json()).challengeId);
      seen.resolve();
      await release.promise;
      await route.fulfill({ response }).catch(error => { if (!/closed|abort/i.test(error.message)) throw error; });
    });
    await page.goto(origin, { waitUntil: 'domcontentloaded' }); await bounded(seen.promise);
    await close(page); const firstCount = starts(requests).length;
    release.resolve(); await page.waitForTimeout(150);
    assert.equal(await page.locator('.car-stage').getAttribute('data-phase'), 'loading');
    await reopen(page); await phase(page, 'challenge');
    assert.ok(starts(requests).length > firstCount);
    await drag(page); await phase(page, 'completed');
    assert.equal(verifies(requests)[0].body.challengeId, ids.at(-1));
    return { starts: ids };
  });

  await run('missing_challenge_404', async ({ page }) => {
    await page.route('**/api/verify', async route => {
      const original = route.request().postDataJSON();
      const response = await route.fetch({ postData: { ...original, challengeId: 'not-in-this-server' } });
      assert.equal(response.status(), 404);
      await route.fulfill({ response });
    });
    await ready(page); await drag(page); await phase(page, 'error');
    assert.equal(await page.getByRole('button', { name: '다시 시도', exact: true }).count(), 0);
    await close(page); await reopen(page); await phase(page, 'error');
  });

  assert.deepEqual(errors, []);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  const version = browser?.version();
  await browser?.close();
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({
    recordedAt: new Date().toISOString(), browser: version, origin, results, pageErrors: errors,
  }, null, 2) + '\n');
});
