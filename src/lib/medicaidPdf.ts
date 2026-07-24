import { degrees, PDFDocument, PDFTextField, rgb, StandardFonts } from "pdf-lib";
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
  const handwritingFont = await pdf.embedFont(StandardFonts.HelveticaOblique);
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
  if (typeof a.identityVerified === "boolean") {
    setRadio("driver verify member identity", a.identityVerified ? "yes" : "no");
  }
  setRadio("type of vehicle", vehicleRadioValue(a.vehicleType));
  setRadio("type of trip", tripKindRadioValue(a.tripKind));
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
  if (a.signatureUrl) {
    const bytes = await fetch(a.signatureUrl).then((r) => {
      if (!r.ok) throw new Error(`Failed to load saved signature: ${r.status}`);
      return r.arrayBuffer();
    });
    let img;
    try {
      img = await pdf.embedPng(bytes);
    } catch {
      img = await pdf.embedJpg(bytes);
    }

    let stamped = false;
    try {
      const sigField = form.getField("Members Signature");
      const widgets = sigField.acroField.getWidgets();
      // The state template repeats the signature widget for each leg. The
      // driver only captures a single signature, so stamp it once (on the
      // first widget) rather than duplicating the same signature across
      // every widget on the page.
      const widget = widgets[0];
      if (widget) {
        const rect = widget.getRectangle();
        const pageRef = widget.P();
        const page = pdf.getPages().find((pg) => pg.ref === pageRef) ?? pdf.getPage(0);
        drawSignatureImage(page, img, rect);
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
      // Remove the signature widget(s) so the stamped image is the only visible mark.
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
      drawSignatureImage(page, img, fallbackRect);
      stamped = true;
    }

    if (!stamped) {
      throw new Error("Could not place the saved signature on the PDF");
    }
  }

  /* ---------- Render filled values as blue ballpoint handwriting ---------- */
  const INK = rgb(0.09, 0.15, 0.55); // ballpoint blue
  const HANDWRITING_SIZE = 18;
  try {
    // The two "Date" widgets share the top line of their leg box with the
    // printed "Date:" label. Anchor them to the top of the widget rect rather
    // than vertically centering, so the value sits on the underline next to
    // "Date:" instead of drifting toward the middle of the tall cell.
    const TOP_ALIGNED_FIELDS = new Set(["Date", "Date_2"]);
    for (const field of form.getFields()) {
      if (!(field instanceof PDFTextField)) continue;
      const value = field.getText();
      if (!value) continue;
      const alignTop = TOP_ALIGNED_FIELDS.has(field.getName());
      const widgets = field.acroField.getWidgets();
      for (const widget of widgets) {
        const rect = widget.getRectangle();
        const pageRef = widget.P();
        const page =
          pdf.getPages().find((pg) => pg.ref === pageRef) ?? pdf.getPage(0);
        drawHandwrittenValue(page, value, rect, handwritingFont, HANDWRITING_SIZE, INK, alignTop);
      }
      // Clear the field value so the subsequent flatten() does not re-render
      // the same text through the widget's default appearance stream and
      // produce a doubled/offset ghost of the value on the page.
      try {
        field.setText("");
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* fall through to flatten */
  }


  try {
    form.flatten();
  } catch {
    /* flatten can fail on exotic field types — leave form editable rather than throw */
  }



  return await pdf.save();
}

function resolveTemplateUrl(templateBaseUrl?: string): string {
  return resolveAssetUrl(templateAsset.url, templateBaseUrl);
}

function resolveAssetUrl(url: string, baseUrl?: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  if (baseUrl) return new URL(url, baseUrl).toString();
  if (typeof window !== "undefined") return new URL(url, window.location.origin).toString();
  return url;
}


function drawHandwrittenValue(
  page: any,
  value: string,
  rect: PdfRect,
  font: any,
  size: number,
  color: ReturnType<typeof rgb>,
  alignTop = false,
) {
  const rotation = ((page.getRotation().angle % 360) + 360) % 360;
  // Fit size to the smaller field dimension so long values still land inside.
  const availAlong = rotation === 90 || rotation === 270 ? rect.height : rect.width;
  const availAcross = rotation === 90 || rotation === 270 ? rect.width : rect.height;
  let fs = size;
  const padding = 3;
  const maxTextWidth = Math.max(1, availAlong - padding * 2);
  // Shrink if it overflows the line
  let textWidth = font.widthOfTextAtSize(value, fs);
  while (textWidth > maxTextWidth && fs > 6) {
    fs -= 1;
    textWidth = font.widthOfTextAtSize(value, fs);
  }
  // Vertical: either hug the top visible line (fields whose label sits above
  // the value on the same line, like "Date:") or center within the cell.
  const ascent = font.heightAtSize(fs, { descender: false });
  // Extra upward lift for top-aligned fields (Date on Box 1/Box 2) so the value
  // snaps flush next to "Date:" and clears the "Actual Pick-up Time:" row below.
  const TOP_EXTRA_LIFT = -18;
  const acrossOffset = alignTop
    ? Math.max(1, availAcross - ascent - padding + TOP_EXTRA_LIFT)
    : Math.max(1, (availAcross - ascent) / 2);

  if (rotation === 90) {
    page.drawText(value, {
      x: rect.x + rect.width - acrossOffset,
      y: rect.y + padding,
      size: fs,
      font,
      color,
      rotate: degrees(90),
    });
  } else if (rotation === 270) {
    page.drawText(value, {
      x: rect.x + acrossOffset,
      y: rect.y + rect.height - padding,
      size: fs,
      font,
      color,
      rotate: degrees(270),
    });
  } else {
    page.drawText(value, {
      x: rect.x + padding,
      y: rect.y + acrossOffset,
      size: fs,
      font,
      color,
    });
  }
}

function drawSignatureImage(page: any, img: any, rect: PdfRect) {
  const rotation = ((page.getRotation().angle % 360) + 360) % 360;

  const inset = 2;

  // The Colorado template is a landscape page stored as a portrait PDF rotated
  // 90°. Its signature widget is therefore tall/narrow in raw PDF coordinates,
  // but horizontal on screen. Draw the signature rotated with the page so the
  // handwriting lands along the visible line instead of becoming a vertical mark.
  if (rotation === 90 || rotation === 270) {
    const lineW = Math.max(1, rect.height - inset * 2);
    const lineH = Math.max(1, rect.width * 1.45);
    const { width, height } = signatureFit(img.width, img.height, lineW, lineH);
    const centeredAlongLine = rect.y + (rect.height - width) / 2;

    if (rotation === 90) {
      // With a 90° draw rotation, the rendered image occupies raw bounds:
      // x - height ... x, and y ... y + width. The x value is the rendered
      // bottom edge, so pin it to the field baseline instead of centering it.
      page.drawImage(img, {
        x: rect.x + rect.width + 3,
        y: centeredAlongLine,
        width,
        height,
        rotate: degrees(90),
      });
    } else {
      // With a 270° draw rotation, the rendered image occupies raw bounds:
      // x ... x + height, and y - width ... y. The right edge is the baseline.
      page.drawImage(img, {
        x: rect.x - 3 - height,
        y: centeredAlongLine + width,
        width,
        height,
        rotate: degrees(270),
      });
    }
    return;
  }

  const { width, height } = signatureFit(
    img.width,
    img.height,
    rect.width - inset * 2,
    rect.height - inset * 2,
  );
  page.drawImage(img, {
    x: rect.x + (rect.width - width) / 2,
    y: rect.y + inset,
    width,
    height,
  });
}

function signatureFit(imgW: number, imgH: number, maxW: number, maxH: number) {
  const safeW = Math.max(1, maxW);
  const safeH = Math.max(1, maxH);
  const sourceW = imgW > 0 ? imgW : safeW;
  const sourceH = imgH > 0 ? imgH : safeH;
  const scale = Math.min(safeW / sourceW, safeH / sourceH);
  const width = sourceW * scale;
  const height = sourceH * scale;

  return { width, height };
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

function vehicleRadioValue(v?: string | null): string | null {
  switch (v) {
    case "ground_ambulance":
      return "ground ambulance";
    case "wheelchair_van":
      return "wheelchair van";
    case "stretcher_van":
      return "stretcher van";
    case "taxi":
      return "taxi";
    case "ambulatory":
      return "Mobility/Ambulatory vehicle";
    default:
      return null;
  }
}

function tripKindRadioValue(v?: string | null): string | null {
  switch (v) {
    case "one_way":
      return "one way";
    case "round_trip":
      return "round trip";
    default:
      return null;
  }
}
