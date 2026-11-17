-- Email system: write an email in the admin and send it to your list (replaces Flodesk).
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.
-- Who can use it: anyone whose role can EDIT "Contacts & Email List" (Owner and Staff by default).

-- Every contact gets a private unsubscribe code used in the link at the bottom of each email.
alter table site.contacts add column if not exists unsub_token uuid not null default gen_random_uuid();
create unique index if not exists contacts_unsub_uq on site.contacts (unsub_token);

create table if not exists site.email_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',               -- what staff call it in the admin
  template text not null default '',           -- which starting design
  subject text not null default '',
  preheader text not null default '',
  reply_to text not null default '',
  blocks jsonb not null default '[]',          -- what the editor shows
  html text not null default '',               -- the finished email, with {{first_name}} and {{unsubscribe_url}} placeholders
  audience jsonb not null default '{"mode":"all","tags":[],"skip":[]}',
  status text not null default 'draft' check (status in ('draft','sending','sent','canceled')),
  total int not null default 0, sent int not null default 0, failed int not null default 0,
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz, finished_at timestamptz
);

create table if not exists site.email_sends (
  campaign_id uuid not null references site.email_campaigns(id) on delete cascade,
  contact_id uuid not null references site.contacts(id) on delete cascade,
  email text not null,
  status text not null default 'queued' check (status in ('queued','sending','sent','failed')),
  provider_id text, error text not null default '',
  claimed_at timestamptz, sent_at timestamptz,
  primary key (campaign_id, contact_id)
);
create index if not exists email_sends_queue on site.email_sends (campaign_id, status);
create index if not exists email_sends_provider on site.email_sends (provider_id);

alter table site.email_campaigns enable row level security;
alter table site.email_sends enable row level security;
grant select, insert, update, delete on site.email_campaigns to authenticated;
grant select on site.email_sends to authenticated;
grant all on site.email_campaigns, site.email_sends to service_role;

do $$ begin
  drop policy if exists r on site.email_campaigns;
  create policy r on site.email_campaigns for select to authenticated using (site.level_for('emaillist') >= 1);
  -- Staff write drafts. Sending (and everything after) happens on the server.
  drop policy if exists i on site.email_campaigns;
  create policy i on site.email_campaigns for insert to authenticated with check (site.level_for('emaillist') >= 3 and status = 'draft');
  drop policy if exists u on site.email_campaigns;
  create policy u on site.email_campaigns for update to authenticated using (site.level_for('emaillist') >= 3 and status = 'draft') with check (site.level_for('emaillist') >= 3 and status = 'draft');
  drop policy if exists d on site.email_campaigns;
  create policy d on site.email_campaigns for delete to authenticated using (site.level_for('emaillist') >= 3 and status = 'draft');
  drop policy if exists r on site.email_sends;
  create policy r on site.email_sends for select to authenticated using (site.level_for('emaillist') >= 1);
end $$;

-- Who an audience reaches: people with an email who have not unsubscribed, bounced or been marked Do Not Email.
--   {"mode":"all"}                      everyone who can be emailed
--   {"mode":"tags","tags":["A","B"]}    anyone with at least one of these tags
--   "skip":["C"]                        leaves out anyone with one of these tags
create or replace function site.email_audience(p jsonb) returns setof site.contacts
language sql stable security definer set search_path = site, public as $$
  select c.* from site.contacts c
  where c.email is not null and c.email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$'
    and c.email_ok and not c.do_not_email
    and (coalesce(p ->> 'mode', 'all') = 'all'
         or c.tags && array(select jsonb_array_elements_text(coalesce(p -> 'tags', '[]'::jsonb))))
    and not (c.tags && array(select jsonb_array_elements_text(coalesce(p -> 'skip', '[]'::jsonb)))) $$;
revoke all on function site.email_audience(jsonb) from public, anon, authenticated;

-- Server only: line up everyone for a draft and mark it as sending. Returns how many people.
create or replace function site.email_start(p_campaign uuid) returns int
language plpgsql security definer set search_path = site, public as $$
declare c site.email_campaigns; n int;
begin
  select * into c from site.email_campaigns where id = p_campaign for update;
  if c.id is null then raise exception 'Email not found'; end if;
  if c.status <> 'draft' then return c.total; end if;
  insert into site.email_sends (campaign_id, contact_id, email)
    select c.id, a.id, lower(a.email) from site.email_audience(c.audience) a
    on conflict do nothing;
  select count(*) into n from site.email_sends where campaign_id = c.id;
  update site.email_campaigns set status = case when n = 0 then 'draft' else 'sending' end, total = n, started_at = now(), updated_at = now() where id = c.id;
  return n;
end $$;
revoke all on function site.email_start(uuid) from public, anon, authenticated;

-- Server only: take the next few people to send to. Two browser tabs can never take the same person.
create or replace function site.email_claim(p_campaign uuid, p_n int) returns table (contact_id uuid, email text, first_name text, unsub_token uuid)
language sql security definer set search_path = site, public as $$
  with pick as (
    select s.campaign_id, s.contact_id from site.email_sends s
    where s.campaign_id = p_campaign
      and (s.status = 'queued' or (s.status = 'sending' and s.claimed_at < now() - interval '10 minutes'))
    order by s.contact_id limit greatest(1, least(p_n, 100)) for update skip locked),
  upd as (
    update site.email_sends s set status = 'sending', claimed_at = now()
    from pick where s.campaign_id = pick.campaign_id and s.contact_id = pick.contact_id
    returning s.contact_id, s.email)
  select u.contact_id, u.email, c.first_name, c.unsub_token from upd u join site.contacts c on c.id = u.contact_id $$;
revoke all on function site.email_claim(uuid, int) from public, anon, authenticated;

-- Server only: refresh the counts on an email, and mark it finished when nobody is left.
create or replace function site.email_tally(p_campaign uuid) returns jsonb
language plpgsql security definer set search_path = site, public as $$
declare s int; f int; l int;
begin
  select count(*) filter (where status = 'sent'), count(*) filter (where status = 'failed'), count(*) filter (where status in ('queued','sending'))
    into s, f, l from site.email_sends where campaign_id = p_campaign;
  update site.email_campaigns set sent = s, failed = f, updated_at = now(),
    status = case when status = 'sending' and l = 0 then 'sent' else status end,
    finished_at = case when status = 'sending' and l = 0 then now() else finished_at end
  where id = p_campaign;
  return jsonb_build_object('sent', s, 'failed', f, 'left', l);
end $$;
revoke all on function site.email_tally(uuid) from public, anon, authenticated;
grant execute on function site.email_audience(jsonb), site.email_start(uuid), site.email_claim(uuid, int), site.email_tally(uuid) to service_role;
