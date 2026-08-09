// Supabase 인증을 SDK 없이 REST로 직접 다룬다.
// 이 프로젝트는 번들러가 없고 외부 CDN 요청을 금지하므로 fetch만 사용한다.
import { AUTH_ENABLED, SUPABASE_ANON_KEY, SUPABASE_URL } from "./supabase-config.js";

const SESSION_KEY = "old:session";

let session = null;   // { access_token, refresh_token, expires_at, user }

function readStoredSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function storeSession(next) {
  session = next;
  if (next) localStorage.setItem(SESSION_KEY, JSON.stringify(next));
  else localStorage.removeItem(SESSION_KEY);
}

function toSession(body) {
  if (!body?.access_token) return null;
  const expiresIn = Number(body.expires_in) || 3600;   // 네이버 등은 문자열로 주기도 한다
  return {
    access_token: body.access_token,
    refresh_token: body.refresh_token,
    expires_at: Date.now() + expiresIn * 1000,
    user: body.user || null,
  };
}

// 로그인 후 돌아올 때 붙는 #access_token=... 해시를 읽어 세션으로 만든다.
function consumeUrlHash() {
  if (!location.hash.includes("access_token")) return null;
  const params = new URLSearchParams(location.hash.slice(1));
  const next = toSession({
    access_token: params.get("access_token"),
    refresh_token: params.get("refresh_token"),
    expires_in: params.get("expires_in"),
  });
  // 주소창에 토큰이 남지 않게 지운다.
  history.replaceState(null, "", location.pathname + location.search);
  return next;
}

async function authApi(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, ...(options.headers || {}) },
  });
  if (!response.ok) throw new Error(`인증 요청 실패 (${response.status})`);
  return response.json();
}

async function refreshSession(current) {
  if (!current?.refresh_token) return null;
  try {
    const body = await authApi("/token?grant_type=refresh_token", {
      method: "POST",
      body: JSON.stringify({ refresh_token: current.refresh_token }),
    });
    return toSession(body);
  } catch {
    return null;
  }
}

async function fetchUser(current) {
  try {
    return await authApi("/user", { headers: { Authorization: `Bearer ${current.access_token}` } });
  } catch {
    return null;
  }
}

// 앱 시작 시 한 번 호출한다. 해시 토큰 처리 → 저장된 세션 복원 → 만료 시 갱신까지 담당한다.
export async function initSession() {
  if (!AUTH_ENABLED) return null;

  let next = consumeUrlHash() || readStoredSession();
  if (!next) return null;

  if (next.expires_at - Date.now() < 60_000) {
    next = await refreshSession(next);
    if (!next) { storeSession(null); return null; }
  }

  if (!next.user) next.user = await fetchUser(next);
  if (!next.user) { storeSession(null); return null; }

  storeSession(next);
  return next;
}

export function getSession() {
  return session;
}

export function getUserId() {
  return session?.user?.id ?? null;
}

export function isLoggedIn() {
  return Boolean(session?.user?.id);
}

// 소셜 로그인 시작. 현재 페이지로 다시 돌아오게 한다.
export function signIn(provider) {
  if (!AUTH_ENABLED) throw new Error("로그인이 아직 설정되지 않았습니다.");
  const redirect = encodeURIComponent(location.origin + location.pathname);
  location.href = `${SUPABASE_URL}/auth/v1/authorize?provider=${encodeURIComponent(provider)}&redirect_to=${redirect}`;
}

export async function signOut() {
  const current = session;
  storeSession(null);
  if (!current) return;
  try {
    await authApi("/logout", { method: "POST", headers: { Authorization: `Bearer ${current.access_token}` } });
  } catch {
    // 서버 로그아웃이 실패해도 로컬 세션은 이미 지웠으므로 그대로 진행한다.
  }
}

// 로그인한 상태로 데이터 API(REST/RPC)를 호출한다. 만료가 임박하면 먼저 갱신한다.
export async function authFetch(path, options = {}) {
  if (!AUTH_ENABLED) throw new Error("로그인이 아직 설정되지 않았습니다.");

  if (session && session.expires_at - Date.now() < 60_000) {
    const refreshed = await refreshSession(session);
    if (refreshed) {
      refreshed.user = session.user;
      storeSession(refreshed);
    }
  }

  const headers = {
    "Content-Type": "application/json",
    apikey: SUPABASE_ANON_KEY,
    ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
    ...(options.headers || {}),
  };

  const response = await fetch(`${SUPABASE_URL}/rest/v1${path}`, { ...options, headers });
  if (response.status === 204) return null;

  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.message || body?.hint || `요청 실패 (${response.status})`);
  return body;
}
