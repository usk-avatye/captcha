# CAPTCHAvatye

드래그 퍼즐 기반의 캡챠형 광고를 React 앱에 연결하는 SDK입니다.

## 설치

React와 React DOM 19가 필요합니다. SDK 저장소에서 Node.js 24로 설치 파일을 만듭니다.

```bash
npm ci
npm run pack:sdk
```

생성된 `artifacts/captchavatye-react-0.1.0.tgz`를 고객사 앱에 설치합니다.

```bash
npm install /absolute/path/to/captchavatye-react-0.1.0.tgz
```

## 연결

```tsx
import { CaptchaModal } from '@captchavatye/react';
import '@captchavatye/react/style.css';

<CaptchaModal
  open={open}
  creativeId="bmw-m3-v1"
  apiBaseUrl="/captcha-api"
  onComplete={handleComplete}
  onContinue={handleContinue}
  onClose={handleClose}
/>
```

`onComplete`에서 인증 완료 결과를 받고, `onContinue`에서 원래 작업을 재개합니다. 고객사 서버는 완료 결과를 검증한 뒤 업무를 처리합니다.

컴포넌트 설정, 콜백과 상호작용 계측은 [React SDK 문서](packages/react/README.md)를 참고하세요. 인증 서버 실행과 API는 [백엔드 문서](backend/README.md)에 있습니다.
