import { loadData } from "./storage.js";

const PLAYER_ID_KEY = "old:playerId";

export function getPlayerId() {
  let id = localStorage.getItem(PLAYER_ID_KEY);
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : `p-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(PLAYER_ID_KEY, id);
  }
  return id;
}

// 온라인 대전은 상태를 들고 있는 서버가 필요해 로컬(또는 같은 와이파이) 실행에서만 동작한다.
function serverUrl() {
  const configured = loadData().settings.judgeUrl || "http://localhost:8787";
  const isDefault = /^http:\/\/(localhost|127\.0\.0\.1):8787$/i.test(configured);
  const isLan = /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname);
  if (isDefault && isLan) return `http://${location.hostname}:8787`;
  return configured.replace(/\/$/, "");
}

// 지금 붙은 서버가 대전 기능을 제공하는지 확인한다(배포 Worker는 판정만 한다).
export async function pvpAvailable() {
  try {
    const response = await fetch(`${serverUrl()}/health`, { signal: AbortSignal.timeout(2500) });
    if (!response.ok) return false;
    const body = await response.json();
    return Boolean(body.pvp);
  } catch {
    return false;
  }
}

async function api(path, options = {}) {
  const response = await fetch(`${serverUrl()}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "서버 요청에 실패했습니다.");
  return body;
}

export function fetchProfile(name) {
  return api("/pvp/profile", { method: "POST", body: JSON.stringify({ playerId: getPlayerId(), name }) });
}

export function joinQueue(mode, character) {
  return api("/pvp/queue", {
    method: "POST",
    body: JSON.stringify({ playerId: getPlayerId(), name: character.name, character, mode }),
  });
}

export function fetchMatchState() {
  return api(`/pvp/state?playerId=${encodeURIComponent(getPlayerId())}`);
}

export function submitOnlineAction(text) {
  return api("/pvp/action", { method: "POST", body: JSON.stringify({ playerId: getPlayerId(), text }) });
}

export function leaveMatch() {
  return api("/pvp/leave", { method: "POST", body: JSON.stringify({ playerId: getPlayerId() }) });
}
