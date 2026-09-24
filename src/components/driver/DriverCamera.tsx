import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useServerFn } from '@tanstack/react-start';
import { Camera, Loader2 } from 'lucide-react';
import type { Room, LocalVideoTrack, Track as CameraTrack } from 'livekit-client';
import { cameraFailure } from '@/lib/cameraFailure';
import { getCameraConnection } from '@/lib/camera.functions';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

/** Required company-tablet camera setup; stays mounted across driver routes. */
export function DriverCamera({ children, consentKey, onExit }: {
  children: ReactNode;
  consentKey: string;
  onExit: () => Promise<void>;
}) {
  const connect = useServerFn(getCameraConnection);
  const roomRef = useRef<Room | null>(null);
  const captureRef = useRef<LocalVideoTrack | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const retryCount = useRef(0);
  const generation = useRef(0);
  const [acknowledged, setAcknowledged] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const cleanupRef = useRef<() => void>(() => {});
  const storageKey = `nemt-camera-notice-v2:${consentKey}`;

  function stop() {
    generation.current++;
    clearTimeout(retryTimer.current);
    cleanupRef.current();
    cleanupRef.current = () => {};
    const room = roomRef.current;
    roomRef.current = null;
    void room?.disconnect();
    captureRef.current?.stop();
    captureRef.current = null;
    setReady(false);
    setBusy(false);
  }

  useEffect(() => {
    // Defer so StrictMode's probe cannot request camera permission twice.
    const timer = window.setTimeout(() => {
      let accepted = false;
      try { accepted = localStorage.getItem(storageKey) === 'accepted'; } catch { /* Show notice if storage is unavailable. */ }
      setAcknowledged(accepted);
      if (accepted) void start();
      else setBusy(false);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      generation.current++;
      clearTimeout(retryTimer.current);
      cleanupRef.current();
      cleanupRef.current = () => {};
      void roomRef.current?.disconnect();
      roomRef.current = null;
      captureRef.current?.stop();
      captureRef.current = null;
    };
    // The parent keys this component by company and driver account.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function fail(error: unknown, reason?: string) {
    const failure = cameraFailure(error, reason);
    stop();
    setError(failure.message);
    if (failure.retryable && retryCount.current < 2) {
      const delay = ++retryCount.current * 2000;
      setBusy(true);
      retryTimer.current = setTimeout(() => { void start(); }, delay);
    }
  }

  async function start() {
    const current = ++generation.current;
    setBusy(true); setError(''); setReady(false);
    let room: Room | undefined;
    let capture: LocalVideoTrack | undefined;
    let joined = false;
    let disconnectedReason: string | undefined;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access is unavailable on this device.');
      const { Room: LiveRoom, RoomEvent, ConnectionState, Track, TrackEvent, DisconnectReason, createLocalVideoTrack } = await import('livekit-client');
      if (current !== generation.current) return;
      // Capture once and publish the same track; do not close/reopen Android's camera after permission.
      capture = await createLocalVideoTrack({ facingMode: 'environment', resolution: { width: 640, height: 360, frameRate: 15 } });
      if (current !== generation.current) { capture.stop(); return; }
      captureRef.current = capture;
      const credentials = await connect({ data: { mode: 'publish' } });
      if (current !== generation.current) return;
      room = new LiveRoom({ adaptiveStream: true, dynacast: true, videoCaptureDefaults: { facingMode: 'environment', resolution: { width: 640, height: 360, frameRate: 15 } } });
      const activeRoom = room;
      roomRef.current = activeRoom;
      let syncing = false;
      let pending = false;
      let watchedTrack: CameraTrack | undefined;
      const cameraEnded = () => {
        if (current !== generation.current || document.visibilityState !== 'visible') return;
        setError('Camera access stopped. Allow camera access to continue using the driver app.');
        stop();
      };
      async function syncCamera() {
        if (syncing) { pending = true; return; }
        syncing = true;
        try {
          do {
            pending = false;
            if (current !== generation.current || activeRoom.state !== ConnectionState.Connected) return;
            const visible = document.visibilityState === 'visible';
            // Keep the company camera active in the foreground. No audio is requested.
            watchedTrack?.off(TrackEvent.Ended, cameraEnded);
            await activeRoom.localParticipant.setCameraEnabled(visible);
            if (current !== generation.current) { await activeRoom.disconnect(); return; }
            watchedTrack = activeRoom.localParticipant.getTrackPublication(Track.Source.Camera)?.track;
            if (visible) {
              if (!watchedTrack || watchedTrack.mediaStreamTrack.readyState !== 'live') throw new Error('Camera is unavailable. Check camera permission and try again.');
              watchedTrack.on(TrackEvent.Ended, cameraEnded);
              setReady(true);
              setBusy(false);
            } else {
              setReady(false);
              setBusy(true);
            }
          } while (pending);
        } catch (e) {
          if (current === generation.current) { setError(e instanceof Error ? e.message : 'Camera failed'); stop(); }
        } finally { syncing = false; }
      }
      activeRoom.on(RoomEvent.Reconnected, syncCamera);
      activeRoom.on(RoomEvent.Reconnecting, () => {
        if (current === generation.current) { setReady(false); setBusy(true); }
      });
      activeRoom.on(RoomEvent.Disconnected, reason => {
        disconnectedReason = reason === undefined ? undefined : DisconnectReason[reason];
        // During connect(), let the rejection report its original cause. The old
        // handler cancelled that catch and replaced every failure with "interrupted".
        if (current === generation.current && joined) fail(undefined, disconnectedReason);
      });
      document.addEventListener('visibilitychange', syncCamera);
      cleanupRef.current = () => {
        document.removeEventListener('visibilitychange', syncCamera);
        watchedTrack?.off(TrackEvent.Ended, cameraEnded);
      };
      await activeRoom.connect(credentials.url, credentials.token);
      if (current !== generation.current) { await activeRoom.disconnect(); return; }
      joined = true;
      await activeRoom.localParticipant.publishTrack(capture, { source: Track.Source.Camera });
      if (current !== generation.current) { await activeRoom.disconnect(); return; }
      await syncCamera();
    } catch (e) {
      if (current === generation.current) {
        fail(e, disconnectedReason);
      }
      void room?.disconnect();
      capture?.stop();
    } finally { if (current === generation.current) setBusy(false); }
  }

  function accept() {
    retryCount.current = 0;
    setAcknowledged(true);
    try { localStorage.setItem(storageKey, 'accepted'); } catch { /* This session still has an acknowledgement. */ }
    void start();
  }

  function decline() {
    stop();
    try { localStorage.removeItem(storageKey); } catch { /* No stored agreement remains in this session. */ }
    setAcknowledged(false);
    void onExit();
  }

  return <>
    {/* Preserve trip state during reconnection while preventing interaction. */}
    <div hidden={!ready} inert={!ready}>{children}</div>
    <Dialog open={!ready}>
      <DialogContent showCloseButton={false} onEscapeKeyDown={event => event.preventDefault()} onPointerDownOutside={event => event.preventDefault()} onInteractOutside={event => event.preventDefault()}>
        <DialogHeader>
          <Camera className="mb-2 h-6 w-6 text-primary" aria-hidden="true" />
          <DialogTitle>{acknowledged ? (error ? 'Camera connection needs attention' : 'Connecting company camera') : 'Privacy policy & camera access'}</DialogTitle>
          <DialogDescription>
            Camera access is required to use this company driver app. While the app is open, the camera runs automatically and your company administrator can view live video. No audio or recordings are saved. Android’s camera indicator remains visible while the camera is active.
          </DialogDescription>
        </DialogHeader>
        <a href="/privacy.html" target="_blank" rel="noopener noreferrer" className="text-sm text-primary underline">Read the driver camera privacy policy</a>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {busy ? <p role="status" className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{acknowledged ? 'Allow camera permission if prompted. Connecting…' : 'Checking camera setup…'}</p>
          : <Button className="min-h-11" onClick={acknowledged ? () => { retryCount.current = 0; void start(); } : accept}>{acknowledged ? 'Try again' : 'Agree'}</Button>}
        <Button className="min-h-11" variant="outline" onClick={decline}>Decline</Button>
        <p className="text-xs text-muted-foreground">Declining signs you out. Camera access is required for the company driver app.</p>
      </DialogContent>
    </Dialog>
  </>;
}
