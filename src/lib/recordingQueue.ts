type Clip = { id: string; account: string; capturedAt: string; blob: Blob; mime: 'video/webm' | 'video/mp4' };
const RETENTION = 7 * 86400_000;
const MAX_BYTES = 200 * 1024 * 1024;
async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open('nemt-vehicle-recordings', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('clips', { keyPath: 'id' });
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
}
async function operation<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  try { return await new Promise<T>((resolve, reject) => {
    const tx = db.transaction('clips', mode); const req = run(tx.objectStore('clips'));
    tx.oncomplete = () => resolve(req.result); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  }); } finally { db.close(); }
}
export async function queuedClips(account: string) {
  const all = await operation<Clip[]>('readonly', s => s.getAll());
  for (const clip of all) if (Date.parse(clip.capturedAt) + RETENTION <= Date.now()) await removeClip(clip.id);
  return all.filter(c => c.account === account && Date.parse(c.capturedAt) + RETENTION > Date.now());
}
export async function enqueueClip(clip: Clip) {
  const all = await operation<Clip[]>('readonly', s => s.getAll());
  let bytes = 0;
  for (const c of all) {
    if (Date.parse(c.capturedAt) + RETENTION <= Date.now()) await removeClip(c.id);
    else bytes += c.blob.size;
  }
  if (bytes + clip.blob.size > MAX_BYTES) throw new Error('Recording storage is full. Reconnect the tablet to upload footage before continuing.');
  await operation('readwrite', s => s.put(clip));
}
export async function removeClip(id: string) { await operation('readwrite', s => s.delete(id)); }

/** Independent, playable 30-second files; never an incomplete MediaRecorder timeslice. */
export function recordCamera(stream: MediaStream, account: string, onError: (e: Error) => void) {
  const mime = ['video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find(t => MediaRecorder.isTypeSupported(t));
  if (!mime) throw new Error('This tablet does not support video recording. Contact your administrator.');
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  let recorder: MediaRecorder;
  function segment() {
    const id = crypto.randomUUID(), capturedAt = new Date().toISOString();
    const chunks: Blob[] = [];
    recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 500_000 });
    recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    recorder.onerror = () => onError(new Error('Video recording stopped unexpectedly. Try again.'));
    recorder.onstop = () => {
      const type = mime!.startsWith('video/mp4') ? 'video/mp4' : 'video/webm';
      const blob = new Blob(chunks, { type });
      if (blob.size) void enqueueClip({ id, account, capturedAt, blob, mime: type }).catch(onError);
      if (!stopped && stream.getVideoTracks().some(t => t.readyState === 'live')) segment();
    };
    recorder.start(); timer = setTimeout(() => { if (recorder.state !== 'inactive') recorder.stop(); }, 30_000);
  }
  segment();
  return () => { stopped = true; clearTimeout(timer); if (recorder.state !== 'inactive') recorder.stop(); };
}
