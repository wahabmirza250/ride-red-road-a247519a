import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CheckCircle2, Circle, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PortalCredentialsCard } from "@/components/billing/PortalCredentialsCard";
import { BillingRatesCard } from "@/components/billing/BillingRatesCard";
import {
  getBillingSetupStatus,
  listProviderCandidates,
  setBillingProvider,
} from "@/lib/billingSetup.functions";
import {
  pickDefaultProvider,
  RATE_SUGGESTIONS,
  submissionBlockedReason,
  type ProviderCandidate,
} from "@/lib/billingSetup";

/**
 * Billing Setup wizard. Rendered INSIDE Billing whenever a company is not
 * fully configured — a company must never hit a "provider required" dead end
 * it cannot resolve from the page it is looking at.
 *
 * Financial amounts are never prefilled from another company. Procedure/POS
 * codes are shown as suggestions only and are saved solely by the rate editor
 * once the user confirms them.
 */
export function BillingSetupPanel({ compact = false }: { compact?: boolean }) {
  const qc = useQueryClient();
  const statusFn = useServerFn(getBillingSetupStatus);
  const candidatesFn = useServerFn(listProviderCandidates);
  const saveProviderFn = useServerFn(setBillingProvider);

  const status = useQuery({
    queryKey: ["billing_setup_status"],
    queryFn: () => statusFn() as any,
  });
  const candidates = useQuery({
    queryKey: ["billing_provider_candidates"],
    queryFn: () => candidatesFn() as Promise<ProviderCandidate[]>,
  });

  const [provider, setProvider] = useState<string>("");

  const list = useMemo(() => candidates.data ?? [], [candidates.data]);
  useEffect(() => {
    const preselect = pickDefaultProvider(list, status.data?.default_provider_id ?? null);
    if (preselect) setProvider((p) => p || preselect);
  }, [list, status.data?.default_provider_id]);

  const save = useMutation({
    mutationFn: (id: string) => saveProviderFn({ data: { provider_id: id } }) as any,
    onSuccess: () => {
      toast.success("Billing provider saved");
      void qc.invalidateQueries({ queryKey: ["billing_setup_status"] });
      void qc.invalidateQueries({ queryKey: ["billing_settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (status.isLoading) {
    return (
      <div className="flex justify-center rounded-2xl border border-border bg-surface p-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const s = status.data;
  if (!s) return null;
  if (s.ready && compact) return null;

  const blocked = submissionBlockedReason(s);

  return (
    <section className="space-y-4 rounded-2xl border border-border bg-surface p-4 shadow-soft">
      <header className="space-y-1">
        <h2 className="text-base font-semibold">Billing setup</h2>
        <p className="text-sm text-muted-foreground">
          Finish these steps to turn on claim submission for this company. You can browse the
          workspace at any time — nothing is submitted until every step is done.
        </p>
      </header>

      <ol className="grid gap-2 sm:grid-cols-3">
        {s.steps.map((step: any, i: number) => (
          <li
            key={step.key}
            className="rounded-xl border border-border bg-background/50 p-3 text-sm"
          >
            <div className="flex items-center gap-2 font-medium">
              {step.done ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              ) : (
                <Circle className="h-4 w-4 text-muted-foreground" />
              )}
              <span>
                {i + 1}. {step.title}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{step.detail}</p>
          </li>
        ))}
      </ol>

      {blocked && (
        <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
          {blocked}
        </p>
      )}

      {/* Step 1 — Provider */}
      <div className="space-y-2 rounded-xl border border-border p-3">
        <Label>Step 1 · Billing provider</Label>
        <p className="text-xs text-muted-foreground">
          Only active admin and billing users of this company can be the provider.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Select value={provider} onValueChange={setProvider}>
            <SelectTrigger className="sm:max-w-sm">
              <SelectValue placeholder={list.length ? "Choose a provider" : "No eligible users"} />
            </SelectTrigger>
            <SelectContent>
              {list.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                  {c.email ? ` · ${c.email}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            onClick={() => provider && save.mutate(provider)}
            disabled={!provider || save.isPending || provider === s.default_provider_id}
          >
            {save.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {s.default_provider_id ? "Update provider" : "Save provider"}
          </Button>
        </div>
        {!list.length && (
          <p className="text-xs text-destructive">
            No eligible user found. Add an admin or billing user to this company first.
          </p>
        )}
      </div>

      {/* Step 2 — Portal credentials */}
      <div className="space-y-2 rounded-xl border border-border p-3">
        <Label>Step 2 · State portal login</Label>
        <p className="text-xs text-muted-foreground">
          Add this company&apos;s own Colorado HCPF login. The password is stored securely and is
          never displayed again — use Verify to confirm it was saved correctly.
        </p>
        <PortalCredentialsCard />
      </div>

      {/* Step 3 — Rates */}
      <div className="space-y-2 rounded-xl border border-border p-3">
        <Label>Step 3 · Trip and mileage rates</Label>
        <p className="text-xs text-muted-foreground">
          Enter your own contracted amounts. Suggested codes:{" "}
          {RATE_SUGGESTIONS.trip_procedure_code} (trip),{" "}
          {RATE_SUGGESTIONS.mile_procedure_code} (mile), POS{" "}
          {RATE_SUGGESTIONS.trip_place_of_service}, diagnosis{" "}
          {RATE_SUGGESTIONS.diagnosis_code}. Amounts are never prefilled or copied.
        </p>
        <BillingRatesCard />
      </div>

      {/* Step 4 — Verify */}
      <div className="space-y-2 rounded-xl border border-border p-3">
        <Label>Step 4 · Verify</Label>
        <div className="flex items-center gap-2 text-sm">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          {s.ready ? (
            <span className="text-emerald-600">
              Setup complete — submission is available for this company.
            </span>
          ) : (
            <span className="text-muted-foreground">
              Waiting on: {s.missing.join(", ")}. Nothing is ever submitted from this screen.
            </span>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void status.refetch();
            toast.message("Re-checked billing setup (read-only, nothing was submitted)");
          }}
        >
          Test / re-check connection
        </Button>
      </div>
    </section>
  );
}
