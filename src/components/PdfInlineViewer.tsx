import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import * as pdfjs from "pdfjs-dist";
import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker&inline";

if (typeof window !== "undefined" && !pdfjs.GlobalWorkerOptions.workerPort) {
  pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();
}

/**
 * Inline PDF preview rendered to <canvas> with PDF.js. Chrome blocks blob /
 * cross-origin PDFs inside iframes ("This page has been blocked by Chrome"),
 * so we never use an iframe for PDF display.
 */
export function PdfInlineViewer({
  url,
  className,
  height = 520,
}: {
  url: string;
  className?: string;
  height?: number;
}) {
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let task: pdfjs.PDFDocumentLoadingTask | null = null;
    setError(null);
    setDoc(null);
    (async () => {
      try {
        const res = await fetch(url);
        const buf = await res.arrayBuffer();
        const h = new Uint8Array(buf.slice(0, 5));
        const isPdf =
          h[0] === 0x25 && h[1] === 0x50 && h[2] === 0x44 && h[3] === 0x46 && h[4] === 0x2d;
        if (!res.ok || !isPdf) throw new Error("The stored file is not a readable PDF.");
        task = pdfjs.getDocument({ data: new Uint8Array(buf) });
        const pdf = await task.promise;
        if (cancelled) {
          void task.destroy();
          return;
        }
        setDoc(pdf);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load PDF");
      }
    })();
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [url]);

  return (
    <div
      ref={boxRef}
      className={className ?? "mt-1 w-full overflow-auto rounded-lg border bg-muted/30"}
      style={{ height }}
    >
      {error ? (
        <div className="flex h-full items-center justify-center p-4 text-center text-xs text-destructive">
          {error}
        </div>
      ) : !doc ? (
        <div className="flex h-full items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 p-3">
          {Array.from({ length: doc.numPages }, (_, i) => (
            <PdfPage key={`${i}-${Math.round(width)}`} doc={doc} page={i + 1} width={width} />
          ))}
        </div>
      )}
    </div>
  );
}

function PdfPage({
  doc,
  page,
  width,
}: {
  doc: pdfjs.PDFDocumentProxy;
  page: number;
  width: number;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    let task: pdfjs.RenderTask | null = null;
    const canvas = ref.current;
    if (!canvas) return;
    (async () => {
      try {
        const p = await doc.getPage(page);
        if (cancelled) return;
        const base = p.getViewport({ scale: 1 });
        const scale = width > 0 ? Math.max(0.3, (width - 32) / base.width) : 1;
        const viewport = p.getViewport({ scale });
        const ratio = window.devicePixelRatio || 1;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        task = p.render({
          canvasContext: ctx,
          transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
          viewport,
        });
        await task.promise;
      } catch {
        /* cancelled renders are expected */
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, page, width]);

  return <canvas ref={ref} className="block rounded-md bg-background shadow-sm" />;
}
