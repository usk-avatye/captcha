# @captchavatye/react

React 앱에 CAPTCHAvatye 인증 모달을 연결하는 로컬 PoC 패키지다. 현재 npm 레지스트리에 공개하지 않았다. `private: true`이며 패키지 이름·scope의 공개 사용 권한과 라이선스는 별도 결정 사항이다.

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

소비 앱에 React와 React DOM 19가 있어야 한다. 패키지는 두 라이브러리를 번들에 포함하지 않는다. 이 버전은 React 19.3.1 + Vite + TypeScript에서 검증한다. 브라우저 렌더링용이며 SSR·React Native·비React 앱은 지원 대상으로 검증하지 않았다.

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

`saveCompletion(result: CompletionResult)`은 완료 결과를 호스트에 보관하는 콜백이다. `continueOriginalTask()`는 별도로 원래 작업을 진행한다. 서버에서 완료 결과를 확인하는 기능은 아직 없으므로 **이 콜백만으로 실제 예약·포인트 지급을 승인하면 안 된다.** 동작 가능한 UI 연결 예시는 저장소의 `examples/react-consumer`에 있다.

## 입력과 수명

| 입력 | 의미 |
| --- | --- |
| `open` | 모달 표시 여부. 같은 시도에서는 컴포넌트를 유지하고 이 값만 바꾼다. |
| `creativeId` | 서버 소재 ID. 현재 서버는 `bmw-m3-v1` 한 개를 지원한다. |
| `apiBaseUrl` | 시작·검증·이벤트 API 접두사. 기본 `/api`. 고객사의 예약 API와 분리한다. |
| `assetBaseUrl` | 서버가 주는 이미지 URL의 기준 절대 HTTP(S) 주소. 기본 현재 origin. |
| `landingBaseUrl` | 서버가 주는 랜딩 URL의 기준 절대 HTTP(S) 주소. 기본 현재 origin. |
| `continueLabel` | 완료 화면의 업무 재개 버튼. 기본 `원래 작업 계속하기`. |
| `onComplete(result)` | 열린 모달에서 성공 연출이 끝나면 `challengeId`, `completionId`, `creativeId`, `clickId`를 한 번 전달한다. |
| `onContinue()` | 완료 화면의 계속하기 선택. 실제 업무와 중복 방지는 고객사 책임이다. |
| `onClose()` | 호스트가 `open=false`로 바꾼다. 초안과 SDK 컴포넌트를 제거하지 않는다. |

소재와 접속 주소는 한 인증 시도 동안 고정한다. 새 시도는 호스트의 React `key`를 바꿔 생성한다. 이미 완료한 시도를 닫고 다시 열면 결과를 유지하고 `onComplete`를 재호출하지 않는다. SDK는 포인트를 표시·지급하지 않는다.

URL은 `new URL(value, base)` 규칙을 따른다. `/creatives/...`처럼 `/`로 시작하면 base의 경로를 대체한다. 절대 이미지/랜딩 URL은 그대로 사용한다. HTTP(S) 이외의 프로토콜과 자격증명을 포함한 URL은 거절한다. API 설정과 콘텐츠 주소는 개발자가 관리하는 신뢰할 수 있는 주소여야 한다.

## 로컬 접속 구성

SDK는 브라우저 코드이고 FastAPI 서버·이미지·랜딩 페이지를 설치하지 않는다. 현재 개발 서버는 데모/소재/랜딩 `5173`, 인증 API `8000`이다.

소비 앱의 Vite 설정 예:

```ts
server: {
  proxy: {
    '/captcha-api': {
      target: 'http://127.0.0.1:8000',
      rewrite: path => path.replace(/^\/captcha-api/, '/api'),
    },
  },
}
```

위 예에서는 인증 API만 프록시로 전달하고 이미지·새 탭 랜딩은 `assetBaseUrl`/`landingBaseUrl`의 서비스에 직접 접근한다. API를 다른 origin으로 직접 호출하려면 서버의 허용 origin 설정이 별도로 필요하다. 이 작업에서 인증 서버의 CORS 정책을 바꾸지는 않았다.

## 별도 랜딩 페이지의 이벤트

```ts
import { createEventTracker } from '@captchavatye/react';
const track = createEventTracker('/captcha-api');
void track('landing_viewed', clickId);
```

이는 관측 이벤트 전송 도우미다. 전송 성공은 인증이나 실제 신청 완료를 뜻하지 않는다. 같은 호출의 제한적 재시도는 최초 이벤트 ID를 유지한다.

## 현재 한계

실제 봇 탐지, 고객사 서버용 인증 결과 확인, PostgreSQL 영속 저장은 구현하지 않았다. 현재 서버 기록은 메모리이며 재시작하면 사라진다. BMW 이미지·래스터 crop은 기존 단일 소재 PoC 기준을 유지한다. 범용 광고 소재 관리나 공개 운영용 보안 제품으로 설명하지 않는다.

## 참고

- https://vite.dev/guide/build#library-mode
- https://docs.npmjs.com/cli/v11/commands/npm-pack/
- https://docs.npmjs.com/cli/v11/commands/npm-install/
