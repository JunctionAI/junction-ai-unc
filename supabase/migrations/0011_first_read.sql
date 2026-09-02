-- Unc — connectors first read (2026-09-02). Additive only; 0001–0010 untouched.
--
-- connectors.last_read_metrics — how many KPI metrics the last certified read of this
-- connector wrote to kpi_snapshots (src/lib/connectors/firstRead.ts). Paired with
-- last_sync_at / last_sync_result it lets the Connectors card say "Read ✓ · 4 metrics"
-- from a column instead of re-counting kpi_snapshots on every render. NULL = never read.
-- Written best-effort by the app (a database without this column still connects and reads;
-- the card then shows "Read ✓" without the count) — apply it so the count shows.

alter table connectors add column if not exists last_read_metrics int;
