// 난이도는 보스의 몸에만 손을 댄다. 판정 규칙은 어디서나 같아야 공정하다.
// 쉬움: 부상 한계 -1에 마지막 발악도 없다. 어려움: 한계 +1에 시작 기력이 가득 차 있다.
export const DIFFICULTIES = {
  easy:   { key: "easy",   label: "쉬움",   desc: "보스가 한 대 덜 버티고, 마지막 발악도 하지 않습니다.", endurance: -1, lastStand: false, energy: 60 },
  normal: { key: "normal", label: "보통",   desc: "설계된 그대로의 승부입니다.", endurance: 0, lastStand: true, energy: 60 },
  hard:   { key: "hard",   label: "어려움", desc: "보스가 한 대 더 버티고, 시작부터 기력이 가득합니다.", endurance: 1, lastStand: true, energy: 100 },
};

export function applyDifficulty(boss, key) {
  const difficulty = DIFFICULTIES[key] ?? DIFFICULTIES.normal;
  return {
    ...boss,
    endurance: Math.max(1, boss.endurance + difficulty.endurance),
    energy: difficulty.energy,
    lastStandUsed: !difficulty.lastStand,
  };
}

export function pickSkill(boss, state, random = Math.random) {
  const indexed = boss.skills.map((skill, index) => ({ skill, index }));
  let candidates = indexed.filter(({ index }) => index !== state.lastSkillId);
  const wantsEnraged = state.lastStandActive || state.wounds >= 2;
  const enraged = candidates.filter(({ skill }) => skill.enraged);
  const normal = candidates.filter(({ skill }) => !skill.enraged);

  if (state.lastStandActive && enraged.length) candidates = enraged;
  else if (wantsEnraged && enraged.length) candidates = enraged;
  else if (normal.length) candidates = normal;

  const picked = candidates[Math.floor(random() * candidates.length)] ?? indexed[0];
  state.lastSkillId = picked.index;
  return { skill: picked.skill, tease: picked.skill.tease };
}
