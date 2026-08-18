-- ============================================================
-- סנכרון חי למפת הטיול — להרצה בפרויקט Supabase ייעודי (חינמי).
-- שימו לב: לא להריץ בפרויקט של SkillUp!
-- איך: Supabase Dashboard → SQL Editor → הדביקו הכול → Run.
-- אחר כך העתיקו Project URL + anon key אל js/config.js.
-- ============================================================
create table if not exists public.trip_sync (
  id uuid primary key,
  state jsonb not null,
  rev bigint not null default 1,
  updated_at timestamptz not null default now()
);
alter table public.trip_sync enable row level security;
-- בכוונה בלי policies: גישה ישירה חסומה; הכול דרך הפונקציות בלבד.

create or replace function public.trip_get(p_id uuid)
returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object('state', state, 'rev', rev, 'updated_at', updated_at)
  from public.trip_sync where id = p_id;
$$;

create or replace function public.trip_save(p_id uuid, p_state jsonb, p_rev bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cur bigint; new_rev bigint;
begin
  if pg_column_size(p_state) > 524288 then
    return jsonb_build_object('ok', false, 'error', 'too_large');
  end if;
  select rev into cur from public.trip_sync where id = p_id for update;
  if cur is null then
    insert into public.trip_sync (id, state, rev) values (p_id, p_state, 1);
    return jsonb_build_object('ok', true, 'rev', 1);
  end if;
  if p_rev is distinct from cur then
    return jsonb_build_object('ok', false, 'error', 'conflict', 'rev', cur,
      'state', (select state from public.trip_sync where id = p_id));
  end if;
  new_rev := cur + 1;
  update public.trip_sync set state = p_state, rev = new_rev, updated_at = now() where id = p_id;
  return jsonb_build_object('ok', true, 'rev', new_rev);
end;
$$;

revoke all on function public.trip_get(uuid) from public;
revoke all on function public.trip_save(uuid, jsonb, bigint) from public;
grant execute on function public.trip_get(uuid) to anon, authenticated;
grant execute on function public.trip_save(uuid, jsonb, bigint) to anon, authenticated;
