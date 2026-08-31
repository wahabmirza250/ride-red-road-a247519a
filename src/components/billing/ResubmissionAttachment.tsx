import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Download, Eye, Loader2, Paperclip, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import {
  ALLOWED_ATTACHMENT_MIME,
  ATTACHMENT_BUCKET,
  attachmentPath,
  validateAttachment,
} from "@/lib/resubmissionAttachment";
import {
  getResubmissionAttachmentUrl,
  setResubmissionAttachment,
} from "@/lib/resubmission.functions";

/**
 * Supporting document for a resubmission DRAFT.
 *
 * Uploads land in the authenticated `state-pdfs` bucket under
 * `<user>/resubmissions/<draft id>/…` — a prefix no original trip uses — so
 * attaching or replacing here can never overwrite or delete the original trip
 * report. Only the resulting storage path is stored in the draft snapshot.
 */
export function ResubmissionAttachment({
  resubmissionId,
  path,
  originalPath,
  disabled,
  onChange,
  onViewInline,
}: {
  resubmissionId: string;
  path: string | null;
  originalPath: string | null;
  disabled?: boolean;
  onChange: (path: string | null) => void;
  /** Scrolls/focuses the inline preview at the end of the editor. */
  onViewInline?: () => void;
}) {
  const signFn = useServerFn(getResubmissionAttachmentUrl);
  const setFn = useServerFn(setResubmissionAttachment);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const isOriginal = !!path && path === originalPath;
  const fileName = path ? path.split("/").pop() : null;


  async function open(download: boolean) {
    if (!path) return;
    setBusy(true);
    try {
      const res: any = await signFn({ data: { id: resubmissionId, path } });
      if (!res?.url) {
        toast.message("That attachment is no longer available.");
        return;
      }
      if (download) {
        const a = document.createElement("a");
        a.href = res.url;
        a.download = fileName ?? "attachment";
        a.click();
      } else {
        window.open(res.url, "_blank", "noopener");
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Could not open that attachment.");
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File) {
    const check = validateAttachment(file);
    if (!check.ok) {
      toast.error(check.reason);
      return;
    }
    setBusy(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) throw new Error("Your session expired — sign in again.");
      const target = attachmentPath({ userId: uid, resubmissionId, mime: file.type });
      const { error } = await supabase.storage
        .from(ATTACHMENT_BUCKET)
        .upload(target, file, { upsert: false, contentType: file.type });
      if (error) throw new Error(error.message);
      await setFn({ data: { id: resubmissionId, path: target, file_name: file.name } });
      onChange(target);
      toast.success("Attachment saved to this draft — the original trip report is untouched.");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not attach that file.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-2 rounded-xl border p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Paperclip className="h-4 w-4 text-muted-foreground" />
        {path ? (
          <>
            <span className="max-w-[240px] truncate font-medium">{fileName}</span>
            <Badge variant={isOriginal ? "secondary" : "default"}>
              {isOriginal ? "Original trip report" : "Draft attachment"}
            </Badge>
          </>
        ) : (
          <span className="text-muted-foreground">No supporting document attached.</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!path || busy}
          onClick={() => (onViewInline ? onViewInline() : void open(false))}
        >
          <Eye className="mr-1.5 h-3.5 w-3.5" /> View
        </Button>
        <Button size="sm" variant="outline" disabled={!path || busy} onClick={() => open(false)}>
          <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Open in new tab
        </Button>
        <Button size="sm" variant="outline" disabled={!path || busy} onClick={() => open(true)}>
          <Download className="mr-1.5 h-3.5 w-3.5" /> Download
        </Button>

        <Button
          size="sm"
          variant="secondary"
          disabled={disabled || busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Upload className="mr-1.5 h-3.5 w-3.5" />
          )}
          {path ? "Replace" : "Attach"} document
        </Button>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept={ALLOWED_ATTACHMENT_MIME.join(",")}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
          }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        PDF or image, up to 20 MB. Replacing here only changes this draft — the original trip's
        stored report is never overwritten or deleted.
      </p>
    </div>
  );
}
