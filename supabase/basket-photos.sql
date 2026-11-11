-- Donor baskets: more than one photo per basket, and longer descriptions.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.
-- More than one photo: photos[1] is the main one (photo keeps a copy of it)
alter table site.baskets add column if not exists photos text[] not null default '{}';
update site.baskets set photos = array[photo] where photo <> '' and photos = '{}';

-- ---------- Auction Admin actions (need the auction admin code) ----------
create or replace function public.admin_baskets() returns jsonb
language plpgsql stable security definer set search_path = public, site as $$
begin
  if not is_admin() then raise exception 'Only auction admins can do that.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', b.id, 'title', b.title, 'description', b.description, 'cost', b.cost, 'photo', b.photo, 'photos', b.photos, 'active', b.active, 'sort', b.sort,
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
  ph text[] := case when jsonb_typeof(p->'photos') = 'array' then (select coalesce(array_agg(x), '{}') from (select jsonb_array_elements_text(p->'photos') x limit 10) q)
                    when coalesce(p->>'photo', '') <> '' then array[p->>'photo'] else null end;
begin
  if not is_admin() then raise exception 'Only auction admins can do that.'; end if;
  if t = '' then return jsonb_build_object('err', 'Give the basket a name.'); end if;
  if not (c >= 1 and c <= 50000) then return jsonb_build_object('err', 'Enter what the basket costs, between $1 and $50,000.'); end if;
  if bid is null then
    insert into site.baskets (title, description, cost, photo, photos, active, sort)
    values (t, left(coalesce(p->>'description', ''), 4000), c, coalesce(ph[1], ''), coalesce(ph, '{}'), coalesce((p->>'active')::boolean, false),
            coalesce((select max(sort) + 1 from site.baskets), 1))
    returning id into bid;
  else
    update site.baskets set title = t, description = left(coalesce(p->>'description', description), 4000), cost = c,
      photos = coalesce(ph, photos), photo = case when ph is null then photo else coalesce(ph[1], '') end, active = coalesce((p->>'active')::boolean, active), updated_at = now()
    where id = bid;
    if not found then return jsonb_build_object('err', 'That basket was deleted.'); end if;
  end if;
  return jsonb_build_object('ok', true, 'id', bid);
end $$;

