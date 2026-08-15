/**
 * Automatic READ-ONLY portal identity check for paper bills.
 *
 * Runs the same `verify_member` robot lookup the manual "Verify Medicaid ID"
 * button uses, but as a hard gate: a paper bill only becomes a real trip
 * (eligible for claim submission) when the portal's name for the entered
 * Medicaid ID matches the name written on the paper form exactly.
 *
 * It NEVER guesses or auto-corrects an ID (S vs 5, 0 vs O, ...). Anything
 * short of an exact match is reported verbatim for a human to resolve.
 */

export class PaperBillVerificationError extends Error {
  readonly kind: "mismatch" | "unavailable";
  readonly portalName: string | null;
  constructor(message: string, kind: "mismatch" | "unavailable", portalName: string | null) {
    super(message);
    this.name = "PaperBillVerificationError";
    this.kind = kind;
    this.portalName = portalName;
  }
}

/** Placeholder IDs are internal, never real state member IDs. */
export function isRealMedicaidId(raw: string | null | undefined): boolean {
  const v = (raw ?? "").trim();
  return (
    !!v && !v.startsWith("SELF-") && !v.startsWith("WALK-") && !v.startsWith("SSN-")
  );
}

/**
 * Throws `PaperBillVerificationError` unless the portal confirms an exact
 * name match for this Medicaid ID.
 */
export async function assertPaperBillIdentity(args: {
  supabaseAdmin: { from: (t: string) => any };
  userId: string;
  medicaidId: string;
  paperName: string;
  /** Company whose portal login the robot must use. */
  companyId?: string | null;
}): Promise<{ portal_name: string | null }> {
  const medicaidId = args.medicaidId.trim();
  const paperName = args.paperName.trim();

  if (!isRealMedicaidId(medicaidId)) {
    throw new PaperBillVerificationError(
      `"${medicaidId}" is not a valid Medicaid member ID. Correct the ID on this paper bill before continuing.`,
      "mismatch",
      null,
    );
  }
  if (!paperName) {
    throw new PaperBillVerificationError(
      "No passenger name was read from the paper report — enter the member's name so the ID can be verified against the portal.",
      "mismatch",
      null,
    );
  }

  const { callVerifyRobot, getRobotApiKey, resolveProviderContext } = await import(
    "@/lib/medicaidVerify.server"
  );

  const provider = await resolveProviderContext(args.supabaseAdmin, args.userId);

  const result = await callVerifyRobot({
    providerUserId: provider.providerUserId,
    companyId: args.companyId ?? provider.companyId,
    expectedName: paperName,
    memberId: medicaidId,
    ssn: null,
    dateOfBirth: null,
    usedIdentifier: "medicaid_id",
    apiKey: await getRobotApiKey(args.supabaseAdmin),
  });


  if (result.status === "matched") {
    return { portal_name: result.portal_name ?? null };
  }

  if (result.status === "fuzzy" || result.status === "no_match") {
    const portal = result.portal_name?.trim();
    const shows = portal ? `"${portal}"` : "no member with that name";
    throw new PaperBillVerificationError(
      `Medicaid ID not verified. Portal shows ${shows} for ID ${medicaidId}, but the paper says "${paperName}" — please verify and correct the Medicaid ID before continuing. Nothing was created or queued for submission.`,
      "mismatch",
      portal ?? null,
    );
  }

  // unconfigured / error / anything else: we cannot prove the ID is right, so
  // the bill must not reach the portal.
  throw new PaperBillVerificationError(
    `Medicaid ID could not be verified against the portal right now (${result.message}). The bill was NOT created — try again in a moment.`,
    "unavailable",
    null,
  );
}
