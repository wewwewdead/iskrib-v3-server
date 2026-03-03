-- scalability_fixes.sql
-- RPC functions to avoid over-fetching for hot posts and canvas gallery.
-- These replace client-side scoring that previously required fetching ALL rows.

-- ─── Index for hot post / canvas gallery queries ────────────────────────────
-- (idx_journals_privacy_created already exists from hottest_tracker.sql)
create index if not exists idx_journals_privacy_posttype_created
    on public.journals (privacy, post_type, created_at desc);

-- ─── 1. Denormalized count columns on journals ─────────────────────────────
-- Must come BEFORE the RPC functions that reference these columns.
-- Avoids 3 × COUNT(*) subqueries per row on every list fetch.

-- Add columns (idempotent)
alter table public.journals add column if not exists cached_reaction_count     int not null default 0;
alter table public.journals add column if not exists cached_comment_count  int not null default 0;
alter table public.journals add column if not exists cached_bookmark_count int not null default 0;

-- Index for hot-score sorting using cached counts
create index if not exists idx_journals_cached_hot_score
    on public.journals (privacy, ((coalesce(views,0)*6) + (cached_reaction_count*3) + (cached_comment_count*2) + (cached_bookmark_count*2)) desc, created_at desc)
    where privacy = 'public';

-- ─── Backfill existing data ─────────────────────────────────────────────────
update public.journals j set
    cached_reaction_count     = coalesce(sub.lk, 0),
    cached_comment_count  = coalesce(sub.cm, 0),
    cached_bookmark_count = coalesce(sub.bk, 0)
from (
    select
        jj.id,
        (select count(*) from public.likes    where journal_id = jj.id) as lk,
        (select count(*) from public.comments where post_id    = jj.id) as cm,
        (select count(*) from public.bookmarks where journal_id = jj.id) as bk
    from public.journals jj
) sub
where j.id = sub.id;

-- ─── Trigger functions ──────────────────────────────────────────────────────

-- Likes
create or replace function public.trg_update_journal_like_count()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    if (TG_OP = 'INSERT') then
        update journals set cached_reaction_count = cached_reaction_count + 1 where id = NEW.journal_id;
    elsif (TG_OP = 'DELETE') then
        update journals set cached_reaction_count = greatest(cached_reaction_count - 1, 0) where id = OLD.journal_id;
    end if;
    return null;
end;
$$;

drop trigger if exists trg_likes_count on public.likes;
create trigger trg_likes_count
    after insert or delete on public.likes
    for each row execute function public.trg_update_journal_like_count();

-- Comments
create or replace function public.trg_update_journal_comment_count()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    if (TG_OP = 'INSERT') then
        update journals set cached_comment_count = cached_comment_count + 1 where id = NEW.post_id;
    elsif (TG_OP = 'DELETE') then
        update journals set cached_comment_count = greatest(cached_comment_count - 1, 0) where id = OLD.post_id;
    end if;
    return null;
end;
$$;

drop trigger if exists trg_comments_count on public.comments;
create trigger trg_comments_count
    after insert or delete on public.comments
    for each row execute function public.trg_update_journal_comment_count();

-- Bookmarks
create or replace function public.trg_update_journal_bookmark_count()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    if (TG_OP = 'INSERT') then
        update journals set cached_bookmark_count = cached_bookmark_count + 1 where id = NEW.journal_id;
    elsif (TG_OP = 'DELETE') then
        update journals set cached_bookmark_count = greatest(cached_bookmark_count - 1, 0) where id = OLD.journal_id;
    end if;
    return null;
end;
$$;

drop trigger if exists trg_bookmarks_count on public.bookmarks;
create trigger trg_bookmarks_count
    after insert or delete on public.bookmarks
    for each row execute function public.trg_update_journal_bookmark_count();

-- ─── 2. Monthly hottest journals (replaces fetch-all-then-sort) ─────────────
-- Returns scored + sorted journals for the current month, limited server-side.
drop function if exists public.get_monthly_hottest_journals(integer);
create or replace function public.get_monthly_hottest_journals(
    p_limit int default 10
)
returns table (
    id uuid,
    user_id uuid,
    title text,
    preview_text text,
    thumbnail_url text,
    post_type text,
    created_at timestamptz,
    privacy text,
    views bigint,
    is_repost boolean,
    repost_source_journal_id uuid,
    repost_caption text,
    user_name text,
    user_image_url text,
    user_badge text,
    like_count bigint,
    comment_count bigint,
    bookmark_count bigint,
    hot_score bigint
)
language sql
stable
security definer
set search_path = public
as $$
    select
        j.id,
        j.user_id,
        j.title,
        j.preview_text,
        j.thumbnail_url,
        j.post_type,
        j.created_at,
        j.privacy,
        coalesce(j.views, 0)::bigint as views,
        j.is_repost,
        j.repost_source_journal_id,
        j.repost_caption,
        u.name as user_name,
        u.image_url as user_image_url,
        u.badge as user_badge,
        j.cached_reaction_count::bigint as like_count,
        j.cached_comment_count::bigint as comment_count,
        j.cached_bookmark_count::bigint as bookmark_count,
        (coalesce(j.views, 0)::bigint * 6)
            + (j.cached_reaction_count::bigint * 3)
            + (j.cached_comment_count::bigint * 2)
            + (j.cached_bookmark_count::bigint * 2) as hot_score
    from public.journals j
    inner join public.users u on u.id = j.user_id
    where j.privacy = 'public'
      and j.created_at >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC'
      and j.created_at <  (date_trunc('month', now() at time zone 'UTC') + interval '1 month') at time zone 'UTC'
    order by hot_score desc, j.created_at desc, j.id desc
    limit p_limit;
$$;

