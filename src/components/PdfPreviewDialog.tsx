import { useEffect, useRef, useState } from "react";
import { Loader2, Download, X, ZoomIn, ZoomOut } from "lucide-react";
import * as pdfjs from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
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

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

/**
 * In-app PDF preview. It fetches the PDF bytes and renders pages to canvas via
 * PDF.js instead of using the browser's native PDF viewer. This avoids Chrome's
 * blocked native PDF page / blob iframe behavior while keeping download support.
 */
export function PdfPreviewDialog({ url, filename, onClose }: Props) {
  const [pdfBytes, setPdfBytes] = useState<ArrayBuffer | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    setError(null);
    setPdfBytes(null);
    setFallbackUrl(null);
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
        const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buf.slice(0)) });
        const pdf = await loadingTask.promise;
        if (cancelled) {
          void loadingTask.destroy();
          return;
        }
        setNumPages(pdf.numPages);
        setPdfBytes(buf);
        void loadingTask.destroy();
      } catch (e) {
        if (cancelled) return;
        // The bytes are a real PDF but PDF.js could not render them in this
        // browser — fall back to the browser's built-in viewer instead of
        // surfacing an internal library error.
        if (buf) {
          objectUrl = URL.createObjectURL(new Blob([buf.slice(0)], { type: "application/pdf" }));
          setPdfBytes(buf);
          setFallbackUrl(objectUrl);
          return;
        }
        setError(e instanceof Error ? e.message : "Could not load PDF");
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
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
      <DialogContent className="flex h-[90vh] max-w-5xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="flex flex-row items-center justify-between border-b border-border px-4 py-3 space-y-0">
          <DialogTitle className="truncate text-sm font-semibold">
            {filename}
          </DialogTitle>
          <div className="flex items-center gap-2">
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
        <div className="relative flex-1 overflow-auto bg-muted/30">
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
          {pdfBytes && numPages > 0 && (
            <div className="mx-auto flex w-fit min-w-full flex-col items-center gap-4 p-4">
              {Array.from({ length: numPages }, (_, i) => (
                <PdfCanvasPage
                  key={`${filename}-${i + 1}-${scale}`}
                  bytes={pdfBytes}
                  pageNumber={i + 1}
                  scale={scale}
                />
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PdfCanvasPage({
  bytes,
  pageNumber,
  scale,
}: {
  bytes: ArrayBuffer;
  pageNumber: number;
  scale: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let renderTask: pdfjs.RenderTask | null = null;
    let loadingTask: pdfjs.PDFDocumentLoadingTask | null = null;
    const canvas = canvasRef.current;
    if (!canvas) return;

    (async () => {
      try {
        setError(null);
        loadingTask = pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)) });
        const pdf = await loadingTask.promise;
        const page = await pdf.getPage(pageNumber);
        if (cancelled) {
          void loadingTask.destroy();
          return;
        }

        const viewport = page.getViewport({ scale: 1.35 * scale });
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
        void loadingTask.destroy();
      } catch (e) {
        if (!cancelled && !(e instanceof Error && e.name === "RenderingCancelledException")) {
          setError(e instanceof Error ? e.message : "Could not render PDF page");
        }
      }
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel();
      void loadingTask?.destroy();
    };
  }, [bytes, pageNumber, scale]);

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
