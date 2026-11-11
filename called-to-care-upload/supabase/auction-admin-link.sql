-- Lets the website admin's "Open Auction Admin" button open the auction already unlocked.
-- Only Owners, or staff with edit access to the Auction, can use it.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.
create or replace function site.auction_admin_link() returns jsonb
language plpgsql stable security definer set search_path = site, public as $$
begin
  if not (site.is_owner() or site.level_for('auction') >= 3) then
    raise exception 'Only Owners or Auction editors can open the auction admin.';
  end if;
  return jsonb_build_object(
    'preview', (select v from public.app_secrets where k = 'preview_code'),
    'admin',   (select v from public.app_secrets where k = 'admin_code'));
end $$;
revoke all on function site.auction_admin_link() from public, anon;
grant execute on function site.auction_admin_link() to authenticated;
select 'Auction admin link installed' as result;
