// 무지개 7색 보스 데이터와 난이도 규칙을 검증한다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DIFFICULTIES, applyDifficulty, pickSkill } from "../js/boss.js";

const data = JSON.parse(await readFile(new URL("../data/bosses.json", import.meta.url), "utf-8"));
const bosses = data.bosses;

test("보스는 무지개 순서로 일곱 명이다", () => {
  assert.equal(bosses.length, 7);
  assert.deepEqual(bosses.map((boss) => boss.id), [1, 2, 3, 4, 5, 6, 7]);
});

test("일곱 보스의 색이 모두 다르고 무지개 색이다", () => {
  const colors = bosses.map((boss) => boss.color);
  assert.equal(new Set(colors).size, 7);
  for (const color of colors) assert.match(color, /^#[0-9a-f]{6}$/);
});

test("뒤로 갈수록 약해지지 않는다 (부상 한계 단조 증가)", () => {
  for (let i = 1; i < bosses.length; i += 1) {
    assert.ok(bosses[i].endurance >= bosses[i - 1].endurance,
      `${bosses[i].name}(${bosses[i].endurance})가 ${bosses[i - 1].name}(${bosses[i - 1].endurance})보다 약하다`);
  }
  assert.equal(bosses[0].endurance, 2);
  assert.equal(bosses[6].endurance, 5);
});

test("모든 보스가 전투에 필요한 필드를 갖췄다", () => {
  for (const boss of bosses) {
    assert.ok(boss.name && boss.emoji && boss.title && boss.trait && boss.personality, boss.name);
    assert.ok(boss.win_line && boss.lose_line, boss.name);
    assert.ok(boss.skills.length >= 6, `${boss.name} 기술 부족`);
    assert.ok(boss.skills.filter((skill) => skill.enraged).length >= 2, `${boss.name} 분노기 부족`);
    for (const skill of boss.skills) {
      assert.ok(skill.text && skill.tease && skill.element, `${boss.name}: ${skill.text}`);
      const cost = skill.text.replace(/\s+/g, "").length;
      assert.ok(cost <= 22, `${boss.name} 기술이 너무 길다(${cost}자): ${skill.text}`);
    }
  }
});

test("파랑 해일은 물의 장막(보호막)을 두르고 시작한다", () => {
  const wave = bosses.find((boss) => boss.id === 5);
  assert.deepEqual(wave.statuses, ["보호막"]);
});

test("난이도: 쉬움은 한계 -1에 발악 봉인, 어려움은 한계 +1에 기력 100", () => {
  const base = bosses[1];   // 호걸, endurance 3
  const easy = applyDifficulty(base, "easy");
  const normal = applyDifficulty(base, "normal");
  const hard = applyDifficulty(base, "hard");
  assert.equal(easy.endurance, 2);
  assert.equal(easy.lastStandUsed, true);
  assert.equal(normal.endurance, 3);
  assert.equal(normal.lastStandUsed, false);
  assert.equal(normal.energy, 60);
  assert.equal(hard.endurance, 4);
  assert.equal(hard.energy, 100);
});

test("난이도: 한계는 1 밑으로 내려가지 않고, 모르는 키는 보통으로 취급한다", () => {
  assert.equal(applyDifficulty({ endurance: 1 }, "easy").endurance, 1);
  assert.equal(applyDifficulty(bosses[0], "?!").endurance, bosses[0].endurance);
  assert.equal(Object.keys(DIFFICULTIES).length, 3);
});

test("모든 보스가 어떤 상태에서든 기술을 낼 수 있다", () => {
  for (const boss of bosses) {
    for (const wounds of [0, 2]) {
      const state = { wounds, lastStandActive: false, lastSkillId: null };
      const picked = pickSkill(boss, state, () => 0.5);
      assert.ok(picked.skill.text, boss.name);
    }
    const enragedState = { wounds: 3, lastStandActive: true, lastSkillId: null };
    assert.ok(pickSkill(boss, enragedState, () => 0.5).skill.enraged, `${boss.name} 발악 턴에 분노기가 안 나온다`);
  }
});

// ── 보스 고유 기믹 ─────────────────────────────────────────────
const { applyTurnGimmick, applyWoundGimmick } = await import("../js/boss.js");
const { createBattle } = await import("../js/battle.js");

function bossBattle(bossId, turn = 3) {
  const boss = bosses.find((candidate) => candidate.id === bossId);
  const battle = createBattle("boss", { name: "나", trait: "평범", endurance: 3 }, boss, 1, []);
  battle.turn = turn;
  return { boss, battle };
}

test("모든 보스가 기믹을 하나씩 가진다", () => {
  for (const boss of bosses) {
    assert.ok(boss.gimmick?.type && boss.gimmick?.label && boss.gimmick?.text, boss.name);
  }
});

test("홍옥: 3턴마다 제풀에 넘어진다", () => {
  const { boss, battle } = bossBattle(1, 3);
  assert.equal(applyTurnGimmick(boss, battle)?.stumble, true);
  battle.turn = 4;
  assert.equal(applyTurnGimmick(boss, battle), null);
});

test("호걸: 포효가 상대 기력을 10 깎는다", () => {
  const { boss, battle } = bossBattle(2, 3);
  applyTurnGimmick(boss, battle);
  assert.equal(battle.p1.energy, 50);
});

test("미끌: 짝수 턴마다 글자 제한 45", () => {
  const { boss, battle } = bossBattle(3, 4);
  applyTurnGimmick(boss, battle);
  assert.equal(battle.turnLimit, 45);
});

test("브록 장군: 3턴마다 상처 하나 회복 (0이면 발동 안 함)", () => {
  const { boss, battle } = bossBattle(4, 3);
  battle.p2.wounds = 2;
  applyTurnGimmick(boss, battle);
  assert.equal(battle.p2.wounds, 1);
  battle.p2.wounds = 0;
  assert.equal(applyTurnGimmick(boss, battle), null);
});

test("해일: 3턴마다 보호막을 다시 두른다", () => {
  const { boss, battle } = bossBattle(5, 3);
  battle.p2.statuses = [];
  applyTurnGimmick(boss, battle);
  assert.ok(battle.p2.statuses.includes("보호막"));
});

test("미리내: 4턴마다 상대를 혼란시킨다", () => {
  const { boss, battle } = bossBattle(6, 4);
  applyTurnGimmick(boss, battle);
  assert.ok(battle.p1.statuses.includes("혼란"));
});

test("포도대왕: 알이 터질 때마다 기력 +15", () => {
  const { boss, battle } = bossBattle(7, 5);
  battle.p2.energy = 50;
  applyWoundGimmick(boss, battle, 2);
  assert.equal(battle.p2.energy, 80);
  assert.equal(applyWoundGimmick(boss, battle, 0), null);
});

test("기믹은 1턴에는 발동하지 않는다", () => {
  for (const boss of bosses) {
    const { battle } = bossBattle(boss.id, 1);
    battle.turn = 1;
    assert.equal(applyTurnGimmick(boss, battle), null, boss.name);
  }
});
