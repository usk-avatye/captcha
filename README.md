# CAPTCHAvatye

드래그 퍼즐 기반 인증을 React 앱에 연결하는 SDK와 인증 서버입니다. SDK는 인증 결과를 전달하고, 예약이나 보상 처리는 고객사 앱과 서버가 담당합니다.

## 실행

Git과 Docker Desktop이 필요합니다. Docker Desktop을 실행한 뒤 두 저장소를 나란히 clone합니다.

```bash
mkdir -p ~/dev/captchavatye-demo
cd ~/dev/captchavatye-demo

git clone --branch feat/captchavatye-demo --single-branch https://github.com/usk-avatye/captcha.git final_mission
git clone --branch feat/captchavatye-demo --single-branch https://github.com/kimheejun-avatye/Internship-finalproject.git

cd final_mission
bash demo/start.command
```

처음 실행할 때 이미지를 내려받고 DB와 계정을 준비합니다.

- 예약 화면: [http://127.0.0.1:55175](http://127.0.0.1:55175)
- 아이디: `qa-member1@example.com`
- 비밀번호: `Qa12345!`

예약 내용을 입력하고 **예약하기 → 퍼즐 인증 → 예약 계속하기** 순서로 진행합니다. 시승 신청은 선택 사항입니다.

```bash
bash demo/stop.command      # 종료, DB 데이터 유지
bash demo/prepare.command   # 코드 변경 후 이미지 재빌드
```

포트와 환경변수는 [실행 안내](demo/README.md)를 참고하세요.

## SDK 사용

```tsx
import { CaptchaModal } from '@captchavatye/react';
import '@captchavatye/react/style.css';
```

설치 방법과 컴포넌트 입력은 [React SDK 문서](packages/react/README.md)에 있습니다. 고객사 백엔드는 인증 결과를 서버 간 API로 확인한 뒤 업무를 처리합니다.

## 구성

| 경로 | 내용 |
| --- | --- |
| `packages/react` | React 인증 모달과 완료 콜백 |
| `backend` | 인증 API, 서버 간 확인, PostgreSQL 저장 |
| `frontend` | 커뮤니티 예제, 광고 소재와 시승 화면 |
| `demo` | 회의실 예약 서비스와 함께 실행하는 Docker 구성 |
