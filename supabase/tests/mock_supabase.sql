-- Minimal stand-ins for what Supabase provides, so the setup can be tested on plain PostgreSQL.
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
create schema if not exists auth;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select case when coalesce(current_setting('test.email', true),'') = '' then null
         else jsonb_build_object('email', current_setting('test.email', true)) end $$;
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
