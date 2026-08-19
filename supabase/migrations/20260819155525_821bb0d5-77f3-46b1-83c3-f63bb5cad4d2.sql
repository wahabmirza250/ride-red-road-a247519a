CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule('sync-claim-status') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-claim-status');

SELECT cron.schedule(
  'sync-claim-status',
  '20 */6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--1c3c174b-6cbe-4b49-974e-a1f94a0d4813.lovable.app/api/public/hooks/sync-claim-status',
    headers := '{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJyYWJnZmFtaHplc3dsdmloZGhyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMwMjcwNjAsImV4cCI6MjA5ODYwMzA2MH0.bnZHII0kG4Pj57Afwxvl8tUPkh_CjrNjdj_IzhDO2xg"}'::jsonb,
    body := '{"source": "cron"}'::jsonb
  );
  $$
);