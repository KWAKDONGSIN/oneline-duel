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

// ── 보스 고유 기믹 ─────────────────────────────────────────────
// 무지개 보스는 저마다 판을 비트는 버릇이 하나씩 있다. 판정과 무관하게
// 정해진 턴마다 확실하게 발동해서, 플레이어가 패턴을 읽고 대비할 수 있다.

// 턴 시작 기믹. battle을 직접 손보고, 로그에 남길 문구와 특수 지시를 돌려준다.
export function applyTurnGimmick(boss, battle) {
  const gimmick = boss.gimmick;
  if (!gimmick?.every || battle.turn < 2 || battle.turn % gimmick.every !== 0) return null;
  switch (gimmick.type) {
    case "stumble":   // 홍옥: 제풀에 넘어져 이번 턴 공격을 날린다
      return { text: gimmick.text, stumble: true };
    case "roar":      // 호걸: 포효로 상대 기력을 깎는다
      battle.p1.energy = Math.max(0, battle.p1.energy - gimmick.drain);
      return { text: gimmick.text };
    case "slippery":  // 미끌: 껍질 함정으로 이번 턴 글자 제한을 줄인다
      battle.turnLimit = gimmick.limit;
      return { text: gimmick.text };
    case "heal":      // 브록 장군: 광합성으로 상처를 아물린다
      if (battle.p2.wounds > 0) { battle.p2.wounds -= 1; return { text: gimmick.text }; }
      return null;
    case "shield":    // 해일: 물의 장막을 다시 두른다
      if (!battle.p2.statuses.includes("보호막")) { battle.p2.statuses.push("보호막"); return { text: gimmick.text }; }
      return null;
    case "confuse":   // 미리내: 어둠으로 방향을 잃게 한다 (이번 턴 30자 제한)
      if (!battle.p1.statuses.includes("혼란")) { battle.p1.statuses.push("혼란"); return { text: gimmick.text }; }
      return null;
    default:
      return null;
  }
}

// 부상 기믹. 포도대왕은 알이 터질 때마다 진노해 기력이 차오른다.
export function applyWoundGimmick(boss, battle, woundsTaken) {
  const gimmick = boss.gimmick;
  if (gimmick?.type !== "rage" || woundsTaken <= 0) return null;
  battle.p2.energy = Math.min(100, battle.p2.energy + gimmick.gain * woundsTaken);
  return { text: gimmick.text };
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
