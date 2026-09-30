import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
export const submitDemoInvoice = createServerFn({method:'POST'})
  .middleware([requireSupabaseAuth])
  .inputValidator((d:unknown)=>z.object({company_id:z.string().uuid().nullable(),record_ids:z.array(z.string().uuid()).min(1).max(300)}).parse(d))
  .handler(async({data,context})=>{
    const {resolveEdiScope,ediDataClient}=await import('./ediCompany.server');
    const scope=await resolveEdiScope(context.supabase,context.userId,data.company_id);
    const {runDemoBilling}=await import('./demoBilling.server');
    return runDemoBilling(await ediDataClient(context.supabase,scope),scope.companyId,data.record_ids,'submit');
  });
