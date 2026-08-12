// 문장 벡터 유사도와 필살기 느슨한 매칭을 검증한다.
// 핵심은 두 가지다 — 어미가 조금 바뀌어도 발동하고, 뜻이 다르면 절대 발동하지 않는다.
import test from "node:test";
import assert from "node:assert/strict";
import { bestMatch, similarity, vectorize } from "../js/similarity.js";
import { findTrainedSkill } from "../js/battle.js";

const trained = [
  { name: "물의 벽", text: "호수의 물을 끌어올려 거대한 물의 벽으로 모든 것을 막는다", element: "water" },
  { name: "되돌리기", text: "날아오는 모든 것을 정면으로 받아 그대로 되돌려 보낸다", element: "light" },
];

test("같은 문장의 유사도는 1이다", () => {
  assert.ok(similarity("불꽃을 뿜는다", "불꽃을 뿜는다") > 0.9999);
});

test("겹치는 글자가 없으면 0이다", () => {
  assert.equal(similarity("가나다", "라마바"), 0);
});

test("빈 문장은 0이고 터지지 않는다", () => {
  assert.equal(similarity("", "불꽃"), 0);
  assert.equal(similarity(null, undefined), 0);
});

test("벡터는 글자 2-gram으로 만든다", () => {
  const vector = vectorize("가나다");
  assert.deepEqual([...vector.keys()], ["가나", "나다"]);
});

test("어미만 바뀐 문장은 발동한다", () => {
  const near = "호수의 물을 끌어올려 거대한 물의 벽으로 모든 것을 막았다";
  assert.ok(similarity(trained[0].text, near) > 0.9, "유사도가 충분해야 한다");
  assert.equal(findTrainedSkill(near, trained)?.name, "물의 벽");
});

test("어절 하나가 빠져도 발동한다", () => {
  assert.equal(findTrainedSkill("호수의 물을 끌어올려 거대한 물의 벽으로 막는다", trained)?.name, "물의 벽");
});

test("뜻이 다른 문장은 발동하지 않는다", () => {
  for (const text of [
    "불꽃을 뿜어 상대를 태운다",
    "번개를 내리쳐 감전시킨다",
    "호수를 바라본다",
    "물",
  ]) {
    assert.equal(findTrainedSkill(text, trained), null, text);
  }
});

test("여러 필살기 중 더 닮은 쪽을 고른다", () => {
  const picked = findTrainedSkill("날아오는 모든 것을 정면으로 받아 그대로 되돌린다", trained);
  assert.equal(picked?.name, "되돌리기");
});

test("문턱을 넘지 못하면 bestMatch는 null을 준다", () => {
  assert.equal(bestMatch("전혀 다른 문장이다", trained, (skill) => skill.text), null);
});

test("빈 목록·빈 입력에서도 안전하다", () => {
  assert.equal(findTrainedSkill("아무거나", []), null);
  assert.equal(findTrainedSkill("", trained), null);
  assert.equal(findTrainedSkill(null, trained), null);
});
