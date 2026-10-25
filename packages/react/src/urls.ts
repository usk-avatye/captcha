import type { Creative } from './types.ts';

export type CreativeUrlBases = { assetBaseUrl: string; landingBaseUrl: string };

function httpUrl(value: string, base?: string): URL {
  const url = new URL(value, base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new TypeError('HTTP(S) 주소만 사용할 수 있습니다.');
  }
  return url;
}

export function resolveCreativeUrls(creative: Creative, bases: CreativeUrlBases): Creative {
  // 상대 경로는 지정한 서비스 주소에서 해석한다. 고객사 라우트에 의존하지 않는다.
  const assets = httpUrl(bases.assetBaseUrl).href;
  const landing = httpUrl(bases.landingBaseUrl).href;
  return {
    ...creative,
    imageUrl: httpUrl(creative.imageUrl, assets).href,
    coverUrl: httpUrl(creative.coverUrl, assets).href,
    pieceUrl: httpUrl(creative.pieceUrl, assets).href,
    landingPath: httpUrl(creative.landingPath, landing).href,
  };
}

export function createCtaHref(landingUrl: string, clickId: string): string | null {
  try {
    const url = httpUrl(landingUrl);
    url.searchParams.set('clickId', clickId);
    return url.href;
  } catch {
    return null;
  }
}
