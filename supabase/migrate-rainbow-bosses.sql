-- 무지개 7색 보스 개편 마이그레이션. Supabase 대시보드 SQL Editor에서 한 번 실행한다.
-- 1) 보스 점수표를 7색 기준으로 교체하고
-- 2) 옛 5보스 시절의 격파 기록을 비운다 (번호가 다른 보스를 가리키므로).

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

-- 옛 보스 격파 기록 초기화 (1회성)
update public.profiles set beaten_boss_ids = '{}', updated_at = now();
