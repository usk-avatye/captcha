# 실행 안내

Git과 Docker Desktop이 필요합니다. 최초 실행에는 인터넷 연결이 필요합니다.

## 시작

두 저장소를 같은 폴더 아래에 clone합니다.

```bash
mkdir -p ~/dev/captchavatye-demo
cd ~/dev/captchavatye-demo
git clone --branch main --single-branch https://github.com/usk-avatye/captcha.git final_mission
git clone --branch feat/captchavatye-demo --single-branch https://github.com/kimheejun-avatye/Internship-finalproject.git
cd final_mission
bash demo/start.command
```

이미 clone한 경우 `~/dev/captchavatye-demo/final_mission`에서 `bash demo/start.command`를 실행합니다.

## 시연

| 화면 | 주소 | 진행 순서 |
| --- | --- | --- |
| 포인트 샘플 | [http://127.0.0.1:55173](http://127.0.0.1:55173) | 제목과 본문 입력, 등록, 퍼즐 맞추기, 모의 10P 적립, 원래 작업 계속하기 |
| 회의실 예약 | [http://127.0.0.1:55175](http://127.0.0.1:55175) | 로그인, 예약 내용 입력, 예약하기, 퍼즐 맞추기, 예약 계속하기 |

예약 계정은 `qa-member1@example.com` / `Qa12345!`입니다. 샘플의 포인트와 글 목록은 페이지 새로고침 시 초기화되며, 예약과 인증 기록은 DB에 유지됩니다.

## 종료와 업데이트

```bash
bash demo/stop.command      # 종료, 예약 데이터 유지
bash demo/start.command     # 다시 시작
bash demo/prepare.command   # 코드를 pull한 뒤 이미지 재빌드
```

시연 환경을 점검하려면 `bash demo/verify.command`를 실행합니다. 이 명령은 다음 주 일정에 점검용 예약을 추가합니다.

## 상호작용 데이터 확인

포인트 화면과 예약 화면에서 퍼즐을 사용한 뒤 아래 명령을 실행합니다. 보고서 생성에는 Python 3이 필요합니다.

```bash
bash demo/inspect.command
open demo/reports/latest-interactions.html
```

최근 인증 요약 20건의 첫 조작 시간, 풀이 시간, 실패 횟수와 드래그 경로를 보여줍니다. 성공, 닫기, 탭 숨김 때 누적 요약을 전송하고 기존 DB에 인증당 한 행을 유지합니다. 시간은 이미지 준비 후 활성 시간이며 성공 응답을 받으면 풀이 시간을 확정합니다. 서버가 위치 불일치로 응답한 경우 실패 횟수가 증가합니다.

SDK 기본 경로 표본 비율은 1%이며 두 시연 화면에서는 모든 인증의 경로를 수집합니다. 경로는 퍼즐 영역의 0에서 1 좌표로 저장하며 이동 표본은 100ms 간격, 인증당 최대 100개 좌표입니다. 누적 요약의 revision으로 재전송과 역순 도착을 처리합니다.

경로의 시작점과 끝점에 마우스를 올리거나 Tab 키로 선택하면 드래그 번호와 활성 경과 시간이 표시됩니다. 새 인증 기록을 확인할 때는 점검 명령을 다시 실행하고 보고서를 새로고침합니다.

## 설정

| 서비스 | 기본 포트 |
| --- | --- |
| 예약 화면 | 55175 |
| 포인트 샘플, 광고 소재와 모의 시승 화면 | 55173 |
| 인증 API | 58001 |
| 예약 API | 58002 |

시승 신청 버튼은 기본으로 [BMW 공식 시승 페이지](https://www.bmw.co.kr/ko/fastlane/tda-experience.html?agCode=31HJ)를 새 탭에서 엽니다. 모의 신청 흐름을 연습하려면 `demo/.env`에 `DEMO_LANDING_URL=/demo/test-drive`를 추가한 뒤 `bash demo/start.command`를 실행합니다.

첫 실행에서 키와 DB 비밀번호를 `demo/.env`에 생성합니다. 이 파일은 Git에 포함하지 않습니다. DB는 전용 Docker 볼륨에 저장하므로 종료 후에도 유지됩니다.

포트를 바꾸면 `prepare.command`로 다시 빌드한 뒤 `start.command`를 실행합니다. 기존 데이터를 계속 사용하려면 `demo/.env`를 보관하세요.
