'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

// Run from docs/verification/stage5/ in the real repository. All successful
// challenge, verification, event and application responses come from its API.
// This runner NEVER starts, stops or signals the backend. The operator owns the
// single real restart and acknowledges it through the file gate below.
//
// Required environment:
//   CAPTCHAVATYE_PLAYWRIGHT_MODULE=/absolute/path/to/playwright
//   CAPTCHAVATYE_RESTART_GATE=/absolute/repo/.git/new-empty-stage5-directory
// Optional: CAPTCHAVATYE_RESTART_TIMEOUT_MS (1,000..180,000; default 180,000).
//
// When {checkpoint:"restart_ready",gate:...} is printed, inspect ready.json,
// restart the backend externally, check it is healthy, then atomically write:
//   {"oldPid":123,"newPid":456,"restartedAt":"<ISO timestamp>","runId":"<ready runId>"}
// to <gate>/restarted.json. oldPid/newPid/restartedAt are mandatory; runId is
// recommended and checked if supplied. The browser tabs remain open meanwhile.
//
// A separate, browser-free helper reads the ready state without starting a run:
//   CAPTCHAVATYE_RESTART_GATE=... node verify.restart.cjs --read-ready

const origin = 'http://127.0.0.1:5173';
const output = __dirname;
const resultPath = path.join(output, 'restart-results.json');
const repoRoot = path.resolve(__dirname, '../../..');
const applicationPath = '/api/demo/test-drives';
const runId = crypto.randomUUID();
const startedAt = new Date().toISOString();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const requestEntries = new WeakMap();
const responseJobs = new Set();
const pageIds = new WeakMap();
const observedPages = new WeakSet();
let nextPageId = 1;
let phase = 'startup';
let browser;
let context;
let original;
let oldChild;
let pending;
let newChild;
let firstDemo;
let secondDemo;
let acceptedEvent;
let gate;
let ready;
let fatalError;

const definitions = [
  ['environment_and_gate', 'startup'],
  ['first_full_demo', 'before_restart'],
  ['preserve_old_tabs_and_payload', 'before_restart'],
  ['external_backend_restart', 'awaiting_restart'],
  ['pending_challenge_rejected', 'after_restart'],
  ['old_application_link_rejected', 'after_restart'],
  ['old_accepted_event_replay_rejected', 'after_restart'],
  ['old_completed_challenge_rejected', 'after_restart'],
  ['community_reload_resets_client', 'clean_client'],
  ['second_full_demo_with_new_ids', 'clean_client'],
  ['request_and_ui_invariants', 'final_verification'],
];
const report = {
  schemaVersion: 1,
  runId,
  startedAt,
  recordedAt: startedAt,
  status: 'running',
  origin,
  mode: 'isolated Chrome; real UI, real API, one externally controlled backend restart',
  serverLifecycleControlledByRunner: false,
  mockedResponses: 0,
  browser: null,
  gate: null,
  phaseChecks: definitions.map(([name, checkPhase]) => ({ name, phase: checkPhase, status: 'not_run' })),
  checkpoints: [],
  oldIds: null,
  oldPendingChallengeId: null,
  newIds: null,
  acceptedEvent: null,
  backendRestart: null,
  pages: [],
  requests: [],
  pageErrors: [],
  consoleErrors: [],
  screenshots: [],
  cleanupErrors: [],
};

function message(error) {
  return { message: error?.message || String(error), stack: error?.stack || null };
}

async function saveReport() {
  report.recordedAt = new Date().toISOString();
  report.passed = report.phaseChecks.filter(item => item.status === 'passed').length;
  report.failed = report.phaseChecks.filter(item => item.status === 'failed').length;
  report.notRun = report.phaseChecks.filter(item => item.status === 'not_run').length;
  report.requestStatuses = report.requests.map(({ id, phase: requestPhase, source, page, path: pathname, status, failure }) => ({
    id, phase: requestPhase, source, page, path: pathname, status: status ?? null, ...(failure ? { failure } : {}),
  }));
  await fs.writeFile(resultPath, JSON.stringify(report, null, 2) + '\n');
}

async function until(predicate, description, timeout = 10000) {
  const end = Date.now() + timeout;
  while (!(await predicate())) {
    if (Date.now() >= end) throw new Error(description + ' (timed out after ' + timeout + ' ms)');
    await delay(25);
  }
}

async function bounded(promise, timeout, description) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(description)), timeout);
    })]);
  } finally { clearTimeout(timer); }
}

async function drainResponses() {
  await bounded(Promise.allSettled([...responseJobs]), 3000, 'Response observation timed out');
}

async function capture(page, filename) {
  if (!page || page.isClosed()) return;
  const destination = path.join(output, filename);
  await page.screenshot({ path: destination, fullPage: true, animations: 'disabled', timeout: 10000 });
  const evidence = { filename, path: destination, phase, recordedAt: new Date().toISOString() };
  const oldIndex = report.screenshots.findIndex(item => item.filename === filename);
  if (oldIndex >= 0) report.screenshots[oldIndex] = evidence;
  else report.screenshots.push(evidence);
}

async function check(name, body, { required = false, screenshotPage, screenshotName = 'restart-failure.png' } = {}) {
  const entry = report.phaseChecks.find(item => item.name === name);
  assert.ok(entry, 'Known phase check');
  phase = entry.phase;
  entry.status = 'running';
  entry.startedAt = new Date().toISOString();
  await saveReport();
  try {
    entry.detail = await body();
    entry.status = 'passed';
    console.log(JSON.stringify({ check: name, status: 'passed' }));
    return true;
  } catch (error) {
    entry.status = 'failed';
    Object.assign(entry, message(error));
    const candidate = screenshotPage?.() || context?.pages().filter(page => !page.isClosed()).at(-1);
    await capture(candidate, screenshotName).catch(captureError => {
      entry.screenshotError = captureError.message;
    });
    console.error(JSON.stringify({ check: name, status: 'failed', message: error.message }));
    if (required) throw error;
    return false;
  } finally {
    entry.finishedAt = new Date().toISOString();
    await saveReport();
  }
}

async function validateGate({ empty }) {
  const supplied = process.env.CAPTCHAVATYE_RESTART_GATE;
  assert.ok(supplied && path.isAbsolute(supplied), 'CAPTCHAVATYE_RESTART_GATE must be an absolute path');
  const lexicalGit = path.join(repoRoot, '.git');
  const lexicalRelative = path.relative(lexicalGit, path.resolve(supplied));
  assert.ok(lexicalRelative && lexicalRelative !== '..' && !lexicalRelative.startsWith('..' + path.sep)
    && !path.isAbsolute(lexicalRelative), 'Restart gate must be a new directory under this repository .git');
  const suppliedStat = await fs.lstat(supplied);
  assert.ok(suppliedStat.isDirectory() && !suppliedStat.isSymbolicLink(), 'Gate must already exist as a real directory');
  const git = await fs.realpath(lexicalGit);
  const actual = await fs.realpath(supplied);
  const actualRelative = path.relative(git, actual);
  assert.ok(actualRelative && actualRelative !== '..' && !actualRelative.startsWith('..' + path.sep)
    && !path.isAbsolute(actualRelative), 'Resolved gate must remain inside this repository .git');
  if (empty) assert.deepEqual(await fs.readdir(actual), [], 'Gate must be newly created and empty before this run');
  return actual;
}

async function readJsonFile(filename) {
  const stat = await fs.lstat(filename);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'Gate JSON must be a regular file');
  return JSON.parse(await fs.readFile(filename, 'utf8'));
}

function attachPage(page) {
  if (observedPages.has(page)) return;
  observedPages.add(page);
  const id = nextPageId++;
  pageIds.set(page, id);
  report.pages.push({ id, label: 'page-' + id, initialUrl: page.url() });
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(15000);
  page.on('pageerror', error => report.pageErrors.push({ phase, page: id, at: new Date().toISOString(), ...message(error) }));
  page.on('console', entry => {
    if (entry.type() !== 'error') return;
    const text = entry.text();
    report.consoleErrors.push({
      phase, page: id, at: new Date().toISOString(), text,
      expectedHttp404: /\b404\b/.test(text), location: entry.location(),
    });
  });
}

function labelPage(page, label) {
  attachPage(page);
  report.pages.find(item => item.id === pageIds.get(page)).label = label;
}

function requestPageId(request) {
  try { return pageIds.get(request.frame().page()) ?? null; }
  catch { return null; }
}

function appendRequest({ source, url, method, rawBody, page = null, routeAction = null }) {
  let body = null;
  try { body = rawBody === null ? null : JSON.parse(rawBody); }
  catch { /* Kept verbatim for a failure report; invariants will reject invalid JSON. */ }
  const entry = {
    id: report.requests.length + 1, phase, source, page, at: new Date().toISOString(),
    url, path: new URL(url).pathname, method, rawBody, body, routeAction,
  };
  report.requests.push(entry);
  return entry;
}

async function installObservation() {
  context.on('page', attachPage);
  // Read-only DOM history catches a transient duplicate reward as well as the
  // final balance. It neither changes React state nor invokes application code.
  await context.addInitScript(() => {
    if (window.__captchavatyeStage5ObservedDocument === document) return;
    Object.defineProperty(window, '__captchavatyeStage5ObservedDocument', { value: document, configurable: true });
    const history = [];
    Object.defineProperty(window, '__captchavatyeStage5Points', { value: history, configurable: true });
    const sample = () => {
      const node = document.querySelector('[data-points]');
      if (!node) return;
      const value = node.textContent.trim();
      if (history.at(-1)?.value !== value) history.push({ at: new Date().toISOString(), value });
    };
    new MutationObserver(sample).observe(document, { childList: true, characterData: true, subtree: true });
    sample();
  });
  // Observation only. Every intercepted request continues unchanged to the
  // actual server: no fulfill(), fetch substitution, abort(), or fake success.
  await context.route('**/api/**', async route => {
    const request = route.request();
    const entry = appendRequest({
      source: 'browser', url: request.url(), method: request.method(),
      rawBody: request.postData(), page: requestPageId(request), routeAction: 'continue',
    });
    requestEntries.set(request, entry);
    await route.continue();
  });
  context.on('response', response => {
    const entry = requestEntries.get(response.request());
    if (!entry) return;
    entry.status = response.status();
    entry.responseAt = new Date().toISOString();
    const job = response.text().then(raw => {
      entry.responseRaw = raw;
      try { entry.response = JSON.parse(raw); }
      catch { entry.response = null; }
    }).catch(error => { entry.responseReadError = error.message; });
    responseJobs.add(job);
    void job.finally(() => responseJobs.delete(job));
  });
  context.on('requestfailed', request => {
    const entry = requestEntries.get(request);
    if (entry) entry.failure = request.failure()?.errorText || 'Request failed';
  });
}

const calls = (pathname, page, start = 0) => report.requests.slice(start).filter(entry => entry.path === pathname
  && (!page || entry.page === pageIds.get(page)));
const events = clickId => calls('/api/events').filter(entry => entry.source === 'browser' && entry.body?.clickId === clickId);
const locationSelect = page => page.getByLabel('시연 전시장', { exact: true });
const slotSelect = page => page.getByLabel('시연 시간', { exact: true });
const submitButton = page => page.locator('button[type="submit"]').first();

async function oneResponse(pathname, page, start, expectedStatus) {
  await until(() => calls(pathname, page, start).some(entry => entry.status !== undefined && entry.response !== undefined),
    'Receive real ' + pathname + ' response');
  const matches = calls(pathname, page, start);
  assert.equal(matches.length, 1, 'Exactly one ' + pathname + ' request for this action');
  assert.equal(matches[0].status, expectedStatus, pathname + ' actual HTTP status');
  return matches[0];
}

async function stage(page, value) {
  await page.locator('.car-stage[data-phase="' + value + '"]').waitFor({ state: 'attached' });
}

async function points(page, value) {
  await page.waitForFunction(expected => document.querySelector('[data-points]')?.textContent.trim() === expected, value + 'P');
}

async function pointHistory(page) {
  return page.evaluate(() => window.__captchavatyeStage5Points || []);
}

async function assertPointsHistory(page, expected) {
  const history = await pointHistory(page);
  assert.deepEqual(history.map(item => item.value), expected, 'Only the expected point transitions occur');
  return history;
}

async function communityState(page) {
  return page.evaluate(() => ({
    url: location.href,
    points: document.querySelector('[data-points]')?.textContent.trim() ?? null,
    posts: [...document.querySelectorAll('.community-post')].map(article => ({
      title: article.querySelector('h3')?.textContent ?? null,
      body: article.querySelector('.post-body')?.textContent ?? null,
    })),
    draft: {
      title: document.querySelector('#post-title')?.value ?? null,
      body: document.querySelector('#post-body')?.value ?? null,
    },
    dialogOpen: document.querySelector('dialog')?.open ?? false,
    phase: document.querySelector('.car-stage')?.getAttribute('data-phase') ?? null,
    pointsHistory: window.__captchavatyeStage5Points || [],
  }));
}

async function childState(page) {
  return page.evaluate(() => ({
    url: location.href,
    clickId: new URL(location.href).searchParams.get('clickId'),
    locationId: document.querySelector('#drive-location')?.value ?? null,
    slotId: document.querySelector('#drive-slot')?.value ?? null,
    leadId: document.querySelector('[data-lead-id]')?.textContent ?? null,
    successVisible: !!document.querySelector('.drive-success'),
    alert: document.querySelector('[role="alert"]')?.textContent ?? null,
  }));
}

async function startChallenge(page, draft) {
  await points(page, 0);
  await page.getByLabel('제목', { exact: true }).fill(draft.title);
  await page.getByLabel('본문', { exact: true }).fill(draft.body);
  const start = report.requests.length;
  await page.getByRole('button', { name: '인증하고 등록하기', exact: true }).click();
  await stage(page, 'challenge');
  const request = await oneResponse('/api/challenges', page, start, 201);
  assert.ok(typeof request.response.challengeId === 'string' && request.response.challengeId.length > 0);
  return request;
}

async function drag(page) {
  const piece = await page.locator('[data-piece]').boundingBox();
  const socket = await page.locator('[data-socket]').boundingBox();
  assert.ok(piece && socket, 'Real puzzle geometry is visible');
  const from = { x: piece.x + piece.width / 2, y: piece.y + piece.height / 2 };
  const to = { x: socket.x + socket.width / 2, y: socket.y + socket.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
  return { from, to };
}

async function choose(page) {
  await locationSelect(page).selectOption('demo-center-b');
  await slotSelect(page).selectOption('demo-slot-2');
}

async function successfulEvents(clickId, expected = 3) {
  await until(() => events(clickId).length >= expected && events(clickId).every(entry => entry.response !== undefined),
    'All client events receive actual API responses');
  const entries = events(clickId);
  assert.equal(entries.length, expected, 'One client event for each expected action');
  for (const entry of entries) {
    assert.equal(entry.status, 201);
    assert.deepEqual(entry.response, { accepted: true, duplicate: false });
  }
  assert.equal(new Set(entries.map(entry => entry.body.eventId)).size, expected);
  return entries;
}

async function fullDemo(page, label) {
  const draft = {
    title: label === 'before' ? '서버 재시작 전 첫 번째 실제 시연' : '서버 재시작 후 두 번째 실제 시연',
    body: '실제 드래그 인증, 모의 10P, 새 탭 시승 신청, 원래 게시글 등록을 차례로 확인합니다.',
  };
  const started = await startChallenge(page, draft);
  const verifyStart = report.requests.length;
  const pointer = await drag(page);
  await stage(page, 'completed');
  await points(page, 10);
  const verified = await oneResponse('/api/verify', page, verifyStart, 200);
  assert.equal(verified.body.challengeId, started.response.challengeId);
  assert.equal(verified.response.passed, true);
  const ids = {
    challengeId: started.response.challengeId,
    completionId: verified.response.completionId,
    clickId: verified.response.clickId,
    leadId: null,
    eventIds: [],
  };
  for (const name of ['challengeId', 'completionId', 'clickId']) assert.ok(typeof ids[name] === 'string' && ids[name].length > 0);
  const cta = page.locator('a.brand-cta');
  await cta.waitFor({ state: 'visible' });
  const href = new URL(await cta.getAttribute('href'), origin);
  assert.equal(href.origin, origin);
  assert.equal(href.pathname, '/demo/test-drive');
  assert.equal(href.searchParams.get('clickId'), ids.clickId, 'CTA preserves the exact opaque click ID');
  assert.equal(await cta.getAttribute('target'), '_blank');
  const rel = (await cta.getAttribute('rel')).split(/\s+/);
  assert.ok(rel.includes('noopener') && rel.includes('noreferrer'));
  assert.equal(await page.locator('.community-post').count(), 0, 'Authentication alone does not register a post');
  const [child] = await Promise.all([context.waitForEvent('page', { timeout: 10000 }), cta.click()]);
  labelPage(child, label === 'before' ? 'application-before-restart' : 'application-after-restart');
  await child.waitForURL(url => url.origin === origin && url.pathname === '/demo/test-drive'
    && url.searchParams.get('clickId') === ids.clickId);
  await locationSelect(child).waitFor();
  assert.equal(await child.evaluate(() => window.opener), null);
  await choose(child);
  const applicationStart = report.requests.length;
  await submitButton(child).click();
  await child.locator('.drive-success').waitFor();
  const application = await oneResponse(applicationPath, child, applicationStart, 201);
  assert.deepEqual(application.body, { clickId: ids.clickId, locationId: 'demo-center-b', slotId: 'demo-slot-2' });
  assert.equal(application.response.status, 'completed');
  assert.equal(application.response.isDemo, true);
  assert.equal(application.response.clickId, ids.clickId);
  assert.equal(application.response.locationId, application.body.locationId);
  assert.equal(application.response.slotId, application.body.slotId);
  ids.leadId = await child.locator('[data-lead-id]').textContent();
  assert.ok(typeof ids.leadId === 'string' && ids.leadId.length > 0);
  assert.equal(ids.leadId, application.response.leadId);
  await points(page, 10);
  assert.equal(await page.locator('.community-post').count(), 0, 'Child application does not publish the parent draft');
  await page.getByRole('button', { name: '원래 작업 계속하기', exact: true }).click();
  await page.getByRole('heading', { name: '게시글이 등록됐어요', exact: true }).waitFor();
  await points(page, 10);
  const community = await communityState(page);
  assert.deepEqual(community.posts, [draft]);
  assert.equal(community.dialogOpen, false);
  await assertPointsHistory(page, ['0P', '10P']);
  const logged = await successfulEvents(ids.clickId);
  assert.deepEqual(logged.map(entry => entry.body.eventName).sort(), ['cta_clicked', 'cta_shown', 'landing_viewed']);
  ids.eventIds = logged.map(entry => entry.body.eventId);
  return {
    child, ids, draft, community, childState: await childState(child), pointer,
    challengeRequestId: started.id, verifyRequestId: verified.id,
    verifyRawPayload: verified.rawBody, applicationRequestId: application.id,
    eventRequestIds: logged.map(entry => entry.id),
  };
}

function demoDetail(demo) {
  const { child, ...detail } = demo;
  return detail;
}

function actual404(entry, expectedCode) {
  assert.equal(entry.status, 404);
  assert.equal(entry.response?.detail?.code, expectedCode);
  assert.ok(typeof entry.response.detail.message === 'string' && entry.response.detail.message.length > 0);
  return entry.response.detail;
}

async function replayRaw(pathname, rawBody) {
  const entry = appendRequest({ source: 'api-replay', url: origin + pathname, method: 'POST', rawBody });
  try {
    const response = await context.request.post(entry.url, {
      headers: { 'Content-Type': 'application/json' }, data: rawBody, timeout: 10000, failOnStatusCode: false,
    });
    entry.status = response.status();
    entry.responseAt = new Date().toISOString();
    entry.responseRaw = await response.text();
    try { entry.response = JSON.parse(entry.responseRaw); }
    catch { entry.response = null; }
    await response.dispose();
    return entry;
  } catch (error) {
    entry.failure = error.message;
    throw error;
  }
}

async function waitForExternalRestart() {
  const timeout = Number(process.env.CAPTCHAVATYE_RESTART_TIMEOUT_MS ?? 180000);
  assert.ok(Number.isInteger(timeout) && timeout >= 1000 && timeout <= 180000,
    'Restart timeout must be an integer between 1000 and 180000 ms');
  ready = {
    schemaVersion: 1, checkpoint: 'restart_ready', runId, readyAt: new Date().toISOString(), gate,
    origin, browser: report.browser, oldPendingChallengeId: report.oldPendingChallengeId,
    completed: report.oldIds,
    acceptedEvent: report.acceptedEvent,
    community: await communityState(original),
    child: await childState(oldChild),
    pending: await communityState(pending),
    pendingChallengeRequest: calls('/api/challenges', pending).at(-1),
    maxWaitMs: timeout,
  };
  await fs.writeFile(path.join(gate, 'ready.json'), JSON.stringify(ready, null, 2) + '\n', { flag: 'wx' });
  report.checkpoints.push({ checkpoint: 'restart_ready', gate, at: ready.readyAt });
  await saveReport();
  console.log(JSON.stringify({ checkpoint: 'restart_ready', gate, runId, readyFile: path.join(gate, 'ready.json'), maxWaitMs: timeout }));
  const deadline = Date.now() + timeout;
  let lastParseError = null;
  while (Date.now() < deadline) {
    let metadata;
    try { metadata = await readJsonFile(path.join(gate, 'restarted.json')); }
    catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      if (error instanceof SyntaxError) lastParseError = error.message;
      await delay(Math.min(250, Math.max(1, deadline - Date.now())));
      continue;
    }
    assert.ok(metadata && typeof metadata === 'object' && !Array.isArray(metadata), 'Restart metadata is an object');
    assert.ok(Number.isInteger(metadata.oldPid) && metadata.oldPid > 0, 'Restart metadata contains a positive oldPid');
    assert.ok(Number.isInteger(metadata.newPid) && metadata.newPid > 0, 'Restart metadata contains a positive newPid');
    assert.notEqual(metadata.newPid, metadata.oldPid, 'A different real backend process must be started');
    assert.ok(typeof metadata.restartedAt === 'string' && Number.isFinite(Date.parse(metadata.restartedAt)),
      'Restart metadata contains restartedAt');
    assert.ok(Date.parse(metadata.restartedAt) >= Date.parse(ready.readyAt) - 1000,
      'Restart was performed after this run reached its gate');
    assert.ok(Date.parse(metadata.restartedAt) <= Date.now() + 1000, 'Restart timestamp is not in the future');
    if (metadata.runId !== undefined) assert.equal(metadata.runId, runId, 'Restart metadata belongs to this run');
    report.backendRestart = { ...metadata, acknowledgedAt: new Date().toISOString(), gate };
    report.checkpoints.push({ checkpoint: 'restart_acknowledged', at: report.backendRestart.acknowledgedAt, gate });
    console.log(JSON.stringify({ checkpoint: 'restart_acknowledged', oldPid: metadata.oldPid, newPid: metadata.newPid }));
    return report.backendRestart;
  }
  throw new Error('External backend restart gate expired after ' + timeout + ' ms'
    + (lastParseError ? '; last JSON parse error: ' + lastParseError : ''));
}

async function main() {
  await fs.mkdir(output, { recursive: true });
  await saveReport();
  await check('environment_and_gate', async () => {
    gate = await validateGate({ empty: true });
    report.gate = gate;
    const { chromium } = require(process.env.CAPTCHAVATYE_PLAYWRIGHT_MODULE || 'playwright');
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    report.browser = browser.version();
    context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR', serviceWorkers: 'block' });
    await installObservation();
    original = await context.newPage();
    labelPage(original, 'community-original');
    await original.goto(origin);
    await points(original, 0);
    return { gate, browser: report.browser, isolatedContext: true, personalProfileUsed: false };
  }, { required: true });

  await check('first_full_demo', async () => {
    firstDemo = await fullDemo(original, 'before');
    oldChild = firstDemo.child;
    report.oldIds = { ...firstDemo.ids };
    return demoDetail(firstDemo);
  }, { required: true, screenshotPage: () => original });

  await check('preserve_old_tabs_and_payload', async () => {
    const accepted = events(firstDemo.ids.clickId).find(entry => entry.body.eventName === 'cta_shown'
      && entry.status === 201 && entry.response?.accepted === true);
    assert.ok(accepted, 'An existing accepted client event is available for exact replay');
    acceptedEvent = {
      eventId: accepted.body.eventId, eventName: accepted.body.eventName,
      body: accepted.body, rawPayload: accepted.rawBody,
      acceptedStatus: accepted.status, acceptedResponse: accepted.response, requestId: accepted.id,
    };
    report.acceptedEvent = acceptedEvent;
    const beforeUrl = oldChild.url();
    await oldChild.reload();
    await locationSelect(oldChild).waitFor();
    assert.equal(oldChild.url(), beforeUrl, 'The old application URL is retained exactly');
    assert.equal(new URL(oldChild.url()).searchParams.get('clickId'), firstDemo.ids.clickId);
    assert.equal(await locationSelect(oldChild).inputValue(), '');
    assert.equal(await slotSelect(oldChild).inputValue(), '');
    assert.equal(await oldChild.locator('.drive-success').count(), 0);
    const allEvents = await successfulEvents(firstDemo.ids.clickId, 4);
    assert.equal(allEvents.filter(entry => entry.body.eventName === 'landing_viewed').length, 2);
    report.oldIds.eventIds = allEvents.map(entry => entry.body.eventId);
    pending = await context.newPage();
    labelPage(pending, 'community-pending-across-restart');
    await pending.goto(origin);
    const draft = { title: '재시작을 건너 유지한 미완료 인증', body: '서버가 재시작된 후 같은 화면에서 실제 드래그를 합니다.' };
    const challenge = await startChallenge(pending, draft);
    report.oldPendingChallengeId = challenge.response.challengeId;
    assert.notEqual(report.oldPendingChallengeId, firstDemo.ids.challengeId);
    assert.equal(calls('/api/verify', pending).length, 0, 'Pending challenge has never been verified');
    assert.equal((await communityState(pending)).points, '0P');
    assert.deepEqual((await communityState(pending)).draft, draft);
    await drainResponses();
    assert.ok(report.requests.every(entry => entry.status !== undefined && entry.response !== undefined),
      'All pre-restart requests are settled before the server is stopped');
    assert.equal(context.pages().length, 3, 'Original, old application, and pending challenge tabs remain open');
    return {
      oldChild: await childState(oldChild), original: await communityState(original), pending: await communityState(pending),
      oldPendingChallengeId: report.oldPendingChallengeId, acceptedEvent,
    };
  }, { required: true });

  await check('external_backend_restart', waitForExternalRestart, { required: true });

  await check('pending_challenge_rejected', async () => {
    const before = report.requests.length;
    const pointer = await drag(pending);
    const rejected = await oneResponse('/api/verify', pending, before, 404);
    assert.equal(rejected.body.challengeId, report.oldPendingChallengeId, 'Physical drag submits the preserved old challenge ID');
    const detail = actual404(rejected, 'CHALLENGE_NOT_FOUND');
    await stage(pending, 'error');
    await capture(pending, 'restart-verification-error.png');
    const description = pending.locator('#captcha-description');
    await description.waitFor({ state: 'visible' });
    assert.equal((await description.textContent()).trim(), detail.message, 'Visible SDK error comes from the actual backend response');
    assert.equal(await pending.getByRole('button', { name: '다시 시도', exact: true }).count(), 0);
    await pending.locator('dialog .preview-controls button').waitFor({ state: 'visible' });
    assert.equal(await pending.locator('dialog .preview-controls button').isEnabled(), true);
    assert.equal(await pending.locator('a.brand-cta').count(), 0);
    await points(pending, 0);
    assert.equal(await pending.locator('.community-post').count(), 0);
    await delay(2300);
    assert.equal(calls('/api/verify', pending, before).length, 1, 'Terminal 404 is not retried');
    assert.equal(calls('/api/challenges', pending, before).length, 0, 'Failure does not silently replace the stale challenge');
    await assertPointsHistory(pending, ['0P']);
    return { requestId: rejected.id, pointer, error: detail, ui: await communityState(pending), noRetryObservedMs: 2300 };
  }, { screenshotPage: () => pending, screenshotName: 'restart-verification-error.png' });

  await check('old_application_link_rejected', async () => {
    assert.equal(new URL(oldChild.url()).searchParams.get('clickId'), firstDemo.ids.clickId);
    assert.equal(await locationSelect(oldChild).inputValue(), '');
    assert.equal(await slotSelect(oldChild).inputValue(), '');
    await choose(oldChild);
    const before = report.requests.length;
    await submitButton(oldChild).click();
    const rejected = await oneResponse(applicationPath, oldChild, before, 404);
    assert.equal(rejected.body.clickId, firstDemo.ids.clickId);
    const detail = actual404(rejected, 'CLICK_NOT_FOUND');
    await oldChild.getByRole('alert').waitFor({ state: 'visible' });
    const recovery = oldChild.locator('a.drive-link[href="/"]');
    await recovery.waitFor({ state: 'visible' });
    await capture(oldChild, 'restart-application-error.png');
    assert.equal((await oldChild.getByRole('alert').textContent()).trim(), detail.message);
    assert.equal(await oldChild.locator('.drive-success').count(), 0);
    assert.equal(await oldChild.locator('[data-lead-id]').count(), 0);
    assert.equal(await locationSelect(oldChild).isDisabled(), true);
    assert.equal(await slotSelect(oldChild).isDisabled(), true);
    assert.equal(await submitButton(oldChild).isDisabled(), true);
    assert.equal(await oldChild.getByRole('button', { name: '같은 내용으로 다시 시도', exact: true }).count(), 0);
    await delay(2300);
    assert.equal(calls(applicationPath, oldChild, before).length, 1, 'Terminal old-link failure is not retried');
    assert.equal((await communityState(original)).points, '10P', 'Backend restart alone does not mutate an open host page');
    assert.equal((await communityState(original)).posts.length, 1);
    return { requestId: rejected.id, error: detail, recoveryHref: await recovery.getAttribute('href'), ui: await childState(oldChild) };
  }, { screenshotPage: () => oldChild, screenshotName: 'restart-application-error.png' });

  await check('old_accepted_event_replay_rejected', async () => {
    const replay = await replayRaw('/api/events', acceptedEvent.rawPayload);
    assert.equal(replay.rawBody, acceptedEvent.rawPayload);
    assert.deepEqual(replay.body, acceptedEvent.body, 'Replay preserves every field and the original event ID');
    const detail = actual404(replay, 'CLICK_NOT_FOUND');
    return { requestId: replay.id, originalRequestId: acceptedEvent.requestId, originalEventId: acceptedEvent.eventId, error: detail };
  });

  await check('old_completed_challenge_rejected', async () => {
    const replay = await replayRaw('/api/verify', firstDemo.verifyRawPayload);
    assert.equal(replay.rawBody, firstDemo.verifyRawPayload);
    assert.equal(replay.body.challengeId, firstDemo.ids.challengeId);
    const detail = actual404(replay, 'CHALLENGE_NOT_FOUND');
    return { requestId: replay.id, originalRequestId: firstDemo.verifyRequestId, error: detail };
  });

  await check('community_reload_resets_client', async () => {
    const before = await communityState(original);
    assert.equal(before.points, '10P');
    assert.equal(before.posts.length, 1);
    const requestStart = report.requests.length;
    await original.reload();
    await points(original, 0);
    await original.getByLabel('제목', { exact: true }).waitFor();
    const reset = await communityState(original);
    assert.deepEqual(reset.draft, { title: '', body: '' });
    assert.deepEqual(reset.posts, []);
    assert.equal(reset.points, '0P');
    assert.equal(reset.dialogOpen, false);
    assert.equal(report.requests.slice(requestStart).filter(entry => entry.page === pageIds.get(original)).length, 0,
      'Clean community reload does not revive old IDs through a background API call');
    await assertPointsHistory(original, ['0P']);
    return { before, after: reset };
  }, { required: true, screenshotPage: () => original });

  await check('second_full_demo_with_new_ids', async () => {
    secondDemo = await fullDemo(original, 'after');
    newChild = secondDemo.child;
    report.newIds = { ...secondDemo.ids };
    for (const field of ['challengeId', 'completionId', 'clickId', 'leadId']) {
      assert.notEqual(secondDemo.ids[field], firstDemo.ids[field], field + ' is newly allocated after restart');
    }
    assert.notEqual(secondDemo.ids.challengeId, report.oldPendingChallengeId);
    for (const eventId of secondDemo.ids.eventIds) assert.ok(!report.oldIds.eventIds.includes(eventId), 'New client event IDs are distinct');
    await capture(original, 'replay-completed.png');
    await capture(newChild, 'replay-application-completed.png');
    return demoDetail(secondDemo);
  }, { required: true, screenshotPage: () => original });

  await check('request_and_ui_invariants', async () => {
    await drainResponses();
    const fields = {
      '/api/challenges': ['creativeId'],
      '/api/verify': ['challengeId', 'dropX', 'dropY'],
      '/api/events': ['clickId', 'eventId', 'eventName', 'occurredAt'],
      '/api/demo/test-drives': ['clickId', 'locationId', 'slotId'],
    };
    for (const request of report.requests) {
      assert.equal(new URL(request.url).origin, origin);
      assert.ok(fields[request.path], 'Only the four planned business APIs are used');
      assert.equal(request.method, 'POST');
      assert.deepEqual(Object.keys(request.body).sort(), fields[request.path]);
      assert.deepEqual(JSON.parse(request.rawBody), request.body);
      assert.equal(request.failure, undefined, 'No transport failure is hidden by the restart test');
      assert.equal(request.responseReadError, undefined);
      assert.ok(Number.isInteger(request.status));
      if (request.source === 'browser') assert.equal(request.routeAction, 'continue');
      if (request.path === '/api/events') {
        assert.ok(['cta_shown', 'cta_clicked', 'landing_viewed'].includes(request.body.eventName));
        assert.ok(typeof request.body.eventId === 'string' && request.body.eventId.length > 0);
        assert.ok(Number.isFinite(Date.parse(request.body.occurredAt)));
      }
    }
    const browserCalls = pathname => calls(pathname).filter(entry => entry.source === 'browser');
    assert.deepEqual(browserCalls('/api/challenges').map(entry => entry.status), [201, 201, 201]);
    assert.deepEqual(browserCalls('/api/verify').map(entry => entry.status), [200, 404, 200]);
    assert.deepEqual(browserCalls(applicationPath).map(entry => entry.status), [201, 404, 201]);
    assert.deepEqual(browserCalls('/api/events').map(entry => entry.status), Array(7).fill(201));
    assert.deepEqual(report.requests.filter(entry => entry.source === 'api-replay').map(entry => [entry.path, entry.status]),
      [['/api/events', 404], ['/api/verify', 404]]);
    assert.equal(report.pageErrors.length, 0, 'There are no unhandled browser page errors; expected HTTP 404 console messages are separate');
    const finalCommunity = await communityState(original);
    assert.equal(finalCommunity.points, '10P');
    assert.equal(finalCommunity.posts.length, 1);
    await assertPointsHistory(original, ['0P', '10P']);
    await assertPointsHistory(pending, ['0P']);
    return {
      finalCommunity, finalApplication: await childState(newChild),
      browserRequestCount: report.requests.filter(entry => entry.source === 'browser').length,
      exactApiReplays: 2, fullSuccessfulDemos: 2,
      expected404ConsoleMessages: report.consoleErrors.filter(entry => entry.expectedHttp404).length,
      pageErrors: report.pageErrors.length,
    };
  }, { screenshotPage: () => original });
}

async function run() {
  try { await main(); }
  catch (error) {
    fatalError = error;
    report.fatalError = message(error);
    console.error(error.stack || error.message);
  } finally {
    try { await drainResponses(); }
    catch (error) { report.cleanupErrors.push(message(error)); }
    if (context) {
      try { await context.close(); }
      catch (error) { report.cleanupErrors.push(message(error)); }
    }
    if (browser) {
      try { await browser.close(); }
      catch (error) { report.cleanupErrors.push(message(error)); }
    }
    report.finishedAt = new Date().toISOString();
    report.elapsedMs = Date.parse(report.finishedAt) - Date.parse(startedAt);
    const failed = !!fatalError || report.phaseChecks.some(item => item.status !== 'passed')
      || report.pageErrors.length > 0 || report.cleanupErrors.length > 0;
    report.status = failed ? 'failed' : 'passed';
    if (failed) process.exitCode = 1;
    try { await saveReport(); }
    catch (error) {
      console.error('Could not save restart-results.json: ' + error.message);
      process.exitCode = 1;
    }
    console.log(JSON.stringify({
      checkpoint: 'restart_finished', status: report.status, passed: report.passed, failed: report.failed,
      notRun: report.notRun, result: resultPath, pageErrors: report.pageErrors.length,
    }));
  }
}

if (process.argv.includes('--read-ready')) {
  (async () => {
    const readyGate = await validateGate({ empty: false });
    const value = await readJsonFile(path.join(readyGate, 'ready.json'));
    assert.equal(value.checkpoint, 'restart_ready');
    assert.equal(value.gate, readyGate);
    console.log(JSON.stringify(value, null, 2));
  })().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
} else {
  void run();
}
