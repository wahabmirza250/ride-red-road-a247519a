import { useRef, useState } from "react";
import { Camera, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

/** Camera-only photo picker for odometer captures. */
export function OdometerPhotoButton({
  label,
  onCaptured,
  captured,
}: {
  label: string;
  onCaptured: (file: File) => void | Promise<void>;
  captured?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);

  async function handle(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      await onCaptured(file);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handle}
        className="hidden"
      />
      <Button
        variant={captured ? "outline" : "default"}
        className="w-full rounded-full"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
      >
        {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> :
         captured ? <Check className="mr-1 h-4 w-4 text-emerald-500" /> :
         <Camera className="mr-1 h-4 w-4" />}
        {captured ? `${label} — captured (retake)` : label}
      </Button>
    </>
  );
}
