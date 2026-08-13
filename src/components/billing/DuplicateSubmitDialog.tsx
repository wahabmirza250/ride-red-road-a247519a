import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { duplicateWarningText, type DuplicateClaimInfo } from "@/lib/duplicateSubmit";

/**
 * Deliberate-resubmission warning. This is real friction, not a rubber stamp:
 * the biller must read the existing claim number/status and explicitly choose
 * "Continue anyway" before a second portal submission is attempted.
 */
export function DuplicateSubmitDialog({
  info,
  onCancel,
  onConfirm,
  busy,
}: {
  info: DuplicateClaimInfo | null;
  onCancel: () => void;
  onConfirm: () => void;
  busy?: boolean;
}) {
  return (
    <AlertDialog open={!!info} onOpenChange={(o) => (!o ? onCancel() : null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Already submitted — possible duplicate</AlertDialogTitle>
          <AlertDialogDescription>
            {info ? duplicateWarningText(info) : null}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
          Only continue if this claim needs to be corrected or re-filed. The
          resubmission is recorded in the billing audit trail with the previous claim
          number and your account.
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
          >
            Continue anyway
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
