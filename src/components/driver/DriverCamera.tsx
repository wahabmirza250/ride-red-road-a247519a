import { useEffect, useId, useRef, useState } from 'react';
import { useServerFn } from '@tanstack/react-start';
import { Camera, CameraOff, ChevronDown } from 'lucide-react';
import type { Room } from 'livekit-client';
import { getCameraConnection } from '@/lib/camera.functions';
import { Button } from '@/components/ui/button';

/** Stays mounted across driver routes; connects on entry after device permission. */
export function DriverCamera() {
  const connect = useServerFn(getCameraConnection);
  const roomRef = useRef<Room | null>(null);
  const generation = useRef(0);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Camera is off');
  const [error, setError] = useState('');
  const [viewers, setViewers] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const controlsId = useId();
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
  useEffect(() => {
    // Defer until after mount so StrictMode's probe cannot request the camera twice.
    const timer = window.setTimeout(() => { void start(); }, 0);
    return () => {
      window.clearTimeout(timer);
      generation.current++;
      cleanupRef.current();
      cleanupRef.current = () => {};
      void roomRef.current?.disconnect();
      roomRef.current = null;
    };
    // One connection per driver workspace visit, not on every status update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      // LiveKit announces a participant before updating their permissions.
      // Recheck once subscription rights arrive, including later revocations.
      activeRoom.on(RoomEvent.ParticipantPermissionsChanged, syncCamera);
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

  const live = enabled && status.startsWith('Live camera');
  const compactStatus = busy ? 'Camera connecting…' : error ? 'Camera needs attention' : live
    ? `Camera live · ${viewers} viewing` : status.startsWith('Reconnecting') ? 'Camera reconnecting…'
    : status.startsWith('Camera paused') ? 'Camera paused' : enabled ? 'Camera ready' : 'Camera off';

  return <section className="overflow-hidden rounded-xl border bg-surface" aria-label="Vehicle camera">
    <button type="button" onClick={() => setExpanded(value => !value)} aria-expanded={expanded} aria-controls={controlsId}
      aria-label={`${compactStatus}. ${expanded ? 'Hide' : 'Show'} camera controls`}
      className="flex min-h-11 w-full items-center gap-2.5 px-3 py-2 text-left text-xs">
      <Camera aria-hidden="true" className={`h-4 w-4 shrink-0 ${live ? 'text-red-500' : 'text-muted-foreground'}`} />
      <span role="status" aria-live="polite" title={error || status} className={`min-w-0 flex-1 truncate font-medium ${live ? 'text-red-500' : 'text-muted-foreground'}`}>{compactStatus}</span>
      <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} />
    </button>
    <div id={controlsId} hidden={!expanded} className="border-t p-3">
      <p className="mb-3 text-xs text-muted-foreground">Camera connects automatically when you open the driver app. Your company administrator can view live video while the app is open. No audio or recordings are saved.</p>
      <Button className="min-h-11" variant={enabled ? 'destructive' : 'outline'} disabled={busy} onClick={enabled ? stop : start}>
        {enabled ? <><CameraOff className="mr-2 h-4 w-4" /> Turn off</> : busy ? 'Connecting…' : 'Enable camera'}
      </Button>
      <video ref={video} autoPlay muted playsInline className={enabled && viewers > 0 ? 'mt-3 aspect-video w-full max-w-md rounded-lg bg-black object-contain' : 'hidden'} />
    {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  </section>;
}
