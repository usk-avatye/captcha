# CAPTCHAvatye

리어램프 조각을 맞추는 드래그 퍼즐에 광고를 결합한 React SDK입니다. SDK는 인증 화면과 완료 결과를 제공하고, 고객사 앱과 서버가 포인트 적립이나 예약 저장을 처리합니다. 인증 결과, 광고 이벤트와 상호작용 요약은 인증 서버의 PostgreSQL에 저장합니다.

## 시연 화면

| 화면 | 주소 | 확인할 동작 |
| --- | --- | --- |
| 포인트 샘플 | [http://127.0.0.1:55173](http://127.0.0.1:55173) | 글쓰기에서 퍼즐을 완료하면 모의 10P 적립 |
| 회의실 예약 | [http://127.0.0.1:55175](http://127.0.0.1:55175) | 기존 예약 서비스에서 SDK 인증 후 예약 저장 |

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

처음 실행할 때 Docker 이미지를 빌드하고 DB와 계정을 준비합니다. 이미 clone한 맥북에서는 아래 명령으로 다시 시작합니다.

```bash
cd ~/dev/captchavatye-demo/final_mission
bash demo/start.command
```

### 포인트 샘플

1. 포인트 샘플 화면에서 제목과 본문을 입력하고 **등록**을 누릅니다.
2. 램프 조각을 빈칸에 맞추면 모의 포인트가 **10P** 증가합니다.
3. **원래 작업 계속하기**를 누르면 글이 목록에 추가됩니다.

샘플의 포인트와 글 목록은 페이지를 새로고침하면 초기화됩니다. 인증 기록과 상호작용 요약은 DB에 유지됩니다.

### 회의실 예약

예약 화면에 아래 계정으로 로그인합니다.

- 아이디: `qa-member1@example.com`
- 비밀번호: `Qa12345!`

예약 내용을 입력하고 **예약하기 → 퍼즐 맞추기 → 예약 계속하기**를 진행합니다. 고객사 서버가 인증 결과를 확인한 뒤 예약을 저장합니다.

두 화면의 **시승 신청** 버튼은 [BMW 공식 시승 페이지](https://www.bmw.co.kr/ko/fastlane/tda-experience.html?agCode=31HJ)를 새 탭에서 엽니다. 모의 시승 신청 화면으로 전환하는 방법은 [실행 안내](demo/README.md#설정)에 있습니다.

## 수집 데이터 확인

퍼즐을 진행하거나 닫은 뒤 SDK 저장소의 루트에서 실행합니다. 보고서 생성에는 Python 3이 필요합니다.

```bash
bash demo/inspect.command
open demo/reports/latest-interactions.html
```

최근 인증 요약 20건의 첫 램프 조작 시간, 풀이 시간, 실패 횟수와 드래그 경로를 확인할 수 있습니다. 경로의 시작점과 끝점에 마우스를 올리면 해당 시점의 경과 시간이 표시됩니다.

시간은 이미지 준비 후 모달이 열려 있고 탭이 보이는 동안 누적합니다. 성공 응답을 받으면 풀이 시간을 확정하고, 서버가 위치 불일치로 응답하면 실패 횟수를 늘립니다.

요약은 기존 DB에 인증당 한 행으로 저장합니다. 드래그 좌표는 약 100ms 간격, 인증당 최대 100개로 제한합니다. 경로 표본 비율은 SDK 기본 1%이며 두 시연 화면에서는 모든 인증의 경로를 수집합니다.

## 종료와 업데이트

```bash
bash demo/stop.command      # 종료, DB 데이터 유지
bash demo/prepare.command   # 두 저장소의 코드를 갱신한 뒤 이미지 재빌드
bash demo/start.command     # 새 이미지로 시작
```

포트, 환경변수와 실행 점검 명령은 [실행 안내](demo/README.md)에 있습니다.

## SDK 설치와 연결

SDK 저장소의 루트에서 설치 파일을 만듭니다. Node.js 24를 사용합니다.

```bash
npm ci
npm run pack:sdk
```

생성 파일은 `artifacts/captchavatye-react-0.1.0.tgz`입니다. 소비 앱에서 해당 파일을 설치하고 모달과 CSS를 가져옵니다.

```bash
npm install /absolute/path/to/captchavatye-react-0.1.0.tgz
```

```tsx
import { CaptchaModal } from '@captchavatye/react';
import '@captchavatye/react/style.css';
```

`onComplete`에서 완료 결과를 보관하고 `onContinue`에서 원래 작업을 재개합니다. 고객사 백엔드는 서버 간 API로 인증 결과를 확인한 뒤 업무를 처리합니다. 입력값과 연결 예시는 [React SDK 문서](packages/react/README.md), 서버 실행과 API는 [백엔드 문서](backend/README.md)에 있습니다.

## 구성

| 경로 | 내용 |
| --- | --- |
| `packages/react` | React 인증 모달, 완료 콜백과 상호작용 계측 |
| `backend` | 인증 API, 서버 간 확인과 PostgreSQL 저장 |
| `frontend` | 포인트 샘플, 광고 소재와 모의 시승 신청 화면 |
| `demo` | 예약 서비스와 함께 실행하는 Docker 구성과 데이터 점검 도구 |
