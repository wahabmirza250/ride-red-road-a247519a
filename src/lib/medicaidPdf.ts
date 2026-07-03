import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

type Args = {
  rider: { full_name: string; medicaid_id: string; dob?: string | null; phone?: string | null; address?: string | null } | null;
  driverName: string;
  pickupAt: string;
  pickupAddress: string;
  dropoffAddress: string;
  odometerStart: number;
  odometerEnd: number;
  miles: number;
  signatureName: string | null;
  signatureUrl: string | null;
};

/**
 * Placeholder Colorado Medicaid NEMT trip receipt.
 * Once the state form PDF is provided, we'll replace this with a template fill.
 */
export async function generateStateFormPdf(a: Args): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]); // US Letter
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const draw = (text: string, x: number, y: number, opts: { size?: number; bold?: boolean } = {}) =>
    page.drawText(text, {
      x,
      y,
      size: opts.size ?? 10,
      font: opts.bold ? bold : font,
      color: rgb(0, 0, 0),
    });

  // Header
  draw("Colorado Medicaid NEMT Trip Record", 40, 750, { size: 16, bold: true });
  draw("RedArt LLC", 40, 732, { size: 10 });
  page.drawLine({ start: { x: 40, y: 725 }, end: { x: 572, y: 725 }, thickness: 1 });

  let y = 700;
  const row = (label: string, value: string) => {
    draw(label, 40, y, { bold: true });
    draw(value, 180, y);
    y -= 20;
  };

  row("Rider name:", a.rider?.full_name ?? "");
  row("Medicaid ID:", a.rider?.medicaid_id ?? "");
  row("Date of birth:", a.rider?.dob ?? "");
  row("Rider phone:", a.rider?.phone ?? "");
  row("Rider address:", a.rider?.address ?? "");
  y -= 6;

  row("Driver:", a.driverName);
  row("Pickup date/time:", new Date(a.pickupAt).toLocaleString());
  row("Pickup address:", a.pickupAddress);
  row("Drop-off address:", a.dropoffAddress);
  y -= 6;

  row("Odometer start:", String(a.odometerStart));
  row("Odometer end:", String(a.odometerEnd));
  row("Total miles:", String(a.miles));

  y -= 20;
  draw("Rider signature:", 40, y, { bold: true });
  y -= 12;

  if (a.signatureUrl) {
    try {
      const bytes = await fetch(a.signatureUrl).then((r) => r.arrayBuffer());
      const img = await pdf.embedPng(bytes);
      const dims = img.scale(0.4);
      const w = Math.min(dims.width, 300);
      const h = (w / dims.width) * dims.height;
      page.drawImage(img, { x: 40, y: y - h, width: w, height: h });
      y -= h + 10;
    } catch {
      /* skip */
    }
  }
  draw(`Printed name: ${a.signatureName ?? ""}`, 40, y);
  y -= 16;
  draw(`Signed on: ${new Date().toLocaleString()}`, 40, y);

  page.drawText(
    "Placeholder receipt — replace with official Colorado state form once provided.",
    { x: 40, y: 40, size: 8, font, color: rgb(0.4, 0.4, 0.4) },
  );

  return await pdf.save();
}
