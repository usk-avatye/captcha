const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.CAPTCHAVATYE_PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.CAPTCHAVATYE_CONSUMER_ORIGIN || 'http://127.0.0.1:5190';
const contentOrigin = process.env.CAPTCHAVATYE_CONTENT_ORIGIN || 'http://127.0.0.1:5173';
const output = path.resolve(process.env.CAPTCHAVATYE_REPORT_DIR || 'artifacts/sdk-consumer');
const results = [];
const pageErrors = [];
let browser;
const dialog = page => page.locator('dialog[open]');
async function phase(page, value) {
  await dialog(page).locator('[data-phase="' + value + '"]').waitFor({ timeout: 10000 });
}
async function drag(page) {
  const piece = await dialog(page).locator('[data-piece]').boundingBox();
  const socket = await dialog(page).locator('[data-socket]').boundingBox();
  assert.ok(piece && socket);
  await page.mouse.move(piece.x + piece.width / 2, piece.y + piece.height / 2);
  await page.mouse.down();
  await page.mouse.move(socket.x + socket.width / 2, socket.y + socket.height / 2, { steps: 8 });
  await page.mouse.up();
}
async function count(page, selector, value) {
  await page.waitForFunction(({ selector, value }) => document.querySelector(selector)?.textContent === String(value), { selector, value });
}
async function ready(page, pathname = '/') {
  await page.goto(origin + pathname);
  await page.locator('#host-open').click();
  await phase(page, 'challenge');
}
async function close(page) {
  await page.getByRole('button', { name: '인증 화면 닫기', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('dialog').open);
}
async function run(name, fn, viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport, locale: 'ko-KR' });
  const calls = [];
  context.on('page', page => {
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => pageErrors.push({ name, message: error.message }));
  });
  context.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/captcha-api') || url.pathname.startsWith('/api/')) {
      calls.push({ origin: url.origin, path: url.pathname, body: request.postDataJSON() });
    }
  });
  const page = await context.newPage();
  try {
    const detail = await fn(page, context, calls);
    results.push({ name, status: 'passed', detail });
    console.log(name + ': passed');
  } catch (error) {
    results.push({ name, status: 'failed', error: error.stack });
    await page.screenshot({ path: path.join(output, name + '-failed.png'), fullPage: true }).catch(() => {});
    console.error(name + ': ' + error.message);
  } finally { await context.close(); }
}
(async () => {
  await fs.mkdir(output, { recursive: true });
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    await run('standalone_styles_urls_callbacks_and_reopen', async (page, _context, calls) => {
      await ready(page, '/customer/booking');
      assert.doesNotMatch(await dialog(page).innerText(), /모의 포인트|10P/);
      const metrics = await page.evaluate(() => {
        const root = document.querySelector('dialog');
        const host = getComputedStyle(document.querySelector('#host-open'));
        const title = getComputedStyle(root.querySelector('h2'));
        return { hostBackground: host.backgroundColor, hostSize: host.fontSize,
          titleColor: title.color, rootColor: getComputedStyle(root).color,
          titleMargin: title.marginTop,
          titleReference: !!document.getElementById(root.getAttribute('aria-labelledby')),
          source: root.querySelector('[data-scene] img').currentSrc,
          bodyOverflow: document.body.style.overflow };
      });
      assert.equal(metrics.hostBackground, 'rgb(31, 85, 161)');
      assert.equal(metrics.hostSize, '18px');
      assert.equal(metrics.titleColor, metrics.rootColor, '호스트 h2 색상이 모달로 유입되면 안 된다');
      assert.equal(metrics.titleMargin, '0px');
      assert.equal(metrics.titleReference, true);
      assert.equal(metrics.bodyOverflow, 'hidden');
      assert.equal(new URL(metrics.source).origin, contentOrigin);
      await page.screenshot({ path: path.join(output, 'consumer-challenge.png'), fullPage: true });
      await drag(page); await phase(page, 'completed'); await count(page, '#complete-count', 1);
      const result = JSON.parse(await page.locator('#completion-result').innerText());
      for (const key of ['challengeId','completionId','creativeId','clickId']) assert.ok(result[key]);
      const button = page.getByRole('button', { name: '예약 계속하기', exact: true });
      assert.equal(await button.evaluate(el => getComputedStyle(el).fontSize), '13px');
      const href = await page.getByRole('link', { name: /시승 신청/ }).getAttribute('href');
      assert.equal(new URL(href).origin, contentOrigin);
      assert.equal(new URL(href).searchParams.get('clickId'), result.clickId);
      await close(page);
      assert.equal(await page.evaluate(() => document.body.style.overflow), '');
      await page.locator('#host-open').click(); await phase(page, 'completed');
      await count(page, '#complete-count', 1);
      assert.deepEqual(JSON.parse(await page.locator('#completion-result').innerText()), result);
      await page.getByRole('button', { name: '예약 계속하기', exact: true }).click();
      await count(page, '#continue-count', 1);
      assert.equal(calls.filter(c => c.path === '/captcha-api/challenges').length, 1);
      assert.equal(calls.filter(c => c.body?.eventName === 'cta_shown').length, 1);
      assert.equal(calls.filter(c => c.body?.eventName === 'cta_clicked').length, 0);
      return { metrics, result };
    });
    await run('cross_origin_cta_and_independent_application', async (page, context, calls) => {
      await ready(page); await drag(page); await phase(page, 'completed');
      const result = JSON.parse(await page.locator('#completion-result').innerText());
      const popupPromise = context.waitForEvent('page');
      await page.getByRole('link', { name: /시승 신청/ }).click();
      const popup = await popupPromise; await popup.waitForLoadState();
      assert.equal(new URL(popup.url()).origin, contentOrigin);
      assert.equal(new URL(popup.url()).searchParams.get('clickId'), result.clickId);
      assert.equal(await popup.evaluate(() => window.opener), null);
      await count(page, '#continue-count', 0);
      await page.close();
      await popup.getByLabel('전시장', { exact: true }).selectOption('demo-center-a');
      await popup.getByLabel('시간', { exact: true }).selectOption('demo-slot-1');
      await popup.getByRole('button', { name: '신청', exact: true }).click();
      await popup.getByRole('heading', { name: '신청 완료', exact: true }).waitFor();
      const leadId = await popup.locator('[data-lead-id]').innerText();
      assert.ok(leadId.startsWith('lead_'));
      assert.ok(calls.some(c => c.origin === origin && c.path === '/captcha-api/events' && c.body?.eventName === 'cta_clicked'));
      assert.ok(calls.some(c => c.origin === contentOrigin && c.path === '/api/demo/test-drives' && c.body?.clickId === result.clickId));
      await popup.screenshot({ path: path.join(output, 'consumer-landing-completed.png'), fullPage: true });
      return { completionId: result.completionId, clickId: result.clickId, leadId };
    });
    await run('mobile_without_rewards_or_cta', async (page, _context, calls) => {
      await ready(page); await drag(page); await phase(page, 'completed');
      const metrics = await page.evaluate(() => {
        const d = document.querySelector('dialog').getBoundingClientRect();
        const stage = document.querySelector('[data-phase="completed"]').getBoundingClientRect();
        return { x:d.x, right:d.right, width:innerWidth, overflow:document.documentElement.scrollWidth > innerWidth,
          ratio:stage.width/stage.height };
      });
      assert.equal(metrics.overflow, false); assert.ok(metrics.x >= 0 && metrics.right <= metrics.width + 1);
      assert.ok(Math.abs(metrics.ratio - 16/9) < 0.001);
      assert.doesNotMatch(await dialog(page).innerText(), /포인트|10P/);
      await page.screenshot({ path: path.join(output, 'consumer-mobile-completed.png'), fullPage: true });
      await page.getByRole('button', { name:'예약 계속하기', exact:true }).click();
      await count(page, '#complete-count', 1); await count(page, '#continue-count', 1);
      assert.equal(calls.filter(c => c.body?.eventName === 'cta_clicked').length, 0);
      return metrics;
    }, { width:390, height:844 });
    await run('invalid_asset_base_is_not_completed', async (page, _context, calls) => {
      await page.goto(origin + '/?invalid-assets=1'); await page.locator('#host-open').click();
      await phase(page, 'error');
      await page.getByText('광고 주소 설정을 확인해 주세요.', { exact:true }).waitFor();
      assert.equal(await page.getByRole('button', { name:'다시 시도', exact:true }).count(), 0);
      await count(page, '#complete-count', 0);
      assert.equal(calls.filter(c => c.path === '/captcha-api/verify').length, 0);
      await page.getByRole('button',{name:'닫기',exact:true}).click();
      return { error:'CREATIVE_URL', completions:0 };
    });
    await run('verify_response_loss_reuses_server_result', async (page, context, calls) => {
      let first = null;
      await context.route('**/captcha-api/verify', async route => {
        const response = await route.fetch();
        if (!first) { first = await response.json(); await route.abort('failed'); }
        else await route.fulfill({ response });
      });
      await ready(page); await drag(page); await phase(page, 'error');
      await count(page, '#complete-count', 0);
      await page.getByRole('button',{name:'다시 시도',exact:true}).click();
      await phase(page,'completed'); await count(page,'#complete-count',1);
      const result = JSON.parse(await page.locator('#completion-result').innerText());
      assert.equal(result.completionId,first.completionId); assert.equal(result.clickId,first.clickId);
      const verifies=calls.filter(c=>c.path==='/captcha-api/verify');
      assert.equal(verifies.length,2); assert.deepEqual(verifies[0].body,verifies[1].body);
      return { completionId:result.completionId, retries:1 };
    });
  } finally { await browser.close(); }
  const report={recordedAt:new Date().toISOString(),origin,contentOrigin,passed:results.filter(r=>r.status==='passed').length,
    failed:results.filter(r=>r.status==='failed').length,pageErrors,results};
  await fs.writeFile(path.join(output,'consumer-results.json'),JSON.stringify(report,null,2)+'\n');
  if(report.failed || pageErrors.length) process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
