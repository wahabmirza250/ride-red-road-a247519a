import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
export const getMyPayroll = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) =>
    z.object({ from: z.string().datetime(), to: z.string().datetime() }).parse(v),
  )
  .handler(async () => {
    throw new Error("This section is managed by your company office.");
  });
