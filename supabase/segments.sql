-- Segments: leave individual people out of an email, add people to a segment (one at a time or a whole upload),
-- take people out of one, and archive old segments so they stop showing in lists.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again. Run email-system.sql first.
-- A "segment" is a tag on a contact. Archiving hides the tag in the admin; nobody is removed or changed.

-- An audience can now also skip specific people:  "skip_ids": ["<contact id>", ...]
create or replace function site.email_audience(p jsonb) returns setof site.contacts
language sql stable security definer set search_path = site, public as $$
  select c.* from site.contacts c
  where c.email is not null and c.email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$'
    and c.email_ok and not c.do_not_email
    and (coalesce(p ->> 'mode', 'all') = 'all'
         or c.tags && array(select jsonb_array_elements_text(coalesce(p -> 'tags', '[]'::jsonb))))
    and not (c.tags && array(select jsonb_array_elements_text(coalesce(p -> 'skip', '[]'::jsonb))))
    and not (c.id::text in (select jsonb_array_elements_text(coalesce(p -> 'skip_ids', '[]'::jsonb)))) $$;
revoke all on function site.email_audience(jsonb) from public, anon, authenticated;
grant execute on function site.email_audience(jsonb) to service_role;

create table if not exists site.archived_tags (
  tag text primary key,
  archived_by text not null default '',
  archived_at timestamptz not null default now()
);
alter table site.archived_tags enable row level security;
grant select, insert, delete on site.archived_tags to authenticated;
grant all on site.archived_tags to service_role;
do $$ begin
  drop policy if exists r on site.archived_tags;
  create policy r on site.archived_tags for select to authenticated using (site.level_for('emaillist') >= 1);
  drop policy if exists i on site.archived_tags;
  create policy i on site.archived_tags for insert to authenticated with check (site.level_for('emaillist') >= 3);
  drop policy if exists d on site.archived_tags;
  create policy d on site.archived_tags for delete to authenticated using (site.level_for('emaillist') >= 3);
end $$;

-- Add people to a segment. Each person is {"id": "<contact id>"} for someone already in Contacts, or
-- {"email": "...", "first_name": "...", "last_name": "...", "phone": "..."}: matched by email, and added as a new
-- contact when the email is not known yet. Blank name and phone fields are filled in; nothing is overwritten.
-- Nobody's Do Not Email setting is changed.
create or replace function site.tag_people(p_tag text, p_people jsonb) returns jsonb
language plpgsql security definer set search_path = site, public as $$
declare t text := btrim(coalesce(p_tag, '')); r jsonb; e text; cid uuid; had boolean;
  n_added int := 0; n_new int := 0; n_already int := 0; n_skipped int := 0;
begin
  if site.level_for('emaillist') < 3 then raise exception 'You need edit access to Contacts & Email List.'; end if;
  if t = '' or length(t) > 80 then raise exception 'Give the segment a name (up to 80 characters).'; end if;
  if jsonb_typeof(p_people) <> 'array' or jsonb_array_length(p_people) > 5000 then raise exception 'Send up to 5,000 people at a time.'; end if;
  for r in select * from jsonb_array_elements(p_people) loop
    cid := null; had := false;
    if coalesce(r ->> 'id', '') ~ '^[0-9a-fA-F-]{36}$' then
      select c.id, t = any(c.tags) into cid, had from site.contacts c where c.id = (r ->> 'id')::uuid;
    else
      e := lower(btrim(coalesce(r ->> 'email', '')));
      if e !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' then n_skipped := n_skipped + 1; continue; end if;
      select c.id, t = any(c.tags) into cid, had from site.contacts c where lower(c.email) = e limit 1;
      if cid is null then
        insert into site.contacts (email, first_name, last_name, phone, tags, source)
        values (e, left(btrim(coalesce(r ->> 'first_name', '')), 80), left(btrim(coalesce(r ->> 'last_name', '')), 80), left(btrim(coalesce(r ->> 'phone', '')), 40), array[t], 'Added to ' || t);
        n_new := n_new + 1; continue;
      end if;
      update site.contacts c set
        first_name = case when c.first_name = '' then left(btrim(coalesce(r ->> 'first_name', '')), 80) else c.first_name end,
        last_name  = case when c.last_name  = '' then left(btrim(coalesce(r ->> 'last_name', '')), 80)  else c.last_name end,
        phone      = case when c.phone      = '' then left(btrim(coalesce(r ->> 'phone', '')), 40)      else c.phone end
      where c.id = cid;
    end if;
    if cid is null then n_skipped := n_skipped + 1;
    elsif had then n_already := n_already + 1;
    else update site.contacts c set tags = c.tags || t, updated_at = now() where c.id = cid; n_added := n_added + 1;
    end if;
  end loop;
  return jsonb_build_object('added', n_added, 'created', n_new, 'already', n_already, 'skipped', n_skipped);
end $$;

-- Take people out of a segment. They stay in Contacts with everything else untouched.
create or replace function site.untag_people(p_tag text, p_ids uuid[]) returns int
language plpgsql security definer set search_path = site, public as $$
declare n int;
begin
  if site.level_for('emaillist') < 3 then raise exception 'You need edit access to Contacts & Email List.'; end if;
  update site.contacts c set tags = array_remove(c.tags, p_tag), updated_at = now() where c.id = any(p_ids) and p_tag = any(c.tags);
  get diagnostics n = row_count; return n;
end $$;
revoke all on function site.tag_people(text, jsonb), site.untag_people(text, uuid[]) from public, anon;
grant execute on function site.tag_people(text, jsonb), site.untag_people(text, uuid[]) to authenticated, service_role;
