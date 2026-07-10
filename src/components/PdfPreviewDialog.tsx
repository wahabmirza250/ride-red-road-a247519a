import { useEffect, useState } from "react";
import { Loader2, Download, ExternalLink, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type Props = {
  url: string | null;
  filename: string;
  onClose: () => void;
};

/**
 * In-app PDF preview. Fetches the signed URL as a blob (so ad-blockers
 * don't intercept a direct storage host navigation) and renders it inside
 * an iframe. Iframes are not blocked the same way top-level blob navigations
 * are, which fixes the "ERR_BLOCKED_BY_CLIENT" error on new-tab preview.
 */
export function PdfPreviewDialog({ url, filename, onClose }: Props) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    let created: string | null = null;
    setError(null);
    setBlobUrl(null);
    (async () => {
      try {
        const res = await fetch(url);
        const buf = await res.arrayBuffer();
        // Supabase signed URLs return 400 with a JSON error body when the
        // object is missing. Detect that and any non-PDF payload so the user
        // sees a real message instead of a broken iframe icon.
        const header = new Uint8Array(buf.slice(0, 5));
        const isPdf =
          header[0] === 0x25 && // %
          header[1] === 0x50 && // P
          header[2] === 0x44 && // D
          header[3] === 0x46 && // F
          header[4] === 0x2d;   // -
        if (!res.ok || !isPdf) {
          let detail = `${res.status} ${res.statusText}`.trim();
          try {
            const txt = new TextDecoder().decode(buf);
            const parsed = JSON.parse(txt);
            if (parsed?.message) detail = parsed.message;
            else if (parsed?.error) detail = parsed.error;
          } catch {
            /* not JSON — keep status text */
          }
          throw new Error(
            detail.toLowerCase().includes("not found") || detail.includes("404") || detail.includes("400")
              ? "This trip's PDF is missing from storage. Ask the driver to re-submit the trip so the PDF is regenerated."
              : `Could not load PDF: ${detail}`,
          );
        }
        if (cancelled) return;
        created = URL.createObjectURL(new Blob([buf], { type: "application/pdf" }));
        setBlobUrl(created);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Could not load PDF");
        }
      }
    })();
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [url]);


  function download() {
    if (!blobUrl) return;
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <Dialog open={!!url} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="flex h-[90vh] max-w-5xl flex-col gap-0 p-0">
        <DialogHeader className="flex flex-row items-center justify-between border-b border-border px-4 py-3 space-y-0">
          <DialogTitle className="truncate text-sm font-semibold">
            {filename}
          </DialogTitle>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={download}
              disabled={!blobUrl}
            >
              <Download className="mr-1 h-3.5 w-3.5" /> Download
            </Button>
            {blobUrl && (
              <a
                href={blobUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
              >
                <ExternalLink className="mr-1 h-3.5 w-3.5" /> New tab
              </a>
            )}
            <Button size="icon" variant="ghost" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>
        <div className="relative flex-1 bg-muted/30">
          {!blobUrl && !error && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading PDF…
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-sm text-destructive">
              {error}
            </div>
          )}
          {blobUrl && (
            <iframe
              title={filename}
              src={blobUrl}
              className="h-full w-full border-0"
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
