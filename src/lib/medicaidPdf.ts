import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import templateAsset from "@/assets/nemt_trip_report_template.pdf.asset.json";

type Args = {
  rider: {
    full_name: string;
    medicaid_id: string;
    dob?: string | null;
    phone?: string | null;
    address?: string | null;
  } | null;
  driverName: string;
  vehiclePlate?: string | null;
  vehicleType?: string | null;
  escortName?: string | null;
  identityVerified?: boolean;
  tripKind?: "one_way" | "round_trip" | null;
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
 * Overlays trip data on top of the official Colorado NEMT Trip Report
 * template (April 2025). Coordinates are calibrated to the shipped template;
 * if the state updates the form, adjust the COORDS map below.
 */
export async function generateStateFormPdf(a: Args): Promise<Uint8Array> {
  // Load the state PDF as our base
  const templateBytes = await fetch(templateAsset.url).then((r) => {
    if (!r.ok) throw new Error(`Failed to load template PDF: ${r.status}`);
    return r.arrayBuffer();
  });
  const pdf = await PDFDocument.load(templateBytes);
  const page = pdf.getPage(0);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const { height } = page.getSize();

  // Convert top-origin coords → pdf-lib bottom-origin
  const T = (yFromTop: number) => height - yFromTop;

  const put = (text: string | number | null | undefined, x: number, yTop: number, size = 9, isBold = false) => {
    if (text === null || text === undefined) return;
    page.drawText(String(text), {
      x,
      y: T(yTop) - size + 2,
      size,
      font: isBold ? bold : font,
      color: rgb(0, 0, 0),
    });
  };

  const check = (x: number, yTop: number) => {
    page.drawText("X", { x, y: T(yTop) - 8, size: 10, font: bold, color: rgb(0, 0, 0) });
  };

  // ---- Coordinates (calibrated for April 2025 template, US Letter) ----
  // Member Information
  put(a.rider?.full_name ?? "", 130, 165, 10, true);
  put(a.rider?.medicaid_id ?? "", 470, 165, 10, true);

  if (a.identityVerified) check(178, 200);
  else check(215, 200); // No

  put(a.signatureName ?? a.rider?.full_name ?? "", 130, 240);
  put(new Date(a.pickupAt).toLocaleDateString(), 400, 240);
  put(a.escortName ?? "", 400, 262);

  // Driver / Vehicle
  put(a.driverName, 130, 320, 10, true);
  put(a.vehiclePlate ?? "", 400, 320);

  // Vehicle type checkboxes (approx x positions of each option)
  const vtMap: Record<string, number> = {
    ground_ambulance: 130,
    wheelchair_van: 220,
    stretcher_van: 305,
    taxi: 385,
    ambulatory: 430,
  };
  const vx = vtMap[a.vehicleType ?? ""];
  if (vx) check(vx, 353);

  // Trip type
  if (a.tripKind === "one_way") check(200, 385);
  else if (a.tripKind === "round_trip") check(275, 385);

  // First trip leg
  const dateStr = new Date(a.pickupAt).toLocaleDateString();
  const t = new Date(a.pickupAt);
  const pickupTime = t.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: false });

  put(dateStr, 90, 425);
  put(pickupTime, 110, 450);
  put(String(a.odometerStart), 280, 425);
  put(a.pickupAddress, 380, 425, 8);

  put("—", 110, 480);
  put(String(a.odometerEnd), 280, 480);
  put(a.dropoffAddress, 380, 480, 8);

  // Embed rider signature image over the signature line
  if (a.signatureUrl) {
    try {
      const bytes = await fetch(a.signatureUrl).then((r) => r.arrayBuffer());
      let img;
      try {
        img = await pdf.embedPng(bytes);
      } catch {
        img = await pdf.embedJpg(bytes);
      }
      const targetW = 160;
      const scale = targetW / img.width;
      const targetH = img.height * scale;
      page.drawImage(img, {
        x: 130,
        y: T(245) - targetH,
        width: targetW,
        height: targetH,
      });
    } catch {
      /* signature optional */
    }
  }

  // Audit footer
  page.drawText(
    `Auto-filled by RedArt NEMT · ${new Date().toISOString()}`,
    { x: 40, y: 30, size: 7, font, color: rgb(0.45, 0.45, 0.45) },
  );

  return await pdf.save();
}
