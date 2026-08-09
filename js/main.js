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
import {
  fetchMatchState,
  joinQueue,
  leaveMatch,
  pvpAvailable,
  submitOnlineAction,
  wakePvpServer,
} from "./multiplayer.js";
import * as render3d from "./render3d.js";
import {
  fieldMusicList,
  initAudio,
  playFieldMusic,
  playSfx,
  playTitleMusic,
  setMusicEnabled,
  setSfxEnabled,
  stopMusic,
} from "./audio.js";
import { loadData, saveCharacter, saveData, saveSettings } from "./storage.js";
import { initSession, isLoggedIn, signIn, signOut } from "./auth.js";
import { AUTH_ENABLED, PROVIDERS } from "./supabase-config.js";
import {
  fetchLeaderboard,
  getProfile,
  loadOrCreateProfile,
  reportBossClear,
  setNickname,
  syncCharacter,
  tierFor,
} from "./account.js";

const ROUTES = new Set(["home", "create", "battle", "result", "ranking"]);
const STATUS_LABELS = {
  화상: "다음 턴 기술이 약해진다",
  감전: "다음 턴 기력 소모 +30%",
  보호막: "다음 부상 1회 무효",
  혼란: "다음 턴 30자 제한",
};

let gameData = null;
let battle = null;
let boss = null;
let bossIndex = 0;
let bossSkill = null;
let fallbackNoticeShown = false;
let onlineState = null;
let onlinePoll = null;
let onlineRevision = 0;
let onlineRenderKey = "";

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
    <div id="rank-profile" class="rank-profile"><span class="tier-badge">실버</span><strong>1000점</strong><small>랭크 기록을 불러오는 중…</small></div>
    <p class="progress">격파 ${saved.progress.beatenBossIds.length} / 5</p>
    <div class="home-actions">
      <button class="button primary" data-action="challenge">보스 도전</button>
      <button class="button ranked-button" data-action="ranked" disabled>랭크전</button>
      <button class="button" data-action="casual" disabled>일반전</button>
      <button class="button" data-action="ranking">랭킹</button>
      <button class="button" data-action="settings">설정</button>
    </div>
    <section class="jukebox panel">
      <h3>필드 음악 감상</h3>
      <p>전투 중 필드가 바뀌면 이 음악들이 흐릅니다. 눌러서 들어보세요.</p>
      <div class="jukebox-grid">
        <button data-track="title">🌈 메인 테마</button>
        ${fieldMusicList().map((f) => `<button data-track="${f.id}">${escapeHtml(f.name)}</button>`).join("")}
        <button data-track="stop">⏹ 정지</button>
      </div>
    </section>`;

  document.querySelector('[data-action="edit"]')?.addEventListener("click", () => openCharacterForm(character));
  document.querySelector('[data-action="challenge"]').addEventListener("click", () => {
    if (character) startBattle(character);
    else openCharacterForm();
  });
  document.querySelector('[data-action="ranked"]').addEventListener("click", () => startOnlineMatch("ranked"));
  document.querySelector('[data-action="casual"]').addEventListener("click", () => startOnlineMatch("casual"));
  document.querySelector('[data-action="ranking"]').addEventListener("click", renderRanking);
  document.querySelector('[data-action="settings"]').addEventListener("click", openSettings);
  document.querySelectorAll("[data-track]").forEach((button) => {
    button.addEventListener("click", () => {
      const track = button.dataset.track;
      startAudioOnce();
      if (track === "stop") stopMusic();
      else if (track === "title") playTitleMusic();
      else playFieldMusic(Number(track));
      document.querySelectorAll("[data-track]").forEach((b) => b.classList.remove("playing"));
      if (track !== "stop") button.classList.add("playing");
      playSfx("click");
    });
  });
  renderAccountBar();
  updatePvpButtons();
  renderRankCard();
}

// 대전 서버는 접속이 없으면 잠든다. 깨는 데 1분 가까이 걸리므로 홈에 들어오는 순간 미리 깨우고,
// 그동안에도 버튼은 남겨 둔다. 자고 있다는 이유로 기능이 사라져 보이면 안 된다.
function updatePvpButtons() {
  const ranked = document.querySelector('[data-action="ranked"]');
  const casual = document.querySelector('[data-action="casual"]');
  if (!ranked || !casual) return;

  ranked.disabled = false;
  casual.disabled = false;
  ranked.textContent = "랭크전";
  casual.textContent = "일반전";

  wakePvpServer().then((ok) => {
    if (!document.querySelector('[data-action="ranked"]')) return;
    if (!ok) {
      // 서버를 못 깨웠어도 버튼은 남긴다. 누르면 그때 다시 깨우기를 시도한다.
      ranked.textContent = "랭크전 (서버 깨우는 중)";
      casual.textContent = "일반전 (서버 깨우는 중)";
    }
  });
}

// 랭크 점수는 로그인했으면 계정 점수를, 아니면 대전 서버 기록을 보여준다.
function renderRankCard() {
  const target = document.querySelector("#rank-profile");
  if (!target) return;
  const profile = getProfile();
  if (isLoggedIn() && profile?.nickname) {
    target.innerHTML = `<span class="tier-badge">${escapeHtml(tierFor(profile.rating))}</span>`
      + `<strong>${profile.rating}점</strong><small>${escapeHtml(profile.nickname)}</small>`;
    return;
  }
  if (isLoggedIn()) {
    target.innerHTML = `<span class="tier-badge">기록 없음</span><strong>-</strong><small>닉네임을 설정하면 랭킹에 등록됩니다</small>`;
    return;
  }
  target.innerHTML = `<span class="tier-badge">게스트</span><strong>-</strong><small>로그인하면 기록이 저장됩니다</small>`;
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
    syncCharacter(savedCharacter);   // 로그인 상태면 계정에도 저장한다 (게스트면 아무 일도 하지 않는다)
    startBattle(savedCharacter);
  });
}

function openSettings() {
  const modal = document.querySelector("#settings-modal");
  const settings = loadData().settings;
  modal.innerHTML = `
    <form id="settings-form" class="modal-card form-stack">
      <h2>설정</h2>
      <h3 class="settings-group">소리</h3>
      <label class="toggle"><input id="sfx" type="checkbox" ${settings.sfx ? "checked" : ""}> 효과음</label>
      <label class="toggle"><input id="music" type="checkbox" ${settings.music ? "checked" : ""}> 배경음악</label>
      <h3 class="settings-group">판정</h3>
      <label class="toggle"><input id="offline" type="checkbox" ${settings.offline ? "checked" : ""}> 오프라인 모드 (AI 심판 없이 약식 판정)</label>
      <label>판정 서버 주소<input id="judge-url" placeholder="http://localhost:8787" value="${escapeHtml(settings.judgeUrl)}"></label>
      <button class="button primary" type="submit">저장</button>
    </form>`;
  modal.hidden = false;
  modal.onclick = (event) => { if (event.target === modal) modal.hidden = true; };
  // 켜고 끄는 즉시 반영해서 바로 들어볼 수 있게 한다.
  document.querySelector("#sfx").addEventListener("change", (event) => {
    setSfxEnabled(event.target.checked);
    if (event.target.checked) playSfx("click");
  });
  document.querySelector("#music").addEventListener("change", (event) => {
    setMusicEnabled(event.target.checked);
  });
  document.querySelector("#settings-form").addEventListener("submit", (event) => {
    event.preventDefault();
    saveSettings({
      sfx: document.querySelector("#sfx").checked,
      music: document.querySelector("#music").checked,
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

// 아직 격파하지 않은 첫 보스의 순번을 찾는다. 전부 격파했으면 마지막 보스를 다시 상대한다.
function nextBossIndex() {
  const beaten = new Set(loadData().progress.beatenBossIds);
  const index = gameData.bosses.findIndex((candidate) => !beaten.has(candidate.id));
  return index < 0 ? gameData.bosses.length - 1 : index;
}

function startBattle(character, index = nextBossIndex()) {
  bossIndex = Math.max(0, Math.min(gameData.bosses.length - 1, index));
  boss = gameData.bosses[bossIndex];
  battle = createBattle("boss", character, boss, undefined, gameData.fields);
  fallbackNoticeShown = false;
  navigate("battle");
  beginBattleTurn();
  showTutorial();
}

// 보스를 처음 격파했을 때만 진행도에 기록한다.
function recordBossVictory() {
  const saved = loadData();
  if (!saved.progress.beatenBossIds.includes(boss.id)) {
    saved.progress.beatenBossIds.push(boss.id);
    saveData(saved);
  }
  // 로그인 상태면 계정 점수에도 반영한다. 점수 계산은 서버가 하고, 실패해도 게임은 그대로 진행한다.
  if (isLoggedIn()) {
    reportBossClear(boss.id, battle.p1.wounds)
      .then(() => renderAccountBar())
      .catch(() => {});
  }
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
    <div id="stage" class="stage" aria-hidden="true"></div>
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
  render3d.init(document.querySelector("#stage"));
  render3d.setField(battle.field);
  playFieldMusic(battle.field?.id);   // 필드가 바뀌면 그 필드의 음악으로 갈아탄다
  render3d.setPhase("typing");
  render3d.setWounds("p1", p1.wounds);
  render3d.setWounds("p2", p2.wounds);
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
  await render3d.playTurn(judgment.motions, judgment.effects);

  if (battle.phase === "over") renderResult();
  else beginBattleTurn();
}

function clearOnlinePoll() {
  if (onlinePoll) clearInterval(onlinePoll);
  onlinePoll = null;
}

async function startOnlineMatch(mode) {
  const character = loadData().character;
  if (!character) {
    openCharacterForm();
    return;
  }
  clearOnlinePoll();
  onlineState = null;
  onlineRevision = 0;
  onlineRenderKey = "";
  navigate("battle");
  renderMatchmaking(mode);
  try {
    // 서버가 자고 있으면 첫 요청이 실패한다. 깨어날 때까지 몇 번 더 시도한다.
    let state = null;
    for (let attempt = 0; attempt < 4 && !state; attempt += 1) {
      try {
        state = await joinQueue(mode, character);
      } catch (error) {
        if (attempt === 3) throw error;
        const note = document.querySelector("#matchmaking-note");
        if (note) note.textContent = "대전 서버를 깨우는 중입니다. 최대 1분쯤 걸릴 수 있습니다…";
        await new Promise((resolve) => setTimeout(resolve, 15_000));
      }
    }
    await handleOnlineState(state);
    onlinePoll = setInterval(async () => {
      try { await handleOnlineState(await fetchMatchState()); } catch { /* 다음 폴링에서 다시 확인한다. */ }
    }, 800);
  } catch {
    showToast("대전 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    renderHome();
    navigate("home");
  }
}

function renderMatchmaking(mode) {
  document.querySelector("#battle-content").innerHTML = `
    <div class="matchmaking">
      <div class="search-ring"><span></span></div>
      <p class="mode-label">${mode === "ranked" ? "랭크전" : "일반전"}</p>
      <h2>상대를 찾고 있습니다</h2>
      <p>비슷한 실력의 상대를 우선 검색합니다.<br>5초 동안 유저가 없으면 내 점수에 맞는 봇이 참가합니다.</p>
      <p id="matchmaking-note" class="matchmaking-note"></p>
      <button class="button" id="cancel-match">매칭 취소</button>
    </div>`;
  document.querySelector("#cancel-match").addEventListener("click", async () => {
    clearOnlinePoll();
    await leaveMatch().catch(() => {});
    renderHome();
    navigate("home");
  });
}

async function handleOnlineState(state) {
  if (state.status !== "matched") return;
  onlineState = state;
  const newTurn = state.revision > onlineRevision && state.lastTurn;
  const renderKey = `${state.matchId}:${state.revision}:${state.submitted}:${state.battle.phase}:${state.battle.turn}`;
  if (renderKey !== onlineRenderKey) {
    onlineRenderKey = renderKey;
    renderOnlineBattle(state);
  }
  if (newTurn) {
    onlineRevision = state.revision;
    await render3d.playTurn(state.lastTurn.judgment.motions, state.lastTurn.judgment.effects);
  }
  if (state.battle.phase === "over") renderOnlineResult(state);
}

function renderOnlineBattle(state) {
  const side = state.side;
  const opponentSide = side === "p1" ? "p2" : "p1";
  const me = state.battle[side];
  const opponent = state.battle[opponentSide];
  const maxLength = me.lastStandActive ? 100 : me.statuses.includes("혼란") ? 30 : 60;
  const modeName = state.mode === "ranked" ? "랭크전" : "일반전";
  document.querySelector("#battle-content").innerHTML = `
    <div class="online-mode"><span>${modeName}</span><span>${escapeHtml(state.opponent.tier)} · ${state.opponent.rating}점 ${state.opponent.bot ? "· BOT" : ""}</span></div>
    <div class="fighter-bar opponent">
      <div><strong>${escapeHtml(opponent.name)}</strong><small>${escapeHtml(state.opponent.character.trait)}</small></div>
      <div class="fighter-state">${statusChips(opponent)}<span class="wounds">${woundSlots(opponent)}</span></div>
    </div>
    <div class="field-chip">${state.battle.field ? `${escapeHtml(state.battle.field.emoji)} ${escapeHtml(state.battle.field.name)}` : ""}</div>
    <div id="stage" class="stage" aria-hidden="true"></div>
    ${me.lastStandActive ? `<div class="last-stand">💥 마지막 발악! 글자 제한도, 기력도 없다. 모든 것을 쏟아부어라!</div>` : ""}
    <div id="battle-log" class="battle-log" aria-live="polite">
      ${state.battle.log.map((entry) => `<p class="log-${entry.type}">${escapeHtml(entry.text)}</p>`).join("")}
    </div>
    <div class="player-panel">
      <div class="fighter-bar">
        <div><strong>${escapeHtml(me.name)}</strong><div class="energy"><span style="width:${me.energy}%"></span></div></div>
        <div class="fighter-state">${statusChips(me)}<span class="wounds">${woundSlots(me)}</span></div>
      </div>
      ${state.submitted ? `<p class="waiting-opponent">상대의 기술을 기다리는 중…</p>` : `
      <form id="online-skill-form" class="skill-row">
        <textarea id="online-skill-input" rows="2" maxlength="${maxLength}" placeholder="한 줄로 기술을 쓰세요"></textarea>
        <button class="button primary" id="online-skill-submit" type="submit" disabled>기술 발동</button>
      </form>
      <div class="skill-meta"><span id="online-skill-count">0자 / 기력 ${me.energy}</span><span id="online-skill-error" class="error"></span></div>`}
    </div>`;

  render3d.init(document.querySelector("#stage"));
  render3d.setField(state.battle.field);
  playFieldMusic(state.battle.field?.id);
  render3d.setPhase(state.submitted ? "resolving" : "typing");
  render3d.setWounds("p1", state.battle.p1.wounds);
  render3d.setWounds("p2", state.battle.p2.wounds);
  const log = document.querySelector("#battle-log");
  log.scrollTop = log.scrollHeight;
  if (state.submitted) return;
  const input = document.querySelector("#online-skill-input");
  const submit = document.querySelector("#online-skill-submit");
  const count = document.querySelector("#online-skill-count");
  const error = document.querySelector("#online-skill-error");
  input.addEventListener("input", () => {
    const characters = countText(input.value);
    const cost = inputCost(me, input.value);
    const tooExpensive = !me.lastStandActive && cost > me.energy;
    count.textContent = `${characters}자 / 기력 ${me.energy}`;
    error.textContent = tooExpensive ? "기력이 부족합니다. 더 짧게 쓰세요." : "";
    submit.disabled = !input.value.trim() || characters > maxLength || tooExpensive;
  });
  document.querySelector("#online-skill-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    input.disabled = true;
    try { await handleOnlineState(await submitOnlineAction(input.value.trim())); }
    catch (requestError) { showToast(requestError.message); input.disabled = false; }
  });
}

function renderOnlineResult(state) {
  clearOnlinePoll();
  const won = state.battle.winner === state.side;
  const draw = state.battle.winner === "draw";
  const delta = state.ratingChange;
  navigate("result");
  render3d.finish(state.battle.winner);
  document.querySelector("#result-content").innerHTML = `
    <div class="result-card online-result">
      <p class="result-kicker">${state.mode === "ranked" ? "랭크전" : "일반전"}</p>
      <h2>${draw ? "무승부" : won ? "승리!" : "패배…"}</h2>
      <p>${escapeHtml(state.opponent.character.name)}과의 대전</p>
      ${state.mode === "ranked" ? `<div class="rating-change ${delta >= 0 ? "up" : "down"}">${delta >= 0 ? "+" : ""}${delta}점</div>` : `<div class="rating-change casual">점수 변동 없음</div>`}
      <div class="result-actions">
        <button class="button primary" data-action="same-mode">다시 매칭</button>
        <button class="button" data-action="online-home">홈으로</button>
      </div>
    </div>`;
  document.querySelector('[data-action="same-mode"]').addEventListener("click", async () => {
    await leaveMatch().catch(() => {});
    startOnlineMatch(state.mode);
  });
  document.querySelector('[data-action="online-home"]').addEventListener("click", async () => {
    await leaveMatch().catch(() => {});
    renderHome();
    navigate("home");
  });
}

function renderResult() {
  navigate("result");
  const won = battle.winner === "p1";
  const draw = battle.winner === "draw";
  if (won) recordBossVictory();
  stopMusic();
  playSfx(draw ? "click" : won ? "win" : "lose");
  const hasNext = won && bossIndex + 1 < gameData.bosses.length;
  const nextBoss = hasNext ? gameData.bosses[bossIndex + 1] : null;
  const title = draw ? "무승부" : won ? "승리!" : "패배…";
  const subtitle = draw ? "12턴의 사투 끝에 승부를 가리지 못했다"
    : won ? `${boss.title} ${boss.name} 격파` : `${boss.name}의 승리`;
  const lastNarration = [...battle.log].reverse().find((entry) => entry.type === "narration")?.text ?? "";
  const outcome = draw ? "draw" : won ? "win" : "lose";
  document.querySelector("#result-content").innerHTML = `
    <div class="result-card outcome-${outcome}">
      ${won ? `<div class="burst-ring" aria-hidden="true"></div>` : ""}
      <p class="result-kicker">무지개 반사</p>
      <h2 class="outcome-title">${title}</h2>
      <p>${escapeHtml(subtitle)}</p>
      <p class="record-line">${battle.turn}턴 · 부상 ${"🩸".repeat(battle.p1.wounds)} · 발악 ${battle.p1.lastStandUsed ? "사용" : "미사용"}</p>
      <div class="highlight"><small>이 판의 명장면</small><p>${escapeHtml(lastNarration)}</p></div>
      <div class="result-actions">
        ${hasNext ? `<button class="button primary" data-action="next-boss">다음 보스 — ${escapeHtml(nextBoss.emoji)} ${escapeHtml(nextBoss.name)}</button>` : ""}
        ${won && !hasNext ? `<p class="all-clear">모든 보스를 격파했습니다!</p>` : ""}
        <button class="button ${hasNext ? "" : "primary"}" data-action="retry">다시 도전</button>
        <button class="button" data-action="home">홈으로</button>
        <button class="button" data-action="copy">로그 복사</button>
      </div>
    </div>`;
  document.querySelector('[data-action="next-boss"]')?.addEventListener("click",
    () => startBattle(loadData().character, bossIndex + 1));
  document.querySelector('[data-action="retry"]').addEventListener("click",
    () => startBattle(loadData().character, bossIndex));
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

// ── 계정 (로그인·닉네임·랭킹) ───────────────────────────────────
// 로그인은 어디까지나 선택이다. 아래 코드가 전부 실패해도 게스트 플레이는 그대로 동작해야 한다.

// ── 다크 / 화이트 모드 ───────────────────────────────────────
function applyTheme(theme) {
  document.body.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "light" ? "#f6f6fa" : "#101014");
}

function currentTheme() {
  return loadData().settings.theme === "light" ? "light" : "dark";
}

function toggleTheme() {
  const next = currentTheme() === "light" ? "dark" : "light";
  saveSettings({ theme: next });
  applyTheme(next);
  renderAccountBar();
}

function themeButtonHtml() {
  const light = currentTheme() === "light";
  return `<button class="theme-toggle" data-action="theme">${light ? "🌙 다크" : "☀️ 화이트"}</button>`;
}

function renderAccountBar() {
  const bar = document.querySelector("#account-bar");
  if (!bar) return;
  if (!AUTH_ENABLED) {
    bar.innerHTML = themeButtonHtml();
    bar.querySelector('[data-action="theme"]').addEventListener("click", toggleTheme);
    return;
  }

  const profile = getProfile();
  bar.innerHTML = themeButtonHtml() + (isLoggedIn()
    ? `<span class="account-name">${escapeHtml(profile?.nickname || "닉네임 미설정")}</span>
       ${profile?.nickname ? "" : `<button class="link-button" data-action="set-nickname">닉네임 설정</button>`}
       <button class="link-button" data-action="logout">로그아웃</button>`
    : `<button class="link-button" data-action="login">로그인</button>`);

  bar.querySelector('[data-action="theme"]').addEventListener("click", toggleTheme);
  bar.querySelector('[data-action="login"]')?.addEventListener("click", openLoginModal);
  bar.querySelector('[data-action="set-nickname"]')?.addEventListener("click", openNicknameModal);
  bar.querySelector('[data-action="logout"]')?.addEventListener("click", async () => {
    await signOut();
    location.reload();
  });
}

function openLoginModal() {
  const modal = document.querySelector("#login-modal");
  modal.hidden = false;
  modal.innerHTML = `
    <div class="modal-card">
      <h3>로그인</h3>
      <p class="modal-note">로그인하면 기록이 계정에 저장되고 랭킹에 참여할 수 있습니다.<br>로그인 없이도 게임은 그대로 즐길 수 있습니다.</p>
      <div class="form-stack">
        ${PROVIDERS.map((provider) => `
          <button class="button provider ${provider.id}" data-provider="${provider.id}" ${provider.ready ? "" : "disabled"}>
            ${escapeHtml(provider.label)}${provider.ready ? "" : " (준비 중)"}
          </button>`).join("")}
      </div>
      <button class="button" data-action="close">닫기</button>
    </div>`;
  modal.querySelectorAll("[data-provider]").forEach((button) => {
    button.addEventListener("click", () => signIn(button.dataset.provider));
  });
  modal.querySelector('[data-action="close"]').addEventListener("click", () => { modal.hidden = true; });
}

function openNicknameModal() {
  const modal = document.querySelector("#nickname-modal");
  modal.hidden = false;
  modal.innerHTML = `
    <div class="modal-card">
      <h3>닉네임 설정</h3>
      <p class="modal-note">랭킹에 표시될 이름입니다. 2~10자로 정해 주세요.</p>
      <form id="nickname-form" class="form-stack" novalidate>
        <input id="nickname-input" maxlength="10" placeholder="예: 바람의검객" value="${escapeHtml(getProfile()?.nickname ?? "")}">
        <p class="error" id="nickname-error"></p>
        <button class="button primary" type="submit">저장</button>
      </form>
    </div>`;
  const form = modal.querySelector("#nickname-form");
  const error = modal.querySelector("#nickname-error");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.textContent = "";
    const result = await setNickname(modal.querySelector("#nickname-input").value);
    if (!result.ok) { error.textContent = result.reason; return; }
    modal.hidden = true;
    renderAccountBar();
    renderHome();
    showToast("닉네임이 저장되었습니다");
  });
}

async function renderRanking() {
  navigate("ranking");
  const container = document.querySelector("#ranking-content");
  container.innerHTML = `<p class="panel">랭킹을 불러오는 중…</p>`;

  if (!AUTH_ENABLED) {
    container.innerHTML = `<p class="panel">랭킹은 아직 준비 중입니다.</p>
      <button class="button" data-action="ranking-home">홈으로</button>`;
  } else {
    try {
      const rows = await fetchLeaderboard(100);
      const myNickname = getProfile()?.nickname;
      container.innerHTML = rows?.length
        ? `<ol class="leaderboard">
            ${rows.map((row) => `
              <li class="${row.nickname === myNickname ? "me" : ""}">
                <span class="rank-no">${row.rank}</span>
                <span class="tier-badge">${escapeHtml(tierFor(row.rating))}</span>
                <span class="rank-name">${escapeHtml(row.nickname)}</span>
                <span class="rank-score">${row.rating}점</span>
                <small>${row.wins}승 ${row.losses}패</small>
              </li>`).join("")}
          </ol>
          <button class="button" data-action="ranking-home">홈으로</button>`
        : `<p class="panel">아직 랭킹에 오른 사람이 없습니다. 첫 주인공이 되어 보세요.</p>
           <button class="button" data-action="ranking-home">홈으로</button>`;
    } catch {
      container.innerHTML = `<p class="panel error">랭킹을 불러오지 못했습니다.</p>
        <button class="button" data-action="ranking-home">홈으로</button>`;
    }
  }
  container.querySelector('[data-action="ranking-home"]')?.addEventListener("click", () => {
    renderHome();
    navigate("home");
  });
}

async function initAccount() {
  if (!AUTH_ENABLED) { renderAccountBar(); return; }
  try {
    await initSession();
    if (isLoggedIn()) {
      const profile = await loadOrCreateProfile();
      // 계정에 캐릭터가 있고 이 기기에 없으면 계정 쪽을 가져온다.
      const saved = loadData();
      if (profile?.character && !saved.character) {
        saveCharacter(profile.character);
      }
      if (!profile?.nickname) openNicknameModal();
    }
  } catch {
    // 로그인 실패가 게임을 막지 않는다.
  }
  renderAccountBar();
  if (gameData) renderHome();
}

// 브라우저는 사용자가 화면을 한 번 건드리기 전에는 소리를 못 내게 막는다.
// 그래서 첫 클릭·터치·키 입력 때 오디오를 열고 메인 테마를 시작한다.
let audioStarted = false;
function startAudioOnce() {
  if (audioStarted) return;
  audioStarted = true;
  const settings = loadData().settings;
  initAudio({ sfx: settings.sfx !== false, music: settings.music !== false });
  render3d.setMotionListener(playSfx);   // 3D 모션이 시작될 때마다 그 동작의 효과음
  if (routeFromHash() === "home") playTitleMusic();
}
["pointerdown", "keydown", "touchstart"].forEach((type) =>
  window.addEventListener(type, startAudioOnce, { once: true, passive: true }));

window.addEventListener("hashchange", () => {
  const route = routeFromHash();
  renderRoute();
  if (!audioStarted) return;
  // 화면을 옮기면 그 화면에 맞는 음악으로 정리한다. 감상용으로 튼 곡이 계속 따라다니지 않게 한다.
  if (route === "home") playTitleMusic();
  else if (route !== "battle") stopMusic();
});

// 탭을 벗어나면 음악을 멈춘다. 다른 일을 하는 동안 계속 흘러나오지 않게.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopMusic();
  else if (audioStarted && routeFromHash() === "home") playTitleMusic();
});
applyTheme(currentTheme());   // 저장된 테마를 첫 화면부터 적용한다
renderRoute();
loadGameData().then(initAccount);
