import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { autoFinalizeSweep } from "@/lib/reconcileSweep.server";
const dry = process.argv.includes("--dry");
const out = await autoFinalizeSweep(supabaseAdmin, {
  sweepId: "af8ec839-18a6-4d45-8fa1-dfc742fdf114",
  companyId: null,
  actorId: null,
  dryRun: dry,
});
console.log(JSON.stringify(out, null, 2));
