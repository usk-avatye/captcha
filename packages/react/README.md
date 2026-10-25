# @captchavatye/react

React 앱에 CAPTCHAvatye 인증 모달을 연결합니다. SDK는 인증 결과를 전달하고, 실제 업무 처리는 고객사 앱과 서버가 담당합니다.

## 설치

SDK 저장소에서 설치 파일을 만든다.

```sh
npm ci
npm run pack:sdk
```

소비 앱에서는 생성된 파일을 설치한다. 아래 경로는 해당 Mac의 실제 파일 경로로 바꾼다.

```sh
npm install /absolute/path/to/captchavatye-react-0.1.0.tgz
```

React와 React DOM 19가 필요합니다. 두 라이브러리는 번들에 포함하지 않습니다. 브라우저에서 사용하는 React 앱을 대상으로 합니다.

## 가져오기

```tsx
import { CaptchaModal } from '@captchavatye/react';
import type { CompletionResult } from '@captchavatye/react';
import '@captchavatye/react/style.css';
```

CSS import는 앱 진입점에서 한 번 수행한다. SDK가 고객사 사이트의 전역 CSS를 요구하지 않으며 SDK 클래스와 애니메이션은 `cv-` 접두사를 사용한다.

## 연결 예

```tsx
<CaptchaModal
  open={captchaOpen}
  creativeId="bmw-m3-v1"
  apiBaseUrl="/captcha-api"
  assetBaseUrl="http://127.0.0.1:5173/"
  landingBaseUrl="http://127.0.0.1:5173/"
  continueLabel="예약 계속하기"
  onComplete={saveCompletion}
  onContinue={continueOriginalTask}
  onClose={() => setCaptchaOpen(false)}
/>
```

`saveCompletion(result: CompletionResult)`은 인증 결과를 보관하고, `continueOriginalTask()`는 원래 작업을 진행합니다. 고객사 백엔드는 서버 간 확인 API로 인증 결과를 검증한 뒤 예약이나 보상을 처리해야 합니다.

## 입력과 수명

| 입력 | 의미 |
| --- | --- |
| `open` | 모달 표시 여부. 같은 시도에서는 컴포넌트를 유지하고 이 값만 바꾼다. |
| `creativeId` | 서버 소재 ID. 현재 서버는 `bmw-m3-v1`을 지원합니다. |
| `challenge` | 고객사 서버가 발급한 `{challengeId, creative}`. 생략하면 SDK가 시작 API를 호출합니다. |
| `apiBaseUrl` | 시작, 검증, 이벤트와 상호작용 요약 API 접두사. 기본 `/api`. 고객사의 예약 API와 분리한다. |
| `assetBaseUrl` | 서버가 주는 이미지 URL의 기준 절대 HTTP(S) 주소. 기본 현재 origin. |
| `landingBaseUrl` | 서버가 주는 랜딩 URL의 기준 절대 HTTP(S) 주소. 기본 현재 origin. |
| `continueLabel` | 완료 화면의 업무 재개 버튼. 기본 `원래 작업 계속하기`. |
| `telemetry` | `{enabled?: boolean, pathSampleRate?: number}`. 기본 수집 활성화, 경로 표본 0.01. 한 인증 동안 고정한다. |
| `onComplete(result)` | 열린 모달에서 성공 연출이 끝나면 `challengeId`, `completionId`, `creativeId`, `clickId`를 한 번 전달한다. |
| `onContinue()` | 완료 화면의 계속하기 선택. 실제 업무와 중복 방지는 고객사 책임이다. |
| `onClose()` | 호스트가 `open=false`로 바꾼다. 초안과 SDK 컴포넌트를 제거하지 않는다. |

소재와 접속 주소는 한 인증 시도 동안 고정한다. 새 시도는 호스트의 React `key`를 바꿔 생성한다. 이미 완료한 시도를 닫고 다시 열면 결과를 유지하고 `onComplete`를 재호출하지 않는다. 포인트 표시와 지급은 소비 앱에서 처리한다.

## 상호작용 요약

첫 램프 조작 시간, 성공 응답까지의 풀이 시간과 서버 위치 불일치 횟수를 인증 ID에 연결해 수집한다. 이미지를 준비한 뒤 모달이 열려 있고 문서가 보이는 동안 시간을 누적한다. 숨김과 닫힘 시간은 제외한다. 미측정 시간은 `null`이다.

경로는 인증별 확률로 선택하며 기본 비율은 1%다. 램프 드래그의 시작과 끝, 100ms 간격의 이동을 퍼즐 영역 기준 좌표로 기록한다. 최대 100점을 저장하고 상한 이후에는 마지막 점을 갱신한다. `path=null`은 표본 미선택, `path=[]`는 선택됐지만 드래그가 없는 상태다.

성공, 닫기, 탭 숨김과 페이지 종료 시 `/interaction-summaries`로 고정 스냅샷을 전송한다. 인증별 revision이 증가하며 재시도는 같은 본문을 사용한다. 서버는 최신 revision 한 행을 유지한다. `telemetry={{enabled: false}}`로 요약 수집을 끌 수 있다. 시연에서 모든 경로를 확인하려면 `telemetry={{pathSampleRate: 1}}`로 설정한다.

URL은 `new URL(value, base)` 규칙을 따른다. `/creatives/...`처럼 `/`로 시작하면 base의 경로를 대체한다. 절대 이미지/랜딩 URL은 그대로 사용한다. HTTP(S) 이외의 프로토콜과 자격증명을 포함한 URL은 거절한다. API 설정과 콘텐츠 주소는 개발자가 관리하는 신뢰할 수 있는 주소여야 한다.

## 로컬 접속 구성

SDK는 브라우저 코드이고 FastAPI 서버, 이미지, 랜딩 페이지를 설치하지 않는다. 현재 개발 서버는 데모/소재/랜딩 `5173`, 인증 API `8001`이다.

소비 앱의 Vite 설정 예:

```ts
server: {
  proxy: {
    '/captcha-api': {
      target: 'http://127.0.0.1:8001',
      rewrite: path => path.replace(/^\/captcha-api/, '/api'),
    },
  },
}
```

인증 API는 프록시를 통해 호출하고, 이미지와 랜딩 페이지는 `assetBaseUrl` 및 `landingBaseUrl` 주소에서 제공합니다. 다른 origin의 API를 직접 호출하려면 서버에서 CORS를 설정해야 합니다.

## 별도 랜딩 페이지의 이벤트

```ts
import { createEventTracker } from '@captchavatye/react';
const track = createEventTracker('/captcha-api');
void track('landing_viewed', clickId);
```

이는 관측 이벤트 전송 도우미다. 전송 성공은 인증이나 실제 신청 완료를 뜻하지 않는다. 같은 호출의 제한적 재시도는 최초 이벤트 ID를 유지한다.

## 지원 범위

현재 퍼즐은 `bmw-m3-v1` 소재를 사용합니다. 인증 서버는 결과를 PostgreSQL에 저장하며 서버 간 확인 API를 제공합니다. 실제 봇 탐지 기능은 포함하지 않습니다.

## 참고

- https://vite.dev/guide/build#library-mode
- https://docs.npmjs.com/cli/v11/commands/npm-pack/
- https://docs.npmjs.com/cli/v11/commands/npm-install/

## 고객사 서버가 발급한 인증

`challenge?: ChallengeResponse`에 고객사 백엔드가 비공개 발급 API로 받은 `{challengeId, creative}`를 전달하면 SDK는 공개 시작 API를 호출하지 않고 해당 퍼즐을 표시한다. `creativeId`는 발급 소재와 같아야 한다. 인증 시도가 바뀔 때 `key={intent_id}`로 새 모달을 만든다. 기존 `onComplete`와 `onContinue` 계약은 유지한다. 브라우저 콜백은 서버 검증을 대체하지 않으며, 공유 비밀키는 고객사 백엔드에만 둔다.
