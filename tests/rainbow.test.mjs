// 히든 기믹 "무지개 반사"가 어떤 상황에서도 즉시 승리로 끝나는지 검증한다.
import test from "node:test";
import assert from "node:assert/strict";
import { createBattle, isRainbowReflect, resolveRainbow } from "../js/battle.js";

const P1 = { name: "나", trait: "평범하다", endurance: 3 };
const P2 = { name: "묵혼", trait: "최종보스다", endurance: 5 };

function battle() {
  return createBattle("boss", P1, P2, 1, []);
}

test("띄어쓰기와 무관하게 인식한다", () => {
  for (const text of ["무지개 반사", "무지개반사", "  무지개   반사  ", "무지개\t반사"]) {
    assert.equal(isRainbowReflect(text), true, text);
  }
});

test("비슷하지만 다른 문장은 발동하지 않는다", () => {
  for (const text of ["무지개", "반사", "무지개 반사!", "무지개 반사한다", "무지개 대반사", "", "rainbow"]) {
    assert.equal(isRainbowReflect(text), false, text);
  }
});

test("문자열이 아니어도 터지지 않는다", () => {
  for (const value of [null, undefined, 0, {}, []]) {
    assert.equal(isRainbowReflect(value), false);
  }
});

test("쓴 쪽이 즉시 이긴다", () => {
  const state = battle();
  resolveRainbow(state, "p1");
  assert.equal(state.winner, "p1");
  assert.equal(state.phase, "over");
});

test("보스의 마지막 발악도 통하지 않는다", () => {
  const state = battle();
  state.p2.lastStandActive = true;
  state.p2.lastStandUsed = false;
  resolveRainbow(state, "p1");
  assert.equal(state.winner, "p1");
  assert.equal(state.p2.lastStandActive, false);
  assert.equal(state.p2.wounds, state.p2.endurance);
});

test("내가 빈사여도 이긴다", () => {
  const state = battle();
  state.p1.wounds = state.p1.endurance - 1;
  state.p1.energy = 0;
  resolveRainbow(state, "p1");
  assert.equal(state.winner, "p1");
});

test("보스가 쓰면 보스가 이긴다", () => {
  const state = battle();
  resolveRainbow(state, "p2");
  assert.equal(state.winner, "p2");
});

test("기력을 소모하지 않는다", () => {
  const state = battle();
  const before = state.p1.energy;
  resolveRainbow(state, "p1");
  assert.equal(state.p1.energy, before);
});

test("로그에 사용 기록과 연출 문구가 남는다", () => {
  const state = battle();
  resolveRainbow(state, "p1");
  const texts = state.log.map((entry) => entry.text).join("\n");
  assert.match(texts, /무지개 반사/);
  assert.match(texts, /묵혼/);
});

test("반사 이벤트를 돌려준다", () => {
  const state = battle();
  const { events } = resolveRainbow(state, "p1");
  assert.deepEqual(events, [{ type: "rainbow", side: "p1" }]);
});
