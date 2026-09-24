import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
const input = z.object({
  trip_id: z.string().uuid(),
  driver_id: z.string().uuid().nullable().default(null),
  preview: z.boolean().default(true),
  source: z.enum(["dispatch", "request"]).default("dispatch"),
});
export const nextAdminAssignment = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireCompanyId } = await import("@/lib/company.server");
    const { requireStaff } = await import("@/lib/staffGuard.server");
    await requireStaff(context.userId, ["admin"]);
    await requireCompanyId(context.userId);
    const { data: page, error } = await context.supabase.rpc(
      "admin_trip_page" as never,
      { p_status: "unassigned" } as never,
    );
    if (error) throw new Error(error.message);
    const first = (
      page as unknown as {
        rows: Array<{ id: string; source: "dispatch" | "request"; scheduled_pickup_time: string }>;
      }
    ).rows[0];
    if (!first) throw new Error("No unassigned rides");
    return { id: first.id, source: first.source, at: first.scheduled_pickup_time };
  });
export const assignAdminTrip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => input.parse(v))
  .handler(async ({ context, data }) => {
    const { data: assigned, error } = await context.supabase.rpc(
      "admin_assign_trip" as never,
      {
        p_trip: data.trip_id,
        p_driver: data.driver_id,
        p_preview: data.preview,
        p_source: data.source,
      } as never,
    );
    if (error) throw new Error(error.message);
    const result = assigned as unknown as {
      trip_id: string;
      driver_id: string;
      driver_user_id: string;
      pickup: string;
      dropoff: string;
      rule: string;
      changed?: boolean;
    };
    if (result.changed) {
      // The transactional changed flag makes a repeated confirmation idempotent.
      const { sendPushToUsers } = await import("@/lib/pushSend.server");
      try {
        await sendPushToUsers([result.driver_user_id], {
          title: "Ride assigned to you",
          body: `${result.pickup} → ${result.dropoff}`,
          url: "/driver",
          tag: `trip-${result.trip_id}`,
        });
      } catch {
        /* Assignment remains saved; the driver also receives the realtime update. */
      }
    }
    return result;
  });
