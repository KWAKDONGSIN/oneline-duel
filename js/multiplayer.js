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

// 실시간 대전은 대기열과 진행 중인 매치를 계속 기억해야 해서 상태를 유지하는 서버가 필요하다.
// 판정용 Cloudflare Worker는 요청마다 초기화되는 무상태 구조라 이 역할을 맡을 수 없다.
// 그래서 대전 서버만 따로 호스팅하고, 그 주소를 여기에 적는다.
// 배포 후 나온 주소를 넣으면 인터넷에서도 대전이 된다. 비워 두면 로컬 실행에서만 동작한다.
const DEPLOYED_PVP_URL = "https://oneline-duel.onrender.com";

function serverUrl() {
  const hostname = location.hostname;
  const isLocalPage = ["localhost", "127.0.0.1"].includes(hostname);
  const isLan = /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname);

  if (isLocalPage) return "http://localhost:8787";
  if (isLan) return `http://${hostname}:8787`;   // 같은 와이파이의 폰에서 PC 서버로
  return DEPLOYED_PVP_URL.replace(/\/$/, "");    // 인터넷 배포 환경
}

// 무료 호스팅은 접속이 없으면 서버가 잠든다. 홈 화면에 들어오는 순간 미리 깨워 두면
// 실제로 대전 버튼을 누를 때쯤엔 준비가 끝나 있다.
let availability = null;
export function wakePvpServer() {
  if (availability) return availability;
  const url = serverUrl();
  if (!url) { availability = Promise.resolve(false); return availability; }
  availability = fetch(`${url}/health`, { signal: AbortSignal.timeout(60_000) })
    .then((response) => (response.ok ? response.json() : null))
    .then((body) => Boolean(body?.pvp))
    .catch(() => false);
  return availability;
}

// 지금 붙은 서버가 대전 기능을 제공하는지 확인한다.
export function pvpAvailable() {
  return wakePvpServer();
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
