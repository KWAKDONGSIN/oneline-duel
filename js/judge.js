const DEFAULT_JUDGE_URL = "http://localhost:8787";

const KEYWORD_RULES = [
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
];

function mappedTags(text) {
  return KEYWORD_RULES.find(({ words }) => words.some((word) => text.includes(word))) ?? { motion: "punch_rush" };
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
      { actor: "p2", motion: p2Tags.motion },
      { actor: "p1", motion: p1Tags.motion },
    ],
    verdict: difference > 0 ? "p2_hit" : difference < 0 ? "p1_hit" : "block",
    _fallback: true,
  };
}

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem("old:v1") || "{}");
    const savedUrl = saved.settings?.judgeUrl || DEFAULT_JUDGE_URL;
    const judgeUrl = /^http:\/\/(localhost|127\.0\.0\.1):8787$/i.test(savedUrl) &&
      typeof location !== "undefined" && !["localhost", "127.0.0.1"].includes(location.hostname)
      ? `http://${location.hostname}:8787` : savedUrl;
    return {
      judgeUrl,
      offline: Boolean(saved.settings?.offline),
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
