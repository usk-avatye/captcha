# 회의실 예약 시연 시작하기

이 시연은 CAPTCHAvatye SDK와 회의실 서비스를 나란한 두 Git 저장소로 실행한다. 회사 맥북에는 Git, GitHub 저장소 읽기 권한, Docker Desktop만 있으면 된다. 저장소를 비공개로 바꾼 경우 clone할 때 해당 계정으로 GitHub 인증이 필요하다.

## 회사 맥북에서 처음 실행

Docker Desktop을 실행하고 터미널에서 다음 명령을 한 번 입력한다.

```bash
mkdir -p ~/dev/captchavatye-demo
cd ~/dev/captchavatye-demo
git clone --branch feat/captchavatye-demo --single-branch https://github.com/usk-avatye/captcha.git final_mission
git clone --branch feat/captchavatye-demo --single-branch https://github.com/kimheejun-avatye/Internship-finalproject.git
cd final_mission
bash demo/start.command
```

처음 실행하면 Docker가 PostgreSQL, Python 백엔드와 Node 프런트엔드 이미지를 준비한다. 네트워크 상태에 따라 준비에 시간이 걸릴 수 있다. 두 화면이 준비되면 브라우저가 예약 페이지를 연다.

화면에 `qa-member1@example.com` 계정과 비밀번호 `Qa12345!`를 입력하고 로그인한다. 회의 제목과 시작 및 종료 시각을 정한 다음 **예약하기**를 누른다. 램프 조각을 옮겨 인증하고 **예약 계속하기**를 누르면 저장된 예약이 목록에 보인다. 시승 신청 링크는 누르지 않아도 예약을 계속할 수 있다.

## 다시 실행

시연을 멈출 때 `bash demo/stop.command`를 사용한다. 서버와 데이터베이스는 같은 맥북에 보존되며, 다음에는 `bash demo/start.command`로 시작한다. Docker Desktop이 실행 중이면 기존 이미지를 다시 빌드하거나 내려받지 않고 시작한다. 코드를 업데이트한 뒤 이미지를 다시 빌드해야 할 때만 `bash demo/prepare.command`를 실행한다.

시연 전 예약, 인증 위조 거부와 중복 요청을 빠르게 점검하려면 `bash demo/verify.command`를 실행한다. 이 명령은 실제 시연 DB에 `시연 자동 점검` 예약을 하나 추가한다.

## 실행 환경과 DB

화면 주소는 `http://127.0.0.1:55175`이다. API 포트는 provider `58001`, 고객사 `58002`, 소재 및 시승 화면은 `55173`이다. DB는 Docker 내부에서만 연결하며 기존 로컬 개발 DB와 분리한다.

첫 실행은 인터넷 연결이 필요하다. provider DB와 고객사 예약 DB를 별도로 만들고 Alembic 마이그레이션과 QA 계정 준비를 자동으로 한다. 시연 기록은 `captchavatye-demo-postgres` Docker 볼륨에 저장한다. `demo/.env`는 키와 DB 비밀번호를 보관하므로 삭제하거나 전달하지 않는다.

Mac에서 쓰는 서비스 포트는 `demo/.env`에서 확인할 수 있다. 기존 포트가 겹치면 모든 서비스가 뜨지 않는다. `.env`를 이미 사용 중인 시연의 컨테이너나 볼륨과 함께 옮기지 않으면 DB 접속이 되지 않으므로 원래 clone 폴더에 둔다.

포트를 바꾸었거나 새 코드를 pull한 경우에는 `bash demo/prepare.command`로 이미지를 다시 빌드한 뒤 `bash demo/start.command`를 실행한다. 이미 사용한 폴더에서 `demo/.env`를 지우지 않는다.
