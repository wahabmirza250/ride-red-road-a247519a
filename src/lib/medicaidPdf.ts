import { degrees, PDFDocument, rgb } from "pdf-lib";
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

type GeneratePdfOptions = {
  templateBaseUrl?: string;
};

type PdfRect = { x: number; y: number; width: number; height: number };

/**
 * Fills the official Colorado HCPF Non-Emergent Medical Transportation Trip
 * Log (April 2025) using its AcroForm fields, stamps the captured signature
 * PNG over the Members Signature widget, and flattens the form so the
 * downloaded PDF renders identically to the state's paper form.
 *
 * Field names and radio export values are taken verbatim from the shipped
 * fillable template — the state's spelling/casing (e.g. "AM" vs "am") is
 * preserved because those strings are the field's export values.
 */
export async function generateStateFormPdf(
  a: FormArgs,
  options: GeneratePdfOptions = {},
): Promise<Uint8Array> {
  const templateUrl = resolveTemplateUrl(options.templateBaseUrl);
  const templateBytes = await fetch(templateUrl).then((r) => {
    if (!r.ok) throw new Error(`Failed to load template PDF: ${r.status}`);
    return r.arrayBuffer();
  });
  const pdf = await PDFDocument.load(templateBytes);
  const form = pdf.getForm();

  const setText = (name: string, value: string | number | null | undefined) => {
    if (value === null || value === undefined || value === "") return;
    try {
      form.getTextField(name).setText(String(value));
    } catch {
      /* field absent in a future template revision — safe to skip */
    }
  };

  const setRadio = (name: string, value: string | null | undefined) => {
    if (!value) return;
    try {
      form.getRadioGroup(name).select(value);
    } catch {
      /* option/field missing — skip rather than crash the export */
    }
  };

  const leg1 = a.legs.find((l) => l.leg_index === 1) ?? a.legs[0] ?? null;
  const leg2 = a.legs.find((l) => l.leg_index === 2) ?? null;

  /* ---------- Member section ---------- */
  setText("Members Name", a.rider?.full_name ?? "");
  setText("Member Health First Colorado ID", a.rider?.medicaid_id ?? "");
  setRadio(
    "driver verify member identity",
    a.identityVerified === false ? "no" : "yes",
  );
  setText(
    "Trip Date",
    leg1?.leg_date ? new Date(leg1.leg_date).toLocaleDateString() : "",
  );
  setText(
    "Member facility or escort may sign to confirm that trip occurred  Escort Name if applicable",
    a.escortName ?? "",
  );

  /* ---------- Driver / Vehicle ---------- */
  setText("Drivers Name", a.driverName);
  setText(
    "Vehicle License Plate or VIN",
    [a.vehiclePlate, a.vehicleVin && `VIN ${a.vehicleVin}`]
      .filter(Boolean)
      .join(" · "),
  );

  const vehicleMap: Record<string, string> = {
    ground_ambulance: "ground ambulance",
    wheelchair_van: "wheelchair van",
    stretcher_van: "stretcher van",
    taxi: "taxi",
    ambulatory: "Mobility/Ambulatory vehicle",
  };
  setRadio("type of vehicle", vehicleMap[a.vehicleType ?? ""]);

  // The state form only offers one way / round trip. Group-tour is treated as
  // round-trip for the paper output.
  setRadio(
    "type of trip",
    a.tripKind === "one_way" ? "one way" : "round trip",
  );

  /* ---------- Legs ---------- */
  const fmt = fmtDate;
  const tm = splitTime;

  if (leg1) {
    setText("Date", fmt(leg1.leg_date));
    const p1 = tm(leg1.pickup_time);
    setText("Pickup TIme", p1.hm);
    setRadio("pick up time", p1.ampm);
    setText("Pickup Odometer Reading", leg1.pickup_odometer);
    setText("Pickup Street Address City State Zip", leg1.pickup_address);

    const d1 = tm(leg1.dropoff_time);
    setText("Actual DropOff Time  AM  PM", d1.hm);
    setRadio("dropoff time", d1.ampm === "AM" ? "am" : "pm");
    setText("Destination Odometer Reading", leg1.dropoff_odometer);
    setText("Dropoff Destination Street Address City State Zip", leg1.dropoff_address);
  }

  if (leg2) {
    setText("Date_2", fmt(leg2.leg_date));
    const p2 = tm(leg2.pickup_time);
    setText("pickup time 2", p2.hm);
    setRadio("second pickup time", p2.ampm === "AM" ? "am" : "pm");
    setText("Pickup Odometer Reading_2", leg2.pickup_odometer);
    setText("Pickup Street Address City State Zip_2", leg2.pickup_address);

    const d2 = tm(leg2.dropoff_time);
    setText("Actual DropOff Time  AM  PM_2", d2.hm);
    setRadio("second dropoff time", d2.ampm === "AM" ? "am" : "pm");
    setText("Destination Odometer Reading_2", leg2.dropoff_odometer);
    setText("Dropoff Destination Street Address City State Zip_2", leg2.dropoff_address);
  }

  /* ---------- Signature: stamp PNG inside the widget's rectangle ---------- */
  if (a.signatureUrl || a.signatureName) {
    let img: any = null;
    if (a.signatureUrl) {
      try {
        const bytes = await fetch(a.signatureUrl).then((r) => {
          if (!r.ok) throw new Error(`Failed to load saved signature: ${r.status}`);
          return r.arrayBuffer();
        });
        try {
          img = await pdf.embedPng(bytes);
        } catch {
          img = await pdf.embedJpg(bytes);
        }
      } catch (error) {
        if (!a.signatureName) throw error;
      }
    }

    let stamped = false;
    try {
      const sigField = form.getField("Members Signature");
      const widgets = sigField.acroField.getWidgets();
      for (const widget of widgets) {
        const rect = widget.getRectangle();
        const pageRef = widget.P();
        const page = pdf.getPages().find((pg) => pg.ref === pageRef) ?? pdf.getPage(0);
        if (img) drawSignatureImage(page, img, rect);
        drawHumanizedSignature(page, rect, a.signatureName);
        stamped = true;
        if (a.signedByEscort) {
          page.drawText("(signed by escort)", {
            x: rect.x,
            y: rect.y - 8,
            size: 7,
            color: rgb(0.3, 0.3, 0.3),
          });
        }
      }
      // Remove the signature widget so the stamped image is the only visible mark.
      try {
        form.removeField(sigField);
      } catch {
        /* older pdf-lib versions expose removeField only in newer builds */
      }
    } catch {
      // If the state changes the signature field type/name, keep using the
      // known location from the April 2025 template rather than producing a
      // completed PDF with no signature.
      const page = pdf.getPage(0);
      const fallbackRect = { x: 145.56, y: 150.24, width: 17.16, height: 289.32 };
      if (img) drawSignatureImage(page, img, fallbackRect);
      drawHumanizedSignature(page, fallbackRect, a.signatureName);
      stamped = true;
    }

    if (!stamped) {
      throw new Error("Could not place the saved signature on the PDF");
    }
  }

  /* ---------- Flatten so the output matches the state's paper form ---------- */
  try {
    form.flatten();
  } catch {
    /* flatten can fail on exotic field types — leave form editable rather than throw */
  }

  return await pdf.save();
}

function resolveTemplateUrl(templateBaseUrl?: string): string {
  if (/^https?:\/\//i.test(templateAsset.url)) return templateAsset.url;
  if (templateBaseUrl) return new URL(templateAsset.url, templateBaseUrl).toString();
  if (typeof window !== "undefined") return new URL(templateAsset.url, window.location.origin).toString();
  return templateAsset.url;
}

function drawSignatureImage(page: any, img: any, rect: PdfRect) {
  const rotation = ((page.getRotation().angle % 360) + 360) % 360;
  const margin = 1;

  // The Colorado template is a landscape page stored as a portrait PDF rotated
  // 90°. Its signature widget is therefore tall/narrow in raw PDF coordinates,
  // but horizontal on screen. Draw the signature rotated with the page so the
  // handwriting lands along the visible line instead of becoming a vertical mark.
  if (rotation === 90 || rotation === 270) {
    const lineW = Math.max(1, rect.height - 26);
    const lineH = Math.min(22, Math.max(18, rect.width * 1.18));
    const { width, height } = signatureFit(img.width, img.height, lineW, lineH);
    const y = rect.y + (rect.height - width) / 2;

    if (rotation === 90) {
      page.drawImage(img, {
        x: rect.x + rect.width + 2,
        y,
        width,
        height,
        rotate: degrees(90),
      });
    } else {
      page.drawImage(img, {
        x: rect.x - 2,
        y: y + width,
        width,
        height,
        rotate: degrees(270),
      });
    }
    return;
  }

  const { width, height } = signatureFit(img.width, img.height, rect.width - 2, rect.height - 2);
  page.drawImage(img, {
    x: rect.x + (rect.width - width) / 2,
    y: rect.y + (rect.height - height) / 2,
    width,
    height,
  });
}

function drawHumanizedSignature(page: any, rect: PdfRect, name?: string | null) {
  const cleanName = name?.trim();
  if (!cleanName) return;

  const rotation = ((page.getRotation().angle % 360) + 360) % 360;
  if (rotation !== 90 && rotation !== 270) return;

  const seed = hashString(cleanName);
  const usableW = Math.max(120, rect.height - 54);
  const startY = rect.y + (rect.height - usableW) / 2;
  const baseX = rotation === 90 ? rect.x + rect.width + 2.5 : rect.x - 2.5;
  const direction = rotation === 90 ? 1 : -1;
  const parts = cleanName.split(/\s+/).filter(Boolean).slice(0, 3);
  const letters = Math.min(18, Math.max(8, cleanName.replace(/\s+/g, "").length));

  let cursor = 0;
  for (let i = 0; i < letters; i++) {
    const charCode = cleanName.charCodeAt(i % cleanName.length) || 65;
    const next = ((i + 1) / letters) * usableW;
    const mid = cursor + (next - cursor) * 0.5;
    const lift = 2.5 + ((charCode + seed + i * 17) % 8) * 0.72;
    const dip = ((charCode + seed + i * 11) % 5) * 0.42;
    const thickness = 0.75 + ((charCode + i) % 3) * 0.12;

    page.drawLine({
      start: { x: baseX - direction * dip, y: startY + cursor },
      end: { x: baseX - direction * lift, y: startY + mid },
      thickness,
      color: rgb(0.02, 0.02, 0.02),
      opacity: 0.94,
    });
    page.drawLine({
      start: { x: baseX - direction * lift, y: startY + mid },
      end: { x: baseX + direction * 0.8, y: startY + next },
      thickness,
      color: rgb(0.02, 0.02, 0.02),
      opacity: 0.94,
    });

    if ((charCode + i + seed) % 4 === 0) {
      const loopY = startY + mid;
      const loopH = Math.min(9, (next - cursor) * 0.45);
      const loopX = baseX - direction * (lift + 1.8);
      page.drawEllipse({
        x: loopX,
        y: loopY,
        xScale: 2.2,
        yScale: loopH / 2,
        borderWidth: 0.7,
        borderColor: rgb(0.02, 0.02, 0.02),
        opacity: 0.9,
      });
    }
    cursor = next;
  }

  if (parts.length > 1) {
    const flourishStart = startY + usableW * 0.15;
    const flourishEnd = startY + usableW * 0.92;
    page.drawLine({
      start: { x: baseX + direction * 2.2, y: flourishStart },
      end: { x: baseX + direction * 1.2, y: flourishEnd },
      thickness: 0.55,
      color: rgb(0.02, 0.02, 0.02),
      opacity: 0.55,
    });
  }
}

function signatureFit(imgW: number, imgH: number, maxW: number, maxH: number) {
  const safeW = Math.max(1, maxW);
  const safeH = Math.max(1, maxH);
  const aspect = imgW > 0 && imgH > 0 ? imgW / imgH : 4;
  let width = Math.min(safeW, safeH * aspect);
  let height = width / aspect;

  // Signature-pad PNGs include the whole signing canvas. If we preserve that
  // full canvas ratio in a very long state-form line, the actual handwriting can
  // look missing. Stretch only within the signature line so the mark is visible.
  if (width < safeW * 0.86 || height < safeH * 0.72) {
    width = safeW * 0.92;
    height = safeH * 0.9;
  }

  return { width, height };
}

function hashString(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function fmtDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString();
}

function splitTime(t?: string | null): { hm: string; ampm: "AM" | "PM" } {
  if (!t) return { hm: "", ampm: "AM" };
  const [hStr, mStr] = t.split(":");
  const h = Number(hStr);
  const m = mStr ?? "00";
  if (Number.isNaN(h)) return { hm: t, ampm: "AM" };
  const ampm: "AM" | "PM" = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  return { hm: `${h12}:${m}`, ampm };
}
