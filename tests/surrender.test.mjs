// 항복 규칙을 검증한다. 클라이언트(보스전)와 서버(온라인전)가 같은 함수를 쓴다.
import test from "node:test";
import assert from "node:assert/strict";
import { createBattle, surrender } from "../js/battle.js";

function battle() {
  return createBattle("boss", { name: "나", trait: "평범", endurance: 3 }, { name: "홍옥", trait: "사과", endurance: 2 }, 1, []);
}

test("항복하면 상대가 즉시 이긴다", () => {
  const state = battle();
  surrender(state, "p1");
  assert.equal(state.winner, "p2");
  assert.equal(state.phase, "over");
});

test("상대가 항복하면 내가 이긴다", () => {
  const state = battle();
  surrender(state, "p2");
  assert.equal(state.winner, "p1");
});

test("부상과 턴 수는 그대로 남는다", () => {
  const state = battle();
  state.turn = 5;
  state.p1.wounds = 2;
  surrender(state, "p1");
  assert.equal(state.turn, 5);
  assert.equal(state.p1.wounds, 2);
});

test("항복 기록이 로그에 남는다", () => {
  const state = battle();
  surrender(state, "p1");
  const last = state.log.at(-1);
  assert.equal(last.type, "system");
  assert.match(last.text, /^🏳️ 나이\(가\) 항복했다\.$/);
});
