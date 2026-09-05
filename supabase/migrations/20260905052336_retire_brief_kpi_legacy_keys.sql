begin;
set local lock_timeout='5s';
-- Apply ONLY after generation-aware app and worker are independently verified.
-- Keep pause on repaired accounts. Never flatten or overwrite historical rows.
alter table public.daily_briefs drop constraint daily_briefs_account_id_day_key;
alter table public.kpi_snapshots drop constraint kpi_snapshots_account_id_metric_key_window_end_key;
commit;
