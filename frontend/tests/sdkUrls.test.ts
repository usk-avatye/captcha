import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createCaptchaApi, ApiError } from '../../packages/react/src/api.ts';
import { creative } from './fixtures.ts';

let supplied = { ...creative };
const server = createServer((_request, response) => {
  response.writeHead(201, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ challengeId: 'ch_package', creative: supplied }));
});
let base = '';
before(async () => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
});
after(() => new Promise<void>(resolve => server.close(() => resolve())));
const bases = { assetBaseUrl: 'https://assets.example.test/', landingBaseUrl: 'https://ads.example.test/' };

test('소재와 랜딩은 고객사 origin이 아닌 각각의 설정 주소로 해석한다', async () => {
  supplied = { ...creative };
  const result = await createCaptchaApi(base, bases).start(creative.creativeId, new AbortController().signal);
  assert.equal(result.creative.imageUrl, 'https://assets.example.test/creatives/bmw-m3/vehicle.webp');
  assert.equal(result.creative.pieceUrl, 'https://assets.example.test/creatives/bmw-m3/lamp.png');
  assert.equal(result.creative.coverUrl, 'https://assets.example.test/creatives/bmw-m3/socket-cover.png');
  assert.equal(result.creative.landingPath, 'https://ads.example.test/demo/test-drive');
  assert.deepEqual(result.creative.lampRect, creative.lampRect);
});

test('상대 경로와 절대 CDN URL은 표준 URL 규칙을 유지한다', async () => {
  supplied = { ...creative, imageUrl: 'vehicle.webp', pieceUrl: 'https://cdn.example.test/lamp.png', landingPath: 'apply?campaign=m3#form' };
  const result = await createCaptchaApi(base, { assetBaseUrl: 'https://assets.example.test/bmw/', landingBaseUrl: 'https://ads.example.test/demo/' }).start(creative.creativeId, new AbortController().signal);
  assert.equal(result.creative.imageUrl, 'https://assets.example.test/bmw/vehicle.webp');
  assert.equal(result.creative.pieceUrl, supplied.pieceUrl);
  assert.equal(result.creative.landingPath, 'https://ads.example.test/demo/apply?campaign=m3#form');
});

test('HTTP(S)가 아닌 소재·CTA 및 자격증명 URL은 복구 불가능한 설정 오류다', async () => {
  for (const [field, value] of [['imageUrl', 'javascript:alert(1)'], ['pieceUrl', 'data:image/png;base64,AA'], ['coverUrl', 'file:///tmp/image'], ['landingPath', 'javascript:alert(1)'], ['landingPath', 'https://name:secret@ads.example.test/apply']]) {
    supplied = { ...creative, [field]: value };
    await assert.rejects(() => createCaptchaApi(base, bases).start(creative.creativeId, new AbortController().signal),
      error => error instanceof ApiError && error.code === 'CREATIVE_URL' && !error.retryable, field);
  }
});

test('잘못된 base 설정은 위치 검증이나 이미지 준비로 넘기지 않는다', async () => {
  supplied = { ...creative };
  await assert.rejects(() => createCaptchaApi(base, { ...bases, assetBaseUrl: 'not a URL' }).start(creative.creativeId, new AbortController().signal),
    error => error instanceof ApiError && error.code === 'CREATIVE_URL' && !error.retryable);
});
