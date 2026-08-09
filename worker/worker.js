// 배포용 판정 서버 (Cloudflare Workers). 로컬 server.mjs의 /judge와 같은 인터페이스를 제공한다.
// API 키는 코드에 넣지 말고 `wrangler secret put OPENAI_API_KEY`로 등록한다.
// 주의: 온라인 대전(/pvp/*)은 상태가 필요해 여기서는 제공하지 않는다. 보스전 판정 전용이다.
import { JUDGE_PROMPT, JUDGMENT_SCHEMA } from "./judge-prompt.js";

// 한 턴에 판정 1회다. 정상 플레이는 막지 않으면서 남용만 차단하는 값으로 잡는다.
const RATE_PER_MINUTE = 20;
const RATE_PER_DAY = 300;
const buckets = new Map();

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  });
}

// 같은 인스턴스 안에서만 유지되는 간이 제한이다. 완벽하진 않지만 무제한 호출은 막아 준다.
function rateLimited(ip) {
  const now = Date.now();
  const bucket = buckets.get(ip) || { minute: [], day: [] };
  bucket.minute = bucket.minute.filter((time) => now - time < 60_000);
  bucket.day = bucket.day.filter((time) => now - time < 86_400_000);
  if (bucket.minute.length >= RATE_PER_MINUTE || bucket.day.length >= RATE_PER_DAY) {
    buckets.set(ip, bucket);
    return true;
  }
  bucket.minute.push(now);
  bucket.day.push(now);
  buckets.set(ip, bucket);
  if (buckets.size > 2_000) buckets.clear();
  return false;
}

function validatePayload(payload) {
  if (!payload || !["boss", "local2p", "daily"].includes(payload.mode) || !Number.isInteger(payload.turn)) {
    return "필수 전투 정보가 없습니다.";
  }
  for (const side of ["p1", "p2"]) {
    const fighter = payload[side];
    if (!fighter || typeof fighter.name !== "string" || typeof fighter.trait !== "string"
      || typeof fighter.text !== "string" || !Number.isFinite(fighter.cost)) {
      return `${side} 정보가 올바르지 않습니다.`;
    }
    if (fighter.text.replace(/\s+/g, "").length > (fighter.last_stand ? 100 : 60)) {
      return `${side} 기술이 글자 제한을 넘었습니다.`;
    }
    if (fighter.trait.length > 200) return `${side} 속성이 너무 깁니다.`;
  }
  return null;
}

function userMessage(payload) {
  const woundName = (wounds) => ["건재", "경상", "중상", "빈사"][Math.min(3, wounds ?? 0)] || "건재";
  const fighter = (side) => {
    const data = payload[side];
    return `[${side}] 이름:${data.name} 속성:${data.trait}\n`
      + `부상:${data.wounds ?? 0}(${woundName(data.wounds)}) 상태:${(data.statuses || []).join(",") || "없음"} `
      + `발악:${data.last_stand ? "예" : "아니오"} 코스트:${data.cost}`
      + `${data.personality ? ` 말투:${data.personality}` : ""}\n기술: ${data.text}`;
  };
  return `[필드] ${payload.field || "없음"}\n[턴] ${payload.turn}\n${fighter("p1")}\n${fighter("p2")}`;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    const url = new URL(request.url);
    if (url.pathname === "/health") return json({ ok: true });
    if (request.method !== "POST" || url.pathname !== "/judge") return json({ error: "Not found" }, 404);

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (rateLimited(ip)) return json({ error: "요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요." }, 429);

    let payload;
    try { payload = await request.json(); } catch { return json({ error: "요청 내용을 확인해 주세요." }, 400); }
    const invalid = validatePayload(payload);
    if (invalid) return json({ error: invalid }, 400);

    if (!env.OPENAI_API_KEY) return json({ error: "판정 서버에 API 키가 설정되지 않았습니다." }, 503);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: env.OPENAI_MODEL || "gpt-5-mini",
          instructions: JUDGE_PROMPT,
          input: userMessage(payload),
          // 추론 모델은 내부 추론에도 토큰을 쓴다. 한도가 빠듯하면 정작 출력이 비어서 돌아온다.
          max_output_tokens: 2000,
          reasoning: { effort: "low" },
          text: { format: { type: "json_schema", name: "judgment", strict: true, schema: JUDGMENT_SCHEMA } },
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        return json({ error: `판정 모델 오류 (${response.status})`, detail: detail.slice(0, 300) }, 502);
      }
      const body = await response.json();
      const outputText = body.output_text
        || body.output?.flatMap((item) => item.content || [])
          .find((content) => content.type === "output_text")?.text;
      if (!outputText) {
        // 왜 비었는지 알 수 있게 상태를 함께 돌려준다 (토큰 소진인지, 안전 필터인지 등).
        return json({
          error: "판정 결과가 비어 있습니다.",
          status: body.status,
          incomplete: body.incomplete_details,
        }, 502);
      }
      return json(JSON.parse(outputText));
    } catch {
      // 클라이언트가 약식 판정으로 넘어가도록 오류를 그대로 알린다.
      return json({ error: "판정 서버가 응답하지 않았습니다." }, 502);
    } finally {
      clearTimeout(timer);
    }
  },
};
