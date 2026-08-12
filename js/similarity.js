// 문장을 벡터로 바꿔 유사도를 재는 모듈. 필살기를 토씨 하나까지 똑같이 쳐야만
// 발동하면 쓸 수 없는 기능이 되므로, 뜻이 통하면 발동하도록 느슨하게 맞춘다.
//
// 왜 pgvector 같은 벡터 DB를 쓰지 않았나:
//   - 임베딩 모델 호출이 필요해 매 입력마다 네트워크 왕복이 하나 더 붙는다.
//     이 게임은 이미 판정에 수 초를 쓰고 있어 지연을 더 늘릴 수 없다.
//   - 보스전은 서버 없이도 끝까지 플레이된다. DB 조회를 끼우면 그 성질이 깨진다.
//   - 비교 대상이 필살기 3개다. 수백만 건을 위한 색인 구조가 필요한 규모가 아니다.
// 그래서 벡터 유사도라는 기법만 가져오고, 계산은 브라우저에서 직접 한다.
// 한국어는 어미·조사가 자주 바뀌므로 형태소 대신 글자 2-gram을 쓴다.

export function vectorize(text) {
  const clean = String(text ?? "").replace(/\s+/g, "");
  const vector = new Map();
  if (clean.length === 1) vector.set(clean, 1);   // 한 글자짜리도 비교는 되게 한다
  for (let index = 0; index < clean.length - 1; index += 1) {
    const gram = clean.slice(index, index + 2);
    vector.set(gram, (vector.get(gram) ?? 0) + 1);
  }
  return vector;
}

function magnitude(vector) {
  let sum = 0;
  for (const count of vector.values()) sum += count * count;
  return Math.sqrt(sum);
}

// 두 벡터가 이루는 각도로 닮은 정도를 잰다. 1이면 같은 문장, 0이면 겹치는 부분이 없다.
export function cosineSimilarity(a, b) {
  let dot = 0;
  for (const [gram, count] of a) {
    const other = b.get(gram);
    if (other) dot += count * other;
  }
  const scale = magnitude(a) * magnitude(b);
  return scale ? dot / scale : 0;
}

export function similarity(textA, textB) {
  return cosineSimilarity(vectorize(textA), vectorize(textB));
}

// 후보 중 가장 닮은 것을 고른다. 문턱을 넘지 못하면 아무것도 고르지 않는다.
// 문턱 0.68은 실측 기준: 어미만 바뀐 문장 0.8 이상, 뜻이 다른 문장 0.4 미만.
export function bestMatch(text, candidates, getText, threshold = 0.68) {
  const target = vectorize(text);
  if (!target.size) return null;
  let best = null;
  let bestScore = 0;
  for (const candidate of candidates) {
    const score = cosineSimilarity(target, vectorize(getText(candidate)));
    if (score > bestScore) { bestScore = score; best = candidate; }
  }
  return bestScore >= threshold ? { match: best, score: bestScore } : null;
}
