// Supabase 접속 정보. 대시보드의 Project Settings > API 에서 복사한 값을 넣는다.
// anon 키는 공개돼도 되는 값이다(실제 보호는 DB의 RLS 정책이 한다).
// service_role 키는 절대 여기에 넣지 말 것.
// 두 값이 비어 있으면 게임은 로그인 기능 없이 게스트 모드로만 동작한다.

export const SUPABASE_URL = "https://saztimongjkzggvawuyi.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_KSOP67gXCTpB0Ewgq033CA_vhDBqMMi";

export const AUTH_ENABLED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

// Supabase에 등록한 소셜 로그인 제공자.
// 네이버는 내장 제공자가 아니고, 카카오는 이메일 동의항목이 비즈앱 전환을 요구해 이번 범위에서 제외했다.
export const PROVIDERS = [
  { id: "google", label: "구글로 시작", ready: true },
];
