-- =====================================================================
-- We Are Called to Care: website + admin database (schema "site")
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.
-- Safe to run again; it only adds what is missing and refreshes rules.
-- The auction's tables live in the "public" schema and are not touched.
-- =====================================================================
create extension if not exists pgcrypto;
create schema if not exists site;

-- ---------- staff, roles, permissions ----------
create table if not exists site.roles (
  key text primary key,
  name text not null,
  description text not null default '',
  perms jsonb not null default '{}'          -- {"section": "view"|"notes"|"clerk"|"edit"}, or {"*":"edit"}
);

create table if not exists site.staff (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  name text not null default '',
  roles text[] not null default '{}',
  overrides jsonb not null default '{}',     -- per-person changes: {"section":"none"|"view"|"notes"|"edit"}
  active boolean not null default true,
  expires_on date,                           -- committee access end date
  created_at timestamptz not null default now(),
  last_seen timestamptz
);
create unique index if not exists staff_email_uq on site.staff (lower(email));

insert into site.roles (key, name, description, perms) values
 ('owner','Owner','Everything, including users, payments, and settings','{"*":"edit"}'),
 ('staff','Staff','All registrations and messages; no users, money, or settings','{"support":"edit","placements":"edit","christmas":"edit","camp":"edit","volunteers":"edit","jobs":"edit","messages":"edit","emaillist":"edit","dinner":"edit","sponsors":"edit","events":"edit"}'),
 ('family','Family Care','Support Night, New Placements, Christmas, Camp Scholarships','{"support":"edit","placements":"edit","christmas":"edit","camp":"edit"}'),
 ('volunteer','Volunteer Coordinator','Volunteer applications only','{"volunteers":"edit"}'),
 ('scholarship','Scholarship Committee','Camp applications, read-only, with review notes','{"camp":"notes"}'),
 ('events','Events & Dinner','Charity dinner tickets, tables, sponsors, and events','{"dinner":"edit","sponsors":"edit","events":"edit"}'),
 ('finance','Finance','Payments and donations; view dinner sales','{"payments":"edit","donations":"edit","dinner":"view","sponsors":"view"}'),
 ('donor_records','Donor Records','Donations, receipts, and year-end statements','{"donations":"edit","payments":"view"}'),
 ('auction_admin','Auction Admin','Full auction controls, bidders, auction reports','{"auction":"edit","bidders":"edit","sponsors":"view"}'),
 ('committee','Dinner Committee','View only: sponsors, sponsor history, and dinner attendance','{"sponsors":"view"}'),
 ('clerk','Auction Clerk','Event-night screens only: live clerk, raffles, pickup','{"auction":"clerk","bidders":"view"}')
on conflict (key) do update set name=excluded.name, description=excluded.description, perms=excluded.perms;

create or replace function site.lv(p text) returns int language sql immutable as $$
  select case p when 'edit' then 3 when 'notes' then 2 when 'clerk' then 2 when 'view' then 1 else 0 end $$;

-- Current signed-in person's staff row (active and not expired), or nothing.
create or replace function site.me_row() returns site.staff
language sql stable security definer set search_path = site, public as $$
  select s.* from site.staff s
  where lower(s.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    and s.active and (s.expires_on is null or s.expires_on >= current_date)
  limit 1 $$;

-- Access level (0 none, 1 view, 2 notes, 3 edit) for a section.
create or replace function site.level_for(p_section text) returns int
language plpgsql stable security definer set search_path = site, public as $$
declare s site.staff; best int := 0; r record;
begin
  s := site.me_row();
  if s.id is null then return 0; end if;
  if s.overrides ? p_section then return site.lv(s.overrides ->> p_section); end if;
  for r in select perms from site.roles where key = any(s.roles) loop
    best := greatest(best, site.lv(r.perms ->> '*'), site.lv(r.perms ->> p_section));
  end loop;
  return best;
end $$;

create or replace function site.is_owner() returns boolean
language sql stable security definer set search_path = site, public as $$
  select coalesce('owner' = any((site.me_row()).roles), false) $$;

-- What the admin screen needs after sign-in: who I am and what I can open.
create or replace function site.me() returns jsonb
language plpgsql volatile security definer set search_path = site, public as $$
declare s site.staff; perms jsonb := '{}'; sec text;
begin
  s := site.me_row();
  if s.id is null then return null; end if;
  update site.staff set last_seen = now() where id = s.id;
  foreach sec in array array['support','placements','christmas','camp','volunteers','jobs','messages','emaillist','dinner','sponsors','auction','bidders','payments','donations','events','users','settings'] loop
    if site.level_for(sec) > 0 then
      perms := perms || jsonb_build_object(sec, case site.level_for(sec) when 3 then 'edit' when 2 then 'notes' else 'view' end);
    end if;
  end loop;
  return jsonb_build_object('id', s.id, 'name', s.name, 'email', s.email, 'roles', to_jsonb(s.roles), 'perms', perms, 'expires_on', s.expires_on);
end $$;

-- ---------- people ----------
create table if not exists site.contacts (
  id uuid primary key default gen_random_uuid(),
  email text,
  first_name text not null default '',
  last_name text not null default '',
  org text not null default '',               -- business / church name, if any
  kind text not null default 'person' check (kind in ('person','family','business','church','foundation')),
  salutation text not null default '',
  phone text not null default '',
  street text not null default '', city text not null default '', state text not null default '', zip text not null default '',
  email_ok boolean not null default true,
  text_ok boolean not null default false,
  mail_ok boolean not null default true,
  do_not_email boolean not null default false,
  do_not_email_reason text not null default '',  -- Unsubscribed, Bounced, Marked as spam...
  tags text[] not null default '{}',
  household text not null default '',
  source text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists contacts_email_uq on site.contacts (lower(email)) where email is not null and email <> '';
create index if not exists contacts_tags_ix on site.contacts using gin (tags);

-- ---------- events (Support Night dates, dinner, other events) ----------
create table if not exists site.events (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'event' check (kind in ('support_night','dinner','event')),
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text not null default '',
  registration_open boolean not null default true,
  capacity int,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- ---------- every website form lands here ----------
create table if not exists site.submissions (
  id uuid primary key default gen_random_uuid(),
  form text not null check (form in ('support','placement','christmas','camp','volunteer','job','message','emaillist')),
  contact_id uuid references site.contacts(id) on delete set null,
  event_id uuid references site.events(id) on delete set null,
  data jsonb not null default '{}',
  status text not null default 'New',
  notes jsonb not null default '[]',          -- [{by, at, text}]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists submissions_form_ix on site.submissions (form, created_at desc);

create or replace function site.section_of(p_form text) returns text language sql immutable as $$
  select case p_form when 'support' then 'support' when 'placement' then 'placements' when 'christmas' then 'christmas'
    when 'camp' then 'camp' when 'volunteer' then 'volunteers' when 'job' then 'jobs' when 'message' then 'messages'
    when 'emaillist' then 'emaillist' end $$;

-- ---------- charity dinner history ----------
create table if not exists site.dinners (
  year int primary key,
  dinner_date date,
  venue text not null default '',
  held boolean not null default false
);

create table if not exists site.sponsorships (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references site.contacts(id) on delete cascade,
  year int not null,
  sponsor_name text not null default '',      -- name as printed (business or family)
  level text not null default '',
  amount numeric(10,2),
  status text not null default 'Committed' check (status in ('Asked','Committed','Invoiced','Partially Paid','Paid in Full','Declined')),
  received numeric(10,2) not null default 0,
  method text not null default '',
  source text not null default 'Added by staff',
  logo_received boolean not null default false,
  receipt_sent boolean not null default false,
  thanks_sent boolean not null default false,
  program_name text not null default '',
  tickets int,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sponsorships_year_ix on site.sponsorships (year);

create table if not exists site.attendance (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references site.contacts(id) on delete cascade,
  year int not null,
  present boolean not null default true,      -- false = registered but did not come
  table_label text not null default '',
  bid_number int,
  ticket_type text not null default '',
  guests int not null default 1,
  auction_total numeric(10,2),
  source text not null default 'Import',
  created_at timestamptz not null default now(),
  unique (contact_id, year)
);

-- ---------- money ----------
create table if not exists site.payments (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('stripe','paypal','check','cash','donorbox','other')),
  provider_id text,                            -- Stripe PaymentIntent / PayPal capture id
  contact_id uuid references site.contacts(id) on delete set null,
  purpose text not null check (purpose in ('donation','sponsorship','tickets','table','other')),
  description text not null default '',
  designation text not null default '',        -- Where needed most, Care Closet...
  amount numeric(10,2) not null,
  fee numeric(10,2),
  status text not null default 'pending' check (status in ('pending','succeeded','failed','refunded','canceled')),
  recurring boolean not null default false,
  method text not null default '',             -- Card, Apple Pay, ACH, PayPal...
  receipt_no text,
  receipt_sent_at timestamptz,
  meta jsonb not null default '{}',
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create unique index if not exists payments_provider_uq on site.payments (provider, provider_id) where provider_id is not null;
create sequence if not exists site.receipt_seq start 1001;

create table if not exists site.subscriptions (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid references site.contacts(id) on delete set null,
  provider text not null default 'stripe',
  provider_id text unique,
  amount numeric(10,2) not null,
  status text not null default 'active',
  designation text not null default '',
  started_at timestamptz not null default now(),
  canceled_at timestamptz
);

create table if not exists site.email_log (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid references site.contacts(id) on delete set null,
  to_email text not null,
  template text not null,
  subject text not null default '',
  provider_id text,
  status text not null default 'sent',
  created_at timestamptz not null default now()
);

create table if not exists site.settings (key text primary key, value jsonb not null);
insert into site.settings (key, value) values
  ('staff_alert_email', '["shari@wearecalledtocare.com","phil@wearecalledtocare.com"]'),
  ('tickets_on', 'false'),
  ('org', '{"legal_name":"We Are Called to Care, NFP","ein":"86-2900453","address":"201 E Veterans Parkway, Suite 13, Yorkville, IL 60560","phone":"815-200-9086"}')
on conflict (key) do nothing;

create table if not exists site.audit (
  id bigserial primary key,
  at timestamptz not null default now(),
  who text not null default coalesce(auth.jwt() ->> 'email', 'system'),
  action text not null,
  tbl text not null,
  row_id text,
  detail jsonb
);

-- ---------- rules that keep data safe ----------
-- updated_at + audit trail on staff edits
create or replace function site.touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
do $$ declare t text; begin
  foreach t in array array['contacts','submissions','sponsorships'] loop
    execute format('drop trigger if exists touch on site.%I; create trigger touch before update on site.%I for each row execute function site.touch()', t, t);
  end loop;
end $$;

create or replace function site.log_change() returns trigger language plpgsql security definer set search_path = site, public as $$
begin
  if auth.jwt() ->> 'email' is not null then
    insert into site.audit(action, tbl, row_id, detail)
    values (lower(tg_op), tg_table_name, coalesce(to_jsonb(new)->>'id', to_jsonb(old)->>'id', to_jsonb(new)->>'key', to_jsonb(old)->>'key'),
            case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end);
  end if;
  return coalesce(new, old);
end $$;
do $$ declare t text; begin
  foreach t in array array['contacts','submissions','sponsorships','attendance','payments','staff','events','settings'] loop
    execute format('drop trigger if exists audit on site.%I; create trigger audit after insert or update or delete on site.%I for each row execute function site.log_change()', t, t);
  end loop;
end $$;

-- "notes" level may add notes but not change status or answers
create or replace function site.guard_submission() returns trigger language plpgsql security definer set search_path = site, public as $$
begin
  if auth.jwt() ->> 'email' is null then return new; end if;   -- server functions
  if site.level_for(site.section_of(new.form)) < 3 then
    if new.status is distinct from old.status or new.data is distinct from old.data or new.form is distinct from old.form then
      raise exception 'You can add notes, but not change this record.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists guard on site.submissions;
create trigger guard before update on site.submissions for each row execute function site.guard_submission();

-- only the Owner changes who has access
create or replace function site.guard_staff() returns trigger language plpgsql security definer set search_path = site, public as $$
begin
  if auth.jwt() ->> 'email' is null then return coalesce(new, old); end if;
  if not site.is_owner() then raise exception 'Only the Owner can change logins and access.'; end if;
  if tg_op <> 'INSERT' and lower(old.email) = lower(auth.jwt() ->> 'email') and (tg_op = 'DELETE' or not new.active or not ('owner' = any(new.roles))) then
    raise exception 'You cannot remove your own Owner access.';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists guard on site.staff;
create trigger guard before insert or update or delete on site.staff for each row execute function site.guard_staff();

alter table site.roles enable row level security;
alter table site.staff enable row level security;
alter table site.contacts enable row level security;
alter table site.events enable row level security;
alter table site.submissions enable row level security;
alter table site.dinners enable row level security;
alter table site.sponsorships enable row level security;
alter table site.attendance enable row level security;
alter table site.payments enable row level security;
alter table site.subscriptions enable row level security;
alter table site.email_log enable row level security;
alter table site.settings enable row level security;
alter table site.audit enable row level security;

do $$ begin
  -- roles: any staff can read
  drop policy if exists r on site.roles; create policy r on site.roles for select to authenticated using ((site.me_row()).id is not null);
  -- staff: see yourself; Owner sees and manages everyone
  drop policy if exists r on site.staff; create policy r on site.staff for select to authenticated using (lower(email) = lower(auth.jwt() ->> 'email') or site.is_owner());
  drop policy if exists w on site.staff; create policy w on site.staff for all to authenticated using (site.is_owner()) with check (site.is_owner());
  -- submissions: by section
  drop policy if exists r on site.submissions; create policy r on site.submissions for select to authenticated using (site.level_for(site.section_of(form)) >= 1);
  drop policy if exists u on site.submissions; create policy u on site.submissions for update to authenticated using (site.level_for(site.section_of(form)) >= 2) with check (site.level_for(site.section_of(form)) >= 2);
  drop policy if exists d on site.submissions; create policy d on site.submissions for delete to authenticated using (site.level_for(site.section_of(form)) >= 3);
  -- contacts: email list, money, or (dinner sections, only people with dinner history)
  drop policy if exists r on site.contacts; create policy r on site.contacts for select to authenticated using (
    site.level_for('emaillist') >= 1 or site.level_for('donations') >= 1 or site.level_for('payments') >= 1
    or ((site.level_for('sponsors') >= 1 or site.level_for('dinner') >= 1)
        and (exists (select 1 from site.sponsorships s where s.contact_id = contacts.id) or exists (select 1 from site.attendance a where a.contact_id = contacts.id))));
  drop policy if exists w on site.contacts; create policy w on site.contacts for all to authenticated
    using (site.level_for('emaillist') = 3 or site.level_for('sponsors') = 3 or site.level_for('donations') = 3)
    with check (site.level_for('emaillist') = 3 or site.level_for('sponsors') = 3 or site.level_for('donations') = 3);
  -- dinner history
  drop policy if exists r on site.dinners; create policy r on site.dinners for select to authenticated using (site.level_for('sponsors') >= 1 or site.level_for('dinner') >= 1);
  drop policy if exists w on site.dinners; create policy w on site.dinners for all to authenticated using (site.level_for('sponsors') = 3) with check (site.level_for('sponsors') = 3);
  drop policy if exists r on site.sponsorships; create policy r on site.sponsorships for select to authenticated using (site.level_for('sponsors') >= 1 or site.level_for('dinner') >= 1 or site.level_for('payments') >= 1);
  drop policy if exists w on site.sponsorships; create policy w on site.sponsorships for all to authenticated using (site.level_for('sponsors') = 3) with check (site.level_for('sponsors') = 3);
  drop policy if exists r on site.attendance; create policy r on site.attendance for select to authenticated using (site.level_for('sponsors') >= 1 or site.level_for('dinner') >= 1 or site.level_for('bidders') >= 1);
  drop policy if exists w on site.attendance; create policy w on site.attendance for all to authenticated using (site.level_for('sponsors') = 3 or site.level_for('dinner') = 3) with check (site.level_for('sponsors') = 3 or site.level_for('dinner') = 3);
  -- events: any staff reads; events editors write
  drop policy if exists r on site.events; create policy r on site.events for select to authenticated using ((site.me_row()).id is not null);
  drop policy if exists w on site.events; create policy w on site.events for all to authenticated using (site.level_for('events') = 3) with check (site.level_for('events') = 3);
  -- money
  drop policy if exists r on site.payments; create policy r on site.payments for select to authenticated using (
    site.level_for('payments') >= 1 or (purpose = 'donation' and site.level_for('donations') >= 1)
    or (purpose in ('tickets','table','sponsorship') and site.level_for('dinner') >= 1));
  drop policy if exists w on site.payments; create policy w on site.payments for all to authenticated using (site.level_for('payments') = 3 or site.level_for('donations') = 3) with check (site.level_for('payments') = 3 or site.level_for('donations') = 3);
  drop policy if exists r on site.subscriptions; create policy r on site.subscriptions for select to authenticated using (site.level_for('donations') >= 1 or site.level_for('payments') >= 1);
  drop policy if exists r on site.email_log; create policy r on site.email_log for select to authenticated using (site.level_for('emaillist') >= 1 or site.level_for('donations') >= 1);
  drop policy if exists r on site.settings; create policy r on site.settings for select to authenticated using ((site.me_row()).id is not null);
  drop policy if exists w on site.settings; create policy w on site.settings for all to authenticated using (site.is_owner()) with check (site.is_owner());
  drop policy if exists r on site.audit; create policy r on site.audit for select to authenticated using (site.is_owner());
end $$;

-- The public website never talks to the database directly; only server functions (service role) do.
grant usage on schema site to authenticated, service_role;
grant select, insert, update, delete on all tables in schema site to authenticated, service_role;
grant usage, select on all sequences in schema site to authenticated, service_role;
grant execute on all functions in schema site to authenticated, service_role;
revoke all on schema site from anon;

-- Next receipt number, e.g. C2C-2027-01001 (server functions only)
create or replace function site.next_receipt() returns text language sql volatile security definer set search_path = site, public as $$
  select 'C2C-' || to_char(now() at time zone 'America/Chicago', 'YYYY') || '-' || lpad(nextval('site.receipt_seq')::text, 5, '0') $$;
revoke execute on function site.next_receipt() from authenticated;

-- First Owner. Change the email to yours before running, or add Owners later in the admin.
insert into site.staff (email, name, roles) values ('phil@wearecalledtocare.com', 'Phil Chapman', '{owner}')
on conflict do nothing;
alter table site.submissions add column if not exists admin jsonb not null default '{}';

-- Allow the camp follow-up (recap) form
alter table site.submissions drop constraint if exists submissions_form_check;
alter table site.submissions add constraint submissions_form_check
  check (form in ('support','placement','christmas','camp','camp_followup','volunteer','job','message','emaillist'));

create or replace function site.section_of(p_form text) returns text language sql immutable as $$
  select case p_form when 'support' then 'support' when 'placement' then 'placements' when 'christmas' then 'christmas'
    when 'camp' then 'camp' when 'camp_followup' then 'camp' when 'volunteer' then 'volunteers' when 'job' then 'jobs'
    when 'message' then 'messages' when 'emaillist' then 'emaillist' end $$;

-- People with notes-only access (scholarship committee) can add notes but not change status, answers, or funding
create or replace function site.guard_submission() returns trigger language plpgsql security definer set search_path = site, public as $$
begin
  if auth.jwt() ->> 'email' is null then return new; end if;   -- server functions
  if site.level_for(site.section_of(new.form)) < 3 then
    if new.status is distinct from old.status or new.data is distinct from old.data or new.form is distinct from old.form
       or new.admin is distinct from old.admin then
      raise exception 'You can add notes, but not change this record.';
    end if;
  end if;
  return new;
end $$;

-- Private storage for camp photos: only staff who can see Camp Scholarships can view them
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('camp-photos', 'camp-photos', false, 10485760, array['image/jpeg','image/png','image/webp'])
    on conflict (id) do nothing;
    drop policy if exists "camp photos: staff can view" on storage.objects;
    create policy "camp photos: staff can view" on storage.objects for select to authenticated
      using (bucket_id = 'camp-photos' and site.level_for('camp') >= 1);
  end if;
end $$;

