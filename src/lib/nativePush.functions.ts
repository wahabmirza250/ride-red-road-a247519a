import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
export const saveNativePushToken = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth]).inputValidator(z.object({ token: z.string().min(20).max(4096) }))
  .handler(async ({ data, context }) => {
    const { assertCompanyActive } = await import('./company.server');
    const company = await assertCompanyActive(context.userId);
    const { supabaseAdmin: db } = await import('@/integrations/supabase/client.server');
    const { error } = await db.from('native_push_tokens').upsert({ token: data.token, user_id: context.userId, company_id: company.id, updated_at: new Date().toISOString() });
    if (error) throw new Error('Could not enable device notifications.');
    return { ok: true };
  });
export const removeNativePushToken = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth]).inputValidator(z.object({ token: z.string().max(4096) }))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin: db } = await import('@/integrations/supabase/client.server');
    const { error } = await db.from('native_push_tokens').delete().eq('token', data.token).eq('user_id', context.userId);
    if (error) throw new Error('Could not remove device notifications.');
    return { ok: true };
  });
