import { forwardRef, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Download, ExternalLink, FileWarning, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PdfInlineViewer } from "@/components/PdfInlineViewer";
import { attachmentKind } from "@/lib/resubmissionAttachment";
import { getResubmissionAttachmentUrl } from "@/lib/resubmission.functions";

/**
 * Inline preview of the trip report attached to a resubmission draft.
 *
 * The signed URL is always resolved server-side from the draft itself, so only
 * the draft attachment or the untouched original trip report can be displayed.
 * Nothing here writes to storage or to the original trip.
 */
export const ResubmissionReportPreview = forwardRef<
  HTMLDivElement,
  {
    resubmissionId: string;
    path: string | null;
    originalPath: string | null;
    /** Bumped by the parent after a replacement upload to force a refresh. */
    version?: number;
  }
>(function ResubmissionReportPreview({ resubmissionId, path, originalPath, version = 0 }, ref) {
  const signFn = useServerFn(getResubmissionAttachmentUrl);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    setError(null);
    if (!path) return;
    setLoading(true);
    (async () => {
      try {
        const res: any = await signFn({ data: { id: resubmissionId, path } });
        if (cancelled) return;
        if (!res?.url) setError("That attachment is no longer available.");
        else setUrl(res.url as string);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Could not load the attachment.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resubmissionId, path, version, nonce]);

  // Signed URLs live 15 minutes — refresh well before they expire.
  useEffect(() => {
    if (!url) return;
    const t = setTimeout(() => setNonce((n) => n + 1), 12 * 60 * 1000);
    return () => clearTimeout(t);
  }, [url]);

  const isOriginal = !!path && path === originalPath;
  const kind = attachmentKind(path);
  const fileName = path ? path.split("/").pop() : null;

  return (
    <section ref={ref} tabIndex={-1} className="mt-6 scroll-mt-4 space-y-3 outline-none">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">Attached trip report</h3>
        {path ? (
          <Badge variant={isOriginal ? "secondary" : "default"}>
            {isOriginal ? "Original trip report" : "Draft replacement"}
          </Badge>
        ) : null}
        {fileName ? (
          <span className="max-w-[260px] truncate font-mono text-xs text-muted-foreground">
            {fileName}
          </span>
        ) : null}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!path || loading}
            onClick={() => setNonce((n) => n + 1)}
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!url}
            onClick={() => url && window.open(url, "_blank", "noopener")}
          >
            <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Open in new tab
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={!url}
            onClick={() => {
              if (!url) return;
              const a = document.createElement("a");
              a.href = url;
              a.download = fileName ?? "trip-report";
              a.click();
            }}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" /> Download
          </Button>
        </div>
      </div>

      {!path ? (
        <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          No trip report is attached to this claim yet.
        </div>
      ) : loading ? (
        <div className="flex h-40 items-center justify-center rounded-xl border">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-6 text-center text-sm text-destructive">
          <FileWarning className="h-5 w-5" />
          <span>{error}</span>
          <Button size="sm" variant="outline" onClick={() => setNonce((n) => n + 1)}>
            Try again
          </Button>
        </div>
      ) : url && kind === "pdf" ? (
        <PdfInlineViewer
          url={url}
          height={760}
          className="w-full overflow-auto rounded-xl border bg-muted/30 [height:60vh] sm:[height:760px]"
        />
      ) : url && kind === "image" ? (
        <div className="overflow-auto rounded-xl border bg-muted/30 p-3">
          <img
            src={url}
            alt="Attached trip report"
            className="mx-auto max-h-[760px] w-auto max-w-full rounded-md shadow-sm"
          />
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-xl border p-6 text-center text-sm text-muted-foreground">
          This file type cannot be shown inline.
          <Button size="sm" variant="outline" disabled={!url} onClick={() => url && window.open(url, "_blank", "noopener")}>
            Open file
          </Button>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Viewing only — the original trip's stored report is never overwritten or deleted.
      </p>
    </section>
  );
});
