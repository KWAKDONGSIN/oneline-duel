import {
  beginTurn,
  buildJudgePayload,
  countText,
  createBattle,
  inputCost,
  resolveTurn,
  validateInput,
} from "./battle.js";
import { pickSkill } from "./boss.js";
import { CHARACTER_EXAMPLES, validate as validateCharacter } from "./character.js";
import { requestJudgment } from "./judge.js";
import { loadData, saveCharacter, saveData, saveSettings } from "./storage.js";

const ROUTES = new Set(["home", "create", "battle", "result"]);
const STATUS_LABELS = {
  화상: "다음 턴 기술이 약해진다",
  감전: "다음 턴 기력 소모 +30%",
  보호막: "다음 부상 1회 무효",
  혼란: "다음 턴 30자 제한",
};

let gameData = null;
let battle = null;
let boss = null;
let bossSkill = null;
let fallbackNoticeShown = false;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[character]);
}

export function routeFromHash(hash = window.location.hash) {
  const route = hash.replace(/^#/, "") || "home";
  return ROUTES.has(route) ? route : "home";
}

export function renderRoute(route = routeFromHash()) {
  document.querySelectorAll(".screen").forEach((screen) => {
    screen.hidden = screen.id !== route;
  });
  document.body.dataset.route = route;
}

function navigate(route) {
  window.location.hash = route;
}

function woundSlots(combatant) {
  return Array.from({ length: combatant.endurance }, (_, index) =>
    `<span class="wound ${index < combatant.wounds ? "active" : ""}" aria-hidden="true">🩸</span>`).join("");
}

function statusChips(combatant) {
  return combatant.statuses.map((status) =>
    `<span class="status" title="${escapeHtml(STATUS_LABELS[status])}">${escapeHtml(status)}</span>`).join("");
}

function showToast(text) {
  const toast = document.querySelector("#toast");
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.hidden = true; }, 2600);
}

function renderHome() {
  const saved = loadData();
  const character = saved.character;
  document.querySelector("#home-content").innerHTML = `
    <article class="panel character-card">
      ${character
        ? `<div><strong>${escapeHtml(character.name)}</strong><p>${escapeHtml(character.trait)}</p></div><button class="button" data-action="edit">캐릭터 수정</button>`
        : `<p>아직 캐릭터가 없습니다. 한 줄로 당신을 만들어 보세요.</p>`}
    </article>
    <p class="progress">격파 ${saved.progress.beatenBossIds.length} / 5</p>
    <div class="home-actions">
      <button class="button primary" data-action="challenge">도전 모드</button>
      <button class="button" disabled>2인 대전</button>
      <button class="button" disabled>오늘의 도전</button>
      <button class="button" data-action="settings">설정</button>
    </div>`;

  document.querySelector('[data-action="edit"]')?.addEventListener("click", () => openCharacterForm(character));
  document.querySelector('[data-action="challenge"]').addEventListener("click", () => {
    if (character) startBattle(character);
    else openCharacterForm();
  });
  document.querySelector('[data-action="settings"]').addEventListener("click", openSettings);
}

function openCharacterForm(character = null) {
  navigate("create");
  const container = document.querySelector("#create-content");
  container.innerHTML = `
    <form id="character-form" class="panel form-stack" novalidate>
      <label>이름 (6자 이내)<input id="character-name" maxlength="6" required placeholder="예: 민수" value="${escapeHtml(character?.name ?? "")}"></label>
      <label>고유 속성 (100자 이내)<textarea id="character-trait" rows="5" required placeholder="이 캐릭터는 어떤 존재인가요? 특기, 체질, 버릇…">${escapeHtml(character?.trait ?? "")}</textarea></label>
      <div class="form-meta"><span id="trait-count">${countText(character?.trait ?? "")} / 100</span><button type="button" class="text-button" id="example-button">예시 보기</button></div>
      <p id="character-error" class="error" role="alert"></p>
      <button class="button primary" type="submit">이걸로 싸운다</button>
    </form>`;

  const nameInput = document.querySelector("#character-name");
  const traitInput = document.querySelector("#character-trait");
  const count = document.querySelector("#trait-count");
  const error = document.querySelector("#character-error");
  traitInput.addEventListener("input", () => { count.textContent = `${countText(traitInput.value)} / 100`; });
  document.querySelector("#example-button").addEventListener("click", () => {
    const example = CHARACTER_EXAMPLES[Math.floor(Math.random() * CHARACTER_EXAMPLES.length)];
    nameInput.value = example.name;
    traitInput.value = example.trait;
    traitInput.dispatchEvent(new Event("input"));
  });
  document.querySelector("#character-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const result = validateCharacter(nameInput.value, traitInput.value);
    if (!result.ok) {
      error.textContent = result.word
        ? `'${result.word}'처럼 무조건 이기는 설정은 심판이 반칙으로 봅니다. 개성 있는 특기로 바꿔보세요.`
        : "";
      return;
    }
    const savedCharacter = { name: nameInput.value.trim(), trait: traitInput.value.trim() };
    saveCharacter(savedCharacter);
    startBattle(savedCharacter);
  });
}

function openSettings() {
  const modal = document.querySelector("#settings-modal");
  const settings = loadData().settings;
  modal.innerHTML = `
    <form id="settings-form" class="modal-card form-stack">
      <h2>설정</h2>
      <label class="toggle"><input id="offline" type="checkbox" ${settings.offline ? "checked" : ""}> 오프라인 모드 (AI 심판 없이 약식 판정)</label>
      <label>판정 서버 주소<input id="judge-url" placeholder="http://localhost:8787" value="${escapeHtml(settings.judgeUrl)}"></label>
      <button class="button primary" type="submit">저장</button>
    </form>`;
  modal.hidden = false;
  modal.onclick = (event) => { if (event.target === modal) modal.hidden = true; };
  document.querySelector("#settings-form").addEventListener("submit", (event) => {
    event.preventDefault();
    saveSettings({
      offline: document.querySelector("#offline").checked,
      judgeUrl: document.querySelector("#judge-url").value.trim() || "http://localhost:8787",
    });
    modal.hidden = true;
    showToast("설정이 저장되었습니다");
  });
}

function showTutorial() {
  const saved = loadData();
  if (saved.settings.tutorialSeen) return;
  const modal = document.querySelector("#tutorial-modal");
  modal.innerHTML = `
    <div class="modal-card tutorial-card">
      <ol>
        <li>매 턴 한 줄로 기술을 씁니다. 글자 수가 곧 기력 소모량. 길게 쓸수록 강하지만 금방 지칩니다.</li>
        <li>상대의 예고를 읽고 허를 찌르세요. 정확한 카운터는 짧아도 강합니다.</li>
        <li>부상이 3번 쌓이면 빈사. 하지만 한 번의 발악 기회가 남아 있습니다.</li>
      </ol>
      <button class="button primary" id="tutorial-close">싸우러 가기</button>
    </div>`;
  modal.hidden = false;
  document.querySelector("#tutorial-close").addEventListener("click", () => {
    saved.settings.tutorialSeen = true;
    saveData(saved);
    modal.hidden = true;
    document.querySelector("#skill-input")?.focus();
  });
}

function startBattle(character) {
  boss = gameData.bosses[0];
  battle = createBattle("boss", character, boss, undefined, gameData.fields);
  fallbackNoticeShown = false;
  navigate("battle");
  beginBattleTurn();
  showTutorial();
}

function beginBattleTurn() {
  beginTurn(battle);
  const picked = pickSkill(boss, battle.p2);
  bossSkill = picked.skill;
  battle.log.push({ type: "tease", who: "p2", text: `⚠️ ${picked.tease}` });
  renderBattle();
  document.querySelector("#skill-input")?.focus();
}

function renderBattle() {
  const p1 = battle.p1;
  const p2 = battle.p2;
  const isLastStand = p1.lastStandActive;
  const maxLength = isLastStand ? 100 : p1.statuses.includes("혼란") ? 30 : 60;
  document.querySelector("#battle-content").innerHTML = `
    <div class="fighter-bar opponent">
      <div><strong>${escapeHtml(boss.emoji)} ${escapeHtml(p2.name)}</strong><small>${escapeHtml(boss.title)}</small></div>
      <div class="fighter-state">${statusChips(p2)}<span class="wounds">${woundSlots(p2)}</span></div>
    </div>
    <div class="field-chip">${battle.field ? `${escapeHtml(battle.field.emoji)} ${escapeHtml(battle.field.name)}` : ""}</div>
    <div id="stage" class="stage" aria-hidden="true"><i></i><i></i></div>
    ${isLastStand ? `<div class="last-stand">💥 마지막 발악! 글자 제한도, 기력도 없다. 모든 것을 쏟아부어라!</div>` : ""}
    <div id="battle-log" class="battle-log" aria-live="polite">
      ${battle.log.map((entry) => `<p class="log-${entry.type}">${escapeHtml(entry.text)}</p>`).join("")}
    </div>
    <div class="player-panel">
      <div class="fighter-bar">
        <div><strong>${escapeHtml(p1.name)}</strong><div class="energy"><span style="width:${p1.energy}%"></span></div></div>
        <div class="fighter-state">${statusChips(p1)}<span class="wounds">${woundSlots(p1)}</span></div>
      </div>
      ${p1.statuses.includes("혼란") ? `<p class="state-notice">혼란! 이번 턴은 30자까지만 쓸 수 있습니다.</p>` : ""}
      <form id="skill-form" class="skill-row">
        <textarea id="skill-input" rows="2" maxlength="${maxLength}" placeholder="한 줄로 기술을 쓰세요"></textarea>
        <button class="button primary" id="skill-submit" type="submit" disabled>기술 발동</button>
      </form>
      <div class="skill-meta"><span id="skill-count">0자 / 기력 ${p1.energy}</span><span id="skill-error" class="error"></span></div>
    </div>`;

  const log = document.querySelector("#battle-log");
  log.scrollTop = log.scrollHeight;
  const input = document.querySelector("#skill-input");
  const submit = document.querySelector("#skill-submit");
  const count = document.querySelector("#skill-count");
  const error = document.querySelector("#skill-error");
  const update = () => {
    const characters = countText(input.value);
    const cost = inputCost(p1, input.value);
    count.textContent = `${characters}자 / 기력 ${p1.energy}`;
    const tooExpensive = !isLastStand && cost > p1.energy;
    submit.disabled = !input.value.trim() || characters > maxLength || tooExpensive;
    error.textContent = tooExpensive ? "기력이 부족합니다. 더 짧게 쓰세요." : "";
  };
  input.addEventListener("input", update);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!submit.disabled) document.querySelector("#skill-form").requestSubmit();
    }
  });
  document.querySelector("#skill-form").addEventListener("submit", submitSkill);
}

async function submitSkill(event) {
  event.preventDefault();
  if (battle.phase !== "input") return;
  const input = document.querySelector("#skill-input");
  const playerText = input.value.trim();
  const playerValidation = validateInput(battle, "p1", playerText);
  if (!playerValidation.ok) return;
  validateInput(battle, "p2", bossSkill.text);

  battle.log.push({ type: "skill", who: "p1", text: `${battle.p1.name}: ${playerText}` });
  battle.log.push({ type: "skill", who: "p2", text: `${battle.p2.name}: ${bossSkill.text}` });
  battle.phase = "resolving";
  input.disabled = true;
  document.querySelector("#skill-submit").disabled = true;
  const waiting = document.createElement("p");
  waiting.className = "judging";
  waiting.textContent = "심판이 지켜보고 있다…";
  document.querySelector("#battle-log").append(waiting);

  const payload = buildJudgePayload(battle, playerText, bossSkill.text);
  const judgment = await requestJudgment(payload);
  if (judgment._fallback && !loadData().settings.offline && !fallbackNoticeShown) {
    fallbackNoticeShown = true;
    showToast("판정 서버에 연결할 수 없어 약식 판정으로 진행합니다. 설정에서 서버 주소를 확인하세요.");
  }
  resolveTurn(battle, judgment);

  if (battle.phase === "over") renderResult();
  else beginBattleTurn();
}

function renderResult() {
  navigate("result");
  const won = battle.winner === "p1";
  const draw = battle.winner === "draw";
  const title = draw ? "무승부" : won ? "승리!" : "패배…";
  const subtitle = draw ? "12턴의 사투 끝에 승부를 가리지 못했다"
    : won ? `${boss.title} ${boss.name} 격파` : `${boss.name}의 승리`;
  const lastNarration = [...battle.log].reverse().find((entry) => entry.type === "narration")?.text ?? "";
  document.querySelector("#result-content").innerHTML = `
    <div class="result-card">
      <p class="result-kicker">한줄승부</p>
      <h2>${title}</h2>
      <p>${escapeHtml(subtitle)}</p>
      <p class="record-line">${battle.turn}턴 · 부상 ${"🩸".repeat(battle.p1.wounds)} · 발악 ${battle.p1.lastStandUsed ? "사용" : "미사용"}</p>
      <div class="highlight"><small>이 판의 명장면</small><p>${escapeHtml(lastNarration)}</p></div>
      <div class="result-actions">
        ${won ? `<button class="button" disabled>다음 보스</button>` : ""}
        <button class="button primary" data-action="retry">다시 도전</button>
        <button class="button" data-action="home">홈으로</button>
        <button class="button" data-action="copy">로그 복사</button>
      </div>
    </div>`;
  document.querySelector('[data-action="retry"]').addEventListener("click", () => startBattle(loadData().character));
  document.querySelector('[data-action="home"]').addEventListener("click", () => { renderHome(); navigate("home"); });
  document.querySelector('[data-action="copy"]').addEventListener("click", async () => {
    await navigator.clipboard.writeText(battle.log.map((entry) => entry.text).join("\n"));
    showToast("전투 기록이 복사되었습니다");
  });
}

async function loadGameData() {
  try {
    const [bossesResponse, fieldsResponse] = await Promise.all([
      fetch("./data/bosses.json"),
      fetch("./data/fields.json"),
    ]);
    if (!bossesResponse.ok || !fieldsResponse.ok) throw new Error("data");
    const bosses = await bossesResponse.json();
    const fields = await fieldsResponse.json();
    gameData = { bosses: bosses.bosses, fields: fields.fields };
    renderHome();
  } catch {
    document.querySelector("#home-content").innerHTML = `<p class="error panel">게임 데이터를 불러오지 못했습니다. 로컬 서버로 실행해 주세요 (npx serve)</p>`;
  }
}

window.addEventListener("hashchange", () => renderRoute());
renderRoute();
loadGameData();
