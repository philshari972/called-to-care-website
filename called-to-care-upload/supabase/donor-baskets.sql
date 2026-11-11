-- Donor baskets: the committee adds baskets in the Auction Admin (Baskets tab); the ones turned on show on the
-- Charity Dinner page, where a donor claims one by paying its cost. Paid baskets are marked "Given" automatically.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.

create table if not exists site.baskets (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  cost numeric(10,2) not null check (cost > 0),
  photo text not null default '',            -- path in the public "photos" storage bucket
  active boolean not null default false,     -- shown on the Charity Dinner page
  sort int not null default 0,
  held_until timestamptz,                    -- someone is at checkout with it (expires on its own)
  held_payment uuid,
  claimed_at timestamptz,
  claimed_payment uuid references site.payments(id) on delete set null,
  claimed_contact uuid references site.contacts(id) on delete set null,
  claimed_name text not null default '',     -- name the donor asked us to show (optional)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table site.baskets enable row level security;   -- only the website's server functions and the admin actions below touch it

-- ---------- Auction Admin actions (need the auction admin code) ----------
create or replace function public.admin_baskets() returns jsonb
language plpgsql stable security definer set search_path = public, site as $$
begin
  if not is_admin() then raise exception 'Only auction admins can do that.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', b.id, 'title', b.title, 'description', b.description, 'cost', b.cost, 'photo', b.photo, 'active', b.active, 'sort', b.sort,
      'held', coalesce(b.held_until > now(), false) and b.claimed_at is null,
      'claimed_at', b.claimed_at, 'claimed_name', b.claimed_name,
      'donor', nullif(trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), ''), 'donor_email', c.email,
      'via', case when b.claimed_payment is not null then 'Paid online' when b.claimed_at is not null then 'Marked by hand' end)
    order by b.sort, b.created_at)
    from site.baskets b left join site.contacts c on c.id = b.claimed_contact), '[]'::jsonb);
end $$;

create or replace function public.admin_basket_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, site as $$
declare bid uuid := nullif(p->>'id', '')::uuid; t text := left(trim(coalesce(p->>'title', '')), 120); c numeric := round(coalesce((p->>'cost')::numeric, 0), 2);
begin
  if not is_admin() then raise exception 'Only auction admins can do that.'; end if;
  if t = '' then return jsonb_build_object('err', 'Give the basket a name.'); end if;
  if not (c >= 1 and c <= 50000) then return jsonb_build_object('err', 'Enter what the basket costs, between $1 and $50,000.'); end if;
  if bid is null then
    insert into site.baskets (title, description, cost, photo, active, sort)
    values (t, left(coalesce(p->>'description', ''), 1500), c, coalesce(p->>'photo', ''), coalesce((p->>'active')::boolean, false),
            coalesce((select max(sort) + 1 from site.baskets), 1))
    returning id into bid;
  else
    update site.baskets set title = t, description = left(coalesce(p->>'description', description), 1500), cost = c,
      photo = coalesce(p->>'photo', photo), active = coalesce((p->>'active')::boolean, active), updated_at = now()
    where id = bid;
    if not found then return jsonb_build_object('err', 'That basket was deleted.'); end if;
  end if;
  return jsonb_build_object('ok', true, 'id', bid);
end $$;

-- p_id null = every basket
create or replace function public.admin_basket_show(p_id uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public, site as $$
begin
  if not is_admin() then raise exception 'Only auction admins can do that.'; end if;
  update site.baskets set active = p_on, updated_at = now() where p_id is null or id = p_id;
end $$;

create or replace function public.admin_basket_move(p_id uuid, p_dir int) returns void
language plpgsql security definer set search_path = public, site as $$
declare pos int; n int; other uuid;
begin
  if not is_admin() then raise exception 'Only auction admins can do that.'; end if;
  -- number them 1, 2, 3... in their current order, then swap with the neighbor
  update site.baskets b set sort = o.rn from (select id, row_number() over (order by sort, created_at) rn from site.baskets) o where o.id = b.id;
  select sort into pos from site.baskets where id = p_id; if not found then return; end if;
  select id into other from site.baskets where sort = pos + sign(p_dir)::int;
  if other is null then return; end if;
  update site.baskets set sort = pos where id = other;
  update site.baskets set sort = pos + sign(p_dir)::int where id = p_id;
end $$;

-- For a basket someone paid for by check or cash: mark it given (or undo).
create or replace function public.admin_basket_given(p_id uuid, p_given boolean, p_name text) returns jsonb
language plpgsql security definer set search_path = public, site as $$
begin
  if not is_admin() then raise exception 'Only auction admins can do that.'; end if;
  if p_given then
    update site.baskets set claimed_at = coalesce(claimed_at, now()), claimed_name = left(coalesce(nullif(trim(p_name), ''), claimed_name), 120), updated_at = now() where id = p_id;
  else
    if exists (select 1 from site.baskets where id = p_id and claimed_payment is not null) then
      return jsonb_build_object('err', 'This basket was paid for online. Refund it in Stripe or PayPal first, then email us to reopen it.');
    end if;
    update site.baskets set claimed_at = null, claimed_name = '', claimed_contact = null, updated_at = now() where id = p_id;
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_basket_delete(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, site as $$
begin
  if not is_admin() then raise exception 'Only auction admins can do that.'; end if;
  if exists (select 1 from site.baskets where id = p_id and claimed_payment is not null) then
    return jsonb_build_object('err', 'A donor already paid for this basket, so it stays on record. Turn it off to hide it.');
  end if;
  delete from site.baskets where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.admin_baskets(), public.admin_basket_save(jsonb), public.admin_basket_show(uuid, boolean),
  public.admin_basket_move(uuid, int), public.admin_basket_given(uuid, boolean, text), public.admin_basket_delete(uuid) from public, anon;
grant execute on function public.admin_baskets(), public.admin_basket_save(jsonb), public.admin_basket_show(uuid, boolean),
  public.admin_basket_move(uuid, int), public.admin_basket_given(uuid, boolean, text), public.admin_basket_delete(uuid) to authenticated;
