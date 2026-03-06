-- hottest_tracker.sql
-- Scalable #1 Hottest Post Tracker using pg_cron
-- Replaces the Node.js setInterval-based tracker with a Postgres-native solution.
-- Follows the same pattern as freedom_wall_cron.sql.

create extension if not exists pg_cron;

-- Table (idempotent — won't fail if it already exists)
create table if not exists public.hottest_tracker (
    id         uuid primary key default gen_random_uuid(),
    month_key  text not null unique,
    journal_id uuid not null,
    user_id    uuid not null,
    hot_score  bigint not null default 0,
    updated_at timestamptz not null default now()
);

-- Widen hot_score to bigint if the table already existed with integer
alter table public.hottest_tracker
    alter column hot_score type bigint;

-- Index for fast monthly filtering of public journals
create index if not exists idx_journals_privacy_created
    on public.journals (privacy, created_at);

-- ─── Main function ───────────────────────────────────────────────────────────
create or replace function public.check_hottest_post_tracker()
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_month_key      text;
    v_month_start    timestamptz;
    v_month_end      timestamptz;
    v_top_journal_id uuid;
    v_top_user_id    uuid;
    v_top_score      bigint;
    v_old_journal_id uuid;
    v_old_user_id    uuid;
begin
    -- Prevent concurrent runs across replicas / cron overlap
    perform pg_advisory_xact_lock(hashtext('hottest_post_tracker'));

    -- Current month boundaries (UTC)
    v_month_start := date_trunc('month', now() at time zone 'UTC') at time zone 'UTC';
    v_month_end   := (v_month_start + interval '1 month');
    v_month_key   := to_char(now() at time zone 'UTC', 'YYYY-MM');

    -- Find the #1 public post this month by hot score
    -- Uses cached columns to match get_monthly_hottest_journals scoring
    select
        j.id,
        j.user_id,
        (coalesce(j.views, 0)::bigint * 6)
            + (j.cached_reaction_count::bigint * 3)
            + (j.cached_comment_count::bigint * 2)
            + (j.cached_bookmark_count::bigint * 2)
    into v_top_journal_id, v_top_user_id, v_top_score
    from public.journals j
    where j.privacy = 'public'
      and j.created_at >= v_month_start
      and j.created_at <  v_month_end
    order by
        (coalesce(j.views, 0)::bigint * 6)
            + (j.cached_reaction_count::bigint * 3)
            + (j.cached_comment_count::bigint * 2)
            + (j.cached_bookmark_count::bigint * 2) desc,
        j.created_at desc,
        j.id desc
    limit 1;

    -- No public posts this month — nothing to do
    if v_top_journal_id is null then
        return;
    end if;

    -- Check existing tracker row for this month
    select journal_id, user_id
    into v_old_journal_id, v_old_user_id
    from public.hottest_tracker
    where month_key = v_month_key;

    -- Same post is still #1 — nothing changed
    if v_old_journal_id is not null and v_old_journal_id = v_top_journal_id then
        return;
    end if;

    -- Notify old #1 that they've been replaced
    -- Skip if: post was deleted, or same user's different post took over (no need to say "replaced" then "congrats")
    if v_old_journal_id is not null
       and v_old_user_id is distinct from v_top_user_id
       and exists (select 1 from public.journals where id = v_old_journal_id)
    then
        insert into public.notifications (sender_id, receiver_id, journal_id, type, read)
        values (v_old_user_id, v_old_user_id, v_old_journal_id, 'hottest_post_replaced', false);
    end if;

    -- Upsert new #1
    insert into public.hottest_tracker (month_key, journal_id, user_id, hot_score, updated_at)
    values (v_month_key, v_top_journal_id, v_top_user_id, v_top_score, now())
    on conflict (month_key)
    do update set
        journal_id = excluded.journal_id,
        user_id    = excluded.user_id,
        hot_score  = excluded.hot_score,
        updated_at = excluded.updated_at;

    -- Notify new #1
    insert into public.notifications (sender_id, receiver_id, journal_id, type, read)
    values (v_top_user_id, v_top_user_id, v_top_journal_id, 'hottest_post', false);
end;
$fn$;

-- ─── Schedule: every 5 minutes ───────────────────────────────────────────────
-- Drop existing job if present so this script is idempotent
select cron.unschedule('hottest-post-tracker')
where exists (
    select 1 from cron.job where jobname = 'hottest-post-tracker'
);

select cron.schedule(
    'hottest-post-tracker',
    '*/5 * * * *',
    $fn$select public.check_hottest_post_tracker();$fn$
);
