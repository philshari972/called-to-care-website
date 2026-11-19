-- Sponsor guest names: each sponsorship gets a private link the sponsor uses to tell us who is sitting in their seats.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.
alter table site.sponsorships add column if not exists guest_token uuid not null default gen_random_uuid();
alter table site.sponsorships add column if not exists guest_names text not null default '';     -- one name per line
alter table site.sponsorships add column if not exists guests_asked_at timestamptz;              -- when we last emailed the request
alter table site.sponsorships add column if not exists guests_at timestamptz;                    -- when the sponsor last sent names
create unique index if not exists sponsorships_guest_token_uq on site.sponsorships (guest_token);

-- Sponsors who typed guest names at checkout had them saved in Notes as "Guest names: ...". Copy those over once.
update site.sponsorships set guest_names = regexp_replace(btrim(substring(notes from 'Guest names:\s*(.*)$')), '\s*[,;]\s*', E'\n', 'g'), guests_at = coalesce(guests_at, created_at)
where guest_names = '' and notes ~ 'Guest names:\s*\S';
