-- Shade Project newsletter (and photo uploads for any email): a place to keep the photos and the one-page PDFs.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again. Run email-system.sql first.
-- Files here are public by their link (they go out in emails), so only put in what you would email to donors.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('newsletter', 'newsletter', true, 15728640, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

do $$ begin
  -- Only staff who can edit Contacts & Email List may add, replace or remove files.
  drop policy if exists "newsletter: staff can add" on storage.objects;
  create policy "newsletter: staff can add" on storage.objects for insert to authenticated
    with check (bucket_id = 'newsletter' and site.level_for('emaillist') >= 3);
  drop policy if exists "newsletter: staff can replace" on storage.objects;
  create policy "newsletter: staff can replace" on storage.objects for update to authenticated
    using (bucket_id = 'newsletter' and site.level_for('emaillist') >= 3) with check (bucket_id = 'newsletter' and site.level_for('emaillist') >= 3);
  drop policy if exists "newsletter: staff can remove" on storage.objects;
  create policy "newsletter: staff can remove" on storage.objects for delete to authenticated
    using (bucket_id = 'newsletter' and site.level_for('emaillist') >= 3);
  drop policy if exists "newsletter: staff can list" on storage.objects;
  create policy "newsletter: staff can list" on storage.objects for select to authenticated
    using (bucket_id = 'newsletter' and site.level_for('emaillist') >= 1);
end $$;
