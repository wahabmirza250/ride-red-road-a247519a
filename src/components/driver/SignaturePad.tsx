import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Eraser } from "lucide-react";

type Props = {
  onChange: (dataUrl: string | null) => void;
};

export function SignaturePad({ onChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = c.getBoundingClientRect();
    c.width = rect.width * dpr;
    c.height = rect.height * dpr;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#0f172a";
  }, []);

  function pos(e: React.PointerEvent) {
    const c = canvasRef.current!;
    const rect = c.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  function down(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture(e.pointerId);
    drawing.current = true;
    const ctx = canvasRef.current!.getContext("2d")!;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  }
  function move(e: React.PointerEvent) {
    if (!drawing.current) return;
    const ctx = canvasRef.current!.getContext("2d")!;
    const p = pos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }
  function up() {
    if (!drawing.current) return;
    drawing.current = false;
    const dataUrl = exportTrimmedSignature();
    setEmpty(!dataUrl);
    onChange(dataUrl);
  }
  function clear() {
    const c = canvasRef.current!;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    setEmpty(true);
    onChange(null);
  }

  function exportTrimmedSignature() {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return null;

    const pixels = ctx.getImageData(0, 0, c.width, c.height);
    let left = c.width;
    let right = 0;
    let top = c.height;
    let bottom = 0;

    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        const alpha = pixels.data[(y * c.width + x) * 4 + 3];
        if (alpha > 8) {
          left = Math.min(left, x);
          right = Math.max(right, x);
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        }
      }
    }

    if (right <= left || bottom <= top) return null;

    const dpr = window.devicePixelRatio || 1;
    const padding = Math.ceil(12 * dpr);
    left = Math.max(0, left - padding);
    right = Math.min(c.width - 1, right + padding);
    top = Math.max(0, top - padding);
    bottom = Math.min(c.height - 1, bottom + padding);

    const cropWidth = right - left + 1;
    const cropHeight = bottom - top + 1;
    const output = document.createElement("canvas");
    output.width = cropWidth;
    output.height = cropHeight;
    output
      .getContext("2d")
      ?.drawImage(c, left, top, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);

    return output.toDataURL("image/png");
  }

  return (
    <div className="space-y-2">
      <div className="relative rounded-2xl border-2 border-dashed border-border bg-white">
        <canvas
          ref={canvasRef}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          className="block h-40 w-full touch-none rounded-2xl"
        />
        {empty && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
            Sign here
          </div>
        )}
      </div>
      <div className="flex justify-end">
        <Button type="button" variant="ghost" size="sm" onClick={clear} className="text-xs">
          <Eraser className="mr-1 h-3 w-3" /> Clear
        </Button>
      </div>
    </div>
  );
}
