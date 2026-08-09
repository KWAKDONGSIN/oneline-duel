const DEFAULT_JUDGE_URL = "http://localhost:8787";

// 인터넷에 배포했을 때 쓸 판정 서버(Cloudflare Worker) 주소.
// `npx wrangler deploy` 후 나오는 https 주소를 여기에 넣는다. 비어 있으면 배포 환경에서는
// 약식 판정으로만 동작한다.
const DEPLOYED_JUDGE_URL = "https://onelineduel-judge.dkmdkm999.workers.dev";

// 같은 와이파이의 다른 기기(폰)에서 접속한 경우인지 판별한다.
// 사설 IP일 때만 PC의 판정 서버로 주소를 바꿔 준다.
function isLanHost(hostname) {
  return /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)
    || /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)
    || /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(hostname);
}

const KEYWORD_RULES = [
  { words: ["용", "드래곤", "괴수"], element: "fire", motion: "summon" },
  { words: ["마법", "마법봉", "주문", "마술"], element: "light", motion: "cast" },
  { words: ["불", "화염", "용암", "태우"], element: "fire", motion: "flame" },
  { words: ["물", "파도", "해일", "얼음", "얼려"], element: "water", motion: "water_burst" },
  { words: ["번개", "전기", "벼락"], element: "lightning", motion: "bolt" },
  { words: ["바람", "회오리", "돌풍"], element: "wind", motion: "gust" },
  { words: ["검", "베", "칼"], motion: "slash" },
  { words: ["찌르", "꿰뚫"], motion: "stab" },
  { words: ["총", "쏘", "발사"], motion: "shoot" },
  { words: ["빔", "레이저", "광선"], element: "light", motion: "laser" },
  { words: ["순간이동", "등 뒤", "뒤로"], motion: "teleport" },
  { words: ["피하", "회피", "물러"], motion: "dodge" },
  { words: ["막", "방패", "방어"], element: "shield", motion: "block" },
  { words: ["폭발", "터뜨"], element: "fire", motion: "explosion" },
  { words: ["회복", "치유", "낫"], element: "heal", motion: "heal_aura" },
  { words: ["소환", "불러"], motion: "summon" },
  { words: ["활", "화살"], motion: "shoot" },
  { words: ["주먹", "펀치", "연타"], motion: "punch_rush" },
  { words: ["발차기", "킥"], motion: "kick" },
  { words: ["지진", "대지", "땅을"], element: "earth", motion: "quake" },
  { words: ["던지", "투척"], motion: "throw" },
  { words: ["묶", "속박", "사슬"], motion: "bind" },
  { words: ["은신", "투명"], element: "dark", motion: "stealth" },
  { words: ["기 모", "충전", "각성"], element: "light", motion: "charge_up" },
];

function mappedTags(text) {
  const matches = KEYWORD_RULES.filter(({ words }) => words.some((word) => text.includes(word)));
  if (!matches.length) return { motions: ["punch_rush"] };
  return {
    element: matches.find((rule) => rule.element)?.element,
    motions: [...new Set(matches.map((rule) => rule.motion))].slice(0, 2),
  };
}

export function fallbackJudgment(payload) {
  const difference = payload.p1.cost - payload.p2.cost;
  const damage = Math.abs(difference) >= 15 ? 2 : 1;
  const p1Tags = mappedTags(payload.p1.text);
  const p2Tags = mappedTags(payload.p2.text);
  const effects = [];
  if (p1Tags.element) effects.push({ type: p1Tags.element, target: "p2", intensity: difference > 0 ? damage : 1 });
  if (p2Tags.element && effects.length < 3) effects.push({ type: p2Tags.element, target: "p1", intensity: difference < 0 ? damage : 1 });

  return {
    narration: "심판이 자리를 비웠다… 기세로 승부가 갈렸다!",
    p1: { wound: difference < 0 ? damage : 0, recover: 0, add_statuses: [], shout: "" },
    p2: { wound: difference > 0 ? damage : 0, recover: 0, add_statuses: [], shout: "" },
    effects,
    motions: [
      ...p2Tags.motions.map((motion) => ({ actor: "p2", motion })),
      ...p1Tags.motions.map((motion) => ({ actor: "p1", motion })),
    ].slice(0, 3),
    verdict: difference > 0 ? "p2_hit" : difference < 0 ? "p1_hit" : "block",
    _fallback: true,
  };
}

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem("old:v1") || "{}");
    const hostname = typeof location !== "undefined" ? location.hostname : "localhost";
    const isLocalPage = ["localhost", "127.0.0.1"].includes(hostname);
    const isDefaultUrl = /^http:\/\/(localhost|127\.0\.0\.1):8787$/i.test(saved.settings?.judgeUrl || DEFAULT_JUDGE_URL);

    let judgeUrl = saved.settings?.judgeUrl || DEFAULT_JUDGE_URL;

    // 사용자가 직접 지정한 주소가 아니라 기본값일 때만 환경에 맞춰 보정한다.
    if (isDefaultUrl && !isLocalPage) {
      if (isLanHost(hostname)) {
        // 같은 와이파이의 폰에서 PC 서버로 접속하는 경우
        judgeUrl = `http://${hostname}:8787`;
      } else {
        // 인터넷에 배포된 경우. https 페이지에서 http 주소를 부르면 브라우저가 차단하므로
        // 배포 Worker 주소가 없으면 아예 비워 두고 약식 판정으로 넘어가게 한다.
        judgeUrl = DEPLOYED_JUDGE_URL;
      }
    }

    return {
      judgeUrl,
      offline: Boolean(saved.settings?.offline) || !judgeUrl,
    };
  } catch {
    return { judgeUrl: DEFAULT_JUDGE_URL, offline: false };
  }
}

async function requestOnce(url, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(`${url.replace(/\/$/, "")}/judge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`판정 서버 오류: ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function requestJudgment(payload, settings = loadSettings()) {
  if (settings.offline) return fallbackJudgment(payload);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await requestOnce(settings.judgeUrl || DEFAULT_JUDGE_URL, payload);
    } catch {
      // 한 번 재시도한 뒤에도 실패하면 게임 흐름을 약식 판정으로 이어 간다.
    }
  }
  return fallbackJudgment(payload);
}
