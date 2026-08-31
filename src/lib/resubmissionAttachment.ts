/**
 * ATTACHMENT RULES FOR RESUBMISSION DRAFTS (pure, shared by UI + tests).
 *
 * A draft attachment is always a NEW object written under the draft's own
 * prefix. The original trip's `state_pdf_path` is never overwritten, moved or
 * deleted: replacing a draft attachment only rewrites the path stored in
 * `draft_snapshot.state_pdf_path`.
 */

export const ATTACHMENT_BUCKET = "state-pdfs";
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024; // 20 MB

export const ALLOWED_ATTACHMENT_MIME = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
] as const;

const EXT_OF: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};

export function validateAttachment(file: { type?: string; size?: number; name?: string }): {
  ok: boolean;
  reason: string;
} {
  const mime = String(file?.type ?? "").toLowerCase();
  if (!(ALLOWED_ATTACHMENT_MIME as readonly string[]).includes(mime))
    return { ok: false, reason: "Only PDF, JPEG, PNG, WEBP or HEIC files can be attached." };
  const size = Number(file?.size ?? 0);
  if (!size) return { ok: false, reason: "That file is empty." };
  if (size > MAX_ATTACHMENT_BYTES)
    return { ok: false, reason: "That file is larger than the 20 MB limit." };
  return { ok: true, reason: "" };
}

/**
 * Draft-scoped, collision-free storage path. It always lives under the
 * uploader's own folder (matching the existing paper-inbox storage policies)
 * and inside a `resubmissions/<draft id>/` prefix that no original trip uses.
 */
export function attachmentPath(args: {
  userId: string;
  resubmissionId: string;
  mime: string;
  now?: number;
}): string {
  const ext = EXT_OF[String(args.mime).toLowerCase()] ?? "bin";
  const stamp = args.now ?? Date.now();
  return `${args.userId}/resubmissions/${args.resubmissionId}/${stamp}.${ext}`;
}

/** True when a path belongs to a resubmission draft rather than the original trip. */
export function isDraftAttachmentPath(path: string | null | undefined): boolean {
  return /\/resubmissions\//.test(String(path ?? ""));
}

/**
 * The complete set of storage paths a resubmission draft is allowed to read.
 *
 * Legacy drafts (created before snapshots existed) carry a null
 * `state_pdf_path` in BOTH snapshots while the untouched original trip still
 * has one — the editor shows that derived original, so signing must accept it.
 * Nothing outside these three references can ever be signed.
 */
export function allowedAttachmentPaths(args: {
  draftPath?: string | null;
  originalSnapshotPath?: string | null;
  originalTripPath?: string | null;
}): Set<string> {
  return new Set(
    [args.draftPath, args.originalSnapshotPath, args.originalTripPath]
      .map((p) => (typeof p === "string" ? p.trim() : ""))
      .filter(Boolean),
  );
}

export function isAllowedAttachmentPath(
  path: string,
  args: Parameters<typeof allowedAttachmentPaths>[0],
): boolean {
  return allowedAttachmentPaths(args).has(String(path ?? "").trim());
}

/** Rough media kind for preview rendering. */
export function attachmentKind(path: string | null | undefined): "pdf" | "image" | "other" {
  const ext = String(path ?? "").split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "pdf";
  if (["jpg", "jpeg", "png", "webp", "heic", "gif"].includes(ext)) return "image";
  return "other";
}

