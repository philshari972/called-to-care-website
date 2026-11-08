-- =====================================================================
-- Donor thank-you letters: a log of letters made, plus the letter settings.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.
-- =====================================================================

create table if not exists site.donor_letters (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid unique references site.payments(id) on delete cascade,
  contact_id uuid references site.contacts(id) on delete set null,
  recurring boolean not null default false,
  kind text not null default 'one-time',          -- one-time, monthly-first, monthly
  next_after date,                                 -- monthly partners: next letter on or after this day (2-5 months later)
  sent_to text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists donor_letters_contact_ix on site.donor_letters (contact_id, created_at desc);
alter table site.donor_letters enable row level security;
drop policy if exists r on site.donor_letters;
create policy r on site.donor_letters for select to authenticated using (site.level_for('donations') >= 1 or site.level_for('payments') >= 1);
grant select on site.donor_letters to authenticated;
grant all on site.donor_letters to service_role;

-- Who gets the letters, who signs them, and the "what's happening" updates
insert into site.settings (key, value) values
  ('letter_emails', '["shari@wearecalledtocare.com"]'),
  ('letter_signer', '{"name":"Shari Chapman","title":"Executive Director"}'),
  ('letter_updates', $j$[
    {"title":"Support Night","text":"Foster and adoptive moms gather the first Thursday of every month to connect, share, and learn together, with childcare on site. Our next Support Night is {next_support_night}.","on":true,"until":""},
    {"title":"Christmas for kids in care","text":"We are gathering Christmas presents so every child in our foster families has something special to open this year.","on":true,"until":"2026-12-31"},
    {"title":"The Care Closet","text":"When a child arrives in a new home, often with very little, a Called to Care bag shows up at the door with clothes and essentials. Our Amazon wish list keeps those shelves stocked.","on":true,"until":""},
    {"title":"Charity Dinner & Auction","text":"Our 6th annual dinner is {dinner_date} at Whitetail Ridge Golf Club. We would love to see you there!","on":true,"until":""}
  ]$j$)
on conflict (key) do nothing;

-- Staff with edit access to Donations (not only Owners) can change the letter settings
drop policy if exists letters_w on site.settings;
create policy letters_w on site.settings for all to authenticated
  using (key like 'letter\_%' and site.level_for('donations') >= 3)
  with check (key like 'letter\_%' and site.level_for('donations') >= 3);

select 'Thank-you letters installed' as result;
