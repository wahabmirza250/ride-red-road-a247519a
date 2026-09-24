import { useEffect, useRef, useState } from 'react';
import { useServerFn } from '@tanstack/react-start';
import { Camera, CameraOff } from 'lucide-react';
import type { Room } from 'livekit-client';
import { getCameraConnection } from '@/lib/camera.functions';
import { Button } from '@/components/ui/button';

/** Stays mounted across driver routes. Camera availability is explicitly opt-in per session. */
export function DriverCamera() {
  const connect = useServerFn(getCameraConnection);
  const roomRef = useRef<Room | null>(null);
  const generation = useRef(0);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Camera is off');
  const [error, setError] = useState('');
  const [viewers, setViewers] = useState(0);
  const video = useRef<HTMLVideoElement>(null);
  const cleanupRef = useRef<() => void>(() => {});

  function stop() {
    generation.current++;
    cleanupRef.current();
    cleanupRef.current = () => {};
    const room = roomRef.current;
    roomRef.current = null;
    void room?.disconnect();
    setEnabled(false); setBusy(false); setViewers(0); setStatus('Camera is off');
  }
  useEffect(() => () => {
    generation.current++;
    cleanupRef.current();
    void roomRef.current?.disconnect();
  }, []);

  async function start() {
    const current = ++generation.current;
    setBusy(true); setError('');
    let room: Room | undefined;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access is unavailable on this device.');
      // Prompt on the tablet before making it available to an administrator.
      const permission = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      permission.getTracks().forEach(t => t.stop());
      if (current !== generation.current) return;
      const credentials = await connect({ data: { mode: 'publish' } });
      if (current !== generation.current) return;
      const { Room: LiveRoom, RoomEvent, ConnectionState, Track } = await import('livekit-client');
      if (current !== generation.current) return;
      room = new LiveRoom({ adaptiveStream: true, dynacast: true, videoCaptureDefaults: { facingMode: 'environment', resolution: { width: 640, height: 360, frameRate: 15 } } });
      const activeRoom = room;
      roomRef.current = activeRoom;
      let syncing = false;
      let pending = false;
      async function syncCamera() {
        if (syncing) { pending = true; return; }
        syncing = true;
        try {
          do {
            pending = false;
            if (current !== generation.current || activeRoom.state !== ConnectionState.Connected) return;
            const count = [...activeRoom.remoteParticipants.values()].filter(p => p.identity.startsWith('viewer-') && p.permissions?.canSubscribe).length;
            const visible = document.visibilityState === 'visible';
            const publish = count > 0 && visible;
            // No audio is ever requested or published.
            await activeRoom.localParticipant.setCameraEnabled(publish);
            if (current !== generation.current) {
              await activeRoom.disconnect(); return;
            }
            setViewers(count);
            setStatus(!visible ? 'Camera paused — return to the app' : publish ? `Live camera · ${count} administrator${count === 1 ? '' : 's'} viewing` : 'Ready — no one is viewing');
            const track = activeRoom.localParticipant.getTrackPublication(Track.Source.Camera)?.track;
            if (publish && track && video.current) track.attach(video.current);
            if (!publish && video.current) video.current.srcObject = null;
          } while (pending);
        } catch (e) {
          if (current === generation.current) { setError(e instanceof Error ? e.message : 'Camera failed'); stop(); }
        } finally { syncing = false; }
      }
      activeRoom.on(RoomEvent.ParticipantConnected, syncCamera);
      activeRoom.on(RoomEvent.ParticipantDisconnected, syncCamera);
      activeRoom.on(RoomEvent.Reconnected, syncCamera);
      activeRoom.on(RoomEvent.Reconnecting, () => setStatus('Reconnecting camera…'));
      activeRoom.on(RoomEvent.Disconnected, () => { if (current === generation.current) stop(); });
      document.addEventListener('visibilitychange', syncCamera);
      cleanupRef.current = () => document.removeEventListener('visibilitychange', syncCamera);
      await activeRoom.connect(credentials.url, credentials.token);
      if (current !== generation.current) { await activeRoom.disconnect(); return; }
      setEnabled(true);
      await syncCamera();
    } catch (e) {
      void room?.disconnect();
      if (current === generation.current) { stop(); setError(e instanceof Error ? e.message : 'Could not enable camera'); }
    } finally { if (current === generation.current) setBusy(false); }
  }

  return <section className="mb-4 rounded-2xl border bg-surface p-4" aria-label="Vehicle camera">
    <div className="flex items-center justify-between gap-3">
      <div><p className="flex items-center gap-2 font-semibold"><Camera className="h-4 w-4" /> Vehicle camera</p>
        <p role="status" aria-live="polite" className={viewers && enabled ? 'text-sm text-red-600' : 'text-sm text-muted-foreground'}>{status}</p></div>
      <Button variant={enabled ? 'destructive' : 'outline'} disabled={busy} onClick={enabled ? stop : start}>
        {enabled ? <><CameraOff className="mr-2 h-4 w-4" /> Turn off</> : busy ? 'Connecting…' : 'Enable camera'}
      </Button>
    </div>
    <p className="mt-2 text-xs text-muted-foreground">When enabled, your company administrator can view this camera while this app is open. Video only. No recordings are saved.</p>
    <video ref={video} autoPlay muted playsInline className={enabled && viewers > 0 ? 'mt-3 aspect-video w-full rounded-lg bg-black object-contain' : 'hidden'} />
    {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
  </section>;
}
