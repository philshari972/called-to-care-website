-- Combine two contact records that are the same person (admin: Sponsors & Guests -> Possible duplicates).
-- Moves dinners, sponsorships, payments, forms and letters to the record you keep, fills in any missing details,
-- then deletes the other record. Owners and anyone with edit access to Sponsors or the Email List can use it.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.

create or replace function site.merge_contacts(p_keep uuid, p_drop uuid) returns void
language plpgsql security definer set search_path = site, public as $$
declare r record; d site.contacts;
begin
  -- (no signed-in user means it's being run by hand in the SQL Editor; the website can't call it without signing in)
  if auth.uid() is not null and not (site.is_owner() or site.level_for('sponsors') >= 3 or site.level_for('emaillist') >= 3) then
    raise exception 'You need edit access to Sponsors & Guests to combine contacts.';
  end if;
  if p_keep is null or p_drop is null or p_keep = p_drop then return; end if;
  if not exists (select 1 from site.contacts where id = p_keep) then raise exception 'Contact not found'; end if;
  select * into d from site.contacts where id = p_drop; if not found then return; end if;
  -- the same person at the same dinner twice: keep one row, fill in what's missing
  update site.attendance k set present = k.present or x.present,
         guests = greatest(k.guests, x.guests),
         bid_number = coalesce(k.bid_number, x.bid_number),
         auction_total = coalesce(k.auction_total, x.auction_total),
         table_label = case when k.table_label = '' then x.table_label else k.table_label end,
         ticket_type = case when k.ticket_type = '' then x.ticket_type else k.ticket_type end
    from site.attendance x where k.contact_id = p_keep and x.contact_id = p_drop and k.year = x.year;
  delete from site.attendance x using site.attendance k where x.contact_id = p_drop and k.contact_id = p_keep and k.year = x.year;
  -- everything else that points at the contact moves over
  for r in select c.conrelid::regclass as t, a.attname as col from pg_constraint c
           join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
           where c.contype = 'f' and c.confrelid = 'site.contacts'::regclass loop
    execute format('update %s set %I = $1 where %I = $2', r.t, r.col, r.col) using p_keep, p_drop;
  end loop;
  delete from site.contacts where id = p_drop;
  update site.contacts k set
    tags   = (select array(select distinct unnest(k.tags || d.tags))),
    email  = coalesce(nullif(k.email, ''), nullif(d.email, '')),
    phone  = coalesce(nullif(k.phone, ''), d.phone),
    street = coalesce(nullif(k.street, ''), d.street),
    city   = coalesce(nullif(k.city, ''), d.city),
    state  = coalesce(nullif(k.state, ''), d.state),
    zip    = coalesce(nullif(k.zip, ''), d.zip),
    notes  = case when d.notes = '' then k.notes when k.notes = '' then d.notes else k.notes || E'\n' || d.notes end,
    do_not_email = k.do_not_email or d.do_not_email,
    updated_at = now()
  where k.id = p_keep;
end $$;
revoke all on function site.merge_contacts(uuid, uuid) from public, anon;
grant execute on function site.merge_contacts(uuid, uuid) to authenticated;
