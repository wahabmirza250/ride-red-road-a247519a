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
        if (!res.ok) throw new Error(`Load failed (${res.status})`);
        const blob = await res.blob();
        if (cancelled) return;
        created = URL.createObjectURL(
          new Blob([blob], { type: "application/pdf" }),
        );
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
