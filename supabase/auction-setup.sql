-- =====================================================================
-- Called To Care Auction · database setup (test mode)
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Safe to run again: it updates functions and leaves your data in place.
--
-- BEFORE RUNNING: change the admin code on the next real line.
-- Anyone who types this code on the Admin tab can run the auction.
-- =====================================================================
create table if not exists app_secrets (k text primary key, v text not null);
insert into app_secrets values ('admin_code', 'CHANGE-ME-2026')
  on conflict (k) do update set v = excluded.v;

-- ---------- helpers ----------
create or replace function now_ms() returns bigint language sql volatile
as $$ select (extract(epoch from clock_timestamp()) * 1000)::bigint $$;

create or replace function inc_for(p int) returns int language sql immutable
as $$ select case when p < 100 then 5 when p < 500 then 10 when p < 1000 then 25 else 50 end $$;

create or replace function usd(p numeric) returns text language sql immutable
as $$ select '$' || to_char(p, 'FM999,999,990') $$;

-- ---------- tables ----------
create table if not exists admins (uid uuid primary key);

create or replace function is_admin() returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from admins where uid = auth.uid()) $$;

create table if not exists auction (
  id int primary key default 1 check (id = 1),
  run int not null default 0,
  phase text not null default 'none',          -- none | live | paused
  paused_at bigint,
  launched_at bigint,
  dur int not null default 10,
  settings jsonb not null default '{"softWin":60,"softExt":60,"bots":true}'
);
insert into auction (id) values (1) on conflict do nothing;


-- ---------- preview gate: only admins and people with the private preview link can join or bid until an admin turns the auction live ----------
insert into app_secrets values ('preview_code', 'CHANGE-PREVIEW-CODE')
  on conflict (k) do update set v = excluded.v;
create table if not exists testers (uid uuid primary key, t bigint not null default now_ms());
alter table testers enable row level security;
create or replace function auction_open() returns boolean language sql stable security definer set search_path = public
as $$ select coalesce((settings->>'open')::boolean, false) from auction where id = 1 $$;
create or replace function can_take_part() returns boolean language sql stable security definer set search_path = public
as $$ select auction_open() or is_admin() or exists (select 1 from testers where uid = auth.uid()) $$;
create or replace function enter_preview(p_code text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return false; end if;
  if p_code = (select v from app_secrets where k = 'preview_code') then
    insert into testers (uid) values (auth.uid()) on conflict do nothing; return true;
  end if;
  perform pg_sleep(1); return false;
end $$;
create or replace function my_access() returns jsonb language sql stable security definer set search_path = public
as $$ select jsonb_build_object('open', auction_open(), 'admin', is_admin(), 'tester', exists (select 1 from testers where uid = auth.uid())) $$;
create or replace function admin_set_open(p_open boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Only auction admins can do that.'; end if;
  update auction set settings = settings || jsonb_build_object('open', p_open, 'opened_at', case when p_open then now_ms() end) where id = 1;
end $$;

create table if not exists people (
  uid text primary key, name text not null, paddle int not null unique,
  bot boolean not null default false, t bigint not null default now_ms()
);

create table if not exists catalog (
  id text primary key, no int not null, title text not null, cat text not null,
  value int not null, start int not null, reserve int, bin int, featured boolean not null default false,
  descr text, donor text, pickup text
);

create table if not exists items (
  id text primary key references catalog(id) on delete cascade,
  run int not null, price int not null, leader text, ends_at bigint not null,
  closed boolean not null default false, winner text, final int, how text,
  bid_count int not null default 0, proxy_count int not null default 0,
  outbids int not null default 0, ext int not null default 0,
  bidder_ids text[] not null default '{}', pickup jsonb
);

-- Each bidder's private maximum. Bidders can read only their own row.
create table if not exists maxes (
  item_id text not null, run int not null, uid text not null,
  max int not null, t bigint not null, primary key (item_id, uid)
);

create table if not exists history (
  id bigserial primary key, item_id text not null, run int not null, uid text not null,
  amt int not null, t bigint not null, auto boolean not null default false, bin boolean not null default false
);
create index if not exists history_item on history (item_id, run);

create table if not exists orders (
  id text primary key, run int not null, uid text not null, items text[] not null,
  don numeric not null default 0, fee numeric not null default 0, total numeric not null,
  status text not null, t bigint not null, card text, code text
);
create table if not exists anns (id text primary key, run int not null, text text not null, aud text[] not null, t bigint not null);
create table if not exists feedback (id text primary key, text text not null, page text, device text, who text, t bigint not null, run int);
create table if not exists photos (item_id text primary key, list text[] not null default '{}');
create table if not exists leases (name text primary key, holder text not null, until bigint not null);
create table if not exists config (id int primary key default 1 check (id = 1), data jsonb not null default '{}');
insert into config (id) values (1) on conflict do nothing;
create table if not exists donations (
  id text primary key, run int not null, uid text not null,
  amount numeric not null check (amount >= 5 and amount <= 100000),
  t bigint not null, kind text, campaign text
);
alter table orders add column if not exists dons text[] not null default '{}';
alter table orders add column if not exists pledged numeric not null default 0;
-- live (auctioneer) lots
alter table catalog add column if not exists mode text not null default 'silent';
alter table catalog add column if not exists premium boolean not null default false;   -- Buy It Now only on premium items
alter table items   add column if not exists live boolean not null default false;
alter table history add column if not exists live boolean not null default false;
alter table auction add column if not exists live_lot text;
-- raffles, Golden Tickets and bucket drawings
alter table auction add column if not exists drawing text;
-- a straight bid ("Place a bid") shows at its full amount
alter table maxes add column if not exists bid int not null default 0;
create table if not exists drawings (id text primary key, data jsonb not null);
create table if not exists pools (pool text primary key, rows jsonb not null default '[]', t bigint);

-- ---------- security rules ----------
alter table app_secrets enable row level security;   -- no policies: unreadable from the app
alter table admins   enable row level security;
alter table auction  enable row level security;
alter table people   enable row level security;
alter table catalog  enable row level security;
alter table items    enable row level security;
alter table maxes    enable row level security;
alter table history  enable row level security;
alter table orders   enable row level security;
alter table anns     enable row level security;
alter table feedback enable row level security;
alter table photos   enable row level security;
alter table leases   enable row level security;
alter table config   enable row level security;
alter table donations enable row level security;
alter table drawings enable row level security;
alter table pools    enable row level security;

do $$ begin
  -- read access for signed-in visitors
  drop policy if exists r on admins;   create policy r on admins   for select to authenticated using (uid = auth.uid());
  drop policy if exists r on auction;  create policy r on auction  for select to authenticated using (true);
  drop policy if exists r on people;   create policy r on people   for select to authenticated using (true);
  drop policy if exists r on catalog;  create policy r on catalog  for select to authenticated using (true);
  drop policy if exists r on items;    create policy r on items    for select to authenticated using (true);
  drop policy if exists r on history;  create policy r on history  for select to authenticated using (true);
  drop policy if exists r on photos;   create policy r on photos   for select to authenticated using (true);
  drop policy if exists r on anns;     create policy r on anns     for select to authenticated using (true);
  drop policy if exists r on orders;   create policy r on orders   for select to authenticated using (true);
  drop policy if exists r on drawings; create policy r on drawings for select to authenticated using (true);
  -- ticket buyer lists are visible to auction admins only
  drop policy if exists r on pools;    create policy r on pools    for select to authenticated using (is_admin());
  drop policy if exists r on config;   create policy r on config   for select to authenticated using (true);
  drop policy if exists r on donations; create policy r on donations for select to authenticated using (true);
  drop policy if exists w on donations; create policy w on donations for insert to authenticated
    with check ((uid = auth.uid()::text or uid like 'bot-%') and exists (select 1 from people p where p.uid = donations.uid));
  -- maximum bids stay private (simulated bidders' are visible so you can play as them)
  drop policy if exists r on maxes;    create policy r on maxes    for select to authenticated using (uid = auth.uid()::text or uid like 'bot-%');
  drop policy if exists r on feedback; create policy r on feedback for select to authenticated using (is_admin());
  -- writes the app makes directly
  drop policy if exists w on orders;   create policy w on orders   for insert to authenticated with check (uid = auth.uid()::text or uid like 'bot-%');
  drop policy if exists w on feedback; create policy w on feedback for insert to authenticated with check (true);
  drop policy if exists w on anns;     create policy w on anns     for insert to authenticated with check (is_admin());
end $$;
-- Everything else (bids, closing, launching) goes through the functions below.

-- ---------- auction logic (runs on the server) ----------
create or replace function server_now() returns bigint language sql volatile as $$ select now_ms() $$;

create or replace function resolve_item(p_item text) returns void
language plpgsql security definer set search_path = public as $$
declare a maxes%rowtype; b maxes%rowtype; c catalog%rowtype; n int; p int;
begin
  select * into c from catalog where id = p_item;
  select count(*) into n from maxes where item_id = p_item;
  if n = 0 then update items set price = c.start, leader = null where id = p_item; return; end if;
  select * into a from maxes where item_id = p_item order by max desc, t asc limit 1;
  if n = 1 then p := c.start;
  else
    select * into b from maxes where item_id = p_item order by max desc, t asc offset 1 limit 1;
    if a.max = b.max then p := a.max; else p := least(a.max, b.max + inc_for(b.max)); end if;
  end if;
  if c.reserve is not null and a.max >= c.reserve then p := greatest(p, c.reserve); end if;
  p := greatest(p, a.bid);
  update items set price = greatest(p, c.start), leader = a.uid where id = p_item;
end $$;

create or replace function close_internal(p_item text, p_how text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update items i set closed = true, how = p_how,
    winner = case when i.leader is not null and (c.reserve is null or i.price >= c.reserve) then i.leader end,
    final  = case when i.leader is not null and (c.reserve is null or i.price >= c.reserve) then i.price end
  from catalog c where c.id = i.id and i.id = p_item and not i.closed;
end $$;

drop function if exists place_bid(text, text, int);
-- p_kind: 'bid' = Place a bid (exact amount), 'max' = Set a maximum bid
create or replace function place_bid(p_item text, p_uid text, p_max int, p_kind text default 'max') returns jsonb
language plpgsql security definer set search_path = public as $$
declare it items%rowtype; c catalog%rowtype; au auction%rowtype; t bigint := now_ms();
        mine maxes%rowtype; was_leader boolean; prev_leader text; prev_price int; minb int; extended boolean := false;
begin
  if auth.uid() is null then return jsonb_build_object('err', 'Please reload the page and join the auction.'); end if;
  if not can_take_part() then return jsonb_build_object('err', 'Bidding opens when the auction goes live.'); end if;
  if p_uid <> auth.uid()::text and p_uid not like 'bot-%' then return jsonb_build_object('err', 'You can only bid for yourself.'); end if;
  if not exists (select 1 from people where uid = p_uid) then return jsonb_build_object('err', 'Join the auction before bidding.'); end if;
  select * into au from auction where id = 1;
  select * into it from items where id = p_item for update;          -- one bid at a time per item
  if not found or it.run <> au.run then return jsonb_build_object('err', 'This item isn''t in the current auction.'); end if;
  if it.live then return jsonb_build_object('err', 'This is a live auction lot. Bid in the room with the auctioneer.'); end if;
  select * into c from catalog where id = p_item;
  if au.phase = 'paused' then return jsonb_build_object('err', 'Bidding is paused by the auction team. Your bid was not placed.'); end if;
  if it.closed or it.ends_at <= t then return jsonb_build_object('err', 'This item has closed. Bids are no longer accepted.'); end if;
  if p_max is null or p_max <= 0 then return jsonb_build_object('err', 'Enter a whole-dollar amount.'); end if;
  select * into mine from maxes where item_id = p_item and uid = p_uid;
  was_leader := coalesce(it.leader = p_uid, false);
  if was_leader then minb := mine.max + inc_for(mine.max);
  elsif exists (select 1 from maxes where item_id = p_item) then minb := it.price + inc_for(it.price);
  else minb := c.start; end if;
  if p_kind = 'bid' and was_leader then return jsonb_build_object('err', 'You''re already the high bidder, so there''s no need to bid again.'); end if;
  if was_leader and p_max <= mine.max then
    return jsonb_build_object('err', 'Your maximum is already ' || usd(mine.max) || '. Enter a higher amount to raise it.'); end if;
  if p_max < minb then
    return jsonb_build_object('err', 'The minimum ' || case when was_leader then 'new maximum' else 'bid' end || ' is ' || usd(minb) || '.'); end if;

  prev_leader := it.leader; prev_price := it.price;
  insert into maxes (item_id, run, uid, max, t, bid) values (p_item, it.run, p_uid, p_max, t, case when p_kind = 'bid' then p_max else 0 end)
    on conflict (item_id, uid) do update set max = excluded.max, t = excluded.t,
      bid = case when p_kind = 'bid' then excluded.bid else maxes.bid end;
  perform resolve_item(p_item);
  select * into it from items where id = p_item;
  update items set bid_count = bid_count + 1,
    bidder_ids = case when p_uid = any(bidder_ids) then bidder_ids else bidder_ids || p_uid end
    where id = p_item;
  if it.leader = p_uid then
    if not was_leader or it.price <> prev_price then
      insert into history (item_id, run, uid, amt, t) values (p_item, it.run, p_uid, it.price, t); end if;
    if prev_leader is not null and prev_leader <> p_uid then update items set outbids = outbids + 1 where id = p_item; end if;
  else
    insert into history (item_id, run, uid, amt, t, auto) values
      (p_item, it.run, p_uid, p_max, t, false), (p_item, it.run, it.leader, it.price, t + 1, true);
    update items set proxy_count = proxy_count + 1, outbids = outbids + 1 where id = p_item;
  end if;
  -- soft close: a late bid extends this item
  if it.ends_at - t <= (au.settings->>'softWin')::int * 1000 then
    update items set ends_at = greatest(ends_at, t + (au.settings->>'softExt')::int * 1000), ext = ext + 1 where id = p_item;
    extended := true;
  end if;
  return jsonb_build_object('ok', true, 'leading', it.leader = p_uid, 'wasLeader', was_leader,
    'max', p_max, 'price', it.price, 'extended', extended, 'title', c.title, 'kind', case when p_kind = 'bid' then 'bid' else 'max' end);
end $$;

create or replace function buy_now(p_item text, p_uid text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare it items%rowtype; c catalog%rowtype; au auction%rowtype; t bigint := now_ms();
begin
  if auth.uid() is null or (p_uid <> auth.uid()::text and p_uid not like 'bot-%') then return jsonb_build_object('err', 'You can only buy for yourself.'); end if;
  if not can_take_part() then return jsonb_build_object('err', 'Bidding opens when the auction goes live.'); end if;
  select * into au from auction where id = 1;
  select * into it from items where id = p_item for update;
  select * into c from catalog where id = p_item;
  if it.live or not c.premium or c.bin is null or it.closed or it.ends_at <= t or it.price >= c.bin or au.phase <> 'live' then
    return jsonb_build_object('err', 'Buy It Now is no longer available for this item.'); end if;
  insert into history (item_id, run, uid, amt, t, bin) values (p_item, it.run, p_uid, c.bin, t, true);
  insert into maxes (item_id, run, uid, max, t) values (p_item, it.run, p_uid, c.bin, t)
    on conflict (item_id, uid) do update set max = excluded.max, t = excluded.t;
  update items set leader = p_uid, price = c.bin, bid_count = bid_count + 1,
    outbids = outbids + case when leader is not null and leader <> p_uid then 1 else 0 end,
    bidder_ids = case when p_uid = any(bidder_ids) then bidder_ids else bidder_ids || p_uid end
    where id = p_item;
  perform close_internal(p_item, 'bin');
  return jsonb_build_object('ok', true);
end $$;

-- Any visitor can ask the server to close items whose time is up; the server checks the clock.
create or replace function close_due() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  if (select phase from auction where id = 1) <> 'live' then return 0; end if;
  for r in select id from items where not closed and not live and ends_at <= now_ms() for update skip locked loop
    perform close_internal(r.id, 'time'); n := n + 1;
  end loop;
  return n;
end $$;

create or replace function join_auction(p_name text) returns int
language plpgsql security definer set search_path = public as $$
declare pd int; nm text := left(trim(p_name), 40);
begin
  if auth.uid() is null or nm = '' then raise exception 'Enter your name to join.'; end if;
  if not can_take_part() then raise exception 'The auction isn''t open yet.'; end if;
  perform pg_advisory_xact_lock(7001);
  select paddle into pd from people where uid = auth.uid()::text;
  if found then update people set name = nm where uid = auth.uid()::text; return pd; end if;
  select coalesce(max(paddle), 100) + 1 into pd from people where not bot;
  insert into people (uid, name, paddle) values (auth.uid()::text, nm, pd);
  return pd;
end $$;

create or replace function become_admin(p_code text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return false; end if;
  if p_code = (select v from app_secrets where k = 'admin_code') then
    insert into admins values (auth.uid()) on conflict do nothing; return true;
  end if;
  perform pg_sleep(1);  -- slows down guessing
  return false;
end $$;

-- One open browser at a time runs the simulated bidders.
create or replace function take_lease(p_name text, p_holder text, p_ttl int) returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into leases values (p_name, p_holder, now_ms() + p_ttl)
    on conflict (name) do update set holder = excluded.holder, until = excluded.until
    where leases.until < now_ms() or leases.holder = excluded.holder;
  get diagnostics n = row_count; return n > 0;
end $$;

-- ---------- admin actions ----------
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

create or replace function admin_pause(p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare au auction%rowtype; t bigint := now_ms();
begin
  if not is_admin() then raise exception 'Only auction admins can do that.'; end if;
  select * into au from auction where id = 1 for update;
  if p_on and au.phase = 'live' then update auction set phase = 'paused', paused_at = t where id = 1;
  elsif not p_on and au.phase = 'paused' then
    update items set ends_at = ends_at + (t - au.paused_at) where not closed;
    update auction set phase = 'live', paused_at = null where id = 1;
  end if;
end $$;

create or replace function admin_extend(p_ms bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Only auction admins can do that.'; end if;
  update items set ends_at = ends_at + p_ms where not closed and not live;
end $$;

create or replace function admin_close(p_item text) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not is_admin() then raise exception 'Only auction admins can do that.'; end if;
  for r in select id from items where not closed and not live and (p_item is null or id = p_item) for update loop
    perform close_internal(r.id, 'manual');
  end loop;
end $$;

create or replace function admin_settings(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Only auction admins can do that.'; end if;
  update auction set settings = settings || p where id = 1;
end $$;

create or replace function admin_pickup(p_item text, p_by text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then return jsonb_build_object('err', 'Only auction admins can do that.'); end if;
  update items set pickup = jsonb_build_object('by', left(p_by, 40), 't', now_ms()) where id = p_item and pickup is null;
  if not found then return jsonb_build_object('err', 'This item was already released.'); end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function admin_mark_paid(p_item text) returns void
language plpgsql security definer set search_path = public as $$
declare it items%rowtype; pd int;
begin
  if not is_admin() then raise exception 'Only auction admins can do that.'; end if;
  select * into it from items where id = p_item;
  select paddle into pd from people where uid = it.winner;
  insert into orders values ('MAN-' || it.run || '-' || it.id, it.run, it.winner, array[it.id], 0, 0, it.final, 'paid', now_ms(), 'manual', 'P' || pd || '-' || it.id)
    on conflict (id) do nothing;
end $$;

create or replace function admin_set_photos(p_item text, p_list text[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Only auction admins can do that.'; end if;
  insert into photos values (p_item, p_list) on conflict (item_id) do update set list = excluded.list;
end $$;

create or replace function admin_config(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then return jsonb_build_object('err', 'Only auction admins can do that.'); end if;
  update config set data = p where id = 1;
  return jsonb_build_object('ok', true);
end $$;

-- Add or edit an item. Items added during a run join it right away.
create or replace function admin_upsert_item(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id text := p->>'id'; v_no int; v_start int; v_res int; v_bin int; au auction%rowtype; t bigint := now_ms(); e bigint;
        v_mode text := case when p->>'mode' = 'live' then 'live' else 'silent' end;
        v_prem boolean := coalesce((p->>'premium')::boolean, false);
begin
  if not is_admin() then return jsonb_build_object('err', 'Only auction admins can do that.'); end if;
  v_no := (p->>'no')::int; v_start := (p->>'start')::int;
  v_res := nullif(p->>'reserve', '')::int; v_bin := nullif(p->>'bin', '')::int;
  if v_id is null or v_id !~ '^[A-Za-z0-9_-]{1,40}$' then return jsonb_build_object('err', 'This item has an invalid id.'); end if;
  if coalesce(trim(p->>'title'), '') = '' then return jsonb_build_object('err', 'Give the item a title.'); end if;
  if v_no is null or v_no < 1 then return jsonb_build_object('err', 'Item # must be a whole number.'); end if;
  if exists (select 1 from catalog where no = v_no and id <> v_id) then return jsonb_build_object('err', 'Item # ' || v_no || ' is already used.'); end if;
  if v_start is null or v_start < 1 then return jsonb_build_object('err', 'Enter a starting bid of at least $1.'); end if;
  if v_res is not null and v_res < v_start then return jsonb_build_object('err', 'The reserve must be at least the starting bid.'); end if;
  if v_bin is not null and v_bin <= v_start then return jsonb_build_object('err', 'Buy It Now must be higher than the starting bid.'); end if;
  if v_prem and v_bin is null then return jsonb_build_object('err', 'Enter the Buy It Now price for this premium item.'); end if;
  if v_prem and v_mode = 'live' then return jsonb_build_object('err', 'Buy It Now is for silent items. Live lots are sold by the auctioneer.'); end if;
  insert into catalog (id, no, title, cat, value, start, reserve, bin, featured, descr, donor, pickup, mode, premium)
  values (v_id, v_no, left(trim(p->>'title'), 120), coalesce(p->>'cat', 'exp'), greatest(coalesce((p->>'value')::int, 0), 0), v_start, v_res, v_bin,
          coalesce((p->>'featured')::boolean, false), left(p->>'descr', 4000), left(p->>'donor', 200), left(p->>'pickup', 300), v_mode, v_prem)
  on conflict (id) do update set no = excluded.no, title = excluded.title, cat = excluded.cat, value = excluded.value, start = excluded.start,
    reserve = excluded.reserve, bin = excluded.bin, featured = excluded.featured, descr = excluded.descr, donor = excluded.donor, pickup = excluded.pickup,
    mode = excluded.mode, premium = excluded.premium;
  select * into au from auction where id = 1;
  if au.phase <> 'none' and exists (select 1 from items where run = au.run) then
    select coalesce(max(ends_at), t + au.dur * 60000) into e from items where not closed and not live and id <> v_id;
    e := greatest(e, t + 60000);
    if exists (select 1 from items where id = v_id) then
      update items set price = v_start, live = (v_mode = 'live'),
        ends_at = case when (v_mode = 'live') = live then ends_at when v_mode = 'live' then t + 7 * 86400000 else e end
        where id = v_id and bid_count = 0 and not closed;
    else
      insert into items (id, run, price, ends_at, live)
        values (v_id, au.run, v_start, case when v_mode = 'live' then t + 7 * 86400000 else e end, v_mode = 'live');
    end if;
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function admin_delete_item(p_item text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then return jsonb_build_object('err', 'Only auction admins can do that.'); end if;
  if exists (select 1 from items where id = p_item and bid_count > 0) then
    return jsonb_build_object('err', 'This item has bids, so it can''t be deleted.'); end if;
  delete from photos where item_id = p_item;
  delete from catalog where id = p_item;   -- also removes it from the current run
  return jsonb_build_object('ok', true);
end $$;

-- ---------- live auction (clerk) ----------
create or replace function admin_record_live(p_item text, p_paddle int, p_price int, p_name text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare it items%rowtype; v_uid text; t bigint := now_ms();
begin
  if not is_admin() then return jsonb_build_object('err', 'Only auction admins can do that.'); end if;
  if p_price is null or p_price < 1 then return jsonb_build_object('err', 'Enter the winning bid.'); end if;
  select * into it from items where id = p_item for update;
  if not found or not it.live then return jsonb_build_object('err', 'This isn''t a live lot.'); end if;
  if it.closed then return jsonb_build_object('err', 'This lot is already recorded. Undo it first to change it.'); end if;
  perform pg_advisory_xact_lock(7001);
  select uid into v_uid from people where paddle = p_paddle;
  if v_uid is null then
    if coalesce(trim(p_name), '') = '' then return jsonb_build_object('err', 'No bidder #' || p_paddle || '. Enter their name to add them.'); end if;
    v_uid := 'walk-' || p_paddle;
    insert into people (uid, name, paddle) values (v_uid, left(trim(p_name), 40), p_paddle);
  end if;
  insert into history (item_id, run, uid, amt, t, live) values (p_item, it.run, v_uid, p_price, t, true);
  update items set closed = true, how = 'live', winner = v_uid, leader = v_uid, final = p_price, price = p_price,
    bid_count = bid_count + 1, bidder_ids = case when v_uid = any(bidder_ids) then bidder_ids else bidder_ids || v_uid end
    where id = p_item;
  return jsonb_build_object('ok', true, 'uid', v_uid);
end $$;

create or replace function admin_live_nosale(p_item text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then return jsonb_build_object('err', 'Only auction admins can do that.'); end if;
  update items set closed = true, how = 'live', winner = null, final = null where id = p_item and live and not closed;
  if not found then return jsonb_build_object('err', 'This lot is already recorded.'); end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function admin_undo_live(p_item text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare it items%rowtype;
begin
  if not is_admin() then return jsonb_build_object('err', 'Only auction admins can do that.'); end if;
  select * into it from items where id = p_item for update;
  if not found or not it.live then return jsonb_build_object('err', 'Only live lots can be reopened here.'); end if;
  if exists (select 1 from orders where status = 'paid' and run = it.run and p_item = any(items)) then
    return jsonb_build_object('err', 'This lot has already been paid for. Adjust the payment before reopening it.'); end if;
  delete from history where item_id = p_item and live;
  update items set closed = false, how = null, winner = null, final = null, leader = null, bid_count = 0, bidder_ids = '{}',
    price = (select start from catalog where id = p_item) where id = p_item;
  return jsonb_build_object('ok', true);
end $$;

create or replace function admin_set_lot(p_item text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then return jsonb_build_object('err', 'Only auction admins can do that.'); end if;
  update auction set live_lot = p_item, drawing = null where id = 1;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- drawings ----------
create or replace function admin_save_drawing(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id text := p->>'id';
begin
  if not is_admin() then return jsonb_build_object('err', 'Only auction admins can do that.'); end if;
  if v_id is null or v_id !~ '^[A-Za-z0-9_-]{1,40}$' then return jsonb_build_object('err', 'This drawing has an invalid id.'); end if;
  if coalesce(trim(p->>'name'), '') = '' then return jsonb_build_object('err', 'Give the drawing a name.'); end if;
  if coalesce(p->>'kind', '') not in ('raffle', 'golden', 'bucket') then return jsonb_build_object('err', 'Choose a drawing type.'); end if;
  insert into drawings values (v_id, p - 'id') on conflict (id) do update set data = excluded.data;
  return jsonb_build_object('ok', true);
end $$;

create or replace function admin_delete_drawing(p_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then return jsonb_build_object('err', 'Only auction admins can do that.'); end if;
  if exists (select 1 from drawings where id = p_id and data ? 'winner' and data->'winner' <> 'null'::jsonb) then
    return jsonb_build_object('err', 'Remove the winner before deleting this drawing.'); end if;
  delete from drawings where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function admin_save_pool(p_pool text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then return jsonb_build_object('err', 'Only auction admins can do that.'); end if;
  if p_pool not in ('raffle', 'golden') then return jsonb_build_object('err', 'Unknown ticket list.'); end if;
  insert into pools values (p_pool, p_rows, now_ms()) on conflict (pool) do update set rows = excluded.rows, t = excluded.t;
  return jsonb_build_object('ok', true);
end $$;

create or replace function admin_set_drawing(p_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then return jsonb_build_object('err', 'Only auction admins can do that.'); end if;
  update auction set drawing = p_id, live_lot = null where id = 1;
  return jsonb_build_object('ok', true);
end $$;

-- The Golden Ticket winner takes a live lot out of the live auction.
create or replace function admin_assign_golden(p_item text, p_paddle int, p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare it items%rowtype; v_uid text;
begin
  if not is_admin() then return jsonb_build_object('err', 'Only auction admins can do that.'); end if;
  select * into it from items where id = p_item for update;
  if not found or not it.live or it.closed then return jsonb_build_object('err', 'That lot is no longer available.'); end if;
  perform pg_advisory_xact_lock(7001);
  select uid into v_uid from people where paddle = p_paddle;
  if v_uid is null then
    if coalesce(trim(p_name), '') = '' then return jsonb_build_object('err', 'Enter the winner''s name.'); end if;
    v_uid := 'walk-' || p_paddle;
    insert into people (uid, name, paddle) values (v_uid, left(trim(p_name), 40), p_paddle);
  end if;
  update items set closed = true, how = 'golden', winner = v_uid, leader = v_uid, final = 0,
    bidder_ids = case when v_uid = any(bidder_ids) then bidder_ids else bidder_ids || v_uid end where id = p_item;
  return jsonb_build_object('ok', true);
end $$;

create or replace function admin_unassign_golden(p_item text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then return jsonb_build_object('err', 'Only auction admins can do that.'); end if;
  update items set closed = false, how = null, winner = null, leader = null, final = null, bidder_ids = '{}'
    where id = p_item and how = 'golden';
  return jsonb_build_object('ok', true);
end $$;

-- ---------- live updates ----------
do $$ declare tb text; begin
  foreach tb in array array['auction','items','people','orders','anns','photos','history','feedback','catalog','config','donations','drawings','pools'] loop
    begin execute format('alter publication supabase_realtime add table %I', tb);
    exception when duplicate_object then null; end;
  end loop;
end $$;

-- ---------- photo storage ----------
insert into storage.buckets (id, name, public) values ('photos', 'photos', true) on conflict (id) do nothing;
drop policy if exists "auction admins add photos" on storage.objects;
create policy "auction admins add photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and public.is_admin());
drop policy if exists "auction admins remove photos" on storage.objects;
create policy "auction admins remove photos" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and public.is_admin());

-- ---------- the event's items ----------
insert into catalog (id, no, title, cat, value, start, reserve, bin, featured, descr, donor, pickup) values
 ('i1', 1, 'Lake Geneva Weekend Getaway', 'travel', 900, 200, 350, null, true, 'Two nights in a three-bedroom lakefront cottage, with kayaks and a fire pit. Book any weekend from May through September 2027, subject to availability.', 'The Hendricks Family', 'Certificate emailed after checkout.'),
 ('i2', 2, 'Chef''s Table Dinner for Six', 'dining', 600, 150, null, null, false, 'A local chef plans and cooks a five-course seasonal dinner in your home for six guests, including wine pairings. Schedule within 12 months.', 'Chef Ana Ruiz', 'Certificate emailed after checkout.'),
 ('i3', 3, 'Four Field-Box Baseball Tickets', 'sports', 400, 100, null, null, false, 'Four field-box seats behind the first-base dugout for a 2027 regular-season game of your choice, plus one parking pass.', 'Prairie State Insurance', 'Tickets transferred digitally.'),
 ('i4', 4, 'Handmade Care Circle Quilt', 'home', 350, 75, null, null, false, 'A queen-size patchwork quilt in blues and golds, hand-stitched over eight months by the Care Circle volunteer group.', 'Care Circle Volunteers', 'Pick up at the welcome table.'),
 ('i5', 5, 'Family Pizza Night for a Year', 'dining', 300, 60, null, null, false, 'Twelve vouchers for one large specialty pizza and a family salad, one per month. Dine in or carry out.', 'Rosati''s on Main', 'Vouchers at the welcome table.'),
 ('i6', 6, 'Golf Foursome at Prairie Ridge', 'sports', 480, 120, 200, null, false, 'Eighteen holes with carts for four players at Prairie Ridge Golf Club, plus lunch at the clubhouse grill. Valid April through October 2027.', 'Prairie Ridge Golf Club', 'Certificate emailed after checkout.'),
 ('i7', 7, 'Kids'' Summer Art Camp', 'kids', 275, 50, null, null, false, 'One week of half-day summer art camp for one child aged 6 to 12. All materials included. Choose from four June and July sessions.', 'Fox Valley Art Studio', 'Enrollment code emailed.'),
 ('i8', 8, 'Sunrise Hot Air Balloon Ride', 'exp', 700, 175, null, null, true, 'A one-hour sunrise balloon flight for two over the Fox River valley, followed by a champagne toast and flight certificate. Weather dependent.', 'Skyward Balloons', 'Certificate emailed after checkout.'),
 ('i9', 9, 'Family Photography Session', 'exp', 450, 100, null, null, false, 'A 90-minute outdoor session at the location of your choice, with 25 professionally edited digital images and one 11×14 print.', 'Maple Lane Photography', 'Certificate emailed after checkout.'),
 ('i10', 10, 'Pie of the Month Club', 'dining', 180, 40, null, 240, false, 'One fresh-baked fruit or cream pie delivered to your door each month for six months. Includes a holiday pie in December.', 'Grandma Jo''s Bakery', 'Delivery scheduled after checkout.')
on conflict (id) do nothing;

-- Sample pictures that ship with the website (replace them from Admin → Items → Photos)
insert into photos (item_id, list) values
 ('i1', array['img/p01-lake.jpg','img/c01.jpg']), ('i2', array['img/p02-chef.jpg','img/c02.jpg']),
 ('i3', array['img/p03-tickets.jpg']), ('i4', array['img/p04-quilt.jpg']),
 ('i5', array['img/p05-pizza.jpg','img/c05.jpg']), ('i6', array['img/p06-golf.jpg','img/c06.jpg']),
 ('i7', array['img/p07-palette.jpg','img/c07.jpg']), ('i8', array['img/p08-balloon.jpg','img/c08.jpg']),
 ('i9', array['img/p09-camera.jpg','img/c09.jpg']), ('i10', array['img/p10-pie.jpg'])
on conflict (item_id) do nothing;
