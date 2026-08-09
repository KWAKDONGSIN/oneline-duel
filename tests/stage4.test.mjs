import assert from "node:assert/strict";
import fs from "node:fs";
import {
  beginTurn,
  buildJudgePayload,
  createBattle,
  resolveTurn,
  validateInput,
} from "../js/battle.js";
import { pickSkill } from "../js/boss.js";
import { validate } from "../js/character.js";
import { fallbackJudgment } from "../js/judge.js";

const { bosses } = JSON.parse(fs.readFileSync(new URL("../data/bosses.json", import.meta.url), "utf8"));
const { fields } = JSON.parse(fs.readFileSync(new URL("../data/fields.json", import.meta.url), "utf8"));

assert.equal(validate("민수", "몸이 바람처럼 빠르다").ok, true);
assert.equal(validate("민수", "모든 공격을 막는다").word, "모든 공격");
// "모든"이 들어갔다는 이유만으로 정상적인 설정을 막아서는 안 된다.
assert.equal(validate("민수", "모든 것을 걸고 싸우는 검객이다").ok, true);
// 이름에 들어간 금지어도 걸러야 한다.
assert.equal(validate("무적왕", "평범한 검객이다").ok, false);

const player = {
  name: "민수",
  trait: "몸이 바람처럼 빨라 공격을 피하고 등 뒤로 파고드는 것이 특기다",
};
const firstBoss = bosses[0];
const battle = createBattle("boss", player, firstBoss, 42, fields);

while (battle.phase !== "over") {
  beginTurn(battle);
  const { skill } = pickSkill(firstBoss, battle.p2, () => 0);
  const playerText = "화염을 길게 뿜어 짚으로 된 몸 전체를 빈틈없이 태워버린다";
  assert.equal(validateInput(battle, "p1", playerText).ok, true);
  assert.equal(validateInput(battle, "p2", skill.text).ok, true);
  const payload = buildJudgePayload(battle, playerText, skill.text);
  resolveTurn(battle, fallbackJudgment(payload));
  assert.ok(battle.turn <= 12 || battle.phase === "over");
}

assert.equal(battle.winner, "p1");
assert.equal(battle.p2.lastStandUsed, true);
assert.ok(battle.log.some((entry) => entry.type === "narration"));

console.log("보스 1차전 완주 검증 완료");
