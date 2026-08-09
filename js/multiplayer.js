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

function serverUrl() {
  const configured = loadData().settings.judgeUrl || "http://localhost:8787";
  if (/^http:\/\/(localhost|127\.0\.0\.1):8787$/i.test(configured) &&
      !["localhost", "127.0.0.1"].includes(location.hostname)) {
    return `http://${location.hostname}:8787`;
  }
  return configured.replace(/\/$/, "");
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
