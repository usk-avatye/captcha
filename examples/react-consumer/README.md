# 독립 설치 예시

인증 UI를 연결하는 예시이며 실제 회의실 예약 서비스가 아니다. SDK 소스나 데모 CSS를 가져오지 않고 `.tgz`만 설치한다.

루트에서 `npm ci && npm run pack:sdk`를 실행한 뒤:

```sh
cd examples/react-consumer
npm install
npm run build
npm run dev
```

`http://127.0.0.1:5190/`에서 확인한다. 기존 인증 API(8001)와 소재, 랜딩 데모(5173)가 필요하다. 샘플의 고정 주소는 서비스가 배포되면 해당 주소로 바꾼다. CSS가 고객사 스타일에 영향을 주는지 확인하기 위해 일반 `button`, `h2`, `.primary-button` 스타일을 의도적으로 넣었다.

`onComplete`는 UI 완료 결과만 보관한다. `onContinue`도 처리 횟수만 표시하며 예약이나 실제 보상을 생성하지 않는다. 실제 업무 연동은 고객사 서버의 완료 결과 검증을 추가한 다음 수행한다.
