-- Sponsor thank-you letters: lets staff with edit access to Sponsors & Guests save the letter wording.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.
drop policy if exists sponsor_letter_w on site.settings;
create policy sponsor_letter_w on site.settings for all to authenticated
  using (key = 'sponsor_letter' and site.level_for('sponsors') >= 3)
  with check (key = 'sponsor_letter' and site.level_for('sponsors') >= 3);
select 'Sponsor letters ready' as result;
