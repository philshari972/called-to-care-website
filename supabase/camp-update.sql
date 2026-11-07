-- =====================================================================
-- Camp scholarships: funding steps, follow-up recaps, private camp photos.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.
-- =====================================================================

-- Staff-only working fields on any submission (camp: award, payment, camp end date, follow-up emails)
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

select 'Camp update installed' as result;
