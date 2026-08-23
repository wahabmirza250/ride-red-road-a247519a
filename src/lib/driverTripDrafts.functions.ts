/**
 * Server-side persistence for in-progress driver-created NEMT trips.
 *
 * The wizard keeps a localStorage draft as crash protection, but once the
 * driver taps "Save trip" the row in `driver_trip_drafts` is the source of
 * truth so the trip can be resumed from any device/session. Rows are scoped to
 * the signed-in driver (RLS: driver_id = auth.uid()).
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type SavedDriverTripDraft = {
  id: string;
  label: string | null;
  status: string;
  rider_id: string | null;
  assigned_trip_id: string | null;
  payload: unknown;
  updated_at: string;
  created_at: string;
};

export const saveDriverTripDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: {
    id?: string | null;
    label?: string | null;
    rider_id?: string | null;
    assigned_trip_id?: string | null;
    payload: unknown;
  }) => {
    if (!data || typeof data !== "object" || !data.payload) {
      throw new Error("A trip payload is required");
    }
    return data;
  })
  .handler(async ({ context, data }) => {
    const row = {
      driver_id: context.userId,
      label: data.label ?? null,
      rider_id: data.rider_id ?? null,
      assigned_trip_id: data.assigned_trip_id ?? null,
      payload: data.payload as never,
      status: "in_progress",
    };

    if (data.id) {
      const { data: updated, error } = await context.supabase
        .from("driver_trip_drafts")
        .update(row)
        .eq("id", data.id)
        .eq("driver_id", context.userId)
        .select("id")
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (updated?.id) return { id: updated.id as string };
      // Row vanished (deleted elsewhere) — fall through and create a new one.
    }

    const { data: inserted, error } = await context.supabase
      .from("driver_trip_drafts")
      .insert(row)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: inserted.id as string };
  });

export const listMyDriverTripDrafts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("driver_trip_drafts")
      .select("id,label,status,rider_id,assigned_trip_id,payload,updated_at,created_at")
      .eq("driver_id", context.userId)
      .eq("status", "in_progress")
      .order("updated_at", { ascending: false })
      .limit(25);
    if (error) throw new Error(error.message);
    return (data ?? []) as SavedDriverTripDraft[];
  });

export const getDriverTripDraft = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => {
    if (!data?.id) throw new Error("Draft id is required");
    return data;
  })
  .handler(async ({ context, data }) => {
    const { data: row, error } = await context.supabase
      .from("driver_trip_drafts")
      .select("id,label,status,rider_id,assigned_trip_id,payload,updated_at,created_at")
      .eq("id", data.id)
      .eq("driver_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (row as SavedDriverTripDraft | null) ?? null;
  });

export const closeDriverTripDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string; status?: "submitted" | "discarded" }) => {
    if (!data?.id) throw new Error("Draft id is required");
    return data;
  })
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("driver_trip_drafts")
      .update({ status: data.status ?? "submitted" })
      .eq("id", data.id)
      .eq("driver_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
