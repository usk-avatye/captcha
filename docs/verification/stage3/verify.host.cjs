const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.CAPTCHAVATYE_PLAYWRIGHT_MODULE || '/Users/jungle/.npm/_npx/31e32ef8478fbf80/node_modules/playwright');
const resultOne = { challengeId: 'ch_fixture_1', creativeId: 'bmw-m3-v1', completionId: 'cmp_fixture_1', clickId: 'clk_fixture_1' };
const resultTwo = { challengeId: 'ch_fixture_2', creativeId: 'bmw-m3-v1', completionId: 'cmp_fixture_2', clickId: 'clk_fixture_2' };
const results = [];
const pageErrors = [];
const out = __dirname;
const flush = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function act(page, name, ...args) {
  await page.evaluate(({ name, args }) => window.__stage3[name](...args), { name, args });
  await flush(page);
}
async function state(page) { return JSON.parse(await page.locator('#state').textContent()); }
async function draft(page, title = '첫 번째 글', body = '수정 전 본문') {
  await act(page, 'updateDraft', 'title', title);
  await act(page, 'updateDraft', 'body', body);
}
async function repeat(page, name, arg) {
  await page.evaluate(({ name, arg }) => {
    for (let i = 0; i < 5; i += 1) window.__stage3[name](arg);
  }, { name, arg });
  await flush(page);
}
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const version = browser.version();
  async function check(name, fn) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR' });
    const page = await context.newPage();
    page.setDefaultTimeout(6000);
    page.on('pageerror', error => pageErrors.push({ name, error: error.message }));
    try {
      await page.goto('http://127.0.0.1:5173/tests/stage3.html?mode=host');
      await page.waitForFunction(() => !!window.__stage3);
      await fn(page);
      results.push({ name, passed: true });
      console.log('PASS ' + name);
    } catch (error) {
      results.push({ name, passed: false, error: String(error.stack || error) });
      console.log('FAIL ' + name + ': ' + error.message);
    } finally { await context.close(); }
  }
  await check('host_duplicate_completion_and_continue', async page => {
    await draft(page);
    await repeat(page, 'onComplete', resultOne);
    let value = await state(page);
    assert.equal(value.points, 10, '중복 완료를 한 번의 10P로 반영');
    assert.equal(value.completed, true);
    assert.equal(value.posts.length, 0, '완료 콜백이 글을 등록하지 않음');
    await repeat(page, 'onContinue');
    value = await state(page);
    assert.deepEqual(value.posts, [{ number: 1, title: '첫 번째 글', body: '수정 전 본문' }]);
    assert.equal(value.points, 10);
    assert.equal(value.registered, true);
    assert.equal(value.open, false);
  });
  await check('host_continue_requires_completion_and_close_preserves_draft', async page => {
    await draft(page);
    await act(page, 'onContinue');
    assert.equal((await state(page)).posts.length, 0);
    await act(page, 'requestPublish');
    assert.equal((await state(page)).open, true);
    await act(page, 'onClose');
    const value = await state(page);
    assert.equal(value.open, false);
    assert.equal(value.points, 0);
    assert.deepEqual(value.draft, { title: '첫 번째 글', body: '수정 전 본문' });
    assert.equal(value.posts.length, 0);
  });
  await check('host_latest_draft_after_completed_close', async page => {
    await draft(page);
    await act(page, 'requestPublish');
    await act(page, 'onComplete', resultOne);
    await act(page, 'onClose');
    await draft(page, '수정한 제목', '새 본문\n둘째 줄');
    await act(page, 'requestPublish');
    await repeat(page, 'onComplete', resultOne);
    await repeat(page, 'onContinue');
    const value = await state(page);
    assert.equal(value.points, 10);
    assert.deepEqual(value.posts, [{ number: 1, title: '수정한 제목', body: '새 본문\n둘째 줄' }]);
  });
  await check('host_new_attempt_ignores_stale_callbacks', async page => {
    await draft(page);
    await act(page, 'onComplete', resultOne);
    await act(page, 'saveCallbacks');
    await act(page, 'onContinue');
    await act(page, 'newPost');
    let value = await state(page);
    assert.equal(value.attemptKey, 1);
    assert.deepEqual(value.draft, { title: '', body: '' });
    assert.equal(value.points, 10);
    await draft(page, '두 번째 글', '두 번째 본문');
    await act(page, 'requestPublish');
    await act(page, 'callSaved', resultTwo);
    value = await state(page);
    assert.equal(value.open, true, '이전 onClose가 새 모달을 닫지 않음');
    assert.equal(value.completed, false);
    assert.equal(value.points, 10);
    assert.equal(value.posts.length, 1);
    await act(page, 'onComplete', resultTwo);
    await repeat(page, 'onContinue');
    value = await state(page);
    assert.equal(value.points, 20);
    assert.equal(value.posts.length, 2);
    assert.deepEqual(value.posts[1], { number: 2, title: '두 번째 글', body: '두 번째 본문' });
  });
  await check('host_completion_id_set_survives_new_post', async page => {
    await draft(page);
    await act(page, 'onComplete', resultOne);
    await act(page, 'onContinue');
    await act(page, 'newPost');
    await draft(page, '두 번째 글', '본문');
    await repeat(page, 'onComplete', resultOne);
    assert.equal((await state(page)).points, 10, '새 시도에서도 동일 완료 ID를 다시 보상하지 않음');
  });
  await check('host_whitespace_and_premature_reset_are_blocked', async page => {
    await draft(page, '   ', '\n  ');
    await act(page, 'requestPublish');
    let value = await state(page);
    assert.equal(value.open, false);
    assert.ok(value.error, '공백만 있는 글을 안내');
    await act(page, 'onComplete', resultOne);
    await act(page, 'onContinue');
    value = await state(page);
    assert.equal(value.posts.length, 0);
    assert.equal(value.registered, false);
    await act(page, 'newPost');
    assert.equal((await state(page)).attemptKey, 0);
    await draft(page, '고친 제목', '고친 본문');
    await act(page, 'onContinue');
    value = await state(page);
    assert.equal(value.posts.length, 1);
    assert.equal(value.points, 10);
  });
  await browser.close();
  const report = { checkedAt: new Date().toISOString(), browser: version, mode: 'real React StrictMode host hook boundary', results, pageErrors };
  fs.writeFileSync(path.join(out, 'host-results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: results.filter(item => item.passed).length, total: results.length, pageErrors }));
  if (results.some(item => !item.passed) || pageErrors.length) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });

