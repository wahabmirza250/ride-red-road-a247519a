import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PdfPreviewDialog } from "@/components/PdfPreviewDialog";
import { getStatePdfUrl } from "@/lib/nemtTrip.functions";

/**
 * "View scanned form" — opens the stored trip report PDF for a bill.
 *
 * The signed URL comes from the existing storage-signing path (server-side
 * `getStatePdfUrl` for `state-pdfs`). The raw bucket path is never rendered.
 */
export function ViewScannedFormButton({
  tripId,
  pdfUrl,
  passengerName,
  className,
  size = "sm",
  variant = "outline",
}: {
  tripId: string | null | undefined;
  /** Already-signed URL from the list/detail payload, when available. */
  pdfUrl?: string | null;
  passengerName?: string | null;
  className?: string;
  size?: "sm" | "default";
  variant?: "outline" | "secondary" | "ghost";
}) {
  const signFn = useServerFn(getStatePdfUrl);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const filename = `trip-report-${(passengerName ?? "rider").replace(/\s+/g, "_")}.pdf`;

  async function open() {
    if (pdfUrl) {
      setUrl(pdfUrl);
      return;
    }
    if (!tripId) return;
    setLoading(true);
    try {
      const res: any = await signFn({ data: { trip_id: tripId } });
      if (!res?.url) {
        toast.message("No scanned form is stored for this trip yet.");
        return;
      }
      setUrl(res.url as string);
    } catch {
      toast.error("Could not open the scanned form. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (!tripId && !pdfUrl) return null;

  return (
    <>
      <Button
        type="button"
        size={size}
        variant={variant}
        className={className}
        disabled={loading}
        onClick={(e) => {
          e.stopPropagation();
          void open();
        }}
      >
        {loading ? (
          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
        ) : (
          <FileText className="mr-1 h-3.5 w-3.5" />
        )}
        View scanned form
      </Button>
      <PdfPreviewDialog url={url} filename={filename} onClose={() => setUrl(null)} />
    </>
  );
}
