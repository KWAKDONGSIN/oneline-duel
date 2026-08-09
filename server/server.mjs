import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beginTurn, buildJudgePayload, createBattle, resolveTurn, validateInput } from "../js/battle.js";

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.dirname(SERVER_DIR);
const RUNTIME_FILE = path.join(SERVER_DIR, "runtime-players.json");
const fields = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "data/fields.json"), "utf8")).fields;

function loadEnv(filePath = path.join(SERVER_DIR, ".env")) {
  if (!fs.existsSync(filePath)) return {};
  return Object.fromEntries(fs.readFileSync(filePath, "utf8").split(/\r?\n/)
    .map((line) => line.trim()).filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "")];
    }));
}

const env = { ...loadEnv(), ...process.env };
const PORT = Number(env.PORT || 8787);
const BOT_WAIT_MS = Number(env.BOT_WAIT_MS || 5_000);
const JUDGE_PROMPT = fs.readFileSync(path.join(ROOT_DIR, "JUDGE_PROMPT.md"), "utf8");
const schemaMatch = JUDGE_PROMPT.match(/## 응답 JSON 스키마[\s\S]*?```json\s*([\s\S]*?)```/);
const JUDGMENT_SCHEMA = schemaMatch ? JSON.parse(schemaMatch[1]) : null;

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

const BOT_MOVES = [
  "주먹을 빠르게 뻗는다",
  "옆으로 피하며 검으로 허리를 벤다",
  "방패로 막은 뒤 번개 창을 발사한다",
  "순간이동으로 등 뒤를 잡아 화염 검으로 연속 베기한다",
  "공격의 궤도를 읽고 물러난 뒤 빈틈에 광선을 집중 발사한다",
];

function tagsFor(text) {
  const matches = KEYWORD_RULES.filter(({ words }) => words.some((word) => text.includes(word)));
  if (!matches.length) return { motions: ["punch_rush"] };
  return {
    element: matches.find((rule) => rule.element)?.element,
    motions: [...new Set(matches.map((rule) => rule.motion))].slice(0, 2),
  };
}

function validatePayload(payload) {
  if (!payload || !["boss", "local2p"].includes(payload.mode) || !Number.isInteger(payload.turn)) {
    return "필수 전투 정보가 없습니다.";
  }
  for (const side of ["p1", "p2"]) {
    const fighter = payload[side];
    if (!fighter || typeof fighter.name !== "string" || typeof fighter.trait !== "string" ||
        typeof fighter.text !== "string" || !Number.isFinite(fighter.cost)) return `${side} 정보가 올바르지 않습니다.`;
    if (fighter.text.replace(/\s+/g, "").length > (fighter.last_stand ? 100 : 60)) {
      return `${side} 기술이 글자 제한을 넘었습니다.`;
    }
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
    p2: { wound: p2Wound, recover: 0, add_statuses: [], shout: p1Wound ? "받아라!" : "제법이군!" },
    effects,
    motions: [
      ...p2Tags.motions.map((motion) => ({ actor: "p2", motion })),
      ...p1Tags.motions.map((motion) => ({ actor: "p1", motion })),
    ].slice(0, 3),
    verdict: costDiff > 0 ? "p2_hit" : costDiff < 0 ? "p1_hit" : "block",
  };
}

function userMessage(payload) {
  const woundName = (wounds) => ["건재", "경상", "중상", "빈사"][Math.min(3, wounds)] || "건재";
  const fighter = (label, side) => {
    const data = payload[side];
    return `[${label}] 이름:${data.name} 속성:${data.trait}\n` +
      `부상:${data.wounds}(${woundName(data.wounds)}) 상태:${data.statuses.join(",") || "없음"} ` +
      `발악:${data.last_stand ? "예" : "아니오"} 코스트:${data.cost}` +
      `${data.personality ? ` 말투:${data.personality}` : ""}\n기술: ${data.text}`;
  };
  return `[필드] ${payload.field || "없음"}\n[턴] ${payload.turn}\n${fighter("p1", "p1")}\n${fighter("p2", "p2")}`;
}

async function requestAiJudgment(payload) {
  if (!env.OPENAI_API_KEY || !JUDGMENT_SCHEMA) return createMockJudgment(payload);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const apiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: env.OPENAI_MODEL || "gpt-5-mini",
        instructions: JUDGE_PROMPT,
        input: userMessage(payload),
        max_output_tokens: 500,
        text: { format: { type: "json_schema", name: "judgment", strict: true, schema: JUDGMENT_SCHEMA } },
      }),
      signal: controller.signal,
    });
    if (!apiResponse.ok) throw new Error(`OpenAI ${apiResponse.status}`);
    const body = await apiResponse.json();
    const outputText = body.output?.flatMap((item) => item.content || [])
      .find((content) => content.type === "output_text")?.text;
    if (!outputText) throw new Error("empty_output");
    return JSON.parse(outputText);
  } finally {
    clearTimeout(timer);
  }
}

async function judgePayload(payload) {
  if (env.MOCK === "1" || !env.OPENAI_API_KEY) return createMockJudgment(payload);
  try { return await requestAiJudgment(payload); }
  catch { return createMockJudgment(payload); }
}

export function tierFor(rating) {
  if (rating >= 1600) return "다이아몬드";
  if (rating >= 1400) return "플래티넘";
  if (rating >= 1200) return "골드";
  if (rating >= 1000) return "실버";
  return "브론즈";
}

function loadProfiles() {
  try { return JSON.parse(fs.readFileSync(RUNTIME_FILE, "utf8")); } catch { return {}; }
}

const profiles = loadProfiles();
const queues = { casual: [], ranked: [] };
const matches = new Map();
const playerMatch = new Map();

function saveProfiles() {
  fs.writeFileSync(RUNTIME_FILE, JSON.stringify(profiles, null, 2));
}

function getProfile(id, name = "도전자") {
  if (!profiles[id]) profiles[id] = { id, name, rating: 1000, wins: 0, losses: 0 };
  profiles[id].name = name || profiles[id].name;
  return profiles[id];
}

function publicProfile(profile) {
  return { name: profile.name, rating: profile.rating, tier: tierFor(profile.rating), wins: profile.wins, losses: profile.losses };
}

function createBot(rating) {
  const adjusted = Math.max(700, rating + Math.round((Math.random() - 0.5) * 100));
  return {
    id: `bot-${Date.now()}`,
    name: `${tierFor(adjusted)} 훈련봇`,
    rating: adjusted,
    bot: true,
    character: { name: `${tierFor(adjusted)}봇`, trait: "상대의 전투 수준에 맞춰 빈틈과 상성을 분석한다" },
  };
}

function startMatch(first, second, mode) {
  const id = `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const battle = createBattle("local2p", first.character, second.character, Date.now(), fields);
  beginTurn(battle);
  const match = {
    id, mode, players: { p1: first, p2: second }, battle, submitted: {}, revision: 0,
    lastTurn: null, ratingChanges: null, createdAt: Date.now(),
  };
  matches.set(id, match);
  playerMatch.set(first.id, id);
  if (!second.bot) playerMatch.set(second.id, id);
  return match;
}

function queuePlayer(entry, mode) {
  const pool = queues[mode];
  const profile = getProfile(entry.id, entry.name);
  const opponentIndex = pool.findIndex((candidate) => candidate.id !== entry.id &&
    (mode === "casual" || Math.abs(getProfile(candidate.id).rating - profile.rating) <= 250));
  if (opponentIndex >= 0) {
    const opponent = pool.splice(opponentIndex, 1)[0];
    return startMatch(opponent, entry, mode);
  }
  if (!pool.some((candidate) => candidate.id === entry.id)) pool.push({ ...entry, joinedAt: Date.now() });
  return null;
}

function botMove(rating, battle) {
  const level = Math.max(0, Math.min(4, Math.floor((rating - 700) / 225)));
  const available = BOT_MOVES.slice(0, level + 1);
  let move = available[Math.floor(Math.random() * available.length)];
  const side = battle.p2;
  while (!side.lastStandActive && move.replace(/\s+/g, "").length > side.energy && available.length > 1) {
    available.pop();
    move = available[available.length - 1];
  }
  return move;
}

function updateRating(match) {
  if (match.mode !== "ranked" || match.ratingChanges) return;
  const p1 = match.players.p1;
  const p2 = match.players.p2;
  const score = match.battle.winner === "draw" ? 0.5 : match.battle.winner === "p1" ? 1 : 0;
  const expected = 1 / (1 + 10 ** ((p2.rating - p1.rating) / 400));
  const delta = Math.round(32 * (score - expected));
  match.ratingChanges = { p1: delta, p2: -delta };
  for (const [side, player] of [["p1", p1], ["p2", p2]]) {
    if (player.bot) continue;
    const profile = getProfile(player.id, player.name);
    profile.rating = Math.max(0, profile.rating + match.ratingChanges[side]);
    if (match.battle.winner === side) profile.wins += 1;
    else if (match.battle.winner !== "draw") profile.losses += 1;
  }
  saveProfiles();
}

async function resolveMatch(match) {
  if (!match.submitted.p1 || !match.submitted.p2) return;
  const payload = buildJudgePayload(match.battle, match.submitted.p1, match.submitted.p2);
  const judgment = await judgePayload(payload);
  match.battle.log.push({ type: "skill", who: "p1", text: `${match.players.p1.character.name}: ${match.submitted.p1}` });
  match.battle.log.push({ type: "skill", who: "p2", text: `${match.players.p2.character.name}: ${match.submitted.p2}` });
  resolveTurn(match.battle, judgment);
  match.revision += 1;
  match.lastTurn = { revision: match.revision, judgment, texts: { ...match.submitted } };
  match.submitted = {};
  if (match.battle.phase === "over") updateRating(match);
  else beginTurn(match.battle);
}

function matchView(match, playerId) {
  const side = match.players.p1.id === playerId ? "p1" : "p2";
  const opponentSide = side === "p1" ? "p2" : "p1";
  return {
    status: "matched", matchId: match.id, mode: match.mode, side,
    opponent: { name: match.players[opponentSide].name, character: match.players[opponentSide].character,
      rating: match.players[opponentSide].rating, tier: tierFor(match.players[opponentSide].rating), bot: Boolean(match.players[opponentSide].bot) },
    battle: match.battle, submitted: Boolean(match.submitted[side]), revision: match.revision,
    lastTurn: match.lastTurn, ratingChange: match.ratingChanges?.[side] ?? null,
  };
}

function ensureBotIfNeeded(playerId) {
  for (const mode of ["casual", "ranked"]) {
    const index = queues[mode].findIndex((entry) => entry.id === playerId);
    if (index < 0) continue;
    const entry = queues[mode][index];
    if (Date.now() - entry.joinedAt < BOT_WAIT_MS) return null;
    queues[mode].splice(index, 1);
    const profile = getProfile(entry.id, entry.name);
    return startMatch(entry, createBot(profile.rating), mode);
  }
  return null;
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });
  response.end(status === 204 ? "" : JSON.stringify(body));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let raw = "";
    request.on("data", (chunk) => { raw += chunk; if (raw.length > 30_000) reject(new Error("too_large")); });
    request.on("end", () => { try { resolve(JSON.parse(raw || "{}")); } catch (error) { reject(error); } });
  });
}

const server = http.createServer(async (request, response) => {
  if (request.method === "OPTIONS") return sendJson(response, 204, {});
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  try {
    if (request.method === "POST" && url.pathname === "/judge") {
      const payload = await readJson(request);
      const error = validatePayload(payload);
      if (error) return sendJson(response, 400, { error });
      return sendJson(response, 200, await judgePayload(payload));
    }
    if (request.method === "POST" && url.pathname === "/pvp/profile") {
      const body = await readJson(request);
      if (!body.playerId) return sendJson(response, 400, { error: "playerId가 필요합니다." });
      const profile = getProfile(body.playerId, body.name);
      saveProfiles();
      return sendJson(response, 200, { profile: publicProfile(profile) });
    }
    if (request.method === "POST" && url.pathname === "/pvp/queue") {
      const body = await readJson(request);
      if (!body.playerId || !body.character || !["casual", "ranked"].includes(body.mode)) {
        return sendJson(response, 400, { error: "매칭 정보를 확인해 주세요." });
      }
      const oldMatch = playerMatch.get(body.playerId);
      if (oldMatch && matches.get(oldMatch)?.battle.phase === "over") playerMatch.delete(body.playerId);
      const profile = getProfile(body.playerId, body.name || body.character.name);
      const entry = { id: body.playerId, name: profile.name, rating: profile.rating, character: body.character };
      const match = playerMatch.has(body.playerId) ? matches.get(playerMatch.get(body.playerId)) : queuePlayer(entry, body.mode);
      return sendJson(response, 200, match ? matchView(match, body.playerId) : { status: "waiting", profile: publicProfile(profile) });
    }
    if (request.method === "GET" && url.pathname === "/pvp/state") {
      const playerId = url.searchParams.get("playerId");
      let match = matches.get(playerMatch.get(playerId));
      if (!match) match = ensureBotIfNeeded(playerId);
      const profile = profiles[playerId];
      return sendJson(response, 200, match ? matchView(match, playerId) : { status: "waiting", profile: profile ? publicProfile(profile) : null });
    }
    if (request.method === "POST" && url.pathname === "/pvp/action") {
      const body = await readJson(request);
      const match = matches.get(playerMatch.get(body.playerId));
      if (!match || match.battle.phase === "over") return sendJson(response, 409, { error: "진행 중인 대전이 없습니다." });
      const side = match.players.p1.id === body.playerId ? "p1" : "p2";
      if (match.submitted[side]) return sendJson(response, 409, { error: "이미 기술을 제출했습니다." });
      const validation = validateInput(match.battle, side, String(body.text || ""));
      if (!validation.ok) return sendJson(response, 400, { error: validation.reason });
      match.submitted[side] = String(body.text).trim();
      const opponentSide = side === "p1" ? "p2" : "p1";
      const opponent = match.players[opponentSide];
      if (opponent.bot) {
        const move = botMove(opponent.rating, match.battle);
        validateInput(match.battle, opponentSide, move);
        match.submitted[opponentSide] = move;
      }
      await resolveMatch(match);
      return sendJson(response, 200, matchView(match, body.playerId));
    }
    if (request.method === "POST" && url.pathname === "/pvp/leave") {
      const body = await readJson(request);
      for (const pool of Object.values(queues)) {
        const index = pool.findIndex((entry) => entry.id === body.playerId);
        if (index >= 0) pool.splice(index, 1);
      }
      const matchId = playerMatch.get(body.playerId);
      playerMatch.delete(body.playerId);
      const match = matches.get(matchId);
      if (match?.battle.phase === "over") matches.delete(matchId);
      return sendJson(response, 200, { ok: true });
    }
    return sendJson(response, 404, { error: "Not found" });
  } catch {
    return sendJson(response, 400, { error: "요청 내용을 확인해 주세요." });
  }
});

server.listen(PORT, () => {
  const judgeMode = env.MOCK === "1" || !env.OPENAI_API_KEY ? "MOCK" : env.OPENAI_MODEL || "gpt-5-mini";
  console.log(`개초딩게임 서버: http://localhost:${PORT} (판정 ${judgeMode}, 봇 대기 ${BOT_WAIT_MS / 1000}초)`);
});
