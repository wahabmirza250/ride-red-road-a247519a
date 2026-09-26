import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';

export function normalizeSupportPhone(raw: string) {
  const phone = raw.replace(/[\s().-]/g, '');
  if (phone && !/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error('Enter the support number with country code, for example +13035551234.');
  return phone;
}
export const getCompanySupportForOwner = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth]).inputValidator(z.object({ companyId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { requirePlatformOwner } = await import('./company.server');
    await requirePlatformOwner(context.userId);
    const { supabaseAdmin: db } = await import('@/integrations/supabase/client.server');
    const { data: row, error } = await db.from('app_settings').select('value').eq('key', `company:${data.companyId}:support_phone`).maybeSingle();
    if (error) throw new Error('Could not load support number.');
    return { phone: row?.value ?? '' };
  });
export const setCompanySupportForOwner = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth]).inputValidator(z.object({ companyId: z.string().uuid(), phone: z.string().max(40).transform(normalizeSupportPhone) }))
  .handler(async ({ data, context }) => {
    const { requirePlatformOwner } = await import('./company.server');
    await requirePlatformOwner(context.userId);
    const { supabaseAdmin: db } = await import('@/integrations/supabase/client.server');
    const { data: company } = await db.from('companies').select('id').eq('id', data.companyId).maybeSingle();
    if (!company) throw new Error('Company not found.');
    const { error } = await db.from('app_settings').upsert({ key: `company:${data.companyId}:support_phone`, value: data.phone, updated_by: context.userId }, { onConflict: 'key' });
    if (error) throw new Error('Could not save support number.');
    return { phone: data.phone };
  });
