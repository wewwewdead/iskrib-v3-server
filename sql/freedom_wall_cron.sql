create extension if not exists pg_cron;

create or replace function public.rotate_freedom_wall_week()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_week_start timestamptz;
    v_week_end timestamptz;
begin
    perform pg_advisory_xact_lock(hashtext('freedom_wall_week_rotate'));

    v_week_start := (date_trunc('week', now() at time zone 'UTC') at time zone 'UTC');
    v_week_end := v_week_start + interval '7 days';

    update public.freedom_wall_weeks
    set status = 'archived'
    where status = 'active'
      and week_start < v_week_start;

    insert into public.freedom_wall_weeks (week_start, week_end, status)
    values (v_week_start, v_week_end, 'active')
    on conflict (week_start)
    do update set
        week_end = excluded.week_end,
        status = 'active';
end;
$$;

select public.rotate_freedom_wall_week();

select cron.schedule(
    'freedom-wall-weekly-reset',
    '0 0 * * 1',
    $$select public.rotate_freedom_wall_week();$$
);
