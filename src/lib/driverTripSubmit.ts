/**
 * Final hand-off of a driver self-created trip to billing.
 *
 * Extracted so both the create/complete surfaces share ONE implementation and
 * the billing/PDF contract stays identical: `createNemtTripGroup` receives the
 * exact payload from `buildCreateTripPayload`, then each rider gets a stored
 * signature plus the generated signed state form PDF.
 */
import { supabase } from "@/lib/supabaseBrowser";
import {
  createNemtTripGroup,
  attachRiderSignature,
  attachStatePdf,
} from "@/lib/nemtTrip.functions";
import { getRiderIdentifierForPdf } from "@/lib/rider.functions";
import { generateStateFormPdf } from "@/lib/medicaidPdf";
import {
  buildCreateTripPayload,
  buildPdfArgs,
  type DraftRider,
  type DriverTripDraft,
} from "@/lib/driverTripDraft";

export type GeneratedPdf = {
  rider_name: string;
  url: string;
  filename: string;
  trip_id: string;
};

export type SubmitResult = {
  pdfs: GeneratedPdf[];
  tripIds: string[];
  /** Human-readable notes about paperwork steps that did not complete. */
  warnings: string[];
};

/**
 * The trip itself is the only step that must succeed: once the rows exist the
 * work is recorded for billing. Signature/PDF paperwork is retried separately
 * and never blocks the driver from closing the trip, and already-created trip
 * ids are reused so a retry can never duplicate the trip.
 */
export async function submitDriverTripToBilling(opts: {
  draft: DriverTripDraft;
  userId: string;
  driverFallbackName: string;
  onStage?: (stage: string) => void;
  existingTripIds?: string[] | null;
  onTripsCreated?: (ids: string[]) => void;
}): Promise<SubmitResult> {
  const { draft, userId, driverFallbackName, onStage, existingTripIds, onTripsCreated } = opts;

  let tripIds = existingTripIds ?? [];
  if (tripIds.length !== draft.rider_slots.length) {
    onStage?.("Creating trip…");
    const res: any = await createNemtTripGroup({ data: buildCreateTripPayload(draft) as any });
    tripIds = (res?.trip_ids ?? []) as string[];
    onTripsCreated?.(tripIds);
  }

  const generated: GeneratedPdf[] = [];
  const warnings: string[] = [];

  for (let i = 0; i < draft.rider_slots.length; i++) {
    const slot = draft.rider_slots[i];
    const newTripId = tripIds[i];
    if (!newTripId) continue;

    try {
      onStage?.(`Saving signature for ${slot.rider.full_name}…`);
      const png = await (await fetch(slot.signature_data_url!)).blob();
      const sigPath = `${userId}/${newTripId}.png`;
      const sigUp = await supabase.storage
        .from("signatures")
        .upload(sigPath, png, { upsert: true, contentType: "image/png" });
      if (sigUp.error) throw sigUp.error;
      await attachRiderSignature({
        data: { trip_id: newTripId, signature_path: sigPath, signature_name: slot.signer_name },
      });
    } catch (e) {
      warnings.push(`Signature for ${slot.rider.full_name} could not be saved`);
      console.warn("[driverTripSubmit] signature failed", e);
    }

    try {
      onStage?.(`Generating state form for ${slot.rider.full_name}…`);
      let riderOverride: DraftRider | undefined;
      try {
        const { identifier } = await getRiderIdentifierForPdf({
          data: { rider_id: slot.rider.id, trip_id: newTripId },
        });
        if (identifier) riderOverride = { ...slot.rider, medicaid_id: identifier };
      } catch {
        /* fall back to the rider row identifier */
      }
      const pdfBytes = await generateStateFormPdf(
        buildPdfArgs(draft, slot, {
          driverName: draft.driver_full_name || driverFallbackName,
          riderOverride,
        }) as any,
      );

      const pdfPath = `${userId}/${newTripId}.pdf`;
      const pdfBlob = new Blob([pdfBytes as BlobPart], { type: "application/pdf" });
      const pdfUp = await supabase.storage
        .from("state-pdfs")
        .upload(pdfPath, pdfBlob, { upsert: true, contentType: "application/pdf" });
      if (pdfUp.error) throw pdfUp.error;
      await attachPdf(newTripId, pdfPath);

      const { data: signed } = await supabase.storage
        .from("state-pdfs")
        .createSignedUrl(pdfPath, 60 * 15);
      if (signed?.signedUrl) {
        generated.push({
          rider_name: slot.rider.full_name,
          url: signed.signedUrl,
          trip_id: newTripId,
          filename: `nemt-${slot.rider.full_name.replace(/\s+/g, "_")}-${newTripId.slice(0, 8)}.pdf`,
        });
      }
    } catch (e) {
      warnings.push(`State form for ${slot.rider.full_name} could not be generated`);
      console.warn("[driverTripSubmit] pdf failed", e);
    }
  }

  return { pdfs: generated, tripIds, warnings };
}

async function attachPdf(tripId: string, path: string) {
  await attachStatePdf({ data: { trip_id: tripId, state_pdf_path: path } });
}

export async function downloadPdf(url: string, filename: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
}
