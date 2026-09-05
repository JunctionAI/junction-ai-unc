begin;
set local lock_timeout = '5s';
-- Unknown is not a customer-approved zero. Executors still fail closed when
-- their required budget input is absent; this does not enable any spending.
alter table resource_profiles alter column budget_monthly drop not null;
alter table resource_profiles alter column budget_monthly drop default;
alter table resource_profiles alter column hours_weekly drop not null;
alter table resource_profiles alter column hours_weekly drop default;
commit;
