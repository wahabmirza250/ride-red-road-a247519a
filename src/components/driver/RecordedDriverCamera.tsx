import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useServerFn } from '@tanstack/react-start';
import { Camera, Loader2 } from 'lucide-react';
import { getCameraConnection } from '@/lib/camera.functions';
import { prepareRecordingUpload } from '@/lib/recordings.functions';
import { queuedClips, recordCamera, removeClip } from '@/lib/recordingQueue';
import { cameraFailure } from '@/lib/cameraFailure';
import { supabase } from '@/lib/supabaseBrowser';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

/** Camera permission and working recording are mandatory; network recovery preserves trip state. */
export function DriverCamera({ children, consentKey, onExit }: { children: ReactNode; consentKey: string; onExit: () => Promise<void> }) {
  const connect = useServerFn(getCameraConnection);
  const prepare = useServerFn(prepareRecordingUpload);
  const [accepted, setAccepted] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('Connecting live video…');
  const [attempt, setAttempt] = useState(0);
  const stopRef = useRef<() => void>(() => {});
  const storageKey = `nemt-camera-recording-v3:${consentKey}`;
  useEffect(() => { try { setAccepted(localStorage.getItem(storageKey) === 'accepted'); } catch {} }, [storageKey]);
  useEffect(() => {
    if (!accepted) return;
    let closed = false, uploading = false, joining = false;
    let stream: MediaStream | undefined;
    let room: import('livekit-client').Room | undefined;
    let stopRecording = () => {};
    let retry: ReturnType<typeof setTimeout> | undefined;
    let pump: ReturnType<typeof setInterval> | undefined;
    const stop = () => {
      closed = true; clearTimeout(retry); clearInterval(pump);
      stopRecording(); void room?.disconnect(); stream?.getTracks().forEach(t => t.stop());
    };
    stopRef.current = stop;
    const fail = (e: Error) => { if (!closed) { setReady(false); setBusy(false); setError(e.message); stop(); } };
    async function upload() {
      if (uploading || closed || !navigator.onLine) return;
      uploading = true;
      try {
        for (const clip of await queuedClips(consentKey)) {
          if (closed) break;
          if (Date.parse(clip.capturedAt) + 7 * 86400_000 <= Date.now() + 2 * 3600_000 + 60_000) { await removeClip(clip.id); continue; }
          const upload = await prepare({ data: { id: clip.id, capturedAt: clip.capturedAt, mime: clip.mime } });
          const { error } = await supabase.storage.from('vehicle-recordings').uploadToSignedUrl(upload.path, upload.token, clip.blob, { contentType: clip.mime });
          if (error) throw error;
          await removeClip(clip.id);
        }
      } catch { if (!closed) setStatus('Recording on tablet · upload waiting for connection'); }
      finally { uploading = false; }
    }
    async function join() {
      if (closed || joining || !stream || document.visibilityState !== 'visible') return;
      joining = true;
      try {
        const credentials = await connect({ data: { mode: 'publish' } });
        if (closed) return;
        const { Room, RoomEvent, Track } = await import('livekit-client');
        const next = new Room(); room = next;
        next.on(RoomEvent.Disconnected, () => {
          if (!closed) { setStatus('Recording on tablet · live video reconnecting'); clearTimeout(retry); retry = setTimeout(() => void join(), 5000); }
        });
        await next.connect(credentials.url, credentials.token);
        if (closed) { await next.disconnect(); return; }
        // A network disconnect must not stop the original recording track.
        await next.localParticipant.publishTrack(stream!.getVideoTracks()[0].clone(), { source: Track.Source.Camera });
        if (!closed) setStatus('Recording · live video connected');
      } catch {
        void room?.disconnect();
        if (!closed) { setStatus('Recording on tablet · live video reconnecting'); clearTimeout(retry); retry = setTimeout(() => void join(), 5000); }
      } finally { joining = false; }
    }
    async function start() {
      setBusy(true); setError(''); setReady(false);
      try {
        if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('Camera recording is unavailable on this device. Contact your administrator.');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: 640, height: 360, frameRate: 15 }, audio: false });
        if (closed) { stream.getTracks().forEach(t => t.stop()); return; }
        stream.getVideoTracks()[0].onended = () => fail(new Error('Camera access stopped. Allow camera permission and try again.'));
        await queuedClips(consentKey);
        if (closed) return;
        stopRecording = recordCamera(stream, consentKey, fail);
        setReady(true); setBusy(false);
        void join(); void upload(); pump = setInterval(() => void upload(), 15_000);
      } catch (e) {
        const permissionError = e instanceof Error && ['NotAllowedError','SecurityError','NotReadableError','NotFoundError'].includes(e.name);
        fail(new Error(permissionError ? cameraFailure(e).message : e instanceof Error ? e.message : 'Camera recording could not start.'));
      }
    }
    const visibility = () => {
      // Background camera is not supported by this web-based Android build.
      if (document.visibilityState !== 'visible') { stop(); setReady(false); }
      else setAttempt(n => n + 1);
    };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('online', upload);
    void start();
    return () => { stop(); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('online', upload); };
  }, [accepted, attempt, consentKey]);
  function agree() { try { localStorage.setItem(storageKey, 'accepted'); } catch {} setAccepted(true); }
  async function exit() { stopRef.current(); setReady(false); await onExit(); }
  return <>
    <div hidden={!ready} inert={!ready}>
      <p role="status" className="px-3 py-1 text-xs text-muted-foreground">{status} · kept 7 days</p>
      {children}
    </div>
    <Dialog open={!ready}><DialogContent showCloseButton={false} onEscapeKeyDown={e => e.preventDefault()} onPointerDownOutside={e => e.preventDefault()} onInteractOutside={e => e.preventDefault()}>
      <DialogHeader><Camera className="h-6 w-6" aria-hidden="true" /><DialogTitle>{accepted ? 'Company camera' : 'Privacy policy & camera recording'}</DialogTitle>
        <DialogDescription>Using this company driver app requires camera access. While the app is visible, video is recorded without audio and authorized company administrators can view it. Recordings are kept for seven days, then automatically deleted. During connection loss, footage waits on this tablet for upload. Android’s camera indicator remains visible.</DialogDescription>
      </DialogHeader>
      <a href="/privacy.html" target="_blank" rel="noopener noreferrer" className="text-sm underline">Read the camera privacy policy</a>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {busy ? <p role="status"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Starting camera recording…</p> : <Button onClick={accepted ? () => setAttempt(n => n + 1) : agree}>{accepted ? 'Try again' : 'Agree'}</Button>}
      <Button variant="outline" onClick={() => void exit()}>{accepted ? 'Sign out' : 'Decline'}</Button>
      <p className="text-xs text-muted-foreground">Camera access is required. Declining signs you out.</p>
    </DialogContent></Dialog>
  </>;
}
