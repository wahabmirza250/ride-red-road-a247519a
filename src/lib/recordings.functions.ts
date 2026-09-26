import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';

export const prepareRecordingUpload = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ id: z.string().uuid(), capturedAt: z.string().datetime(), mime: z.enum(['video/webm', 'video/mp4']) }))
  .handler(async ({ data, context }) => {
    const { assertCompanyActive } = await import('./company.server');
    const company = await assertCompanyActive(context.userId);
    const { supabaseAdmin: db } = await import('@/integrations/supabase/client.server');
    const { data: driver } = await db.from('drivers').select('id').eq('user_id', context.userId).eq('company_id', company.id).is('merged_into', null).maybeSingle();
    const { data: role } = await db.from('user_roles').select('role').eq('user_id', context.userId).eq('company_id', company.id).eq('role', 'driver').maybeSingle();
    if (!driver || !role) throw new Error('Driver recording access required.');
    const captured = Date.parse(data.capturedAt);
    const expires = captured + 7 * 86400_000;
    // Upload tokens live two hours. Never issue one that outlives deletion.
    if (captured > Date.now() + 30_000 || expires <= Date.now() + 2 * 3600_000 + 60_000) throw new Error('Recording is outside the upload retention window.');
    const path = `${company.id}/${driver.id}/${data.id}.${data.mime === 'video/mp4' ? 'mp4' : 'webm'}`;
    const { error } = await db.from('camera_recordings').upsert({
      id: data.id, company_id: company.id, driver_id: driver.id, object_path: path,
      captured_at: data.capturedAt, expires_at: new Date(expires).toISOString(),
    }, { onConflict: 'object_path', ignoreDuplicates: true });
    if (error) throw new Error('Could not prepare recording storage.');
    const { data: upload, error: uploadError } = await db.storage.from('vehicle-recordings').createSignedUploadUrl(path, { upsert: true });
    if (uploadError || !upload) throw new Error('Recording upload is temporarily unavailable.');
    return { path, token: upload.token };
  });

export const listDriverRecordings = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ driverId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { requireStaff } = await import('./staffGuard.server');
    await requireStaff(context.userId, ['admin']);
    const { assertCompanyActive } = await import('./company.server');
    const company = await assertCompanyActive(context.userId);
    const { supabaseAdmin: db } = await import('@/integrations/supabase/client.server');
    const { data: rows, error } = await db.from('camera_recordings').select('id, object_path, captured_at, expires_at')
      .eq('company_id', company.id).eq('driver_id', data.driverId).gt('expires_at', new Date().toISOString())
      .order('captured_at', { ascending: false }).limit(100);
    if (error) throw new Error('Could not load recordings.');
    return Promise.all((rows ?? []).map(async r => {
      const seconds = Math.max(1, Math.min(300, Math.floor((Date.parse(r.expires_at)-Date.now())/1000)));
      const { data: signed } = await db.storage.from('vehicle-recordings').createSignedUrl(r.object_path, seconds);
      return { id: r.id, capturedAt: r.captured_at, expiresAt: r.expires_at, url: signed?.signedUrl ?? null };
    }));
  });
