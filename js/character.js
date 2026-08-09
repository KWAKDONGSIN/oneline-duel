export const CHARACTER_EXAMPLES = [
  { name: "민수", trait: "몸이 바람처럼 빨라 공격을 피하고 등 뒤로 파고드는 것이 특기다" },
  { name: "철수", trait: "눈치가 빨라 상대의 행동을 한 발 먼저 예측한다" },
  { name: "봉식", trait: "맷집이 좋아 어지간한 충격은 웃으며 버틴다" },
];

// 무조건 이기는 설정만 막는다. "모든"처럼 흔한 낱말을 통째로 막으면 정상적인 설정까지 거부된다.
// 닉네임 검사(js/account.js)에서도 같은 목록을 재사용한다.
export const FORBIDDEN_WORDS = [
  "무적", "즉사", "절대", "심판",
  "모든 공격", "모든 기술", "전부 무효", "반드시 이긴", "항상 이긴",
];

export function validate(name, trait) {
  const nameLength = name.replace(/\s+/g, "").length;
  const traitLength = trait.replace(/\s+/g, "").length;
  const word = FORBIDDEN_WORDS.find((forbidden) => trait.includes(forbidden) || name.includes(forbidden));

  if (word) return { ok: false, word, reason: "forbidden" };
  if (nameLength < 1 || nameLength > 6) return { ok: false, word: null, reason: "name" };
  if (traitLength < 1 || traitLength > 100) return { ok: false, word: null, reason: "trait" };
  return { ok: true, word: null, reason: null };
}
