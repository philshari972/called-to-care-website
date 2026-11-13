-- Bidder numbers assigned at check-in. A couple can share one number: each phone joins with the
-- number and the last name, and bids as that one bidder.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.

alter table people add column if not exists contact_ids uuid[] not null default '{}';  -- who this number is for (website contacts)
alter table people add column if not exists assigned boolean not null default false;    -- given out at check-in (not self-joined)

-- Which bidder each phone bids as
create table if not exists devices (uid uuid primary key, bidder text not null references people(uid) on delete cascade, t bigint not null default now_ms());
alter table devices enable row level security;
drop policy if exists r on devices; create policy r on devices for select to authenticated using (uid = auth.uid());
grant select on devices to authenticated;

-- The bidder this phone bids as: its check-in number if it joined with one, otherwise itself
create or replace function me_bidder() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select bidder from devices where uid = auth.uid()), auth.uid()::text) $$;
grant execute on function me_bidder() to authenticated;

-- Staff who can hand out numbers: auction admins, and website staff with Auction access (including clerks)
create or replace function can_checkin() returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if is_admin() then return true; end if;
  begin return site.level_for('auction') >= 2; exception when others then return false; end;
end $$;
grant execute on function can_checkin() to authenticated;

-- Give out a bidder number. p: {paddle (blank = next free number), name, contact_ids}
create or replace function admin_assign_paddle(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pd int := nullif(p->>'paddle', '')::int; nm text := left(trim(coalesce(p->>'name', '')), 60);
  ids uuid[] := coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(p->'contact_ids', '[]')) x), '{}');
begin
  if not can_checkin() then return jsonb_build_object('err', 'You need Auction access to give out bidder numbers.'); end if;
  if nm = '' then return jsonb_build_object('err', 'Enter the name for this bidder number.'); end if;
  perform pg_advisory_xact_lock(7001);
  if cardinality(ids) > 0 and exists (select 1 from people where contact_ids && ids) then
    return jsonb_build_object('err', 'One of these guests already has a bidder number.'); end if;
  if pd is null then select coalesce(max(paddle), 100) + 1 into pd from people where not bot; end if;
  if pd < 1 or pd > 99999 then return jsonb_build_object('err', 'Bidder numbers are 1 to 99999.'); end if;
  if exists (select 1 from people where paddle = pd) then return jsonb_build_object('err', 'Bidder #' || pd || ' is already taken.'); end if;
  insert into people (uid, name, paddle, contact_ids, assigned) values ('pad-' || pd, nm, pd, ids, true);
  return jsonb_build_object('ok', true, 'paddle', pd);
end $$;

-- Change the name or guests on a number, or take the number back (only if it hasn't bid or bought anything)
create or replace function admin_update_paddle(p_paddle int, p_name text, p_contact_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not can_checkin() then return jsonb_build_object('err', 'You need Auction access to change bidder numbers.'); end if;
  update people set name = left(trim(p_name), 60), contact_ids = coalesce(p_contact_ids, contact_ids) where paddle = p_paddle and not bot and trim(p_name) <> '';
  if not found then return jsonb_build_object('err', 'Bidder #' || p_paddle || ' wasn''t found.'); end if;
  return jsonb_build_object('ok', true);
end $$;
create or replace function admin_release_paddle(p_paddle int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u text;
begin
  if not can_checkin() then return jsonb_build_object('err', 'You need Auction access to change bidder numbers.'); end if;
  select uid into u from people where paddle = p_paddle and not bot;
  if u is null then return jsonb_build_object('err', 'Bidder #' || p_paddle || ' wasn''t found.'); end if;
  if exists (select 1 from maxes where uid = u) or exists (select 1 from history where uid = u) or exists (select 1 from orders where uid = u)
     or exists (select 1 from donations where uid = u) or exists (select 1 from items where leader = u or winner = u) then
    return jsonb_build_object('err', 'Bidder #' || p_paddle || ' has bids or purchases, so it can''t be taken back.'); end if;
  delete from people where uid = u;
  return jsonb_build_object('ok', true);
end $$;

-- A guest's phone joins with their bidder number and last name (both phones of a couple can do this)
create or replace function claim_paddle(p_paddle int, p_last text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pp people%rowtype; ln text := lower(trim(coalesce(p_last, '')));
begin
  if auth.uid() is null then return jsonb_build_object('err', 'Please reload the page and try again.'); end if;
  if not can_take_part() then return jsonb_build_object('err', 'The auction isn''t open yet.'); end if;
  select * into pp from people where paddle = p_paddle and not bot;
  if not found or ln = '' or position(ln in lower(pp.name)) = 0 then
    return jsonb_build_object('err', 'That bidder number and last name don''t match. Check the card you got at check-in.'); end if;
  if pp.uid = auth.uid()::text then return jsonb_build_object('ok', true, 'uid', pp.uid, 'paddle', pp.paddle, 'name', pp.name); end if;
  insert into devices (uid, bidder) values (auth.uid(), pp.uid) on conflict (uid) do update set bidder = excluded.bidder, t = now_ms();
  return jsonb_build_object('ok', true, 'uid', pp.uid, 'paddle', pp.paddle, 'name', pp.name);
end $$;

revoke all on function admin_assign_paddle(jsonb), admin_update_paddle(int, text, uuid[]), admin_release_paddle(int), claim_paddle(int, text) from public, anon;
grant execute on function admin_assign_paddle(jsonb), admin_update_paddle(int, text, uuid[]), admin_release_paddle(int), claim_paddle(int, text) to authenticated;

-- Everything a phone does as a bidder now goes by its bidder number
create or replace function place_bid(p_item text, p_uid text, p_max int, p_kind text default 'max') returns jsonb
language plpgsql security definer set search_path = public as $$
declare it items%rowtype; c catalog%rowtype; au auction%rowtype; t bigint := now_ms();
        mine maxes%rowtype; was_leader boolean; prev_leader text; prev_price int; minb int; extended boolean := false;
begin
  if auth.uid() is null then return jsonb_build_object('err', 'Please reload the page and join the auction.'); end if;
  if not can_take_part() then return jsonb_build_object('err', 'Bidding opens when the auction goes live.'); end if;
  if p_uid <> me_bidder() and p_uid not like 'bot-%' then return jsonb_build_object('err', 'You can only bid for yourself.'); end if;
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
  if auth.uid() is null or (p_uid <> me_bidder() and p_uid not like 'bot-%') then return jsonb_build_object('err', 'You can only buy for yourself.'); end if;
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

create or replace function join_auction(p_name text) returns int
language plpgsql security definer set search_path = public as $$
declare pd int; nm text := left(trim(p_name), 40);
begin
  if auth.uid() is null or nm = '' then raise exception 'Enter your name to join.'; end if;
  if not can_take_part() then raise exception 'The auction isn''t open yet.'; end if;
  perform pg_advisory_xact_lock(7001);
  -- this phone already uses a bidder number from check-in
  select p.paddle into pd from devices d join people p on p.uid = d.bidder where d.uid = auth.uid();
  if found then return pd; end if;
  select paddle into pd from people where uid = auth.uid()::text;
  if found then update people set name = nm where uid = auth.uid()::text; return pd; end if;
  select coalesce(max(paddle), 100) + 1 into pd from people where not bot;
  insert into people (uid, name, paddle) values (auth.uid()::text, nm, pd);
  return pd;
end $$;

do $$ begin
  drop policy if exists w on donations; create policy w on donations for insert to authenticated
    with check ((uid = me_bidder() or uid like 'bot-%') and exists (select 1 from people p where p.uid = donations.uid));
  drop policy if exists r on maxes;    create policy r on maxes    for select to authenticated using (uid = me_bidder() or uid like 'bot-%');
  drop policy if exists w on orders;   create policy w on orders   for insert to authenticated with check (uid = me_bidder() or uid like 'bot-%');
end $$;

select 'Bidder numbers ready' as result;
