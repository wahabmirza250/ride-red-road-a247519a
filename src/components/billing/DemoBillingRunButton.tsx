import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { simulateDemoPortal } from "@/lib/demoPortal.functions";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
export function DemoBillingRunButton({ ids, payment = false }: { ids?: string[]; payment?: boolean }) {
  const run = useServerFn(simulateDemoPortal);
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => run({ data: { ids, action: payment ? "payment" : "submit" } }),
    onSuccess: () => {
      toast.success(payment ? "Sample payment received" : "Demo claims submitted successfully");
      for (const key of ["billing_list", "billing_counts", "billing_detail", "edi"]) void qc.invalidateQueries({ queryKey: [key] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>{mutation.isPending ? "Processing…" : payment ? "Show payment received" : "Run billing demo"}</Button>;
}
