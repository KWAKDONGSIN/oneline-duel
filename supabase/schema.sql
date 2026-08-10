-- 한줄승부 계정·랭킹 스키마. Supabase SQL Editor에 통째로 붙여넣고 실행한다.
-- 다시 실행해도 안전하도록 작성했다(idempotent).

-- ── 프로필 테이블 ────────────────────────────────────────────────
create table if not exists public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  nickname        text unique,
  rating          integer not null default 1000,
  wins            integer not null default 0,
  losses          integer not null default 0,
  beaten_boss_ids integer[] not null default '{}',
  character       jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- 랭킹 조회는 rating 내림차순이라 인덱스를 걸어 둔다.
create index if not exists profiles_rating_idx on public.profiles (rating desc);

comment on column public.profiles.rating is '보스 격파와 랭크전 결과가 함께 반영되는 점수. 클라이언트가 직접 수정할 수 없다.';
comment on column public.profiles.beaten_boss_ids is '이미 격파한 보스 id. 같은 보스로 점수를 반복 획득하는 것을 막는 용도.';

-- ── 보안 정책 (RLS) ─────────────────────────────────────────────
alter table public.profiles enable row level security;

-- 랭킹은 누구나 볼 수 있어야 한다(비로그인 포함).
drop policy if exists "프로필은 누구나 조회" on public.profiles;
create policy "프로필은 누구나 조회"
  on public.profiles for select
  using (true);

-- 내 행만 만들 수 있다.
drop policy if exists "본인 프로필만 생성" on public.profiles;
create policy "본인 프로필만 생성"
  on public.profiles for insert
  with check (auth.uid() = id);

-- 내 행만 수정할 수 있다. 점수 관련 컬럼은 아래 트리거가 따로 막는다.
drop policy if exists "본인 프로필만 수정" on public.profiles;
create policy "본인 프로필만 수정"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- ── 점수 위조 차단 ──────────────────────────────────────────────
-- 클라이언트가 update로 rating·전적·격파목록을 직접 바꾸려 하면 이전 값으로 되돌린다.
-- 이 값들은 아래 report_* 함수(SECURITY DEFINER)를 통해서만 바뀐다.
create or replace function public.protect_score_columns()
returns trigger
language plpgsql
as $$
begin
  if auth.role() = 'authenticated' then
    new.rating          := old.rating;
    new.wins            := old.wins;
    new.losses          := old.losses;
    new.beaten_boss_ids := old.beaten_boss_ids;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists protect_score_columns on public.profiles;
create trigger protect_score_columns
  before update on public.profiles
  for each row execute function public.protect_score_columns();

-- ── 보스 격파 보고 ──────────────────────────────────────────────
-- 첫 격파일 때만 점수를 준다. 재도전으로 무한 파밍하는 것을 막는다.
create or replace function public.report_boss_clear(p_boss_id integer, p_wounds integer)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_points integer;
  v_row    public.profiles;
begin
  if v_uid is null then
    raise exception '로그인이 필요합니다.';
  end if;

  -- 무지개 7색 보스, 색 순서대로 점수가 오른다
  v_points := case p_boss_id
    when 1 then 10   -- 빨강 홍옥 (사과)
    when 2 then 15   -- 주황 호걸 (호랑이)
    when 3 then 20   -- 노랑 미끌 (바나나)
    when 4 then 25   -- 초록 브록 장군 (브로콜리)
    when 5 then 30   -- 파랑 해일 (파도)
    when 6 then 40   -- 남색 미리내 (밤하늘)
    when 7 then 60   -- 보라 포도대왕 (최종)
    else 0
  end;

  if v_points = 0 then
    raise exception '알 수 없는 보스입니다.';
  end if;

  -- 부상을 적게 입고 이겼으면 보너스
  if coalesce(p_wounds, 3) <= 1 then
    v_points := v_points + 5;
  end if;

  select * into v_row from public.profiles where id = v_uid for update;
  if not found then
    raise exception '프로필이 없습니다. 먼저 닉네임을 설정해 주세요.';
  end if;

  -- 이미 격파한 보스면 점수를 주지 않는다.
  if p_boss_id = any (v_row.beaten_boss_ids) then
    return v_row;
  end if;

  update public.profiles
     set rating          = rating + v_points,
         beaten_boss_ids = array_append(beaten_boss_ids, p_boss_id),
         updated_at      = now()
   where id = v_uid
   returning * into v_row;

  return v_row;
end;
$$;

-- ── 랭크전 결과 보고 ────────────────────────────────────────────
-- 클라이언트가 보고하는 구조라 한 판당 증감 폭을 ±32로 제한한다.
create or replace function public.report_duel_result(p_delta integer, p_won boolean)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_delta integer := greatest(-32, least(32, coalesce(p_delta, 0)));
  v_row   public.profiles;
begin
  if v_uid is null then
    raise exception '로그인이 필요합니다.';
  end if;

  update public.profiles
     set rating     = greatest(0, rating + v_delta),
         wins       = wins   + (case when p_won then 1 else 0 end),
         losses     = losses + (case when p_won then 0 else 1 end),
         updated_at = now()
   where id = v_uid
   returning * into v_row;

  if not found then
    raise exception '프로필이 없습니다. 먼저 닉네임을 설정해 주세요.';
  end if;

  return v_row;
end;
$$;

-- ── 랭킹 조회 ───────────────────────────────────────────────────
-- 닉네임을 설정한 사람만 랭킹에 오른다.
create or replace view public.leaderboard as
  select
    row_number() over (order by rating desc, updated_at asc) as rank,
    id, nickname, rating, wins, losses
  from public.profiles
  where nickname is not null
  order by rating desc, updated_at asc;

grant select on public.leaderboard to anon, authenticated;
