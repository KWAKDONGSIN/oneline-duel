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
