# 실행 안내

Git과 Docker Desktop이 필요합니다. 최초 실행에는 인터넷 연결이 필요합니다.

## 시작

두 저장소를 같은 폴더 아래에 clone합니다.

```bash
mkdir -p ~/dev/captchavatye-demo
cd ~/dev/captchavatye-demo
git clone --branch feat/captchavatye-demo --single-branch https://github.com/usk-avatye/captcha.git final_mission
git clone --branch feat/captchavatye-demo --single-branch https://github.com/kimheejun-avatye/Internship-finalproject.git
cd final_mission
bash demo/start.command
```

예약 화면은 [http://127.0.0.1:55175](http://127.0.0.1:55175) 입니다. `qa-member1@example.com` / `Qa12345!`로 로그인합니다.

## 종료와 업데이트

```bash
bash demo/stop.command      # 종료, 예약 데이터 유지
bash demo/start.command     # 다시 시작
bash demo/prepare.command   # 코드를 pull한 뒤 이미지 재빌드
```

시연 환경을 점검하려면 `bash demo/verify.command`를 실행합니다. 이 명령은 다음 주 일정에 점검용 예약을 추가합니다.

## 설정

| 서비스 | 기본 포트 |
| --- | --- |
| 예약 화면 | 55175 |
| 광고 소재와 시승 화면 | 55173 |
| 인증 API | 58001 |
| 예약 API | 58002 |

첫 실행에서 키와 DB 비밀번호를 `demo/.env`에 생성합니다. 이 파일은 Git에 포함하지 않습니다. DB는 전용 Docker 볼륨에 저장하므로 종료 후에도 유지됩니다.

포트를 바꾸면 `prepare.command`로 다시 빌드한 뒤 `start.command`를 실행합니다. 기존 데이터를 계속 사용하려면 `demo/.env`를 보관하세요.
