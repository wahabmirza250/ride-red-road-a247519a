import { useEffect, useRef, useState } from "react";
import { Loader2, Download, X, ZoomIn, ZoomOut } from "lucide-react";
import * as pdfjs from "pdfjs-dist";
// Inlined worker: on custom domains a hashed /assets/*.mjs request can be
// rewritten to the SPA HTML shell, which made PDF.js fail and the viewer show
// raw markup. Inlining removes that network fetch entirely.
import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker&inline";

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

if (typeof window !== "undefined" && !pdfjs.GlobalWorkerOptions.workerPort) {
  pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();
}


/**
 * In-app PDF preview. It fetches the PDF bytes and renders pages to canvas via
 * PDF.js instead of using the browser's native PDF viewer. This avoids Chrome's
 * blocked native PDF page / blob iframe behavior while keeping download support.
 */
export function PdfPreviewDialog({ url, filename, onClose }: Props) {
  const [pdfBytes, setPdfBytes] = useState<ArrayBuffer | null>(null);
  const [pdfDocument, setPdfDocument] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [availableWidth, setAvailableWidth] = useState(0);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => setAvailableWidth(entry.contentRect.width));
    ro.observe(el);
    setAvailableWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [pdfDocument]);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    let loadingTask: pdfjs.PDFDocumentLoadingTask | null = null;
    let loadedDocument: pdfjs.PDFDocumentProxy | null = null;
    setError(null);
    setPdfBytes(null);
    setPdfDocument(null);
    setNumPages(0);
    (async () => {
      let buf: ArrayBuffer | null = null;
      try {
        const res = await fetch(url);
        buf = await res.arrayBuffer();
        // Supabase signed URLs return 400 with a JSON/HTML error body when the
        // object is missing. Detect that and any non-PDF payload so the user
        // sees a real message instead of a wall of raw markup.
        const header = new Uint8Array(buf.slice(0, 5));
        const isPdf =
          header[0] === 0x25 && // %
          header[1] === 0x50 && // P
          header[2] === 0x44 && // D
          header[3] === 0x46 && // F
          header[4] === 0x2d;   // -
        if (!res.ok || !isPdf) {
          buf = null;
          throw new Error(describeFailure(res));
        }
        if (cancelled) return;
        loadingTask = pdfjs.getDocument({ data: new Uint8Array(buf.slice(0)) });
        const pdf = await loadingTask.promise;
        loadedDocument = pdf;
        if (cancelled) {
          void loadingTask.destroy();
          return;
        }
        setNumPages(pdf.numPages);
        setPdfBytes(buf);
        setPdfDocument(pdf);
      } catch (e) {
        if (cancelled) return;
        setError(buf ? "The PDF could not be rendered. Download it to view the report." : e instanceof Error ? e.message : "Could not load PDF");
        if (buf) setPdfBytes(buf);
      }
    })();
    return () => {
      cancelled = true;
      setPdfDocument(null);
      if (loadedDocument || loadingTask) void loadingTask?.destroy();
    };
  }, [url]);



  function download() {
    if (!pdfBytes) return;
    const blobUrl = URL.createObjectURL(new Blob([pdfBytes.slice(0)], { type: "application/pdf" }));
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  }

  return (
    <Dialog open={!!url} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[90vh] max-w-5xl flex-col gap-0 overflow-hidden p-0"
      >
        <DialogHeader className="flex flex-row items-center justify-between gap-3 border-b border-border bg-surface-muted/40 px-4 py-3 space-y-0">
          <DialogTitle className="min-w-0 truncate text-sm font-semibold">
            {filename}
          </DialogTitle>
          <div className="flex shrink-0 items-center gap-2">

            <Button
              size="icon"
              variant="outline"
              onClick={() => setScale((v) => Math.max(0.7, Number((v - 0.15).toFixed(2))))}
              disabled={!pdfBytes}
              aria-label="Zoom out"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="icon"
              variant="outline"
              onClick={() => setScale((v) => Math.min(1.8, Number((v + 0.15).toFixed(2))))}
              disabled={!pdfBytes}
              aria-label="Zoom in"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={download}
              disabled={!pdfBytes}
            >
              <Download className="mr-1 h-3.5 w-3.5" /> Download
            </Button>
            <Button size="icon" variant="ghost" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>
        <div ref={viewportRef} className="relative flex-1 overflow-auto bg-muted/30">
          {!pdfBytes && !error && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading PDF…
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-sm text-destructive">
              {error}
            </div>
          )}
          {pdfDocument && numPages > 0 && (
            <div className="mx-auto flex w-fit min-w-full flex-col items-center gap-4 p-4">
              {Array.from({ length: numPages }, (_, i) => (
                <PdfCanvasPage
                  key={`${filename}-${i + 1}-${scale}-${Math.round(availableWidth)}`}
                  document={pdfDocument}
                  pageNumber={i + 1}
                  scale={scale}
                  availableWidth={availableWidth}
                />
              ))}
            </div>
          )}
        </div>

      </DialogContent>
    </Dialog>
  );
}

/**
 * Turns a failed PDF response into a short human message. Storage and SSR
 * error pages return JSON or full HTML documents; neither should ever be
 * dumped into the viewer as raw markup.
 */
function describeFailure(res: Response): string {
  const status = res.status;
  if (status === 400 || status === 404) {
    return "This trip's PDF is missing from storage. Re-generate it from Edit HCPF → Save & regenerate PDF.";
  }
  if (status === 401 || status === 403) {
    return "This PDF link has expired. Close this window and open the report again.";
  }
  if (status >= 500) {
    return "The server could not deliver this PDF. Try Save & regenerate PDF from the HCPF editor.";
  }
  return "The file returned for this trip is not a PDF. Re-generate it from Edit HCPF → Save & regenerate PDF.";
}


function PdfCanvasPage({
  document,
  pageNumber,
  scale,
  availableWidth,
}: {
  document: pdfjs.PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  availableWidth: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let renderTask: pdfjs.RenderTask | null = null;
    const canvas = canvasRef.current;
    if (!canvas) return;

    (async () => {
      try {
        setError(null);
        const page = await document.getPage(pageNumber);
        if (cancelled) {
          return;
        }

        // Fit the page to the dialog width first, then apply the user's zoom.
        // Without this the canvas renders wider than the panel and the right
        // edge of the report gets clipped.
        const base = page.getViewport({ scale: 1 });
        const fitScale = availableWidth > 0 ? (availableWidth - 40) / base.width : 1.35;
        const viewport = page.getViewport({ scale: Math.max(0.3, fitScale * scale) });

        const outputScale = window.devicePixelRatio || 1;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("PDF canvas is unavailable");

        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        renderTask = page.render({
          canvasContext: context,
          transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
          viewport,
        });

        await renderTask.promise;
      } catch (e) {
        if (!cancelled && !(e instanceof Error && e.name === "RenderingCancelledException")) {
          setError("This page could not be rendered. Download the PDF to view it.");
        }
      }
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [document, pageNumber, scale]);

  return (
    <div className="max-w-full overflow-auto rounded-md border border-border bg-background shadow-sm">
      {error ? (
        <div className="p-4 text-sm text-destructive">{error}</div>
      ) : (
        <canvas ref={canvasRef} className="block max-w-none" />
      )}
    </div>
  );
}
