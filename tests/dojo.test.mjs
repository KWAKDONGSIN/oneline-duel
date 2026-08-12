// 훈련소 필살기 매칭 규칙을 검증한다.
import test from "node:test";
import assert from "node:assert/strict";
import { findTrainedSkill } from "../js/battle.js";

const trained = [
  { name: "되돌리기", text: "날아오는 모든 것을 정면으로 되받아친다", element: "light" },
  { name: "물의 벽", text: "호수의 물을 끌어올려 거대한 물의 벽으로 막는다", element: "water" },
];

test("등록 문장과 정확히 일치하면 찾는다", () => {
  assert.equal(findTrainedSkill("날아오는 모든 것을 정면으로 되받아친다", trained)?.name, "되돌리기");
});

test("공백 차이는 무시한다", () => {
  assert.equal(findTrainedSkill("호수의물을끌어올려거대한 물의벽으로막는다", trained)?.name, "물의 벽");
});

test("일부만 같으면 발동하지 않는다", () => {
  assert.equal(findTrainedSkill("날아오는 모든 것을 되받아친다", trained), null);
  assert.equal(findTrainedSkill("호수의 물을 끌어올린다", trained), null);
});

test("빈 입력과 빈 목록은 안전하다", () => {
  assert.equal(findTrainedSkill("", trained), null);
  assert.equal(findTrainedSkill("아무거나", []), null);
  assert.equal(findTrainedSkill(null, trained), null);
});
