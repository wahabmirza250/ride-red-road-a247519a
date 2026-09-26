let started = false;
let running = false;

/** Remove storage objects through the Storage API, then their index rows. */
export async function removeExpiredRecordings() {
  if (running) return;
  running = true;
  try {
    const { supabaseAdmin: db } = await import('@/integrations/supabase/client.server');
    for (let batch = 0; batch < 100; batch++) {
      const { data: rows, error } = await db.from('camera_recordings').select('id, object_path')
        .lte('expires_at', new Date().toISOString()).limit(100);
      if (error) throw error;
      if (!rows?.length) break;
      const { error: storageError } = await db.storage.from('vehicle-recordings').remove(rows.map(r => r.object_path));
      if (storageError) throw storageError;
      const { error: deleteError } = await db.from('camera_recordings').delete().in('id', rows.map(r => r.id));
      if (deleteError) throw deleteError;
    }
  } finally { running = false; }
}

export function startRecordingRetention() {
  if (started || process.env.NODE_ENV !== 'production') return;
  started = true;
  const sweep = () => void removeExpiredRecordings().catch(() => console.error('Recording retention cleanup failed; retrying in 15 minutes.'));
  sweep();
  setInterval(sweep, 15 * 60_000).unref();
}
