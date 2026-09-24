import { useEffect, useRef, useState } from 'react';
import { useServerFn } from '@tanstack/react-start';
import { getCameraConnection } from '@/lib/camera.functions';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export function DriverCameraViewer({ driver, onClose }: { driver: { id: string; name: string }; onClose: () => void }) {
  const getConnection = useServerFn(getCameraConnection);
  const getConnectionRef = useRef(getConnection);
  getConnectionRef.current = getConnection;
  const video = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState('Connecting…');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let close = () => {};
    setError(''); setStatus('Connecting…');
    async function start() {
      try {
        const credentials = await getConnectionRef.current({ data: { mode: 'view', driverId: driver.id } });
        if (cancelled) return;
        const { Room, RoomEvent, Track } = await import('livekit-client');
        if (cancelled) return;
        const room = new Room({ adaptiveStream: true });
        close = () => { void room.disconnect(); };
        room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
          if (cancelled || participant.identity !== `driver-${driver.id}` || track.kind !== Track.Kind.Video) return;
          if (video.current) track.attach(video.current);
          setStatus('Live · video only');
        });
        const unavailable = () => {
          if (video.current) video.current.srcObject = null;
          if (!cancelled) setStatus('Waiting for the driver to enable their camera and keep the app open.');
        };
        room.on(RoomEvent.TrackUnsubscribed, unavailable);
        room.on(RoomEvent.TrackMuted, unavailable);
        room.on(RoomEvent.TrackUnmuted, (publication) => {
          if (publication.track && video.current) { publication.track.attach(video.current); setStatus('Live · video only'); }
        });
        room.on(RoomEvent.ParticipantDisconnected, unavailable);
        room.on(RoomEvent.Reconnecting, () => { if (!cancelled) setStatus('Connection interrupted — reconnecting…'); });
        room.on(RoomEvent.Disconnected, () => { if (!cancelled) { unavailable(); setError('Camera connection closed. Try again.'); } });
        await room.connect(credentials.url, credentials.token);
        if (cancelled) { close(); return; }
        setStatus(previous => previous.startsWith('Live') ? previous : 'Waiting for the driver to enable their camera and keep the app open.');
      } catch (e) { close(); if (!cancelled) setError(e instanceof Error ? e.message : 'Could not connect'); }
    }
    void start();
    return () => { cancelled = true; close(); if (video.current) video.current.srcObject = null; };
  }, [driver.id, attempt]);
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="max-w-3xl"><DialogHeader><DialogTitle>{driver.name} · Live camera</DialogTitle>
      <DialogDescription>Visible to authorized administrators in your company. The tablet shows when the camera is in use.</DialogDescription></DialogHeader>
      <video ref={video} autoPlay muted playsInline className="aspect-video w-full rounded-xl bg-black object-contain" />
      <p role="status" className="text-sm">{status}</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">{error && <Button variant="outline" onClick={() => setAttempt(n => n + 1)}>Try again</Button>}<Button onClick={onClose}>Close camera</Button></div>
    </DialogContent>
  </Dialog>;
}
