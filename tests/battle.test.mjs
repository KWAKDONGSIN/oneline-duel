import assert from "node:assert/strict";
import {
  beginTurn,
  buildJudgePayload,
  createBattle,
  resolveTurn,
  validateInput,
} from "../js/battle.js";
import { fallbackJudgment } from "../js/judge.js";

const fields = [
  { id: 1, name: "첫 필드", desc: "첫 효과" },
  { id: 2, name: "둘째 필드", desc: "둘째 효과" },
];
const p1 = { name: "민수", trait: "빠르다" };
const p2 = { name: "짚단", trait: "짚이다", endurance: 2, personality: "정중하다" };

{
  const battle = createBattle("boss", p1, p2, 1, fields);
  const started = beginTurn(battle);
  assert.ok(started.field);
  assert.equal(battle.p1.energy, 60);
  assert.equal(validateInput(battle, "p1", "검 으로 벤다").cost, 5);
  assert.equal(battle.p1.energy, 55);
  const payload = buildJudgePayload(battle, "검으로 벤다", "주먹을 휘두른다");
  assert.equal(payload.p1.trait, "빠르다");
  assert.equal(payload.p2.personality, "정중하다");
}

{
  const battle = createBattle("boss", p1, p2, 2, fields);
  battle.p1.statuses = ["감전", "혼란"];
  assert.equal(validateInput(battle, "p1", "가".repeat(31)).reason, "length");
  assert.equal(validateInput(battle, "p1", "가".repeat(10)).cost, 13);
}

{
  const battle = createBattle("boss", p1, p2, 3, fields);
  battle.p2.statuses = ["보호막"];
  resolveTurn(battle, {
    narration: "충돌한다.",
    p1: { wound: 0, recover: 0, add_statuses: ["화상"], shout: "" },
    p2: { wound: 2, recover: 0, add_statuses: [], shout: "" },
  });
  assert.equal(battle.p2.wounds, 0);
  assert.deepEqual(battle.p1.statuses, ["화상"]);
}

{
  const battle = createBattle("boss", p1, p2, 4, fields);
  battle.p2.wounds = 1;
  resolveTurn(battle, {
    narration: "짚단이 쓰러진다.",
    p1: { wound: 0, recover: 0, add_statuses: [], shout: "" },
    p2: { wound: 1, recover: 0, add_statuses: [], shout: "" },
  });
  assert.equal(battle.p2.lastStandActive, true);
  assert.equal(battle.phase, "input");

  resolveTurn(battle, {
    narration: "마지막 반격이다.",
    p1: { wound: 1, recover: 0, add_statuses: [], shout: "" },
    p2: { wound: 0, recover: 0, add_statuses: [], shout: "" },
  });
  assert.equal(battle.p2.lastStandActive, false);
  assert.equal(battle.p2.wounds, 1);
}

{
  const payload = {
    p1: { name: "민수", text: "불꽃 검으로 길게 베어낸다", cost: 20 },
    p2: { name: "짚단", text: "주먹", cost: 2 },
  };
  const result = fallbackJudgment(payload);
  assert.equal(result.p2.wound, 2);
  assert.equal(result.motions[1].motion, "flame");

  const dragonResult = fallbackJudgment({
    p1: { name: "민수", text: "거대한 용을 소환해 화염을 내뿜는다", cost: 18 },
    p2: { name: "짚단", text: "주먹", cost: 2 },
  });
  assert.deepEqual(dragonResult.motions.slice(1).map(({ motion }) => motion), ["summon", "flame"]);
}

console.log("전투 로직 검증 완료");
