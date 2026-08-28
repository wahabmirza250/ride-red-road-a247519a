-- RedArt target bootstrap — realtime publication membership + replica identity
-- Extracted verbatim from scripts/target_schema_parts/05_storage_realtime.sql.
-- Publication itself is Supabase-managed; this file only adds public tables to it.

-- Realtime publication membership
ALTER PUBLICATION supabase_realtime ADD TABLE public.admin_notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE public.billing_audit_log;
ALTER PUBLICATION supabase_realtime ADD TABLE public.billing_records;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.drivers;
ALTER PUBLICATION supabase_realtime ADD TABLE public.events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.incidents;
ALTER PUBLICATION supabase_realtime ADD TABLE public.medicaid_trips;
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.ride_requests;
ALTER PUBLICATION supabase_realtime ADD TABLE public.route_stops;
ALTER PUBLICATION supabase_realtime ADD TABLE public.routes;
ALTER PUBLICATION supabase_realtime ADD TABLE public.trips;

-- Tables with REPLICA IDENTITY FULL (full row payloads in realtime)
ALTER TABLE public.drivers REPLICA IDENTITY FULL;
ALTER TABLE public.medicaid_trips REPLICA IDENTITY FULL;
ALTER TABLE public.ride_requests REPLICA IDENTITY FULL;
