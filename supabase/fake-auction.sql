-- Fake auction tools for the auction admin:
--  1. "Run Fake Auction" starts a practice run with only your own people: no simulated bidders, no opening bids.
--  2. The invite link to text your group (it uses the private preview code, so only people with the link can join).
--  3. Hide or bring back the 10 sample items (ids i1 to i10) from the Items tab. Hidden sample items are parked
--     here with their photos, so they come back exactly as they were.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.

create table if not exists catalog_parked (like catalog including defaults);
create table if not exists photos_parked (like photos including defaults);
alter table catalog_parked drop constraint if exists catalog_parked_pkey;
alter table catalog_parked add primary key (id);
alter table photos_parked drop constraint if exists photos_parked_pkey;
alter table photos_parked add primary key (item_id);
alter table catalog_parked enable row level security;   -- no policies: only the function below can touch these
alter table photos_parked enable row level security;

-- p_on false: hide the sample items. true: bring them back. null: just report.
create or replace function admin_sample_items(p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n int := 0; skipped text[] := '{}'; r catalog_parked%rowtype;
  ids text[] := array['i1','i2','i3','i4','i5','i6','i7','i8','i9','i10'];
begin
  if not is_admin() then return jsonb_build_object('err', 'Only auction admins can do that.'); end if;
  if p_on = false then
    insert into catalog_parked select * from catalog where id = any(ids)
      on conflict (id) do update set no = excluded.no, title = excluded.title, cat = excluded.cat, value = excluded.value, start = excluded.start,
        reserve = excluded.reserve, bin = excluded.bin, featured = excluded.featured, descr = excluded.descr, donor = excluded.donor,
        pickup = excluded.pickup, mode = excluded.mode, premium = excluded.premium;
    insert into photos_parked select * from photos where item_id = any(ids)
      on conflict (item_id) do update set list = excluded.list;
    delete from photos where item_id = any(ids);
    delete from catalog where id = any(ids);      -- also takes them out of the last test run
    get diagnostics n = row_count;
  elsif p_on = true then
    for r in select * from catalog_parked order by no loop
      if exists (select 1 from catalog where id = r.id) then delete from catalog_parked where id = r.id; continue; end if;
      if exists (select 1 from catalog where no = r.no) then skipped := skipped || r.no::text; continue; end if;
      insert into catalog select r.*;
      insert into photos select * from photos_parked where item_id = r.id on conflict (item_id) do nothing;
      delete from photos_parked where item_id = r.id; delete from catalog_parked where id = r.id;
      n := n + 1;
    end loop;
  end if;
  return jsonb_build_object('ok', true, 'changed', n, 'skipped', to_jsonb(skipped),
    'showing', (select count(*) from catalog where id = any(ids)), 'hidden', (select count(*) from catalog_parked));
end $$;

revoke all on function admin_sample_items(boolean) from public, anon;
grant execute on function admin_sample_items(boolean) to authenticated;

-- ---------- Run Fake Auction: a fresh run with no simulated bidders ----------
create or replace function admin_launch(p_dur int) returns void
language plpgsql security definer set search_path = public as $$
declare t bigint := now_ms(); r int;
begin
  if not is_admin() then raise exception 'Only auction admins can do that.'; end if;
  if p_dur is null or p_dur < 1 or p_dur > 7 * 24 * 60 then raise exception 'Choose how long the fake auction runs.'; end if;
  update auction set run = run + 1, phase = 'live', paused_at = null, launched_at = t, dur = p_dur, live_lot = null,
    settings = settings || '{"bots": false}'::jsonb where id = 1
    returning run into r;
  -- "where true": Supabase refuses a DELETE with no WHERE when it comes from the website
  delete from maxes where true; delete from history where true; delete from items where true;
  delete from people where bot;             -- no simulated bidders: only your own people take part
  update drawings set data = data - 'lot' where data ? 'lot';   -- Golden Ticket picks belong to the old run; gifts and payments stay, tagged with their run
  insert into items (id, run, price, ends_at, live)
    select id, r, start, t + p_dur * 60000 + case when mode = 'live' then 7 * 86400000 else 0 end, mode = 'live' from catalog;
end $$;

-- If the preview code is still the starter one from setup, give it a private random one (the admin shows the new link).
update app_secrets set v = 'practice-' || substr(md5(random()::text || clock_timestamp()::text), 1, 10)
  where k = 'preview_code' and v like 'CHANGE-%';

-- The link to text your group. Admins only.
create or replace function admin_invite_code() returns text
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Only auction admins can do that.'; end if;
  return (select v from app_secrets where k = 'preview_code');
end $$;
revoke all on function admin_invite_code() from public, anon;
grant execute on function admin_invite_code() to authenticated;

select 'Fake auction tools ready' as result;
