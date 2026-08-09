import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const port = 8899;
const base = `http://localhost:${port}`;
const server = spawn(process.execPath, ["server/server.mjs"], {
  cwd: new URL("..", import.meta.url),
  env: { ...process.env, PORT: String(port), MOCK: "1", BOT_WAIT_MS: "60" },
  stdio: "ignore",
});

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const post = async (path, body) => {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return response.json();
};

try {
  await wait(450);
  const suffix = Date.now();
  const botPlayer = `bot-test-${suffix}`;
  const character = { name: "검객", trait: "상대의 빈틈을 찾아 불꽃 검으로 벤다" };
  const queued = await post("/pvp/queue", { playerId: botPlayer, name: "검객", character, mode: "ranked" });
  assert.equal(queued.status, "waiting");
  await wait(90);
  let state = await fetch(`${base}/pvp/state?playerId=${botPlayer}`).then((response) => response.json());
  assert.equal(state.status, "matched");
  assert.equal(state.opponent.bot, true);

  while (state.battle.phase !== "over") {
    state = await post("/pvp/action", {
      playerId: botPlayer,
      text: "순간이동으로 등 뒤를 잡아 거대한 화염 검으로 빈틈없이 연속 베기한다",
    });
  }
  assert.ok(state.ratingChange > 0);

  const first = `human-a-${suffix}`;
  const second = `human-b-${suffix}`;
  assert.equal((await post("/pvp/queue", { playerId: first, name: "하나", character, mode: "casual" })).status, "waiting");
  const paired = await post("/pvp/queue", {
    playerId: second,
    name: "둘",
    character: { name: "창객", trait: "번개 창을 정확하게 던진다" },
    mode: "casual",
  });
  assert.equal(paired.status, "matched");
  await post("/pvp/action", { playerId: first, text: "검으로 벤다" });
  const resolved = await post("/pvp/action", { playerId: second, text: "번개 창을 던진다" });
  assert.equal(resolved.revision, 1);
  assert.equal(resolved.ratingChange, null);
  console.log("실시간 매칭·봇·랭크 점수 검증 완료");
} finally {
  server.kill();
}
