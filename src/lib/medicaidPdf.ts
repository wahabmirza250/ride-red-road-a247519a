import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import templateAsset from "@/assets/nemt_trip_report_template.pdf.asset.json";

export type Leg = {
  leg_index: 1 | 2;
  leg_date: string;
  pickup_time?: string | null;
  pickup_odometer: number;
  pickup_address: string;
  dropoff_time?: string | null;
  dropoff_odometer: number;
  dropoff_address: string;
};

export type FormArgs = {
  rider: {
    full_name: string;
    medicaid_id: string;
    dob?: string | null;
    phone?: string | null;
    address?: string | null;
  } | null;
  driverName: string;
  vehiclePlate?: string | null;
  vehicleVin?: string | null;
  vehicleType?: string | null;
  escortName?: string | null;
  identityVerified?: boolean;
  tripKind?: "one_way" | "round_trip" | "group_tour" | null;
  legs: Leg[];
  signatureName: string | null;
  signatureUrl: string | null;
  signedByEscort?: boolean;
};

/**
 * Overlays trip data on top of the official Colorado NEMT Trip Report
 * template (April 2025). One PDF per rider. Coordinates are calibrated
 * against the shipped template; adjust the numeric constants below if
 * the state releases an updated form.
 */
export async function generateStateFormPdf(a: FormArgs): Promise<Uint8Array> {
  const templateBytes = await fetch(templateAsset.url).then((r) => {
    if (!r.ok) throw new Error(`Failed to load template PDF: ${r.status}`);
    return r.arrayBuffer();
  });
  const pdf = await PDFDocument.load(templateBytes);
  const page = pdf.getPage(0);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const { height } = page.getSize();

  const T = (yFromTop: number) => height - yFromTop;

  const put = (
    text: string | number | null | undefined,
    x: number,
    yTop: number,
    size = 9,
    isBold = false,
  ) => {
    if (text === null || text === undefined || text === "") return;
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

  /* ---------- Member section ---------- */
  put(a.rider?.full_name ?? "", 130, 165, 10, true);
  put(a.rider?.medicaid_id ?? "", 470, 165, 10, true);
  if (a.identityVerified) check(178, 200);
  else check(215, 200);

  const leg1 = a.legs.find((l) => l.leg_index === 1) ?? a.legs[0];
  const leg2 = a.legs.find((l) => l.leg_index === 2);

  put(a.signatureName ?? a.rider?.full_name ?? "", 130, 240);
  put(leg1 ? new Date(leg1.leg_date).toLocaleDateString() : "", 400, 240);
  put(a.escortName ?? "", 400, 262);

  /* ---------- Driver / Vehicle ---------- */
  put(a.driverName, 130, 320, 10, true);
  put(
    [a.vehiclePlate, a.vehicleVin && `VIN ${a.vehicleVin}`].filter(Boolean).join(" · "),
    400,
    320,
  );

  const vtMap: Record<string, number> = {
    ground_ambulance: 130,
    wheelchair_van: 220,
    stretcher_van: 305,
    taxi: 385,
    ambulatory: 430,
  };
  const vx = vtMap[a.vehicleType ?? ""];
  if (vx) check(vx, 353);

  if (a.tripKind === "one_way") check(200, 385);
  else check(275, 385); // round_trip or group_tour treated as round for the form

  /* ---------- Legs ---------- */
  const drawLeg = (
    leg: Leg | undefined,
    dateY: number,
    pickupY: number,
    dropoffY: number,
  ) => {
    if (!leg) return;
    put(new Date(leg.leg_date).toLocaleDateString(), 90, dateY);
    put(fmtTime(leg.pickup_time), 110, pickupY);
    put(String(leg.pickup_odometer), 280, dateY);
    put(leg.pickup_address, 380, dateY, 8);
    put(fmtTime(leg.dropoff_time), 110, dropoffY);
    put(String(leg.dropoff_odometer), 280, dropoffY, 9);
    put(leg.dropoff_address, 380, dropoffY, 8);
  };
  drawLeg(leg1, 425, 450, 480);
  drawLeg(leg2, 545, 570, 600);

  /* ---------- Signature image ---------- */
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
      if (a.signedByEscort) put("(signed by escort)", 300, 245, 7);
    } catch {
      /* signature optional */
    }
  }

  page.drawText(
    `Auto-filled by RedArt NEMT · ${new Date().toISOString()}`,
    { x: 40, y: 30, size: 7, font, color: rgb(0.45, 0.45, 0.45) },
  );

  return await pdf.save();
}

function fmtTime(t?: string | null): string {
  if (!t) return "";
  // HH:MM 24h → h:MM AM/PM
  const [hStr, mStr] = t.split(":");
  const h = Number(hStr);
  const m = mStr ?? "00";
  if (Number.isNaN(h)) return t;
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${m} ${ampm}`;
}
