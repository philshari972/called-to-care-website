-- November update: donor baskets can be claimed (filled by the donor) and shared by link,
-- Buy It Now is only for "premium" auction items, and raffle winners can have no name.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.

-- ---------- Donor baskets ----------
alter table site.baskets add column if not exists claim_kind text not null default '';     -- 'paid' online, 'check' (marked by hand), 'fill' (donor fills it)
alter table site.baskets add column if not exists received_at timestamptz;                 -- a claimed basket came in, filled
alter table site.baskets add column if not exists unlisted boolean not null default false; -- on, but only for people with its link
update site.baskets set claim_kind = case when claimed_payment is not null then 'paid' else 'check' end
  where claimed_at is not null and claim_kind = '';

-- Claim settings (deadline and drop-off note), kept with the other website settings
insert into site.settings (key, value) values
  ('basket_claims', '{"on": true, "deadline": "2027-02-01", "dropoff": "We''ll email you where to drop it off."}')
on conflict (key) do nothing;

create or replace function public.admin_baskets() returns jsonb
language plpgsql stable security definer set search_path = public, site as $$
begin
  if not is_admin() then raise exception 'Only auction admins can do that.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', b.id, 'title', b.title, 'description', b.description, 'cost', b.cost, 'photo', b.photo, 'photos', b.photos, 'active', b.active, 'sort', b.sort,
      'unlisted', b.unlisted,
      'held', coalesce(b.held_until > now(), false) and b.claimed_at is null,
      'claimed_at', b.claimed_at, 'claimed_name', b.claimed_name, 'claim_kind', b.claim_kind, 'received_at', b.received_at,
      'donor', nullif(trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), ''), 'donor_email', c.email, 'donor_phone', c.phone,
      'via', case when b.claimed_payment is not null then 'Paid online' when b.claim_kind = 'fill' then 'Claimed to fill'
                  when b.claimed_at is not null then 'Marked by hand' end)
    order by b.sort, b.created_at)
    from site.baskets b left join site.contacts c on c.id = b.claimed_contact), '[]'::jsonb);
end $$;

create or replace function public.admin_basket_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, site as $$
declare bid uuid := nullif(p->>'id', '')::uuid; t text := left(trim(coalesce(p->>'title', '')), 120); c numeric := round(coalesce((p->>'cost')::numeric, 0), 2);
  ph text[] := case when jsonb_typeof(p->'photos') = 'array' then (select coalesce(array_agg(x), '{}') from (select jsonb_array_elements_text(p->'photos') x limit 10) q)
                    when coalesce(p->>'photo', '') <> '' then array[p->>'photo'] else null end;
begin
  if not is_admin() then raise exception 'Only auction admins can do that.'; end if;
  if t = '' then return jsonb_build_object('err', 'Give the basket a name.'); end if;
  if not (c >= 1 and c <= 50000) then return jsonb_build_object('err', 'Enter what the basket costs, between $1 and $50,000.'); end if;
  if bid is null then
    insert into site.baskets (title, description, cost, photo, photos, active, unlisted, sort)
    values (t, left(coalesce(p->>'description', ''), 4000), c, coalesce(ph[1], ''), coalesce(ph, '{}'), coalesce((p->>'active')::boolean, false),
            coalesce((p->>'unlisted')::boolean, false), coalesce((select max(sort) + 1 from site.baskets), 1))
    returning id into bid;
  else
    update site.baskets set title = t, description = left(coalesce(p->>'description', description), 4000), cost = c,
      photos = coalesce(ph, photos), photo = case when ph is null then photo else coalesce(ph[1], '') end, active = coalesce((p->>'active')::boolean, active),
      unlisted = coalesce((p->>'unlisted')::boolean, unlisted), updated_at = now()
    where id = bid;
    if not found then return jsonb_build_object('err', 'That basket was deleted.'); end if;
  end if;
  return jsonb_build_object('ok', true, 'id', bid);
end $$;

-- Mark a basket given by hand (check or cash), or open it again. Opening it again also releases a claim.
create or replace function public.admin_basket_given(p_id uuid, p_given boolean, p_name text) returns jsonb
language plpgsql security definer set search_path = public, site as $$
begin
  if not is_admin() then raise exception 'Only auction admins can do that.'; end if;
  if p_given then
    update site.baskets set claimed_at = coalesce(claimed_at, now()), claimed_name = left(coalesce(nullif(trim(p_name), ''), claimed_name), 120),
      claim_kind = case when claimed_at is null then 'check' else claim_kind end, updated_at = now() where id = p_id;
  else
    if exists (select 1 from site.baskets where id = p_id and claimed_payment is not null) then
      return jsonb_build_object('err', 'This basket was paid for online. Refund it in Stripe or PayPal first, then email us to reopen it.');
    end if;
    update site.baskets set claimed_at = null, claimed_name = '', claimed_contact = null, claim_kind = '', received_at = null, updated_at = now() where id = p_id;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- A claimed basket came in filled (or undo that).
create or replace function public.admin_basket_received(p_id uuid, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public, site as $$
begin
  if not is_admin() then raise exception 'Only auction admins can do that.'; end if;
  update site.baskets set received_at = case when p_on then coalesce(received_at, now()) end, updated_at = now() where id = p_id and claimed_at is not null;
  return jsonb_build_object('ok', true);
end $$;

-- Claim settings: read them (p null) or save them.
create or replace function public.admin_basket_settings(p jsonb default null) returns jsonb
language plpgsql security definer set search_path = public, site as $$
declare cur jsonb; d date;
begin
  if not is_admin() then raise exception 'Only auction admins can do that.'; end if;
  select value into cur from site.settings where key = 'basket_claims';
  cur := coalesce(cur, '{"on": true, "deadline": "2027-02-01", "dropoff": ""}'::jsonb);
  if p is null then return cur; end if;
  begin d := (p->>'deadline')::date; exception when others then return jsonb_build_object('err', 'Enter the claim deadline as a date.'); end;
  if d is null then return jsonb_build_object('err', 'Enter the claim deadline as a date.'); end if;
  cur := jsonb_build_object('on', coalesce((p->>'on')::boolean, true), 'deadline', to_char(d, 'YYYY-MM-DD'), 'dropoff', left(coalesce(p->>'dropoff', ''), 500));
  insert into site.settings (key, value) values ('basket_claims', cur) on conflict (key) do update set value = excluded.value;
  return cur;
end $$;

revoke all on function public.admin_baskets(), public.admin_basket_save(jsonb), public.admin_basket_given(uuid, boolean, text),
  public.admin_basket_received(uuid, boolean), public.admin_basket_settings(jsonb) from public, anon;
grant execute on function public.admin_baskets(), public.admin_basket_save(jsonb), public.admin_basket_given(uuid, boolean, text),
  public.admin_basket_received(uuid, boolean), public.admin_basket_settings(jsonb) to authenticated;

-- ---------- Auction: Buy It Now only on premium items ----------
alter table public.catalog add column if not exists premium boolean not null default false;

create or replace function public.admin_upsert_item(p jsonb) returns jsonb
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

create or replace function public.buy_now(p_item text, p_uid text) returns jsonb
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

select 'Baskets, Buy It Now and raffles updated' as result;
