-- Fix: "Launch test auction" failed with "DELETE requires a WHERE clause".
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.
create or replace function admin_launch(p_dur int) returns void
language plpgsql security definer set search_path = public as $$
declare t bigint := now_ms(); r int;
begin
  if not is_admin() then raise exception 'Only auction admins can do that.'; end if;
  update auction set run = run + 1, phase = 'live', paused_at = null, launched_at = t, dur = p_dur, live_lot = null where id = 1
    returning run into r;
  -- "where true": Supabase refuses a DELETE with no WHERE when it comes from the website
  delete from maxes where true; delete from history where true; delete from items where true;
  update drawings set data = data - 'lot' where data ? 'lot';   -- Golden Ticket picks belong to the old run   -- gifts and payments stay, tagged with their run
  insert into items (id, run, price, ends_at, live)
    select id, r, start, t + p_dur * 60000 + case when mode = 'live' then 7 * 86400000 else 0 end, mode = 'live' from catalog;
  insert into people (uid, name, paddle, bot) values
    ('bot-sarah', 'Sarah K.', 912, true), ('bot-marcus', 'Marcus T.', 918, true),
    ('bot-dana', 'Dana R.', 924, true), ('bot-jim', 'Pastor Jim', 931, true)
    on conflict (uid) do nothing;
  -- a little opening activity so the room doesn't look empty
  perform place_bid('i1', 'bot-sarah', 260);  perform place_bid('i1', 'bot-marcus', 240);
  perform place_bid('i2', 'bot-dana', 190);   perform place_bid('i6', 'bot-jim', 150);
  perform place_bid('i8', 'bot-sarah', 210);  perform place_bid('i4', 'bot-marcus', 90);
end $$;
