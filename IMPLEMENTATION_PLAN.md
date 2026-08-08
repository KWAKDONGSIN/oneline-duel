# 구현 청사진 (IMPLEMENTATION_PLAN) — SPEC.md의 파일별 상세 설계

이 문서는 SPEC.md를 코드 구조로 번역한 설계도다. 여기 정의된 상태 모델·함수 경계·처리 순서를
따르면 명세 해석에 시간을 쓸 필요가 없다. 시그니처의 세부(인자 추가 등)는 필요하면 조정해도
되지만, **턴 해결 순서(2장)와 상태 모델(1장)은 반드시 이대로 구현할 것.**

## 1. 상태 모델

```js
// 전투원 (플레이어·보스 공통)
combatant = {
  name: "민수", trait: "몸이 바람처럼 빨라 …",
  isBoss: false, personality: null,     // 보스면 bosses.json의 personality
  endurance: 3,                          // 빈사 도달 부상 수 (플레이어 3 고정)
  wounds: 0,                             // 누적 부상
  statuses: [],                          // ["화상"|"감전"|"보호막"|"혼란"] (1턴 지속)
  energy: 60,                            // 기력
  lastStandUsed: false, lastStandActive: false,
  recoverUsed: 0,                        // 회복 인정 횟수 (최대 2)
  lastSkillId: null                      // 보스 전용: 직전 사용 기술
}

// 배틀
battle = {
  mode: "boss" | "local2p" | "daily",
  turn: 1, maxTurn: 12,
  fieldQueue: [...],                     // 필드 12장 셔플 결과 (시드: daily는 날짜, 그 외 Math.random)
  field: {...},                          // 현재 필드
  p1: combatant, p2: combatant,
  log: [],                               // {type:"tease"|"skill"|"narration"|"system", who, text}
  phase: "input" | "resolving" | "animating" | "over",
  winner: null                           // "p1" | "p2" | "draw"
}
```

## 2. 턴 해결 순서 (battle.js — 버그가 가장 나기 쉬운 부분, 순서 엄수)

```
[턴 시작]
1. turn === 1이면 energy 60 유지, 아니면 energy = min(100, energy + 40) (양측)
2. (turn - 1) % 3 === 0 이면 fieldQueue에서 다음 필드 공개
3. 보스전: boss.pickSkill() → tease를 로그에 추가
[입력]
4. 입력 검증 (validateInput):
   - cost = text.replace(/\s+/g, "").length
   - maxLen = lastStandActive ? 100 : (statuses에 "혼란" ? 30 : 60)
   - cost > maxLen → 거부. lastStandActive가 아니면 cost > energy → 거부
   - 통과 시 energy -= cost (발악 턴은 차감 없음)
[판정]
5. judge.requestJudgment(payload) 호출. phase = "resolving" (렌더러 슬로우 가속)
6. 응답 정규화 (clampResult):
   - wound: 0~2로 클램프, recover: recoverUsed >= 2면 0으로
   - "보호막" 보유자가 wound > 0 받으면 → wound = 0, 보호막 제거, 로그에 "보호막이 깨졌다!"
7. 적용 순서: recover 먼저 (wounds = max(0, wounds - recover), recoverUsed++)
   → wound 적용 → add_statuses 적용 (기존 같은 상태면 무시)
[연출]
8. phase = "animating": motions 순차 재생 + effects 동시 재생 → 내레이션 타이핑 → shout 말풍선
[종료 판정 — 반드시 연출 후]
9. 각 전투원에 대해 wounds >= endurance 이면:
   - lastStandUsed === false → lastStandActive = true, lastStandUsed = true,
     wounds = endurance 유지, 렌더러 lastStand() 재생. 다음 턴이 발악 턴.
   - lastStandUsed === true → 패배 확정.
10. 직전 턴이 발악 턴이었다면(lastStandActive): 이번 판정에서 상대 wound >= 1을 입혔으면
    기사회생 (wounds = endurance - 1, lastStandActive = false), 아니면 패배 확정.
11. 양측 동시 패배 → draw. turn > maxTurn → wounds 적은 쪽 승리, 같으면 draw.
12. 상태 만료: 이번 턴에 새로 얻은 것이 아닌 statuses 제거 (부여 턴 기록 필요).
13. turn++, phase = "input"
```

## 3. 모듈별 설계

### js/battle.js (순수 로직 — DOM 접근 금지, 유닛테스트 가능하게)
- `createBattle(mode, p1Def, p2Def, seed)` → battle
- `beginTurn(b)` → {field, tease}         // 1~3단계
- `validateInput(b, side, text)` → {ok, cost, reason}
- `resolveTurn(b, judgeResult)` → {events: [...]} // 6~13단계. 이벤트 배열로 반환해 UI가 순서대로 연출
- `buildJudgePayload(b, p1Text, p2Text)` → SPEC 4장 형식
- 셔플: `mulberry32` 시드 PRNG (SPEC 7장 코드), daily 시드 = KST "YYYYMMDD" 숫자화

### js/judge.js
- `requestJudgment(payload)` → Promise<result>
  - fetch(JUDGE_URL + "/judge"), AbortController 8초 → 실패 시 1회 재시도 → fallbackJudgment
- `fallbackJudgment(payload)`: 코스트 큰 쪽이 상대에 wound 1 (차이 15 이상이면 2),
  narration 고정 문구, verdict는 방향에 맞게, motions는 키워드 매핑(아래 표)
- `설정`: JUDGE_URL·오프라인 모드는 storage에서 로드. 오프라인 모드면 항상 fallback 사용

### 키워드 → 모션·이펙트 매핑 표 (fallback과 server.mjs MOCK이 공유하는 규칙)
| 문장에 포함 | element | motion |
|---|---|---|
| 불, 화염, 용암, 태우 | fire | flame |
| 물, 파도, 해일, 얼음, 얼려 | water | water_burst |
| 번개, 전기, 벼락 | lightning | bolt |
| 바람, 회오리, 돌풍 | wind | gust |
| 검, 베, 칼 | (없음) | slash |
| 찌르, 꿰뚫 | (없음) | stab |
| 총, 쏘, 발사 | (없음) | shoot |
| 빔, 레이저, 광선 | light | laser |
| 순간이동, 등 뒤, 뒤로 | (없음) | teleport |
| 피하, 회피, 물러 | (없음) | dodge |
| 막, 방패, 방어 | shield | block |
| 폭발, 터뜨 | fire | explosion |
| 회복, 치유, 낫 | heal | heal_aura |
| 소환, 불러 | (없음) | summon |
| (매칭 없음) | (없음) | punch_rush |

### server/server.mjs (Node 18+, 의존성 0)
- http.createServer. POST /judge만 처리, 그 외 404. CORS: Access-Control-Allow-Origin * (개발용).
- .env 파서는 직접 구현 (fs로 읽어 KEY=VALUE 파싱, 10줄이면 된다).
- 검증: text 각각 (last_stand면 100, 아니면 60)자 이하, 필수 필드 존재. 위반 400.
- OpenAI 호출: `POST https://api.openai.com/v1/chat/completions`
  - body: { model: env.OPENAI_MODEL || "gpt-5-mini", max_completion_tokens: 500,
    response_format: { type: "json_schema", json_schema: { name: "judgment", strict: true, schema: <JUDGE_PROMPT.md의 스키마> } },
    messages: [ {role:"system", content: SYSTEM_PROMPT}, <퓨샷 3쌍 user/assistant>, {role:"user", content: 조립된 유저 메시지} ] }
  - SYSTEM_PROMPT·퓨샷·유저 메시지 형식은 JUDGE_PROMPT.md 그대로 상수화.
- `MOCK=1`이면 OpenAI 호출 없이 위 키워드 표 + 코스트 규칙으로 응답 생성 (인터페이스 동일).

### worker/worker.js
- server.mjs와 동일 로직. 판정 로직(프롬프트 상수·검증·매핑 표)은 두 파일이 공유할 수 있게
  server/judge-core.mjs 공용 모듈로 분리해 양쪽에서 import.
- 레이트 리밋: 전역 Map<ip, timestamps>. 분당 6, 일 200 초과 시 429.

### js/render3d.js (three.js 3D 렌더러)
- import는 importmap 경유: `import * as THREE from "three"`,
  `import { GLTFLoader } from "../libs/addons/loaders/GLTFLoader.js"`.
- 씬 구성: PerspectiveCamera(fov 45), 바닥 CircleGeometry, ambient + directional 조명,
  배경색·포그는 필드 교체 시 setField(field)로 변경.
- 캐릭터 리그 (프리미티브 휴머노이드):
  ```
  root(Group) ─ torso(CapsuleGeometry)
             ├ head(Sphere)
             ├ shoulderL(Group)─upperArm(Capsule)─elbowL(Group)─foreArm(Capsule)
             ├ shoulderR … 동일
             ├ hipL(Group)─thigh(Capsule)─kneeL(Group)─shin(Capsule)
             └ hipR … 동일
  ```
  포즈 = 관절별 오일러 각 {shoulderL:[x,y,z], elbowL:[x], hipL:[x], kneeL:[x], torso:[x,y,z],
  rootPos:[x,y,z], rootRotY} 형태의 사전. 모션 = [{t:0~1, pose}] 키프레임 배열을 lerp 보간.
- 모션 26종: data/motions.json keyhint를 위 포즈 체계로 해석. 비슷한 모션은 파라미터 재사용
  (slash/stab은 같은 팔 스윙의 각도 차이). 이동형(teleport, grab_throw, quake 점프)은
  rootPos 보간 + teleport는 opacity 페이드.
- GLB 훅: init 시 data/models/p1.glb·p2.glb를 fetch HEAD로 존재 확인 → 있으면 GLTFLoader
  로드 후 리그 대신 사용(모션은 rootPos·rootRotY·기울임만 적용), 없으면 프리미티브.
- 카메라 컨트롤러 상태 기계: "orbit"(typing, 초당 6도 회전) → "focus"(판정 도착, 피격자에게
  0.4초 줌 펀치, intensity 3이면 0.3초 슬로우 줌 선행) → "shake"(감쇠 진동) → "orbit" 복귀.
- 이펙트: 속성색 파티클(THREE.Points, 수명 관리 배열), explosion은 RingGeometry 스케일 확장.
- phase "typing": idle_slow 루프(0.3배속 원 대치 + 3~5초마다 잽), "resolving": 배속 0.3→1.0 점증.
- 렌더 루프는 requestAnimationFrame 1개. 모바일 성능: pixelRatio 상한 2, 파티클 동시 300개 상한.

### js/boss.js
- `pickSkill(boss, state)`: 후보 = skills 중 lastSkillId 제외. state.wounds >= endurance - 1
  이면 enraged 우선. 발악 턴이면 enraged 중 랜덤. 반환 {skill, tease}.

### js/character.js
- `validate(name, trait)`: 이름 1~6자(공백 제외), 속성 1~100자(공백 제외).
  금지어 = ["무적","즉사","모든 공격","전부 무효","심판","절대","반드시 이긴","항상 이긴"].
  포함 시 {ok:false, word} 반환 → UI가 경고 표시.
- 예시 3종 상수 (SPEC 2장 문구 그대로).

### js/local2p.js
- 상태: p1_input → handoff("P2에게 기기를 넘겨주세요" 전체 화면, 탭하면 진행) → p2_input
  → 판정 1회 → 연출 → 다음 턴. 캐릭터 작성도 P1 → P2 순서로 2회.

### js/storage.js
- 키 "old:v1". {character:{name,trait}, progress:{beatenBossIds:[]},
  daily:{"2026-08-24":{win,turns}}, settings:{judgeUrl, offline}, record:{wins,losses}}

### js/main.js
- 해시 라우팅: #home, #create, #battle, #result. 화면 전환은 섹션 display 토글.
- 이벤트: 전송 버튼·Enter, 예고 후 입력창 포커스, 결과 화면 버튼들, 설정 저장.

## 4. index.html 구조 / css 토큰

- `<head>`에 importmap을 선언한다 (모든 모듈 스크립트보다 먼저):
  ```html
  <script type="importmap">{ "imports": { "three": "./libs/three.module.js" } }</script>
  ```
- 섹션 4개(#home #create #battle #result) + 모달 3개(튜토리얼/설정/통계는 v1에서 설정만).
- 배틀 화면의 canvas 자리에는 three.js renderer의 domElement를 담을 div#stage를 둔다.
- CSS 변수: --bg #101014, --panel #1a1a22, --text #e8e8f0, --sub #8a8a9a,
  --p1 #3ca8ff, --p2 #ff5a3c, --gold #c9a227, --danger #ff3c5a.
  속성색은 SPEC 5장(v1.0의 9색) 그대로.
- 배틀 레이아웃(세로): 상대 정보바(48px) / 필드 칩(32px) / canvas(화면 35%) /
  로그(flex-grow, overflow-y) / 내 정보바 + 입력줄(96px). 모바일 폭 360px 기준.
- 부상 표시: 🩸 아이콘 wounds만큼 + 회색 빈 슬롯 (endurance까지). 기력은 가는 바.

## 5. UI 문구

모든 사용자 노출 문구는 UI_TEXT.md에 확정되어 있다. **임의로 문구를 만들지 말고 그대로 사용할 것.**

## 6. 구현 순서 (권장 커밋 단위)

1. index.html(importmap 포함) + css 뼈대 + main.js 라우팅 (빈 화면 4개 전환)
2. server.mjs MOCK 완성 → curl로 /judge 응답 확인
3. battle.js + judge.js (fallback 포함) → 콘솔로 한 턴 해결 검증
4. character.js + 배틀 UI 연결 → MOCK으로 보스 1차전 완주 (연출 없이 로그만)
5. render3d.js — 무대·캐릭터 2체·idle_slow 슬로우 대치·카메라 궤도까지 먼저,
   그다음 핵심 12모션 + 카메라 펀치, 여유 되면 나머지 모션과 GLB 훅
6. boss.js 5연전 + storage 진행 저장
7. 실제 OpenAI 연동 (judge-core 분리) + worker.js
8. local2p.js
각 단계 후 동작 확인. 5단계(핵심 12모션까지)가 세션 1의 필수 목표다 —
이번 데모의 평가 포인트는 3D 연출이므로 render3d를 boss 5연전보다 먼저 한다.
