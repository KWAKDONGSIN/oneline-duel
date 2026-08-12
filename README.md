# 무지개 반사

한 줄로 캐릭터와 기술을 만들고 판정을 받는 턴제 텍스트 배틀 웹게임입니다.

## 현재 구현 범위

캐릭터 작성 후 첫 보스와 싸울 수 있으며, 두 브라우저가 동시에 접속하는 실시간 1:1 대전도
지원합니다. 입력한 문장의 키워드에 따라 3D 졸라맨이 베기, 찌르기, 사격, 화염, 번개,
순간이동, 방어 등의 동작을 재생합니다.

- `랭크전`: 1000점에서 시작하며 승리하면 점수를 얻고 패배하면 잃습니다. 점수에 따라
  브론즈, 실버, 골드, 플래티넘, 다이아몬드 티어가 정해집니다.
- `일반전`: 같은 규칙으로 대전하지만 점수는 변하지 않습니다.
- 두 모드 모두 비슷한 점수의 유저를 우선 찾고, 5초 동안 상대가 없으면 현재 점수에 맞는
  훈련봇이 자동으로 참가합니다.

## 실행

Node.js가 설치된 PowerShell에서 다음 명령을 실행한 뒤 브라우저에서 `http://localhost:8000`을 엽니다.

```powershell
.\run-dev.ps1
```

종료하려면 `Ctrl+C`를 누릅니다. API 키는 필요하지 않으며, 실행 스크립트가 판정 서버를 MOCK 모드로
시작합니다.

실제 AI 심판을 사용하려면 `server/.env.example`을 `server/.env`로 복사하고 `MOCK=0`과
`OPENAI_API_KEY`를 설정합니다. API 키는 서버에서만 읽으며 브라우저 코드에는 전달되지 않습니다.

실시간 유저 대전은 같은 주소를 브라우저 창 두 개에서 열고 각 창에서 서로 다른 캐릭터로 같은 모드의
매칭을 시작하면 시험할 수 있습니다. 같은 와이파이의 다른 기기에서는 실행 PC의 내부 IP 주소와
8000번 포트로 접속합니다.

## 인터넷에 배포하기 (심사 제출용)

게임 화면은 정적 파일이라 GitHub Pages에 그대로 올릴 수 있지만, AI 심판은 API 키를 숨겨야 하므로
별도의 판정 서버가 필요합니다. `worker/`에 Cloudflare Workers용 판정 서버가 들어 있습니다.

```powershell
node worker/build-prompt.mjs          # JUDGE_PROMPT.md를 Worker용 모듈로 굽는다
cd worker
npx wrangler login
npx wrangler secret put OPENAI_API_KEY   # 키를 입력한다. 코드에는 절대 넣지 않는다
npx wrangler deploy
```

배포되면 `https://onelineduel-judge.<계정>.workers.dev` 주소가 나옵니다. 게임 화면의 `설정`에서
`판정 서버 주소`를 이 주소로 바꾸면 인터넷 어디서나 AI 판정으로 플레이할 수 있습니다.

`JUDGE_PROMPT.md`를 수정하면 `node worker/build-prompt.mjs`를 다시 실행하고 재배포해야 합니다.

주의할 점이 두 가지 있습니다.

- Worker는 보스전 판정(`/judge`)만 제공합니다. 온라인 대전(`/pvp/*`)은 서버가 대전 상태를
  들고 있어야 해서 로컬 `server/server.mjs`에서만 동작합니다.
- 판정 서버에는 IP당 분당 20회·하루 300회 제한이 걸려 있습니다. OpenAI 대시보드에서 지출 한도도
  별도로 설정해 두세요.

## 오픈소스 출처

| 이름 | 라이선스 | 사용 범위 |
|---|---|---|
| [three.js](https://github.com/mrdoob/three.js) | MIT | 3D 렌더링 엔진 (`libs/`에 벤더링) |
| [LinearAbiltyCastingThreeJS](https://github.com/achrefelouafi/LinearAbiltyCastingThreeJS) | MIT | GLSL 노이즈·셰이딩 라이브러리(심플렉스 노이즈, fbm, ridged, 보로노이, 프레넬, 그라데이션)를 `js/vfx.js`에 이식해 원소 이펙트 셰이더의 재료로 사용 |

두 프로젝트 모두 MIT 라이선스이며, 이미지·오디오 등 에셋 파일은 가져오지 않았습니다
(이 게임의 그래픽과 소리는 전부 코드로 생성합니다).
