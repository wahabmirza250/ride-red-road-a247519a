import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertBilling, logAudit } from "@/lib/billingHelpers";

/**
 * Correct the key data on a bill that came back as "Needs fix" (wrong
 * Medicaid ID, misread name/DOB, bad odometer) and put it back in the
 * submittable queue.
 *
 * Medicaid ID handling is a merge, never a blind overwrite: if another member
 * record in the same company already owns the corrected ID, the trip is
 * relinked to that existing member instead of creating a second identity.
 */
export const updateBillForFix = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        medicaid_id: z.string().trim().min(1).optional(),
        full_name: z.string().trim().min(1).optional(),
        dob: z.string().trim().optional().nullable(),
        phone: z.string().trim().optional().nullable(),
        pickup_at: z.string().trim().optional(),
        pickup_address: z.string().trim().optional(),
        dropoff_address: z.string().trim().optional(),
        odometer_start: z.number().nonnegative().optional(),
        odometer_end: z.number().nonnegative().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertBilling(supabase, userId);

    const { data: rec, error } = await supabase
      .from("billing_records")
      .select(
        `id, status, trip_id,
         medicaid_trips!inner(
           id, company_id, rider_id, pickup_at, pickup_address, dropoff_address,
           odometer_start, odometer_end, miles, robot_confirmation_number,
           submitted_confirmation,
           riders(id, full_name, medicaid_id, dob, phone)
         )`,
      )
      .eq("id", data.id)
      .single();
    if (error) throw new Error(error.message);

    const trip = (rec as any).medicaid_trips;
    const rider = trip?.riders;

    if (trip?.robot_confirmation_number || trip?.submitted_confirmation) {
      throw new Error(
        "This claim already has a portal confirmation number — it cannot be edited or resubmitted.",
      );
    }
    if (!["needs_fix", "approved", "pending_review", "rejected"].includes(rec.status as string)) {
      throw new Error(`A bill with status "${rec.status}" cannot be edited here.`);
    }

    const changes: string[] = [];
    let riderId: string = trip.rider_id;
    let merged = false;

    // ---- member identity ----
    const newId = data.medicaid_id?.trim();
    const newName = data.full_name?.trim();
    if (newId && newId !== (rider?.medicaid_id ?? "")) {
      const { data: existing } = await supabase
        .from("riders")
        .select("id, full_name")
        .eq("company_id", trip.company_id)
        .eq("medicaid_id", newId)
        .maybeSingle();
      if (existing?.id && existing.id !== riderId) {
        riderId = existing.id;
        merged = true;
        changes.push(
          `Medicaid ID ${rider?.medicaid_id ?? "—"} → ${newId} (merged onto existing member ${existing.full_name})`,
        );
      } else {
        const { error: rErr } = await supabase
          .from("riders")
          .update({ medicaid_id: newId })
          .eq("id", riderId);
        if (rErr) throw new Error(`Could not update Medicaid ID: ${rErr.message}`);
        changes.push(`Medicaid ID ${rider?.medicaid_id ?? "—"} → ${newId}`);
      }
    }

    if (!merged) {
      const riderPatch: { full_name?: string; dob?: string | null; phone?: string | null } = {};
      if (newName && newName !== rider?.full_name) {
        riderPatch.full_name = newName;
        changes.push(`Name ${rider?.full_name ?? "—"} → ${newName}`);
      }
      if (data.dob !== undefined && (data.dob || null) !== (rider?.dob ?? null)) {
        riderPatch.dob = data.dob || null;
        changes.push(`DOB → ${data.dob || "—"}`);
      }
      if (data.phone !== undefined && (data.phone || null) !== (rider?.phone ?? null)) {
        riderPatch.phone = data.phone || null;
        changes.push(`Phone → ${data.phone || "—"}`);
      }
      if (Object.keys(riderPatch).length) {
        const { error: rErr } = await supabase.from("riders").update(riderPatch).eq("id", riderId);
        if (rErr) throw new Error(`Could not update the member record: ${rErr.message}`);
      }
    }

    // ---- trip fields ----
    const tripPatch: {
      rider_id?: string;
      pickup_at?: string;
      pickup_address?: string;
      dropoff_address?: string;
      odometer_start?: number;
      odometer_end?: number;
      miles?: number;
    } = {};
    if (riderId !== trip.rider_id) tripPatch.rider_id = riderId;
    if (data.pickup_at && data.pickup_at !== trip.pickup_at) {
      tripPatch.pickup_at = data.pickup_at;
      changes.push(`Trip date → ${data.pickup_at}`);
    }
    if (data.pickup_address && data.pickup_address !== trip.pickup_address) {
      tripPatch.pickup_address = data.pickup_address;
      changes.push("Pickup address updated");
    }
    if (data.dropoff_address && data.dropoff_address !== trip.dropoff_address) {
      tripPatch.dropoff_address = data.dropoff_address;
      changes.push("Dropoff address updated");
    }
    const start = data.odometer_start ?? trip.odometer_start;
    const end = data.odometer_end ?? trip.odometer_end;
    if (data.odometer_start !== undefined || data.odometer_end !== undefined) {
      if (end < start) throw new Error("Ending odometer cannot be lower than the starting odometer.");
      if (start !== trip.odometer_start) tripPatch.odometer_start = start;
      if (end !== trip.odometer_end) tripPatch.odometer_end = end;
      const miles = Math.max(0, Number((end - start).toFixed(1)));
      if (miles !== trip.miles) tripPatch.miles = miles;
      if (start !== trip.odometer_start || end !== trip.odometer_end) {
        changes.push(`Odometer ${trip.odometer_start}–${trip.odometer_end} → ${start}–${end} (${miles} mi)`);
      }
    }
    if (Object.keys(tripPatch).length) {
      const { error: tErr } = await supabase
        .from("medicaid_trips")
        .update({ ...tripPatch, status: "approved" })
        .eq("id", trip.id);
      if (tErr) throw new Error(`Could not update the trip: ${tErr.message}`);
    }

    // ---- put it back in the submittable queue ----
    const { error: bErr } = await supabase
      .from("billing_records")
      .update({
        status: "approved",
        submission_error: null,
        fix_notes: null,
        // Corrected data = a fresh start for the automatic timeout retries.
        auto_retry_count: 0,
        requires_human_step: false,
        reviewed_by: userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", data.id);
    if (bErr) throw new Error(bErr.message);

    await logAudit(
      supabase,
      data.id,
      userId,
      "edited",
      changes.length ? changes.join(" · ") : "No field changes",
    );

    return { ok: true, changes, merged, rider_id: riderId };
  });
