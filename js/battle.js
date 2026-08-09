const ALLOWED_STATUSES = new Set(["화상", "감전", "보호막", "혼란"]);

function makeCombatant(definition, isBoss) {
  return {
    name: definition.name,
    trait: definition.trait,
    isBoss,
    personality: definition.personality ?? null,
    endurance: definition.endurance ?? 3,
    wounds: definition.wounds ?? 0,
    statuses: [...(definition.statuses ?? [])],
    energy: definition.energy ?? 60,
    lastStandUsed: definition.lastStandUsed ?? false,
    lastStandActive: definition.lastStandActive ?? false,
    recoverUsed: definition.recoverUsed ?? 0,
    lastSkillId: definition.lastSkillId ?? null,
  };
}

export function mulberry32(seed) {
  let value = seed >>> 0;
  return function random() {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

export function dailySeed(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value ?? "00";
  return Number(`${get("year")}${get("month")}${get("day")}`);
}

function shuffled(items, seed) {
  const result = [...items];
  const random = seed == null ? Math.random : mulberry32(seed);
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

export function createBattle(mode, p1Def, p2Def, seed, fields = []) {
  const actualSeed = mode === "daily" ? dailySeed() : seed;
  return {
    mode,
    turn: 1,
    maxTurn: 12,
    fieldQueue: shuffled(fields, actualSeed),
    field: null,
    p1: makeCombatant(p1Def, false),
    p2: makeCombatant(p2Def, true),
    log: [],
    phase: "input",
    winner: null,
  };
}

export function beginTurn(battle) {
  if (battle.turn !== 1) {
    battle.p1.energy = Math.min(100, battle.p1.energy + 40);
    battle.p2.energy = Math.min(100, battle.p2.energy + 40);
  }

  let field = null;
  if ((battle.turn - 1) % 3 === 0 && battle.fieldQueue.length) {
    field = battle.fieldQueue.shift();
    battle.field = field;
    battle.log.push({
      type: "system",
      who: null,
      text: `🃏 필드 변경 — ${field.name}: ${field.desc}`,
    });
  }

  return { field, tease: null };
}

// ── 히든 기믹: 무지개 반사 ─────────────────────────────────────
// 게임 제목이 곧 필살기다. 어릴 적 말싸움에서 무엇이 날아오든 되돌려 보내던 그 말을
// 그대로 규칙으로 옮겼다. 이 문장만은 심판을 거치지 않고 즉시 승부를 끝낸다.
// 안내는 어디에도 없다. 제목을 보고 떠올린 사람만 쓸 수 있는 비밀이다.
const RAINBOW_PHRASE = "무지개반사";

export function isRainbowReflect(text) {
  return typeof text === "string" && text.replace(/\s+/g, "") === RAINBOW_PHRASE;
}

// 판정도, 기력 소모도, 마지막 발악도 없다. 무지개 반사 앞에서는 전부 되돌아간다.
export function resolveRainbow(battle, side) {
  const opponentSide = side === "p1" ? "p2" : "p1";
  const opponent = battle[opponentSide];

  opponent.wounds = opponent.endurance;
  opponent.lastStandActive = false;
  opponent.lastStandUsed = true;
  battle.winner = side;
  battle.phase = "over";

  battle.log.push({ type: "skill", who: side, text: `${battle[side].name}: 무지개 반사` });
  battle.log.push({
    type: "narration",
    who: null,
    text: `🌈 일곱 빛깔이 펼쳐진다. ${opponent.name}이(가) 내민 모든 것이 그대로 되돌아갔다.`,
  });

  return { events: [{ type: "rainbow", side }], result: null };
}

export function countText(text) {
  return text.replace(/\s+/g, "").length;
}

export function inputCost(combatant, text) {
  const base = countText(text);
  return combatant.statuses.includes("감전") ? Math.ceil(base * 1.3) : base;
}

export function validateInput(battle, side, text) {
  const combatant = battle[side];
  const baseCost = countText(text);
  const cost = inputCost(combatant, text);
  const maxLen = combatant.lastStandActive ? 100 : combatant.statuses.includes("혼란") ? 30 : 60;

  if (!text.trim() || baseCost > maxLen) return { ok: false, cost, reason: "length" };
  if (!combatant.lastStandActive && cost > combatant.energy) return { ok: false, cost, reason: "energy" };

  if (!combatant.lastStandActive) combatant.energy -= cost;
  return { ok: true, cost, reason: null };
}

export function buildJudgePayload(battle, p1Text, p2Text) {
  const toPayload = (combatant, text) => ({
    name: combatant.name,
    trait: combatant.trait,
    wounds: combatant.wounds,
    statuses: [...combatant.statuses],
    last_stand: combatant.lastStandActive,
    text,
    cost: inputCost(combatant, text),
    ...(combatant.personality ? { personality: combatant.personality } : {}),
  });

  return {
    mode: battle.mode,
    field: battle.field ? `${battle.field.name}: ${battle.field.desc}` : "",
    turn: battle.turn,
    p1: toPayload(battle.p1, p1Text),
    p2: toPayload(battle.p2, p2Text),
  };
}

function clampInteger(value, minimum, maximum) {
  const integer = Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : 0;
  return Math.min(maximum, Math.max(minimum, integer));
}

function normalizeSide(raw, combatant) {
  return {
    wound: clampInteger(raw?.wound, 0, 2),
    recover: combatant.recoverUsed >= 2 ? 0 : clampInteger(raw?.recover, 0, 1),
    add_statuses: Array.isArray(raw?.add_statuses)
      ? raw.add_statuses.filter((status) => ALLOWED_STATUSES.has(status)).slice(0, 1)
      : [],
    shout: typeof raw?.shout === "string" ? raw.shout : "",
  };
}

export function resolveTurn(battle, judgeResult) {
  const lastStandAtStart = {
    p1: battle.p1.lastStandActive,
    p2: battle.p2.lastStandActive,
  };
  const oldStatuses = {
    p1: [...battle.p1.statuses],
    p2: [...battle.p2.statuses],
  };
  const result = {
    p1: normalizeSide(judgeResult?.p1, battle.p1),
    p2: normalizeSide(judgeResult?.p2, battle.p2),
  };
  const events = [];

  for (const side of ["p1", "p2"]) {
    const combatant = battle[side];
    if (combatant.statuses.includes("보호막") && result[side].wound > 0) {
      result[side].wound = 0;
      combatant.statuses = combatant.statuses.filter((status) => status !== "보호막");
      oldStatuses[side] = oldStatuses[side].filter((status) => status !== "보호막");
      battle.log.push({ type: "system", who: side, text: "보호막이 깨졌다!" });
      events.push({ type: "shield_break", side, text: "보호막이 깨졌다!" });
    }
  }

  const addedStatuses = { p1: [], p2: [] };
  for (const side of ["p1", "p2"]) {
    const combatant = battle[side];
    const sideResult = result[side];
    if (sideResult.recover > 0) {
      combatant.wounds = Math.max(0, combatant.wounds - sideResult.recover);
      combatant.recoverUsed += 1;
    }
    combatant.wounds = Math.min(combatant.endurance, combatant.wounds + sideResult.wound);
    for (const status of sideResult.add_statuses) {
      if (!combatant.statuses.includes(status)) {
        combatant.statuses.push(status);
        addedStatuses[side].push(status);
      }
    }
  }

  battle.phase = "animating";
  events.push({ type: "play", motions: judgeResult?.motions ?? [], effects: judgeResult?.effects ?? [] });
  if (judgeResult?.narration) {
    battle.log.push({ type: "narration", who: null, text: judgeResult.narration });
    events.push({ type: "narration", text: judgeResult.narration });
  }
  for (const side of ["p1", "p2"]) {
    if (result[side].shout) events.push({ type: "shout", side, text: result[side].shout });
  }

  const defeated = new Set();
  for (const side of ["p1", "p2"]) {
    const opponent = side === "p1" ? "p2" : "p1";
    const combatant = battle[side];

    if (lastStandAtStart[side]) {
      if (result[opponent].wound >= 1) {
        combatant.wounds = combatant.endurance - 1;
        combatant.lastStandActive = false;
        const text = `믿을 수 없는 일이! ${combatant.name}이(가) 다시 일어난다!`;
        battle.log.push({ type: "system", who: side, text });
        events.push({ type: "revive", side, text });
      } else {
        defeated.add(side);
      }
      continue;
    }

    if (combatant.wounds >= combatant.endurance) {
      if (!combatant.lastStandUsed) {
        combatant.lastStandActive = true;
        combatant.lastStandUsed = true;
        combatant.wounds = combatant.endurance;
        events.push({ type: "last_stand", side });
      } else {
        defeated.add(side);
      }
    }
  }

  if (defeated.size === 2) {
    battle.winner = "draw";
  } else if (defeated.has("p1")) {
    battle.winner = "p2";
  } else if (defeated.has("p2")) {
    battle.winner = "p1";
  } else if (battle.turn + 1 > battle.maxTurn) {
    battle.winner = battle.p1.wounds < battle.p2.wounds ? "p1"
      : battle.p2.wounds < battle.p1.wounds ? "p2" : "draw";
  }

  for (const side of ["p1", "p2"]) {
    battle[side].statuses = battle[side].statuses.filter((status) =>
      addedStatuses[side].includes(status) && !oldStatuses[side].includes(status));
  }

  if (battle.winner) {
    battle.phase = "over";
  } else {
    battle.turn += 1;
    battle.phase = "input";
  }

  return { events, result };
}
