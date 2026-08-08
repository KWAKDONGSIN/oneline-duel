import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));

function loadEnv(filePath = path.join(SERVER_DIR, ".env")) {
  if (!fs.existsSync(filePath)) return {};
  return Object.fromEntries(
    fs.readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "")];
      }),
  );
}

const env = { ...loadEnv(), ...process.env };
const PORT = Number(env.PORT || 8787);

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

function tagsFor(text) {
  const rule = KEYWORD_RULES.find(({ words }) => words.some((word) => text.includes(word)));
  return rule || { motion: "punch_rush" };
}

function validatePayload(payload) {
  if (!payload || payload.mode !== "boss" || !Number.isInteger(payload.turn)) return "필수 전투 정보가 없습니다.";
  for (const side of ["p1", "p2"]) {
    const fighter = payload[side];
    if (!fighter || typeof fighter.name !== "string" || typeof fighter.trait !== "string" ||
        typeof fighter.text !== "string" || !Number.isFinite(fighter.cost)) {
      return `${side} 정보가 올바르지 않습니다.`;
    }
    const maxLength = fighter.last_stand ? 100 : 60;
    if (fighter.text.replace(/\s+/g, "").length > maxLength) return `${side} 기술이 글자 제한을 넘었습니다.`;
  }
  return null;
}

export function createMockJudgment(payload) {
  const costDiff = payload.p1.cost - payload.p2.cost;
  const damage = Math.abs(costDiff) >= 15 ? 2 : 1;
  const p1Wound = costDiff < 0 ? damage : 0;
  const p2Wound = costDiff > 0 ? damage : 0;
  const p1Tags = tagsFor(payload.p1.text);
  const p2Tags = tagsFor(payload.p2.text);
  const effects = [];

  if (p1Tags.element) effects.push({ type: p1Tags.element, target: "p2", intensity: p2Wound || 1 });
  if (p2Tags.element && effects.length < 3) effects.push({ type: p2Tags.element, target: "p1", intensity: p1Wound || 1 });

  const templates = [
    `${payload.p1.name}의 기술과 ${payload.p2.name}의 기술이 정면으로 맞부딪힌다! 더 강한 기세가 상대의 틈을 파고든다.`,
    `두 문장이 전장을 가르며 충돌한다. 한순간의 주도권이 승부의 흐름을 바꾼다!`,
    `${payload.field || "전장"}에서 두 기술이 폭발한다! 물러서지 않은 쪽의 기세가 끝내 앞으로 나아간다.`,
  ];

  return {
    narration: templates[(payload.turn - 1) % templates.length],
    p1: { wound: p1Wound, recover: 0, add_statuses: [], shout: p2Wound ? "간다!" : "…버텨!" },
    p2: { wound: p2Wound, recover: 0, add_statuses: [], shout: p1Wound ? "받아라!" : "제법입니다!" },
    effects,
    motions: [
      { actor: "p2", motion: p2Tags.motion },
      { actor: "p1", motion: p1Tags.motion },
    ],
    verdict: costDiff > 0 ? "p2_hit" : costDiff < 0 ? "p1_hit" : "block",
  };
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  });
  response.end(JSON.stringify(body));
}

const server = http.createServer((request, response) => {
  if (request.method === "OPTIONS") return sendJson(response, 204, {});
  if (request.method !== "POST" || request.url !== "/judge") return sendJson(response, 404, { error: "Not found" });

  let raw = "";
  request.on("data", (chunk) => {
    raw += chunk;
    if (raw.length > 20_000) request.destroy();
  });
  request.on("end", () => {
    try {
      const payload = JSON.parse(raw);
      const error = validatePayload(payload);
      if (error) return sendJson(response, 400, { error });
      if (env.MOCK !== "1") return sendJson(response, 503, { error: "실제 판정 연동은 7단계에서 활성화됩니다." });
      return sendJson(response, 200, createMockJudgment(payload));
    } catch {
      return sendJson(response, 400, { error: "JSON 요청을 확인해 주세요." });
    }
  });
});

server.listen(PORT, () => {
  console.log(`한줄승부 판정 서버: http://localhost:${PORT} (MOCK=${env.MOCK === "1" ? "1" : "0"})`);
});
