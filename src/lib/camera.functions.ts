import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { cameraAccess } from './cameraAccess';

export const getCameraConnection = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ mode: z.enum(['publish', 'view']), driverId: z.string().uuid().optional() }))
  .handler(async ({ data, context }) => {
    const { assertCompanyActive } = await import('@/lib/company.server');
    const company = await assertCompanyActive(context.userId);
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const rolesResult = await supabaseAdmin.from('user_roles').select('role').eq('user_id', context.userId).eq('company_id', company.id);
    if (rolesResult.error) throw new Error('Could not verify camera access');
    let query = supabaseAdmin.from('drivers').select('id, user_id, company_id, merged_into').eq('company_id', company.id).is('merged_into', null);
    if (data.mode === 'publish') query = query.eq('user_id', context.userId).eq('company_id', company.id);
    else {
      if (!data.driverId) throw new Error('Select a driver');
      query = query.eq('id', data.driverId);
    }
    const { data: driver, error } = await query.maybeSingle();
    if (error || !driver) throw new Error('Driver is unavailable in your company');
    const access = cameraAccess({ ...data, userId: context.userId, companyId: company.id, roles: (rolesResult.data ?? []).map(r => r.role), driver });
    const url = process.env.LIVEKIT_URL;
    const key = process.env.LIVEKIT_API_KEY;
    const secret = process.env.LIVEKIT_API_SECRET;
    if (!url || !key || !secret) throw new Error('Live camera service is not configured yet. Contact your administrator.');
    if (!url.startsWith('wss://')) throw new Error('Camera service requires a secure connection');
    const { AccessToken, TrackSource } = await import('livekit-server-sdk');
    const token = new AccessToken(key, secret, {
      identity: `${access.identity}${data.mode === 'view' ? `-${crypto.randomUUID()}` : ''}`,
      ttl: '5m',
    });
    token.addGrant({ roomJoin: true, room: access.room, canPublish: access.canPublish,
      canSubscribe: access.canSubscribe, canPublishData: false,
      canPublishSources: data.mode === 'publish' ? [TrackSource.CAMERA] : [],
      canUpdateOwnMetadata: false,
    });
    // No token or patient details in the audit event.
    console.info(JSON.stringify({ event: 'camera_access', userId: context.userId, companyId: company.id, driverId: driver.id, mode: data.mode, at: new Date().toISOString() }));
    return { url, token: await token.toJwt() };
  });
