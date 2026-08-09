// 계정 프로필(닉네임·점수·기록)을 Supabase와 주고받는다.
// 게스트는 이 파일을 전혀 거치지 않고 기존 localStorage 흐름을 그대로 쓴다.
import { authFetch, getUserId, isLoggedIn } from "./auth.js";
import { FORBIDDEN_WORDS } from "./character.js";
import { loadData, saveData } from "./storage.js";

const NICKNAME_MIN = 2;
const NICKNAME_MAX = 10;

let profile = null;   // 메모리 캐시

export function getProfile() {
  return profile;
}

export function tierFor(rating) {
  if (rating >= 1600) return "다이아몬드";
  if (rating >= 1400) return "플래티넘";
  if (rating >= 1200) return "골드";
  if (rating >= 1000) return "실버";
  return "브론즈";
}

export function validateNickname(nickname) {
  const trimmed = String(nickname ?? "").trim();
  const length = trimmed.replace(/\s+/g, "").length;
  if (length < NICKNAME_MIN || length > NICKNAME_MAX) {
    return { ok: false, reason: `닉네임은 ${NICKNAME_MIN}~${NICKNAME_MAX}자로 입력해 주세요.` };
  }
  const word = FORBIDDEN_WORDS.find((forbidden) => trimmed.includes(forbidden));
  if (word) return { ok: false, reason: `'${word}'는 닉네임에 쓸 수 없습니다.` };
  return { ok: true, value: trimmed };
}

// 로그인 직후 호출한다. 프로필이 없으면 만들고, 게스트 기록을 한 번 승계한다.
export async function loadOrCreateProfile() {
  if (!isLoggedIn()) { profile = null; return null; }
  const id = getUserId();

  const rows = await authFetch(`/profiles?id=eq.${id}&select=*`);
  profile = rows?.[0] ?? null;

  if (!profile) {
    const created = await authFetch("/profiles", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ id }),
    });
    profile = created?.[0] ?? null;
  }

  await inheritGuestRecord();
  return profile;
}

// 게스트로 만든 캐릭터와 보스 진행도를 계정으로 한 번만 올린다.
async function inheritGuestRecord() {
  if (!profile) return;
  const saved = loadData();
  if (saved.account?.inherited) return;

  const patch = {};
  if (!profile.character && saved.character) patch.character = saved.character;
  if (Object.keys(patch).length) {
    const updated = await authFetch(`/profiles?id=eq.${profile.id}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(patch),
    });
    profile = updated?.[0] ?? profile;
  }

  // 게스트가 이미 깬 보스는 점수 보고로 반영한다(첫 격파만 가산되므로 중복 걱정이 없다).
  for (const bossId of saved.progress?.beatenBossIds ?? []) {
    try { await reportBossClear(bossId, 3); } catch { /* 실패해도 게임 진행에는 영향이 없다 */ }
  }

  saved.account = { ...(saved.account ?? {}), inherited: true };
  saveData(saved);
}

export async function setNickname(nickname) {
  const check = validateNickname(nickname);
  if (!check.ok) return check;

  try {
    const updated = await authFetch(`/profiles?id=eq.${getUserId()}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ nickname: check.value }),
    });
    profile = updated?.[0] ?? profile;
    return { ok: true, value: check.value };
  } catch (error) {
    // unique 제약 위반은 중복 닉네임이다.
    const duplicated = /duplicate|unique/i.test(error.message);
    return { ok: false, reason: duplicated ? "이미 사용 중인 닉네임입니다." : error.message };
  }
}

// 캐릭터를 계정에 저장한다(기기를 바꿔도 따라오게).
export async function syncCharacter(character) {
  if (!isLoggedIn() || !profile) return;
  try {
    const updated = await authFetch(`/profiles?id=eq.${profile.id}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ character }),
    });
    profile = updated?.[0] ?? profile;
  } catch { /* 동기화 실패가 게임을 막아서는 안 된다 */ }
}

// 보스 격파 보고. 점수 계산은 서버(DB 함수)가 한다.
export async function reportBossClear(bossId, wounds) {
  if (!isLoggedIn()) return null;
  const result = await authFetch("/rpc/report_boss_clear", {
    method: "POST",
    body: JSON.stringify({ p_boss_id: bossId, p_wounds: wounds }),
  });
  if (result) profile = Array.isArray(result) ? result[0] : result;
  return profile;
}

// 랭크전 결과 보고. 증감 폭은 DB 함수가 ±32로 제한한다.
export async function reportDuelResult(delta, won) {
  if (!isLoggedIn()) return null;
  try {
    const result = await authFetch("/rpc/report_duel_result", {
      method: "POST",
      body: JSON.stringify({ p_delta: delta, p_won: won }),
    });
    if (result) profile = Array.isArray(result) ? result[0] : result;
  } catch { /* 무시 */ }
  return profile;
}

// 랭킹 상위 목록. 비로그인 상태에서도 볼 수 있다.
export async function fetchLeaderboard(limit = 100) {
  return authFetch(`/leaderboard?select=rank,nickname,rating,wins,losses&limit=${limit}`);
}
