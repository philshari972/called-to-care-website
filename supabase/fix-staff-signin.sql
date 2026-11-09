-- Fix: people who aren't Owners couldn't sign in to the admin, because recording their
-- "last signed in" time was blocked by the "only the Owner changes access" rule.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.
create or replace function site.guard_staff() returns trigger language plpgsql security definer set search_path = site, public as $$
begin
  if auth.jwt() ->> 'email' is null then return coalesce(new, old); end if;
  -- Signing in only updates your own "last signed in" time: always allowed.
  if tg_op = 'UPDATE' and lower(old.email) = lower(auth.jwt() ->> 'email')
     and (to_jsonb(new) - 'last_seen') = (to_jsonb(old) - 'last_seen') then
    return new;
  end if;
  if not site.is_owner() then raise exception 'Only the Owner can change logins and access.'; end if;
  if tg_op <> 'INSERT' and lower(old.email) = lower(auth.jwt() ->> 'email') and (tg_op = 'DELETE' or not new.active or not ('owner' = any(new.roles))) then
    raise exception 'You cannot remove your own Owner access.';
  end if;
  return coalesce(new, old);
end $$;
select 'Sign-in fix installed' as result;
