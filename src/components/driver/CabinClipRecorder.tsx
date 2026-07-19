import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

/**
 * Records a short (default 8s) cabin video clip from the device camera and
 * hands the resulting Blob back to the caller. Works on all modern mobile
 * browsers using MediaRecorder; front/rear can be switched by the driver.
 */
export function CabinClipRecorder({
  label,
  onSaved,
  seconds = 8,
}: {
  label: string;
  onSaved: (blob: Blob, mimeType: string) => void | Promise<void>;
  seconds?: number;
}) {
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [facing, setFacing] = useState<"environment" | "user">("user");
  const [supported, setSupported] = useState(true);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);

  useEffect(() => {
    setSupported(
      typeof navigator !== "undefined" &&
        !!navigator.mediaDevices?.getUserMedia &&
        typeof window !== "undefined" &&
        "MediaRecorder" in window,
    );
  }, []);

  useEffect(() => () => stopStream(), []);

  function stopStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  async function start() {
    if (!supported) return toast.error("Camera recording isn't supported on this device");
    setBusy(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing },
        audio: true,
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;

      const mime = MediaRecorder.isTypeSupported("video/mp4") ? "video/mp4" : "video/webm";
      const rec = new MediaRecorder(stream, { mimeType: mime });
      recRef.current = rec;
      const chunks: BlobPart[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = async () => {
        setRecording(false);
        setBusy(true);
        try {
          const blob = new Blob(chunks, { type: mime });
          await onSaved(blob, mime);
          toast.success(`${label} saved`);
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Failed to save clip");
        } finally {
          stopStream();
          setBusy(false);
        }
      };
      rec.start();
      setRecording(true);
      setTimeout(() => {
        try {
          rec.state === "recording" && rec.stop();
        } catch { /* noop */ }
      }, seconds * 1000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Camera unavailable";
      toast.error(msg);
      stopStream();
    } finally {
      setBusy(false);
    }
  }

  if (!supported) {
    return (
      <div className="rounded-xl border border-dashed border-border p-3 text-xs text-muted-foreground">
        {label}: camera not supported on this device.
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-xl border border-border bg-surface p-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">{label}</div>
        <button
          type="button"
          onClick={() => setFacing(facing === "user" ? "environment" : "user")}
          className="text-xs text-muted-foreground underline"
          disabled={recording}
        >
          {facing === "user" ? "Front" : "Rear"} camera
        </button>
      </div>
      {(recording || streamRef.current) && (
        <video ref={videoRef} autoPlay muted playsInline className="w-full rounded-lg bg-black" />
      )}
      <Button className="w-full rounded-full" onClick={start} disabled={busy || recording}>
        {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> :
         recording ? <Video className="mr-1 h-4 w-4 animate-pulse text-red-500" /> :
         <Camera className="mr-1 h-4 w-4" />}
        {recording ? `Recording… ${seconds}s` : busy ? "Uploading…" : `Record ${seconds}s clip`}
      </Button>
    </div>
  );
}
