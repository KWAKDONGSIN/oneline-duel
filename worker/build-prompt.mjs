// JUDGE_PROMPT.md를 Worker가 import할 수 있는 JS 모듈로 굽는다. 프롬프트를 고치면 다시 실행한다.
// 사용법: node worker/build-prompt.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WORKER_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.dirname(WORKER_DIR);

const markdown = fs.readFileSync(path.join(ROOT_DIR, "JUDGE_PROMPT.md"), "utf8");
const schemaMatch = markdown.match(/## 응답 JSON 스키마[\s\S]*?```json\s*([\s\S]*?)```/);
if (!schemaMatch) throw new Error("JUDGE_PROMPT.md에서 응답 스키마를 찾지 못했습니다.");
const schema = JSON.parse(schemaMatch[1]);

const output = `// 이 파일은 자동 생성됩니다. 직접 고치지 말고 worker/build-prompt.mjs를 실행하세요.
export const JUDGE_PROMPT = ${JSON.stringify(markdown)};
export const JUDGMENT_SCHEMA = ${JSON.stringify(schema, null, 2)};
`;

fs.writeFileSync(path.join(WORKER_DIR, "judge-prompt.js"), output);
console.log(`judge-prompt.js 생성 완료 (프롬프트 ${markdown.length}자)`);
